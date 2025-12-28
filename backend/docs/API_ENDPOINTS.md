# API and WebSocket Endpoints — Detailed Reference

This document describes all HTTP endpoints and the WebSocket behavior implemented in this backend. It covers authentication requirements, request/response contracts, side effects, and example usage.

- Server bootstrap and route mounting: see [src/index.js](src/index.js)
- Server implementation: see [src/app/server.js](src/app/server.js)
- Route modules: see [src/api/routes/index.js](src/api/routes/index.js), [src/api/routes/auth.routes.js](src/api/routes/auth.routes.js), [src/api/routes/users.routes.js](src/api/routes/users.routes.js), [src/api/routes/messages.routes.js](src/api/routes/messages.routes.js), [src/api/routes/push.routes.js](src/api/routes/push.routes.js)
- Auth middleware: see [src/api/middleware/auth.js](src/api/middleware/auth.js)
- WebSocket server: see [src/realtime/ws.js](src/realtime/ws.js)

## Overview

- Base mount: `app.use('/api', apiRoutes)` in [src/app/server.js](src/app/server.js)
- Sub-routes under `/api`: `/auth`, `/user`, `/messages`, `/push` from [src/api/routes/index.js](src/api/routes/index.js)
- Health check: `GET /` returns `{ ok: true, message: 'backend running' }`
- Environment:
  - `PORT` (default 3000)
  - `JWT_SECRET` (default `changeme`)
  - `JWT_EXPIRES_IN` (default `1h`)
  - `DB_DRIVER` (default `mysql`; set to `firebase` to use Firestore)
  - Firebase Admin credentials (when `DB_DRIVER=firebase`):
    - `GOOGLE_APPLICATION_CREDENTIALS` (recommended; absolute path to service account JSON)
    - or `FIREBASE_SERVICE_ACCOUNT_PATH` (path to JSON)
    - or `FIREBASE_SERVICE_ACCOUNT_BASE64` (base64-encoded JSON content)

## Authentication

- Scheme: `Authorization: Bearer <JWT>` parsed and verified in [src/api/middleware/auth.js](src/api/middleware/auth.js)
- On success: `req.user` populated (e.g., `{ userId, email }`)
- On failure: `401` with `{ error: 'invalid or expired token' }`

Routes requiring JWT explicitly call `auth` middleware. Routes that do not include `auth` are publicly accessible.

## Root

### GET `/`

- Purpose: Service health check.
- Auth: Not required.
- Response: `{ ok: true, message: 'backend running' }`
- Source: [src/app/server.js](src/app/server.js)

## Auth Endpoints (mounted under `/api/auth`)

Source: [src/api/routes/auth.routes.js](src/api/routes/auth.routes.js)

### POST `/api/auth/register`

- Auth: Not required.
- Body (JSON):
  - `email` (string)
  - `password` (string)
  - `publicKey` (string)
  - `encryptedPrivateKey` (string)
  - `mac` (string)
  - `nonce` (string)
  - `salt` (string)
  - `iv` (string)
- Behavior:
  - Validates required fields; responds `400` on missing.
  - Rejects if email exists (`409`).
  - Hashes password with bcrypt; stores user.
- Success: `200` `{ ok: true, message: 'registration successful' }`
- Errors: `400`, `409`, `500`.

Example:

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email":"alice@example.com",
    "password":"secret",
    "publicKey":"...",
    "encryptedPrivateKey":"...",
    "mac":"...","nonce":"...","salt":"...","iv":"..."
  }'
```

### POST `/api/auth/login`

- Auth: Not required.
- Body: `{ email, password }`
- Behavior:
  - Verifies credentials; `401` on invalid.
  - Returns JWT `token`, `refreshToken` (saved server-side as a hash-only refresh *session*), and user `salt`.
- Success: `200` `{ ok, token, refreshToken, salt }`
- Errors: `401`, `500`.

Example:

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"secret"}'
```

### POST `/api/auth/refresh`

