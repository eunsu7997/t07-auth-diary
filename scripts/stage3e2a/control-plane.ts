import type { Identity, TargetPolicy, WriterFacts, RecoveryFacts } from './transport.ts';
export type ControlPlaneValue<T> = Readonly<{ state: 'UNKNOWN' }> | Readonly<{ state: 'Observed'; value: T; origin: 'FAKE_CONTROL_PLANE' | 'REMOTE_CONTROL_PLANE' }>;
export interface ControlPlaneObserver {
  observeAccount(): Promise<ControlPlaneValue<{ accountId: string }>>;
  observeDatabase(): Promise<ControlPlaneValue<Identity>>;
  observeDeploymentWriters(): Promise<ControlPlaneValue<WriterFacts>>;
  observeRecoveryPermissions(): Promise<ControlPlaneValue<RecoveryFacts>>;
}
const issued = new WeakSet<object>();
const freeze = <T>(v: T): T => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
export class FakeControlPlaneObserver implements ControlPlaneObserver {
  #fixture: { identity?: Identity; writers?: WriterFacts; recovery?: RecoveryFacts };
  constructor(fixture: { identity?: Identity; writers?: WriterFacts; recovery?: RecoveryFacts }) { this.#fixture = structuredClone(fixture); Object.freeze(this); }
  #value<T>(v: T | undefined): ControlPlaneValue<T> {
    if (!v) return Object.freeze({ state: 'UNKNOWN' });
    const result = freeze({ state: 'Observed' as const, value: structuredClone(v), origin: 'FAKE_CONTROL_PLANE' as const }); issued.add(result); return result;
  }
  async observeAccount() { return this.#value(this.#fixture.identity ? { accountId: this.#fixture.identity.accountId } : undefined); }
  async observeDatabase() { return this.#value(this.#fixture.identity); }
  async observeDeploymentWriters() { return this.#value(this.#fixture.writers); }
  async observeRecoveryPermissions() { return this.#value(this.#fixture.recovery); }
}
// No REMOTE_CONTROL_PLANE issuer or network implementation exists in this stage.
export async function controlPlanePrecheck(observer: ControlPlaneObserver | undefined, policy: TargetPolicy) {
  if (!observer) return false;
  const facts = [await observer.observeAccount(), await observer.observeDatabase(), await observer.observeDeploymentWriters(), await observer.observeRecoveryPermissions()];
  if (!facts.every(v => v.state === 'Observed' && v.origin === 'REMOTE_CONTROL_PLANE' && issued.has(v))) return false;
  const account = facts[0] as Extract<ControlPlaneValue<{ accountId: string }>, { state: 'Observed' }>;
  const db = facts[1] as Extract<ControlPlaneValue<Identity>, { state: 'Observed' }>;
  const writers = facts[2] as Extract<ControlPlaneValue<WriterFacts>, { state: 'Observed' }>;
  const recovery = facts[3] as Extract<ControlPlaneValue<RecoveryFacts>, { state: 'Observed' }>;
  return account.value.accountId === policy.expectedAccountId && db.value.databaseId === policy.expectedDatabaseId && db.value.accountId === policy.expectedAccountId && db.value.name === policy.expectedName && !policy.deniedDatabaseIds.includes(db.value.databaseId) && [writers.value.workerDeployment, writers.value.routes, writers.value.scheduledWriters, writers.value.otherBindings].every(v => v === false) && recovery.value.restorePermission === true;
}
Object.freeze(FakeControlPlaneObserver.prototype);
