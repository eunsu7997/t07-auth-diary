import type { ExecutionLog } from '../shared/types';
export function fiveDaySummary(logs: ExecutionLog[], dates: string[]) {
  if (dates.length !== 5 || new Set(dates).size !== 5 || dates.some(day => !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day)) return null;
  const days = [...dates].sort();
  const seconds = new Map(days.map(day => [day, 0]));
  const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
  for (const log of logs) {
    if (!log.ended_at || log.actual_seconds === null || !Number.isFinite(log.actual_seconds) || log.actual_seconds < 0 || !Number.isFinite(Date.parse(log.ended_at))) continue;
    const day = formatter.format(new Date(log.ended_at));
    if (seconds.has(day)) seconds.set(day, seconds.get(day)! + log.actual_seconds);
  }
  const daily = days.map(date => ({ date, seconds: seconds.get(date)! }));
  const total = daily.reduce((sum, day) => sum + day.seconds, 0);
  return { daily, total, average: total / 5 };
}
