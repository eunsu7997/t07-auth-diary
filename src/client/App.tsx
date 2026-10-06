import { useEffect, useState, useRef, type FormEvent } from 'react';
import type { Plan, PlanInput, PlanVersion, Task, TaskInput, ExecutionLog, Review } from '../shared/types';
import { api } from './api';
import ExecutionControls from './ExecutionControls';
import SeePanel from './SeePanel';
import CopyPlanForm from './CopyPlanForm';

const priorities = { high: '높음', medium: '보통', low: '낮음' };
const time = (seconds: number) => `${Number((seconds / 60).toFixed(2))}분`;
const timestamp = (value: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

function PlanForm({ initial, busy, onSave, onCancel }: {
  initial?: Plan; busy: boolean; onSave: (input: PlanInput) => Promise<boolean>; onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [start, setStart] = useState(initial?.period_start ?? '');
  const [end, setEnd] = useState(initial?.period_end ?? '');
  const [criteria, setCriteria] = useState(initial?.success_criteria ?? '');
  const [minutes, setMinutes] = useState(String((initial?.estimated_seconds ?? 0) / 60));
  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSave({ title, period_start: start, period_end: end, success_criteria: criteria, estimated_seconds: Math.round(Number(minutes) * 60) });
  }
  return <section className="panel" aria-label={initial ? '계획 수정 양식' : '새 계획 양식'}>
    <h2>{initial ? '계획 수정' : '내 첫 계획부터 시작하기'}</h2>
    <p className="muted">{initial ? '저장하면 이전 내용은 수정 이력에 그대로 남습니다.' : '직접 세운 계획을 입력하세요. 예시 데이터는 자동 생성하지 않습니다.'}</p>
    <form onSubmit={submit}>
      <fieldset disabled={busy}>
        <label>계획 제목<input required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} /></label>
        <div className="form-row">
          <label>시작일<input type="date" required value={start} onChange={e => setStart(e.target.value)} /></label>
          <label>종료일<input type="date" required min={start || undefined} value={end} onChange={e => setEnd(e.target.value)} /></label>
        </div>
        <label>성공 기준<textarea aria-label="성공 기준" required maxLength={4000} rows={3} value={criteria} onChange={e => setCriteria(e.target.value)} /></label>
        <label>계획 예상 시간 (분)<input type="number" required min={0} max={525600} step="0.1" value={minutes} onChange={e => setMinutes(e.target.value)} /></label>
        <div className="actions"><button className="primary" type="submit">{busy ? '저장 중…' : initial ? '수정 저장' : '계획 생성'}</button><button type="button" onClick={onCancel}>취소</button></div>
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
  async function submit(event: FormEvent) {
    event.preventDefault();
    const saved = await onSave({ content, priority, tags: tags.split(',').map(t => t.trim()).filter(Boolean), due_date: due || null, estimated_seconds: Math.round(Number(minutes) * 60) });
    if (saved && !initial) { setContent(''); setTags(''); setDue(''); setMinutes('0'); setPriority('medium'); }
  }
  return <section className="panel" aria-label={initial ? '할 일 수정 양식' : '할 일 추가 양식'}>
    <h2>{initial ? '할 일 수정' : '할 일 추가'}</h2>
    <form onSubmit={submit}>
      <fieldset disabled={busy}>
        <label>할 일 내용<textarea aria-label="할 일 내용" required rows={2} maxLength={2000} value={content} onChange={e => setContent(e.target.value)} /></label>
        <div className="form-row">
          <label>우선순위<select aria-label="우선순위" value={priority} onChange={e => setPriority(e.target.value as TaskInput['priority'])}>{Object.entries(priorities).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
          <label>마감일<input type="date" value={due} onChange={e => setDue(e.target.value)} /></label>
        </div>
        <label>태그 (쉼표로 구분)<input maxLength={820} value={tags} onChange={e => setTags(e.target.value)} placeholder="학습, 준비" /></label>
        <label>할 일 예상 시간 (분)<input type="number" required min={0} max={525600} step="0.1" value={minutes} onChange={e => setMinutes(e.target.value)} /></label>
        <div className="actions"><button className="primary" type="submit">{busy ? '저장 중…' : initial ? '할 일 수정 저장' : '할 일 저장'}</button>{initial ? <button type="button" onClick={onCancel}>수정 취소</button> : null}</div>
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
    <label>내용 검색<input name="search" maxLength={200} /></label>
    <label>태그 필터<input name="tag" maxLength={40} /></label>
    <label>우선순위 필터<select aria-label="우선순위 필터" name="priority"><option value="">전체</option>{Object.entries(priorities).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
    <label>마감일 시작<input type="date" name="due_from" /></label>
    <label>마감일 끝<input type="date" name="due_to" /></label>
    <label>정렬<select aria-label="정렬" name="sort"><option value="created_desc">최근 작성순</option><option value="created_asc">작성순</option><option value="due_asc">마감일순</option><option value="priority">우선순위순</option><option value="estimated_asc">예상 시간순</option></select></label>
    <div className="actions"><button disabled={disabled}>적용</button><button type="reset" disabled={disabled} onClick={() => onApply('')}>초기화</button></div>
  </form>;
}

export default function App() {
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
  const mutationLock = useRef(false);

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
  return <>
    <header className="site-header"><div><p className="eyebrow">ALEPH STUDIO · T07</p><h1>플랜두씨 다이어리</h1><p>내 계획을 쓰고, 실제로 한 일을 이어갑니다.</p></div><div className="header-actions"><span className="stage">Plan → Do → See</span><button disabled={busy} onClick={() => void download()}>전체 JSON 다운로드</button></div></header>
    <main>
      <p className="privacy">이름·연락처·비밀번호·API 키 등 개인정보와 민감정보를 다이어리 내용에 입력하지 마세요.</p>
      {error ? <p role="alert" className="error">{error}<button onClick={() => setRefresh(n => n + 1)}>다시 불러오기</button></p> : null}
      {notice ? <p role="status" className="notice">{notice}</p> : null}
      <div className="workspace">
        <aside className="panel sidebar"><div className="section-title"><h2>내 계획</h2><button disabled={busy} onClick={() => { setPlanForm('new'); setEditingTask(undefined); }}>새 계획</button></div>
          {loading ? <p>계획을 불러오는 중…</p> : plans.length ? <ul className="plan-list">{plans.map(p => <li key={p.id}><button className={selected === p.id ? 'selected' : ''} disabled={busy} onClick={() => { setSelected(p.id); setPlanForm(null); setCopyOpen(false); setEditingTask(undefined); setQuery(''); }}><strong>{p.title}</strong><span>{p.period_start} ~ {p.period_end}</span><small>버전 {p.current_version}</small></button></li>)}</ul> : <p className="muted">아직 계획이 없습니다.<br />새 계획을 직접 작성하세요.</p>}
        </aside>
        <div className="content">
          {planForm ? <PlanForm key={planForm === 'new' ? 'new' : `${plan?.id}-${plan?.current_version}`} initial={planForm === 'edit' ? plan ?? undefined : undefined} busy={pending} onCancel={() => setPlanForm(null)} onSave={input => mutate(async () => {
            const saved = await api<Plan>(planForm === 'edit' && plan ? `/plans/${plan.id}` : '/plans', { method: planForm === 'edit' ? 'PUT' : 'POST', body: JSON.stringify(planForm === 'edit' && plan ? { ...input, expected_version: plan.current_version } : input) });
            setSelected(saved.id); setQuery(''); setPlanForm(null);
          }, planForm === 'edit' ? '수정 내용과 이전 버전을 저장했습니다.' : '새 계획을 서버 DB에 저장했습니다.')} /> : null}
          {!selected && !planForm && !loading ? <section className="panel empty"><h2>작은 계획 하나부터.</h2><p>제목, 기간, 성공 기준을 적고 할 일을 하나씩 추가해 보세요.</p><button className="primary" onClick={() => setPlanForm('new')}>새 계획 작성</button></section> : null}
          {detailLoading ? <p role="status">계획과 할 일을 DB에서 불러오는 중…</p> : null}
          {plan && plan.id === selected ? <>
            <section className="panel plan-detail"><div className="section-title"><h2>{plan.title}</h2><button disabled={busy} onClick={() => setPlanForm('edit')}>계획 수정</button></div>
              <p className="muted">{plan.period_start} ~ {plan.period_end}</p><p className="preserve">{plan.success_criteria}</p>
              <div className="plan-meta"><span>계획 예상 시간 <strong>{time(plan.estimated_seconds)}</strong></span><span>현재 버전 <strong>{plan.current_version}</strong></span></div>
              <p className="id">계획 ID: <code>{plan.id}</code></p>
              <details className="history"><summary>수정 이력 ({versions.length}개 버전)</summary>{versions.map(v => <article key={v.version} className="version" data-testid={`version-${v.version}`}><h3>버전 {v.version}{v.version === 1 ? ' · 최초 계획' : ''}</h3><p className="muted">{timestamp(v.recorded_at)} · 한국 시간</p><strong>{v.title}</strong><p>{v.period_start} ~ {v.period_end}</p><p className="preserve">{v.success_criteria}</p><p>계획 예상 시간: {time(v.estimated_seconds)}</p></article>)}</details>
              <div className="actions"><button disabled={pending || !copyTasks.length} onClick={() => setCopyOpen(true)}>완료한 일을 다음 계획으로 복사</button></div>
            </section>
            {copyOpen ? <CopyPlanForm key={selected} tasks={copyTasks} busy={pending} onCancel={() => setCopyOpen(false)} onCopy={input => mutate(async () => {
              const result = await api<{ plan: Plan; tasks: Task[] }>(`/plans/${selected}/copy-completed`, { method: 'POST', body: JSON.stringify(input) });
              setSelected(result.plan.id); setQuery(''); setEditingTask(undefined); setCopyOpen(false); setPlanForm(null);
            }, '새 계획에 완료한 할 일을 복사했습니다. 원본과 실행 기록은 보존됩니다.')} /> : null}
            <TaskForm key={editingTask ? `${editingTask.id}-${editingTask.updated_at}` : selected} initial={editingTask} busy={pending} onCancel={() => setEditingTask(undefined)} onSave={input => mutate(async () => {
              await api<Task>(editingTask ? `/tasks/${editingTask.id}` : `/plans/${selected}/tasks`, { method: editingTask ? 'PUT' : 'POST', body: JSON.stringify(input) });
              setEditingTask(undefined);
            }, editingTask ? '할 일을 수정했습니다.' : '할 일을 서버 DB에 저장했습니다.')} />
            <section className="panel"><h2>할 일 목록</h2><Filters key={selected} disabled={pending} onApply={setQuery} /><p className="muted">현재 조회 결과 {tasks.length}개{query ? ' · 필터 적용 중' : ''}</p>
              {tasks.length ? <ul className="tasks">{tasks.map(t => <li key={t.id} data-testid="task-card"><div className="section-title"><h3 className="preserve">{t.content}</h3><span className={`priority ${t.priority}`}>{priorities[t.priority]}</span></div><p className="muted">마감일 {t.due_date ?? '미지정'} · 할 일 예상 시간 {time(t.estimated_seconds)} · {t.status === 'completed' ? '완료' : '진행 중'}</p><div className="tags">{t.tags.map(tag => <span key={tag.id}>{tag.name}</span>)}</div><p className="id">할 일 ID: <code>{t.id}</code></p>
                {t.copied_from_task_id ? <p className="id">복사 원본 할 일: <code>{t.copied_from_task_id}</code></p> : null}
                <ExecutionControls task={t} logs={executions.filter(log => log.task_id === t.id)} busy={pending} run={mutate} />
                <div className="actions"><button disabled={pending} onClick={() => setEditingTask(t)}>수정</button><button className="danger" disabled={pending || executions.some(log => log.task_id === t.id && log.ended_at === null)} onClick={() => { if (window.confirm('이 할 일을 목록에서 삭제할까요? 저장된 기록은 보존됩니다.')) void mutate(async () => { await api(`/tasks/${t.id}`, { method: 'DELETE' }); if (editingTask?.id === t.id) setEditingTask(undefined); }, '할 일을 목록에서 삭제했습니다.'); }}>삭제</button></div>
              </li>)}</ul> : <p className="empty-list">할 일을 추가하거나 검색 조건을 변경하세요.</p>}
            </section>
          </> : null}
        </div>
      </div>
      <SeePanel selected={selected} refresh={refresh} onError={setError} />
      <p className="stage-note">실행의 시작·종료는 서버 시각으로 저장됩니다. 화면의 진행 중 경과 시간은 참고값이며 실제 시간은 완료 시 확정합니다. 계획과 실행 기록은 서버 DB에 저장됩니다.</p>
    </main><footer>계획과 할 일은 서버 DB에 저장됩니다. · 날짜 기준 Asia/Seoul</footer>
  </>;
}
