# Nosh Dish Dashboard

A dish-management dashboard with **local draft editing**, **backend validation** and **optimistic-concurrency (version) protection** against conflicting updates. React (Vite) frontend, Node.js/Express backend, SQLite database.

The optional bonus (picking up external updates automatically via polling) **is implemented**.

## Prerequisites

- **Node.js 22.5 or newer** (developed on 23.1). The backend uses Node's built-in `node:sqlite` module, so there is no native addon to compile. The npm scripts pass `--experimental-sqlite`, which is required on Node < 22.13 / 23.4 and harmless afterwards.
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

Other commands: `npm test` (backend, 10 API tests), `npm run build` (frontend), `npm run dev` in backend for auto-restart.

### Seed command

`npm run seed` (in `backend/`) reads `backend/data/dishes.json` (the supplied assignment data) and runs `INSERT OR IGNORE` with `version = 1`. Re-running it **never duplicates dishes and never overwrites saved edits or versions**. A different file can be loaded with `npm run seed -- --file path/to/file.json`.

### Environment variables

`backend/.env` (see `.env.example`)

| Variable      | Default                 | Meaning                                  |
| ------------- | ----------------------- | ---------------------------------------- |
| `PORT`        | `4000`                  | API port                                 |
| `DB_PATH`     | `./data/nosh.db`        | SQLite file (relative to `backend/`)     |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed browser origin                   |

`frontend/.env` (see `.env.example`)

| Variable                | Default                 | Meaning                                         |
| ----------------------- | ----------------------- | ----------------------------------------------- |
| `VITE_API_URL`          | `http://localhost:4000` | Backend base URL                                |
| `VITE_POLL_INTERVAL_MS` | `4000`                  | Polling interval, capped at 5000 ms             |

No secrets are required.

## API

| Method | Path             | Description                                   |
| ------ | ---------------- | --------------------------------------------- |
| GET    | `/dishes`        | All dishes: `dishId, dishName, imageUrl, isPublished, version` |
| PATCH  | `/dishes/:dishId`| Save `dishName`, `isPublished` if `expectedVersion` matches |
| GET    | `/health`        | Liveness check                                |

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

Responses

| Status | When | Body |
| ------ | ---- | ---- |
| 200 | Saved | the saved dish with the incremented `version` |
| 400 | Wrong types, invalid `dishId` / `expectedVersion`, bad JSON, or publishing with an empty name / invalid image URL | `{error:"ValidationError", message, details:[{field,message}]}` |
| 404 | Unknown `dishId` | `{error:"NotFound", message}` |
| 409 | `expectedVersion` ≠ stored version | `{error:"VersionConflict", message, currentDish}` – nothing is changed |
| 500 | Unexpected failure | `{error:"InternalServerError", message}` (details are logged, not leaked) |

Validation order: body/ID shape (400) → dish exists (404) → version matches (409) → publish rules against the stored image URL (400).

## Architecture

```
backend/
  src/config.js          env + paths
  src/db.js              opens SQLite, creates schema
  src/validation.js      pure validation helpers (types, ids, http(s) URL, publish rules)
  src/dishRepository.js  all SQL; compare-and-set update
  src/routes/dishes.js   HTTP layer: validate -> repository -> status code
  src/app.js             Express app + error handling;  src/server.js  entry point
  scripts/seed.js        idempotent seeding
  test/api.test.js       API tests (in-memory SQLite)
frontend/
  src/api.js             fetch wrapper, ApiError (status 0 = network failure)
  src/hooks/useDishes.js all state: saved / drafts / remote / per-dish UI, save/discard/reload, polling
  src/components/DishCard.jsx   presentational card
  src/App.jsx            loading / error / empty / list states
```

**Frontend state model.** `saved[id]` is the last server-confirmed copy (and its version). `drafts[id]` exists only after the user edits and is never sent until Save. A dish is "dirty" when its draft differs from `saved`, shown by an amber card, an "Unsaved changes" badge and the separate "Saved name/status" lines. Save sends the draft with `saved[id].version` (the version it was *loaded* at). Discard deletes the draft so the inputs show `saved` again.

**Failure handling.** 400/404/5xx/network errors keep the draft, show a message and relabel Save as "Retry save". A 409 keeps the draft, explains another update occurred, and offers *Reload latest (discards my draft)* behind a confirm dialog. The client never retries automatically and never re-sends with the newer version.

## Design decision: optimistic locking inside a transaction

Each dish has an integer `version`. The update runs in a `BEGIN IMMEDIATE` transaction: read the row, compare versions, apply publish rules to the stored image URL, then `UPDATE … WHERE dish_id = ? AND version = ?` with `version = version + 1`. `BEGIN IMMEDIATE` takes the write lock up-front, so the read used for validation and the write cannot interleave with another writer, and the `AND version = ?` guard is a second line of defence. The status is saved as the explicit `isPublished` value, never toggled. Compared to pessimistic locks it needs no lock state, and compared to last-write-wins it never silently loses another user's change. The test suite fires 25 concurrent PATCHes with the same `expectedVersion` and asserts exactly one 200 and 24 409s.

## Bonus: external updates (polling)

