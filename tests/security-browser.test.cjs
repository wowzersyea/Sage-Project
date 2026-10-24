const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const {launchOptions} = require('../morning-report/tests/browser');
const root = path.join(__dirname, '..');
let browser;
before(async () => { browser = await chromium.launch(launchOptions({headless: true})); });
after(async () => { await browser?.close(); });
const hostile = '<img src=x onerror="window.injected=true">';

test('faculty filters, tier and concept counts are inert; filtering and details still work', async () => {
  const page = await browser.newPage();
  try {
    await page.route('**/*', route => route.request().url() === 'https://sage.test/admin/'
      ? route.fulfill({contentType: 'text/html', body: fs.readFileSync(path.join(root,'admin/index.html'),'utf8')})
      : route.fulfill({body: ''}));
    await page.goto('https://sage.test/admin/');
    await page.evaluate(hostile => {
      ALL = [{name: 'Example learner', assessmentType: hostile,
        domains: [{domain: 'Example', asked: 1, correct: 0,
          answers: [{question: 'Example question', tier: hostile, detail: {nHit: hostile, nConcepts: hostile}}]}]}];
      document.getElementById('gate').style.display='none';
      document.getElementById('dash').style.display='block';
      renderFilters(); renderList();
    }, hostile);
    await page.locator('#filters button').nth(1).click();
    assert.equal(await page.locator('#list .card').count(), 1);
    await page.locator('#list .card').click();
    assert.match(await page.locator('#modal').textContent(), /Example question/);
    assert.ok((await page.locator('#modal').textContent()).includes(hostile));
    assert.equal(await page.locator('#filters img, #modal img, #filters [onclick]').count(), 0);
    assert.equal(await page.evaluate(() => window.injected), undefined);
  } finally { await page.close(); }
});

test('QI renders project metadata and interventions as text and remove still works', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<div id="interventionList"></div><div id="cards"></div>');
    await page.addScriptTag({content: fs.readFileSync(path.join(root,'qi-dashboard/qi-dashboard.js'),'utf8')});
    await page.evaluate(hostile => {
      interventions = [{id: "id');window.injected=true;//", label: hostile, date: hostile, description: hostile}];
      updateInterventionList();
      const card = createProjectCard({id: hostile, name: hostile, data: [], settings: {selectedVariables: []}});
      document.getElementById('cards').append(card);
      window.confirm = () => true;
      renderChart = () => {};
    }, hostile);
    assert.equal(await page.locator('img, [onerror], #interventionList [onclick]').count(), 0);
    assert.ok((await page.locator('#cards').textContent()).includes(hostile));
    await page.getByRole('button', {name: 'Remove', exact: true}).click();
    assert.match(await page.locator('#interventionList').textContent(), /No interventions/);
    assert.equal(await page.evaluate(() => window.injected), undefined);
  } finally { await page.close(); }
});
