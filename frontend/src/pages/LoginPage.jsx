import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { auth } from '../api.js';

const FEATURES = [
  ['From sample to endpoint', 'Paste one JSON record and get GET, POST, PATCH, HEAD and DELETE endpoints with search, paging and stored data.'],
  ['Realistic test data', 'Ids generated from a regex or the sample’s own format, required fields, allowed values, and up to 10 mock records at a time.'],
  ['Standards your clients already use', 'JSON Patch, JSON Merge Patch, TMF630 filters, field selection, sorting and paging – no custom client code.'],
  ['Separate spaces per team', 'Dev, ST and SIT APIs per domain, team and technology, with usage analytics for every mock API.'],
];

function SignInForm({ onSignUp }) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!email.trim() || !password) return setError('Enter your email and password');
    setBusy(true);
    setError('');
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="card login-card" onSubmit={submit}>
      <h2>Sign in</h2>
      <label>
        Email
        <input autoFocus autoComplete="username" value={email} onChange={(e) => { setEmail(e.target.value); setError(''); }} placeholder="name@company.com" />
      </label>
      <label>
        Password
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setError(''); }} />
      </label>
      {error && <div className="alert error">{error}</div>}
      <button className="btn primary login-btn" disabled={busy}>{busy ? 'Signing in…' : 'Login'}</button>
      <p className="login-switch">
        No account yet? <button type="button" className="link" onClick={onSignUp}>Sign up</button>
      </p>
    </form>
  );
}

function SignUpForm({ onSignIn }) {
  const [form, setForm] = useState({ name: '', email: '', remark: '', website: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const set = (k) => (e) => {
    setForm({ ...form, [k]: e.target.value });
    setError('');
  };

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) return setError('Enter your name and email');
    setBusy(true);
    setError('');
    try {
      await auth.signup(form);
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="card login-card">
        <h2>Request sent</h2>
        <p className="muted">
          Thanks, {form.name.trim().split(' ')[0]}. An administrator will review your request and share your login details
          at <b>{form.email.trim()}</b>.
        </p>
        <button type="button" className="btn" onClick={onSignIn}>Back to sign in</button>
      </div>
    );
  }

  return (
    <form className="card login-card" onSubmit={submit}>
      <h2>Sign up</h2>
      <p className="muted small">Ask for access to the portal. An administrator creates your login.</p>
      <label>
        Name
        <input autoFocus autoComplete="name" value={form.name} onChange={set('name')} maxLength={120} />
      </label>
      <label>
        Email
        <input type="email" autoComplete="email" value={form.email} onChange={set('email')} placeholder="name@company.com" maxLength={200} />
      </label>
      <label>
        Remark
        <textarea rows={4} value={form.remark} onChange={set('remark')} maxLength={2000} placeholder="Your team, the APIs you need and the env (dev, ST, SIT)" />
      </label>
      <input className="hp-field" tabIndex={-1} autoComplete="off" aria-hidden="true" value={form.website} onChange={set('website')} />
      {error && <div className="alert error">{error}</div>}
      <button className="btn primary login-btn" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button>
      <p className="login-switch">
        Already have an account? <button type="button" className="link" onClick={onSignIn}>Sign in</button>
      </p>
    </form>
  );
}

export default function LoginPage() {
  const [mode, setMode] = useState(() => (window.location.hash === '#signup' ? 'signup' : 'signin'));
  const go = (m) => {
    setMode(m);
    try {
      window.history.replaceState(null, '', m === 'signup' ? '#signup' : window.location.pathname);
    } catch {
      return;
    }
  };

  return (
    <div className={`home mode-${mode}`}>
      <section className="home-story" aria-labelledby="home-title">
        <div className="home-brand">Mocking Solution</div>
        <h1 id="home-title">Mock APIs your teams can test against today</h1>
        <p className="home-lead">
          Mocking Solution turns a sample JSON payload into a working REST API in minutes. Register an API, paste one
          record, and get endpoints backed by stored data – with generated ids, required fields, allowed values and
          realistic mock records. Front-end, integration and test teams stop waiting for back-end systems and start
          testing the flows that matter.
        </p>
        <dl className="home-features">
          {FEATURES.map(([t, d]) => (
            <div key={t}>
              <dt>{t}</dt>
              <dd>{d}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="home-access" aria-label={mode === 'signup' ? 'Sign up' : 'Sign in'}>
        {mode === 'signup' ? <SignUpForm onSignIn={() => go('signin')} /> : <SignInForm onSignUp={() => go('signup')} />}
      </section>
    </div>
  );
}
