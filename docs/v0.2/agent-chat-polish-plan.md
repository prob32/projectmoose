# Agent Chat Polish

## Overview

Improve the agent chat panel with better scroll UX, markdown rendering, message copy, and prompt history navigation.

---

## Current State

- **Scroll** — auto-scrolls to bottom on new messages via `scrollAnchor.scrollIntoView()`. No "scroll to bottom" button when user scrolls up. New messages can jolt the user's reading position.
- **Markdown** — `MarkedProvider` exists in the app (from `@opencode-ai/ui`), but the agent chat's `ChatBubble` renders text with `whitespace-pre-wrap` — no markdown processing.
- **Copy** — clipboard utility exists in `use-session-commands.tsx` (both `execCommand` fallback and `navigator.clipboard`). No per-message copy button in the chat panel.
- **Prompt history** — fully implemented in `prompt-input/history.ts` with up/down navigation, dedup, and 100-item limit. Already wired into the PromptInput component.

---

## Design: Scroll UX

### "Scroll to Bottom" Button

When the user scrolls up away from the bottom, show a floating button to jump back:

```tsx
const [isAtBottom, setIsAtBottom] = createSignal(true)

function handleScroll(e: Event) {
  const el = e.target as HTMLDivElement
  const threshold = 60
  setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < threshold)
}

// Show button when not at bottom
<Show when={!isAtBottom()}>
  <button class="scroll-to-bottom-btn" onClick={() => scrollToBottom()}>
    ↓ New messages
  </button>
</Show>
```

### Smart Auto-Scroll

Only auto-scroll if the user is already at/near the bottom. If they've scrolled up to read, don't steal their position:

```typescript
createEffect(() => {
  messages() // reactive trigger
  if (isAtBottom()) {
    requestAnimationFrame(() => scrollAnchor?.scrollIntoView({ behavior: "smooth" }))
  }
})
```

### Unread Message Count

When the user is scrolled up and new messages arrive, show a count badge on the scroll button:

```
[↓ 3 new messages]
```

---

## Design: Markdown Rendering

### Reuse Existing Infrastructure

The app already has `MarkedProvider` and the `@opencode-ai/ui` package has markdown rendering components used in the main session view (e.g., `SessionTurn`).

### Integration in ChatBubble

Replace raw `whitespace-pre-wrap` text with the same markdown renderer used elsewhere:

```tsx
// Before:
<div class="whitespace-pre-wrap break-words">{(part as { text: string }).text}</div>

// After:
<Markdown text={(part as { text: string }).text} />
```

The `Markdown` component should handle:
- Code blocks with syntax highlighting
- Inline code
- Headers, bold, italic
- Lists (ordered + unordered)
- Links (open in new tab)
- Tables

### Lightweight Mode

For the compact agent chat panel, use a lighter markdown variant:
- Skip large code block chrome (no filename headers, smaller font)
- Compact paragraph spacing
- No image rendering (agent chat shouldn't have images)

---

## Design: Copy Message

### Per-Message Copy Button

Add a small copy icon that appears on hover for each message bubble:

```tsx
function ChatBubble(props: { ... }) {
  const [copied, setCopied] = createSignal(false)
  const textContent = createMemo(() =>
    textParts().map(p => (p as { text: string }).text).join("\n")
  )

  async function handleCopy() {
    await copyToClipboard(textContent())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div class="chat-bubble-wrapper group">
      {/* Existing bubble content */}
      <button
        class="copy-btn opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={handleCopy}
      >
        {copied() ? "✓" : "📋"}
      </button>
    </div>
  )
}
```

### Copy Utility

Extract the existing clipboard logic from `use-session-commands.tsx` into a shared utility:

```typescript
// utils/clipboard.ts
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {}
  // Fallback: textarea + execCommand
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.style.cssText = "position:fixed;opacity:0;pointer-events:none"
  document.body.appendChild(textarea)
  textarea.select()
  const ok = document.execCommand("copy")
  document.body.removeChild(textarea)
  return ok
}
```

---

## Design: Prompt History

Already fully implemented in `prompt-input/history.ts`. The PromptInput component already supports up/down arrow navigation through history.

**No changes needed** — this is already working.

---

## Implementation Checklist

### Scroll UX
- [ ] Add `onScroll` handler to messages scroll container to track `isAtBottom`
- [ ] Smart auto-scroll: only scroll to bottom if user is already there
- [ ] "Scroll to bottom" floating button with new message count badge
- [ ] Smooth scroll animation on button click

### Markdown Rendering
- [ ] Import markdown component from `@opencode-ai/ui` into ChatBubble
- [ ] Replace raw text divs with markdown renderer
- [ ] Style markdown for compact agent chat panel (smaller spacing, lighter chrome)
- [ ] Ensure code blocks have syntax highlighting

### Copy Message
- [ ] Extract clipboard utility to shared `utils/clipboard.ts`
- [ ] Add hover-reveal copy button to ChatBubble
- [ ] Show "Copied!" feedback for 2 seconds
- [ ] Copy full text content of message (all text parts joined)

---

## Files Touched

| File | Action |
|------|--------|
| `packages/app/src/pages/session/session-prompt-dock.tsx` | Update ChatBubble with markdown, copy, scroll UX |
| `packages/app/src/utils/clipboard.ts` | **New** — shared clipboard utility |
| `packages/app/src/pages/session/session-prompt-dock.css` | Scroll-to-bottom button styles, copy button styles |
