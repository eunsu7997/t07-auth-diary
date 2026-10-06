// Read-only source comparison; writes only scalar scan metadata, never matched text.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(resolve(dir, e.name)) : [resolve(dir, e.name)]);
const paths = [...walk(resolve(root, 'scripts/stage3e1')), ...walk(resolve(root, 'evidence/t07/stage3e1')), ...walk(resolve(root, 'dist')), resolve(root, 'tests/import-stage3e1.test.ts')];
const source = JSON.parse(readFileSync('C:/Users/User/Downloads/t06-diary.json', 'utf8'));
const text = [...source.plan_versions.flatMap(r => [r.title, r.success_criteria]), ...source.tasks.map(r => r.content), ...source.tags.map(r => r.name)].filter(s => typeof s === 'string' && s.length >= 6);
let sourceTextMatches = 0; let prohibitedEvidenceKeys = 0; let secrets = 0; let networkImplementation = 0; let distToolMatches = 0;
const keys = value => { if (!value || typeof value !== 'object') return; for (const [key, child] of Object.entries(value)) { if (/^(password|passwordHash|token|cookie|secret|salt|key|authFingerprint|rows)$/i.test(key)) prohibitedEvidenceKeys++; keys(child); } };
for (const path of paths) {
  const content = readFileSync(path, 'utf8');
  for (const s of text) if (content.includes(s) || content.includes(JSON.stringify(s).slice(1, -1))) sourceTextMatches++;
  if (/BETTER_AUTH_SECRET\s*[:=]\s*['"][^'"]{12,}|Bearer\s+[A-Za-z0-9_-]{24,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(content)) secrets++;
  if (path.includes('scripts') && path.endsWith('.ts') && /from\s*['"]wrangler['"]|\bgetPlatformProxy\s*\(|\bstartRemoteProxySession\s*\(|\bfetch\s*\(|from\s*['"]node:(?:net|https?|tls)['"]/.test(content)) networkImplementation++;
  if (path.includes('dist') && /stage3e1|REMOTE_TEST_NOT_APPROVED|D1PreparationAdapter/.test(content)) distToolMatches++;
  if (path.includes('evidence') && path.endsWith('.json')) keys(JSON.parse(content));
}
const pass = sourceTextMatches === 0 && prohibitedEvidenceKeys === 0 && secrets === 0 && networkImplementation === 0 && distToolMatches === 0;
writeFileSync(resolve(root, 'evidence/t07/stage3e1/privacy-check.json'), JSON.stringify({ pass, filesChecked: paths.length, sourceTextMatches, prohibitedEvidenceKeys,
  secrets, networkImplementation, distToolMatches, limitation: 'Exact actual source strings >=6 chars and known patterns; not all encodings or every possible secret.' }, null, 2) + '\n');
console.log(pass ? 'PRIVACY_CHECK_PASS' : 'PRIVACY_CHECK_FAIL'); if (!pass) process.exitCode = 1;
