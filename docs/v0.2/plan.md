# Project Moose v0.2 — Stability & Usability

## Theme

v0.2 focuses on making the existing agent canvas **stable, polished, and usable** rather than adding new multi-agent features. The v0.1 foundation (canvas, spawning, agent chat, connections, todos) works but needs refinement across six areas:

1. **Canvas Physics** — Force-directed physics engine for organic node layout
2. **Canvas UX** — Zoom, pan, minimap, snap-to-grid
3. **Agent Folders** — Switchable agent preset folders (Default + Moose Herd)
4. **Tool Scoping & Skills** — Per-agent tool access control and skill library
5. **Agent Chat Polish** — Markdown rendering, scroll UX, message copy
6. **Agent Management** — Cloning, bulk actions, sidebar search
7. **Error Recovery** — Retry/reset for errored agents, session cleanup
8. **Performance** — Lazy message loading, debounced position persistence

Group chat was removed from v0.2 scope — it introduced too much complexity before the core experience was solid.

---

## Feature Plans

Each feature has a detailed plan document:

| Feature | Plan Document | Priority |
|---------|--------------|----------|
| Canvas Physics & Animation | [`canvas-physics-plan.md`](canvas-physics-plan.md) | P0 — fixes jank, makes canvas feel alive |
| Canvas UX (Zoom/Pan/Minimap) | [`canvas-ux-plan.md`](canvas-ux-plan.md) | P0 — canvas is unusable without zoom/pan |
| Agent Folders | [`agent-folders-plan.md`](agent-folders-plan.md) | P1 — enables Default mode + preset switching |
| Tool Scoping & Skills | [`tool-scoping-plan.md`](tool-scoping-plan.md) | P1 — makes agents safer and smarter |
| Agent Chat Polish | [`agent-chat-polish-plan.md`](agent-chat-polish-plan.md) | P1 — markdown, scroll, copy |
| Agent Management | [`agent-management-plan.md`](agent-management-plan.md) | P2 — clone, bulk actions, search |
| Error Recovery & Cleanup | [`error-recovery-plan.md`](error-recovery-plan.md) | P1 — users need recovery paths |
| Performance | [`performance-plan.md`](performance-plan.md) | P2 — lazy loading, debounced persistence |

---

## What Was Removed

### Group Chat (v0.2-alpha → reverted)

The initial group chat implementation (lasso select → shared session → round-robin prompting) was built and pushed but had fundamental issues:

- Shared session approach didn't support per-agent tool calling
- Message parts didn't resolve correctly
- Session status detection was unreliable
- Added significant code complexity across 6 files

All group chat code was fully reverted. Group chat may return in v0.3 with a centroid node + per-agent session architecture.

---

## Implementation Order

```
Phase 1: Canvas Foundation (highest visual impact)
  ├─ Canvas Physics — force-directed engine, spring connections, spawn physics
  ├─ Canvas UX — zoom/pan, minimap, zoom controls
  └─ Agent Node — switch to transform: translate3d(), GPU compositing

Phase 2: Agent System (enables specialization)
  ├─ Agent Folders — folder CRUD, Default + Moose Herd presets, sidebar selector
  └─ Tool Scoping & Skills — tool picklist UI, skill picker, backend filtering

Phase 3: Chat & Interaction Polish
  ├─ Agent Chat — markdown rendering, smart scroll, copy button
  ├─ Error Recovery — retry/reset UI, error tooltips, session cleanup
  └─ Agent Management — clone, Shift+click multi-select, sidebar search

Phase 4: Performance
  ├─ Lazy message loading (last 50 + load more)
  └─ Debounced/batched position persistence
```

---

## Success Criteria

### Canvas
- [ ] Nodes float and settle organically (no jitter, no overlap)
- [ ] Dragging a node causes connected nodes to follow via spring forces
- [ ] Spawning has physics-driven entrance (starts at parent, pushed outward)
- [ ] Zero CPU when canvas is at rest
- [ ] Scroll wheel zooms, middle-click pans
- [ ] Minimap shows all nodes with viewport rectangle
- [ ] Fit-to-view button centers all nodes

### Agents
- [ ] Folder selector in sidebar, can switch between Default and Moose Herd
- [ ] Default folder has Architect, Coder, Ask, Debugger, Reviewer, Orchestrator
- [ ] Each default agent has appropriate tool scoping
- [ ] Skills can be attached to agent definitions
- [ ] Right-click → Duplicate creates a clone at offset position
- [ ] Sidebar has search/filter for agent definitions

### Chat
- [ ] Agent chat renders markdown (code blocks, bold, lists)
- [ ] Hover to copy any message
- [ ] Smart auto-scroll (only if at bottom)
- [ ] "Scroll to bottom" button with new message count

### Error Recovery
- [ ] Error badge shows tooltip with error message
- [ ] Right-click errored agent → Retry or Reset
- [ ] Error bar in chat panel with retry/reset buttons
- [ ] Deleting an agent also cleans up its session

### Performance
- [ ] Chat shows last 50 messages initially, loads more on scroll
- [ ] Physics positions batch-persist on settle, not per-frame
