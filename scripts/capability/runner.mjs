// Fixed executable entry. No dynamic script/agent/CA/HTTP injection.
import { request, Agent } from 'node:https';
import { compileObservation, requestFingerprint, validateEnvelope } from './protocol.ts';
const MAX = 1024 * 1024;
// No remote authorization was given for this stage. Future activation needs code review.
const remoteExecutionApproved = false;
async function readHttps(wire, credential) {
  if (typeof credential !== 'string' || !credential || /[\r\n]/.test(credential)) throw new Error('CONTROL_PLANE_READ_FAILED');
  const agent = new Agent({ rejectUnauthorized: true, maxCachedSessions: 0 });
  try {
    return await new Promise((resolve, reject) => {
      const req = request({ hostname: 'api.cloudflare.com', port: 443, servername: 'api.cloudflare.com', path: wire.path, method: wire.method, agent, rejectUnauthorized: true, headers: { Authorization: `Bearer ${credential}`, ...(wire.body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(wire.body) } : {}) } }, res => {
        if (res.statusCode !== 200) { res.resume(); req.destroy(); reject(new Error('CONTROL_PLANE_READ_FAILED')); return; }
        let bytes = 0; const chunks = [];
        res.on('data', chunk => { bytes += chunk.length; if (bytes > MAX) { req.destroy(); reject(new Error('CONTROL_PLANE_READ_FAILED')); } else chunks.push(chunk); });
        res.on('error', () => reject(new Error('CONTROL_PLANE_READ_FAILED')));
        res.on('end', () => { try { resolve(validateEnvelope(JSON.parse(Buffer.concat(chunks).toString('utf8')))); } catch { reject(new Error('CONTROL_PLANE_READ_FAILED')); } });
      });
      const timer = setTimeout(() => req.destroy(new Error('CONTROL_PLANE_READ_FAILED')), 10000);
      req.on('close', () => clearTimeout(timer)); req.on('error', () => reject(new Error('CONTROL_PLANE_READ_FAILED')));
      req.end(wire.body || undefined);
    });
  } finally { agent.destroy(); }
}
let bytes = 0; const chunks = [];
try {
  for await (const chunk of process.stdin) { bytes += chunk.length; if (bytes > MAX) throw new Error('RUNNER_INPUT_INVALID'); chunks.push(chunk); }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (input.mode !== 'LOCAL_CHECK' && input.mode !== 'REMOTE_READ') throw new Error('RUNNER_INPUT_INVALID');
  const wire = compileObservation(input.target, input.operation);
  if (!/^[a-f0-9]{64}$/.test(input.nonce ?? '')) throw new Error('RUNNER_INPUT_INVALID');
  const fingerprint = requestFingerprint(input.target, input.operation);
  if (input.mode === 'LOCAL_CHECK') {
    // No envelope capable of satisfying actual observation, even if caller sends a fixture.
    process.stdout.write(JSON.stringify({ kind: 'OFFLINE_CHECK', nonce: input.nonce, fingerprint, method: wire.method }));
  } else {
    if (!remoteExecutionApproved) throw new Error('REMOTE_ACTIVITY_NOT_APPROVED');
    const value = await readHttps(wire, input.credential);
    process.stdout.write(JSON.stringify({ kind: 'REMOTE_RESPONSE', nonce: input.nonce, fingerprint, value }));
  }
} catch { process.stdout.write(JSON.stringify({ kind: 'DENIED' })); process.exitCode = 1; }
