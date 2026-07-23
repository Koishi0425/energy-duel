# Energy Duel Development Guide

Read this file before changing the project. Update it whenever commands, public
interfaces, directory responsibilities, or architecture invariants change.

## Architecture

- `client/` is the React + Vite + PixiJS 8 browser application.
  The browser shell owns lightweight client-side routes for `/login`, `/`,
  `/rooms/:roomId`, `/profile`, and `/profiles/:accountId`. Room URLs expose
  only shareable room codes; per-browser Colyseus reconnection tokens stay in
  localStorage and must not be placed in URLs.
- `client/src/content/announcements.ts` is the newest-first, versioned source
  for project announcements. Keep announcement IDs stable because the latest
  read ID is a localStorage cursor; the announcement dialog stays lazy-loaded
  so it does not add its full UI to the login bundle.
  `PlayerProfileBanner` is the shared renderer for editable, room-detail, and
  character-drawer profile summaries. Nameplate art uses a fixed `720 / 116`
  aspect ratio with a bounded width; do not stretch it to fill arbitrary panels.
  Reserve the rightmost 350 source pixels for nameplate artwork and keep every
  profile overlay inside the left 370 pixels. Imported nameplates are all
  selectable during the current testing period, including for existing accounts.
- `client/src/content/gameGuide.ts` owns the short, structured presentation
  layer for the in-game help center: reading order, role summaries, strategy
  hints, and glossary entries. Reference characters and actions by stable ID;
  never duplicate executable costs, levels, speeds, targets, or action text
  from `shared/config/game.json`. Detailed edge cases and design notes remain
  in the split Markdown manuals under `docs/`.
- `server/` is the authoritative Colyseus 0.17 server and HTTP API.
  Import runtime room/server APIs from `@colyseus/core` and transport support
  from `@colyseus/ws-transport`; do not reintroduce the `colyseus` aggregate
  package because its unused transport peers pull GitHub-only native packages.
- `shared/` is the `@energy-duel/shared` workspace. It owns wire types,
  geometry helpers, validated gameplay JSON, and configuration lookups used by
  both the client and server. Build it before either consuming workspace.
- Runtime account data is stored under `server/data/` and must not be committed.
  Authenticated clients may read another account's display profile through
  `GET /api/profiles/:accountId`; profile updates remain owner-only under
  `/api/profile` and `/api/profile/avatar`.
  Online player presence is process-local and heartbeat-based:
  clients update it through `/api/presence`. Authenticated lobby clients subscribe
  to the Colyseus `lobby_feed` room and receive versioned `lobby_snapshot` messages
  containing room and online-player summaries; `GET /api/rooms` and
  `GET /api/players/online` remain manual/low-frequency recovery paths. The server
  broadcasts snapshots only after authoritative room or visible Presence changes,
  never for an unchanged heartbeat. Public-room presence may expose a room code and
  occupancy; training-room presence exposes only that the player is in a training room.
  Passwords are salted and hashed with Node.js scrypt. Uploaded avatars live
  under `server/data/avatars/` as validated WebP files and are user data, not
  client assets.
- `Dockerfile` and `compose.yaml` define the supported single-instance
  production deployment. The container serves the built client, HTTP API, and
  Colyseus WebSocket endpoint on one port. Persist `/app/server/data` through
  the named volume and expose `/api/health` for container/proxy health checks.

The current milestone includes the multiplayer circular board, JSON-defined
actions, extensible player resources, portrait rendering, local board rotation,
the transformation branches through Pikachu, Li Chungang, Ao, Nightmare, and
Mudrock, a client resolution timeline, deferred target allocation, first-class
passives, fractional/flexible resource costs, and authoritative adjacent-cell
movement. Production art and the character editor remain out of scope. Human-readable rules live in `docs/`; the executable source
of truth remains `shared/config/game.json`.

## Commands

Run commands from the repository root:

- `npm install` installs every workspace.
- Local and container builds require Node.js 22 or newer because the Colyseus
  0.17 dependency tree declares a Node 22 engine requirement.
