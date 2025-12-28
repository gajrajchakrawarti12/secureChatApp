# Simple Auth Backend

Files added:

- [script.js](script.js) — Express server with `/signup` and `/login` endpoints.
- [package.json](package.json) — dependencies and run scripts.
- [.env](.env) — database credentials (provided).

Quick start

1. Install dependencies:

```bash
npm install
```

1. Ensure MySQL is running and accessible with the credentials in `.env`.

1. Start the server:

```bash
npm start
# or for development with auto-reload
npm run dev
```

Endpoints

- `POST /auth/signup` — JSON body: `{ "email": "you@example.com", "password": "secret" }`
- `POST /auth/login` — JSON body: `{ "email": "you@example.com", "password": "secret" }` — returns `{ "token": "..." }` on success

Protected route example:

- `GET /profile` — Requires header `Authorization: Bearer <token>`; returns the authenticated user's info.

The server will create the database `testdb` and the `users` table if they do not exist.
