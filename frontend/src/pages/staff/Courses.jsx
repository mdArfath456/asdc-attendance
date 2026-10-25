import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMsg } from '../../api';
import Field from '../../components/Field';
import { courseSchema, validate } from '../../validation';

const EMPTY = { name: '', code: '', description: '', isPublic: false };
export default function Courses() {
  const [courses, setCourses] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [enrollMatching, setEnrollMatching] = useState(true);
  const nameRef = useRef(null);
  const codeRef = useRef(null);
  const descriptionRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const response = await api.get('/courses');
      setCourses(response.data.data);
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    const validation = validate(courseSchema, form);
    setErrors(validation.errors);
    if (!validation.values) {
      if (validation.errors.name) nameRef.current?.focus();
      else if (validation.errors.code) codeRef.current?.focus();
      else descriptionRef.current?.focus();
      return;
    }
    try {
      const createdCourse = await api.post('/courses', form);
      let enrolledCount = 0;
      if (enrollMatching) {
        const enrollment = await api.post(`/courses/${createdCourse.data.data._id}/enroll-requested`, { requestedCourseName: form.name });
        enrolledCount = enrollment.data.data.enrolledCount;
      }
      setForm(EMPTY);
      setMessage(enrolledCount ? `Course created and ${enrolledCount} requested student(s) enrolled.` : 'Course created.');
      await load();
    } catch (e) {
      if (e.response?.status === 409 || e.response?.data?.error?.code === 'DUPLICATE_KEY') {
        setErrors((current) => ({ ...current, code: 'This course code is already in use.' }));
      } else setError(errMsg(e));
    }
  };

  return (
    <>
      <h1>Courses</h1>
      <form noValidate className="card" onSubmit={create}>
        <h2>Create a course</h2>
        <div className="grid cols-2">
          <Field ref={nameRef} id="course-name" label="Name" value={form.name} maxLength={160} onChange={(e) => { const value = e.target.value; setForm({ ...form, name: value }); if (value.trim().length >= 2 && value.trim().length <= 160) setErrors((current) => ({ ...current, name: undefined })); }} error={errors.name} />
          <Field ref={codeRef} id="course-code" label="Code" value={form.code} maxLength={30} onChange={(e) => { const value = e.target.value; setForm({ ...form, code: value }); if (value.trim().length >= 2 && value.trim().length <= 30) setErrors((current) => ({ ...current, code: undefined })); }} error={errors.code} />
        </div>
        <Field
          ref={descriptionRef}
          id="course-description"
          label="Description"
          as="textarea"
          rows="3"
          maxLength={4000}
          value={form.description}
          onChange={(e) => {
            const value = e.target.value;
            setForm({ ...form, description: value });
            if (value.trim().length <= 4000) setErrors((current) => ({ ...current, description: undefined }));
          }}
          error={errors.description}
        />
        <label><input type="checkbox" checked={form.isPublic} onChange={(e) => setForm({ ...form, isPublic: e.target.checked })} /> Show in public catalogue</label>
        <label className="inline-check"><input type="checkbox" checked={enrollMatching} onChange={(e) => setEnrollMatching(e.target.checked)} /> Offer enrollment to students who requested this course name</label>
        {message && <p className="success">{message}</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn">Create course</button>
      </form>
      <div className="grid cols-2">
        {courses.map((course) => (
          <article className="card" key={course._id}>
            <h2><Link to={`/admin/courses/${course._id}`}>{course.name}</Link></h2>
            <p className="muted">{course.code} · {course.status}</p>
            {course.description && <p>{course.description}</p>}
            <Link className="btn small" to={`/admin/courses/${course._id}`}>Course details</Link>
          </article>
        ))}
      </div>
      {courses.length === 0 && <p className="muted">No courses yet. Create one.</p>}
    </>
  );
}