- Auth: Not required.
- Body: `{ refreshToken }`
- Behavior:
  - If `refreshToken` is an *opaque* token (format `rt.<tokenId>.<secret>`):
    - Looks up the refresh session by `tokenId`, verifies the secret against the stored hash, enforces expiry, and rotates transactionally.
    - Reuse detection: if a token is already revoked/replaced, the server revokes all refresh sessions for that user.
  - Legacy compatibility: if `refreshToken` is a JWT (older sessions), the server uses the legacy lookup/rotation path.
- Success: `200` `{ ok: true, token, refreshToken }`
- Errors: `401` (invalid token or not recognized), `500`.

Example:

```bash
curl -X POST http://localhost:3000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"<refresh>"}'
```

### POST `/api/auth/logout`

- Auth: Not required.
- Body: `{ refreshToken }`
- Behavior:
  - If `refreshToken` is opaque: verifies it against the stored hash and revokes the refresh session.
  - If `refreshToken` is legacy JWT: verifies JWT and deletes the matching stored hashed token.
- Success: `200` `{ ok: true, message: 'logged out' }`
- Errors: `400` (not found), `401` (invalid), `500`.

### GET `/api/auth/me`

- Auth: Required (`auth` middleware).
- Behavior:
  - Returns user record fields: `id, email, public_key, encrypted_private_key, mac, nonce, salt, iv, created_at`.
- Success: `200` `{ ok: true, user: { ... } }`
- Errors: `404` (user not found), `500`.

Example:

```bash
curl http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer <token>"
```

## User Endpoints (mounted under `/api/user`)

Source: [src/api/routes/users.routes.js](src/api/routes/users.routes.js)

### GET `/api/user/all`

- Auth: Required.
- Behavior: Lists other users (`id`, `public_key`), excluding the requester.
- Success: `200` `{ ok: true, users: [ ... ] }`
- Errors: `500`.

### GET `/api/user/:id/public-key`

- Auth: Required.
- Params: `id` (numeric user id)
- Success: `200` `{ ok: true, publicKey }`
- Errors: `404` (user not found), `500`.

### GET `/api/user/contacts`

- Auth: Required.
- Behavior: Returns users who have exchanged messages with the requester.
- Success: `200` `{ ok: true, contacts: [ { id, public_key } ] }`
- Errors: `500`.

## Message Endpoints (mounted under `/api/messages`)

Source: [src/api/routes/messages.routes.js](src/api/routes/messages.routes.js)

### GET `/api/messages/:id`

- Auth: Required.
- Params: `id` — the other user's numeric ID.
- Query:
  - `limit` (number, optional; default `50`, max `100`)
- Behavior: Fetches `messages` between the authenticated user (`req.user.userId`) and `:id`; ordered by `timestamp ASC`.
- Success: `200` `{ ok: true, messages: [ { id, sender_id, receiver_id, encrypted_message, timestamp } ] }`
- Errors: `400` (invalid ids), `500`.

Example:

```bash
curl "http://localhost:3000/api/messages/2?limit=50" \
  -H "Authorization: Bearer <token>"
```

> Note: This route is protected and requires a valid JWT.

## Push Notification Token Endpoints (mounted under `/api/push`)

Source: [src/api/routes/push.routes.js](src/api/routes/push.routes.js)

### POST `/api/push/register`

- Auth: Required; include `Authorization: Bearer <token>`.
- Body: `{ token }` — FCM device token.
- Behavior: Saves/updates the device token for the authenticated user.
- Success: `200` `{ ok: true }`
- Errors: `400` (missing token), `500`.

### Push message content

- The backend only sends **metadata-only** push notifications.
- No plaintext or ciphertext message content is included in push notifications.

### POST `/api/push/unregister`

- Auth: Required.
- Body: `{ token }`
- Behavior: Deletes the device token for the authenticated user.
- Success: `200` `{ ok: true }`
- Errors: `400` (missing token), `500`.

## WebSocket — `/ws`

