// Output booleans/counts only; never print matching secret/credential/token values.
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
const secrets = [];
for (const path of ['.env.local', '.dev.vars']) {
  if (existsSync(path)) {
    const match = readFileSync(path, 'utf8').match(/^BETTER_AUTH_SECRET=(.+)$/m);
    if (match) secrets.push(match[1].trim());
  }
}
const databases = ['.data/t07.sqlite'];
if (existsSync('.data/stage3a')) databases.push(...readdirSync('.data/stage3a').filter(p => p.endsWith('.sqlite')).map(p => join('.data/stage3a', p))); 
const directory = '.wrangler/state/v3/d1';
if (existsSync(directory)) databases.push(...readdirSync(directory, { recursive: true }).filter(path => String(path).endsWith('.sqlite')).map(path => join(directory, String(path))));
for (const path of databases.filter(existsSync)) {
  const db = new DatabaseSync(path, { readOnly: true });
  for (const [table, column] of [['account', 'password'], ['session', 'token']]) {
    if (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?").get(table).n === 1) {
      for (const row of db.prepare(`SELECT ${column} AS value FROM ${table}`).all()) if (typeof row.value === 'string' && row.value.length > 16) secrets.push(row.value);
    }
  }
  db.close();
}
const git = args => execFileSync('git', ['-c', 'safe.directory=' + process.cwd().replaceAll('\\', '/'), ...args], { encoding: 'utf8' });
const paths = git(['ls-files', '--cached', '--others', '--exclude-standard']).trim().split('\n').filter(Boolean);
paths.push(...readdirSync('dist', { recursive: true }).filter(path => /\.(js|html|css)$/.test(String(path))).map(path => join('dist', String(path))));
const leaks = paths.filter(path => {
  const data = readFileSync(path, 'utf8');
  return secrets.some(value => data.includes(value));
});
const trackedPrivateFiles = git(['ls-files']).split('\n').some(path => /^(\.env(?:\.|$)|\.dev\.vars|\.data\/|\.wrangler\/)/.test(path));
const report = { verified_at: new Date().toISOString(), currentFilesAndBundleScanned: paths.length, inspectedLocalSecretValues: secrets.length, secretValueLeaks: leaks.length, trackedPrivateFiles, passed: leaks.length === 0 && !trackedPrivateFiles, limitation: 'Exact local secret/credential/session values checked. This does not certify unknown historic secrets or arbitrary personal text.' };
writeFileSync('evidence/t07/stage3a/local-secret-scan.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: report.passed, secretValueLeaks: leaks.length, trackedPrivateFiles }));
if (!report.passed) process.exitCode = 1;
