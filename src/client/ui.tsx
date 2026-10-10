// Display-only helpers and icons. Nothing here touches API calls or stored values.
import type { ReactNode } from 'react';

const seoulDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
export const seoulToday = () => seoulDate.format(new Date());
const dayDiff = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/** Visual period state for a plan, based on the Korean calendar date. */
export function planPhase(start: string, end: string, today = seoulToday()): { label: string; tone: 'upcoming' | 'active' | 'ended'; detail: string; days: number } {
  const days = Math.max(1, dayDiff(start, end) + 1);
  if (!Number.isFinite(days)) return { label: '기간', tone: 'active', detail: '', days: 0 };
  if (today < start) return { label: `시작 D-${dayDiff(today, start)}`, tone: 'upcoming', detail: `${days}일 계획`, days };
  if (today > end) return { label: '기간 종료', tone: 'ended', detail: `${days}일 계획`, days };
  const left = dayDiff(today, end);
  return { label: left === 0 ? '마지막 날' : `D-${left}`, tone: 'active', detail: `${dayDiff(start, today) + 1}일째 / ${days}일`, days };
}

/** Formats elapsed seconds as a stopwatch string (M:SS or H:MM:SS). */
export function clock(total: number) {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

const paths: Record<string, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  play: <path d="M7 4.5v15l12.5-7.5z" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2.5" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  rotate: <><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" /><path d="M3.5 4v4.5H8" /></>,
  edit: <><path d="M4 20h4L19.5 8.5a2.8 2.8 0 0 0-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></>,
  trash: <><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13" /></>,
  download: <><path d="M12 4v11M7 10.5l5 5 5-5" /><path d="M4.5 19.5h15" /></>,
  logout: <><path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15" /><path d="M10 16.5 5.5 12 10 7.5M5.5 12H15" /></>,
  calendar: <><rect x="4" y="5.5" width="16" height="14.5" rx="2.5" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  flag: <><path d="M5.5 21V4.5" /><path d="M5.5 5h11l-2 4 2 4h-11" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.3-4.3" /></>,
  copy: <><rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5" /><path d="M15.5 8.5V6A2 2 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" /></>,
  target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" /></>,
  alert: <><path d="M12 4 2.8 19.5h18.4z" /><path d="M12 10v4M12 17v.01" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8v.01" /></>,
  shield: <><path d="M12 3.5 5 6v5.5c0 4.5 3 7.7 7 9 4-1.3 7-4.5 7-9V6z" /><path d="m9 12 2 2 4-4" /></>,
  list: <><path d="M9 6.5h11M9 12h11M9 17.5h11" /><path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" /></>,
  chart: <><path d="M4 20h16" /><path d="M7 16v-5M12 16V6M17 16v-8" /></>,
  layers: <><path d="m12 4 8.5 4.5L12 13 3.5 8.5z" /><path d="m3.5 12.5 8.5 4.5 8.5-4.5" /></>,
  user: <><circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20c1-3.6 4-5.5 7.5-5.5s6.5 1.9 7.5 5.5" /></>,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M4 4l16 16" /><path d="M9.9 5.8A9.6 9.6 0 0 1 12 5.5C18 5.5 21.5 12 21.5 12a17 17 0 0 1-3 3.8M6.4 7.4A16.5 16.5 0 0 0 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1" /></>,
  sparkle: <path d="M12 3.5 13.8 10l6.7 2-6.7 2L12 20.5 10.2 14l-6.7-2 6.7-2z" />,
  home: <><rect x="4" y="4" width="7" height="7" rx="2" /><rect x="13" y="4" width="7" height="7" rx="2" /><rect x="4" y="13" width="7" height="7" rx="2" /><rect x="13" y="13" width="7" height="7" rx="2" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" /></>,
  circle: <circle cx="12" cy="12" r="8" />,
  chevron: <path d="m9 6 6 6-6 6" />,
};

export type IconName = keyof typeof paths;
export function Icon({ name, className }: { name: IconName; className?: string }) {
  const filled = name === 'play' || name === 'stop' || name === 'sparkle';
  return <svg className={`icon${className ? ` ${className}` : ''}`} viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"
    fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

/** Three overlapping petals — Plan (lavender), Do (mint), See (pink). Pure SVG, CSP-safe. */
export function BrandMark() {
  return <svg className="brand-mark" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false">
    <rect width="32" height="32" rx="10" className="brand-mark-bg" />
    <ellipse cx="16" cy="11.5" rx="4.6" ry="6.2" className="brand-petal plan" />
    <ellipse cx="16" cy="11.5" rx="4.6" ry="6.2" className="brand-petal do" transform="rotate(120 16 17)" />
    <ellipse cx="16" cy="11.5" rx="4.6" ry="6.2" className="brand-petal see" transform="rotate(240 16 17)" />
    <circle cx="16" cy="17" r="2.2" className="brand-core" />
  </svg>;
}

/** Duration in Korean units without rounding away seconds (display only). */
export function duration(total: number) {
  const s = Math.max(0, Math.round(total));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const parts = [h ? `${h}시간` : '', m ? `${m}분` : '', sec ? `${sec}초` : ''].filter(Boolean);
  return parts.length ? parts.join(' ') : '0분';
}
