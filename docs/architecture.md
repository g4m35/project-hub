# Architecture

React/Vite renders the same interface in two modes. `npm run build` produces local mode; `npm run build:cloud` produces cloud mode with owner sign-in.

| Area | Responsibility |
| --- | --- |
| `src/` | Stack map, projects, issues, deployments, chats, subscriptions and sign-in |
| `server/` | Loopback HTTP API, safe folder scans, providers and shared normalization |
| `api/`, `cloud/` | Vercel API, owner authorization, CSRF, encrypted credentials and Neon persistence |
| `scripts/` | Setup/doctor, empty database initialization, optional webhooks and read-only Mac sync |
| `test/`, `examples/` | Automated checks and synthetic examples |

Local mode binds only to `127.0.0.1`, checks Host/Origin and protects writes with an ephemeral CSRF token. It is a trusted-local-user application, not a network server. A fresh installation does not scan folders or read chats until the user requests those features.

Cloud mode verifies the session with Neon on each protected request, restricts it to the configured verified owner email, binds CSRF to that session, and checks Origin for writes. Machine endpoints use separate HMAC/Bearer credentials; a chat credential cannot read or edit the owner workspace. Postgres data is private to the server role, with a single owner record per installation.

Stack edges express detected service roles, not traced calls. Provider failures are displayed explicitly. Vercel events are signature-checked and constrained to linked projects. Chat metadata becomes offline after 45 seconds without a successful upload. No background cloud job reads the Mac.
