import { describe, expect, it } from 'vitest';
import { fiveDaySummary } from '../src/client/five-day-summary';
import type { ExecutionLog } from '../src/shared/types';
// Pure synthetic calculation fixtures only; no DB, user or actual-use evidence.
const dates = ['2040-01-01', '2040-01-02', '2040-01-03', '2040-01-04', '2040-01-05'];
const log = (end: string | null, seconds: number | null) => ({ ended_at: end, actual_seconds: seconds } as ExecutionLog);
describe('five-date actual-time calculation', () => {
  it('uses KST finish date, excludes outside/active logs, retains zero days and divides by 5', () => {
    const result = fiveDaySummary([log('2039-12-31T15:01:00Z', 60), log('2040-01-02T03:00:00Z', 40), log('2040-01-05T16:00:00Z', 999), log(null, null)], dates)!;
    expect(result.total).toBe(100); expect(result.average).toBe(20); expect(result.daily.map(day => day.seconds)).toEqual([60, 40, 0, 0, 0]);
  });
  it('same stored-second rule for multiple executions and fractional average', () => { const result = fiveDaySummary([log('2040-01-01T00:00:00Z', 1), log('2040-01-01T01:00:00Z', 2)], dates)!; expect(result.total).toBe(3); expect(result.average).toBe(0.6); });
  it('invalid, duplicated or incomplete date selections do not pretend to be 5 days', () => { for (const selection of [dates.slice(0, 4), [...dates.slice(0, 4), dates[0]], [...dates.slice(0, 4), '2040-02-30'], ['', ...dates.slice(1)]]) expect(fiveDaySummary([], selection)).toBeNull(); });
});
