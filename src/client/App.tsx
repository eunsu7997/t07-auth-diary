import { useEffect, useState, useRef, type FormEvent, type ReactNode } from 'react';
import type { Plan, PlanInput, PlanVersion, Task, TaskInput, ExecutionLog, Review } from '../shared/types';
import { api } from './api';
import ExecutionControls from './ExecutionControls';
import SeePanel from './SeePanel';
import CopyPlanForm from './CopyPlanForm';
import LiveBar from './LiveBar';
import Dashboard, { type SeeSnapshot } from './Dashboard';
import { formatDuration } from './time-format';
import { BrandMark, Icon, planPhase, seoulToday, type IconName } from './ui';

const priorities = { high: '높음', medium: '보통', low: '낮음' };
const timestamp = (value: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
function reveal(element: HTMLElement | null, focus: HTMLElement | null) {
  element?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
  focus?.focus({ preventScroll: true });
}

const sections: { id: string; label: string; short: string; icon: IconName }[] = [
  { id: 'dashboard', label: '대시보드', short: '홈', icon: 'home' },
  { id: 'plans', label: '내 계획', short: '계획', icon: 'layers' },
  { id: 'do', label: '할 일', short: '할 일', icon: 'list' },
  { id: 'see', label: '돌아보기', short: '돌아보기', icon: 'chart' },
  { id: 'account', label: '계정 관리', short: '계정', icon: 'user' },
];
const longDate = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
const seoulHour = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hourCycle: 'h23' });
function greeting(now = new Date()) {
  const hour = Number(seoulHour.format(now));
  return hour >= 5 && hour < 11 ? '좋은 아침이에요' : hour >= 11 && hour < 17 ? '좋은 오후예요' : hour >= 17 && hour < 22 ? '좋은 저녁이에요' : '편안한 밤 보내세요';
}

/** Highlights the navigation entry for the section in view. Display only. */
function useActiveSection() {
  const [active, setActive] = useState('dashboard');
  useEffect(() => {
    if (typeof IntersectionObserver !== 'function') return;
    const tops = new Map<string, number>();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) tops.set(entry.target.id, entry.isIntersecting ? entry.boundingClientRect.top : Infinity);
      const inView = sections.map(s => s.id).filter(id => (tops.get(id) ?? Infinity) !== Infinity);
      if (inView.length) setActive(inView[0]);
    }, { rootMargin: '-20% 0px -55% 0px' });
    const observe = () => sections.forEach(s => { const el = document.getElementById(s.id); if (el) observer.observe(el); });
    observe();
    const timer = setTimeout(observe, 1000);
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, []);
  return active;
}

function PlanForm({ initial, busy, onSave, onCancel }: {
  initial?: Plan; busy: boolean; onSave: (input: PlanInput) => Promise<boolean>; onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [start, setStart] = useState(initial?.period_start ?? '');
  const [end, setEnd] = useState(initial?.period_end ?? '');
  const [criteria, setCriteria] = useState(initial?.success_criteria ?? '');
  const [minutes, setMinutes] = useState(String((initial?.estimated_seconds ?? 0) / 60));
  const section = useRef<HTMLElement>(null);
  const firstField = useRef<HTMLInputElement>(null);
  useEffect(() => reveal(section.current, firstField.current), []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSave({ title, period_start: start, period_end: end, success_criteria: criteria, estimated_seconds: Math.round(Number(minutes) * 60) });
  }
  return <section ref={section} className="card form-card plan-form" aria-label={initial ? '계획 수정 양식' : '새 계획 양식'}>
    <div className="card-head">
      <span className="stage-tag plan">PLAN</span>
      <h2>{initial ? '계획 수정' : '내 첫 계획부터 시작하기'}</h2>
      <p className="muted">{initial ? '저장하면 이전 내용은 수정 이력에 그대로 남습니다.' : '직접 세운 계획을 입력하세요. 예시 데이터는 자동 생성하지 않습니다.'}</p>
    </div>
    <form onSubmit={submit}>
      <fieldset disabled={busy}>
        <label className="field">계획 제목<input ref={firstField} required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} /></label>
        <div className="form-row">
          <label className="field">시작일<input type="date" required value={start} onChange={e => setStart(e.target.value)} /></label>
          <label className="field">종료일<input type="date" required min={start || undefined} value={end} onChange={e => setEnd(e.target.value)} /></label>
        </div>
        <label className="field">성공 기준<textarea aria-label="성공 기준" required maxLength={4000} rows={3} value={criteria} onChange={e => setCriteria(e.target.value)} /></label>
        <label className="field field-narrow">계획 예상 시간 (분)<input type="number" inputMode="decimal" required min={0} max={525600} step="0.1" value={minutes} onChange={e => setMinutes(e.target.value)} /></label>
        <div className="actions"><button className="btn btn-primary" type="submit">{busy ? '저장 중…' : initial ? '수정 저장' : '계획 생성'}</button><button className="btn btn-ghost" type="button" onClick={onCancel}>취소</button></div>
      </fieldset>
    </form>
  </section>;
}

