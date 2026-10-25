export default function StudentAuthLayout({ children }) {
  return (
    <main className="auth-layout">
      <aside className="auth-brand-panel">
        <div className="auth-brand-mark" aria-hidden="true">AS</div>
        <p className="eyebrow">ASDC ATTENDANCE</p>
        <h1>Learn together.<br />Show up for every moment.</h1>
        <p className="auth-intro">A simple place to join your course group and keep track of your learning.</p>
        <ul className="feature-list">
          <li><span aria-hidden="true">◉</span> Fast QR attendance</li>
          <li><span aria-hidden="true">↗</span> Track your attendance</li>
          <li><span aria-hidden="true">⌂</span> Learn with your course group</li>
        </ul>
      </aside>
      <section className="auth-panel">
        <div className="auth-mobile-brand"><span className="auth-brand-mark" aria-hidden="true">AS</span><b>ASDC Attendance</b></div>
        {children}
      </section>
    </main>
  );
}