- The dashboard polls `GET /dishes` every 4 s (configurable, capped at 5 s), so an external API save appears within ~4 s (up to ~5 s worst case).
- Dishes **without** a draft are updated silently. A dish **with** an unsaved draft is never touched: the draft stays and the card shows "Newer saved data is available (version N)" with the same guarded reload button.
- **Cleanup:** the interval, the `visibilitychange` listener and any in-flight request (`AbortController`) are removed when the effect is torn down. Hidden tabs skip polling and poll immediately when visible again; overlapping requests are skipped.
- **Disconnection:** a failed poll shows a "Connection lost, retrying" banner; the next successful poll (the timer keeps running) clears it. Poll responses older than what the UI already holds (e.g. one that raced a just-finished save) are ignored.
- Direct database edits are not detected.

## Verification steps

Start backend and frontend as above, then:

1. **Reseed safety.** Edit and save a dish in the UI, then run `npm run seed` again: output says `Seeded 0 new dish(es), skipped 5 existing`, and `GET /dishes` still has 5 dishes with your edit and its version.
2. **Drafts are local.** Change a name / toggle Published without saving: the card turns amber with "Unsaved changes", while `curl localhost:4000/dishes` still returns the old values. *Discard* restores the loaded values.
3. **Persistence.** Save, refresh the page (value and version stay), stop the backend (Ctrl+C), `npm start` again, refresh: still there.
4. **Empty name rejected.** Clear the name, tick Published, Save: the UI shows "A published dish must have a non-empty name." and the DB is unchanged. Or by API:
   `curl -i -X PATCH localhost:4000/dishes/2 -H "Content-Type: application/json" -d '{"dishName":"   ","isPublished":true,"expectedVersion":1}'` → `400`.
5. **Invalid image URL rejected (test data).** `backend/data/invalid-image-fixtures.json` holds dishes `bad-image` (`not-a-valid-url`) and `ftp-image` (`ftp://…`). Automated: `npm test` ("rejects publishing a dish whose stored image URL is invalid…") asserts 400 and an unchanged row. Manual, against a throwaway database:
   ```bash
   cd backend
   DB_PATH=./data/verify.db npm run seed -- --file data/invalid-image-fixtures.json
   DB_PATH=./data/verify.db npm start        # in another terminal, PORT=4001 if 4000 is in use
   curl -i -X PATCH localhost:4000/dishes/bad-image -H "Content-Type: application/json" \
     -d '{"dishName":"Named","isPublished":true,"expectedVersion":1}'    # 400, details[0].field = "imageUrl"
   curl localhost:4000/dishes                                             # unchanged, version 1
   ```
   (PowerShell: set `$env:DB_PATH='./data/verify.db'` first.) Saving the same dish with `"isPublished":false` succeeds. Delete `data/verify.db*` afterwards.
6. **Two-tab conflict.** Open the dashboard in tabs A and B. In A change dish 1's name and Save (version 2). In B edit the same dish's name (still based on version 1) and Save: B shows "Save rejected: another update occurred", keeps its draft text, and A's value is intact in the DB. B's draft only disappears when you click *Reload latest* and confirm, or *Discard*.
7. **Failed save / retry.** Edit a dish, stop the backend, click Save: error "Could not reach the server…", the draft stays editable, button reads "Retry save". Restart the backend, click it again: it saves.
8. **Errors by API.** Unknown id: `curl -i -X PATCH localhost:4000/dishes/999 -H "Content-Type: application/json" -d '{"dishName":"x","isPublished":false,"expectedVersion":1}'` → `404`. Wrong type (`"expectedVersion":"1"`) or malformed JSON → `400`.
9. **Bonus.** With the dashboard open, run a PATCH with curl using the dish's current version: the card updates within ~4 s. Do the same on a dish with an unsaved draft: the draft stays and the "Newer saved data" notice appears.
10. **Automated:** `cd backend && npm test`.

Verification status: `npm test` passes (10/10); the seed, idempotent reseed, and persistence across a backend restart were run against the real database; the frontend production build succeeds. The browser flows (steps 2, 6, 7, 9) have not been clicked through manually, so run them once.

## Known limitations

- Frontend has no automated tests; UI behaviour is verified manually per the steps above.
- Polling, not SSE/WebSockets, so updates lag by up to the poll interval; polling fetches the whole list.
- `node:sqlite` is marked experimental by Node; swapping in `better-sqlite3` would only touch `src/db.js` and `src/dishRepository.js` (kept behind a repository for that reason).
- The image URL is only syntax-checked (HTTP/HTTPS), per the brief. Image URLs are not editable.
- No authentication, uploads, create/delete or pagination (out of scope).

## Time spent

Approximately 4 hours equivalent for the required task plus the polling bonus. *(Replace with your own figure before submitting.)*

## AI / reused-code disclosure

This project was generated with the help of Claude Code (an AI coding assistant) from the assignment PDF. No third-party code was copied beyond standard library usage of Express, cors, dotenv, React and Vite. Seed data is the JSON supplied in the assignment. Whoever submits this must read and understand it, in particular `dishRepository.updateDish` and `useDishes.js`.
