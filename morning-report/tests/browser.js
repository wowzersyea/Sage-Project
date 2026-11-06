/* Where the browser is.

   CI has a pinned Chromium at a fixed path. A developer's machine has
   whatever it has, and the suites should run there too, before a push
   rather than after one. PW_CHROME wins if set; then the CI path if it
   exists; then a Chrome or Edge already installed; and if none of those,
   no executablePath at all, which makes Playwright use its own download
   (`npx playwright install chromium`). */
const fs = require('fs');
const { chromium } = require('playwright');

// Keep external fonts and analytics from controlling local test readiness.
const launch = chromium.launch.bind(chromium);
chromium.launch = async function (options) {
  const browser = await launch(options);
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async function (options) {
    const context = await newContext(options);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (/^(fonts\.googleapis\.com|fonts\.gstatic\.com|www\.googletagmanager\.com|www\.google-analytics\.com)$/.test(url.hostname)) {
        return route.fulfill({status: 200, contentType: url.hostname.startsWith('fonts.') ? 'text/css' : 'application/javascript', body: ''});
      }
      if (url.hostname === 'script.google.com') return route.abort();
      return route.continue();
    });
    return context;
  };
  return browser;
};

const CI_PATH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const LOCAL = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

function executablePath() {
  if (process.env.PW_CHROME) return process.env.PW_CHROME;
  for (const p of [CI_PATH].concat(LOCAL)) if (fs.existsSync(p)) return p;
  return undefined;
}

/* chromium.launch(launchOptions({ args: [...] })) — the extras are kept,
   the executable is filled in. */
function launchOptions(extra) {
  const o = Object.assign({}, extra || {});
  const p = executablePath();
  if (p) o.executablePath = p;
  return o;
}

module.exports = { executablePath, launchOptions };
