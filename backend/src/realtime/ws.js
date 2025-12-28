const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const { getPool } = require('../infra/db');
const { logError, logWs } = require('../infra/logging/logger');
const { sendMessageNotification } = require('../modules/push/notification');

const { JWT_SECRET = 'changeme' } = process.env;

function extractJwtFromWsRequest(req) {
  // 1) Authorization header: Bearer <token>
  const auth = req?.headers?.authorization;
  if (auth && typeof auth === 'string') {
    const parts = auth.split(' ');
    if (parts.length === 2 && String(parts[0]).toLowerCase() === 'bearer') return parts[1];
  }

  // 2) Subprotocol: Sec-WebSocket-Protocol: bearer,<token>
  const proto = req?.headers?.['sec-websocket-protocol'];
  if (proto && typeof proto === 'string') {
    const parts = proto.split(',').map(s => s.trim());
    if (parts.length >= 2 && parts[0].toLowerCase() === 'bearer') return parts[1];
  }

  return null;
}

function createTokenBucket({ capacity, refillPerMs }) {
  return { capacity, refillPerMs, tokens: capacity, last: Date.now() };
}

function takeToken(bucket, cost = 1) {
  const now = Date.now();
  const elapsed = now - bucket.last;
  bucket.last = now;
  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsed * bucket.refillPerMs);
  if (bucket.tokens < cost) return false;
  bucket.tokens -= cost;
  return true;
}

function isValidPayload(p) {
  return p && (p.encrypted_message || p.payload) && (p.sender_id || p.from) && (p.receiver_id || p.to);
}

function initWebsocket(server) {
  const wss = new WebSocket.Server({ server, path: '/ws' });
  logWs('WebSocket server initialized at path /ws');

  const clientsByUserId = new Map();

  wss.on('connection', (ws, req) => {
    ws.id = Date.now().toString(36) + Math.random().toString(36).slice(2,8);
    const remote = (req && req.headers && (req.headers['x-forwarded-for'] || req.socket?.remoteAddress)) || 'unknown';

    // Authenticate the WS connection.
    const token = extractJwtFromWsRequest(req);
    let payload;
    try {
      if (!token) throw new Error('missing token');
      payload = jwt.verify(token, JWT_SECRET);
      if (!payload || !payload.userId) throw new Error('invalid token payload');
    } catch (e) {
      try { logWs(`WS reject: id=${ws.id} remote=${remote} reason=${e && e.message ? e.message : String(e)}`); } catch (_) {}
      try { ws.close(1008, 'unauthorized'); } catch (_) {}
      return;
    }

    ws.userId = Number(payload.userId);
    ws.rate = createTokenBucket({ capacity: 30, refillPerMs: 30 / 60_000 }); // 30 msgs/min

    if (!clientsByUserId.has(ws.userId)) clientsByUserId.set(ws.userId, new Set());
    clientsByUserId.get(ws.userId).add(ws);

    logWs(`WS connection open: id=${ws.id} userId=${ws.userId} remote=${remote}`);
    ws.send(JSON.stringify({ type: 'welcome', id: ws.id }));

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch (e) { return; }

      if (!takeToken(ws.rate, 1)) {
        try { ws.close(1013, 'rate limited'); } catch (_) {}
        return;
      }

      if (msg && msg.type === 'message' && isValidPayload(msg.payload)) {
        const p = msg.payload;
        // normalize fields
        const sender_id = ws.userId; // never trust client-supplied sender
        const receiver_id = Number(p.receiver_id || p.to);
        const encrypted_message = p.encrypted_message || p.payload || '';
        if (!Number.isFinite(receiver_id)) return;
        if (typeof encrypted_message !== 'string' || encrypted_message.length === 0 || encrypted_message.length > 64_000) return;
        logWs(`WS message recv: id=${ws.id} sender=${sender_id} receiver=${receiver_id} size=${encrypted_message.length}`);

        try {
          const pool = getPool();
          const [res] = await pool.execute(
            'INSERT INTO messages (sender_id, receiver_id, encrypted_message) VALUES (?, ?, ?)',
            [sender_id, receiver_id, encrypted_message]
          );
          logWs(`WS message saved: id=${ws.id} rowId=${res.insertId}`);

          // retrieve the saved row to get the DB timestamp
          const [[row]] = await pool.execute(
            'SELECT id, sender_id, receiver_id, encrypted_message, timestamp FROM messages WHERE id = ? LIMIT 1',
            [res.insertId]
          );

          const saved = row || {
            id: res.insertId,
            sender_id,
            receiver_id,
            encrypted_message,
            timestamp: new Date()
          };

          // Trigger push notification (metadata only; no message content).
          try {
            await sendMessageNotification({
              receiverId: receiver_id,
              senderId: sender_id,
              messageId: saved.id,
            });
          } catch (e) {
            try { logError(e); } catch (_) {}
          }

          const out = JSON.stringify({ type: 'message', payload: saved, from: ws.id, ts: Date.now() });
          // Deliver only to sender and receiver.
          const deliver = (userId) => {
            const set = clientsByUserId.get(userId);
            if (!set) return 0;
            let delivered = 0;
            set.forEach((client) => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(out);
                delivered += 1;
              }
            });
            return delivered;
          };

          const toSender = deliver(sender_id);
          const toReceiver = deliver(receiver_id);
          try { logWs(`WS deliver: id=${ws.id} toSender=${toSender} toReceiver=${toReceiver}`); } catch (_) {}
        } catch (err) {
          // log but don't crash
          try { logError(err); logWs(`WS error: id=${ws.id} ${err && err.message ? err.message : String(err)}`); } catch (e) {}
        }
      }
    });

    ws.on('close', () => {
      try {
        const uid = ws.userId;
        if (uid && clientsByUserId.has(uid)) {
          clientsByUserId.get(uid).delete(ws);
          if (clientsByUserId.get(uid).size === 0) clientsByUserId.delete(uid);
        }
      } catch (_) {}
      try { logWs(`WS connection closed: id=${ws.id}`); } catch (_) {}
    });
  });

  return wss;
}

module.exports = { initWebsocket };
