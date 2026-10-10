import { useEffect, useRef, useState, type FormEvent } from 'react';
import App from './App';
import AccountDeletionForm from './AccountDeletionForm';
import { authClient, LOGIN_FAILURE } from './auth-client';
import { BrandMark, Icon } from './ui';
import { Bloom } from './Dashboard';

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
  const [showPassword, setShowPassword] = useState(false);
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
  useEffect(() => setShowPassword(false), [identity]);
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
  if (loading) return <main className="splash"><p role="status"><span className="spinner" aria-hidden="true" />로그인 상태 확인 중…</p></main>;
  if (identity) {
    const initial = Array.from(identity.user.name.trim())[0]?.toUpperCase() ?? '?';
    return <App key={identity.user.id} userName={identity.user.name}
      accountControls={<div className="account-chip" role="group" aria-label="로그인 상태">
        <span className="avatar" aria-hidden="true">{initial}</span>
        <span className="account-name"><span className="account-name-text">{identity.user.name}</span> · 로그인됨</span>
        <button className="btn btn-ghost btn-sm btn-logout" disabled={busy} onClick={() => void logout()}><Icon name="logout" /><span className="collapse-sm">로그아웃</span></button>
      </div>}
      accountNotice={error ? <p role="alert" className="banner banner-error">{error}</p> : null}
      accountPanel={<section id="account" className="card account-panel" aria-label="계정">
        <div className="section-head"><div><span className="stage-tag neutral">ACCOUNT</span><h2>계정과 데이터</h2></div></div>
        <div className="account-grid">
          <div className="account-profile">
            <span className="avatar avatar-lg" aria-hidden="true">{initial}</span>
            <div><p className="account-profile-name">{identity.user.name}</p><p className="muted">{identity.user.email}</p></div>
            <p className="muted small">로컬 2단계 테스트 환경: 현재 로그인한 계정의 자료만 표시합니다. 테스트 기록은 실제 5일 사용 증거가 아닙니다.</p>
          </div>
          <AccountDeletionForm onDeleted={() => { ++sessionGeneration.current; setIdentity(null); setSignup(false); setPassword(''); setError('계정과 내 자료를 삭제했습니다.'); }} />
        </div>
      </section>} />;
  }
  return <main className="auth-shell">
    <div className="auth-panel">
      <section className="auth-brand">
        <div className="auth-brand-top"><BrandMark /><span className="eyebrow">Plan · Do · See</span></div>
        <div className="auth-bloom" aria-hidden="true"><Bloom /></div>
        <p className="auth-headline">계획한 대로,<br />실제로 한 만큼.</p>
        <p className="auth-sub">계획을 세우고, 실제 실행 시간을 기록하고, 예상과 실제를 비교하며 돌아보는 다이어리입니다.</p>
        <ol className="steps auth-steps">
          <li className="plan"><span>1</span><div><strong>Plan</strong>기간과 성공 기준이 있는 계획</div></li>
          <li className="do"><span>2</span><div><strong>Do</strong>시작·완료로 남기는 실제 시간</div></li>
          <li className="see"><span>3</span><div><strong>See</strong>예상과 실제를 비교하는 돌아보기</div></li>
        </ol>
      </section>
      <section className="card auth-card" aria-label="인증 화면">
        <h1><BrandMark />T07 플랜두씨 다이어리</h1>
        <div className="auth-title">
          <h2>{signup ? '가입' : '로그인'}</h2>
          <p className="muted">{signup ? '이메일과 12자 이상의 비밀번호로 새 계정을 만듭니다.' : '내 계정으로 로그인하고 기록을 이어가세요.'}</p>
        </div>
        <form onSubmit={submit}><fieldset disabled={busy}>
          {signup ? <label className="field">표시 이름<input required maxLength={100} autoComplete="nickname" value={name} onChange={e => setName(e.target.value)} /></label> : null}
          <label className="field">이메일<input type="email" required autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} /></label>
          <div className="password-field">
            <label className="field">비밀번호<input type={showPassword ? 'text' : 'password'} required minLength={signup ? 12 : 8} maxLength={128} autoComplete={signup ? 'new-password' : 'current-password'} aria-describedby={signup ? 'password-hint' : undefined} value={password} onChange={e => setPassword(e.target.value)} /></label>
            <button type="button" className="icon-btn password-toggle" aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'} aria-pressed={showPassword} onClick={() => setShowPassword(v => !v)}><Icon name={showPassword ? 'eyeOff' : 'eye'} /></button>
          </div>
          {signup ? <p className="field-hint" id="password-hint">12자 이상 입력하세요.</p> : null}
          <button type="submit" className="btn btn-primary btn-lg btn-block">{busy ? '처리 중…' : signup ? '가입하기' : '로그인하기'}</button>
          <p className="auth-switch">{signup ? '이미 계정이 있나요?' : '처음 사용하시나요?'}<button type="button" className="link-btn" onClick={() => { setSignup(!signup); setPassword(''); setError(''); setShowPassword(false); }}>{signup ? '로그인으로' : '가입 화면으로'}</button></p>
        </fieldset></form>{error ? <p role="alert" className="banner banner-error">{error}</p> : null}
        <div className="auth-foot">
          <p className="auth-note"><Icon name="info" />테스트 계정은 실제 사용 증거가 아닙니다.</p>
          <button className="btn btn-ghost btn-sm session-retry" onClick={() => void check()}>세션 다시 확인</button>
        </div>
      </section>
    </div>
  </main>;
}
