# Talk frontend architecture

The frontend is the website people see and use. It lives in `frontend/`, uses React and TypeScript, and is built by Vite. Its workspace is `@talk/frontend`, with dependencies declared in `frontend/package.json`. Paths in this guide are relative to the repository root.

For authentication APIs, storage and email delivery, see [BACKEND.md](BACKEND.md).

## How the parts connect

```mermaid
flowchart LR
    Entry["frontend/src/main.tsx"] --> Auth["AuthProvider: session state"]
    Auth --> Router["AppRouter.tsx: URL selection"]
    Router --> Pages["pages/: screens"]
    Pages --> Components["components/: shared UI"]
    Pages --> Clients["lib/: authentication helpers"]
    Clients --> API["/api/auth: Express backend"]
    API --> Auth
```

The browser requests the current session from the backend. React holds the returned display profile and session status; the browser manages the HttpOnly session cookie. The backend decides whether a session is valid.

## Folder map

```text
frontend/
  src/
    main.tsx              React entry; mounts AuthProvider and AppRouter
    AppRouter.tsx         Routes, navigation events and page titles
    pages/                Landing, meeting, account and dashboard screens
    components/           Shared layouts, OTP boxes and feature sections
    lib/                  API clients, authentication state and SDK helpers
    hooks/                Media preview and embedded participant hooks
    index.css             Tailwind entry, CSS imports and base styles
    styles/               Site, dashboard, account and responsive styles
    design/               Shared design tokens and imported HTML markup
  public/                 Locally served images, fonts and videos
  index.html              HTML document containing the React root
  vite.config.ts          Build configuration and local API integration
  tsconfig.json           Frontend TypeScript scope, extending the root config
  package.json            Frontend workspace dependencies and commands
```

The active entry is `main.tsx` importing `AppRouter.tsx`. Routing uses browser History API events and a route switch, rather than React Router. Phone authentication pages are loaded lazily.

## Main screens

| URL | Screen file | Purpose |
| --- | --- | --- |
| `/` | [Landing.tsx](frontend/src/pages/Landing.tsx) | Landing page; combines imported HTML with React feature sections |
| `/webinars` | [Webinar.tsx](frontend/src/pages/Webinar.tsx) | Webinar information and registration preview |
| `/device-test`, `/test` | [DeviceTest.tsx](frontend/src/pages/DeviceTest.tsx) | Camera, microphone and speaker checks |
| `/meeting` | [MeetingRoom.tsx](frontend/src/pages/MeetingRoom.tsx) | Meeting preview, controls and whiteboard |
| `/bookings` | [Booking.tsx](frontend/src/pages/Booking.tsx) | Booking preview |
| `/sign-in`, `/sign-up` | [SignIn.tsx](frontend/src/pages/SignIn.tsx), [SignUp.tsx](frontend/src/pages/SignUp.tsx) | Email, Google and phone sign-in entry points |
| `/verify-email` | [VerifyEmail.tsx](frontend/src/pages/VerifyEmail.tsx) | Email OTP entry, resend and recovery |
| `/phone-sign-in`, `/verify-phone` | [PhoneSignIn.tsx](frontend/src/pages/PhoneSignIn.tsx), [VerifyPhone.tsx](frontend/src/pages/VerifyPhone.tsx) | Phone number, reCAPTCHA and SMS code entry |
| `/choose-account`, `/confirm-sign-in` | [ChooseAccount.tsx](frontend/src/pages/ChooseAccount.tsx), [ConfirmSignIn.tsx](frontend/src/pages/ConfirmSignIn.tsx) | Talk account selection and Google profile confirmation |
| `/dashboard` | [Dashboard.tsx](frontend/src/pages/Dashboard.tsx) | Authenticated overview, wrapped by `DashboardAccess` |

## Where to make changes

