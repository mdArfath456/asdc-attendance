import { useEffect, useState } from 'react';
import api, { errMsg } from '../../api';
import Badge from '../../components/Badge';

const pct = (v) => (v === null || v === undefined ? 'N/A' : `${v}%`);
export default function History() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/attendance/my-history').then((r) => setData(r.data.data)).catch((e) => setError(errMsg(e))); }, []);
  if (error) return <div className="error">{error}</div>;
  if (!data) return <p className="muted">Loading...</p>;
  return (
    <>
      <h1>My attendance</h1>
      <div className="card stat"><b>{pct(data.overall.percentage)}</b><span>Overall (minimum {data.overall.threshold}%)</span></div>
      {data.enrollments.length === 0 && <p className="muted">You are not enrolled in any course yet. Join a course to get started.</p>}
      {data.enrollments.map((e) => (
        <div className="card" key={e.enrollmentId}>
          <div className="row spread">
            <div><h2 style={{ margin: 0 }}>{e.course && e.course.name}</h2><small className="muted">Enrollment: {e.status}</small></div>
            <div className="stat"><b className={e.summary.belowThreshold ? 'scan-bad' : ''}>{pct(e.summary.percentage)}</b></div>
          </div>
          {e.summary.belowThreshold && <div className="error">Your attendance is below the {data.overall.threshold}% requirement.</div>}
          <p className="muted">Present {e.summary.present} - Late {e.summary.late} - Absent {e.summary.absent} - Excused {e.summary.excused}</p>
          <div className="table-wrap"><table><thead><tr><th>Date</th><th>Session</th><th>Status</th><th>Checked in</th></tr></thead>
            <tbody>{e.sessions.map((s) => (
              <tr key={s.recordId}><td>{new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', dateStyle: 'medium' }).format(new Date(s.sessionDate))}</td><td>{s.title || '-'}</td><td><Badge value={s.status} /></td>
                <td>{s.checkInTimestamp ? new Date(s.checkInTimestamp).toLocaleTimeString() : '-'}</td></tr>))}
              {e.sessions.length === 0 && <tr><td colSpan="4" className="muted">No closed sessions yet.</td></tr>}</tbody></table></div>
        </div>
      ))}
    </>
  );
}
