import { useState, type FormEvent } from 'react';
import type { CopyInput, Task } from '../shared/types';

export default function CopyPlanForm({ tasks, busy, onCopy, onCancel }: { tasks: Task[]; busy: boolean; onCopy: (input: CopyInput) => Promise<boolean>; onCancel: () => void }) {
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!Object.keys(selected).length) { setError('완료한 할 일을 하나 이상 선택하세요.'); return; }
    setError('');
    const data = new FormData(event.currentTarget);
    void onCopy({
      plan: { title: String(data.get('title')), period_start: String(data.get('period_start')), period_end: String(data.get('period_end')), success_criteria: String(data.get('success_criteria')), estimated_seconds: Math.round(Number(data.get('minutes')) * 60) },
      tasks: Object.entries(selected).map(([task_id, date]) => ({ task_id, due_date: date || null })),
    });
  }
  return <section className="card form-card copy-panel" aria-label="다음 계획 복사 양식">
    <div className="card-head"><span className="stage-tag plan">NEXT PLAN</span><h2>완료한 일을 다음 계획으로</h2><p className="muted">새 계획과 새 할 일을 만들고 원본 연결을 남깁니다. 실행 기록은 복사하지 않습니다.</p></div>
    {error ? <p role="alert" className="banner banner-error">{error}</p> : null}
    <form onSubmit={submit}><fieldset disabled={busy}>
      <label className="field">다음 계획 제목<input name="title" required maxLength={200} /></label>
      <div className="form-row"><label className="field">다음 계획 시작일<input name="period_start" type="date" required /></label><label className="field">다음 계획 종료일<input name="period_end" type="date" required /></label></div>
      <label className="field">다음 계획 성공 기준<textarea aria-label="다음 계획 성공 기준" name="success_criteria" required maxLength={4000} rows={2} /></label>
      <label className="field field-narrow">다음 계획 자체 예상 시간 (분)<input name="minutes" type="number" inputMode="decimal" required min={0} max={525600} step="0.1" defaultValue="0" /></label>
      <h3 className="copy-title">복사할 완료한 할 일 <span className="count-pill">{Object.keys(selected).length} / {tasks.length}</span></h3>
      <div className="copy-list">{tasks.map(t => <div key={t.id} className={t.id in selected ? 'copy-source checked' : 'copy-source'}>
        <label className="check-label"><input type="checkbox" aria-label={`복사 선택: ${t.content}`} checked={t.id in selected} onChange={e => setSelected(previous => { const next = { ...previous }; if (e.target.checked) next[t.id] = t.due_date ?? ''; else delete next[t.id]; return next; })} /><span className="preserve">{t.content}</span></label>
        {t.id in selected ? <label className="field copy-due">새 마감일<input aria-label={`새 마감일: ${t.content}`} type="date" value={selected[t.id]} onChange={e => setSelected(previous => ({ ...previous, [t.id]: e.target.value }))} /></label> : null}
      </div>)}</div>
      {!tasks.length ? <p className="muted">복사할 완료한 할 일이 없습니다.</p> : null}
      <div className="actions"><button type="submit" className="btn btn-primary" disabled={!tasks.length}>다음 계획 생성 및 복사</button><button type="button" className="btn btn-ghost" onClick={onCancel}>복사 취소</button></div>
    </fieldset></form>
  </section>;
}
