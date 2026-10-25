import { forwardRef } from 'react';

const Field = forwardRef(function Field({
  id,
  label,
  error,
  as: Element = 'input',
  className = '',
  ...props
}, ref) {
  const errorId = `${id}-error`;
  return (
    <div className={`field ${error ? 'field-invalid' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <Element
        {...props}
        id={id}
        ref={ref}
        className={`${className} ${error ? 'input-invalid' : ''}`.trim()}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
      />
      {error && <span id={errorId} className="field-tooltip" role="alert">{error}</span>}
    </div>
  );
});

export default Field;
