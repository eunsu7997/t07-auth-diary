import { readFileSync, writeFileSync } from 'node:fs';
const folder = 'evidence/t07/stage1';
const units = JSON.parse(readFileSync(`${folder}/t06-unit-regression.json`, 'utf8'));
const browser = JSON.parse(readFileSync(`${folder}/t06-browser-regression.json`, 'utf8'));
const changed = ['matches every business table', 'allows unauthenticated use', 'upgrading an existing phase-1 database', 'a fresh browser context with empty storage'];
const classify = (name, passed) => passed ? 'unchanged-pass' : changed.some(item => name.includes(item)) ? 'requirements-change' : 'auth-fixture-needed';
const cases = units.testResults.flatMap(suite => suite.assertionResults.map(test => ({ group: 'unit-api-contract', name: test.fullName, actual: test.status, classification: classify(test.fullName, test.status === 'passed') })));
function visit(suites) {
  for (const suite of suites) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const passed = test.results.at(-1)?.status === 'passed';
        cases.push({ group: 'browser', name: spec.title, actual: passed ? 'passed' : 'failed', classification: classify(spec.title, passed) });
      }
    }
    visit(suite.suites ?? []);
  }
}
visit(browser.suites);
const counts = {};
for (const item of cases) counts[item.classification] = (counts[item.classification] ?? 0) + 1;
const report = { total: cases.length, counts, explanation: 'Original T06 test bodies unchanged. Failure classification is an implementation plan, not proof those tests pass with authenticated fixtures.', cases };
writeFileSync(`${folder}/regression-classification.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ total: report.total, counts }));
