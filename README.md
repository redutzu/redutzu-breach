# redutzu-breach

A standalone two-phase network breach minigame for FiveM. Built for hacking cameras in [redutzu-mdt](https://mdt.redutzu.com/) — works with any framework or no framework at all. Trigger it via exports, get the result in a callback or promise.

**Phase 1 — Port Knock:** click the correct hex ports in sequence before honeypots rotate in and burn a life.  
**Phase 2 — Carrier Wave Sync:** tune four sliders until your waveform overlaps the target, then engage the lock.

![Phase 1 — Port Knock](https://i.imgur.com/Xsl7Nnw.png)
![Phase 2 — Carrier Wave Sync](https://i.imgur.com/jig2UtH.png)

---

## Requirements

- FiveM server artifact **≥ 6116** (Lua 5.4)
- Node.js **≥ 18** *(only if you want to rebuild the UI)*

No ox_lib, no QBCore, no ESX. Fully standalone.

---

## Installation

### 1. Download

Clone or download into your resources folder:

```
resources/
└── redutzu-breach
```

### 2. Add to server.cfg

```
ensure redutzu-breach
```

### 3. Done

No SQL. No items. No additional dependencies. The pre-built UI (`nui/dist/`) is included — you do not need to run npm unless you want to modify the UI.

---

## Configuration

All defaults live in `config.lua`. Every value can be overridden per-call via the export (see Usage).

```lua
Config.Time           = 60   -- total seconds across both phases
Config.Lives          = 2    -- wrong clicks before lockout
Config.SequenceLength = 6    -- ports in the knock sequence (Phase 1)
Config.Honeypots      = 5    -- decoy ports spawned per rotation (Phase 1)
Config.HoneyInterval  = 400  -- ms between honeypot position shuffles
Config.LockThreshold  = 90   -- % carrier-wave sync required to engage lock (Phase 2)
```

### Difficulty reference

|                | Easy | Default | Hard |
|----------------|------|---------|------|
| `Time`         | 90   | 60      | 45   |
| `Lives`        | 3    | 2       | 1    |
| `SequenceLength` | 4  | 6       | 8    |
| `Honeypots`    | 3    | 5       | 6    |
| `HoneyInterval`| 600  | 400     | 250  |
| `LockThreshold`| 75   | 90      | 95   |

---

## Usage

### Client-side export

Call from any client script. The callback fires when the minigame ends (win, timeout, lockout, or death).

```lua
exports['redutzu-breach']:StartMinigame(config, callback)
```

**Config table** — all fields are optional, omit to use `config.lua` defaults:

| Field | Type | Description |
|-------|------|-------------|
| `totalTime` | `number` | Override `Config.Time` for this session |
| `lives` | `number` | Override `Config.Lives` |
| `seqLen` | `number` | Override `Config.SequenceLength` |
| `honeypots` | `number` | Override `Config.Honeypots` |
| `honeyInterval` | `number` | Override `Config.HoneyInterval` |
| `lockThreshold` | `number` | Override `Config.LockThreshold` |
| `id` | `string` | Camera label shown in the terminal UI (e.g. `'cam-014'`) |
| `ip` | `string` | IP shown in the terminal UI (e.g. `'10.41.0.14'`) |

**Result table** passed to your callback:

| Field | Type | Description |
|-------|------|-------------|
| `success` | `boolean` | `true` if the player completed both phases |
| `reason` | `string` | `'win'`, `'timeout'`, `'lockout'`, `'died'`, or `'disconnected'` |
| `match` | `number\|nil` | Carrier-wave sync % at lock moment — only present on `win` |
| `elapsed` | `number` | Seconds from Phase 1 start to end |

Returns `true` if the minigame started, `false` if one is already active for this player.

**Example:**

```lua
local ok = exports['redutzu-breach']:StartMinigame({
    totalTime     = 45,
    lives         = 1,
    lockThreshold = 85,
    id = 'cam-' .. string.format('%03d', camIndex),
    ip = camIp,
}, function(result)
    if result.success then
        TriggerServerEvent('mdt:server:cameraHacked', camId, result.match, result.elapsed)
    else
        -- notify player: result.reason tells you why it failed
    end
end)

if not ok then
    -- minigame was already running for this player
end
```

---

### Server-side export

Use when the trigger comes from the server — job check, cooldown gate, callback, etc.

```lua
-- Promise form (use Citizen.Await to block until done)
local result = Citizen.Await(exports['redutzu-breach']:StartMinigame(source, config))

-- Callback form (pass a function as the third argument)
exports['redutzu-breach']:StartMinigame(source, config, function(result) end)

-- Force-close the minigame on a specific client
exports['redutzu-breach']:CloseMinigame(source)
```

Both forms handle disconnect automatically — the callback/promise fires with `{ success = false, reason = 'disconnected', elapsed = 0 }` if the player drops mid-game.

**Promise example:**

```lua
lib.callback.register('mdt:startCameraHack', function(source, camId, camIp)
    -- your own gates go here (distance check, job check, cooldown, etc.)

    local minigame = exports['redutzu-breach']:StartMinigame(source, {
        id = camId,
        ip = camIp,
    })

    local result = Citizen.Await(minigame)

    if not result.success then return false end

    print(('Player %s hacked %s — %.1f%% sync in %ds'):format(source, camId, result.match or 0, result.elapsed))
    return true
end)
```

**Callback example:**

```lua
exports['redutzu-breach']:StartMinigame(source, { id = camId, ip = camIp }, function(result)
    if result.success then
        -- grant access, update database, etc.
    end
end)
```

---

### Server event (alternative)

If you prefer events over promises, listen for this instead (fires simultaneously with the promise resolving):

```lua
AddEventHandler('redutzu-minigame:result', function(source, result)
    if result.success then
        -- grant access, update database, etc.
    end
end)
```

---

## Modifying the UI

The NUI is a React + TypeScript app built with Vite. The pre-built output in `nui/dist/` is what FiveM loads — you only need to rebuild if you change the source.

### Setup

```bash
cd nui
npm install
```

### Development (browser preview)

```bash
npm run dev
```

Opens a local dev server. NUI messages won't fire in-browser, but you can mock them or tweak styles live. The font (`IBM Plex Mono`) is loaded from Google Fonts in `index.html` — swap it there if you want a different typeface.

### Build for FiveM

```bash
npm run build
```

Output goes to `nui/dist/`. Commit this folder — FiveM reads from it directly.

### What to edit

| What you want to change | Where to look |
|-------------------------|---------------|
| Colors, fonts, layout | `nui/src/` — component styles (inline or CSS modules depending on structure) |
| Phase 1 port grid appearance | Component handling the port knock UI in `nui/src/` |
| Phase 2 waveform / sliders | Component handling carrier wave sync in `nui/src/` |
| Terminal header (camera ID / IP display) | Top-level layout component in `nui/src/` |
| Google Font | `nui/index.html` — replace the `<link>` tag |
| Build target (browser compat) | `nui/vite.config.ts` — `build.target` is currently `chrome103` |

The NUI receives one `postMessage` to start (`action: 'startBreach'`) and one to close (`action: 'closeBreach'`). When the player finishes, the UI sends `breachResult` back via `fetch('https://redutzu-breach/breachResult', ...)`. Don't rename these — they're wired to the Lua side in `client/main.lua`.

---

## File Structure

```
redutzu-breach/
├── client/
│   └── main.lua          -- NUI bridge, exports, death/resource-stop handlers
├── server/
│   └── main.lua          -- promise-based server export, result routing
├── nui/
│   ├── src/              -- React/TypeScript source
│   ├── dist/             -- pre-built output (what FiveM loads)
│   ├── index.html        -- entry point, font imports
│   ├── vite.config.ts    -- build config
│   └── package.json
├── config.lua            -- default difficulty values
└── fxmanifest.lua
```

---

## License

MIT — free to use, modify, and redistribute. Credit appreciated but not required.
