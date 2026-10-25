import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import api from '../api';

const SITE = import.meta.env.VITE_SITE_URL || window.location.origin;
export default function PublicCourse() {
  const { slug } = useParams();
  const [course, setCourse] = useState(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => { api.get(`/courses/public/${slug}`).then((r) => setCourse(r.data.data)).catch(() => setMissing(true)); }, [slug]);
  if (missing) return <div className="content"><Helmet><meta name="robots" content="noindex" /></Helmet><p>Course not found. <Link to="/courses">All courses</Link></p></div>;
  if (!course) return <div className="content muted">Loading...</div>;
  const ld = { '@context': 'https://schema.org', '@type': 'Course', name: course.name, description: course.description || course.name, courseCode: course.code, provider: { '@type': 'Organization', name: 'ASDC', sameAs: SITE } };
  return (
    <div className="content">
      <Helmet>
        <title>{course.name} | ASDC</title>
        <meta name="description" content={(course.description || course.name).slice(0, 160)} />
        <link rel="canonical" href={`${SITE}/courses/${course.slug}`} />
        <script type="application/ld+json">{JSON.stringify(ld)}</script>
      </Helmet>
      <p><Link to="/courses">&larr; All courses</Link></p>
      <div className="card"><h1>{course.name}</h1>{course.description && <p>{course.description}</p>}{Number(course.durationHours) > 0 ? <p className="muted">Duration: {course.durationHours} hours</p> : null}</div>
    </div>
  );
}
