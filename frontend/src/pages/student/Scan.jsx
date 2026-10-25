import { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import api, { errCode, errMsg } from '../../api';
import Badge from '../../components/Badge';
import { useAuth } from '../../auth/AuthContext';

const MESSAGES = {
  QR_EXPIRED: 'That QR code has expired. Scan the code currently shown on the screen.',
  QR_INVALID: 'This is not a valid ASDC attendance QR code.',
  SESSION_CLOSED: 'This attendance session has already been closed.',
  SESSION_NOT_OPEN: 'This attendance session is not open yet.',
  BATCH_MISMATCH: 'You are not enrolled in the course for this session.',
  ENROLLMENT_INELIGIBLE: 'Your enrollment in this course is not active. Contact your administrator.',
  ALREADY_CHECKED_IN: 'Your attendance is already recorded for this session.',
};

export default function Scan() {
  const { user } = useAuth();
  const [phase, setPhase] = useState('idle'); // idle | scanning | submitting | done
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [cams, setCams] = useState([]);
  const [camIdx, setCamIdx] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const scanner = useRef(null);
  const busy = useRef(false);
  const insecure = !window.isSecureContext && window.location.hostname !== 'localhost';

  const stop = useCallback(async () => {
    const s = scanner.current;
    scanner.current = null;
    if (s) { try { if (s.isScanning) await s.stop(); s.clear(); } catch (e) { /* ignore */ } }
  }, []);

  const submit = useCallback(async (token) => {
    setPhase('submitting');
    try {
      const r = await api.post('/attendance/check-in', { token });
      setResult(r.data.data);
    } catch (e) {
      const code = errCode(e);
      setError({ code, message: MESSAGES[code] || errMsg(e), status: e.response && e.response.data && e.response.data.error && e.response.data.error.details && e.response.data.error.details.status });
    } finally { setPhase('done'); busy.current = false; }
  }, []);

  const start = useCallback(async (idx = camIdx) => {
    setError(null); setResult(null); setBlocked(false);
    try {
      const list = await Html5Qrcode.getCameras();
      if (!list.length) throw new Error('No camera found on this device.');
      setCams(list);
      await stop();
      setPhase('scanning');
      await new Promise((r) => setTimeout(r, 50)); // let #reader mount
      const s = new Html5Qrcode('reader');
      scanner.current = s;
      const cam = list[idx % list.length];
      await s.start(cam.id, { fps: 10, qrbox: { width: 240, height: 240 } }, async (text) => {
        if (busy.current) return;
        busy.current = true;
        await stop();
        submit(text);
      }, () => {});
    } catch (e) {
      setPhase('idle');
      const msg = String((e && e.message) || e);
      if (/permission|denied|NotAllowed/i.test(msg) || (e && e.name === 'NotAllowedError')) setBlocked(true);
      else setError({ message: msg });
    }
  }, [camIdx, stop, submit]);

  useEffect(() => () => { stop(); }, [stop]);

  const switchCamera = () => { const n = camIdx + 1; setCamIdx(n); start(n); };

  return (
    <div style={{ maxWidth: 520, margin: '0 auto' }}>
      <h1>Scan attendance QR</h1>
      {user?.requestedCourseName && <div className="success" role="status">Waiting for the admin to add you to {user.requestedCourseName}.</div>}
      {insecure && <div className="error">Camera access needs HTTPS. Open the secure (https://) address of this site.</div>}
      {blocked && (
        <div className="error">
          Camera access is blocked. Allow the camera for this site in your browser settings (address bar lock icon &rarr; Site settings &rarr; Camera &rarr; Allow), then tap Start again.
        </div>
      )}
      {phase === 'idle' && (
        <div className="card center"><p>Point your camera at the QR code shown by your trainer.</p><button className="btn" onClick={() => start()}>Start scanning</button></div>
      )}
      {phase === 'scanning' && (
        <div className="card">
          <div id="reader" />
          <div className="row" style={{ justifyContent: 'center', marginTop: '.8rem' }}>
            {cams.length > 1 && <button className="btn ghost small" onClick={switchCamera}>Switch camera</button>}
            <button className="btn ghost small" onClick={async () => { await stop(); setPhase('idle'); }}>Cancel</button>
          </div>
        </div>
      )}
      {phase === 'submitting' && <div className="card center"><div className="big">...</div><p>Recording your attendance</p></div>}
      {phase === 'done' && result && (
        <div className="card result">
          <div className={`big ${result.status === 'PRESENT' ? 'scan-ok' : 'scan-late'}`}>{result.status === 'PRESENT' ? '✔' : '⏱'}</div>
          <h2>Attendance recorded</h2><Badge value={result.status} />
          <p className="muted">{new Date(result.checkInTimestamp).toLocaleTimeString()}</p>
        </div>
      )}
      {phase === 'done' && error && (
        <div className="card result">
          <div className={`big ${error.code === 'ALREADY_CHECKED_IN' ? 'scan-ok' : 'scan-bad'}`}>{error.code === 'ALREADY_CHECKED_IN' ? '✔' : '✖'}</div>
          <h2>{error.code === 'ALREADY_CHECKED_IN' ? 'Already checked in' : 'Could not record attendance'}</h2>
          <p>{error.message}</p>{error.status && <Badge value={error.status} />}
          <div style={{ marginTop: '1rem' }}><button className="btn" onClick={() => start()}>Scan again</button></div>
        </div>
      )}
      {phase === 'done' && result && <div className="center"><button className="btn ghost" onClick={() => { setResult(null); setPhase('idle'); }}>Done</button></div>}
      {phase === 'idle' && error && <div className="error">{error.message}</div>}
    </div>
  );
}
