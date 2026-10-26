import { useCallback, useEffect, useState } from 'react';
import api, { errMsg } from '../../api';
import { useAuth } from '../../auth/AuthContext';

const pct = (v) => (v === null || v === undefined ? 'N/A' : `${v}%`);
export default function Reports() {
  const { user } = useAuth();
  const isAdmin = user.role === 'ADMIN';
  const [courses, setCourses] = useState([]);
  const [f, setF] = useState({ courseId: '', from: '', to: '' });
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    api.get('/courses/options', { signal: controller.signal }).then((r) => setCourses(r.data.data))
      .catch((e) => { if (e.name !== 'CanceledError' && e.name !== 'AbortError') setError(errMsg(e)); });
    return () => controller.abort();
  }, []);
  const params = useCallback(() => Object.fromEntries(Object.entries(f).filter(([, v]) => v)), [f]);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setLoading(true);
    api.get('/attendance/reports/overview', { params: params(), signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        setRows(response.data.data.report.items);
        setSummary(response.data.data.summary);
      })
      .catch((loadError) => {
        if (!controller.signal.aborted && loadError.name !== 'CanceledError' && loadError.name !== 'AbortError') setError(errMsg(loadError));
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [params]);

  const exportFile = async (format) => {
    const r = await api.get('/attendance/reports/export', { params: { ...params(), format }, responseType: 'blob' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(r.data); a.download = `attendance-report.${format}`; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <h1>Reports</h1>
      {error && <div className="error">{error}</div>}
          <div className="card grid cols-2">
            <div><label>Course</label><select value={f.courseId} onChange={(e) => setF({ ...f, courseId: e.target.value })}><option value="">All {isAdmin ? '' : 'assigned '}courses</option>{courses.map((course) => <option key={course._id} value={course._id}>{course.name}</option>)}</select></div>
            <div className="row"><div style={{ flex: 1 }}><label>From</label><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></div><div style={{ flex: 1 }}><label>To</label><input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></div></div>
          </div>
          {summary && (
            <div className="grid cols-4" style={{ marginBottom: '1rem' }}>
              <div className="card stat"><b>{pct(summary.totals.percentage)}</b><span>Overall</span></div>
              <div className="card stat"><b>{summary.sessions.closed}</b><span>Sessions held</span></div>
              <div className="card stat"><b>{summary.sessions.cancelled}</b><span>Cancelled</span></div>
              <div className="card stat"><b>{summary.studentsBelowThreshold}</b><span>Below {summary.threshold}%</span></div>
            </div>
          )}
          <div className="card">
            <div className="row spread"><h2>Students ({rows.length})</h2>{isAdmin && <div className="row"><button className="btn small ghost" onClick={() => exportFile('csv')}>Export CSV</button><button className="btn small ghost" onClick={() => exportFile('json')}>JSON</button></div>}</div>
            {loading && <p className="muted" role="status">Loading report…</p>}
            <div className="table-wrap"><table><thead><tr><th>Student</th><th>Course</th><th>P</th><th>L</th><th>A</th><th>E</th><th>%</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r.enrollmentId}><td>{r.studentName}<br /><small className="muted">{r.studentEmail}</small></td><td>{r.courseName}</td><td>{r.present}</td><td>{r.late}</td><td>{r.absent}</td><td>{r.excused}</td><td className={r.belowThreshold ? 'scan-bad' : ''}><b>{pct(r.percentage)}</b></td></tr>)}
                {rows.length === 0 && <tr><td colSpan="7" className="muted">No closed sessions in this selection.</td></tr>}</tbody></table></div>
          </div>
    </>
  );
}