- Keep the Linux x64 Rollup native package pinned in the client optional
  dependencies and keep its exact version aligned with the client's direct
  Rollup development dependency. npm lockfiles generated on Windows may
  otherwise omit that platform package and make the Linux Docker build fail at
  Vite startup.
- `npm run dev` builds shared configuration, then starts the Vite client and
  Colyseus server together.
- `npm run build` builds both workspaces.
- `npm run assets:optimize` rebuilds deployable, content-hashed WebP assets and
  `client/public/assets/manifests/assets.json` from `art-source/runtime-imports/`.
- `npm run assets:optimize:characters` rebuilds only character and summon
  portraits while preserving generated nameplates, title badges, and profile
  asset configuration.
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
  A normal move selects one clockwise or counterclockwise adjacent cell. Quick
  Attack keeps that limit with two players and may select any other cell with
  three or more players. Cells allow multiple players and summons to coexist, so
  movement never fails because another unit is already there.
  Ordinary player-targeted attacks snapshot the selected player's cell before
  resolution and remain single-target: they prefer the original target when that
  player remains there, otherwise one other occupant takes the hit. Movement at
  the same speed resolves first and can dodge them. Explicitly locked attacks
  follow the selected player. Spatial attacks read positions when their effect
  resolves and affect every eligible player on a covered cell.
- Usernames are trimmed, case-insensitively unique, and contain 3-16 Chinese
  characters, ASCII letters, digits, or underscores. Registration requires a
  password of at least 7 characters; never store plaintext passwords. Profiles
  reference nameplates and titles by stable IDs, and the server validates that
  a cosmetic is unlocked before accepting it.
- Room nicknames are display labels and may differ from usernames.
- Gameplay definitions live in `shared/config/game.json`. Metadata, costs,
  targets, assets, and effect handler IDs are JSON-driven and validated. Effect
  handlers must be explicitly registered TypeScript functions; configuration
  can never execute arbitrary code.
- Actions use five UI categories: base, attack, defense, resource, and special. The
  spreadsheet's “做功/非做功” labels are descriptive only and do not affect
  runtime logic. Compound actions classify every component as `attack`, `defense`,
  `movement`, or `non_attack`. Components inherit the action's effective speed unless a different
  base `speedPriority` is explicitly declared; redundant equal-speed overrides are invalid.
  Base and effective speeds are clamped to the inclusive 0-4 range. Standalone active
  Buff actions do not oppose queued effects; passive and triggered Buffs resolve at their
  configured phase or trigger instead of acquiring the current action's speed.
  Target selection defaults to `planned`; `deferred` (“后发”)
  reveals every submitted action, then lets each deferred actor allocate targets
  before authoritative resolution. Deferred selection supports single targets,
  repeated allocations, and explicitly skippable windows such as Haunting Shadows.
