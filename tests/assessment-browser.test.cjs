const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {chromium} = require('playwright');
const {launchOptions} = require('../morning-report/tests/browser');
let browser;
before(async () => {browser = await chromium.launch(launchOptions());});
after(async () => {await browser?.close();});

test('real assessment producers remain compatible with the secured collector', async () => {
    const collector = vm.createContext({});
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/sheets_webhook.gs'), 'utf8'), collector);
    for (const route of ['med-student-assessment', 'resident-post-assessment', 'antimicrobial-assessment', 'antimicrobial-selection']) {
        const page = await browser.newPage();
        try {
            // Exercise retained legacy producers without following production redirects.
            const html = fs.readFileSync(path.join(__dirname, '..', route, 'index.html'), 'utf8')
                .replace(/<meta http-equiv="refresh"[^>]*>/g, '')
                .replace(/<script>location\.replace\([^<]*<\/script>/g, '');
            await page.route('http://localhost:8899/' + route + '/', request => request.fulfill({contentType: 'text/html', body: html}));
            await page.goto('http://localhost:8899/' + route + '/');
            const payload = await page.evaluate(async route => {
                SageSubmission.submit = async payload => {window.capturedSubmission = payload;};
                student = {name: 'Example learner', email: 'student@example.test', year: 'MS3', school: 'Example school', level: 'Resident', program: 'Example program'};
                if (route === 'antimicrobial-selection') {
                    await saveResultsToSheet(buildPayload());
                } else {
                    results = DOMAINS.map(d => ({domainId: d.id, domainName: d.name,
                        tiers: d.questions.map((q, i) => ({tier: i, question: q, selectedOption: q.correct, correct: true}))}));
                    const total = results.reduce((n, d) => n + d.tiers.length, 0);
                    await saveResultsToSheet(100, total, total);
                }
                return {...window.capturedSubmission, submissionId: 'test-producer-00001'};
            }, route);
            assert.doesNotThrow(() => collector.validateSubmission(payload), route);
        } finally {await page.close();}
    }
});
test('submission retry preserves ID and only acknowledges confirmed persistence', async () => {
    const page = await browser.newPage();
    try {
        await page.goto('http://localhost:8899/literature-monitor/digest.html');
        await page.addScriptTag({url: '/assets/assessment-submit.js'});
        const ids = [];
        await page.route('**/assessment-api/submit', route => {
            const body = route.request().postDataJSON(); ids.push(body.submissionId);
            return route.fulfill({status: ids.length === 1 ? 502 : 200, json: ids.length === 1 ? {status: 'error'} : {status: 'ok', submissionId: body.submissionId}});
        });
        assert.equal(await page.evaluate(() => SageSubmission.submit({name: 'Example'})), false);
        await page.getByRole('button', {name: 'Retry Submission'}).click();
        await page.getByText('Answers submitted successfully.').waitFor();
        assert.equal(ids[0], ids[1]);
        assert.equal(await page.evaluate(() => sessionStorage.getItem('sage.pending-assessment')), null);
    } finally {await page.close();}
});

test('a second pending assessment does not discard the first during an outage', async () => {
    const page = await browser.newPage();
    try {
        await page.goto('http://localhost:8899/admin/');
        await page.addScriptTag({url:'/assets/assessment-submit.js'});
        let online = false;
        const saved = [];
        await page.route('**/assessment-api/submit', route => {
            const body = route.request().postDataJSON();
            if (online) saved.push(body);
            return route.fulfill({status:online ? 200 : 503, json:online ? {status:'ok',submissionId:body.submissionId} : {status:'error'}});
        });
        await page.evaluate(() => SageSubmission.submit({name:'First assessment'}));
        await page.evaluate(() => SageSubmission.submit({name:'Second assessment'}));
        assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('sage.pending-assessment')).length),2);
        online = true;
        await page.getByRole('button',{name:'Retry Submission'}).click();
        await page.getByText('Answers submitted successfully.').waitFor();
        assert.deepEqual(saved.map(p=>p.name),['First assessment','Second assessment']);
        assert.equal(await page.evaluate(() => sessionStorage.getItem('sage.pending-assessment')),null);
    } finally {await page.close();}
});
test('faculty filters render hostile assessment types as text', async () => {
    const page = await browser.newPage();
    try {
        await page.route('**/assessment-api/admin', route => route.fulfill({json: {status: 'ok', submissions: [{assessmentType: '<img src=x onerror=alert(1)>', name: 'Example'}]}}));
        await page.goto('http://localhost:8899/admin/');
        await page.waitForSelector('#filters button');
        assert.equal(await page.locator('#filters img').count(), 0);
        assert.ok((await page.locator('#filters').textContent()).includes('<img'));
    } finally {await page.close();}
});

test('faculty question details escape hostile concept counts from legacy records', async () => {
    const page = await browser.newPage();
    try {
        const hostile = '<img src=x onerror="window.injected=true">';
        await page.route('**/assessment-api/admin', route => route.fulfill({json: {status: 'ok', submissions: [{name: 'Example',
            domains: [{domain: 'Example', asked: 1, correct: 0, answers: [{detail: {nHit: hostile, nConcepts: hostile}}]}]}]}}));
        await page.goto('http://localhost:8899/admin/');
        await page.locator('#list .card').click();
        assert.equal(await page.locator('#modal img').count(), 0);
        assert.ok((await page.locator('#modal').textContent()).includes(hostile));
        assert.equal(await page.evaluate(() => window.injected), undefined);
    } finally {await page.close();}
});

test('expired faculty authentication clears previously displayed records and details', async () => {
    const page = await browser.newPage();
    try {
        let authenticated = true;
        await page.route('**/assessment-api/admin', route => route.fulfill({status: authenticated ? 200 : 401,
            json: authenticated ? {status: 'ok', submissions: [{name: 'Private learner'}]} : {status: 'unauthorized'}}));
        await page.goto('http://localhost:8899/admin/');
        await page.locator('#list .card').click();
        authenticated = false;
        await page.evaluate(() => loadData());
        assert.equal(await page.locator('#dash').isVisible(), false);
        assert.equal(await page.locator('#modal').textContent(), '');
        assert.equal(await page.locator('#list').textContent(), '');
        assert.equal(await page.evaluate(() => ALL.length), 0);
    } finally {await page.close();}
});