| Change | Start here |
| --- | --- |
| Add a page or URL | `frontend/src/pages/` and `frontend/src/AppRouter.tsx` |
| Change navigation or footer | `frontend/src/components/Navbar.tsx`, `Footer.tsx` and `Shell.tsx` |
| Change the hero/globe | `frontend/src/components/HeroGlobe.tsx`, `frontend/src/pages/Landing.tsx` and `frontend/src/styles/talk.css` |
| Change shared colors | `frontend/src/design/tokens.css`; check related rules in `frontend/src/styles/` |
| Change email OTP UI | `frontend/src/pages/VerifyEmail.tsx` and `frontend/src/components/OtpCodeInput.tsx` |
| Change session UI or redirects | `frontend/src/lib/auth.tsx` and `frontend/src/components/DashboardAccess.tsx` |
| Change email API requests | `frontend/src/lib/emailAuth.ts` |
| Change Google button/SDK integration | `frontend/src/components/GoogleSignIn.tsx` and `frontend/src/lib/googleIdentity.ts` |
| Change phone/reCAPTCHA integration | `frontend/src/lib/firebase.ts` and `frontend/src/lib/phoneAuth.ts` |
| Change media preview or whiteboard | `frontend/src/hooks/`, `frontend/src/components/CameraPreview.tsx` and `MeetingWhiteboard.tsx` |

`Landing.tsx` imports `frontend/src/design/landing.html` and mounts React sections into it. Some landing content therefore lives in that HTML file rather than in a standalone React component. Local asset URLs such as `/reference/...` map to files under `frontend/public/reference/`.

## Authentication from the browser

- **Email:** signup submits to the backend, then opens `/verify-email`. Successful code verification creates a Talk session and opens `/dashboard`.
- **Google:** the official Google Identity Services popup returns a credential to Talk. The backend verifies it, then the user reviews `/confirm-sign-in` before entering the dashboard.
- **Phone:** the Firebase browser SDK handles reCAPTCHA and the SMS code. Talk sends the resulting Firebase ID token to its backend for verification and exchanges it for a Talk session.

`DashboardAccess` waits for a session check, sends guests to sign-in and sends pending Google sessions to confirmation. It controls screen access; backend handlers enforce API authorization independently.

Authentication requests use same-origin `/api/auth/...` URLs and cookies. Firebase phone credentials stay in memory and are cleared after the backend exchange or when leaving the flow. Browser password-saving support is in `frontend/src/lib/browserPasswords.ts`.

## Run and build

From the repository root (install both workspaces with one command):

```powershell
npm ci
npm run dev
```

Open **http://localhost:3001**. The Vite plugin also mounts the Express authentication API, so development does not require a second backend command or API port.

The root `dev` and `build` scripts delegate to `@talk/frontend`. Vite's root is `frontend/`, while `envDir` points at the repository root to preserve the existing private `.env.local` configuration. Browser URLs remain `/src/...`, `/reference/...` and `/api/...`; physical workspace paths are not added to website URLs.

The development file server allows frontend sources and installed dependencies, keeping backend source and root account data outside its browser file boundary.

```powershell
npm run lint
npm run build
```

The build writes the frontend to `frontend/dist/`. `npm run preview` serves static files only. For local authentication with the built app, stop the development server, then run `npm start` with the existing local configuration.

Browser regressions are under `tests/`, including `email-auth-browser.mjs`, `google-confirmation-browser.mjs`, `firebase-phone-browser.mjs` and `hosting-auth-browser.mjs`. See [README.md](README.md#verify) for prerequisites and commands. Fixture tests do not send real email or SMS.

## Configuration and production boundary

`VITE_FIREBASE_*` values are public browser configuration. Anything prefixed `VITE_` can appear in the frontend build. SMTP passwords, database credentials, cookie keys and private test codes belong exclusively in backend/private configuration.

The prepared production architecture serves `frontend/dist/` from Firebase Hosting and rewrites `/api/...` requests to Cloud Run. The frontend keeps using same-origin API URLs. See [the deployment guide](deployment/FIREBASE_HOSTING.md) for configuration, readiness checks and required approvals.

The dashboard library, booking, chat and Q&A include sample/local preview behavior. Camera and microphone features use browser media APIs; these screens are not a deployed multi-user conferencing backend.
