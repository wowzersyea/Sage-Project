const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
function script(file, globals = {}) {
    const context = vm.createContext(globals);
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
    return context;
}
function collector() {
    const sheets = {};
    const messages = [];
    const properties = {ASSESSMENT_ADMIN_KEY: 'a'.repeat(40), ASSESSMENT_WRITE_KEY: 'w'.repeat(40)};
    const range = {setBackground() {return this;}, setFontColor() {return this;}, setFontWeight() {return this;}, setValues() {return this;}};
    const ss = {getSheetByName: name => sheets[name], insertSheet(name) {
        const rows = [];
        return sheets[name] = {rows, appendRow: r => rows.push(r), setFrozenRows() {}, getRange: () => range,
            getDataRange: () => ({getValues: () => rows}), getLastRow: () => rows.length};
    }};
    const c = script('scripts/sheets_webhook.gs', {
        PropertiesService: {getScriptProperties: () => ({getProperty: k => properties[k]})},
        LockService: {getScriptLock: () => ({waitLock() {}, releaseLock() {}})},
        SpreadsheetApp: {openById: () => ss}, MailApp: {sendEmail: message => messages.push(message)}, console,
        ContentService: {MimeType: {JSON: 'json'}, createTextOutput: s => ({setMimeType: () => JSON.parse(s)})}
    });
    return {c, sheets, properties, messages, emails: () => messages.length,
        post: data => c.doPost({postData: {contents: JSON.stringify(data)}})};
}
test('collector fails closed, validates inputs, neutralizes formulas and deduplicates retries', () => {
    const {c, post, sheets, emails, properties, messages} = collector();
    const payload = {writeKey: 'w'.repeat(40), submissionId: 'test-submission-00001', assessmentType: 'Med Student',
        name: '=1+1', email: 'student@example.test', timestamp: '2026-09-01T00:00:00Z', overallScore: 0, correct: 0, total: 1, domains: []};
    assert.equal(c.doGet({parameter: {key: 'pid'}}).status, 'unauthorized');
    assert.equal(post({...payload, writeKey: ''}).status, 'error');
    assert.equal(post({...payload, assessmentType: '<img>'}).status, 'error');
    assert.equal(post({...payload, email: 'a@b.test,c@d.test'}).status, 'error');
    assert.equal(post(payload).status, 'ok');
    assert.equal(post(payload).status, 'ok');
    assert.equal(post({...payload, timestamp: '2026-09-01T00:01:00Z'}).status, 'ok');
    assert.equal(post(Object.fromEntries(Object.entries(payload).reverse())).status, 'ok');
    assert.equal(post({...payload, name: 'Different person'}).status, 'error');
    assert.equal(sheets['Med Student'].rows.length, 2);
    assert.equal(sheets['Med Student'].rows[1][1], "'=1+1");
    assert.equal(sheets['Med Student'].rows[1][5], 0);
    assert.equal(emails(), 1);
    assert.equal(messages[0].cc, undefined);
    assert.notEqual(messages[0].to, payload.email);
    assert.ok(!sheets['Med Student'].rows[1].at(-1).includes('writeKey'));
    properties.ASSESSMENT_ADMIN_KEY = '';
    assert.equal(c.doGet({parameter: {key: ''}}).status, 'unauthorized');
});

test('collector rejects nested malicious shapes before storing or notifying', () => {
    const {post, sheets, emails} = collector();
    const payload = {writeKey: 'w'.repeat(40), submissionId: 'test-submission-00001', assessmentType: 'Med Student',
        name: 'Example', email: 'student@example.test', timestamp: '2026-09-01T00:00:00Z', overallScore: 0, correct: 0, total: 1};
    const domain = {domain: 'Example', asked: 1, correct: 0, maxTier: 1, answers: []};
    for (const changed of [
        {submissionId: ['test-submission-00001']}, {name: 'Example\r\nBcc: attacker@example.test'},
        {school: {formula: '=1+1'}}, {correct: 2}, {total: 1000000},
        {goals: {rotationGoal: {text: 'invalid'}}},
        {domains: [{...domain, maxTier: '<img src=x onerror=alert(1)>'}]},
        {domains: [{...domain, answers: [null]}]},
        {domains: [{...domain, answers: [{detail: {nHit: '<img>', nConcepts: 1}}]}]},
        {domains: [{...domain, answers: [{selected: {formula: '=1+1'}}]}]},
        {fullPayload: JSON.parse('{"__proto__":{"polluted":true}}')},
        {fullPayload: Array(6).fill('x'.repeat(9000))}
    ]) assert.equal(post({...payload, ...changed}).status, 'error');
    assert.equal(Object.keys(sheets).length, 0);
    assert.equal(emails(), 0);
    assert.equal(post({...payload, domains: [{...domain, answers: [{score: 0.5, detail: {text: 'Reasoning', nHit: 1, nConcepts: 2}}]}]}).status, 'ok');
});
test('HTML inline scripts and JSON parse across the repository', () => {
    function walk(dir) {
        for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
            if (['node_modules', '.git', '.pytest_cache', '__pycache__'].includes(entry.name)) continue;
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) {walk(file); continue;}
            if (entry.name.endsWith('.json')) JSON.parse(fs.readFileSync(file, 'utf8'));
            if (!entry.name.endsWith('.html')) continue;
            const html = fs.readFileSync(file, 'utf8');
            for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
                if (/src=|type=["'](?:module|application\/ld\+json)/.test(m[1])) continue;
                new vm.Script(m[2], {filename: file});
            }
        }
    }
    walk(root);
});
