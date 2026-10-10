import { useEffect, useId, useState, type ReactNode } from 'react';
import type { ExecutionLog, Plan, Review, Task } from '../shared/types';
import { fiveDaySummary } from './five-day-summary';
import { clock, duration, Icon, planPhase } from './ui';

// Display-only dashboard. Every number is derived from data the app already fetched
// (selected-plan tasks/executions and the See panel's /review response). Nothing is stored.

export type SeeSnapshot = { review: Review | null; scope: 'all' | 'selected'; usageDates: string[] };

const seoulDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
const dayOf = (iso: string) => seoulDay.format(new Date(iso));
const shortTime = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit' });
const weekdayOf = new Intl.DateTimeFormat('ko-KR', { timeZone: 'UTC', weekday: 'short' });
function shiftDay(day: string, offset: number) { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); }

/** Same inclusion rule as fiveDaySummary: closed runs with valid actual seconds, attributed to the Korean end date. */
function closedRuns(logs: ExecutionLog[]) {
  return logs.filter(log => log.ended_at !== null && log.actual_seconds !== null && Number.isFinite(log.actual_seconds) && log.actual_seconds >= 0 && Number.isFinite(Date.parse(log.ended_at)));
}
function secondsOn(logs: ExecutionLog[], day: string) {
  const runs = closedRuns(logs).filter(log => dayOf(log.ended_at!) === day);
  return { seconds: runs.reduce((sum, log) => sum + log.actual_seconds!, 0), count: runs.length };
}
/** Consecutive Korean dates with at least one closed run, ending today (or yesterday while today has none yet). */
function recordStreak(logs: ExecutionLog[], today: string) {
  const days = new Set(closedRuns(logs).map(log => dayOf(log.ended_at!)));
  const includesToday = days.has(today);
  let count = 0;
  for (let day = includesToday ? today : shiftDay(today, -1); days.has(day); day = shiftDay(day, -1)) count++;
  return { count, includesToday };
}

