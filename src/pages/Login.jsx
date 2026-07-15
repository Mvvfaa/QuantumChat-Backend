import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import ThemeSwitcher from '../components/ThemeSwitcher.jsx';

function getFriendlyLoginError(serverError, statusCode) {
  const msg = (serverError || '').toLowerCase();

  if (statusCode === 429) {
    return {
      text: "You\u2019ve made too many attempts. Take a breather and try again in a minute.",
      action: null,
    };
  }

  if (statusCode === 401 || msg.includes('invalid email or password')) {
    return {
      text: "We couldn't find an account matching those credentials. Double-check your details and try again.",
      action: { label: 'Register an account instead', to: '/register' },
    };
  }

  if (statusCode === 400 || msg.includes('required')) {
    return {
      text: 'Please fill in both your email and password.',
      action: null,
    };
  }

  if (statusCode >= 500) {
    return {
      text: "Our servers are experiencing an issue. Please try again in a few moments.",
      action: null,
    };
  }

  if (msg.includes('network') || msg.includes('econnrefused')) {
    return {
      text: 'Network error: Cannot connect to the server. Please check your internet connection.',
      action: null,
    };
  }

  return {
    text: serverError || 'An unexpected error occurred. Please try again.',
    action: null,
  };
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Dynamic page title
  useEffect(() => {
    document.title = 'Log in — QuantumChat';
    return () => { document.title = 'QuantumChat'; };
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!form.email.trim()) {
      setError({ text: 'Please enter your email address.', action: null });
      return;
    }

    if (!form.password) {
      setError({ text: 'Please enter your password.', action: null });
      return;
    }

    setLoading(true);
    try {
      await login(form);
      navigate('/chat');
    } catch (err) {
      const serverMsg = err.response?.data?.error;
      const status = err.response?.status;
      setError(getFriendlyLoginError(serverMsg, status));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-theme-container auth-page-topbar">
        <ThemeSwitcher />
      </div>
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-brand">
          <div className="auth-brand-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <div className="auth-brand-name">QuantumChat</div>
          <h1>Log in to your account</h1>
        </div>

        <div className="auth-field">
          <svg className="auth-field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
          </svg>
          <input
            id="login-email"
            type="email"
            placeholder="Email address"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
            autoComplete="email"
          />
        </div>

        <div className="auth-field auth-field-password">
          <svg className="auth-field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <input
            id="login-password"
            type={showPassword ? 'text' : 'password'}
            placeholder="Password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
            autoComplete="current-password"
          />
          <button
            type="button"
            className="password-toggle auth-password-toggle"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            tabIndex={-1}
          >
            {showPassword ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>

        {error && (
          <div className="auth-error" role="alert" aria-live="polite">
            <span>{error.text}</span>
            {error.action && (
              <Link to={error.action.to} className="auth-error-action">
                {error.action.label}
              </Link>
            )}
          </div>
        )}

        <button type="submit" disabled={loading}>
          {loading ? 'Logging in...' : 'Log in'}
        </button>

        <p>
          Need an account? <Link to="/register">Register</Link>
        </p>
      </form>
    </div>
  );
}
