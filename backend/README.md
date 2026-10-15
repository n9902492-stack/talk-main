# Backend

This workspace contains Talk's Express authentication API, databases, provider verification and email delivery.

- Code and HTTP entry point: [`src/index.mjs`](src/index.mjs)
- Authentication routes: [`src/auth.mjs`](src/auth.mjs)
- SQLite migrations: [`src/migrations/`](src/migrations/)
- PostgreSQL migrations: [`src/postgres-migrations/`](src/postgres-migrations/)
- Runtime dependencies: [`package.json`](package.json)
- Production image: [`Dockerfile`](Dockerfile), with the repository root as build context
- Full guide: [BACKEND.md](../BACKEND.md)

From the **repository root**, run `npm ci`, then `npm run dev` for the combined local website and API at http://localhost:3001. For the standalone server, stop development, run `npm run build`, then `npm start`.

Private `.env.local` and local `data/` stay at the repository root and are excluded from Git. Production uses PostgreSQL and injected backend secrets; see [the deployment guide](../deployment/FIREBASE_HOSTING.md). Tests and preparation commands do not send real SMS or deploy the app.
