const enabled = process.env.PERF_DIAGNOSTICS === '1';

module.exports = function performanceDiagnostics(req, res, next) {
  if (!enabled) return next();
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const route = req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched';
    console.info(JSON.stringify({
      event: 'http-performance',
      method: req.method,
      route,
      status: res.statusCode,
      durationMs: Number((Number(process.hrtime.bigint() - startedAt) / 1e6).toFixed(2)),
      responseBytes: Number(res.getHeader('content-length')) || null,
    }));
  });
  next();
};