function TaskForm({ initial, busy, onSave, onCancel }: {
  initial?: Task; busy: boolean; onSave: (input: TaskInput) => Promise<boolean>; onCancel: () => void;
}) {
  const [content, setContent] = useState(initial?.content ?? '');
  const [priority, setPriority] = useState<TaskInput['priority']>(initial?.priority ?? 'medium');
  const [tags, setTags] = useState(initial?.tags.map(t => t.name).join(', ') ?? '');
  const [due, setDue] = useState(initial?.due_date ?? '');
  const [minutes, setMinutes] = useState(String((initial?.estimated_seconds ?? 0) / 60));
  const section = useRef<HTMLElement>(null);
  const firstField = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (initial) reveal(section.current, firstField.current); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const saved = await onSave({ content, priority, tags: tags.split(',').map(t => t.trim()).filter(Boolean), due_date: due || null, estimated_seconds: Math.round(Number(minutes) * 60) });
    if (saved && !initial) { setContent(''); setTags(''); setDue(''); setMinutes('0'); setPriority('medium'); }
  }
  return <section ref={section} className={`card form-card task-form${initial ? ' editing' : ''}`} aria-label={initial ? '할 일 수정 양식' : '할 일 추가 양식'}>
    <h3 className="form-title"><Icon name={initial ? 'edit' : 'plus'} />{initial ? '할 일 수정' : '할 일 추가'}</h3>
    <form onSubmit={submit}>
      <fieldset disabled={busy}>
        <label className="field">할 일 내용<textarea ref={firstField} aria-label="할 일 내용" required rows={2} maxLength={2000} value={content} onChange={e => setContent(e.target.value)} placeholder="무엇을 실행할까요?" /></label>
        <div className="form-grid">
          <label className="field">우선순위<select aria-label="우선순위" value={priority} onChange={e => setPriority(e.target.value as TaskInput['priority'])}>{Object.entries(priorities).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
          <label className="field">마감일<input type="date" value={due} onChange={e => setDue(e.target.value)} /></label>
          <label className="field">할 일 예상 시간 (분)<input type="number" inputMode="decimal" required min={0} max={525600} step="0.1" value={minutes} onChange={e => setMinutes(e.target.value)} /></label>
          <label className="field">태그 (쉼표로 구분)<input maxLength={820} value={tags} onChange={e => setTags(e.target.value)} placeholder="학습, 준비" /></label>
        </div>
        <div className="actions"><button className="btn btn-primary" type="submit">{busy ? '저장 중…' : initial ? '할 일 수정 저장' : '할 일 저장'}</button>{initial ? <button className="btn btn-ghost" type="button" onClick={onCancel}>수정 취소</button> : null}</div>
      </fieldset>
    </form>
  </section>;
}

