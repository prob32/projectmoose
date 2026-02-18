# Performance Improvements

## Overview

Optimize message loading and drag persistence to keep the canvas responsive as agents accumulate conversation history.

---

## Current State

- **Message loading** — `sync.session.sync(sid)` loads ALL messages for a session on select. For long-running agents with hundreds of messages, this can be slow and consume memory.
- **Drag persistence** — every `handlePointerUp` after a node drag calls `canvas.moveInstance()` which does an optimistic store update + `fetch PATCH` to the backend. This is fine for single drags but could flood the backend if physics simulation settles multiple nodes.
- **No pagination** — the chat panel renders all messages at once with a simple `<For each={messages()}>`. No virtualization.

---

## Design: Lazy Message Loading

### Initial Load: Last N Messages

When selecting an agent, only load the last 50 messages initially:

```typescript
async function syncAgentSession(sessionID: string) {
  // Load session metadata + last 50 messages
  await sync.session.sync(sessionID, { limit: 50 })
}
```

This requires checking whether the SDK's `sync` supports a `limit` parameter. If not, the frontend can slice:

```typescript
const displayMessages = createMemo(() => {
  const all = messages()
  if (all.length <= 50) return all
  return all.slice(-50) // last 50
})
```

### Load More on Scroll

When the user scrolls to the top of the chat, load older messages:

```typescript
function handleScroll(e: Event) {
  const el = e.target as HTMLDivElement
  if (el.scrollTop === 0 && hasMoreMessages()) {
    loadOlderMessages()
  }
}

async function loadOlderMessages() {
  const oldest = messages()[0]
  if (!oldest) return
  setLoadingMore(true)
  // Fetch messages before the oldest current one
  // Prepend to the messages array
  setLoadingMore(false)
}
```

### Loading Indicator

Show a small spinner at the top when loading older messages:

```tsx
<Show when={loadingMore()}>
  <div class="flex items-center justify-center py-2">
    <span class="text-11-regular text-text-weak animate-pulse">Loading older messages...</span>
  </div>
</Show>
```

### Scroll Position Preservation

When prepending older messages, maintain the user's scroll position:

```typescript
function loadOlderMessages() {
  const el = scrollRef
  const prevScrollHeight = el.scrollHeight

  // ... prepend messages ...

  // Restore scroll position
  requestAnimationFrame(() => {
    el.scrollTop = el.scrollHeight - prevScrollHeight
  })
}
```

---

## Design: Debounced Drag Persistence

### Problem

With the physics engine, many nodes may need position updates when the simulation settles. Sending individual PATCH requests per node per frame is wasteful.

### Batch Persist on Settle

Instead of persisting positions during physics simulation, batch-persist when the simulation settles:

```typescript
// In canvas-physics.ts
onSettle() {
  // Simulation has cooled below alphaMin — persist all positions
  const updates = Array.from(this.nodes.values()).map(node => ({
    id: node.id,
    positionX: Math.round(node.x),
    positionY: Math.round(node.y),
  }))
  this.persistPositions(updates)
}
```

### Batch API

Instead of N individual PATCH requests, use a single batch endpoint:

```typescript
async function persistPositions(updates: Array<{ id: string; positionX: number; positionY: number }>) {
  await fetch(`${sdk.url}/agent-instance/batch-position`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-opencode-directory": sdk.directory,
    },
    body: JSON.stringify({ updates }),
  })
}
```

If the batch endpoint doesn't exist yet, fall back to debounced individual requests:

```typescript
// Debounce: only persist after 500ms of no new position changes
const debouncedPersist = debounce((id: string, x: number, y: number) => {
  fetch(`${sdk.url}/agent-instance/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-opencode-directory": sdk.directory },
    body: JSON.stringify({ positionX: x, positionY: y }),
  }).catch(() => {})
}, 500)
```

### Manual Drag

For manual (non-physics) drags, persist only on pointer up — this is already the current behavior and is fine.

---

## Design: Message Virtualization (v0.3)

For agents with 500+ messages, rendering all DOM elements is expensive. A virtual list would only render visible messages plus a buffer:

This is a v0.3 optimization. For v0.2, the lazy loading (showing last 50 + load more) is sufficient.

---

## Implementation Checklist

### Lazy Message Loading
- [ ] Limit initial message display to last 50 messages
- [ ] Add "Load more" behavior on scroll-to-top
- [ ] Loading spinner at top of chat
- [ ] Scroll position preservation when prepending messages
- [ ] Track `hasMoreMessages` state

### Debounced Drag Persistence
- [ ] Add debounced position persist utility
- [ ] Physics engine: batch-persist on simulation settle instead of per-frame
- [ ] Manual drag: persist only on pointer up (already works)
- [ ] Optional: backend batch-position endpoint

---

## Files Touched

| File | Action |
|------|--------|
| `packages/app/src/pages/session/session-prompt-dock.tsx` | Lazy loading, scroll-to-top loader, message slicing |
| `packages/app/src/context/canvas.tsx` | Debounced `moveInstance()`, batch persist on settle |
| `packages/app/src/components/canvas/canvas-physics.ts` | Settle callback for batch persistence (after physics plan) |
| Backend routes (optional) | `PATCH /agent-instance/batch-position` endpoint |
