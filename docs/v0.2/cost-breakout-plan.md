# Plan: Global Context & Cost Breakout by Session

## Goal
Add a cost/token breakout panel to the bottom of the Agent Explorer sidebar, showing aggregated costs across all active canvas agent sessions plus per-agent breakdown.

## Current State
- **Backend**: Every `AssistantMessage` already stores `cost` (USD) and `tokens: { input, output, reasoning, cache: { read, write } }` in the DB
- **Frontend**: `session-context-metrics.ts` computes `totalCost` and full token breakdown per session
- **API**: `GET /session/:id/message` returns all messages with cost/token fields; SSE `message.updated` streams live updates
- **Canvas**: Each `AgentInstanceInfo` has a `sessionID` linking it to its session

## Architecture

### Data Flow
```
AgentInstance.sessionID → GET /session/:id/message → sum assistant.cost → aggregate across all instances
```

### New Endpoint (optional optimization)
Could add `GET /agent-instance/costs?workspaceSessionID=X` that returns `{ instanceID, cost, tokens }[]` in one call instead of N session fetches. But for MVP, fetching per-session is fine since we already have the messages cached.

## Implementation Steps

### Step 1: Create cost aggregation hook
**File**: `packages/app/src/components/canvas/canvas-cost-tracker.ts` (new)

- Export a `createCanvasCostTracker(instances, sdk)` function
- Takes the reactive `instances[]` store from canvas context
- For each instance with a `sessionID`, fetch messages and compute cost
- Returns reactive signals:
  - `totalCost: number` — sum across all active agent sessions
  - `perAgent: { instanceID, definitionID, displayName, cost, tokens }[]`
  - `totalTokens: { input, output, reasoning, cacheRead, cacheWrite }`
- Re-fetches on SSE `message.updated` events (already available via the SDK subscription)
- Polling fallback: refresh every 10s while any agent is in "working" state

### Step 2: Add cost panel to sidebar-agents.tsx
**File**: `packages/app/src/components/sidebar-agents.tsx`

Insert a new `shrink-0` section between the System Agents section and the "Create Agent Type" button.

**Layout**:
```
┌─────────────────────────────┐
│ SESSION COST         $0.0847│  ← header + total cost
│─────────────────────────────│
│ ● Bull Moose        $0.0312 │  ← per-agent rows (colored dot)
│ ● Deer              $0.0201 │
│ ● Smart Moose       $0.0189 │
│ ● Debug Moose       $0.0145 │
│─────────────────────────────│
│ IN: 12.4K  OUT: 3.2K  💭1.1K│  ← token summary row
│ CACHE: ↓8.2K ↑2.1K         │  ← cache read/write
└─────────────────────────────┘
```

**Behavior**:
- Collapsed by default — shows only `SESSION COST  $0.0847` as a single compact row
- Click to expand the per-agent breakdown + token summary
- Updates live as agents work (via SSE cost updates)
- Per-agent rows sorted by cost descending
- Only show agents that have a session (skip instances with no `sessionID`)
- Color dot matches the agent definition color

### Step 3: Wire up to canvas context
**File**: `packages/app/src/context/canvas.tsx`

- Import and initialize the cost tracker in the canvas provider
- Pass `instances` and `sdk` to the tracker
- Expose `canvasCosts` on the canvas store or as a separate signal
- The sidebar-agents component reads from this

### Step 4: Format helpers
**File**: `packages/app/src/components/canvas/canvas-cost-tracker.ts`

Utility functions:
- `formatCost(n: number)` → `$0.0847` (4 decimal places) or `$1.23` (2 decimals if > $1)
- `formatTokens(n: number)` → `12.4K` or `1.2M` for large counts
- Reuse existing patterns from `session-context-metrics.ts`

## Styling
- Match existing sidebar dark theme: `#0f0d1a` bg, purple accent borders `rgba(139, 92, 246, 0.12)`
- Cost numbers in monospace green `#4ade80` (to match financial display conventions)
- Token labels in `text-text-weak` (`#8b87a0`)
- Collapsed row: `text-12-medium` for label, `text-12-regular font-mono` for amount
- Expanded per-agent rows: `text-11-regular` with small colored dot

## Edge Cases
- No active agents → hide the panel entirely
- Agent with no session yet (just spawned) → show "—" for cost
- Very fast cost updates → debounce aggregation to 1s
- Session archived by GC → stop tracking that instance's cost
- Workspace session changes → reset all tracked costs

## Files Modified
1. `packages/app/src/components/canvas/canvas-cost-tracker.ts` — **NEW** — cost aggregation logic
2. `packages/app/src/components/sidebar-agents.tsx` — add cost panel UI
3. `packages/app/src/context/canvas.tsx` — wire up cost tracker to canvas store

## Dependencies
- No new backend changes needed — all data already available via existing APIs
- No new npm packages needed
