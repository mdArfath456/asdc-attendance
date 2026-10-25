export default function CourseCards({
  courses,
  value,
  onChange,
  error,
  name = 'course',
  showOther = true,
  focusRef,
}) {
  const errorId = `${name}-error`;
  return (
    <fieldset ref={focusRef} tabIndex={-1} className={`course-picker ${error ? 'field-invalid' : ''}`} aria-describedby={error ? errorId : undefined}>
      <legend>Choose a course</legend>
      <div className="course-card-grid">
        {courses.map((course) => (
          <label className={`course-choice ${value === course._id ? 'selected' : ''}`} key={course._id}>
            <input
              type="radio"
              name={name}
              value={course._id}
              checked={value === course._id}
              onChange={() => onChange(course._id)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
            />
            <span><b>{course.name}</b>{course.code && <small>{course.code}</small>}</span>
          </label>
        ))}
        {showOther && (
          <label className={`course-choice ${value === 'OTHER' ? 'selected' : ''}`}>
            <input
              type="radio"
              name={name}
              value="OTHER"
              checked={value === 'OTHER'}
              onChange={() => onChange('OTHER')}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
            />
            <span><b>Other</b><small>Request a course</small></span>
          </label>
        )}
      </div>
      {error && <span id={errorId} className="field-tooltip" role="alert">{error}</span>}
    </fieldset>
  );
}
