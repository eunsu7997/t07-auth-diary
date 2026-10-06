// Offline scanner: neither matched text nor credentials are printed or copied.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(resolve(dir, e.name)) : [resolve(dir, e.name)]);
const paths = [...walk(resolve(root, 'scripts/stage3d')), ...walk(resolve(root, 'evidence/t07/stage3d')), ...walk(resolve(root, 'dist')),
  resolve(root, 'tests/import-stage3d.test.ts'), resolve(root, 'tests/stage3d-fixtures.ts')];
const source = JSON.parse(readFileSync('C:/Users/User/Downloads/t06-diary.json', 'utf8'));
const privateText = [...source.plan_versions.flatMap(r => [r.title, r.success_criteria]), ...source.tasks.map(r => r.content), ...source.tags.map(r => r.name)]
  .filter(s => typeof s === 'string' && s.length >= 6);
let sourceTextMatches = 0; let prohibitedEvidenceKeys = 0; let hardcodedSecrets = 0; let remoteImplementationMatches = 0; let distToolMatches = 0;
const checkKeys = value => {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(password|passwordHash|token|cookie|secret|authFingerprint|users|accounts|business)$/i.test(key)) prohibitedEvidenceKeys++;
    checkKeys(child);
  }
};
for (const path of paths) {
  if (!/\.(ts|mjs|json|md|js|css|html)$/.test(path)) continue;
  const content = readFileSync(path, 'utf8');
  for (const s of privateText) if (content.includes(s) || content.includes(JSON.stringify(s).slice(1, -1))) sourceTextMatches++;
  if (/BETTER_AUTH_SECRET\s*[:=]\s*['"][^'"]{12,}/.test(content) || /(?:Bearer\s+[A-Za-z0-9_-]{24,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/.test(content)) hardcodedSecrets++;
  if (path.includes('scripts\\stage3d') || path.includes('scripts/stage3d')) {
    if (/from\s*['"]wrangler['"]|\bfetch\s*\(|\bgetPlatformProxy\s*\(|\bstartRemoteProxySession\s*\(/.test(content)) remoteImplementationMatches++;
  }
  if ((path.includes('dist\\') || path.includes('dist/')) && /stage3d|REMOTE_IMPORT_NOT_IMPLEMENTED|FakeLoopbackAuthAdapter/.test(content)) distToolMatches++;
  if (path.includes('evidence') && path.endsWith('.json')) checkKeys(JSON.parse(content));
}
const pass = sourceTextMatches === 0 && prohibitedEvidenceKeys === 0 && hardcodedSecrets === 0 && remoteImplementationMatches === 0 && distToolMatches === 0;
writeFileSync(resolve(root, 'evidence/t07/stage3d/privacy-check.json'), JSON.stringify({ pass, filesChecked: paths.length, sourceTextMatches,
  prohibitedEvidenceKeys, hardcodedSecrets, remoteImplementationMatches, distToolMatches,
  limitation: 'Static source-text/known-secret-pattern scan; not proof of all possible secret encodings or provider logging.' }, null, 2) + '\n');
console.log(pass ? 'PRIVACY_CHECK_PASS' : 'PRIVACY_CHECK_FAIL'); if (!pass) process.exitCode = 1;