- Transforming normally adds the target character's skill tree without removing
  base skills. Napoleon is the sole replacement-tree exception: while active,
  only his three commands, executable strategies, and conditionally unlocked
  transform entry are visible. The initial character may use charge, gain-charge, steal,
  double-steal, chop, defend, super-defend, and the transform entry;
  offensive and other special trees unlock after transforming. Keep this invariant in configuration, server
  validation, tests, manuals, and UI filtering.
  A transformed form lists its complete visible skill tree. Conditional skills
  remain visible in a locked state and use JSON `unlockRequirements`; client and
  server evaluate the same requirements. Gonggang's axe defense is the first
  example and requires the `axe_raised` buff.
  Inner Guard is an explicit restricted-tree character: its form never grants
  Fist, Slash, or Heal. Collapsing Fear resolves a player covered by both a
  directional target set and Dominion only once, using the higher Dominion level.
  Transformation costs belong to target character definitions, not the generic
  transform action. The initial character is a starting form, never a transform
  target. Players may normally switch repeatedly to any configured non-training-only
  transformed character other than the current one; Napoleon cannot leave
  until Elba Escape grants the transform action. Buffs default to character scope: inactive
  character buffs remain server-side and finite durations keep ticking; only
  explicitly player-scoped buffs follow across forms.
  Transformation preserves the player's current healthy or near-death state;
  it never heals by resetting HP. Inner Guard maps near-death to one device and
  retains its two-or-three-device count while the player remains healthy.
  Ye Qingxian's Sacrifice Path permanently activates after her character-scoped
  cumulative Energy and Charge gains reach three and records that activation as
  an explicit permanent Buff. Sacrifice fills one payment
  shortfall by shifting health, then a healthy-to-near-death shift grants Energy
  normally and may do so again after recovery. Devour learning is an optional,
  server-authoritative post-round choice after a direct elimination; learned
  actions and passives are character-scoped, persist across form switches, and
  become usable from the next round.
  Regent unlocks the persistent `stars` resource and receives three Stars only
  on the first transformation each game. Stardust always spends every Star the
  actor currently holds; its authoritative power equals that full amount.
  Sovereign Blade forge level has no upper limit, supports half-point stacks,
  and its forge/active/locked state is
  character-scoped and restored when switching back. Summon Forth can create the
  Blade from zero forge or reactivate it while locked. Variable actions normally
  choose an integer power at submission; all-in variables derive and validate
  that integer from the authoritative current resource balance.
  Character passives are first-class JSON definitions referenced by character
  IDs, displayed by the client, and enforced by registered server handlers.
  Quilon tracks gross Energy and Charge gains in character-scoped Wuyou Awareness,
  unlocks Three Bodies at seven, and receives one full-health revival into
  Bodhisattva Debate only after every damaging effect in that round has resolved;
  lethal damage never consumes the revival mid-round. Nilu Fire is a terrain object
  like Dominion. Breathing Method may place it on any board cell without a living
  player or summon, regardless of distance or other terrain; units may enter and
  coexist with it after placement. Its pulses, overlap, Quilon-only mitigation,
  visible resistance Buff, and cleanup are authoritative; any player may use Heal
  on a visible fire cell to remove it without healing or becoming Fragile. Lotus Seats synchronize origin,
  direction, speed, HP, and per-player resource cargo. They coexist with other units, move once
  per round, may be attacked through `targetBoardObjectId`, deliver cargo on return,
  and refund it when destroyed or when their owner dies.
  Chimei is disabled in standard rooms and remains available in training rooms.
  Chimei owns the character-visible Soul resource. Hellwalker adds one server-validated
  arbitrary-resource surcharge to affected attack actions for the next two rounds, while
  Resentment marks exactly one highest-resource living player at each choosing phase.
  Deify selects its target, X, and flexible payment after actions are revealed; successful
  conversion starts next round, delegates that actor to the source Chimei, and ends when
  authoritative cumulative action cost reaches X. Controller-funded resources spend Soul
  one-for-one and never contribute to that cumulative cost. Unless a definition states
  otherwise, damage caused by a summon or terrain belongs to its owner and resolves as
  that owner's attack for target, speed, and level opposition.
  Buff definitions may grant actions outside the current form tree; client and
  server derive those actions from the same `grantedActionIds`. Resource values
  may be fractional, and flexible-cost actions submit an explicit serializable
  resource-spend map whose integer amounts, total, and balances are validated
  server-side; fractional balances created by Li Chungang's slash cannot be
  selected as flexible-payment units. Resource
  definitions declare whether they are always visible or belong to characters;
  unrelated special resources are hidden only while their value is zero.
  Pikachu's quick-move waiver, Ao mastery, Nightmare cooldown/darkness,
  and Mudrock counters/sleep are character-scoped unless their definitions
  explicitly use player scope. Transforming into Ao grants every player the
  player-scoped Cut action for the rest of that game. Ao mastery advances only
  when Steal, Double Steal, or Absorb successfully intercepts another player's
  generated resource; self-generated Energy or Charge never advances it.
- Player combat state carries character/form IDs, HP, a general resource map,
  and a buff map. Do not reintroduce top-level resource fields such as `energy`.
