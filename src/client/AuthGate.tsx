import { useEffect, useRef, useState, type FormEvent } from 'react';
import App from './App';
import { authClient, LOGIN_FAILURE } from './auth-client';

type Identity = { user: { id: string; name: string; email: string }; expiresAt: string };
export default function AuthGate() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [loading, setLoading] = useState(true);
  const [signup, setSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const sessionGeneration = useRef(0);

  async function check() {
    const generation = ++sessionGeneration.current;
    try {
      const response = await fetch('/api/session', { cache: 'no-store', credentials: 'same-origin' });
      const data = response.ok ? await response.json() as Identity : null;
      if (generation !== sessionGeneration.current) return;
      if (response.ok) setIdentity(data);
      else { setIdentity(null); if (response.status !== 401) setError('세션 확인에 실패했습니다. 다시 시도하세요.'); }
    } catch { if (generation === sessionGeneration.current) { setIdentity(null); setError('서버 연결을 확인하세요.'); } }
    finally { if (generation === sessionGeneration.current) setLoading(false); }
  }
  useEffect(() => {
    void check();
    const timer = setInterval(() => void check(), 30_000);
    const expired = () => { ++sessionGeneration.current; setIdentity(null); setSignup(false); setPassword(''); setLoading(false); };
    const focus = () => void check();
    window.addEventListener('t07-session-expired', expired);
    window.addEventListener('focus', focus);
    return () => { clearInterval(timer); window.removeEventListener('t07-session-expired', expired); window.removeEventListener('focus', focus); };
  }, []);
  useEffect(() => {
    if (!identity) return;
    const timer = setTimeout(() => setIdentity(null), Math.min(Math.max(0, Date.parse(identity.expiresAt) - Date.now()), 2_147_483_647));
    return () => clearTimeout(timer);
  }, [identity]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = signup
        ? await authClient.signUp.email({ name, email, password })
        : await authClient.signIn.email({ email, password });
      if (result.error) setError(signup ? '가입하지 못했습니다. 입력값 또는 이미 가입된 이메일인지 확인하세요.' : LOGIN_FAILURE);
      else { setSignup(false); setPassword(''); await check(); }
    } catch { setError(signup ? '가입하지 못했습니다. 다시 시도하세요.' : LOGIN_FAILURE); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError('');
    try {
      const result = await authClient.signOut();
      if (result.error) setError('로그아웃에 실패했습니다. 다시 시도하세요.');
      else { ++sessionGeneration.current; setIdentity(null); setSignup(false); setPassword(''); }
    } catch { setError('로그아웃에 실패했습니다. 다시 시도하세요.'); }
    finally { setBusy(false); }
  }
  if (loading) return <main><p role="status">로그인 상태 확인 중…</p></main>;
  if (identity) return <>
    <section className="panel" aria-label="로그인 상태"><span>{identity.user.name} · 로그인됨</span> <button disabled={busy} onClick={() => void logout()}>로그아웃</button>
      <p>현재 이 과제 버전에서는 계정 삭제 기능을 지원하지 않습니다.</p>
      <p>로컬 2단계 테스트 환경: 현재 로그인한 계정의 자료만 표시합니다. 테스트 기록은 실제 5일 사용 증거가 아닙니다.</p>
      {error ? <p role="alert">{error}</p> : null}
    </section><App key={identity.user.id} />
  </>;
  return <main><section className="panel" aria-label="인증 화면"><h1>T07 플랜두씨 다이어리</h1><h2>{signup ? '가입' : '로그인'}</h2>
    <p>테스트 계정은 실제 사용 증거가 아닙니다.</p>
    <form onSubmit={submit}><fieldset disabled={busy}>
      {signup ? <label>표시 이름<input required maxLength={100} autoComplete="nickname" value={name} onChange={e => setName(e.target.value)} /></label> : null}
      <label>이메일<input type="email" required autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label>비밀번호<input type="password" required minLength={signup ? 12 : 8} maxLength={128} autoComplete={signup ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} /></label>
      <button type="submit">{busy ? '처리 중…' : signup ? '가입하기' : '로그인하기'}</button>
      <button type="button" onClick={() => { setSignup(!signup); setPassword(''); setError(''); }}>{signup ? '로그인으로' : '가입 화면으로'}</button>
    </fieldset></form>{error ? <p role="alert">{error}</p> : null}
    <button onClick={() => void check()}>세션 다시 확인</button>
  </section></main>;
}
