import { useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { errCode, errMsg } from '../api';
import { useAuth, homeFor } from '../auth/AuthContext';
import Field from '../components/Field';
import StudentAuthLayout from '../components/StudentAuthLayout';
import GoogleSignInButton from '../components/GoogleSignInButton';
import { loginSchema, validate } from '../validation';
import AccessDenied from '../components/AccessDenied';

export default function Login({ adminOnly = false }) {
  const { user, loading, login, loginGoogle } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const emailRef = useRef(null);
  const passwordRef = useRef(null);

  if (loading) return <div className="center muted">Checking your sign-in…</div>;
  if (!loading && user) {
    if (adminOnly && user.role !== 'ADMIN') return <AccessDenied user={user} adminArea />;
    return <Navigate to={homeFor(user)} replace />;
  }

  const validateLogin = () => {
    const result = validate(loginSchema, { email, password });
    setErrors(result.errors);
    if (result.errors.email) emailRef.current?.focus();
    else if (result.errors.password) passwordRef.current?.focus();
    return result.values;
  };

  const onFailure = (error) => {
    if (adminOnly && ['NOT_ADMIN', 'ADMIN_REGISTRATION_FORBIDDEN'].includes(errCode(error))) {
      setMessage("You don't have access to the admin area");
      return;
    }
    setMessage(errMsg(error));
  };

  const submit = async (event) => {
    event.preventDefault();
    setMessage('');
    const values = validateLogin();
    if (!values) return;
    setBusy(true);
    try {
      const signedIn = await login(values.email, values.password, adminOnly);
      nav(homeFor(signedIn), { replace: true });
    } catch (error) {
      onFailure(error);
    } finally {
      setBusy(false);
    }
  };

  const google = async (credential) => {
    setMessage('');
    setBusy(true);
    try {
      const signedIn = await loginGoogle(credential.credential, adminOnly);
      nav(homeFor(signedIn), { replace: true });
    } catch (error) {
      if (adminOnly && errCode(error) === 'NOT_ADMIN') onFailure(error);
      else if (errCode(error) === 'REGISTRATION_REQUIRED') {
        nav('/register/complete', {
          state: { idToken: credential.credential, name: error.response?.data?.error?.details?.name || '' },
        });
      } else onFailure(error);
    } finally {
      setBusy(false);
    }
  };

  if (adminOnly) {
    return (
      <main className="admin-login-page">
        <section className="admin-login-card">
          <div className="admin-lock" aria-hidden="true">▣</div>
          <p className="eyebrow">SECURE SIGN IN</p>
          <h1>Administrator access</h1>
          <p className="admin-note">Only the registered administrator email can sign in.</p>
          {message && <div className="error" role="alert">{message}</div>}
          <div className="google-button">
            <GoogleSignInButton onSuccess={google} onError={() => setMessage('Google sign-in failed or was cancelled.')} text="signin_with" shape="rectangular" />
          </div>
          <div className="divider">or sign in with password</div>
          <form noValidate onSubmit={submit}>
            <Field
              ref={emailRef}
              id="admin-email"
              label="Administrator email"
              type="email"
              autoComplete="off"
              value={email}
              maxLength={254}
              onChange={(event) => {
                const value = event.target.value;
                setEmail(value);
                if (loginSchema.shape.email.safeParse(value).success) setErrors((current) => ({ ...current, email: undefined }));
              }}
              error={errors.email}
            />
            <div className="password-field">
              <Field
                ref={passwordRef}
                id="admin-password"
                label="Password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                maxLength={128}
                onChange={(event) => { setPassword(event.target.value); if (loginSchema.shape.password.safeParse(event.target.value).success) setErrors((current) => ({ ...current, password: undefined })); }}
                error={errors.password}
              />
              <button className="password-toggle" type="button" onClick={() => setShowPassword((shown) => !shown)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button>
            </div>
            <button className="btn admin-submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in securely'}</button>
          </form>
          <p className="auth-links"><Link to="/login/student">Go to student sign in</Link></p>
        </section>
      </main>
    );
  }

  return (
    <StudentAuthLayout>
      <div className="auth-card">
        <p className="eyebrow">WELCOME BACK</p>
        <h2>Student sign in</h2>
        <p className="muted">Sign in to continue to your course group.</p>
        {message && <div className="error" role="alert">{message}</div>}
        <div className="google-button">
          <GoogleSignInButton onSuccess={google} onError={() => setMessage('Google sign-in failed or was cancelled.')} text="signin_with" shape="rectangular" />
        </div>
        <div className="divider">or use email and password</div>
        <form noValidate onSubmit={submit}>
          <Field
            ref={emailRef}
            id="student-email"
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            maxLength={254}
            onChange={(event) => {
              const value = event.target.value;
              setEmail(value);
              if (loginSchema.shape.email.safeParse(value).success) setErrors((current) => ({ ...current, email: undefined }));
            }}
            error={errors.email}
          />
          <Field
            ref={passwordRef}
            id="student-password"
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            maxLength={128}
            onChange={(event) => { setPassword(event.target.value); if (loginSchema.shape.password.safeParse(event.target.value).success) setErrors((current) => ({ ...current, password: undefined })); }}
            error={errors.password}
          />
          <button className="btn auth-submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <p className="auth-links">New here? <Link to="/register">Create account</Link></p>
        <p className="auth-links"><Link to="/">Back</Link> · <Link to="/courses">Browse courses</Link></p>
      </div>
    </StudentAuthLayout>
  );
}
