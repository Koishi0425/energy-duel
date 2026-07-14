# Energy Duel Development Guide

Read this file before changing the project. Update it whenever commands, public
interfaces, directory responsibilities, or architecture invariants change.

## Architecture

- `client/` is the React + Vite + PixiJS 8 browser application.
- `server/` is the authoritative Colyseus 0.17 server and HTTP API.
- `shared/` is the `@energy-duel/shared` workspace. It owns wire types,
  geometry helpers, validated gameplay JSON, and configuration lookups used by
  both the client and server. Build it before either consuming workspace.
- Runtime account data is stored under `server/data/` and must not be committed.

The current milestone includes the multiplayer circular board, JSON-defined
actions, extensible player resources, portrait rendering, local board rotation,
and the first simultaneous-action ruleset. Transformation effects, movement,
particles, and the character editor remain out of scope.

## Commands

Run commands from the repository root:

- `npm install` installs every workspace.
- `npm run dev` builds shared configuration, then starts the Vite client and
  Colyseus server together.
- `npm run build` builds both workspaces.
- `npm run typecheck` type-checks both workspaces without emitting files.
- `npm test` runs all Vitest suites.

## Core invariants

- The server is authoritative. Clients render synchronized state and never
  assign player identities or grid positions themselves.
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
- Player combat state carries character/form IDs, HP, a general resource map,
  and a buff map. Do not reintroduce top-level resource fields such as `energy`.
- Room state synchronizes asset IDs only. Portrait files belong under
  `client/public/assets/`; resolve pose, form, character, then placeholder
  fallbacks on the client. Never synchronize URLs or Base64 image data.
- Players explicitly create or join rooms by room ID. Rooms support at most 20
  players. Waiting rooms require every player to be ready and only the host may start.
  Actions remain private on the server until every living player submits. A
  submitted player may send `cancel_action` and replace their choice before the
  final living player submits; the final submission resolves synchronously.
- The room creator is the permanent host. A permanent host departure destroys
  the room. Only active matches reserve an unexpectedly disconnected seat for
  30 seconds; lobby and result-screen disconnects are immediate departures. A
  reconnect timeout becomes a permanent departure. A non-host departure during
  play ends the current game and leaves remaining clients on the result screen.
- Current combat is one-hit elimination: charge gains one energy; steal takes a
  target's newly charged energy; chop cancels all steals and eliminates their
  users; wave costs one and is blocked by defense; hangup costs three, attacks
  every other player, and ignores defense; super defense costs one and blocks
  every attack. All effects in a round are simultaneous.

## Change discipline

- Keep shared wire shapes explicit and serializable.
- Add geometry tests for every circular-map behavior change.
- Add server tests for authentication, room membership, and state invariants.
- Never commit `server/data/users.json`, secrets, build output, or dependencies.
