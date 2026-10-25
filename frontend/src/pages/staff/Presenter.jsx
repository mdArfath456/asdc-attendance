import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { io } from 'socket.io-client';
import api, { errCode, errMsg, getAccessToken } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import Modal from '../../components/Modal';
import Badge from '../../components/Badge';
import Field from '../../components/Field';
import { correctionSchema, validate } from '../../validation';

export default function Presenter() {
  const { sessionId } = useParams();
  const { user } = useAuth();
  const isAdmin = user.role !== 'TRAINER';
  const base = user.role === 'TRAINER' ? '/trainer' : '/admin';
  const [session, setSession] = useState(null);
  const [stats, setStats] = useState(null);
  const [data, setData] = useState({ records: [], pending: [] });
  const [qr, setQr] = useState(null);
  const [left, setLeft] = useState(0);
  const [live, setLive] = useState(false);
  const [viewOnly, setViewOnly] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const nextAt = useRef(0);
  const correctionReasonRef = useRef(null);

  const reload = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([api.get(`/attendance-sessions/${sessionId}`), api.get(`/attendance-sessions/${sessionId}/records`)]);
      setSession(s.data.data.session); setStats(s.data.data.stats); setData(r.data.data);
    } catch (e) { setError(errMsg(e)); }
  }, [sessionId]);
  useEffect(() => { reload(); }, [reload]);

  const isOpen = session && session.status === 'OPEN';

  // QR rotation: request a fresh token every refresh interval (the backend also accepts the previous one during a grace window).
  useEffect(() => {
    if (!isOpen || viewOnly) return undefined;
    let stop = false; let timer;
    const tick = async () => {
      let delay = 20000;
      try {
        const r = await api.post(`/attendance-sessions/${sessionId}/qr-token`);
        if (stop) return;
        setQr(r.data.data); delay = r.data.data.refreshIntervalSeconds * 1000; nextAt.current = Date.now() + delay;
      } catch (e) {
        if (errCode(e) === 'SESSION_NOT_OPEN') { reload(); return; }
        if (e.response && e.response.status === 403) { setViewOnly(true); return; }
      }
      if (!stop) timer = setTimeout(tick, delay);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [isOpen, viewOnly, sessionId, reload]);

  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, Math.ceil((nextAt.current - Date.now()) / 1000))), 250);
    return () => clearInterval(t);
  }, []);

  // Live updates via Socket.IO, with polling fallback when the socket is down.
  useEffect(() => {
    if (!isOpen) return undefined;
    const socket = io(import.meta.env.VITE_SOCKET_URL || undefined, { auth: (cb) => cb({ token: getAccessToken() }), transports: ['websocket', 'polling'] });
    socket.on('connect', () => socket.emit('session:join', { sessionId }, (ack) => setLive(!!(ack && ack.ok))));
    socket.on('disconnect', () => setLive(false));
    socket.on('connect_error', () => setLive(false));
    socket.on('attendance:checkin', (e) => { setToast(`${e.student.name} checked in (${e.status})`); reload(); });
    socket.on('session:closed', reload);
    return () => socket.disconnect();
  }, [isOpen, sessionId, reload]);
  useEffect(() => {
    if (!isOpen || live) return undefined;
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
  }, [isOpen, live, reload]);
  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(''), 3000); return () => clearTimeout(t); }, [toast]);

  const closeSession = async () => {
    try { await api.post(`/attendance-sessions/${sessionId}/close`); setConfirm(false); setQr(null); await reload(); } catch (e) { setError(errMsg(e)); setConfirm(false); }
  };
  const saveEdit = async (event) => {
    event.preventDefault();
    const validation = validate(correctionSchema, { reason: edit.reason });
    if (!validation.values) {
      setEdit({ ...edit, error: validation.errors.reason });
      correctionReasonRef.current?.focus();
      return;
    }
    try { await api.patch(`/attendance-records/${edit.id}`, { status: edit.status, reason: edit.reason }); setEdit(null); await reload(); } catch (e) { setEdit({ ...edit, error: errMsg(e) }); }
  };
  const exportCsv = async () => {
    const r = await api.get('/attendance/reports/export', { params: { batchId: session.batchId, format: 'csv' }, responseType: 'blob' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(r.data); a.download = 'attendance-report.csv'; a.click(); URL.revokeObjectURL(a.href);
  };

  if (!session) return <div className="content muted">{error || 'Loading...'}</div>;
  const total = stats ? stats.totalEnrollments : 0;

  return (
    <>
      <div className="row spread">
        <div><Link to={base}>&larr; Sessions</Link><h1>{session.title || 'Attendance session'} <Badge value={session.status} /></h1></div>
        <div className="row">
          <span className={`badge ${live ? 'green' : 'amber'}`}>{isOpen ? (live ? 'Live' : 'Polling') : 'Offline'}</span>
          {isOpen && !viewOnly && <button className="btn danger" onClick={() => setConfirm(true)}>End session</button>}
          {isAdmin && <button className="btn ghost" onClick={exportCsv}>Export CSV</button>}
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      {toast && <div className="success" role="status">{toast}</div>}

      <div className="grid cols-4" style={{ marginBottom: '1rem' }}>
        {[['Present', stats && stats.present], ['Late', stats && stats.late], ['Pending', stats && stats.pending], ['Absent', stats && stats.absent]].map(([k, v]) => (
          <div className="card stat" key={k}><b>{v ?? '-'}</b><span>{k}{k === 'Present' && total ? ` of ${total}` : ''}</span></div>
        ))}
      </div>

      <div className="grid cols-2">
        {isOpen && (
          <div className="qr-stage">
            {viewOnly && <div className="error">View only: you are not authorised to run this session.</div>}
            {!viewOnly && qr ? (
              <>
                <div className="qr-frame"><QRCodeSVG value={qr.token} size={340} level="M" includeMargin={false} /></div>
                <div className="countdown" aria-label="Time until the QR refreshes"><div style={{ width: `${(left / qr.refreshIntervalSeconds) * 100}%` }} /></div>
                <small className="muted">Refreshes in {left}s. Students scan this code with their own ASDC login.</small>
              </>
            ) : !viewOnly && <p className="muted">Generating QR...</p>}
          </div>
        )}
        <div className="card">
          <h2>{isOpen ? 'Live check-ins' : 'Attendance'} ({data.records.length})</h2>
          <div className="feed table-wrap"><table>
            <thead><tr><th>Student</th><th>Status</th><th>Time</th>{!isOpen && isAdmin && <th />}</tr></thead>
            <tbody>
              {[...data.records].reverse().map((r) => (
                <tr key={r.id}><td>{r.student && r.student.name}</td><td><Badge value={r.status} /></td>
                  <td>{r.checkInTimestamp ? new Date(r.checkInTimestamp).toLocaleTimeString() : r.recordedMethod === 'ADMIN_MANUAL' ? 'manual' : '-'}</td>
                  {!isOpen && isAdmin && session.status === 'CLOSED' && <td><button className="btn small ghost" onClick={() => setEdit({ id: r.id, name: r.student && r.student.name, status: r.status, reason: '' })}>Override</button></td>}</tr>))}
              {data.pending.map((p) => <tr key={p.enrollmentId}><td>{p.student && p.student.name}</td><td><span className="badge gray">PENDING</span></td><td>-</td></tr>)}
            </tbody>
          </table></div>
        </div>
      </div>

      {confirm && (
        <Modal title="End this session?" onClose={() => setConfirm(false)}
          footer={<><button className="btn ghost" onClick={() => setConfirm(false)}>Keep open</button><button className="btn danger" onClick={closeSession}>End session</button></>}>
          <p>Check-ins will stop immediately. The <b>{stats ? stats.pending : 0}</b> student(s) who have not checked in will be marked <b>ABSENT</b>.</p>
        </Modal>
      )}
      {edit && (
        <Modal title={`Override: ${edit.name}`} onClose={() => setEdit(null)}
          footer={<><button className="btn ghost" type="button" onClick={() => setEdit(null)}>Cancel</button><button className="btn" type="submit" form="correction-form">Save correction</button></>}>
          <form id="correction-form" noValidate onSubmit={saveEdit}>
            <Field as="select" id="override-status" label="New status" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
              {['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'].map((status) => <option key={status}>{status}</option>)}
            </Field>
            <Field
              ref={correctionReasonRef}
              as="textarea"
              id="override-reason"
              label="Reason (required, audited)"
              rows="3"
              value={edit.reason}
              onChange={(e) => setEdit({ ...edit, reason: e.target.value, error: e.target.value.trim().length >= 5 ? '' : edit.error })}
              maxLength={500}
              error={edit.error}
            />
          </form>
        </Modal>
      )}
    </>
  );
}
