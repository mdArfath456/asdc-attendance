import { useCallback, useEffect, useRef, useState } from 'react';
import api, { errMsg } from '../../api';
import Field from '../../components/Field';
import { courseSchema, validate } from '../../validation';

const suggestedCode = (name) => name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'COURSE';

export default function Students() {
  const [groups, setGroups] = useState([]);
  const [requested, setRequested] = useState([]);
  const [courses, setCourses] = useState([]);
  const [search, setSearch] = useState('');
  const [targets, setTargets] = useState({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [codes, setCodes] = useState({});
  const [codeErrors, setCodeErrors] = useState({});
  const [busy, setBusy] = useState('');
  const codeRefs = useRef({});
  const load = useCallback(async () => {
    try {
      const [students, requestedStudents, activeCourses] = await Promise.all([
        api.get('/courses/students', { params: search ? { search } : {} }),
        api.get('/courses/requested-students', { params: search ? { search } : {} }),
        api.get('/courses/active'),
      ]);
      setGroups(students.data.data);
      setRequested(requestedStudents.data.data);
      setCourses(activeCourses.data.data);
    } catch (e) {
      setError(errMsg(e));
    }
  }, [search]);
  useEffect(() => { load(); }, [load]);

  const move = async (row) => {
    setError('');
    setMessage('');
    try {
      await api.post(`/enrollments/${row.enrollmentId}/transfer`, { targetCourseId: targets[row.enrollmentId] });
      setMessage('Student moved to the selected course.');
      await load();
    } catch (e) {
      setError(errMsg(e));
    }
  };
  const remove = async (row) => {
    setError('');
    setMessage('');
    try {
      await api.patch(`/enrollments/${row.enrollmentId}/status`, { status: 'DROPPED' });
      setMessage('Student removed from the course.');
      await load();
    } catch (e) {
      setError(errMsg(e));
    }
  };
  const enrollRequested = async (group, courseId) => {
    setError('');
    setMessage('');
    setBusy(group.requestedCourseName);
    try {
      const response = await api.post(`/courses/${courseId}/enroll-requested`, { requestedCourseName: group.requestedCourseName });
      setMessage(`${response.data.data.enrolledCount} student(s) assigned to the selected course.`);
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy('');
    }
  };
  const createAndEnroll = async (event, group) => {
    event.preventDefault();
    setError('');
    setMessage('');
    const code = codes[group.requestedCourseName] || suggestedCode(group.requestedCourseName);
    const result = validate(courseSchema, { name: group.requestedCourseName, code });
    setCodeErrors((current) => ({ ...current, [group.requestedCourseName]: result.errors.code || result.errors.name }));
    if (!result.values) {
      codeRefs.current[group.requestedCourseName]?.focus();
      return;
    }
    setBusy(group.requestedCourseName);
    try {
      const created = await api.post('/courses', { name: group.requestedCourseName, code, isPublic: false });
      const enrollment = await api.post(`/courses/${created.data.data._id}/enroll-requested`, { requestedCourseName: group.requestedCourseName });
      setMessage(`Course created and ${enrollment.data.data.enrolledCount} student(s) enrolled.`);
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <h1>Students</h1>
      <div className="card"><label htmlFor="search">Search students</label><input id="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or email" /></div>
      {error && <div className="error" role="alert">{error}</div>}
      {message && <div className="success">{message}</div>}
      {groups.length === 0 && <p className="muted">No courses yet. Create one.</p>}
      {groups.map((group) => (
        <section className="card" key={group.course.id}>
          <h2>{group.course.name} ({group.count})</h2>
          {group.students.length === 0 && <p className="muted">No students in this course.</p>}
          <div className="table-wrap student-group-table"><table><thead><tr><th>Name</th><th>Email</th><th>Move to another course</th><th>Remove</th></tr></thead>
            <tbody>{group.students.map((row) => (
              <tr key={row.enrollmentId}>
                <td data-label="Name">{row.student.name}</td><td data-label="Email">{row.student.email}</td>
                <td data-label="Move to another course"><div className="row"><select aria-label={`Move ${row.student.name} to another course`} value={targets[row.enrollmentId] || ''} onChange={(e) => setTargets({ ...targets, [row.enrollmentId]: e.target.value })}><option value="">Select course</option>{courses.filter((course) => course._id !== group.course.id).map((course) => <option key={course._id} value={course._id}>{course.name}</option>)}</select><button className="btn small" disabled={!targets[row.enrollmentId]} onClick={() => move(row)}>Move</button></div></td>
                <td data-label="Remove"><button className="btn small danger" onClick={() => window.confirm('Remove this student from the course?') && remove(row)}>Remove</button></td>
              </tr>
            ))}</tbody></table></div>
        </section>
      ))}
      <section aria-labelledby="requested-heading">
        <h2 id="requested-heading">Requested / unassigned</h2>
        {requested.length === 0 && <p className="muted">No pending course requests.</p>}
        {requested.map((group) => (
          <article className="card requested-group" key={group.requestedCourseName.toLowerCase()}>
            <h3>{group.requestedCourseName} <span className="muted">({group.count})</span></h3>
            <ul className="requested-students">{group.students.map((student) => <li key={student.id}>{student.name} <span className="muted">({student.email})</span></li>)}</ul>
            <div className="requested-actions">
              <form className="requested-action" noValidate onSubmit={(event) => createAndEnroll(event, group)}>
                <Field
                  ref={(element) => { codeRefs.current[group.requestedCourseName] = element; }}
                  id={`requested-code-${group.requestedCourseName}`}
                  label="New course code"
                  value={codes[group.requestedCourseName] ?? suggestedCode(group.requestedCourseName)}
                  maxLength={30}
                  onChange={(event) => {
                    const value = event.target.value;
                    setCodes({ ...codes, [group.requestedCourseName]: value });
                    if (value.trim().length >= 2 && value.trim().length <= 30) {
                      setCodeErrors({ ...codeErrors, [group.requestedCourseName]: undefined });
                    }
                  }}
                  error={codeErrors[group.requestedCourseName]}
                />
                <button className="btn small" disabled={busy === group.requestedCourseName}>{busy === group.requestedCourseName ? 'Working…' : 'Create course and enroll'}</button>
              </form>
              <div className="requested-action">
                <label htmlFor={`requested-existing-${group.requestedCourseName}`}>Assign to existing course</label>
                <select id={`requested-existing-${group.requestedCourseName}`} value={targets[`requested:${group.requestedCourseName}`] || ''} onChange={(event) => setTargets({ ...targets, [`requested:${group.requestedCourseName}`]: event.target.value })}>
                  <option value="">Choose a course</option>
                  {courses.map((course) => <option key={course._id} value={course._id}>{course.name}</option>)}
                </select>
                <button className="btn small ghost" disabled={!targets[`requested:${group.requestedCourseName}`] || busy === group.requestedCourseName} onClick={() => enrollRequested(group, targets[`requested:${group.requestedCourseName}`])}>Assign and enroll</button>
              </div>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}
