/* Visitor access and the resident-list boundary, with the real default
   endpoint enabled but intercepted so tests never touch live data. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { launchOptions } = require('./browser');
const BASE = 'http://localhost:8899';

function pages(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return pages(file);
    return entry.name === 'index.html' ? [file] : [];
  });
}
const root = path.resolve(__dirname, '..');
const paths = pages(root).map(file => '/morning-report/' +
  path.relative(root, file).replaceAll(path.sep, '/').replace(/index\.html$/, ''));

(async () => {
  const browser = await chromium.launch(launchOptions());
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const rosterRequests = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await ctx.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname === '/mr-api' || /script\.google/.test(url.hostname)) {
        if (request.method() === 'GET' && !url.searchParams.has('action')) {
          rosterRequests.push(request.url());
        }
        return route.fulfill({ json: { status: 'ok', files: [], data: null,
          roster: { residents: [{ id: 'test-only', name: 'Synthetic Resident', level: 'PGY-1' }] } } });
      }
      if (url.origin !== BASE) return route.fulfill({ body: '' });
      return route.continue();
    });

    for (const pathname of paths) {
      const response = await page.goto(BASE + pathname, { waitUntil: 'networkidle' });
      assert.equal(response.status(), 200, pathname);
      assert.equal(await page.locator('.mr-gate').count(), 0, pathname + ' has no code prompt');
      assert.equal(await page.locator('html.mr-locked').count(), 0, pathname + ' is visible');
      assert.equal(await page.evaluate(() => localStorage.getItem('sage-mr-gate')), null);
      assert.doesNotMatch(await page.locator('body').innerText(), /Synthetic Resident/);
    }
    assert.deepEqual(rosterRequests, [], 'visitors never request a resident list');

    await page.goto(BASE + '/morning-report/');
    assert.equal(await page.locator('a[href="draw/"], a[href="roster/"]').count(), 0);
    assert.doesNotMatch(await page.locator('#mr-bar').innerText(), /roster/i);
    await page.goto(BASE + '/morning-report/archive/');
    assert.match(await page.locator('a[href="../draw/"]').innerText(), /archived/i);
    assert.equal(await page.locator('a[href="../roster/"]').count(), 0);
    await page.goto(BASE + '/morning-report/draw/', { waitUntil: 'networkidle' });
    assert.equal(await page.evaluate(() => wheels.pgy1.people.length + wheels.senior.people.length), 0);

    // Existing private configuration must not fetch names on the active pages.
    await page.evaluate(() => localStorage.setItem('sage-mr-remote', JSON.stringify({
      endpoint: 'https://script.google.com/test-only', key: 'test-only'
    })));
    for (const pathname of ['/morning-report/', '/morning-report/board/',
      '/morning-report/roles/', '/morning-report/admin/', '/morning-report/archive/']) {
      await page.goto(BASE + pathname, { waitUntil: 'networkidle' });
      assert.doesNotMatch(await page.evaluate(() =>
        document.getElementById('mr-bar')?.textContent || ''), /roster/i);
    }
    assert.deepEqual(rosterRequests, [], 'active pages do not fetch remembered private rosters');
    assert.deepEqual(errors, [], 'all pages run without JavaScript errors');
    console.log(`${paths.length} pages open without a passcode; no visitor roster requests; archive navigation verified.`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