function Filters({ disabled, onApply }: { disabled: boolean; onApply: (query: string) => void }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    for (const [key, value] of data) if (typeof value === 'string' && value) params.set(key, value);
    onApply(params.toString());
  }
  return <form className="filters" onSubmit={submit} aria-label="할 일 검색과 필터">
    <label className="field filter-search">내용 검색<span className="input-icon"><Icon name="search" /><input name="search" type="search" maxLength={200} placeholder="할 일 내용으로 찾기" /></span></label>
    <label className="field">태그 필터<input name="tag" maxLength={40} placeholder="태그 이름" /></label>
    <label className="field">우선순위 필터<select aria-label="우선순위 필터" name="priority"><option value="">전체</option>{Object.entries(priorities).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
    <label className="field">마감일 시작<input type="date" name="due_from" /></label>
    <label className="field">마감일 끝<input type="date" name="due_to" /></label>
    <label className="field">정렬<select aria-label="정렬" name="sort"><option value="created_desc">최근 작성순</option><option value="created_asc">작성순</option><option value="due_asc">마감일순</option><option value="priority">우선순위순</option><option value="estimated_asc">예상 시간순</option></select></label>
    <div className="actions filter-actions"><button className="btn btn-secondary" disabled={disabled}>적용</button><button className="btn btn-ghost" type="reset" disabled={disabled} onClick={() => onApply('')}>초기화</button></div>
  </form>;
}

