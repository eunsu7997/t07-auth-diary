import { useState, type FormEvent } from 'react';
import { Icon } from './ui';

export default function AccountDeletionForm({ onDeleted }: { onDeleted: () => void }) {
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!confirmed || busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/account/delete', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (response.ok) onDeleted();
      else setError(response.status === 400 ? '현재 비밀번호를 확인하세요.' : '계정을 삭제하지 못했습니다. 로그인 상태를 확인하고 다시 시도하세요.');
    } catch { setError('삭제 결과를 확인하지 못했습니다. 로그인 상태를 다시 확인하세요.'); }
    finally { setPassword(''); setBusy(false); }
  }
  return <section className="danger-zone" aria-label="계정 삭제">
    <div className="danger-head"><Icon name="alert" /><h2>계정 삭제</h2></div>
    <p>내 계정을 삭제하면 내 계획·할 일·계획 버전·실행 기록과 계정 자료가 함께 삭제되며 복구할 수 없습니다. 모든 로그인 세션도 무효화됩니다.</p>
    <p className="muted">삭제 전에 화면 상단의 “전체 JSON 다운로드”로 내 자료를 파일 하나에 보관하는 것을 권장합니다. 로그아웃만으로는 자료가 삭제되지 않습니다.</p>
    <form onSubmit={submit}><fieldset disabled={busy}>
      <label className="field field-narrow">삭제 확인용 현재 비밀번호<input type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={e => setPassword(e.target.value)} /></label>
      <label className="check-label"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>내 자료가 함께 삭제되고 복구할 수 없음을 확인했습니다.</span></label>
      <div className="actions"><button type="submit" className="btn btn-danger" disabled={!confirmed}><Icon name="trash" />{busy ? '삭제 중…' : '계정과 내 자료 영구 삭제'}</button></div>
    </fieldset></form>{error ? <p role="alert" className="banner banner-error">{error}</p> : null}
  </section>;
}
