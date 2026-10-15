# Frontend

This workspace contains Talk's website: React pages and components, browser authentication, styles and public assets.

- Code: [`src/`](src/)
- Assets: [`public/`](public/)
- Build configuration: [`vite.config.ts`](vite.config.ts)
- Dependencies: [`package.json`](package.json)
- Full guide: [FRONTEND.md](../FRONTEND.md)

From the **repository root**, run `npm ci`, then `npm run dev`. Open http://localhost:3001. Development also mounts the Express authentication API from `backend/src/`; no second server is required.

`npm run build` writes `frontend/dist/`. Private `.env.local` stays at the repository root. Only public `VITE_` configuration may enter browser code.
