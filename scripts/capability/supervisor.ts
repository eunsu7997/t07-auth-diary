import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { normalizeTarget, type TargetPolicy } from '../stage3e2a/transport.ts';
import { compileObservation, requestFingerprint, validateEnvelope, type Operation } from './protocol.ts';
const receipts = new WeakMap<object, { owner: object; session: object; fingerprint: string; at: number; used: boolean; value: unknown; origin: 'FAKE_CONTROL_PLANE' }>();
const leases = new WeakMap<object, { owner: object; session: object; fingerprint: string; expires: number; used: boolean }>();
const deny = (): never => { throw new Error('OBSERVATION_AUTHORITY_DENIED'); };
export function runnerEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // No inherited NODE_OPTIONS, proxy, CA, PATH, TLS-disable, keylog or debug options.
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']) if (source[key]) env[key] = source[key];
  return env;
}
export class TrustedObservationSupervisor {
  #policy: TargetPolicy;
  constructor(policy: TargetPolicy) { this.#policy = normalizeTarget(policy); Object.freeze(this); }
  async localCheck(operation: Operation): Promise<{ kind: 'OFFLINE_CHECK'; method: string }> {
    const snapshot = structuredClone(operation); compileObservation(this.#policy, snapshot);
    const nonce = Array.from(randomBytes(32), byte => byte.toString(16).padStart(2, '0')).join(''), fingerprint = requestFingerprint(this.#policy, snapshot);
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(new URL('./runner.mjs', import.meta.url))], { env: runnerEnvironment(process.env), shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '', bytes = 0, finished = false;
      const finish = (error?: Error, method?: string) => { if (finished) return; finished = true; clearTimeout(timer); child.kill(); error ? reject(error) : resolve({ kind: 'OFFLINE_CHECK', method: method! }); };
      const timer = setTimeout(() => finish(new Error('OBSERVATION_RUNNER_FAILED')), 10000);
      child.on('error', () => finish(new Error('OBSERVATION_RUNNER_FAILED')));
      child.stdin.on('error', () => finish(new Error('OBSERVATION_RUNNER_FAILED')));
      const decoder = new TextDecoder();
      child.stdout.on('data', (chunk: Uint8Array) => { bytes += chunk.length; if (bytes > 1024 * 1024) finish(new Error('OBSERVATION_RUNNER_FAILED')); else output += decoder.decode(chunk, { stream: true }); });
      child.stderr.on('data', () => { /* Never retain child debug/error payloads. */ });
      child.on('close', code => {
        try { const value = JSON.parse(output); if (code !== 0 || value.kind !== 'OFFLINE_CHECK' || value.nonce !== nonce || value.fingerprint !== fingerprint || value.method !== compileObservation(this.#policy, snapshot).method) throw new Error(); finish(undefined, value.method); } catch { finish(new Error('OBSERVATION_RUNNER_FAILED')); }
      });
      child.stdin.end(JSON.stringify({ mode: 'LOCAL_CHECK', target: this.#policy, operation: snapshot, nonce }));
    });
  }
  async observe(operation: Operation): Promise<never> {
    compileObservation(this.#policy, operation);
    // No remote approval issuer for this local-only stage; do not read credentials/spawn.
    return deny();
  }
}
export class FixtureObservationSupervisor {
  #policy: TargetPolicy; #session = Object.freeze({}); #closed = false;
  #handler: (wire: ReturnType<typeof compileObservation>) => Promise<unknown>;
  constructor(policy: TargetPolicy, handler: (wire: ReturnType<typeof compileObservation>) => Promise<unknown>) { this.#policy = normalizeTarget(policy); this.#handler = handler; Object.freeze(this); }
  lease(operation: Operation, ttlMs = 30000): object {
    if (this.#closed || !Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > 30000) return deny();
    const result = Object.freeze({}); leases.set(result, { owner: this, session: this.#session, fingerprint: requestFingerprint(this.#policy, operation), expires: Date.now() + ttlMs, used: false }); return result;
  }
  async observe(operation: Operation, lease: object): Promise<object> {
    const snapshot = structuredClone(operation), fingerprint = requestFingerprint(this.#policy, snapshot), record = leases.get(lease);
    if (this.#closed || !record || record.owner !== this || record.session !== this.#session || record.used || record.expires <= Date.now() || record.fingerprint !== fingerprint) return deny();
    record.used = true; // Consume before asynchronous work, including unknown outcomes.
    const start = Date.now(), value = validateEnvelope(await this.#handler(compileObservation(this.#policy, snapshot)));
    if (this.#closed || Date.now() - start < 0 || Date.now() - start > 30000) return deny();
    const result = Object.freeze({}); receipts.set(result, { owner: this, session: this.#session, fingerprint, at: Date.now(), used: false, value: structuredClone(value), origin: 'FAKE_CONTROL_PLANE' }); return result;
  }
  consume(receipt: object, operation: Operation) {
    const record = receipts.get(receipt);
    if (this.#closed || !record || record.owner !== this || record.session !== this.#session || record.used || record.fingerprint !== requestFingerprint(this.#policy, operation) || Date.now() - record.at < 0 || Date.now() - record.at > 30000) return deny();
    record.used = true; return { origin: record.origin, value: structuredClone(record.value) };
  }
  close() { this.#closed = true; }
}
export function readActualReceipt(_value: unknown): undefined {
  // OFFLINE_CHECK and fixture receipts never yield actual remote approval.
  return undefined;
}
Object.freeze(TrustedObservationSupervisor.prototype); Object.freeze(FixtureObservationSupervisor.prototype);
