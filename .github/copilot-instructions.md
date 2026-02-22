# ASES Tournament Manager — Copilot Instructions

## Architecture Overview

Pure static SPA — **no build step, no bundler, no Node.js runtime**. Deployed as static files served by nginx (locally via Docker, production on Hostinger shared hosting).

```
DB (db.js)  →  API (api.js)  →  AUTH (auth.js)
                     ↓
              Vue 3 app (app.js)  →  index.html template
```

- **`DB`** — WASM SQLite DAL (`sql.js` v1.10.3). Loads from `localStorage` → `/app.db` → blank schema. Persists writes to `localStorage` on every `DB.run()`. Use `DB.query()`, `DB.queryOne()`, `DB.run()` — never touch `_db` directly.
- **`API`** — All business logic. Stateless functions; never touches the DOM. Mirrors the original Google Apps Script `Services.js` API surface. Admin functions call `API.*` directly — no auth guard in this layer.
- **`AUTH`** — `sessionStorage`-based sessions. Single admin: `karlos` / `Hidalgo#1`. Credentials base64-encoded in source. `AUTH.getSession()` returns `{ username, role, display }` or `null`.
- **Vue 3 (Composition API CDN)** — `app.js` is a self-executing IIFE that calls `Vue.createApp({ setup() { ... } })`. All state is `ref`/`reactive`. Template is `index.html`. `GameRow` is a locally defined component registered with `app.component('game-row', GameRow)`.

## Key Conventions

**IDs** — always generated with `newId(prefix)` inside `api.js` (uses `crypto.randomUUID`, falls back to `Math.random`). Format: `T_<12hex>`, `G_<12hex>`, `SCH_<12hex>`, `TEAM_<12hex>`.

**Timestamps** — `now()` (ISO-8601) called inside `api.js`, stored as TEXT in SQLite. Never compute timestamps in `app.js`.

**Tournament formats** — two types only:
- `ROUND_ROBIN` — every team plays every other team once; `Stage='ROUND_ROBIN'`
- `ELEMENTARY_GROUP_BRACKET` — 3-round group stage (`Stage='GROUP'`) + SF/FINAL knockout (`Stage='SF'`, `Stage='FINAL'`). BYE team ID is the literal string `'BYE'`.

**Schedule generation** chain in `api.js`:
1. `generateSchedule()` — full auto (Elementary: `generateElementarySchedule`; RR: `generateRoundRobin`)
2. `createCustomSchedule(id, matchups, autoGenerate)` — manual matchups + optional auto-fill via `autoGenerateRemainingGames` (Elementary) or `autoGenerateRoundRobin` (RR)
3. `generateBracket(id, force)` — seeds top-4 standings to SF/FINAL; Elementary only

**Standings** — always recalculated from scratch via `API.rebuildStandings()`. Called automatically after every `saveScore`, `setParticipants`, `generateSchedule`. Only `Stage='GROUP'` and `Stage='ROUND_ROBIN'` games count toward standings.

**CSS design system** — `css/styles.css` is the sole stylesheet. Tailwind CDN loaded with `preflight: false` (layout utilities only). All typography, color tokens, and components are custom. Key tokens: `--primary:#6366f1`, `--bg:#f6f7f9`. Do not add Tailwind component classes (`btn`, `card`, etc.) — use the custom classes (`.btn-primary`, `.btn-outline`, `.card`, `.form-input`, `.data-table`, `.modal-overlay`, etc.).

## Dev Workflow

```bash
# Start (with live file serving via volume mounts):
docker compose up -d

# Apply changes to js/, css/, index.html → INSTANT (volume-mounted, no rebuild needed)

# Apply changes to docker/nginx.conf or Dockerfile → REQUIRES rebuild:
docker compose build && docker compose up -d

# Verify served file and cache headers:
curl -sI http://localhost:8080/js/app.js | grep -i cache
curl -s  http://localhost:8080/js/api.js | grep "myFunction"

# Check JS syntax before testing:
node --check js/api.js && node --check js/app.js
```

**Cache busters** — `index.html` script/link tags use `?v=N`. Increment N on both tag and matching file when a change needs to force-bypass browser cache. Current: CSS `?v=3`, JS `?v=3`. nginx serves JS/CSS with `no-cache, no-store`.

## File Map

| File | Purpose |
|------|---------|
| `js/db.js` | WASM SQLite DAL — schema DDL, `DB.init/query/queryOne/run/save` |
| `js/api.js` | Business logic — CRUD + schedule generators (all private helpers at top, `return { ... }` public API) |
| `js/auth.js` | Session management — `AUTH.login/logout/getSession` |
| `js/app.js` | Vue 3 IIFE — `GameRow` component + root `setup()` + all event handlers |
| `index.html` | Vue template + CDN script tags. `v-cloak` prevents FOUC |
| `css/styles.css` | Complete design system — no external component library |
| `app.db` | Pre-built SQLite file shipped with the container (18 ASES schools seeded) |
| `docker/nginx.conf` | Cache headers; requires `docker compose build` to update |
| `scripts/create_db.py` | One-time script to generate `app.db` from `schools.csv` |
