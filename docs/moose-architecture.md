# Project Moose Architecture

> A multi-agent orchestration layer built on top of [OpenCode](https://github.com/anomalyco/opencode)

## What Changed (v0.3.1 Refactor)

The Moose agent system was refactored from two monolithic files (`definition.ts` ~500 lines, `instance.ts` ~450 lines) into a focused module architecture with 12 files under `packages/opencode/src/agent/moose/`. This decomposition improves maintainability, testability, and makes the system easier to extend.

### Before (v0.3)
```
agent/moose/
  definition.ts   # 500+ lines: schemas, CRUD, presets, seeding
  instance.ts      # 450+ lines: CRUD, layout, spawn validation, GC
  communication.ts
  events.ts
  gc.ts
  index.ts
```

### After (v0.3.1)
```
agent/moose/
  schema.ts          # Single source of truth for all Zod schemas
  definition.ts      # Agent/folder CRUD and config file management
  instance.ts        # Instance CRUD and SQLite persistence
  layout.ts          # Force-directed layout and arc redistribution
  spawn.ts           # Spawn validation, limits, orchestrator detection
  communication.ts   # Parent-child messaging with direction validation
  events.ts          # BusEvent definitions (6 event types)
  gc.ts              # Garbage collection with idle timeouts
  presets/default.ts # Default folder preset (6 agents)
  presets/moose-herd.ts # Moose Herd folder preset (7 agents)
  index.ts           # Barrel exports
```

### Key changes:
- **schema.ts** extracted from definition.ts and instance.ts — all Zod schemas in one place
- **layout.ts** extracted from instance.ts — repulsion physics and arc redistribution algorithms
- **spawn.ts** extracted from instance.ts — `isSpawnAllowed()`, `checkSpawnLimit()`, `isOrchestrator()`
- **presets/** extracted from definition.ts — agent preset arrays moved to their own files
- **Callback injection** in layout.ts avoids circular imports between instance.ts and layout.ts

---

## System Overview

Project Moose adds a **multi-agent orchestration canvas** to OpenCode. Users define agents with specialized roles, arrange them on a visual canvas, and orchestrator agents delegate tasks to child agents at runtime.

### Core Concepts

| Concept | Description |
|---------|-------------|
| **Agent Definition** | JSON config describing an agent: name, prompt, model, tools, spawnable children |
| **Agent Folder** | Named group of agent definitions (e.g., "Default", "Moose Herd") |
| **Agent Instance** | Runtime instance of a definition on the canvas, with position, state, session |
| **Workspace Session** | Top-level session that owns all canvas instances |
| **Orchestrator** | Agent with `spawnable.agents[]` — can delegate via the Task tool |
| **Leaf Agent** | Agent without spawnable config — executes tasks directly |

---

## Data Flow

```
User Request
    |
    v
[Frontend: Sidebar + Canvas]
    |
    | HTTP API (Hono)
    v
[Server Routes]  -->  [Agent Definition CRUD]  -->  moose-agents.json
    |                          |
    |                   [Agent Bridge]
    |                   translateMooseToAgent()
    |                          |
    v                          v
[Task Tool]  <---  [OpenCode Agent Registry]
    |
    | Creates session + instance
    v
[LLM Provider]  -->  [Child Agent Session]
    |                          |
    | SSE Events               | BusEvent publish
    v                          v
[Frontend Canvas]  <---  [SSE Stream]
```

### Request lifecycle:

1. User types a message in the prompt dock, targeting an agent (e.g., `@Architect`)
2. Frontend sends the message to the backend session
3. The agent's LLM processes the message with its configured tools
4. If the agent is an orchestrator, it calls the **Task tool** to delegate subtasks
5. Task tool validates spawn permissions, creates a child session + canvas instance
6. Child agent runs in its own session with scoped tools and permissions
7. Results flow back up to the orchestrator
8. Canvas UI updates via SSE events (spawned, state changes, moves)

---

## Module Reference

### `schema.ts` — Type Definitions

Single source of truth for all Zod schemas:

- **`AgentDefinitionInfo`** — Agent config shape (id, name, prompt, model, tools, spawnable, etc.)
- **`AgentFolder`** — Named group with color, icon, and nested agents array
- **`AgentFolderConfig`** — Top-level config: `{ activeFolder, folders[] }`
- **`AgentInstanceState`** — Enum: `idle | working | error | question | spawning`
- **`AgentInstanceInfo`** — Runtime instance (id, position, state, session link, parent link)
- **`AgentMessageType`** — Enum: `question | scope_request | answer | result`

### `definition.ts` — Agent & Folder CRUD

Manages the `moose-agents.json` config file:

- **`readConfig() / writeConfig()`** — File I/O with Zod validation
- **`normalizeConfig()`** — Handles legacy flat arrays and new folder format
- **`list() / get() / create() / update() / remove()`** — Agent CRUD
- **`listFolders() / createFolder() / updateFolder() / removeFolder()`** — Folder CRUD
- **`setActiveFolder()`** — Switch which folder's agents are active
- **`seedDefaults()`** — First-run seeding of Default + Moose Herd presets
- **`reorder()`** — Reorder agents within the active folder

Config file location: `~/.config/opencode/moose-agents.json`

### `instance.ts` — Runtime Instances (SQLite)

Canvas agent instances persisted via Drizzle ORM:

- **`create() / get() / remove()`** — Instance lifecycle
- **`move()`** — Update position (x, y)
- **`setState()`** — Transition state + publish event
- **`setSession()`** — Link instance to a session
- **`spawn()`** — Full spawn flow: validate, create session, create instance, redistribute layout
- **`findBySessionID()`** — Reverse lookup from session to canvas instance
- **`listByParent() / listByWorkspace() / listAll()`** — Query helpers
- **`repelOverlaps()`** — Delegates to layout.ts
- **`pickUniqueName()`** — Random name assignment from 64-name library

### `layout.ts` — Physics & Positioning

Force-directed layout algorithms:

- **`repelOverlaps()`** — Multi-iteration force-directed repulsion pass
  - Pushes overlapping nodes apart using configurable `MIN_DISTANCE` (100px)
  - Golden angle distribution for identical positions
  - 3 iterations per pass
- **`redistributeSiblings()`** — Distributes children in a 144-degree arc around parent
  - Configurable spread angle and max slots (12)
  - Even distribution for any count of siblings
- **`LAYOUT` constants** — `MIN_DISTANCE`, `REPEL_ITERATIONS`, `SPAWN_DISTANCE`, `SPREAD_ANGLE`, `MAX_SLOTS`

Uses callback injection pattern to avoid circular dependency with instance.ts.

### `spawn.ts` — Delegation Rules

Pure functions for spawn validation:

- **`isSpawnAllowed(parentDef, childDefID)`** — Check if parent's `spawnable.agents[]` includes the child
- **`checkSpawnLimit(parentDef, count)`** — Enforce numeric limits or auto cap (20)
- **`calculateChildPosition()`** — Initial position for new children
- **`isOrchestrator(def)`** — True if the definition has a non-empty `spawnable.agents[]`

### `communication.ts` — Inter-Agent Messaging

Validated parent-child message passing:

- **`send()`** — Send typed message between directly related instances
  - Child -> Parent: `question`, `scope_request`, `result`
  - Parent -> Child: `answer`, `result`
  - Validates direct parent-child relationship
  - Touches both instances to reset idle timers
- **`escalate()`** — Route questions up the hierarchy
  - Has parent: sends `scope_request` to parent
  - Top-level: sets state to `question` for user input

### `events.ts` — Bus Events

Six SSE-streamed event types:

| Event | Payload | When |
|-------|---------|------|
| `Spawned` | instance, parentInstanceID | New instance created |
| `StateChanged` | instanceID, state, error, timeLastActive | State transition |
| `Deleted` | instanceID, workspaceSessionID | Instance removed |
| `Moved` | instanceID, x, y | Position updated |
| `Message` | from, to, type, content | Inter-agent message |
| `GCWarning` | instanceID, secondsRemaining | Approaching idle timeout |

### `gc.ts` — Garbage Collection

Scheduled cleanup of idle agents:

- **Sweep interval**: 30 seconds
- **Rules**:
  - Top-level agents (no parent) are never auto-deleted
  - `idle_timeout: 0` means never auto-delete
  - Working agents are skipped
  - Cascade delete: children removed before parent
  - Warning events emitted 30 seconds before deletion
- **Orphan cleanup**: Archives child sessions with no matching canvas instance (60s grace period)

### `presets/default.ts` — Default Folder

6 agents with Kilo Code-adapted prompts:

| Agent | Role | Tools |
|-------|------|-------|
| Architect | orchestrator | read, browser, planning, interaction, skills, task |
| Coder | coder | read, edit, command, planning, interaction, skills |
| Ask | researcher | read, browser, interaction, skills |
| Debugger | debugger | read, edit, command, browser, planning, interaction, skills |
| Reviewer | general | read, command, interaction |
| Orchestrator | orchestrator | read, task, planning, interaction |

### `presets/moose-herd.ts` — Moose Herd Folder

7 agents in a hierarchical orchestration pattern:

| Agent | Role | Spawnable Children |
|-------|------|--------------------|
| Bull Moose | orchestrator | junior_moose, smart_moose, debug_moose, trail_moose, scout_moose |
| Junior Moose | sub_orchestrator | deer (limit: 5) |
| Deer | coder | (none — leaf agent) |
| Smart Moose | researcher | (none) |
| Debug Moose | debugger | (none) |
| Trail Moose | general | (none) |
| Scout Moose | explorer | (none) |

---

## Agent Bridge

The bridge translates Moose agent definitions into OpenCode's native agent format.

**File**: `packages/opencode/src/agent/agent.ts`

Key function: `translateMooseToAgent()` converts each `AgentDefinitionInfo` into an OpenCode agent with:

1. **Tool permissions** — `buildToolPerms()` expands tool group names (e.g., `"read"` -> `["read", "glob", "grep", "codesearch", "lsp"]`) and generates allow/deny rules
2. **Orchestrator permissions** — `buildOrchestratorPerms()` grants task/todo/question/plan tools to orchestrators
3. **MCP permissions** — `buildMcpPerms()` translates MCP deny lists
4. **Plan mode** — `buildPlanPerms()` denies edit tools when `permissionMode: "plan"`
5. **Thinking options** — `buildThinkingOptions()` passes through budget/effort config
6. **Model override** — Uses the definition's model or falls back to parent session's model

---

## Tool Scoping

**File**: `packages/opencode/src/tool/registry.ts`

Tool groups map human-readable names to individual tool IDs:

| Group | Label | Tools |
|-------|-------|-------|
| `read` | Read & Search | read, glob, grep, codesearch, lsp |
| `edit` | Edit & Write | edit, write, apply_patch |
| `command` | Shell | bash |
| `browser` | Web Access | webfetch, websearch |
| `task` | Subtasks | task |
| `planning` | Planning | todoread, todowrite |
| `interaction` | Interaction | question |
| `skills` | Skills | skill |

When `tools.mode: "scoped"`, only tools from allowed groups are available. When `tools.mode: "all"`, all tools are available unless explicitly denied.

---

## API Routes

**File**: `packages/opencode/src/server/routes/moose-agent.ts`

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/moose-agent` | List active folder's agents |
| GET | `/moose-agent/:id` | Get agent by ID |
| POST | `/moose-agent` | Create agent |
| PUT | `/moose-agent/:id` | Update agent |
| DELETE | `/moose-agent/:id` | Delete agent |
| PATCH | `/moose-agent/reorder` | Reorder agents |
| GET | `/moose-agent-folder` | List all folders + active folder |
| POST | `/moose-agent-folder` | Create folder |
| PUT | `/moose-agent-folder/:id` | Update folder |
| DELETE | `/moose-agent-folder/:id` | Delete folder |
| PUT | `/moose-agent-active-folder` | Switch active folder |
| GET | `/tools` | List tool groups (for scoping UI) |

---

## Frontend Components

### Sidebar (`packages/app/src/components/sidebar-agents.tsx`)
- Folder switcher with colored indicators
- Agent list with drag-to-reorder
- Right-click context menu (edit, delete, duplicate)
- Create Agent dialog with full configuration form
- Tool scoping UI (all/scoped mode toggle, group checkboxes)

### Canvas (`packages/app/src/components/canvas/`)
- **agent-canvas.tsx** — Main canvas container with pan/zoom
- **agent-node.tsx** — Individual agent node rendering
- **agent-node-context-menu.tsx** — Right-click actions on nodes
- **canvas-physics.ts** — Client-side physics engine for smooth animation
- **canvas-minimap.tsx** — Overview minimap
- **canvas-zoom-controls.tsx** — Zoom in/out/fit controls
- **canvas-cost-tracker.ts** — Per-agent cost tracking

### Context (`packages/app/src/context/canvas.tsx`)
- Solid.js reactive store for canvas state
- SSE event handlers for real-time updates
- Instance CRUD operations (spawn, move, delete)

---

## Configuration

### Agent Definition Schema

```json
{
  "id": "coder",
  "name": "Coder",
  "description": "Write, modify, and refactor code",
  "color": "#4CAF50",
  "prompt": "You are a highly skilled software engineer...",
  "role": "coder",
  "model": {
    "providerID": "openrouter",
    "modelID": "openai/gpt-5.2-codex"
  },
  "permissionMode": "build",
  "thinking": { "effort": "medium" },
  "tools": {
    "mode": "scoped",
    "allow": ["read", "edit", "command"]
  },
  "spawnable": {
    "agents": ["deer"],
    "limit": 5
  },
  "idle_timeout": 90,
  "order": 1
}
```

### Folder Config (`moose-agents.json`)

```json
{
  "activeFolder": "default",
  "folders": [
    {
      "id": "default",
      "name": "Default",
      "color": "#64b5f6",
      "agents": [ ... ]
    },
    {
      "id": "moose_herd",
      "name": "Moose Herd",
      "color": "#8B4513",
      "agents": [ ... ]
    }
  ]
}
```
