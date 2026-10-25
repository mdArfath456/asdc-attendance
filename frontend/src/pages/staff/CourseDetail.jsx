import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api, { errMsg } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import Field from '../../components/Field';
import { courseSchema, trainerSchema, validate } from '../../validation';

export default function CourseDetail() {
  const { courseId } = useParams();
  const { user } = useAuth();
  const admin = user.role === 'ADMIN';
  const base = admin ? '/admin' : '/trainer';
  const [data, setData] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [editErrors, setEditErrors] = useState({});
  const [trainerError, setTrainerError] = useState('');
  const [message, setMessage] = useState('');
  const editNameRef = useRef(null);
  const editCodeRef = useRef(null);
  const editDescriptionRef = useRef(null);
  const trainerEmailRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const response = await api.get(`/courses/${courseId}`);
      setData(response.data.data);
      const { name, code, description, isPublic } = response.data.data.course;
      setEditForm({ name, code, description: description || '', isPublic });
    } catch (e) {
      setError(errMsg(e));
    }
  }, [courseId]);
  useEffect(() => { load(); }, [load]);

  const assign = async (event) => {
    event.preventDefault();
    setError('');
    setTrainerError('');
    setMessage('');
    const validation = validate(trainerSchema, { email });
    if (!validation.values) {
      setTrainerError(validation.errors.email);
      trainerEmailRef.current?.focus();
      return;
    }
    try {
      const response = await api.post(`/courses/${courseId}/trainers`, { email });
      setEmail('');
      setMessage(response.data.message || 'Trainer assigned.');
      await load();
    } catch (e) {
      const code = e.response?.data?.error?.code;
      if (['ADMIN_EMAIL_RESERVED', 'STUDENT_HAS_ACTIVE_ENROLLMENTS', 'TRAINER_ACCOUNT_INACTIVE', 'INVALID_TRAINER_ROLE', 'TRAINER_ASSIGNMENT_CONFLICT'].includes(code)) {
        setTrainerError(errMsg(e));
      } else setTrainerError(errMsg(e));
    }
  };

  const remove = async (trainerId) => {
    setError('');
    try {
      await api.delete(`/courses/${courseId}/trainers/${trainerId}`);
      await load();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const saveCourse = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    const validation = validate(courseSchema, editForm);
    setEditErrors(validation.errors);
    if (!validation.values) {
      if (validation.errors.name) editNameRef.current?.focus();
      else if (validation.errors.code) editCodeRef.current?.focus();
      else editDescriptionRef.current?.focus();
      return;
    }
    try {
      await api.patch(`/courses/${courseId}`, editForm);
      setMessage('Course updated.');
      await load();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  if (!data || (admin && !editForm)) return <p className="muted">Loading course...</p>;
  return (
    <>
      <p><Link to={admin ? `${base}/courses` : `${base}/courses`}>Back to {admin ? 'courses' : 'my courses'}</Link></p>
      <p className="attendance-link"><Link to={`${base}?courseId=${data.course._id}`}>Take attendance →</Link></p>
      <div className="row spread"><h1>{data.course.name}</h1></div>
      <p className="muted">{data.course.code}{data.course.description ? ` · ${data.course.description}` : ''}</p>
      {error && <div className="error" role="alert">{error}</div>}
      {message && <div className="success">{message}</div>}
      {admin && (
        <form noValidate className="card" onSubmit={saveCourse}>
          <h2>Course details</h2>
          <div className="grid cols-2">
            <Field ref={editNameRef} id="edit-name" label="Name" value={editForm.name} maxLength={160} onChange={(e) => { const value = e.target.value; setEditForm({ ...editForm, name: value }); if (value.trim().length >= 2 && value.trim().length <= 160) setEditErrors((current) => ({ ...current, name: undefined })); }} error={editErrors.name} />
            <Field ref={editCodeRef} id="edit-code" label="Code" value={editForm.code} maxLength={30} onChange={(e) => { const value = e.target.value; setEditForm({ ...editForm, code: value }); if (value.trim().length >= 2 && value.trim().length <= 30) setEditErrors((current) => ({ ...current, code: undefined })); }} error={editErrors.code} />
          </div>
          <Field
            ref={editDescriptionRef}
            id="edit-description"
            label="Description"
            as="textarea"
            rows="3"
            maxLength={4000}
            value={editForm.description}
            onChange={(e) => {
              const value = e.target.value;
              setEditForm({ ...editForm, description: value });
              if (value.trim().length <= 4000) setEditErrors((current) => ({ ...current, description: undefined }));
            }}
            error={editErrors.description}
          />
          <label><input type="checkbox" checked={editForm.isPublic} onChange={(e) => setEditForm({ ...editForm, isPublic: e.target.checked })} /> Show in public catalogue</label>
          <button className="btn">Save changes</button>
        </form>
      )}
      <section className="card">
        <h2>Students ({data.students.length})</h2>
        <div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th></tr></thead>
          <tbody>{data.students.map((row) => <tr key={row.enrollmentId}><td>{row.student?.name}</td><td>{row.student?.email}</td></tr>)}
            {data.students.length === 0 && <tr><td colSpan="2" className="muted">No students yet. Students can register or join this course.</td></tr>}</tbody></table></div>
      </section>
      {admin && (
        <section className="card">
          <h2>Trainers</h2>
          <form noValidate className="row" onSubmit={assign}>
            <div style={{ flex: 1, minWidth: '220px' }}><Field ref={trainerEmailRef} id="trainer-email" label="Trainer email" type="email" value={email} maxLength={254} onChange={(e) => { const value = e.target.value; setEmail(value); if (trainerSchema.shape.email.safeParse(value).success) setTrainerError(''); }} error={trainerError} /></div>
            <button className="btn">Assign</button>
          </form>
          {data.trainers.length === 0 && <p className="muted">No trainers assigned yet. Assign one by email.</p>}
          <ul>{data.trainers.map((row) => <li key={row.assignmentId} className="row spread"><span>{row.trainer?.name} ({row.trainer?.email})</span><button className="btn small danger" onClick={() => remove(row.trainer?._id)}>Remove</button></li>)}</ul>
        </section>
      )}
    </>
  );
}
