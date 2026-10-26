import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api, { errCode, errMsg } from '../api';
import { useAuth, homeFor } from '../auth/AuthContext';
import CourseCards from '../components/CourseCards';
import Field from '../components/Field';
import GoogleSignInButton from '../components/GoogleSignInButton';
import StudentAuthLayout from '../components/StudentAuthLayout';
import { courseSelectionSchema, registerEmailSchema, registerNameSchema, registerSchema, registrationCoursePayload, strongPassword, validate } from '../validation';

const initialValues = { name: '', email: '', password: '' };

export default function Register() {
  const { register, loginGoogle } = useAuth();
  const nav = useNavigate();
  const [courses, setCourses] = useState([]);
  const [values, setValues] = useState(initialValues);
  const [courseChoice, setCourseChoice] = useState('');
  const [requestedCourseName, setRequestedCourseName] = useState('');
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const refs = { name: useRef(null), email: useRef(null), password: useRef(null), courseChoice: useRef(null), requestedCourseName: useRef(null) };

  useEffect(() => {
    api.get('/courses/active').then((response) => setCourses(response.data.data)).catch((error) => setMessage(errMsg(error)));
  }, []);

  const validateCourse = () => {
    const result = validate(courseSelectionSchema, {
      courseChoice,
      requestedCourseName: courseChoice === 'OTHER' ? requestedCourseName : undefined,
    });
    setErrors((current) => ({ ...current, courseChoice: result.errors.courseChoice, requestedCourseName: result.errors.requestedCourseName }));
    if (result.errors.courseChoice) refs.courseChoice.current?.focus();
    else if (result.errors.requestedCourseName) refs.requestedCourseName.current?.focus();
    return result.values;
  };

  const serverError = (error) => {
    const code = errCode(error);
    if (code === 'EMAIL_ALREADY_REGISTERED') setErrors((current) => ({ ...current, email: 'This email is already registered. Sign in instead.' }));
    else if (code === 'COURSE_NOT_AVAILABLE') setErrors((current) => ({ ...current, courseChoice: 'Choose an active course' }));
    else setMessage(errMsg(error));
  };

  const submit = async (event) => {
    event.preventDefault();
    setMessage('');
    const result = validate(registerSchema, {
      ...values,
      courseChoice,
      requestedCourseName: courseChoice === 'OTHER' ? requestedCourseName : undefined,
    });
    setErrors(result.errors);
    const firstError = ['courseChoice', 'requestedCourseName', 'name', 'email', 'password'].find((field) => result.errors[field]);
    if (firstError) {
      refs[firstError]?.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const user = await register({
        ...values,
        ...registrationCoursePayload(courseChoice, requestedCourseName),
      });
      nav(homeFor(user), { replace: true });
    } catch (error) {
      serverError(error);
    } finally {
      setBusy(false);
    }
  };

  const google = async (credential) => {
    setMessage('');
    if (!validateCourse()) return;
    setBusy(true);
    try {
      const user = await loginGoogle(credential.credential);
      nav(homeFor(user), { replace: true });
    } catch (error) {
      if (errCode(error) === 'REGISTRATION_REQUIRED') {
        nav('/register/complete', {
          state: {
            idToken: credential.credential,
            name: error.response?.data?.error?.details?.name || '',
            courseChoice,
            requestedCourseName,
          },
        });
      } else serverError(error);
    } finally {
      setBusy(false);
    }
  };

  const setValue = (key, value, schema) => {
    setValues((current) => ({ ...current, [key]: value }));
    if (errors[key] && (!schema || schema.safeParse(value).success)) {
      setErrors((current) => ({ ...current, [key]: undefined }));
    }
  };
  const passwordChecks = [
    ['12+ characters', values.password.length >= 12],
    ['Uppercase letter', /[A-Z]/.test(values.password)],
    ['Lowercase letter', /[a-z]/.test(values.password)],
    ['Number', /[0-9]/.test(values.password)],
    ['Symbol', /[^A-Za-z0-9]/.test(values.password)],
  ];

  return (
    <StudentAuthLayout>
      <div className="auth-card">
        <p className="eyebrow">GET STARTED</p>
        <h2>Create your student account</h2>
        <p className="muted">Choose your course group once. You can register with Google or email.</p>
        {message && <div className="error" role="alert">{message}</div>}
        <CourseCards
          courses={courses}
          value={courseChoice}
          onChange={(choice) => {
            setCourseChoice(choice);
            setErrors((current) => ({ ...current, courseChoice: undefined, requestedCourseName: undefined }));
          }}
          error={errors.courseChoice}
          focusRef={refs.courseChoice}
          name="register-course"
        />
        {courseChoice === 'OTHER' && (
          <Field
            ref={refs.requestedCourseName}
            id="requested-course"
            label="Type your course name"
            value={requestedCourseName}
            maxLength={80}
            onChange={(event) => {
              const value = event.target.value;
              setRequestedCourseName(value);
              if (errors.requestedCourseName && value.trim().length >= 2 && value.trim().length <= 80 && !/[<>]/.test(value)) {
                setErrors((current) => ({ ...current, requestedCourseName: undefined }));
              }
            }}
            error={errors.requestedCourseName}
          />
        )}
        {courses.length === 0 && <p className="muted">No courses yet. You can request one using “Other”; an administrator will review it.</p>}
        <div className="google-button auth-google">
          <GoogleSignInButton onSuccess={google} onError={() => setMessage('Google sign-in failed or was cancelled.')} text="continue_with" shape="rectangular" />
        </div>
        <div className="divider">or create an account with email</div>
        <form noValidate onSubmit={submit}>
          <Field
            ref={refs.name}
            id="register-name"
            label="Name"
            autoComplete="name"
            value={values.name}
            maxLength={120}
            onChange={(event) => setValue('name', event.target.value, registerNameSchema)}
            error={errors.name}
          />
          <Field
            ref={refs.email}
            id="register-email"
            label="Email"
            type="email"
            autoComplete="email"
            value={values.email}
            maxLength={254}
            onChange={(event) => setValue('email', event.target.value, registerEmailSchema)}
            error={errors.email}
          />
          <div className="password-field">
            <Field
              ref={refs.password}
              id="register-password"
              label="Password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={values.password}
              onChange={(event) => setValue('password', event.target.value, strongPassword)}
              error={errors.password}
            />
            <button className="password-toggle" type="button" onClick={() => setShowPassword((shown) => !shown)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button>
          </div>
          <ul className="password-checklist" aria-label="Password requirements">
            {passwordChecks.map(([text, passed]) => <li className={passed ? 'passed' : ''} key={text}><span aria-hidden="true">{passed ? '✓' : '○'}</span> {text}</li>)}
          </ul>
          <button className="btn auth-submit" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
        </form>
        <p className="fine-print">By continuing, you agree to use your account for attendance and course communications.</p>
        <p className="auth-links">Already registered? <Link to="/login/student">Sign in</Link></p>
        <p className="auth-links"><Link to="/">Back</Link> · <Link to="/courses">Browse courses</Link></p>
      </div>
    </StudentAuthLayout>
  );
}
