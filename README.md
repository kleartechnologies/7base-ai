# MARKA

An AI marketing manager for small businesses, starting with Malaysian restaurants and F&B.

> **Status: Phase 1 — Foundation.**
> This repository contains the architecture, the application shell and a
> working chat pipeline. It does not yet contain the campaign engine, creative
> generation, website analysis, social integrations or billing. See
> [Not built yet](#not-built-yet).

---

## The idea

MARKA is not a poster generator or a copywriting tool. The owner says what they
want to achieve — *"my weekday sales are slow, what should I do?"* — and MARKA
diagnoses the opportunity, decides what to promote, and builds the campaign.

Two rules shape the whole codebase:

- **Chat is the intelligence. Tabs are the workspace.** The user talks to MARKA
  in the main area; the structured output is saved and later found under
  Campaigns, Creative, Calendar and Results.
- **MARKA discovers, the user confirms.** Onboarding is a name and an optional
  website — never a questionnaire. Anything MARKA can work out for itself, it
  should.

---

## Stack

| Layer | Choice |
|---|---|
| Frontend | React 19, TypeScript, Vite 7 |
| Styling | Tailwind CSS v4 (CSS-first), shadcn/ui primitives, Lucide icons |
| Routing | React Router 7 |
| Backend | Firebase Cloud Functions v2 (Node 22) |
| Data | Firestore, Firebase Storage, Firebase Auth |
| AI | OpenAI **Responses API**, called only from Cloud Functions |
| Hosting | Netlify (frontend), Firebase (backend) |
| Payments | Billplz — architecture only, not implemented |

---

## Architecture

### The AI boundary

The browser never talks to OpenAI. It never sees a prompt, a model name or a key.

```
React component
  └─ services/ai/ai.client.ts        ← the only door out of the frontend
       └─ httpsCallable (authenticated)
            └─ functions/src/chat/assistantReply.ts   ← re-checks ownership
                 └─ functions/src/ai/orchestrator.ts  ← task in, blocks out
                      └─ functions/src/config/models.ts  ← model routing
                           └─ OpenAI Responses API
                                └─ Firestore
                                     └─ onSnapshot → React
```

Three consequences worth knowing before you extend this:

1. **The client sends ids, never content.** `chatAssistantReply` receives a
   conversation id and re-reads the thread from Firestore. A tampered client
   cannot inject fake history, steer the system prompt, or read another
   business's context.
2. **MARKA's replies are written server-side.** Firestore rules reject any
   client write with `role != 'user'`, so a reply from MARKA cannot be forged.
3. **Adding an AI capability means adding a function**, not an API call inside
   a component. If you find yourself importing the OpenAI SDK anywhere under
   `src/`, something has gone wrong.

### Structured output from day one

Assistant messages are stored as `blocks[]`, not strings. Plain prose is just a
single `text` block. The union in `src/types/chat.ts` already declares
`recommendation`, `action`, `campaign_card` and `creative_preview`; adding one
means writing a renderer case in `BlockRenderer.tsx` — the chat transport,
storage schema and scroll behaviour do not change.

### Model configuration

Model names live in exactly one file: `functions/src/config/models.ts`. Tasks
ask for a *tier* (`reasoning`, `fast`, `image`), not a model, and each tier can
be overridden per deploy with an environment variable — so changing models is a
config change, not a code change.

### Folder layout

```
src/
├─ app/                    Router, providers, error boundary
│  ├─ providers/           AuthProvider + auth context
│  └─ routes/              Route guards and the path table
├─ components/ui/          Vendored shadcn primitives
├─ features/
│  ├─ auth/                Sign in / sign up
│  ├─ chat/                The main surface: hooks, composer, blocks
│  └─ shell/               Sidebar, navigation, app frame
├─ pages/                  Workspace tabs (placeholders for now)
├─ services/               THE data boundary — components never touch Firebase
│  ├─ ai/                  Callable client + wire types
│  ├─ auth/  business/  chat/  campaigns/  storage/  billing/
├─ lib/
│  ├─ firebase/            SDK init, typed collections, error mapping
│  └─ env.ts               Validated environment access
└─ types/                  Domain contracts (Business Brain, Campaign, …)

functions/src/
├─ ai/                     OpenAI client, orchestrator, prompts, context
├─ chat/                   Callable endpoints
├─ config/models.ts        Model registry + task routing
└─ lib/                    Admin SDK, auth checks, error mapping
```

**The one rule to preserve:** UI components talk to `services/`; only
`services/` and `lib/firebase/` import the Firebase SDK.

### The Business Brain

`src/types/business.ts` models everything MARKA can know about a business.
Discovered sections are wrapped in `Discovered<T>`, which carries the source,
a confidence score and whether a human has confirmed it — so the Business tab
can show *what MARKA found* and let the owner correct it, rather than asking
them to fill it in.

---

## Running locally

### 1. Install

```bash
npm install
npm --prefix functions install
```

### 2. Configure

```bash
cp .env.example .env.local
```

Fill in the Firebase web config from **Firebase Console → Project settings →
Your apps → Web app**. Everything in `.env.local` is public — it is inlined
into the JavaScript bundle. Never put an OpenAI or Billplz key there.

Without this file the app boots to a setup screen naming the missing variables.

### 3. Run

```bash
npm run dev          # http://localhost:5173
```

### Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run lint` | ESLint across app and functions |
| `npm run verify` | Lint + frontend build + functions build |
| `npm --prefix functions run build` | Compile Cloud Functions |
| `firebase emulators:start` | Auth, Firestore, Functions, Storage locally |

To use the emulators, set `VITE_USE_FIREBASE_EMULATORS=true` in `.env.local`.

---

## Environment variables

### Frontend (`.env.local`, and Netlify build environment) — all public

| Variable | Required | Notes |
|---|---|---|
| `VITE_FIREBASE_API_KEY` | yes | |
| `VITE_FIREBASE_AUTH_DOMAIN` | yes | |
| `VITE_FIREBASE_PROJECT_ID` | yes | |
| `VITE_FIREBASE_STORAGE_BUCKET` | yes | |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | yes | |
| `VITE_FIREBASE_APP_ID` | yes | |
| `VITE_FIREBASE_MEASUREMENT_ID` | no | Only if Analytics is enabled |
| `VITE_FIREBASE_FUNCTIONS_REGION` | no | Defaults to `asia-southeast1` |
| `VITE_USE_FIREBASE_EMULATORS` | no | `true` to use local emulators |
| `VITE_APP_ENV` | no | `local` \| `preview` \| `production` |

### Backend — secret, never in any `.env` the frontend can read

```bash
firebase functions:secrets:set OPENAI_API_KEY
```

Optional per-deploy model overrides: `MARKA_MODEL_REASONING`,
`MARKA_MODEL_FAST`, `MARKA_MODEL_IMAGE` (tier-wide, every plan), and
`MARKA_MODEL_BASIC_REASONING`, `MARKA_MODEL_BASIC_FAST`,
`MARKA_MODEL_PRO_REASONING`, `MARKA_MODEL_PRO_FAST` (per plan; beat the
tier-wide ones). Defaults live in `functions/src/config/models.ts`.

### Subscription plans (model routing)

The AI model an account gets is decided server-side by its subscription plan
— `basic` (the fail-safe default for every account) or `pro`. The source of
truth is the Admin-only `subscriptions/{uid}` Firestore document
(`planId: 'basic' | 'pro'`, `status: 'active' | 'past_due' | 'cancelled'`);
security rules refuse every client write, so an account cannot upgrade
itself. Pro requires `planId: 'pro'` **and** `status: 'active'`; anything
else — including a missing document — routes as Basic.

To test Pro locally, either set the env override for the Functions emulator
(honoured only inside the emulator):

```bash
MARKA_DEV_PLAN_OVERRIDE=pro firebase emulators:start
```

or write a `subscriptions/<uid>` document with the Admin SDK / emulator UI.
The selected plan and model appear in the `ai.request.complete` telemetry
log line of every model call.

---

## Firebase setup

1. **Create the project** and register a **Web app**; copy the config into
   `.env.local`.
2. **Authentication → Sign-in method:** enable **Email/Password** and **Google**.
3. **Firestore:** create the database in a region near your users
   (`asia-southeast1`).
4. **Storage:** enable it.
5. **Blaze plan:** required — Cloud Functions cannot be deployed on Spark.
6. **Link the CLI and deploy the rules:**

   ```bash
   firebase login
   firebase use --add                      # select your project
   firebase deploy --only firestore:rules,storage:rules,firestore:indexes
   ```

7. **Set the OpenAI secret and deploy the backend:**

   ```bash
   firebase functions:secrets:set OPENAI_API_KEY
   firebase deploy --only functions
   ```

8. **Authorised domains:** add your Netlify domain under
   **Authentication → Settings → Authorized domains**, or Google sign-in will
   fail in production.

Until step 7 is done the app runs fine — messages send and save — but MARKA
replies with a clear "AI backend is not configured yet" notice instead of an
answer.

---

## Deploying to Netlify

`netlify.toml` is already configured: build command, publish directory, the SPA
redirect (without which a refresh on `/campaigns` 404s), asset caching and
security headers.

1. Connect the repository in Netlify.
2. Add every `VITE_*` variable under **Site settings → Environment variables**.
3. Deploy.

The backend deploys separately with `firebase deploy --only functions`.

### Storage CORS (required for poster downloads)

"Download Poster" composes the poster on a canvas from the stored visual, which
requires the browser to read the image cross-origin. The bucket must therefore
allow cross-origin GETs once per project:

```sh
gsutil cors set cors.json gs://<project>.firebasestorage.app
```

`cors.json` allows `GET`/`HEAD` only; object access itself is still gated by
the per-object download tokens, so this exposes nothing new. Without it the
canvas route fails and the app falls back to downloading the raw visual
without the text overlay — degraded, not broken.

---

## Security

- No secret is ever exposed to the browser. `OPENAI_API_KEY` is a Firebase
  secret resolved inside the function container.
- Firestore rules scope every document to `ownerId == request.auth.uid`. A user
  cannot read another user's business, conversations, campaigns or creatives.
- The Admin SDK bypasses security rules, so **every callable re-checks
  ownership itself** — see `functions/src/lib/auth.ts`. Do not skip this in new
  functions.
- Storage objects live under `businesses/{businessId}/…` and are authorised by
  looking up that business's owner in Firestore, so file access can never
  diverge from data access.
- Messages are immutable once written, and clients can only ever create their
  own `role: 'user'` turn.

---

## Not built yet

Deliberately out of scope for Phase 1: website crawling and analysis, Facebook /
Instagram / Meta Ads / WhatsApp integrations, Billplz and subscription billing,
AI campaign generation, AI image and copy generation, analytics, the creative
editor, autonomous agents, multi-industry support, and any admin panel.

The data model, service boundaries and block union are all shaped to accept
these without a rewrite.
