# Nosh Dish Dashboard

A dish-management dashboard with **local draft editing**, **backend validation** and **optimistic-concurrency (version) protection** against conflicting updates. React (Vite) frontend, Node.js/Express backend, SQLite database.

The optional bonus feature—automatically detecting external updates through polling—is also implemented.

## Prerequisites

- **Node.js 22.5 or newer**. The backend uses Node's built-in `node:sqlite` module. The npm scripts pass `--experimental-sqlite`, which is required on Node versions before 22.13 / 23.4 and harmless on newer versions.
- npm

## Setup and run

```bash
# 1. Backend
cd backend
npm install
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
npm run seed                # loads backend/data/dishes.json (idempotent)
npm start                   # http://localhost:4000

# 2. Frontend (second terminal)
cd frontend
npm install
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
npm run dev                 # http://localhost:5173
```

Other commands: `npm test` (backend API tests), `npm run build` (frontend production build), and `npm run dev` in the backend for automatic restarts during development.

### Database initialization and seed command

No separate migration step is needed. The schema is created automatically on first start in `src/db.js`.

Run `npm run seed` from `backend/` to load `backend/data/dishes.json` (the supplied assignment data). The seed command uses `INSERT OR IGNORE` with `version = 1`. Re-running it **does not duplicate dishes or overwrite saved edits or versions**. A different file can be loaded with `npm run seed -- --file path/to/file.json`.

### Environment variables

