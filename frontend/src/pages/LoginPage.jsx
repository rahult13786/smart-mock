import { useState } from 'react';
import { useAuth } from '../auth.jsx';

export default function LoginPage() {
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
    <div className="login-screen">
      <form className="card login-card" onSubmit={submit}>
        <div className="login-brand">Mock API Portal</div>
        <h1>Sign in</h1>
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
      </form>
    </div>
  );
}
