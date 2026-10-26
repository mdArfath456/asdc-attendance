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
  ALREADY_CHECKED_IN: 'Your attendance has already been recorded for today',
  COURSE_SELECTION_MISMATCH: 'This QR code belongs to a different selected course.',
  SESSION_DAY_ENDED: 'This attendance session has ended for the day.',
};

export default function Scan() {
  const { user } = useAuth();
  const [phase, setPhase] = useState('idle'); // idle | scanning | submitting | done
  const [today, setToday] = useState(null);
  const [loadingToday, setLoadingToday] = useState(true);
  const [todayError, setTodayError] = useState('');
  const [selectedEnrollment, setSelectedEnrollment] = useState('');
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

  const loadToday = useCallback(async () => {
    setTodayError('');
    const response = await api.get('/attendance/today');
    const data = response.data.data;
    setToday(data);
    return data;
  }, []);

  useEffect(() => {
    let mounted = true;
    api.get('/attendance/today')
      .then((response) => { if (mounted) setToday(response.data.data); })
      .catch((loadError) => { if (mounted) setTodayError(errMsg(loadError)); })
      .finally(() => { if (mounted) setLoadingToday(false); });
    return () => { mounted = false; };
  }, []);

  const submit = useCallback(async (token, expectedBatchId) => {
    setPhase('submitting');
    try {
      const r = await api.post('/attendance/check-in', { token, expectedBatchId });
      setResult(r.data.data);
      loadToday().catch((loadError) => setTodayError(errMsg(loadError)));
    } catch (e) {
      const code = errCode(e);
      const details = e.response?.data?.error?.details;
      setError({ code, message: MESSAGES[code] || errMsg(e), status: details?.status, checkInTimestamp: details?.checkInTimestamp });
      if (code === 'ALREADY_CHECKED_IN') loadToday().catch((loadError) => setTodayError(errMsg(loadError)));
    } finally { setPhase('done'); busy.current = false; }
  }, [loadToday]);

  const start = useCallback(async (idx = camIdx) => {
    setError(null); setResult(null); setBlocked(false);
    try {
      const fresh = await loadToday();
      const course = fresh.courses.find((item) => item.enrollmentId === selectedEnrollment);
      if (!course || course.state !== 'NOT_RECORDED' || !course.session || course.session.status !== 'OPEN') {
        setError({ message: 'Choose a course with an open session before scanning.' });
        setPhase('idle');
        return;
      }
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
        submit(text, course.batch?.id);
      }, () => {});
    } catch (e) {
      setPhase('idle');
      const msg = String((e && e.message) || e);
      if (/permission|denied|NotAllowed/i.test(msg) || (e && e.name === 'NotAllowedError')) setBlocked(true);
      else setError({ message: msg });
    }
  }, [camIdx, loadToday, selectedEnrollment, stop, submit]);

  useEffect(() => () => { stop(); }, [stop]);

  const switchCamera = () => { const n = camIdx + 1; setCamIdx(n); start(n); };

  return (
    <div style={{ maxWidth: 520, margin: '0 auto' }}>
      <h1>Scan attendance QR</h1>
      {user?.requestedCourseName && <div className="success" role="status">Waiting for the admin to add you to {user.requestedCourseName}.</div>}
      {insecure && <div className="error">Camera access needs HTTPS. Open the secure (https://) address of this site.</div>}
      {todayError && <div className="error" role="alert">{todayError}</div>}
      {loadingToday && <div className="card center muted">Checking today’s attendance…</div>}
      {!loadingToday && today && phase === 'idle' && (
        <section aria-label="Today's course attendance">
          <h2>Today’s courses</h2>
          {today.courses.length === 0 && <div className="card muted">You are not enrolled in an active course yet.</div>}
          <div className="grid cols-2">
            {today.courses.map((course) => {
              const canScan = course.state === 'NOT_RECORDED' && course.session?.status === 'OPEN';
              const recorded = course.state === 'RECORDED';
              return (
                <article className={`card today-course-card${selectedEnrollment === course.enrollmentId ? ' selected' : ''}`} key={course.enrollmentId}>
                  <h3>{course.course?.name || course.batch?.name || 'Course'}</h3>
                  {course.state === 'RECORDED' && (
                    <div className="success" role="status">
                      Attendance recorded for today: <b>{course.record.status}</b>
                      {course.record.checkInTimestamp && <> at {new Date(course.record.checkInTimestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</>}
                    </div>
                  )}
                  {course.state === 'NOT_RECORDED' && <p className="muted">Not recorded yet</p>}
                  {course.state === 'NO_SESSION' && <p className="muted">No session today</p>}
                  {course.state === 'SESSION_CLOSED' && <p className="muted">Today’s session has closed; attendance was not recorded.</p>}
                  {canScan && <button type="button" className="btn ghost small" aria-pressed={selectedEnrollment === course.enrollmentId} onClick={() => setSelectedEnrollment(course.enrollmentId)}>{selectedEnrollment === course.enrollmentId ? 'Selected course' : 'Select course'}</button>}
                  {recorded && <p className="muted">You can scan again tomorrow.</p>}
                </article>
              );
            })}
          </div>
        </section>
      )}
      {blocked && (
        <div className="error">
          Camera access is blocked. Allow the camera for this site in your browser settings (address bar lock icon &rarr; Site settings &rarr; Camera &rarr; Allow), then tap Start again.
        </div>
      )}
      {phase === 'idle' && selectedEnrollment && today?.courses.some((course) => course.enrollmentId === selectedEnrollment && course.state === 'NOT_RECORDED' && course.session?.status === 'OPEN') && (
        <div className="card center"><p>Point your camera at the QR code for the selected course.</p><button className="btn" onClick={() => start()}>Start scanning</button></div>
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
          {error.checkInTimestamp && <p className="muted">Recorded at {new Date(error.checkInTimestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>}
          <div style={{ marginTop: '1rem' }}>
            {error.code === 'ALREADY_CHECKED_IN'
              ? <button className="btn ghost" onClick={() => { setError(null); setPhase('idle'); }}>Return to courses</button>
              : <button className="btn" onClick={() => start()}>Scan again</button>}
          </div>
        </div>
      )}
      {phase === 'done' && result && <div className="center"><button className="btn ghost" onClick={() => { setResult(null); setPhase('idle'); }}>Done</button></div>}
      {phase === 'idle' && error && <div className="error">{error.message}</div>}
    </div>
  );
}
