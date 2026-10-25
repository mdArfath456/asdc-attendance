import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import api from '../api';

const SITE = import.meta.env.VITE_SITE_URL || window.location.origin;
export default function PublicCourses() {
  const [courses, setCourses] = useState(null);
  useEffect(() => { api.get('/courses/public').then((r) => setCourses(r.data.data)).catch(() => setCourses([])); }, []);
  return (
    <div className="content">
      <Helmet>
        <title>Courses | ASDC</title>
        <meta name="description" content="Browse ASDC training courses." />
        <link rel="canonical" href={`${SITE}/courses`} />
      </Helmet>
      <div className="row spread"><h1>Our courses</h1><Link className="btn small" to="/login">Student / staff login</Link></div>
      {courses === null && <p className="muted">Loading...</p>}
      {courses && courses.length === 0 && <p className="muted">No courses published yet.</p>}
      <div className="grid cols-2">
        {(courses || []).map((c) => (
          <div className="card" key={c.slug}>
            <h2><Link to={`/courses/${c.slug}`}>{c.name}</Link></h2>
            {c.description && <p className="muted">{c.description}</p>}
            {Number(c.durationHours) > 0 ? <small>{c.durationHours} hours</small> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
