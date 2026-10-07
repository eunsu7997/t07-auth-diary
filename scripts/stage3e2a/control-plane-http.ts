import { normalizeTarget, type TargetPolicy } from './transport.ts';
import { TrustedObservationSupervisor } from '../capability/supervisor.ts';
export interface ControlPlaneHttp { get(path: string): Promise<unknown> }
const real = new WeakSet<object>(), fake = new WeakSet<object>();
export function httpOrigin(client: ControlPlaneHttp): 'REMOTE_CONTROL_PLANE' | 'FAKE_CONTROL_PLANE' | 'UNKNOWN' {
  return real.has(client) && Object.getPrototypeOf(client) === CloudflareReadonlyHttp.prototype ? 'REMOTE_CONTROL_PLANE' : fake.has(client) && Object.getPrototypeOf(client) === FakeControlPlaneHttp.prototype ? 'FAKE_CONTROL_PLANE' : 'UNKNOWN';
}
export class FakeControlPlaneHttp implements ControlPlaneHttp {
  #handler: (path: string) => Promise<unknown>;
  constructor(handler: (path: string) => Promise<unknown>) { this.#handler = handler; fake.add(this); Object.freeze(this); }
  async get(path: string) { return structuredClone(await this.#handler(path)); }
}
export class CloudflareReadonlyHttp implements ControlPlaneHttp {
  #policy: TargetPolicy; #credential: () => Promise<string>; #zones = new Set<string>();
  constructor(policy: TargetPolicy, credential: () => Promise<string>) { this.#policy = normalizeTarget(policy); this.#credential = credential; real.add(this); Object.freeze(this); }
  async get(path: string) {
    const p = this.#policy, account = `/accounts/${p.expectedAccountId}`, database = `${account}/d1/database/${p.expectedDatabaseId}`;
    const url = new URL(path, 'https://api.cloudflare.com/client/v4/');
    const route = url.pathname.replace(/^\/client\/v4/, '');
    const allowed = route === account || route === database || route === `${database}/time_travel/bookmark` || route === `${account}/workers/scripts` || new RegExp(`^${account}/workers/scripts/[a-zA-Z0-9_-]+/(settings|deployments|schedules)$`).test(route) || route === `${account}/tokens/verify` || new RegExp(`^${account}/tokens/[a-f0-9]{32}$`).test(route) || route === '/zones' && url.searchParams.get('account.id') === p.expectedAccountId || [...this.#zones].some(id => route === `/zones/${id}/workers/routes`);
    if (url.origin !== 'https://api.cloudflare.com' || !allowed || url.username || url.password || url.hash) throw new Error('CONTROL_PLANE_PATH_DENIED');
    // Actual requests are delegated to a fixed runner; this stage has no remote issuer.
    // Never invoke the credential callback during local-only preparation.
    return new TrustedObservationSupervisor(p).observe({ kind: 'GET', path: url.pathname + url.search });
  }
}
Object.freeze(CloudflareReadonlyHttp.prototype); Object.freeze(FakeControlPlaneHttp.prototype);