`backend/.env` (see `.env.example`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `4000` | API port |
| `DB_PATH` | `./data/nosh.db` | SQLite file (relative to `backend/`) |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed browser origin |

`frontend/.env` (see `.env.example`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_API_URL` | `http://localhost:4000` | Backend base URL |
| `VITE_POLL_INTERVAL_MS` | `4000` | Polling interval, capped at 5000 ms |

No secrets are required.

## API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/dishes` | All dishes: `dishId, dishName, imageUrl, isPublished, version` |
| PATCH | `/dishes/:dishId` | Save `dishName` and `isPublished` if `expectedVersion` matches |
| GET | `/health` | Liveness check |

```bash
curl http://localhost:4000/dishes

curl -X PATCH http://localhost:4000/dishes/2 \
  -H "Content-Type: application/json" \
  -d '{"dishName":"Paneer Curry","isPublished":true,"expectedVersion":1}'
```

PowerShell equivalent:

```powershell
Invoke-RestMethod -Method Patch -Uri http://localhost:4000/dishes/2 -ContentType 'application/json' `
  -Body '{"dishName":"Paneer Curry","isPublished":true,"expectedVersion":1}'
```

### Response codes

| Status | When | Body |
| --- | --- | --- |
| 200 | Saved | Saved dish with incremented `version` |
| 400 | Invalid types, invalid `dishId` / `expectedVersion`, malformed JSON, or publishing with an empty name / invalid image URL | `{error:"ValidationError", message, details:[{field,message}]}` |
| 404 | Unknown `dishId` | `{error:"NotFound", message}` |
| 409 | `expectedVersion` differs from the stored version | `{error:"VersionConflict", message, currentDish}` — no changes are made |
| 500 | Unexpected failure | `{error:"InternalServerError", message}` — details are logged, not exposed |

Validation order: request body and ID shape (400) → dish exists (404) → version matches (409) → publish rules against the stored image URL (400).

## Architecture

```text
backend/
  src/config.js          environment and paths
  src/db.js              opens SQLite and creates schema
  src/validation.js      validation helpers (types, IDs, HTTP(S) URL, publish rules)
  src/dishRepository.js  SQL and compare-and-set update
  src/routes/dishes.js   HTTP layer: validation, repository call, status code
  src/app.js             Express app and error handling
  src/server.js          server entry point
  scripts/seed.js        idempotent seeding
  test/api.test.js       backend API tests
frontend/
  src/api.js             fetch wrapper and ApiError (status 0 = network failure)
  src/hooks/useDishes.js state, save/discard/reload and polling
  src/components/DishCard.jsx presentational dish card
  src/App.jsx            loading, error, empty and list states
```

### Frontend state model

- `saved[id]` is the last server-confirmed dish and its version.
- `drafts[id]` is created when the user edits and is not sent to the server until Save.
- A dish is **dirty** when its draft differs from `saved`; the UI indicates this with an amber card, an “Unsaved changes” badge and separate “Saved name/status” lines.
- Save sends the draft with `saved[id].version`, the version on which the draft was based.
- Discard removes the draft, so the inputs show the last saved values again.

### Failure handling

Validation, not-found, server and network errors keep the draft and show an error; the Save button becomes **Retry save**. A `409 VersionConflict` also keeps the draft and explains that another update occurred. The user can choose **Reload latest** and confirm to discard their draft. The client does not automatically retry using a newer version.

## Design decision: optimistic locking inside a transaction

Each dish has an integer `version`. An update runs in a `BEGIN IMMEDIATE` transaction: it reads the row, checks the expected version, applies publish rules to the stored image URL, then executes an update guarded by `WHERE dish_id = ? AND version = ?` and increments the version.

`BEGIN IMMEDIATE` obtains the SQLite write lock at the start of the transaction, preventing another writer from interleaving a conflicting write between the read and update. The `WHERE version = ?` condition adds a compare-and-set guard so an update only succeeds when the stored version still matches the version the client edited. This prevents silent last-write-wins overwrites. The published status is saved as the explicit `isPublished` value rather than toggled.

The automated test suite checks concurrent PATCH requests using the same `expectedVersion` and verifies that only one update succeeds while the others receive `409` conflicts.

## Bonus: external updates (polling)

- The dashboard polls `GET /dishes` every 4 seconds by default (configurable, capped at 5 seconds), so an external API update should appear within about 4 seconds, with up to about 5 seconds between polls.
- Dishes without drafts update automatically. If a dish has an unsaved draft, the draft is preserved and the card displays a “Newer saved data is available (version N)” notice with a guarded reload option.
- The polling interval, `visibilitychange` listener and in-flight request (`AbortController`) are cleaned up when the effect is removed. Hidden tabs skip polling and poll immediately when visible again; overlapping requests are skipped.
- A failed poll displays a “Connection lost, retrying” banner. A later successful poll clears it. Older responses are ignored if the UI already holds a newer version.
- Direct database edits are not detected.

## Verification

The following checks were completed manually, and the automated backend tests and frontend production build passed:

1. **Drafts are local:** Edited a dish without saving and confirmed the database values remained unchanged. Discard restored the saved values.
2. **Two-tab conflict:** Saved a change in tab A, then attempted to save an older draft in tab B. Tab B displayed the version-conflict message and retained its draft.
3. **Backend unavailable and retry:** Stopped the backend and clicked Save. The UI displayed a connection error and retained the draft. After restarting the backend, Retry save successfully saved the change.
4. **External update polling:** Updated a dish through the API using `curl` and confirmed the dashboard reflected the update within approximately 4 seconds.
5. **Seed safety and persistence:** Re-running the seed command did not overwrite saved edits or versions. Saved data persisted after a backend restart.
6. **Validation:** Publishing a dish with an empty name or invalid stored image URL was rejected, and the database remained unchanged.
7. **API error handling:** Invalid input returned `400`, an unknown dish returned `404`, and stale versions returned `409`.
8. **Automated checks:** `npm test` passed, and the frontend production build succeeded.

## Time spent

Approximately **9 hours** were spent on the required assignment, implementation, verification and polling bonus.

## AI / reused-code disclosure

I used **Claude Code** as an AI coding assistant to help interpret the assignment, plan the implementation and work through parts of the code. I reviewed the implementation, checked how the backend validation and version-based updates work, and tested the frontend and API flows. I am responsible for understanding the submitted code and being able to explain the design decisions, including the transaction-based update logic and the frontend draft/conflict handling. The project uses the assignment-provided seed data and standard project dependencies; no additional third-party code was intentionally copied.