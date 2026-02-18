# Error Recovery & Session Cleanup

## Overview

Add clear recovery paths when agents hit errors, and clean up orphaned sessions that accumulate from deleted agents.

---

## Current State

- **Error display** — agents in error state show a red `!` badge and pulsing red border animation
- **Error message stored** — `errorMessage` field exists on `AgentInstanceInfo`, set via `moose.agent.state_changed` event
- **No recovery UI** — no retry button, no way to reset an errored agent from the canvas
- **No error details** — the error message is stored but not shown anywhere in the UI
- **`setInstanceState()` exists** — can programmatically set agent state (PATCH to backend), but no UI wires to it
- **Session cleanup** — `removeInstance()` DELETEs the agent instance, but the underlying session may persist
- **GC warnings** — idle timeout countdown is displayed in the active-instances overlay, agents auto-delete after timeout
- **No orphan detection** — no mechanism to find sessions without associated agent instances

---

## Design: Error Recovery UI

### Error Details Tooltip

Hover over the error badge to see the error message:

```tsx
// In agent-node.tsx
<Show when={state() === "error"}>
  <Tooltip value={props.instance.errorMessage ?? "Unknown error"} placement="top">
    <div class="agent-error-badge">!</div>
  </Tooltip>
</Show>
```

### Error Actions in Node Context Menu

Add error-specific actions to the right-click context menu when the agent is in error state:

```
┌─────────────────────────┐
│  ⚠ Error: API rate limit│  ← error message summary
│  ───────────────────    │
│  🔄 Retry Last Prompt   │  ← re-sends the last user message
│  ⏮ Reset to Idle        │  ← clears error state
│  📋 Copy Error           │  ← copies error message
│  ───────────────────    │
│  🗑 Delete               │
└─────────────────────────┘
```

### Retry Last Prompt

Re-sends the most recent user message to the agent's session:

```typescript
async function retryAgent(instanceID: string) {
  const instance = canvas.instances.find(i => i.id === instanceID)
  if (!instance?.sessionID) return

  // Get the last user message from the session
  const messages = sync.data.message[instance.sessionID] ?? []
  const lastUserMsg = [...messages].reverse().find(m => m.role === "user")
  if (!lastUserMsg) return

  const parts = sync.data.part[lastUserMsg.id] ?? []
  const textParts = parts.filter(p => p.type === "text")
  if (textParts.length === 0) return

  // Reset to working state
  await canvas.setInstanceState(instanceID, "working")

  // Re-send the prompt
  const def = canvas.definitionFor(instance)
  await sdk.client.session.promptAsync({
    sessionID: instance.sessionID,
    agent: def?.id ?? instance.agentDefinitionID,
    ...(def?.model ? { model: { providerID: def.model.providerID, modelID: def.model.modelID } } : {}),
    parts: textParts.map(p => ({ type: "text" as const, text: (p as any).text })),
  })
}
```

### Reset to Idle

Simply clears the error state without retrying:

```typescript
async function resetAgent(instanceID: string) {
  await canvas.setInstanceState(instanceID, "idle")
}
```

### Error State in Chat Panel

When viewing an errored agent's chat, show the error prominently:

```tsx
<Show when={selectedAgent()?.state === "error"}>
  <div class="flex items-center gap-2 px-3 py-2 mt-2 rounded-md border border-red-500/30 bg-red-500/5">
    <span class="text-red-400 text-12-medium">⚠ Error</span>
    <span class="text-11-regular text-text-weak flex-1 truncate">
      {selectedAgent()!.errorMessage ?? "Unknown error"}
    </span>
    <button class="text-11-medium text-purple-400 hover:text-purple-300" onClick={retryAgent}>
      Retry
    </button>
    <button class="text-11-medium text-text-weak hover:text-text-strong" onClick={resetAgent}>
      Reset
    </button>
  </div>
</Show>
```

---

## Design: Session Cleanup

### Orphan Detection

When an agent instance is deleted, its session may still exist on the backend. Add cleanup:

```typescript
async function removeInstance(instanceID: string) {
  const instance = store.instances.find(i => i.id === instanceID)
  const sessionID = instance?.sessionID

  // Optimistic removal
  setStore("instances", (instances) => instances.filter((i) => i.id !== instanceID))

  try {
    await fetch(`${sdk.url}/agent-instance/${instanceID}`, {
      method: "DELETE",
      headers: { "x-opencode-directory": sdk.directory },
    })

    // Also clean up the session if it exists
    if (sessionID) {
      await fetch(`${sdk.url}/session/${sessionID}`, {
        method: "DELETE",
        headers: { "x-opencode-directory": sdk.directory },
      }).catch(() => {}) // Best effort
    }
  } catch {
    // Revert on next fetch
  }
}
```

### Periodic Orphan Scan (Backend)

This is a backend improvement — on startup or periodically, find sessions that:
1. Were created by an agent instance (have agent metadata)
2. No corresponding agent instance exists
3. Are older than 1 hour

These can be flagged for cleanup. This is a v0.3 backend task — for v0.2, just ensure we clean up on delete.

---

## Implementation Checklist

### Error Recovery
- [ ] Add error message tooltip on error badge in `agent-node.tsx`
- [ ] Add error-specific menu items in `agent-node-context-menu.tsx` (Retry, Reset, Copy Error)
- [ ] Implement `retryAgent()` — re-sends last user message to agent session
- [ ] Implement `resetAgent()` — sets state to idle
- [ ] Add error bar with retry/reset in agent chat panel (`session-prompt-dock.tsx`)

### Session Cleanup
- [ ] Modify `removeInstance()` in `canvas.tsx` to also delete the agent's session
- [ ] Add session ID capture before optimistic instance removal

---

## Files Touched

| File | Action |
|------|--------|
| `packages/app/src/components/canvas/agent-node.tsx` | Error badge tooltip |
| `packages/app/src/components/canvas/agent-node-context-menu.tsx` | Error-specific menu items |
| `packages/app/src/context/canvas.tsx` | Session cleanup in `removeInstance()` |
| `packages/app/src/pages/session/session-prompt-dock.tsx` | Error bar with retry/reset in chat panel |
