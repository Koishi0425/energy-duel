# Energy Duel Development Guide

Read this file before changing the project. Update it whenever commands, public
interfaces, directory responsibilities, or architecture invariants change.

## Architecture

- `client/` is the React + Vite + PixiJS 8 browser application.
- `client/src/content/announcements.ts` is the newest-first, versioned source
  for project announcements. Keep announcement IDs stable because the latest
  read ID is a localStorage cursor; the announcement dialog stays lazy-loaded
  so it does not add its full UI to the login bundle.
- `server/` is the authoritative Colyseus 0.17 server and HTTP API.
  Import runtime room/server APIs from `@colyseus/core` and transport support
  from `@colyseus/ws-transport`; do not reintroduce the `colyseus` aggregate
  package because its unused transport peers pull GitHub-only native packages.
- `shared/` is the `@energy-duel/shared` workspace. It owns wire types,
  geometry helpers, validated gameplay JSON, and configuration lookups used by
  both the client and server. Build it before either consuming workspace.
- Runtime account data is stored under `server/data/` and must not be committed.
- `Dockerfile` and `compose.yaml` define the supported single-instance
  production deployment. The container serves the built client, HTTP API, and
  Colyseus WebSocket endpoint on one port. Persist `/app/server/data` through
  the named volume and expose `/api/health` for container/proxy health checks.

The current milestone includes the multiplayer circular board, JSON-defined
actions, extensible player resources, portrait rendering, local board rotation,
the first transformation branches, a client resolution timeline, and the first
simultaneous-action ruleset. Movement, production art, and the character editor
remain out of scope. Human-readable rules live in `docs/`; the executable source
of truth remains `shared/config/game.json`.

## Commands

Run commands from the repository root:

- `npm install` installs every workspace.
- Local and container builds require Node.js 22 or newer because the Colyseus
  0.17 dependency tree declares a Node 22 engine requirement.
- `npm run dev` builds shared configuration, then starts the Vite client and
  Colyseus server together.
- `npm run build` builds both workspaces.
- `npm run typecheck` type-checks both workspaces without emitting files.
- `npm test` runs all Vitest suites.
- `npm run docker:build`, `npm run docker:up`, `npm run docker:logs`, and
  `npm run docker:down` manage the local Compose deployment.

## Core invariants

- The server is authoritative. Clients render synchronized state and never
  assign player identities or grid positions themselves.
- Production currently supports exactly one server instance. Sessions, rooms,
  reconnect seats, and Presence are process-local. Do not add replicas until
  shared session storage, Redis Presence/Driver, and room routing exist.
- Container replacement terminates active matches. Deploy during a maintenance
  window, retain immutable commit-tagged images for rollback, and never remove
  the `energy-duel-data` volume during a normal update.
- A circular board has exactly `2 * playerCount` cells. Player `i` starts at
  cell `2 * i`, leaving exactly one empty cell between players.
- Grid index `0` is at the right of the circle. Indices increase clockwise in
  screen coordinates. `CircularMap.getGridCoordinates()` returns coordinates
  in its parent Pixi container after `resize()` has initialized the layout.
  View rotation is local to one client and never changes the authoritative
  `gridIndex` or gets synchronized to the room.
- Usernames are trimmed, case-insensitively unique, and contain 3-16 Chinese
  characters, ASCII letters, digits, or underscores. They are identifiers, not
  secure credentials: anyone who knows a username can enter that account.
- Room nicknames are display labels and may differ from usernames.
- Gameplay definitions live in `shared/config/game.json`. Metadata, costs,
  targets, assets, and effect handler IDs are JSON-driven and validated. Effect
  handlers must be explicitly registered TypeScript functions; configuration
  can never execute arbitrary code.
- Actions use five UI categories: base, attack, defense, resource, and special. The
  spreadsheet's “做功/非做功” labels are descriptive only and do not affect
  runtime logic. Target selection defaults to `planned`; `deferred` (“后发”) is
  reserved for future resolution-stage target windows and is not enabled yet.
- Transforming adds the target character's skill tree without removing any
  base skills. The initial character may use charge, gain-charge, steal,
  double-steal, chop, defend, super-defend, and the transform entry;
  offensive and other special trees unlock after transforming. Keep this invariant in configuration, server
  validation, tests, manuals, and UI filtering.
  A transformed form lists its complete visible skill tree. Conditional skills
  remain visible in a locked state and use JSON `unlockRequirements`; client and
  server evaluate the same requirements. Gonggang's axe defense is the first
  example and requires the `axe_raised` buff.
  Transformation costs belong to target character definitions, not the generic
  transform action. Players may switch repeatedly to any configured character
  other than the current one. Buffs default to character scope: inactive
  character buffs remain server-side and finite durations keep ticking; only
  explicitly player-scoped buffs follow across forms.
- Player combat state carries character/form IDs, HP, a general resource map,
  and a buff map. Do not reintroduce top-level resource fields such as `energy`.
- Room state synchronizes asset IDs only. Portrait files belong under
  `client/public/assets/`; resolve pose, form, character, then placeholder
  fallbacks on the client. Never synchronize URLs or Base64 image data. Current
  placeholder portraits are alpha-trimmed and downscaled in the client on first
  load; keep originals non-destructive until production art replaces them.
- Players explicitly create or join rooms by room ID. Rooms support at most 20
  players. Waiting rooms require every player to be ready and only the host may start.
  Actions remain private on the server until every living player submits. A
  submitted player may send `cancel_action` and replace their choice before the
  final living player submits; the final submission resolves synchronously.
  Finished games remain in the result phase until every remaining player
  acknowledges the result, then reset to the waiting/ready phase for another game.
  Append authoritative outcomes for every submitted action, including no-effect
  outcomes, to the synchronized, bounded combat log. Player-facing log text uses
  explicit healthy/near-death/dead state names and the client groups entries by round.
- The room creator is the permanent host. A permanent host departure destroys
  the room. Only active matches reserve an unexpectedly disconnected seat for
  30 seconds; lobby and result-screen disconnects are immediate departures. A
  reconnect timeout becomes a permanent departure. A non-host departure during
  play ends the current game and leaves remaining clients on the result screen.
- Base combat follows `docs/基础规则手册.md`: speed orders the client timeline,
  while damage compares the incoming attack level with the target's own selected
  action level (attack, defense, or otherwise). A difference below 0.5 cancels,
  0.5 to below 1 shifts health left once, and 1 or more kills directly; attacks
  below level 3 can shift at most once. All final effects remain server authoritative.
  Base characters have no near-death state; transformed
  characters have healthy/near-death/dead states and gain one energy on entering
  near-death. Legacy wave/hangup definitions remain configuration-only adapters
  and are not unlocked by the current character trees.
- The login/lobby shell must stay independent of Ant Design and PixiJS. Battle
  UI and the in-app tutorial are lazy-loaded. Use `?perf=1` to display local FPS,
  slow-frame, long-task, RTT, and optional heap metrics while profiling.
- Desktop action and combat-log windows use root-level portals so parent overflow
  never clips them. Their drag/resize geometry is local-only and persisted. Action
  layout editing is WYSIWYG on the live tabs and skill grid, not a separate modal.
- Keep `docs/基础规则手册.md`, `docs/角色信息手册.md`, the in-app tutorial, and
  executable configuration aligned when player-facing rules change.

## Change discipline

- Keep shared wire shapes explicit and serializable.
- Add geometry tests for every circular-map behavior change.
- Add server tests for authentication, room membership, and state invariants.
- Never commit `server/data/users.json`, secrets, build output, or dependencies.
