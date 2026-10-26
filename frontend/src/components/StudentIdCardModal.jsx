import { useCallback, useEffect, useRef, useState } from 'react';
import api, { errMsg } from '../api';
import './StudentIdCardModal.css';

const displayValue = (value) => value || 'Not provided';

function enrollmentLabel(enrollment) {
  const course = enrollment.course?.name;
  const batch = enrollment.batch?.name;
  if (course && batch && course !== batch) return `${course} · ${batch}`;
  return course || batch || 'ASDC Student';
}

export default function StudentIdCardModal({ onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState('');
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);

  const loadCard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/users/me/id-card');
      setData(response.data.data);
      setSelectedEnrollmentId((current) => current || response.data.data.enrollments?.[0]?.id || '');
    } catch (loadError) {
      setError(errMsg(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled), select:not(:disabled)')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    loadCard();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [loadCard, onClose]);

  const enrollments = data?.enrollments || [];
  const selectedEnrollment = enrollments.find((enrollment) => enrollment.id === selectedEnrollmentId);
  const courseName = selectedEnrollment ? enrollmentLabel(selectedEnrollment) : 'ASDC Student';

  return (
    <div
      className="id-card-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="id-card-dialog" role="dialog" aria-modal="true" aria-label="Student ID Card" ref={dialogRef}>
        {loading && <div className="id-card-message" role="status">Loading your ID card…</div>}
        {!loading && error && (
          <div className="id-card-message" role="alert">
            <p>We couldn’t load your ID card. {error}</p>
            <button className="btn ghost" type="button" onClick={loadCard}>Try again</button>
          </div>
        )}
        {!loading && !error && data && (
          <>
            <header className="id-card-header">
              <p className="id-card-eyebrow">OFFICIAL INSTITUTIONAL CREDENTIAL</p>
              <h2>ASDC ID CARD</h2>
              {enrollments.length > 1 ? (
                <label className="id-card-enrollment">
                  <span>Course / batch</span>
                  <select value={selectedEnrollmentId} onChange={(event) => setSelectedEnrollmentId(event.target.value)}>
                    {enrollments.map((enrollment) => (
                      <option key={enrollment.id} value={enrollment.id}>{enrollmentLabel(enrollment)}</option>
                    ))}
                  </select>
                </label>
              ) : <p className="id-card-course">{courseName}</p>}
            </header>

            <div className="id-card-number" aria-label={`Student institutional ID ${data.studentId}`}>
              <span>STUDENT INSTITUTIONAL ID</span>
              <strong>{data.studentId}</strong>
            </div>

            <dl className="id-card-details">
              <div><dt>Student Name</dt><dd>{displayValue(data.name)}</dd></div>
              <div><dt>Google Account</dt><dd>{displayValue(data.email)}</dd></div>
              <div><dt>Mobile Phone</dt><dd>{displayValue(data.mobileNumber)}</dd></div>
              <div><dt>Father&apos;s Name</dt><dd>{displayValue(data.fatherName)}</dd></div>
              <div><dt>Mother&apos;s Name</dt><dd>{displayValue(data.motherName)}</dd></div>
            </dl>
          </>
        )}

        <button className="id-card-close" ref={closeButtonRef} type="button" onClick={onClose}>Close</button>
      </section>
    </div>
  );
}
