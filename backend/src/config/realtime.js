// Socket.IO: rooms are bound to authorised attendance sessions.
const jwt = require('jsonwebtoken');
const env = require('./env');

let io = null;

function init(httpServer) {
  const { Server } = require('socket.io');
  const User = require('../modules/users/user.model');
  io = new Server(httpServer, { cors: { origin: env.clientOrigins, credentials: true } });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
      const user = await User.findById(payload.sub).select('name role status');
      if (!user || user.status !== 'ACTIVE') return next(new Error('unauthorized'));
      socket.data.user = { id: user.id, role: user.role, name: user.name };
      return next();
    } catch (e) {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('session:join', async (payload, ack) => {
      try {
        const { loadSessionWithAccess } = require('../modules/attendance/session.service');
        await loadSessionWithAccess(socket.data.user, String(payload && payload.sessionId));
        socket.join(`session:${payload.sessionId}`);
        if (typeof ack === 'function') ack({ ok: true });
      } catch (e) {
        if (typeof ack === 'function') ack({ ok: false, code: e.code || 'ERROR' });
      }
    });
  });
  return io;
}

function emitToSession(sessionId, event, payload) {
  if (io) io.to(`session:${sessionId}`).emit(event, payload);
}

module.exports = { init, emitToSession };