Source: [src/realtime/ws.js](src/realtime/ws.js)

### Connect

- Path: `ws://<host>:<port>/ws`
- Auth: Required. The server rejects unauthenticated connections.
- On connect: server sends `{"type":"welcome","id":"<ws.id>"}`.

Supported ways to provide the JWT:

1. Header: `Authorization: Bearer <JWT>`
2. Query: `ws://<host>:<port>/ws?token=<JWT>`
3. Subprotocol header: `Sec-WebSocket-Protocol: bearer, <JWT>`

### Send a message

- Client message format:

```json
{
  "type": "message",
  "payload": {
    "receiver_id": 2,          // or use "to"
    "encrypted_message": "..." // or use "payload"
  }
}
```

- Validation:
  - Requires `receiver_id|to`
  - Requires `encrypted_message|payload`
  - The server ignores any client-supplied `sender_id` and uses the authenticated user from the JWT.
- Persistence: Inserts into `messages (sender_id, receiver_id, encrypted_message)`; reads back row for DB timestamp.

### Delivery

- Server delivers the saved message only to:
  - the authenticated sender's connected sockets, and
  - the receiver's connected sockets.

Server emits:

```json
{
  "type": "message",
  "payload": {
    "id": <number>,
    "sender_id": <number>,
    "receiver_id": <number>,
    "encrypted_message": "...",
    "timestamp": "<ISO or DB timestamp>"
  },
  "from": "<ws.id>",
  "ts": <unix_ms>
}
```

### Example client (Node.js)

```js
const WebSocket = require('ws');
const token = process.env.ACCESS_TOKEN;
const ws = new WebSocket(`ws://localhost:3000/ws?token=${encodeURIComponent(token)}`);
ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'message',
    payload: { receiver_id: 2, encrypted_message: '...' }
  }));
});
ws.on('message', (data) => console.log('recv:', data.toString()));
```

## Database Tables (referenced)

- MySQL (default):
  - `users`: `id, email, password_hash, public_key, encrypted_private_key, mac, nonce, salt, iv, created_at`
  - `refresh_tokens`: `id, user_id, token`
  - `messages`: `id, sender_id, receiver_id, encrypted_message, timestamp`

- Firebase (when `DB_DRIVER=firebase`):
  - Collection `users`: same fields as above; `id` is an auto-incremented integer managed via transactions.
  - Collection `refresh_tokens`: `{ id, user_id, token, created_at }` (token stored hashed).
  - Collection `messages`: `{ id, sender_id, receiver_id, encrypted_message, timestamp }`.
  - Collection `push_tokens`: `{ id, user_id, token, created_at }` for device tokens used by FCM.

## Logging & Request IDs

- `morgan` with custom format logs request `id` and `user` if available: see [src/app/server.js](src/app/server.js).
- Errors use `logError()` where applicable: see [src/infra/logging/logger.js](src/infra/logging/logger.js).

## Common Errors

- `400`: Missing or invalid input.
- `401`: Missing/invalid JWT in `Authorization` header.
- `404`: Resource not found.
- `409`: Conflict (e.g., email already registered).
- `500`: Internal server error.

## Notes & Recommendations

- Rotate `JWT_SECRET` and set via environment; avoid default `changeme`.
- Consider rate limiting and input length constraints for message payloads.
- Ensure TLS (HTTPS/WSS) for production deployments.

## Firebase Setup (Windows PowerShell)

To use Firebase Firestore as the database while preserving all request/response formats:

```powershell
$env:DB_DRIVER = "firebase"

# Recommended: point to your service account file
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\\secure\\service-account.json"

# Alternatively:
# $env:FIREBASE_SERVICE_ACCOUNT_PATH = "C:\\secure\\service-account.json"
# $env:FIREBASE_SERVICE_ACCOUNT_BASE64 = "<base64-encoded-json>"

$env:JWT_SECRET = "your-strong-secret"
npm start
```

---

Generated from project sources to describe current behavior precisely. If routes change, update this document accordingly.
