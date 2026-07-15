# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

```bash
npm install                     # install all workspaces (Node.js 22+)
npm run dev                     # build shared + start Vite client & Colyseus server
npm run build                   # build all workspaces
npm run typecheck               # type-check all workspaces
npm test                        # run all Vitest suites
npm run serve                   # production build + start server on port 2567
npm run tunnel                  # ngrok HTTP tunnel to localhost:2567
npm run docker:build            # Docker Compose build
npm run docker:up               # Docker Compose up (detached)
```

Run workspace-scoped commands with `npm run <script> -w <client|server|shared>` (e.g., `npm test -w server`). The root `concurrently` dev script runs client (Vite, port 5173) and server (Colyseus, port 2567) together.

## Architecture

This is a multiplayer circular board battle game (娇斯拉大战贡刚) built with React, PixiJS 8, and Colyseus 0.17. Three npm workspaces:

- **`shared/`** (`@energy-duel/shared`) — wire types (`types.ts`), circular-map geometry (`geometry.ts`), validated JSON game config (`config.ts`), and configuration lookups. Must be built before either consuming workspace.
- **`server/`** — authoritative Colyseus 0.17 server. Room logic (`EnergyDuelRoom`), round resolution (`RoundResolver`), action submission store (`ActionSubmissionStore`), session/auth (`SessionService`), and an Express HTTP API (health, rooms list, session creation). Serves the built client in production. Imports from `@colyseus/core` and `@colyseus/ws-transport` — never the aggregate `colyseus` package.
- **`client/`** — React + Vite + PixiJS 8 browser app. The login/lobby shell (`App.tsx`) stays independent of Ant Design and PixiJS. Battle UI (`GameRoomView.tsx`), the action panel, game canvas, and tutorial are lazy-loaded. Ant Design provides dark-themed UI chrome. View rotation is client-local only.

**Data flow:** Client submits actions via Colyseus messages → server validates and stores privately → when all living players submit, server resolves the round authoritatively → broadcasts `round_resolution` (animation timeline) + state sync → clients render the timeline, then the server applies results.

**Key directories:**
```
shared/config/game.json   — executable game data (characters, actions, resources, buffs)
server/src/rooms/         — room lifecycle, message handlers, buff persistence
server/src/game/          — round resolution, action validation, submission store
client/src/game/          — circular map rendering, visual resolver
client/src/components/    — UI components (action panel, canvas, tutorial, etc.)
docs/                     — human-readable rule manuals
```

## Core Invariants

- **Server is authoritative.** Clients render synchronized state; they never assign identities, grid positions, or resolve combat.
- **Single-instance only.** Sessions, rooms, reconnect seats, and Presence are process-local. No replicas, no Redis.
- **Circular board:** `2 × playerCount` cells. Player `i` starts at grid index `2 × i`. Index 0 is at the right; indices increase clockwise. View rotation is local, never synced.
- **Usernames** are trimmed, case-insensitively unique, 3–16 Chinese/ASCII alphanumeric/underscore characters. They are identifiers, not credentials.
- **Game config** (`shared/config/game.json`) is JSON-driven and validated at import time. Effect handler IDs in config must correspond to registered TypeScript functions in `RoundResolver.ts`. Config can never execute arbitrary code.
- **Five action categories:** `base`, `attack`, `defense`, `resource`, `special`. Target selection defaults to `planned`; `deferred` ("后发") reveals all submitted actions before asking the actor to allocate targets.
- **Transformation** adds the target character's skill tree without removing base skills. Initial character has charge, gain-charge, steal, double-steal, chop, defend, super-defend, and transform. Transform costs belong to target character definitions. Buffs default to character scope and tick even when inactive; player-scoped buffs persist across forms.
- **Combat resolution:** Speed orders the client timeline. Damage compares incoming attack level vs. target's own action level. Difference < 0.5 cancels; ≥ 0.5 to < 1 shifts health left one state; ≥ 1 kills directly. Attacks below level 3 can shift at most one state. Base characters have healthy/dead; transformed characters have healthy/near-death/dead (+1 energy on entering near-death).
- **Room lifecycle:** Creator is permanent host; host departure destroys room. Active-match disconnects reserve a 30s reconnect seat; lobby/result disconnects are immediate departures. Non-host departure during play ends the current game.
- **Asset resolution:** Sync asset IDs only. Client resolves pose → form → character → placeholder fallbacks. Never sync URLs or Base64 data.
- **Portraits** under `client/public/assets/`. Placeholder portraits are alpha-trimmed and downscaled on first load (originals untouched).

## Testing Patterns

- Tests use Vitest. Shared tests import the validated `gameConfig` directly — it's a singleton, so tests that mutate config state must be isolated or reset.
- Geometry tests (`CircularMap.test.ts`) verify the circular distance formula and grid coordinate calculations.
- Server room tests (`EnergyDuelRoom.test.ts`) test room lifecycle, action submission, and resolution without a real WebSocket — they call handler functions directly.
- Client tests (`roomState.test.ts`) verify state parsing from Colyseus schema objects.

## Change Discipline

- Add geometry tests for every circular-map behavior change.
- Add server tests for authentication, room membership, and state invariants.
- Keep shared wire types explicit and serializable — Colyseus Schema types map to them.
- Align `docs/` manuals, in-app tutorial, and executable config when player-facing rules change.
- Never commit `server/data/users.json`, secrets, build output, or dependencies.
- Keep the Linux x64 Rollup native package pinned in client optional dependencies — otherwise Docker builds may fail on missing platform packages.

For deeper architectural context, read `AGENTS.md`.
