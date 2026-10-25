exports.ok = (res, data, message = 'OK', status = 200) => res.status(status).json({ success: true, message, data });
exports.created = (res, data, message = 'Created') => exports.ok(res, data, message, 201);
