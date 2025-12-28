require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const http = require('http');

const { requireStrongJwtSecret } = require('./config/env');
const { accessLogStream } = require('./infra/logging/logger');
const { initDb } = require('./infra/db');

const { notFound, errorHandler } = require('./middlewares/errorHandler');
const { rateLimit } = require('./middlewares/rateLimit');
const { sendSuccess } = require('./utils/response');
const { sendFailure } = require('./utils/response');
const { httpStatus } = require('./utils/httpStatus');

requireStrongJwtSecret();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

const { NODE_ENV = 'development', CORS_ORIGIN = '' } = process.env;

// Enforce HTTPS in production (typically terminated at a proxy).
if (NODE_ENV === 'production') {
  app.use((req, res, next) => {
    const xfProto = req.headers['x-forwarded-proto'];
    const isHttps = req.secure || (typeof xfProto === 'string' && xfProto.toLowerCase().includes('https'));
    if (isHttps) return next();
    return sendFailure(res, { status: httpStatus.FORBIDDEN, message: 'HTTPS required', data: {} });
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

app.use((req, res, next) => {
  req.id = uuidv4();
  next();
});

morgan.token('id', (req) => req.id);
morgan.token('user', (req) => (req.user && req.user.userId ? req.user.userId : '-'));
const morganFormat = ':id :remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] - :response-time ms user::user';

app.use(morgan('dev'));
app.use(morgan(morganFormat, { stream: accessLogStream }));

app.get('/', (req, res) => sendSuccess(res, { message: 'backend running', data: {} }));

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

initDb()
  .then(() => {
    const apiRoutes = require('./routes');

    // Versioned API: /api/v1/...
    app.use('/api', apiRoutes);

    app.use(notFound);
    app.use(errorHandler);

    const { initWebsocket } = require('./realtime/ws');
    initWebsocket(server);

    server.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log(`DB connected`);
    });
  })
  .catch((err) => {
    try {
      const { logError } = require('./infra/logging/logger');
      logError(err || 'Failed to initialize DB');
    } catch (_) {}
    process.exit(1);
  });

module.exports = app;
