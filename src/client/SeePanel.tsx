import { useEffect, useRef, useState } from 'react';
import type { Review, Task } from '../shared/types';
import { api } from './api';
import { fiveDaySummary } from './five-day-summary';
import { Icon, type IconName } from './ui';
import type { SeeSnapshot } from './Dashboard';

const duration = (seconds: number) => `${seconds}초 (${Number((seconds / 60).toFixed(2))}분)`;
function TaskEvidence({ tasks }: { tasks: Task[] }) {
  return tasks.length ? <ul>{tasks.map(t => <li key={t.id} className="preserve">{t.content}{t.deleted_at ? ' · 삭제 보존 기록' : ''} · 예상 {duration(t.estimated_seconds)} · 마감 {t.due_date ?? '미지정'}<small className="id"> {t.id}</small></li>)}</ul> : <p>해당 기록이 없습니다.</p>;
}
export default function SeePanel({ selected, refresh, onError, onSnapshot }: { selected: string | null; refresh: number; onError: (message: string) => void; onSnapshot?: (snapshot: SeeSnapshot) => void }) {
  const [scope, setScope] = useState<'all' | 'selected'>('all');
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true);
  const [usageDates, setUsageDates] = useState(['', '', '', '', '']);
  const evidenceDetails = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true);
    const query = scope === 'selected' && selected ? `?plan_id=${selected}` : '';
    api<Review>(`/review${query}`, { signal: controller.signal }).then(setReview)
      .catch(error => { if (!controller.signal.aborted) onError((error as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selected, scope, refresh, onError]);
  // Read-only mirror for the dashboard: the same review response and selected dates, no extra request.
  useEffect(() => { onSnapshot?.({ review, scope: scope === 'selected' && selected ? 'selected' : 'all', usageDates }); }, [onSnapshot, review, scope, selected, usageDates]);
  const labels = review ? [
    ['계획 수', String(review.plan_count), 'plans'],
    ['완료한 할 일 수', String(review.completed_count), 'completed'],
    ['지연된 할 일 수', String(review.delayed_count), 'delayed'],
    ['할 일 예상 시간 합계', duration(review.task_estimated_seconds), 'estimated'],
    ['실제 실행 시간 합계', duration(review.actual_seconds), 'actual'],
    ['실제 − 예상 시간 차이', duration(review.difference_seconds), 'difference'],
  ] : [];
  const fiveDays = review ? fiveDaySummary(review.evidence.closed_executions, usageDates) : null;
  const metricIcons: Record<string, IconName> = { plans: 'layers', completed: 'check', delayed: 'alert', estimated: 'clock', actual: 'play', difference: 'chart' };
  const openEvidence = () => { if (evidenceDetails.current) evidenceDetails.current.open = true; };
  const maxDay = fiveDays ? Math.max(...fiveDays.daily.map(day => day.seconds), 1) : 1;
  const compareMax = review ? Math.max(review.task_estimated_seconds, review.actual_seconds, 1) : 1;
  return <section className="card see-panel" id="see" aria-label="돌아보기">
    <div className="section-head"><div><span className="stage-tag see">SEE</span><h2>돌아보기</h2></div><label className="field scope-label">범위<select aria-label="돌아보기 범위" value={scope} onChange={e => setScope(e.target.value as 'all' | 'selected')}><option value="all">전체 계획</option><option value="selected" disabled={!selected}>선택한 계획</option></select></label></div>
    <p className="muted">서버 DB 기록을 집계합니다. 삭제 후 보존된 할 일도 포함하며, 목록 검색 조건은 집계에 영향을 주지 않습니다.</p>
    {loading ? <div className="metrics" aria-busy="true"><p role="status" className="sr-only">돌아보기 데이터를 불러오는 중…</p>{[0, 1, 2, 3, 4, 5].map(i => <span key={i} className="skeleton metric-skeleton" />)}</div> : null}
    {review && !loading ? <>
      <div className="metrics">{labels.map(([label, value, key]) => <a key={key} href={`#evidence-${key}`} onClick={openEvidence} className="metric" data-testid={`metric-${key}`} data-key={key} data-tone={key === 'difference' ? (review.difference_seconds > 0 ? 'over' : review.difference_seconds < 0 ? 'under' : 'even') : undefined}>
        <span className="metric-label"><Icon name={metricIcons[key]} />{label}</span><strong>{value}</strong>
        {key === 'difference' ? <em className="metric-hint">{review.difference_seconds > 0 ? '예상보다 더 걸림' : review.difference_seconds < 0 ? '예상보다 덜 걸림' : '예상과 같음'}</em> : <em className="metric-hint">근거 보기</em>}
      </a>)}</div>
      <div className="see-insights"><div className="compare" aria-hidden="true"><p className="compare-title">할 일 예상 시간 vs 실제 실행 시간</p>
        <div className="compare-row estimate"><span>예상</span><svg viewBox="0 0 100 10" preserveAspectRatio="none"><rect className="track" width="100" height="10" rx="2" /><rect className="bar" width={review.task_estimated_seconds / compareMax * 100} height="10" rx="2" /></svg><b>{Number((review.task_estimated_seconds / 60).toFixed(1))}분</b></div>
        <div className="compare-row actual"><span>실제</span><svg viewBox="0 0 100 10" preserveAspectRatio="none"><rect className="track" width="100" height="10" rx="2" /><rect className="bar" width={review.actual_seconds / compareMax * 100} height="10" rx="2" /></svg><b>{Number((review.actual_seconds / 60).toFixed(1))}분</b></div>
      </div>
      <div className="see-notes">
        <p>계획 자체의 예상 시간 합계: <strong data-testid="plan-estimate">{duration(review.plan_estimated_seconds)}</strong><br /><small className="muted">차이는 할 일 예상 시간 합계를 기준으로 계산합니다. 진행 중 실행 시간은 실제 시간 합계에서 제외합니다.</small></p>
        <p className="muted">지연 기준: 한국 날짜 {review.today}. 마감일 당일은 지연이 아니며, 완료 기록은 한국 완료 날짜로 판단합니다.</p>
      </div></div>
      <section className="five-day" aria-label="선택한 5일 작업시간 합계·평균">
        <h3><Icon name="calendar" />선택한 5일 작업시간 합계·평균</h3>
        <p>실제로 사용한 서로 다른 한국 날짜 5개를 직접 선택하세요. 날짜 선택은 사용 기록을 생성하지 않습니다.</p>
        <div className="day-inputs">{usageDates.map((date, index) => <label key={index} className="field">Day {index + 1}<input type="date" value={date} onChange={event => setUsageDates(current => current.map((value, i) => i === index ? event.target.value : value))} /></label>)}</div>
        <p className="muted small">선택 범위의 종료된 실행만 포함합니다. 한국 종료 날짜에 저장된 실제 초를 전부 귀속하며, 자정을 넘긴 실행도 같은 규칙을 씁니다. 기록 없는 날짜는 0초, 평균은 합계 ÷ 5일입니다. 진행 중 실행은 제외합니다.</p>
        {fiveDays ? <div className="five-day-result">
          <ul className="day-bars">{fiveDays.daily.map(day => <li key={day.date}><span className="day-date" aria-hidden="true">{day.date.slice(5).replace('-', '.')}</span><svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><rect className="track" width="100" height="10" rx="2" /><rect className="bar" width={day.seconds / maxDay * 100} height="10" rx="2" /></svg><span className="day-value"><span className="sr-only">{day.date}: </span>{duration(day.seconds)}</span></li>)}</ul>
          <div className="five-day-stats"><p data-testid="five-day-total">5일 합계: {duration(fiveDays.total)}</p><p data-testid="five-day-average">일평균: {duration(fiveDays.average)}</p></div>
        </div> : <p className="five-day-empty">서로 다른 유효한 날짜 5개를 선택하면 합계와 평균이 표시됩니다.</p>}
      </section>
      <details ref={evidenceDetails} className="evidence"><summary>집계 근거 기록 보기</summary>
        <div id="evidence-plans"><h3>계획 수 근거</h3><ul>{review.evidence.plans.map(p => <li key={p.id} className="preserve">{p.title} · 계획 예상 {duration(p.estimated_seconds)}<small className="id"> {p.id}</small></li>)}</ul></div>
        <div id="evidence-completed"><h3>완료한 할 일</h3><TaskEvidence tasks={review.evidence.completed_tasks} /></div>
        <div id="evidence-delayed"><h3>지연된 할 일</h3><TaskEvidence tasks={review.evidence.delayed_tasks} /></div>
        <div id="evidence-estimated"><h3>할 일 예상 시간 근거</h3><TaskEvidence tasks={review.evidence.tasks} /></div>
        <div id="evidence-actual"><h3>종료된 실행 기록</h3>{review.evidence.closed_executions.length ? <ul>{review.evidence.closed_executions.map(log => <li key={log.id}>할 일 <code>{log.task_id}</code> · 실제 {log.actual_seconds}초<br /><span className="id">{log.started_at} → {log.ended_at} · 실행 {log.id}</span></li>)}</ul> : <p>종료된 실행 기록이 없습니다.</p>}</div>
        <div id="evidence-difference"><h3>차이 계산</h3><p>{review.actual_seconds} − {review.task_estimated_seconds} = {review.difference_seconds}초</p></div>
        <p className="muted">진행 중 실행 {review.evidence.active_executions.length}개 · 집계 시각 {review.as_of}</p>
      </details>
    </> : null}
  </section>;
}