- Terrain and summons are first-class synchronized board objects. Their stable
  definition IDs, ownership, source character, grid position, duration,
  optional stacks, and optional HP are server authoritative and rendered
  directly on the circular board; do not encode board positions inside Buff
  IDs or client-only state. Dominion is a unique permanent marker per
  owner/cell and never displays or gains stacks. Summons render as
  character-like entities with portrait, name, ownership, and health state.
  Dream Path selects a player endpoint and clockwise or counterclockwise direction,
  damages every other player on that inclusive path, and lets Nightmare move to any
  path cell, including its origin or an occupied cell. Each covered cell is a timed
  three-round terrain object; reapplication refreshes it, and every Nightmare standing
  on any Dream Path gains 0.5 attack skill and damage level.
- Room state synchronizes asset IDs only. Original imported art belongs under
  `art-source/runtime-imports/` and is excluded from the Docker context; only
  optimized, content-hashed WebP files and their manifest belong under
  `client/public/assets/`. Resolve pose, form, character, then placeholder
  fallbacks on the client. Never synchronize URLs or Base64 image data. The
  board loads 384px portrait previews with a concurrency cap of three; full
  1024px portraits are reserved for detail views. Hashed art and Vite bundles
  use immutable caching, while `index.html` and asset manifests must revalidate.
- Players explicitly create or join rooms by room ID. Rooms support at most 20
  players. Waiting rooms require every player to be ready and only the host may start.
  `/api/rooms` exposes only non-empty, unlocked, non-private rooms with public
  room ID, host nickname, occupancy, and creation time. The lobby is directory-first:
  players join from the room list or a room URL, while creation is opened from the
  room-list toolbar.
  The lobby also creates private single-client training rooms. A training room
  synchronizes server-owned dummy actors with an explicit controller player ID;
  the host may add/remove and configure actors while waiting, then submit each
  actor's actions through the same authoritative validation and resolution path.
  Training-only initial character/resource overrides must never leak into standard rooms.
  Actions remain private on the server until every living player submits. A
  submitted player may send `cancel_action` and replace their choice before the
  final living player submits; the final submission resolves synchronously.
  Player readiness, action submission, result confirmation, and connection
  state are synchronized and displayed consistently in the roster and on the
  board. Room emotes use a server-validated fixed ID set without a send
  interval. They render optimistically for the sender, deduplicate the server
  echo by event ID, and remain transient broadcast messages rather than
  authoritative room state or chat.
  Keep the emote entry in the operation panel so it remains close to repeated
  battle controls. Desktop players may hold V to open a cursor-centered emote
  wheel, move to select, and release to send; releasing without movement sends
  the locally remembered last wheel selection. Normal picker clicks do not
  replace that shortcut memory. Render the Pixi board at device-aware high
  density (capped for performance) with pixel rounding so board text stays crisp.
  Finished games remain in the result phase until every remaining player
  acknowledges the result, then reset to the waiting/ready phase for another game.
  Starting and post-result resets must restore authoritative grid positions to
  `2 * playerIndex`; movement can never leak into the next game.
  Append authoritative outcomes for every submitted action, including no-effect
  outcomes, to the synchronized, bounded combat log. Player-facing log text uses
  explicit healthy/near-death/dead state names and the client groups entries by round.
  A normally completed standard-room game awards 100 base EXP, plus 100 for a
  win or 50 for a draw, and updates career totals. Training rooms and games
  terminated by departure do not update career data. Rating v1 scores each
  completed standard game from 0–330 using result, survival, damage/eliminations,
  effective defense/recovery, and participation. Profile Rating is the sum of
  the best 35 scores and the latest 15 scores; one game may belong to both sets.
  Persist the formula version with each score and never silently recalculate
  historical scores after a formula change.
  Profile level is capped at 999. Its cumulative EXP threshold follows
  `50 * (level - 1) + floor(1.5 * (level - 1)^2)` through the early curve, but
  every advancement from levels 1 through 483 must remain monotonic and below
  1,500 EXP; 483 to 484 costs 1,497 EXP, and 484 to 485 onward costs exactly
  1,500 EXP.
  The client progress bar must subtract the current-level threshold and show
  progress within that level.
- The room creator is the permanent host. A host's explicit departure destroys
  the room, but an unexpected host disconnect reserves that host seat for 30
  seconds in every phase so a browser refresh can reconnect safely. Non-host
  reconnect seats remain limited to active matches; lobby and result-screen
  disconnects are immediate departures. A reconnect timeout becomes a permanent
  departure. A non-host departure during play ends the current game and leaves
  remaining clients on the result screen.
