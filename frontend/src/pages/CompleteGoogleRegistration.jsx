import { useEffect, useRef, useState } from 'react';
import { Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import api, { errCode, errMsg } from '../api';
import { useAuth, homeFor } from '../auth/AuthContext';
import CourseCards from '../components/CourseCards';
import Field from '../components/Field';
import StudentAuthLayout from '../components/StudentAuthLayout';
import { courseSelectionSchema, registrationCoursePayload, validate } from '../validation';

export default function CompleteGoogleRegistration() {
  const location = useLocation();
  const nav = useNavigate();
  const { registerGoogle } = useAuth();
  const [courses, setCourses] = useState([]);
  const [courseChoice, setCourseChoice] = useState(location.state?.courseChoice || location.state?.courseId || '');
  const [requestedCourseName, setRequestedCourseName] = useState(location.state?.requestedCourseName || '');
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const courseRef = useRef(null);
  const requestedCourseRef = useRef(null);
  const idToken = location.state?.idToken;
  const name = location.state?.name || '';

  useEffect(() => {
    api.get('/courses/active').then((response) => setCourses(response.data.data)).catch((error) => setMessage(errMsg(error)));
  }, []);
  if (!idToken) return <Navigate to="/register" replace />;

  const submit = async (event) => {
    event.preventDefault();
    setMessage('');
    const result = validate(courseSelectionSchema, {
      courseChoice,
      requestedCourseName: courseChoice === 'OTHER' ? requestedCourseName : undefined,
    });
    setErrors(result.errors);
    if (result.errors.courseChoice) courseRef.current?.focus();
    else if (result.errors.requestedCourseName) requestedCourseRef.current?.focus();
    if (!result.values) return;
    setBusy(true);
    try {
      const user = await registerGoogle(idToken, registrationCoursePayload(courseChoice, requestedCourseName));
      nav(homeFor(user), { replace: true });
    } catch (error) {
      if (errCode(error) === 'COURSE_NOT_AVAILABLE') setErrors({ courseChoice: 'Choose an active course' });
      else setMessage(errMsg(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <StudentAuthLayout>
      <div className="auth-card">
        <p className="eyebrow">ONE LAST STEP</p>
        <h2>Complete registration</h2>
        <p className="muted">{name ? `Welcome, ${name}. ` : ''}Choose the course group you want to join.</p>
        {message && <div className="error" role="alert">{message}</div>}
        <form noValidate onSubmit={submit}>
          <CourseCards
            courses={courses}
            value={courseChoice}
            onChange={(choice) => {
              setCourseChoice(choice);
              setErrors({});
            }}
            error={errors.courseChoice}
            focusRef={courseRef}
            name="complete-course"
          />
          {courseChoice === 'OTHER' && (
            <Field
              ref={requestedCourseRef}
              id="complete-requested-course"
              label="Type your course name"
              value={requestedCourseName}
              maxLength={80}
              onChange={(event) => {
                const value = event.target.value;
                setRequestedCourseName(value);
                if (value.trim().length >= 2 && value.trim().length <= 80 && !/[<>]/.test(value)) {
                  setErrors((current) => ({ ...current, requestedCourseName: undefined }));
                }
              }}
              error={errors.requestedCourseName}
            />
          )}
          <button className="btn auth-submit" disabled={busy}>{busy ? 'Creating account…' : 'Complete registration'}</button>
        </form>
        <p className="auth-links"><Link to="/login/student">Cancel</Link></p>
      </div>
    </StudentAuthLayout>
  );
}
