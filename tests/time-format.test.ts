import { describe, expect, it } from 'vitest';
import { formatDuration, formatDurationExact } from '../src/client/time-format';

describe('formatDuration', () => {
  it.each([
    [0, '0초'], [45, '45초'], [59, '59초'], [60, '1분'], [125, '2분 5초'], [3599, '59분 59초'],
    [3600, '1시간'], [28800, '8시간'], [86400, '24시간'], [191397, '53시간 9분 57초'], [162597, '45시간 9분 57초'],
  ])('%d초 → %s', (seconds, text) => expect(formatDuration(seconds)).toBe(text));

  it('keeps the sign of negative differences and marks positive ones only when signed', () => {
    expect(formatDuration(-90)).toBe('-1분 30초');
    expect(formatDuration(-90, { signed: true })).toBe('-1분 30초');
    expect(formatDuration(90, { signed: true })).toBe('+1분 30초');
    expect(formatDuration(0, { signed: true })).toBe('0초');
    expect(formatDuration(-28776)).toBe('-7시간 59분 36초');
  });

  it('rounds fractions to the nearest second and never shows "-0초"', () => {
    expect(formatDuration(59.4)).toBe('59초');
    expect(formatDuration(59.5)).toBe('1분');
    expect(formatDuration(1157.6)).toBe('19분 18초');
    expect(formatDuration(-0.4)).toBe('0초');
  });

  it('renders non-finite or non-number input safely', () => {
    expect(formatDuration(Number.NaN)).toBe('—');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatDuration(undefined as unknown as number)).toBe('—');
    expect(formatDuration('60' as unknown as number)).toBe('—');
  });
});

describe('formatDurationExact (evidence views)', () => {
  it('appends the exact stored seconds', () => {
    expect(formatDurationExact(28800)).toBe('8시간 (28800초)');
    expect(formatDurationExact(0)).toBe('0초 (0초)');
    expect(formatDurationExact(-90, { signed: true })).toBe('-1분 30초 (-90초)');
    expect(formatDurationExact(Number.NaN)).toBe('—');
  });
});
