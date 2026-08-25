#!/usr/bin/env node
/* Run every suite in order and summarise. Each one exits non-zero on
   a failure or on any console error, so this does too. */
const { execFileSync } = require('child_process');
const path = require('path');

const SUITES = [
  'store', 'roster', 'board', 'capture', 'scorecard',
  'roles', 'review', 'report', 'equity', 'shortnames', 'wheellabels', 'rotation', 'site',
  'remote', 'appsscript', 'gate', 'confirm', 'feedback', 'baseline', 'qr',
];

let failed = [];
for (const name of SUITES) {
  process.stdout.write(`\n─── ${name} ${'─'.repeat(Math.max(0, 60 - name.length))}\n`);
  try {
    execFileSync(process.execPath, [path.join(__dirname, `${name}.test.js`)], { stdio: 'inherit' });
  } catch (e) {
    failed.push(name);
  }
}

console.log('\n' + '='.repeat(66));
if (failed.length) {
  console.log(`FAILED: ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`All ${SUITES.length} suites passed.`);
