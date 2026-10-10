/**
 * The single display formatter for durations, in Korean units: 0 → "0초", 125 → "2분 5초",
 * 28800 → "8시간". Hours are not folded into days (191397 → "53시간 9분 57초").
 * Negative values keep their "-"; `signed` also marks positive values with "+" (differences).
 * Fractions round to the nearest second; NaN/Infinity render as "—".
 * Display only: never feed the result back into sums, averages or differences.
 */
export function formatDuration(seconds: number, options: { signed?: boolean } = {}) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '—';
  const whole = Math.round(seconds);
  const sign = whole < 0 ? '-' : options.signed && whole > 0 ? '+' : '';
  const abs = Math.abs(whole);
  const h = Math.floor(abs / 3600), m = Math.floor((abs % 3600) / 60), s = abs % 60;
  const parts = [h ? `${h}시간` : '', m ? `${m}분` : '', s ? `${s}초` : ''].filter(Boolean);
  return sign + (parts.length ? parts.join(' ') : '0초');
}

/** Evidence views: the Korean form plus the exact stored seconds, e.g. "8시간 (28800초)". */
export function formatDurationExact(seconds: number, options: { signed?: boolean } = {}) {
  const text = formatDuration(seconds, options);
  return typeof seconds === 'number' && Number.isFinite(seconds) ? `${text} (${seconds}초)` : text;
}
