# Agent Management Improvements

## Overview

Add agent cloning/duplication, bulk canvas actions, and sidebar search/filter for managing large agent setups.

---

## Current State

- **No cloning** — to create a similar agent, you must manually create a new one and re-enter all fields
- **No bulk actions** — can only delete/interact with one agent at a time
- **No sidebar search** — flat list of definitions with no filtering; `sidebar-agents.tsx` iterates definitions with a simple `For` loop
- **Single-select only** — `selectedID: string | undefined` in the canvas store; no multi-select

---

## Design: Agent Duplication/Cloning

### Right-Click Context Menu Addition

Add "Duplicate" to the existing agent node context menu (`agent-node-context-menu.tsx`):

```
┌─────────────────────┐
│  ⚡ Send Task        │
│  👁 View Chat        │
│  📋 Duplicate        │  ← NEW
│  ───────────────     │
│  🗑 Delete           │
└─────────────────────┘
```

### Duplicate Behavior

1. Copy the agent's definition (same `agentDefinitionID`)
2. Create a new instance at an offset position (+80px right, +40px down)
3. The clone gets its own fresh session
4. Clone is auto-selected after creation

```typescript
async function duplicateInstance(instanceID: string) {
  const instance = canvas.instances.find(i => i.id === instanceID)
  if (!instance) return

  const cloned = await canvas.addInstance({
    workspaceSessionID: instance.workspaceSessionID,
    agentDefinitionID: instance.agentDefinitionID,
    parentInstanceID: instance.parentInstanceID,
    positionX: instance.positionX + 80,
    positionY: instance.positionY + 40,
  })

  if (cloned) {
    canvas.select(cloned.id)
  }
}
```

### Sidebar Duplicate

Also add a "Duplicate" option in the sidebar agent definition menu (the `...` dropdown) — this creates a new *definition* clone that can be customized.

---

## Design: Bulk Canvas Actions

### Multi-Select via Shift+Click

Hold Shift and click multiple nodes to add them to a selection set:

```typescript
// In canvas store:
type CanvasStore = {
  // ... existing ...
  selectedIDs: Set<string>  // replaces selectedID for multi-select
}

function select(id: string, additive = false) {
  if (additive) {
    setStore("selectedIDs", prev => new Set([...prev, id]))
  } else {
    setStore("selectedIDs", new Set([id]))
  }
}
```

In `agent-canvas.tsx` node click handler:

```typescript
onClick={(e) => {
  e.stopPropagation()
  canvas.select(instance.id, e.shiftKey)
}}
```

### Bulk Action Bar

When 2+ nodes are selected, show a floating action bar:

```
┌──────────────────────────────────┐
│  3 selected   [Delete All]  [X]  │
└──────────────────────────────────┘
```

Actions:
- **Delete All** — remove all selected instances (with confirmation for 3+)
- **Close** — clear selection

Future actions (v0.3+):
- Reset state (set all to idle)
- Move to folder
- Group into cluster

### Keyboard Shortcuts

- `Ctrl+A` — select all nodes
- `Delete` / `Backspace` — delete all selected (already works for single, extend to multi)
- `Escape` — clear selection

---

## Design: Sidebar Search/Filter

### Search Input

Add a search field at the top of the sidebar agent list:

```
┌──────────────────────────┐
│  [🔍 Search agents...]   │
├──────────────────────────┤
│  🟠 Architect       [0]  │
│  🟢 Coder           [2]  │
│  ...                      │
```

### Filter Logic

Filter definitions by name and description (case-insensitive):

```typescript
const [searchTerm, setSearchTerm] = createSignal("")

const filteredDefinitions = createMemo(() => {
  const term = searchTerm().toLowerCase().trim()
  if (!term) return canvas.definitions
  return canvas.definitions.filter(d =>
    d.name.toLowerCase().includes(term) ||
    (d.description?.toLowerCase().includes(term) ?? false) ||
    (d.role?.toLowerCase().includes(term) ?? false)
  )
})
```

### Role Filter Pills

Optional quick-filter pills below the search:

```
[All] [Orchestrator] [Coder] [Researcher] [General]
```

These filter by the `role` field on definitions.

### Empty State

When search yields no results:

```
No agents match "xyz"
[Create Agent] with this name?
```

---

## Implementation Checklist

### Agent Duplication
- [ ] Add "Duplicate" to `agent-node-context-menu.tsx`
- [ ] Implement `duplicateInstance()` in canvas context — creates new instance at offset position
- [ ] Add "Duplicate Definition" to sidebar agent dropdown menu
- [ ] Implement definition clone via `POST /moose-agent` with copied fields + new ID

### Bulk Actions
- [ ] Replace `selectedID: string | undefined` with `selectedIDs: Set<string>` in canvas store
- [ ] Update all `selectedID` references across canvas components
- [ ] Add Shift+click for additive selection in `agent-canvas.tsx`
- [ ] Bulk action bar component — appears when 2+ selected
- [ ] Bulk delete with confirmation dialog
- [ ] Extend Delete/Backspace keyboard shortcut to work with multi-select
- [ ] Ctrl+A to select all

### Sidebar Search/Filter
- [ ] Add search input to `sidebar-agents.tsx` header
- [ ] Implement `filteredDefinitions` memo with name/description/role search
- [ ] Optional: role filter pills
- [ ] Empty state with create suggestion

---

## Files Touched

| File | Action |
|------|--------|
| `packages/app/src/components/canvas/agent-node-context-menu.tsx` | Add "Duplicate" menu item |
| `packages/app/src/context/canvas.tsx` | Add `duplicateInstance()`, change `selectedID` → `selectedIDs` |
| `packages/app/src/components/canvas/agent-canvas.tsx` | Shift+click multi-select, update selectedID references |
| `packages/app/src/components/canvas/agent-node.tsx` | Update `selected` prop for multi-select |
| `packages/app/src/components/canvas/bulk-action-bar.tsx` | **New** — floating action bar for multi-select |
| `packages/app/src/components/sidebar-agents.tsx` | Add search input + filter logic |
| `packages/app/src/components/canvas/agent-canvas.css` | Bulk action bar styles |

---

## Migration Note: selectedID → selectedIDs

Changing from single-select to multi-select touches many components. The migration path:

1. Keep backward compat: `selectedID` accessor returns `selectedIDs.values().next().value` (first selected)
2. Add `selectedIDs` accessor for components that need the full set
3. Update `agent-canvas.tsx`, `agent-node.tsx`, `session-prompt-dock.tsx`, `active-instances-overlay.tsx` to use new accessor
4. The agent chat panel always shows the **first** selected agent's chat (same as current behavior for single-select)