export default function App({ accountControls, accountNotice, accountPanel, userName }: { accountControls?: ReactNode; accountNotice?: ReactNode; accountPanel?: ReactNode; userName?: string } = {}) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [versions, setVersions] = useState<PlanVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [planForm, setPlanForm] = useState<'new' | 'edit' | null>(null);
  const [editingTask, setEditingTask] = useState<Task | undefined>();
  const [query, setQuery] = useState('');
  const [executions, setExecutions] = useState<ExecutionLog[]>([]);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyTasks, setCopyTasks] = useState<Task[]>([]);
  const [see, setSee] = useState<SeeSnapshot | null>(null);
  const activeSection = useActiveSection();
  const mutationLock = useRef(false);
  const [heroVisible, setHeroVisible] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api<Plan[]>('/plans', { signal: controller.signal }).then(rows => {
      setPlans(rows);
      setSelected(previous => previous ?? rows[0]?.id ?? null);
    }).catch(e => { if (!controller.signal.aborted) setError((e as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setDetailLoading(true);
    Promise.all([
      api<Plan>(`/plans/${selected}`, { signal: controller.signal }),
      api<Task[]>(`/plans/${selected}/tasks?${query}`, { signal: controller.signal }),
      api<PlanVersion[]>(`/plans/${selected}/versions`, { signal: controller.signal }),
      api<ExecutionLog[]>(`/plans/${selected}/executions`, { signal: controller.signal }),
      api<Review>(`/review?plan_id=${selected}`, { signal: controller.signal }),
    ]).then(([p, t, v, e, r]) => { setPlan(p); setTasks(t); setVersions(v); setExecutions(e); setCopyTasks(r.evidence.completed_tasks.filter(task => !task.deleted_at)); })
      .catch(e => { if (!controller.signal.aborted) setError((e as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [selected, refresh, query]);

  // Notices are confirmations only; hide them after a few seconds (errors stay until the next action).
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function mutate(operation: () => Promise<void>, success: string) {
    if (mutationLock.current) return false;
    mutationLock.current = true;
    setBusy(true); setError(''); setNotice('');
    try { await operation(); setNotice(success); setRefresh(n => n + 1); return true; }
    catch (e) { setError((e as Error).message); return false; }
    finally { mutationLock.current = false; setBusy(false); }
  }
  async function download() {
    await mutate(async () => {
      const response = await fetch('/api/export', { cache: 'no-store' });
      if (response.status === 401) window.dispatchEvent(new Event('t07-session-expired'));
      if (!response.ok) throw new Error('전체 JSON 내보내기에 실패했습니다. 다시 시도하세요.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = 't07-diary.json';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, '전체 데이터를 JSON 파일 하나로 내보냈습니다.');
  }
  const pending = busy || detailLoading;
  const today = seoulToday();
  const activeLog = plan && plan.id === selected ? executions.find(log => log.ended_at === null) : undefined;
  const activeTask = activeLog ? tasks.find(t => t.id === activeLog.task_id) : undefined;
  const completedInList = tasks.filter(t => t.status === 'completed').length;
  const phase = plan ? planPhase(plan.period_start, plan.period_end, today) : null;

  const showDetail = !!plan && plan.id === selected;
  const isRunning = (id: string) => executions.some(log => log.task_id === id && log.ended_at === null);
  // While the dashboard's running card is on screen the slim live bar would repeat it; keep it mounted (tab title) but hidden.
  const activeId = activeLog?.id;
  useEffect(() => {
    setHeroVisible(false);
    const hero = activeId && typeof IntersectionObserver === 'function' ? document.querySelector('.running-hero') : null;
    if (!hero) return;
    const observer = new IntersectionObserver(([entry]) => setHeroVisible(entry.isIntersecting), { rootMargin: '-72px 0px 0px 0px' });
    observer.observe(hero);
    return () => observer.disconnect();
  }, [activeId]);
  // Header shortcut into the existing create flows: the task form when a plan is open, otherwise the plan form.
  function addTask() {
    if (!showDetail) { setPlanForm('new'); setEditingTask(undefined); return; }
    setEditingTask(undefined);
    requestAnimationFrame(() => reveal(document.querySelector<HTMLElement>('section[aria-label="할 일 추가 양식"]'), document.querySelector<HTMLElement>('section[aria-label="할 일 추가 양식"] textarea')));
  }
  const name = userName?.trim();
  const initial = name ? (Array.from(name)[0] ?? '').toUpperCase() : '';

  return <div className="app-shell">
    <a className="skip-link" href="#main">본문으로 건너뛰기</a>
    <aside className="side-nav" aria-label="앱 메뉴">
      <div className="brand">
        <BrandMark />
        <div className="brand-text"><p className="eyebrow">Plan · Do · See</p><h1>플랜두씨 다이어리</h1></div>
      </div>
      <nav className="side-links" aria-label="구역 이동">
        {sections.map(s => <a key={s.id} href={`#${s.id}`} className={activeSection === s.id ? 'side-link active' : 'side-link'} aria-current={activeSection === s.id ? 'location' : undefined}><Icon name={s.icon} /><span>{s.label}</span></a>)}
      </nav>
      <div className="side-card">
        <p className="side-card-title"><Icon name="sparkle" />기록하는 하루</p>
        <p>계획을 세우고, 실제 시간을 남기고, 예상과 실제를 비교해 보세요.</p>
      </div>
    </aside>
    <div className="app-body">
      <header className="topbar">
        <div className="greeting">
          <p className="today-line"><Icon name="sun" />{longDate.format(new Date())}</p>
          <p className="greeting-title">{greeting()}{name ? <>, <span className="greeting-name">{name}</span>님</> : null}</p>
          <p className="greeting-sub">{activeLog ? '실행 중인 작업이 있어요. 끝나면 할 일 카드에서 완료를 눌러 주세요.' : '오늘의 계획을 확인하고 한 가지씩 실행해 보세요.'}</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary btn-add" disabled={busy} onClick={addTask}><Icon name="plus" />{showDetail ? '새 할 일 추가' : '새 계획 만들기'}</button>
          <button className="btn btn-secondary btn-download" title="전체 JSON 다운로드" disabled={busy} onClick={() => void download()}><Icon name="download" /><span className="collapse-sm">전체 JSON 다운로드</span><span className="show-sm" aria-hidden="true">JSON</span></button>
          <a className="account-link" href="#account" aria-label="계정 관리">{initial ? <span className="avatar" aria-hidden="true">{initial}</span> : <Icon name="user" />}</a>
          {accountControls}
        </div>
      </header>
      {activeLog ? <div className={heroVisible ? 'live-bar-slot is-hidden' : 'live-bar-slot'}><LiveBar log={activeLog} task={activeTask} /></div> : null}
      <main id="main" className="app-main" tabIndex={-1}>
        {accountNotice}
        {error ? <div role="alert" className="banner banner-error"><Icon name="alert" /><span className="banner-text">{error}</span><button className="btn btn-sm btn-secondary" onClick={() => setRefresh(n => n + 1)}>다시 불러오기</button></div> : null}
        <div className="toast-region" role="status" aria-live="polite">{notice ? <div className="toast"><Icon name="check" /><span className="notice">{notice}</span><button className="icon-btn" aria-label="알림 닫기" onClick={() => setNotice('')}><Icon name="x" /></button></div> : null}</div>

        <section id="dashboard" className="zone dashboard" aria-label="대시보드">
          <Dashboard plan={showDetail ? plan : null} plansCount={plans.length} loading={loading || detailLoading} tasks={tasks} executions={executions} activeLog={activeLog} activeTask={activeTask} query={query} today={today} see={see} />
          <p className="privacy"><Icon name="shield" />이름·연락처·비밀번호·API 키 등 개인정보와 민감정보를 다이어리 내용에 입력하지 마세요.</p>
        </section>

        <section id="plans" className="zone zone-plan" aria-label="계획">
          <div className="plan-layout">
            <aside className="card plan-list-card" aria-label="계획 목록">
              <div className="sidebar-head"><span className="stage-tag plan">PLAN</span><h2>내 계획</h2>{plans.length ? <span className="count-pill">{plans.length}</span> : null}<button className="btn btn-primary btn-sm" disabled={busy} onClick={() => { setPlanForm('new'); setEditingTask(undefined); }}><Icon name="plus" />새 계획</button></div>
              {loading ? <div className="skeleton-list" aria-busy="true"><p className="sr-only">계획을 불러오는 중…</p><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div>
                : plans.length ? <ul className="plan-list">{plans.map(p => {
                  const ph = planPhase(p.period_start, p.period_end, today);
                  const isSelected = selected === p.id;
                  return <li key={p.id}><button className={isSelected ? 'plan-item selected' : 'plan-item'} aria-current={isSelected ? 'true' : undefined} disabled={busy} onClick={() => { setSelected(p.id); setPlanForm(null); setCopyOpen(false); setEditingTask(undefined); setQuery(''); }}>
                    <strong>{p.title}</strong><span>{p.period_start} ~ {p.period_end}</span>
                    <span className="plan-item-foot"><small>버전 {p.current_version}</small><em className={`phase phase-${ph.tone}`}>{ph.label}</em></span>
                  </button></li>;
                })}</ul>
                  : <p className="sidebar-empty">아직 계획이 없습니다.<br />새 계획을 직접 작성하세요.</p>}
            </aside>
            <div className="plan-main">
              {planForm ? <PlanForm key={planForm === 'new' ? 'new' : `${plan?.id}-${plan?.current_version}`} initial={planForm === 'edit' ? plan ?? undefined : undefined} busy={pending} onCancel={() => setPlanForm(null)} onSave={input => mutate(async () => {
                const saved = await api<Plan>(planForm === 'edit' && plan ? `/plans/${plan.id}` : '/plans', { method: planForm === 'edit' ? 'PUT' : 'POST', body: JSON.stringify(planForm === 'edit' && plan ? { ...input, expected_version: plan.current_version } : input) });
                setSelected(saved.id); setQuery(''); setPlanForm(null);
              }, planForm === 'edit' ? '수정 내용과 이전 버전을 저장했습니다.' : '새 계획을 서버 DB에 저장했습니다.')} /> : null}
              {!selected && !planForm && !loading ? <section className="card empty-hero">
                <span className="empty-orb lavender" aria-hidden="true"><Icon name="sparkle" /></span>
                <h2>작은 계획 하나부터.</h2><p>제목, 기간, 성공 기준을 적고 할 일을 하나씩 추가해 보세요.</p>
                <ol className="steps">
                  <li className="plan"><span>1</span><div><strong>Plan</strong>기간과 성공 기준이 있는 계획 세우기</div></li>
                  <li className="do"><span>2</span><div><strong>Do</strong>할 일을 시작·완료하며 실제 시간 기록</div></li>
                  <li className="see"><span>3</span><div><strong>See</strong>예상과 실제를 비교하며 돌아보기</div></li>
                </ol>
                <button className="btn btn-primary btn-lg" onClick={() => setPlanForm('new')}><Icon name="plus" />새 계획 작성</button>
              </section> : null}
              {detailLoading ? <p role="status" className="loading-line"><span className="spinner" aria-hidden="true" />계획과 할 일을 DB에서 불러오는 중…</p> : null}
              {showDetail ? <section className="card plan-detail" id="plan" aria-label="선택한 계획">
                <div className="plan-top">
                  <div className="plan-kicker"><span className="stage-tag plan">PLAN</span>{phase ? <span className={`phase phase-${phase.tone}`}>{phase.label}</span> : null}</div>
                  <div className="plan-tools"><button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setPlanForm('edit')}><Icon name="edit" />계획 수정</button></div>
                </div>
                <h2>{plan.title}</h2>
                <p className="plan-period"><Icon name="calendar" />{plan.period_start} ~ {plan.period_end}{phase?.detail ? <span className="plan-period-detail">{phase.detail}</span> : null}</p>
                <p className="criteria-label"><Icon name="target" />성공 기준</p>
                <p className="preserve">{plan.success_criteria}</p>
                <dl className="plan-stats">
                  <div className="lavender"><dt><span className="bento-icon"><Icon name="clock" /></span>계획 예상 시간</dt><dd>{formatDuration(plan.estimated_seconds)}</dd></div>
                  <div className="blue"><dt><span className="bento-icon blue"><Icon name="layers" /></span>현재 버전</dt><dd>{plan.current_version}</dd></div>
                  <div className="mint"><dt><span className="bento-icon mint"><Icon name="check" /></span>완료한 할 일</dt><dd>{copyTasks.length}개</dd></div>
                </dl>
                <details className="history"><summary>수정 이력 ({versions.length}개 버전)</summary>
                  <ol className="timeline">{versions.map(v => <li key={v.version}><article className="version" data-testid={`version-${v.version}`}><h3>버전 {v.version}{v.version === 1 ? ' · 최초 계획' : ''}</h3><p className="muted">{timestamp(v.recorded_at)} · 한국 시간</p><strong className="preserve">{v.title}</strong><p>{v.period_start} ~ {v.period_end}</p><p className="preserve">{v.success_criteria}</p><p className="muted">계획 예상 시간: {formatDuration(v.estimated_seconds)}</p></article></li>)}</ol>
                </details>
                <div className="plan-foot">
                  <p className="id">계획 ID: <code>{plan.id}</code></p>
                  <button className="btn btn-ghost btn-sm" disabled={pending || !copyTasks.length} onClick={() => setCopyOpen(true)}><Icon name="copy" />완료한 일을 다음 계획으로 복사</button>
                </div>
              </section> : null}
              {showDetail && copyOpen ? <CopyPlanForm key={selected} tasks={copyTasks} busy={pending} onCancel={() => setCopyOpen(false)} onCopy={input => mutate(async () => {
                const result = await api<{ plan: Plan; tasks: Task[] }>(`/plans/${selected}/copy-completed`, { method: 'POST', body: JSON.stringify(input) });
                setSelected(result.plan.id); setQuery(''); setEditingTask(undefined); setCopyOpen(false); setPlanForm(null);
              }, '새 계획에 완료한 할 일을 복사했습니다. 원본과 실행 기록은 보존됩니다.')} /> : null}
            </div>
          </div>
        </section>

        <div id="do" className="zone zone-do">
          {showDetail ? <section className="do-section" aria-label="할 일 목록">
            <div className="section-head">
              <div className="section-title"><span className="stage-tag do">DO</span><h2>할 일 목록</h2><span className="basis-chip">선택한 계획</span></div>
              {!query && tasks.length ? <div className="progress-wrap"><span className="progress-text">완료 <strong>{completedInList}</strong> / {tasks.length}</span><progress aria-label="할 일 완료 비율" max={tasks.length} value={completedInList} /></div> : null}
            </div>
            <TaskForm key={editingTask ? `${editingTask.id}-${editingTask.updated_at}` : selected} initial={editingTask} busy={pending} onCancel={() => setEditingTask(undefined)} onSave={input => mutate(async () => {
              await api<Task>(editingTask ? `/tasks/${editingTask.id}` : `/plans/${selected}/tasks`, { method: editingTask ? 'PUT' : 'POST', body: JSON.stringify(input) });
              setEditingTask(undefined);
            }, editingTask ? '할 일을 수정했습니다.' : '할 일을 서버 DB에 저장했습니다.')} />
            <div className="card list-card">
              <Filters key={selected} disabled={pending} onApply={setQuery} />
              <p className="result-count">현재 조회 결과 {tasks.length}개{query ? <span className="filter-chip">필터 적용 중</span> : null}</p>
              {tasks.length ? <ul className="tasks">{tasks.map(t => {
                const running = isRunning(t.id);
                const overdue = t.status !== 'completed' && !!t.due_date && t.due_date < today;
                return <li key={t.id} id={`task-${t.id}`} data-testid="task-card" className="task-card" data-status={t.status} data-running={running ? 'true' : undefined} data-priority={t.priority}>
                  <div className="task-head">
                    <span className="task-state" aria-hidden="true">{t.status === 'completed' ? <Icon name="check" /> : running ? <span className="live-dot" /> : null}</span>
                    <h3 className="preserve">{t.content}</h3>
                    <span className={`priority ${t.priority}`}><Icon name="flag" /><span className="sr-only">우선순위 </span>{priorities[t.priority]}</span>
                  </div>
                  <ul className="task-meta">
                    <li className={`status-chip ${t.status === 'completed' ? 'done' : running ? 'is-running' : ''}`}>{t.status === 'completed' ? <Icon name="check" /> : running ? <span className="live-dot" aria-hidden="true" /> : <Icon name="circle" />}{t.status === 'completed' ? '완료' : '진행 중'}</li>
                    <li className={overdue ? 'overdue' : undefined}><Icon name="calendar" />마감일 {t.due_date ?? '미지정'}{overdue ? <strong> · 기한 지남</strong> : null}</li>
                    <li><Icon name="clock" />할 일 예상 시간 {formatDuration(t.estimated_seconds)}</li>
                  </ul>
                  {t.tags.length ? <div className="tags">{t.tags.map(tag => <span key={tag.id}>{tag.name}</span>)}</div> : null}
                  <ExecutionControls task={t} logs={executions.filter(log => log.task_id === t.id)} busy={pending} run={mutate} />
                  <div className="task-actions"><button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => setEditingTask(t)}><Icon name="edit" />수정</button><button className="btn btn-ghost btn-sm danger" disabled={pending || executions.some(log => log.task_id === t.id && log.ended_at === null)} onClick={() => { if (window.confirm('이 할 일을 목록에서 삭제할까요? 저장된 기록은 보존됩니다.')) void mutate(async () => { await api(`/tasks/${t.id}`, { method: 'DELETE' }); if (editingTask?.id === t.id) setEditingTask(undefined); }, '할 일을 목록에서 삭제했습니다.'); }}><Icon name="trash" />삭제</button></div>
                  <div className="task-ids"><p className="id">할 일 ID: <code>{t.id}</code></p>
                    {t.copied_from_task_id ? <p className="id">복사 원본 할 일: <code>{t.copied_from_task_id}</code></p> : null}</div>
                </li>;
              })}</ul> : <div className="empty-list"><span className="empty-orb blue" aria-hidden="true"><Icon name="list" /></span><p>할 일을 추가하거나 검색 조건을 변경하세요.</p></div>}
            </div>
          </section> : <section className="card zone-empty" aria-label="할 일 안내">
            <span className="empty-orb mint" aria-hidden="true"><Icon name="list" /></span>
            <p><strong>할 일</strong></p>
            <p className="muted">계획을 선택하거나 새로 만들면 할 일을 추가하고 실행 시간을 기록할 수 있어요.</p>
          </section>}
        </div>

        <SeePanel selected={selected} refresh={refresh} onError={setError} onSnapshot={setSee} />
        {accountPanel}
        <p className="stage-note"><Icon name="info" />실행의 시작·종료는 서버 시각으로 저장됩니다. 화면의 진행 중 경과 시간은 참고값이며 실제 시간은 완료 시 확정합니다. 계획과 실행 기록은 서버 DB에 저장됩니다.</p>
      </main>
      <footer className="app-footer">계획과 할 일은 서버 DB에 저장됩니다. · 날짜 기준 Asia/Seoul</footer>
    </div>
    <nav className="tabbar" aria-label="모바일 바로가기">
      {sections.filter(s => s.id !== 'account').map(s => <a key={s.id} href={`#${s.id}`} className={activeSection === s.id ? 'active' : undefined} aria-current={activeSection === s.id ? 'location' : undefined}><Icon name={s.icon} /><span>{s.short}</span></a>)}
    </nav>
  </div>;
}
