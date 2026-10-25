const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const mongoSanitize = require('express-mongo-sanitize');
const mongoose = require('mongoose');
const env = require('./config/env');
const routes = require('./routes');
const asyncHandler = require('./utils/asyncHandler');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const Course = require('./modules/courses/course.model');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', env.TRUST_PROXY);

// COOP same-origin-allow-popups keeps Google Sign-In popups working.
app.use(helmet({ crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(
  cors({
    origin: (origin, cb) => (!origin || env.clientOrigins.includes(origin) ? cb(null, true) : cb(null, false)),
    credentials: true,
  })
);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(mongoSanitize()); // strips $ and . operators from body/params/query

// Private surfaces are never indexed.
app.use((req, res, next) => {
  if (/^\/(api|admin|trainer|student)(\/|$)/.test(req.path)) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});

app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));
app.get('/health/ready', (req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not-ready' });
});

app.get('/robots.txt', (req, res) =>
  res.type('text/plain').send(
    ['User-agent: *', 'Allow: /courses', 'Disallow: /api/', 'Disallow: /admin/', 'Disallow: /trainer/', 'Disallow: /student/', `Sitemap: ${env.SITE_URL}/sitemap.xml`, ''].join('\n')
  )
);
app.get('/sitemap.xml', asyncHandler(async (req, res) => {
  const courses = await Course.find({ isPublic: true, status: 'ACTIVE' }).select('slug updatedAt').lean();
  const urls = [{ loc: `${env.SITE_URL}/courses` }, ...courses.map((c) => ({ loc: `${env.SITE_URL}/courses/${c.slug}`, lastmod: c.updatedAt.toISOString() }))];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`)
    .join('\n')}\n</urlset>`;
  res.type('application/xml').send(xml);
}));

app.use('/api/v1', routes);

// Optional single-process deployment: serve the built React app (frontend/dist) when present.
const dist = path.resolve(__dirname, '../../frontend/dist');
if (fs.existsSync(path.join(dist, 'index.html'))) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api\/|socket\.io\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}
app.use(notFound);
app.use(errorHandler);

module.exports = app;
