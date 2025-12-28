# Production Hardening Report (Secure Chat)

Date: 2025-12-27

Scope: Node.js backend (Express + ws + MySQL + Firebase Admin) and Flutter client. This report documents security hardening work completed during this session, focusing on production readiness while preserving the E2EE threat model.

> IMPORTANT: This report intentionally **does not** include secrets (DB passwords, encryption keys, JWT secrets). Treat `.env` and any deployment environment variables as sensitive. Rotate any secrets that may have been exposed outside your trusted environment.

---

## A Executive Summary

### Goals

- Implement a production-hardening pass end-to-end (not just review).
- Preserve the existing E2EE model: server transports/stores ciphertext only and must not learn plaintext.
- Harden auth/session lifecycle, WebSockets, push notifications, and at-rest secret storage.

### Outcomes (high level)

- **Refresh tokens migrated toward opaque, hashed-at-rest sessions** with rotation, reuse detection, and **strict device binding in production**.
- **WebSocket authentication hardened**: no query-string JWTs; only `Authorization: Bearer` header or `Sec-WebSocket-Protocol: bearer,<token>`.
- **Push token storage hardened**: encrypted at rest (AES-256-GCM) + token hash for dedupe; server-side cleanup on logout.
- **Push delivery hardened**: FCM payload is **data-only**; client displays generic local notifications and routes safely.
- **Flutter auth hardened**: access tokens held in-memory, refresh single-flight, retry-once on 401 then logout.
- **Crypto hardening**: HKDF-SHA256 directional separation, deterministic nonce derivation, TOFU pinning + explicit trust action.
- **Logging hardening**: redaction helper for tokens; avoid printing secrets.

---

## B Threat Model & Non-Goals

### Threat model assumptions

- Network and server are potentially observable; server and push providers are not trusted with message plaintext.
- The backend may be compromised; it should not hold long-term plaintext secrets that allow decryption of chat content.
- Clients are trusted to perform E2EE correctly; device compromise is out of scope.

### Explicit non-goals

- Full key transparency / audit log infrastructure.
- Formal verification of cryptography.
- Multi-device key sync with recovery (beyond device-local key wrapping).

---

## C Authentication, Sessions, and Token Lifecycle

### Backend: access tokens

- Short-lived JWT access tokens remain the bearer access token.
- Production guard rails:
  - `JWT_SECRET` must be strong in production (`src/config/env.js` enforces this).

### Backend: refresh tokens (new preferred path)

- **Opaque refresh tokens** shaped like `rt.<tokenId>.<secret>`.
- Stored server-side as **hash-only** (bcrypt) and rotated on each refresh.
- Includes defensive behaviors:
  - Rotation / reuse detection.
  - On suspicious use, revoke-all for that user.

### Device binding (strict in production)

- For opaque refresh flows, backend enforces `x-device-id` in production:
  - `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout` reject missing `x-device-id` when `NODE_ENV=production`.
- If a session is bound to a device ID, a mismatch causes failure and triggers defensive revocation.

### Flutter: token handling

- Access token: kept **in memory** (not persisted).
- Refresh token: persisted (secure storage abstraction), used only for refresh.
- HTTP client:
  - Adds `Authorization: Bearer <access>`.
  - On `401`, runs **single-flight refresh**.
  - Retries the request once after refresh.
  - If refresh fails, clears auth state (and should clear navigation stack per the app’s flow).

### Files (key)

- Backend:
  - `backend/src/modules/auth/refreshSessions.js`
  - `backend/src/modules/auth/auth.routes.js`
  - `backend/src/api/middleware/auth.js`
- Flutter:
  - `app/lib/src/core/networking/auth_session.dart`
  - `app/lib/src/core/networking/authenticated_http_client.dart`

---

## D Transport Security (HTTPS/WSS)

### Backend

- Behind-proxy aware HTTPS enforcement in production:
  - `app.set('trust proxy', true)`
  - Rejects requests unless `req.secure` or `x-forwarded-proto` indicates HTTPS.

### Flutter

- Network policy enforces HTTPS/WSS in release builds (prevents accidental downgrade).
- Configuration uses build-time defines:
  - `--dart-define=API_BASE=https://...`
  - `--dart-define=WS_URL=wss://...`

- Files (key)

- Backend: `backend/src/app/server.js`
- Flutter: `app/lib/src/core/networking/network_policy.dart`, `app/lib/main.dart`, `app/lib/src/core/config/config.dart`

---

## E WebSockets Hardening

### Policy

- **No query-string tokens**.
- Accept auth via:
  1) `Authorization: Bearer <JWT>` header
  2) `Sec-WebSocket-Protocol: bearer,<JWT>` subprotocol

### Server-side safeguards

- Reject unauthorized connections with close code `1008`.
- Message sender ID is derived from JWT (`ws.userId`) and not trusted from client payload.
- Rate limiting (token bucket) for WS messages.

### Runtime validation performed

- Confirmed:
  - No-token connects are rejected.
  - Header/subprotocol auth receives a `welcome` message.
  - Query token is rejected.

- Files (key)

- Backend: `backend/src/realtime/ws.js`
- Flutter: `app/lib/src/core/networking/websocket_service.dart`