/** Abstract eight-petal bloom built from one simple curve. Decorative only. */
export function Bloom({ className }: { className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const petal = 'M0 0C13-9 17-34 0-50C-17-34-13-9 0 0Z';
  return <svg className={`bloom${className ? ` ${className}` : ''}`} viewBox="-60 -60 120 120" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={`${id}o`} x1="0" y1="-50" x2="0" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#c4c9ff" /><stop offset=".55" stopColor="#8e95f2" /><stop offset="1" stopColor="#6d63d9" /></linearGradient>
      <linearGradient id={`${id}i`} x1="0" y1="-50" x2="0" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#ffffff" /><stop offset=".6" stopColor="#e7dcff" /><stop offset="1" stopColor="#b9a8f6" /></linearGradient>
      <radialGradient id={`${id}c`}><stop offset="0" stopColor="#fffaf0" /><stop offset=".55" stopColor="#ffe3f1" /><stop offset="1" stopColor="#f2b5d4" /></radialGradient>
      <radialGradient id={`${id}g`}><stop offset="0" stopColor="#c9c3ff" stopOpacity=".55" /><stop offset="1" stopColor="#c9c3ff" stopOpacity="0" /></radialGradient>
    </defs>
    <circle r="58" fill={`url(#${id}g)`} />
    <g className="bloom-outer">{[0, 45, 90, 135, 180, 225, 270, 315].map(a => <path key={a} d={petal} transform={`rotate(${a})`} fill={`url(#${id}o)`} opacity=".92" />)}</g>
    <g className="bloom-inner">{[22.5, 112.5, 202.5, 292.5].map(a => <path key={a} d={petal} transform={`rotate(${a}) scale(.62)`} fill={`url(#${id}i)`} />)}</g>
    <circle r="8.5" fill={`url(#${id}c)`} />
    {[0, 72, 144, 216, 288].map(a => <circle key={a} r="1.6" cx="0" cy="-4.2" transform={`rotate(${a})`} fill="#f7a8cf" />)}
  </svg>;
}

function Ring({ ratio, size, stroke, className, children }: { ratio: number; size: number; stroke: number; className?: string; children?: ReactNode }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const r = size / 2 - stroke, c = 2 * Math.PI * r, value = Math.max(0, Math.min(1, ratio)), mid = size / 2;
  return <div className={`ring${className ? ` ${className}` : ''}`}>
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true" focusable="false">
      <defs><linearGradient id={`${id}r`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" className="ring-stop-a" /><stop offset="1" className="ring-stop-b" /></linearGradient></defs>
      <circle className="ring-halo" cx={mid} cy={mid} r={r + stroke * .9} />
      <circle className="ring-track" cx={mid} cy={mid} r={r} strokeWidth={stroke} />
      {value > 0 ? <circle className="ring-value" cx={mid} cy={mid} r={r} strokeWidth={stroke} stroke={`url(#${id}r)`} strokeDasharray={`${c * value} ${c}`} transform={`rotate(-90 ${mid} ${mid})`} /> : null}
    </svg>
    <div className="ring-center">{children}</div>
  </div>;
}

/** Largest card while a run is open. Same elapsed formula as ExecutionControls; finishing stays on the task card. */
function RunningHero({ log, task }: { log: ExecutionLog; task?: Task }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [log.id]);
  const elapsed = Math.max(0, Math.floor((now - Date.parse(log.started_at)) / 1000));
  return <article className="card running-hero" aria-label="지금 실행 중">
    <div className="running-hero-art" aria-hidden="true"><Bloom className="bloom-spin" /></div>
    <div className="running-hero-body">
      <p className="live-pill"><span className="live-dot" aria-hidden="true" />지금 실행 중</p>
      <p className="running-hero-task preserve">{task?.content ?? '선택한 계획의 할 일'}</p>
      <p className="running-hero-clock" role="timer">{clock(elapsed)}</p>
      <p className="running-hero-meta">{shortTime.format(new Date(log.started_at))} 시작 · 화면 경과는 참고값이며 완료 시 서버가 실제 시간을 확정합니다.</p>
    </div>
    {task ? <a className="btn btn-primary running-hero-link" href={`#task-${task.id}`}>할 일 카드에서 완료하기<Icon name="chevron" /></a> : null}
  </article>;
}

type Props = {
  plan: Plan | null; plansCount: number; loading: boolean; tasks: Task[]; executions: ExecutionLog[];
  activeLog?: ExecutionLog; activeTask?: Task; query: string; today: string; see: SeeSnapshot | null;
};

export default function Dashboard({ plan, plansCount, loading, tasks, executions, activeLog, activeTask, query, today, see }: Props) {
  const running = (id: string) => executions.some(log => log.task_id === id && log.ended_at === null);
  // Today's list: running, unfinished and due today or earlier, or completed on today's Korean date.
  const todayTasks = plan ? tasks.filter(t => running(t.id) || (t.status === 'completed' ? !!t.completed_at && dayOf(t.completed_at) === today : !!t.due_date && t.due_date <= today))
    .sort((a, b) => Number(running(b.id)) - Number(running(a.id)) || Number(a.status === 'completed') - Number(b.status === 'completed') || (a.due_date ?? '').localeCompare(b.due_date ?? '')) : [];
  const doneToday = todayTasks.filter(t => t.status === 'completed').length;
  const percent = todayTasks.length ? Math.round(doneToday / todayTasks.length * 100) : 0;
  const phase = plan ? planPhase(plan.period_start, plan.period_end, today) : null;
  const review = see?.review ?? null;
  const scopeLabel = see?.scope === 'selected' ? '선택한 계획' : '전체 계획';
  const todayWork = review ? secondsOn(review.evidence.closed_executions, review.today) : null;
  const streak = review ? recordStreak(review.evidence.closed_executions, review.today) : null;
  const fiveDays = review && see ? fiveDaySummary(review.evidence.closed_executions, see.usageDates) : null;
  const maxDay = fiveDays ? Math.max(...fiveDays.daily.map(d => d.seconds), 1) : 1;
  const ratio = review && review.task_estimated_seconds > 0 ? review.actual_seconds / review.task_estimated_seconds : null;
  const loadingText = <p className="mini-sub">기록을 불러오는 중…</p>;

  return <>
    {activeLog ? <RunningHero log={activeLog} task={activeTask} /> : null}
    <div className="bento">
      <article className="card bento-card today-ring" aria-labelledby="today-ring-title">
        <div className="bento-head"><h2 id="today-ring-title"><span className="bento-icon"><Icon name="target" /></span>오늘의 진행</h2><span className="basis-chip">선택한 계획</span></div>
        {!plan ? <div className="bento-empty"><Bloom className="bloom-empty" /><p><strong>{loading ? '계획을 불러오는 중…' : plansCount ? '계획을 선택해 주세요.' : '아직 계획이 없어요.'}</strong></p><p className="muted small">계획을 고르면 오늘 할 일의 진행률을 보여 드려요.</p><a className="btn btn-soft btn-sm" href="#plans">내 계획으로 이동<Icon name="chevron" /></a></div>
          : query ? <div className="bento-empty"><Bloom className="bloom-empty" /><p><strong>할 일 목록에 검색·필터가 적용되어 있어요.</strong></p><p className="muted small">일부 결과만으로 진행률을 계산하지 않습니다. 필터를 초기화하면 다시 표시됩니다.</p></div>
            : <div className="ring-layout">
              <Ring ratio={todayTasks.length ? doneToday / todayTasks.length : 0} size={232} stroke={14} className="ring-hero"><Bloom /></Ring>
              <div className="ring-legend">
                <p className="ring-number">{percent}<small>%</small></p>
                <p className="ring-caption">{todayTasks.length ? `오늘 할 일 ${todayTasks.length}개 중 ${doneToday}개 완료` : '오늘 마감이거나 오늘 완료한 할 일이 없어요.'}</p>
                <p className="bento-plan-name"><span className="preserve">{plan.title}</span>{phase ? <span className={`phase phase-${phase.tone}`}>{phase.label}</span> : null}</p>
              </div>
            </div>}
      </article>

      <article className="card bento-card today-list" aria-labelledby="today-list-title">
        <div className="bento-head"><h2 id="today-list-title"><span className="bento-icon mint"><Icon name="list" /></span>오늘의 할 일</h2><span className="bento-head-side"><span className="basis-chip">선택한 계획</span>{plan && !query ? <span className="count-pill">{doneToday}/{todayTasks.length}<span className="sr-only"> 완료</span></span> : null}</span></div>
        {!plan ? <p className="muted small">계획을 선택하면 오늘 마감·기한 지남·실행 중·오늘 완료한 할 일을 모아 보여 드려요.</p>
          : query ? <p className="muted small">검색·필터가 적용되어 있어 오늘의 할 일을 만들지 않습니다.</p>
            : todayTasks.length ? <ul className="checklist">{todayTasks.slice(0, 7).map(t => {
              const run = running(t.id), done = t.status === 'completed', late = !done && !!t.due_date && t.due_date < today;
              return <li key={t.id}><a href={`#task-${t.id}`} className={`check-item${done ? ' is-done' : run ? ' is-running' : late ? ' is-late' : ''}`}>
                <span className="check-box" aria-hidden="true">{done ? <Icon name="check" /> : run ? <span className="live-dot" /> : null}</span>
                <span className="check-text preserve">{t.content}</span>
                <span className="check-tag"><span className="sr-only">상태: </span>{done ? '오늘 완료' : run ? '실행 중' : late ? '기한 지남' : '오늘 마감'}</span>
              </a></li>;
            })}</ul>
              : <div className="bento-empty compact"><p><strong>오늘 챙길 할 일이 없어요.</strong></p><p className="muted small">마감일을 오늘로 정하거나 할 일을 시작해 보세요.</p></div>}
        {plan && !query && todayTasks.length > 7 ? <p className="muted small">외 {todayTasks.length - 7}개는 할 일 목록에서 확인하세요.</p> : null}
        <p className="bento-foot">한국 날짜 {today} 기준 · 실행 중, 마감일이 오늘이거나 지난 미완료, 오늘 완료한 할 일 · 마감일이 없는 미완료 할 일은 ‘오늘’에 속하는지 정할 수 없어 제외해요(할 일 목록에서 확인).</p>
      </article>

      <article className="card bento-card five-tiles" aria-labelledby="five-tiles-title">
        <div className="bento-head"><h2 id="five-tiles-title"><span className="bento-icon pink"><Icon name="calendar" /></span>선택한 5일</h2>{review ? <span className="basis-chip scope">선택 범위 · {scopeLabel}</span> : null}</div>
        {fiveDays ? <>
          <ol className="day-tiles">{fiveDays.daily.map(d => {
            const h = d.seconds ? Math.max(4, d.seconds / maxDay * 40) : 0;
            return <li key={d.date} className={d.seconds ? 'has-time' : undefined}>
              <span className="day-tile-week">{weekdayOf.format(new Date(`${d.date}T00:00:00Z`))}</span>
              <span className="day-tile-date">{d.date.slice(5).replace('-', '.')}</span>
              <svg className="day-tile-bar" viewBox="0 0 10 40" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect className="track" width="10" height="40" rx="5" />{h ? <rect className="bar" y={40 - h} width="10" height={h} rx="5" /> : null}</svg>
              <span className="day-tile-value">{duration(d.seconds)}</span>
            </li>;
          })}</ol>
          <dl className="five-sum"><div><dt>5일 합계</dt><dd>{duration(fiveDays.total)}</dd></div><div><dt>일평균</dt><dd>{duration(fiveDays.average)}</dd></div></dl>
        </> : <div className="bento-empty compact"><p><strong>{review ? '날짜 5개가 아직 선택되지 않았어요.' : '기록을 불러오는 중…'}</strong></p><p className="muted small">돌아보기에서 실제로 사용한 서로 다른 날짜 5개를 고르면 날짜별 작업시간이 여기에 표시됩니다.</p><a className="btn btn-soft btn-sm" href="#see">날짜 선택하러 가기<Icon name="chevron" /></a></div>}
      </article>
    </div>

    <div className="metric-row-head"><h2>기록 한눈에 보기</h2><p className="muted small"><span className="basis-chip scope">선택 범위 · {scopeLabel}</span> 돌아보기의 ‘범위’에서 바꿀 수 있어요 · 종료된 실행만 · 한국 종료 날짜 기준</p></div>
    <div className="mini-cards">
      <article className="card mini-card">
        <div className="mini-head"><span className="bento-icon"><Icon name="clock" /></span><h3>오늘 실제 작업시간</h3><a className="mini-link" href="#see" aria-label="오늘 실제 작업시간 근거 보기"><Icon name="chevron" /></a></div>
        {todayWork ? <><p className="mini-number">{duration(todayWork.seconds)}</p><p className="mini-sub">{todayWork.count ? `오늘 종료한 실행 ${todayWork.count}건` : '오늘 종료한 실행이 아직 없어요.'}</p></> : loadingText}
      </article>
      <article className="card mini-card">
        <div className="mini-head"><span className="bento-icon blue"><Icon name="chart" /></span><h3>예상 vs 실제</h3><a className="mini-link" href="#see" aria-label="예상과 실제 시간 근거 보기"><Icon name="chevron" /></a></div>
        {review ? ratio !== null ? <div className="gauge-wrap">
          <Ring ratio={ratio} size={92} stroke={9} className={ratio > 1 ? 'ring-gauge is-over' : 'ring-gauge'}><span className="gauge-pct">{Math.round(ratio * 100)}<small>%</small></span></Ring>
          <dl className="gauge-legend"><div><dt>예상</dt><dd>{duration(review.task_estimated_seconds)}</dd></div><div><dt>실제</dt><dd>{duration(review.actual_seconds)}</dd></div></dl>
        </div> : <p className="mini-sub">할 일 예상 시간 합계가 0이라 비율을 계산하지 않아요.</p> : loadingText}
      </article>
      <article className="card mini-card">
        <div className="mini-head"><span className="bento-icon pink"><Icon name="sparkle" /></span><h3>연속 기록일</h3><a className="mini-link" href="#see" aria-label="연속 기록일 근거 보기"><Icon name="chevron" /></a></div>
        {streak ? <><p className="mini-number">{streak.count}<small>일</small></p><p className="mini-sub">{streak.count === 0 ? '실행을 완료하면 1일째가 시작돼요.' : streak.includesToday ? '오늘까지 매일 실행을 완료했어요.' : '어제까지 연속 · 오늘 완료하면 이어져요.'}</p></> : loadingText}
      </article>
      <article className="card mini-card">
        <div className="mini-head"><span className="bento-icon mint"><Icon name="check" /></span><h3>완료한 할 일</h3><a className="mini-link" href="#see" aria-label="완료한 할 일 근거 보기"><Icon name="chevron" /></a></div>
        {review ? <><p className="mini-number">{review.completed_count}<small>개</small></p><p className="mini-sub">{review.delayed_count ? `지연된 할 일 ${review.delayed_count}개` : '지연된 할 일 없음'}</p></> : loadingText}
      </article>
    </div>
  </>;
}
