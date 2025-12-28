/*
  Smoke test: backend + websocket end-to-end connectivity.

  - Registers 2 users
  - Logs in (with x-device-id)
  - Fetches /auth/me to get user IDs
  - Opens 2 WS connections (header+subprotocol)
  - Sends one message A -> B
  - Verifies BOTH clients receive the delivered message

  Usage:
    node tools/smoke_connectivity.js

  Optional env:
    BASE_URL=http://localhost:3000
    API_PREFIX=/api/v1
*/

const http = require('http');
const WebSocket = require('ws');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const API_PREFIX = process.env.API_PREFIX || '/api/v1';
const base = new URL(BASE_URL);

function apiPath(p) {
  const prefix = String(API_PREFIX || '').trim() || '';
  const normPrefix = prefix.startsWith('/') ? prefix : `/${prefix}`;
  const normPath = p.startsWith('/') ? p : `/${p}`;
  return `${normPrefix}${normPath}`;
}

async function retry(fn, { tries = 10, delayMs = 250 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i += 1) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      await sleep(delayMs);
    }
  }
  throw lastErr;
}

function requestJson(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        hostname: base.hostname,
        port: base.port || 80,
        path,
        method,
        headers: {
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
          ...headers,
        },
      },
      (res) => {
        let s = '';
        res.on('data', (d) => (s += d));
        res.on('end', () => {
          let json = null;
          try {
            json = s ? JSON.parse(s) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode, body: s, json });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function randomHex(n = 8) {
  return Math.random().toString(16).slice(2, 2 + n);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function wsConnect({ token, label }) {
  const uri = new URL('/ws', BASE_URL);

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(uri.toString().replace(/^http/i, 'ws'), ['bearer', token], {
      headers: { Authorization: `Bearer ${token}` },
    });

    const messages = [];
    let done = false;

    const finish = (ok, why) => {
      if (done) return;
      done = true;
      resolve({ ok, why, ws, messages, label });
    };

    ws.on('message', (d) => {
      const text = String(d);
      messages.push(text);
      try {
        const msg = JSON.parse(text);
        if (msg && msg.type === 'welcome') {
          return finish(true, 'welcome');
        }
      } catch {
        // ignore
      }
    });

    ws.on('close', (code, reason) => {
      if (!done) finish(false, `close ${code} ${String(reason || '')}`);
    });

    ws.on('error', (e) => {
      if (!done) finish(false, `error ${(e && e.message) || String(e)}`);
    });

    setTimeout(() => {
      if (!done) finish(false, 'timeout waiting welcome');
    }, 2500);

    ws.once('open', () => {
      // wait for welcome message
    });
  });
}

async function recvMessage(wsConn, timeoutMs = 2500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const raw of wsConn.messages) {
      try {
        const msg = JSON.parse(raw);
        if (msg && msg.type === 'message' && msg.payload) return msg;
      } catch {
        // ignore
      }
    }
    await sleep(50);
  }
  return null;
}

async function main() {
  console.log(`BASE_URL=${BASE_URL}`);
  console.log(`API_PREFIX=${API_PREFIX}`);

  // 0) Health (retry to tolerate nodemon restarts)
  const health = await retry(() => requestJson('GET', '/', undefined), { tries: 20, delayMs: 200 });
  if (health.status !== 200) throw new Error(`Health failed: ${health.status} ${health.body}`);

  async function mkUser(label) {
    const email = `connect-${label}-${randomHex(12)}@example.com`;
    const password = 'Password123!';
    const deviceId = `dev-${randomHex(16)}`;

    const reg = await requestJson('POST', apiPath('/auth/register'), {
      email,
      password,
      publicKey: 'pk',
      encryptedPrivateKey: 'epk',
      mac: 'mac',
      nonce: 'nonce',
      salt: 'salt',
      iv: 'iv',
    });
    if (reg.status < 200 || reg.status >= 300) {
      throw new Error(`register ${label} failed: ${reg.status} ${reg.body}`);
    }

    const login = await requestJson(
      'POST',
      apiPath('/auth/login'),
      { email, password },
      { 'x-device-id': deviceId, 'user-agent': 'smoke-connectivity' }
    );
    if (login.status !== 200) {
      throw new Error(`login ${label} failed: ${login.status} ${login.body}`);
    }

    const token = login.json && login.json.data && login.json.data.token;
    const refreshToken = login.json && login.json.data && login.json.data.refreshToken;
    if (!token) throw new Error(`login ${label} missing token`);

    const me = await requestJson('GET', apiPath('/auth/me'), undefined, { Authorization: `Bearer ${token}` });
    if (me.status !== 200) {
      throw new Error(`me ${label} failed: ${me.status} ${me.body}`);
    }

    const userId = me.json && me.json.data && me.json.data.user && me.json.data.user.id;
    if (!userId) throw new Error(`me ${label} missing user id`);

    return { label, email, password, deviceId, token, refreshToken, userId };
  }

  const A = await mkUser('A');
  const B = await mkUser('B');

  const wsA = await retry(() => wsConnect({ token: A.token, label: 'A' }), { tries: 15, delayMs: 200 });
  const wsB = await retry(() => wsConnect({ token: B.token, label: 'B' }), { tries: 15, delayMs: 200 });

  if (!wsA.ok) throw new Error(`WS A failed: ${wsA.why}`);
  if (!wsB.ok) throw new Error(`WS B failed: ${wsB.why}`);

  // Send message A -> B. Sender is enforced server-side from JWT.
  wsA.ws.send(
    JSON.stringify({
      type: 'message',
      payload: {
        receiver_id: B.userId,
        encrypted_message: 'ciphertext-placeholder',
        // malicious/ignored fields:
        sender_id: 999999,
      },
    })
  );

  const mA = await recvMessage(wsA, 3000);
  const mB = await recvMessage(wsB, 3000);

  const okA = !!mA;
  const okB = !!mB;

  const details = {
    http: { health: true, A: { id: A.userId }, B: { id: B.userId } },
    ws: {
      A: { welcome: wsA.ok, gotMessage: okA },
      B: { welcome: wsB.ok, gotMessage: okB },
    },
    message: {
      A_payload_sender_id: mA && mA.payload && mA.payload.sender_id,
      A_payload_receiver_id: mA && mA.payload && mA.payload.receiver_id,
      B_payload_sender_id: mB && mB.payload && mB.payload.sender_id,
      B_payload_receiver_id: mB && mB.payload && mB.payload.receiver_id,
    },
  };

  // Close sockets
  try {
    wsA.ws.terminate();
  } catch {}
  try {
    wsB.ws.terminate();
  } catch {}

  console.log(JSON.stringify(details, null, 2));

  if (!okA || !okB) process.exit(20);

  // Validate server enforced sender_id == A.userId
  if (details.message.A_payload_sender_id !== A.userId || details.message.B_payload_sender_id !== A.userId) {
    process.exit(21);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
