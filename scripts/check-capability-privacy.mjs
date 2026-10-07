// Read-only private-string comparison. Outputs scalar counts only.
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(resolve(dir, e.name)) : [resolve(dir, e.name)]);
const paths = [...walk(resolve(root, 'scripts/stage3e2a')), ...walk(resolve(root, 'evidence/t07/stage3e2a')), resolve(root, 'tests/import-stage3e2a.test.ts'), resolve(root, 'tests/disposable-issuers.test.ts'), ...walk(resolve(root, 'evidence/t07/issuers')), ...walk(resolve(root, 'scripts/capability')), resolve(root, 'tests/capability-runner.test.ts'), ...walk(resolve(root, 'evidence/t07/capability-local')), ...walk(resolve(root, 'dist'))];
paths.push(...walk(resolve(root, 'evidence/t07/capability-design')), resolve(root, 'handoff/CURRENT.md'), resolve(root, 'handoff/CODEX-RESULT.md'));
const source = JSON.parse(readFileSync('C:/Users/User/Downloads/t06-diary.json', 'utf8'));
const privateText = [...source.plan_versions.flatMap(r => [r.title, r.success_criteria]), ...source.tasks.map(r => r.content), ...source.tags.map(r => r.name)].filter(s => typeof s === 'string' && s.length >= 6);
const productionIds = [resolve(root, 'wrangler.jsonc'), resolve(root, '../t06/wrangler.jsonc')].flatMap(path => [...readFileSync(path, 'utf8').matchAll(/"database_id"\s*:\s*"([^"]+)"/g)].map(m => m[1]));
let privateMatches = 0, credentialPatterns = 0, prohibitedEvidenceFields = 0, distToolMatches = 0;
const scanFields = v => { if (!v || typeof v !== 'object') return; for (const [k, value] of Object.entries(v)) { if (/^(password|passwordHash|cookie|token|secret|salt|rows|email|databaseId|accountId|bookmark)$/i.test(k)) prohibitedEvidenceFields++; scanFields(value); } };
for (const path of paths) {
  const text = readFileSync(path, 'utf8');
  for (const value of [...privateText, ...productionIds]) if (text.includes(value) || text.includes(JSON.stringify(value).slice(1, -1))) privateMatches++;
  if (/Bearer\s+[A-Za-z0-9_-]{24,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:CLOUDFLARE_API_TOKEN|BETTER_AUTH_SECRET)\s*[:=]\s*['"][^'"]{12,}/.test(text)) credentialPatterns++;
  if (path.includes('evidence') && path.endsWith('.json')) scanFields(JSON.parse(text));
  if (path.includes('dist') && /stage3e2a|DisposableRemoteD1Provider|DisposableApprovalAuthority|CloudflareControlPlaneObserver|DISPOSABLE_REMOTE_TEST_NOT_APPROVED|TrustedObservationSupervisor|FixtureObservationSupervisor|OBSERVATION_AUTHORITY_DENIED/.test(text)) distToolMatches++;
}
const pass = privateMatches + credentialPatterns + prohibitedEvidenceFields + distToolMatches === 0;
mkdirSync(resolve(root, 'evidence/t07/stage3e2a'), { recursive: true });
writeFileSync(resolve(root, 'evidence/t07/capability-local/privacy-check.json'), JSON.stringify({ pass, filesChecked: paths.length, privateMatches, credentialPatterns, prohibitedEvidenceFields, distToolMatches, limitation: 'Exact private source strings >=6 characters, configured production IDs and known credential patterns; not every possible encoding.' }, null, 2) + '\n');
console.log(pass ? 'PRIVACY_CHECK_PASS' : 'PRIVACY_CHECK_FAIL'); if (!pass) process.exitCode = 1;
