import { useEffect, useState } from 'react';
import type { ExecutionLog, Task } from '../shared/types';
import { clock } from './ui';

// Display-only banner for an open execution. Start/finish stay in ExecutionControls.
export default function LiveBar({ log, task }: { log: ExecutionLog; task?: Task }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [log.id]);
  const elapsed = Math.max(0, Math.floor((now - Date.parse(log.started_at)) / 1000));
  useEffect(() => {
    const original = document.title;
    return () => { document.title = original; };
  }, []);
  useEffect(() => { document.title = `● ${clock(elapsed)} 실행 중 · 플랜두씨 다이어리`; }, [elapsed]);
  return <div className="live-bar" role="region" aria-label="실행 중인 할 일">
    <div className="live-bar-inner">
      <span className="live-dot" aria-hidden="true" />
      <span className="live-label">실행 중</span>
      <span className="live-task preserve">{task?.content ?? '선택한 계획의 할 일'}</span>
      <span className="live-clock" role="timer">{clock(elapsed)}</span>
      {task ? <a className="live-link" href={`#task-${task.id}`}>할 일로 이동</a> : null}
    </div>
  </div>;
}