---

## F End-to-End Encryption (E2EE) Crypto Hardening

### Directional key separation

- Conversation keys derived via HKDF-SHA256 with explicit `salt` and `info` separation.
- Separate send/receive keys (directionality) to reduce misuse risk and enable safer protocol evolution.

### Nonce safety

- Deterministic nonce derivation/management to prevent nonce reuse under the same key.
- AES-GCM is used with explicit nonces.

### Password-derived keys persistence

- Hard requirement: never persist password-derived keys.
- Device-local key wrapping used to persist only a wrapped private key blob.
- Legacy persisted derived key cleanup implemented.

### TOFU (Trust On First Use)

- Trust store pins a peer’s public key after first contact.
- On key change, client presents a safety warning and requires explicit trust action.

- Files (key)

- Flutter crypto core:
  - `app/lib/src/core/crypto/hkdf_sha256.dart`
  - `app/lib/src/core/crypto/conversation_keys.dart`
  - `app/lib/src/core/crypto/nonce_manager.dart`
  - `app/lib/src/core/crypto/trust_store.dart`
  - `app/lib/src/core/crypto/private_key_store.dart`
- Usage integrated into chat UI:
  - `app/lib/src/features/chat/ui/screens/chat_screen.dart`

---

## G Push Notifications Hardening

### Storage

- Push tokens are encrypted at rest using AES-256-GCM and keyed via a dedicated secret.
- Tokens are also hashed for dedupe and lookup without decrypting.
- On logout, backend performs best-effort deletion of all push tokens for the user.

### Delivery

- FCM payload changed to **data-only** (no `notification` field).
- Payload contains only metadata (no message plaintext): sender/receiver IDs, message ID, type.

### Client behavior

- Handles lifecycle: foreground, background, terminated.
- Avoids duplicate listeners.
- Uses local notifications for generic UI when appropriate.
- Push tap/open routing centralized and gated by auth state.

- Files (key)

- Backend:
  - `backend/src/infra/crypto/pushTokenCrypto.js`
  - `backend/src/modules/push/pushTokens.js`
  - `backend/src/modules/push/notification.js`
  - `backend/src/infra/db/migrations/sql/002_push_tokens.sql`
- Flutter:
  - `app/lib/src/core/notifications/push_notification_service.dart`
  - `app/lib/src/core/notifications/push_router.dart`

---

## H Database & Migrations

### MySQL

- Added a migration to support encrypted push token storage and indexing.
- Enforces association to users, supports dedupe by hash, and storage of cipher components.

- Files (key)

- `backend/src/infra/db/migrations/sql/002_push_tokens.sql`

---

## I Logging, Redaction, and Operational Safety

- Backend

- Avoid logging tokens. WS logging avoids emitting token material.
- Bearer parsing is case-insensitive.

- Flutter

- Added a redaction helper for debug logs to prevent accidental token leakage.
- Updated remaining raw prints in networking/push code paths to use the redaction logger.

- Files (key)

- Flutter: `app/lib/src/core/logging/secure_log.dart`
- Backend: `backend/src/api/middleware/auth.js`

---

## J Validation, Runbook, and Known Follow-ups

### Validation performed

- Flutter:
  - `flutter analyze` ran clean.
- Backend:
  - Syntax check for entrypoints.
  - Runtime auth smoke tests (register/login/refresh/logout) including device-bound behaviors.
  - Runtime WS auth smoke tests (no-token/header/subprotocol/query-token) verifying query-token is rejected.

### Runbook (local)

- Backend:
  - `npm run dev` (development)
  - Ensure MySQL is running and configured via environment.
- Production notes:
  - Set `NODE_ENV=production`.
  - Provide a strong `JWT_SECRET`.
  - Provide the push-token encryption key (base64 32 bytes) and ensure it is rotated and stored securely.
  - Run DB migrations before deploying.
  - Ensure TLS is terminated at a reverse proxy and `x-forwarded-proto` is set.

### Known follow-ups / remaining hardening opportunities

- Performance:
  - If any bulk crypto work still runs on the UI isolate (e.g., large history decrypt), consider moving to an isolate.
- Dependency & dead-code pruning:
  - Re-check `backend` for unused Firebase/Firestore code paths if MySQL-only deployments are intended.
- Production config alignment:
  - Flutter `Config` defaults currently point to `http://...` and `ws://...`; production builds should use `--dart-define` with `https://` and `wss://`.

---

## Appendix: Quick reference of major new/updated files

### Flutter (new)

- `app/lib/src/core/notifications/push_router.dart`
- `app/lib/src/core/logging/secure_log.dart`

### Flutter (updated)

- `app/lib/src/core/notifications/push_notification_service.dart`
- `app/lib/src/core/networking/authenticated_http_client.dart`

### Backend (notable areas)

- `backend/src/modules/auth/refreshSessions.js` (opaque refresh + device binding)
- `backend/src/modules/auth/auth.routes.js` (x-device-id enforcement + logout cleanup)
- `backend/src/realtime/ws.js` (no query-token auth; header/subprotocol only)
- `backend/src/modules/push/notification.js` (data-only push)
- `backend/src/modules/push/pushTokens.js` (encrypted push token storage + delete-all)