- Base combat follows `docs/基础规则手册.md`: speed orders authoritative effects and the client timeline,
  attack target sets always exclude the attacker; intentional self-damage uses
  a dedicated effect instead of targeting the actor as an attack. Damage
  compares the incoming attack level with the target's selected
  action level only when that action applies to the attacker and its effective
  attack speed is at least the incoming attack effect's speed. Equal-damage attacks
  ignore this speed gate and clash normally. A slower, differently damaging attack
  cannot oppose a faster attack, but still resolves later if its actor can act. Active
  defense applies only when its speed is at least the incoming attack speed; slower
  defense and movement are bypassed at the attack's original damage level. Defense and
  targetless actions apply generally; targeted/spatial actions apply only when
  the attacker is one of their actual targets. A difference below 0.5 cancels,
  0.5 to below 1 shifts health left once, and 1 or more kills directly; attacks
  below level 3 can shift at most once. All final effects remain server authoritative.
  Base characters have no near-death state; transformed
  characters have healthy/near-death/dead states and gain one energy on entering
  near-death. Legacy wave/hangup definitions remain configuration-only adapters
  and are not unlocked by the current character trees.
  A configured breakable defense breaks after comparing an incoming attack whose
  level is at least its current level. Persistent defenses then remain at level
  zero through their configured broken buff; generated defenses remain broken
  only for that use. Super Defense and Dark Shelter do not use this rule.
  Defend, Axe Defend, and Collect Light are persistent breakable defenses;
  Particle Wall, Iridescence, and Forge Wall are recreated defenses.
  Actions have separate skill and damage levels; when unspecified both inherit
  the legacy shared level. Skill clashes compare only skill level. Defense does
  not clash and instead subtracts from damage level. An action with `multiHit:
  true` uses the global multi-hit resolver: repeated allocations against an
  attack-category action combine skill level only; allocations against other
  categories resolve separately; damage level never combines. Do not branch on
  a character ID or action ID to implement these rules. Stardust only supplies
  its per-hit values and target allocations. A player resolves health from only
  the highest effective damage level received during the round, across repeated
  hits and multiple sources.
  Warrior gains one character-scoped Strength and one permanent Shred hit for
  every health state shifted left. Strength increases attack skill level only.
  Armor is an unbounded character-scoped consumable defense: after block resolves,
  it absorbs equal non-true, non-piercing remaining damage before barriers and is
  cleared on death. Vulnerability adds a fixed 0.5 damage to ordinary attacks,
  while Bully explicitly scales by its stacks; those stacks decay once per round.
  Cooldown progress is action-configured through `cooldownReduction`; do not
  infer it from the actor's current character. Shadow Blade progresses only from
  Nightmare-specific actions listed in gameplay configuration.
  Star God is available in standard rooms and follows the same transformation
  rules as other non-training-only characters. Napoleon replaces the normal skill tree with the three
  command actions and synchronizes an ordered, six-command public buffer; never
  encode command order as unordered buff stacks. Strategy cards include both
  existing buffer sequences and the longest sequence formed by appending their
  final command at the buffer tail. Existing-buffer execution wins when both
  apply. Base command cards always remain ordinary commands; clients send a
  strategy card's resulting source explicitly and the server validates it.
  Buff definitions may supply a default duration, but synchronized runtime Buff
  state owns the actual remaining turns and its explicit permanent flag. Tick
  every non-permanent Buff so effects may set or refresh arbitrary durations.
  Reapplying the same timed Buff keeps the greater of its current remaining
  duration and the newly supplied duration; a shorter source never truncates a
  longer active duration. Explicit consumption, removal, and round ticking may
  still reduce or clear it.
- The login/lobby shell must stay independent of Ant Design and PixiJS. Battle
  UI and the in-app tutorial are lazy-loaded. Use `?perf=1` to display local FPS,
  slow-frame, long-task, RTT, and optional heap metrics while profiling.
  Keep battle loading feedback inside that lazy boundary: show code-chunk loading
  first, then report Pixi initialization and current portrait preloading progress.
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
