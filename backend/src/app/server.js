require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const http = require('http');

const { requireStrongJwtSecret } = require('../config/env');
const { accessLogStream, logError } = require('../infra/logging/logger');
const { initDb } = require('../infra/db');
const { notFound, errorHandler } = require('../api/middleware/errorHandler');
const { rateLimit } = require('../api/middleware/rateLimit');
// require routes after DB init to avoid accessing pool before it's initialized

requireStrongJwtSecret();

const app = express();
app.disable('x-powered-by');
// Allow secure URL detection behind a reverse proxy (Ingress/Front Door/Nginx).
app.set('trust proxy', true);

// Security headers.
app.use(
  helmet({
    // API-only server; avoid surprises if someone serves JSON/docs.
    contentSecurityPolicy: false,
  })
);

// CORS is only relevant for browser clients.
// Default: enabled in non-production; in production enable only when CORS_ORIGIN is set.
const { NODE_ENV = 'development', CORS_ORIGIN = '' } = process.env;

// Enforce HTTPS in production (typically terminated at a proxy).
if (NODE_ENV === 'production') {
  app.use((req, res, next) => {
    const xfProto = req.headers['x-forwarded-proto'];
    const isHttps = req.secure || (typeof xfProto === 'string' && xfProto.toLowerCase().includes('https'));
    if (isHttps) return next();
    return res.status(403).json({ error: 'HTTPS required' });
  });
}
if (NODE_ENV !== 'production') {
  app.use(cors({ origin: true }));
} else if (String(CORS_ORIGIN).trim()) {
  const allow = String(CORS_ORIGIN)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.use(cors({ origin: allow, credentials: false }));
}

// Global rate limiting (single-instance only).
app.use(rateLimit({ windowMs: 60_000, max: 600 }));

app.use(express.json({ limit: '2mb' }));
// request id middleware
app.use((req, res, next) => {
  req.id = uuidv4();
  next();
});

morgan.token('id', (req) => req.id);
// user token is available after auth middleware; routes that run before auth will show '-'
morgan.token('user', (req) => (req.user && req.user.userId ? req.user.userId : '-'));
const morganFormat = ':id :remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] - :response-time ms user::user';

app.use(morgan('dev'));
app.use(morgan(morganFormat, { stream: accessLogStream }));

// routes will be registered after DB initialization (so getPool() works)

app.get('/', (req, res) => res.json({ ok: true, message: 'backend running' }));

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

initDb()
  .then(() => {
    // register routes now that DB is ready
    const apiRoutes = require('../api/routes');
    app.use('/api', apiRoutes);

    // terminal middlewares
    app.use(notFound);
    app.use(errorHandler);
    // determine a likely local network IP to show in startup message
    const os = require('os');
    const nets = os.networkInterfaces();
    let localIp = 'localhost';
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          localIp = net.address;
          break;
        }
      }
      if (localIp !== 'localhost') break;
    }

    // initialize WebSocket server and start HTTP server
    const { initWebsocket } = require('../realtime/ws');
    initWebsocket(server);

    server.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log(`Server running on http://${localIp}:${PORT}`);
      console.log(`WebSocket endpoint ws://${localIp}:${PORT}/ws`);
      console.log(`DB connected`);
    });
  })
  .catch((err) => {
    logError(err || 'Failed to initialize DB');
    process.exit(1);
  });

module.exports = app;
