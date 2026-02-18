# Agent Folders — Preset Agent Configurations

## Overview

Add **folder support** to the left-hand agent sidebar panel so users can organize agent setups into switchable presets. This enables:

- A **"Default"** folder with traditional dev agents (architect, coder, ask, debugger, reviewer, orchestrator) — prompts adapted from Kilo Code's built-in modes
- The current **"Moose Herd"** folder with the existing orchestrator hierarchy
- User-created folders for different workflows (e.g. "Frontend Sprint", "Research Mode", "Debug Session")

Folders act like **agent presets** — activating a folder loads that set of agent definitions onto the canvas. Users can switch between workflows without losing their setups.

---

## Current State

### Sidebar (`sidebar-agents.tsx`)
- **Flat list** of all agent definitions
- No grouping, categories, or folders
- Each row: icon + name + role badge + instance count + edit menu
- "Create Agent" button at bottom
- Data loaded from `GET /moose-agent` → reads `moose-agents.json`

### Config (`moose-agents.json`)
- Flat JSON array of 7 agent definitions
- No folder/group metadata
- Stored at `C:\Users\PatPC\.config\opencode\moose-agents.json`

### Agent Definition Type
```typescript
type AgentDefinitionInfo = {
  id: string
  name: string
  description?: string
  color: string
  prompt: string
  role?: string
  model?: { providerID: string; modelID: string }
  temperature?: number
  mcp?: { servers?: string[]; deny?: string[] }
  spawnable?: { agents: string[]; limit: number | "auto" }
  idle_timeout: number
  order: number
}
```

---

## Design

### Config Schema Change

```jsonc
// moose-agents.json becomes:
{
  "activeFolder": "default",
  "folders": [
    {
      "id": "default",
      "name": "Default",
      "description": "Traditional dev agents — architect, code, ask, debug, review, orchestrate",
      "icon": "terminal",
      "color": "#64b5f6",
      "agents": [ ... ]
    },
    {
      "id": "moose_herd",
      "name": "Moose Herd",
      "description": "Orchestrator hierarchy with Bull Moose at the top",
      "icon": "moose",
      "color": "#8B4513",
      "agents": [ ... ]
    }
  ]
}
```

### Backward Compatibility

If the config is still a flat array (old format), treat it as a single folder called "Custom" and auto-migrate on first write.

```typescript
function normalizeConfig(raw: any): AgentFolderConfig {
  if (Array.isArray(raw)) {
    // Legacy flat array — wrap in a single folder
    return {
      activeFolder: "custom",
      folders: [{ id: "custom", name: "Custom", agents: raw, color: "#9C27B0" }]
    }
  }
  return raw as AgentFolderConfig
}
```

---

## Sidebar UI Changes

### Layout

```
┌──────────────────────────┐
│  [Folder Selector ▾]     │  ← dropdown or tab bar at top
│  "Default"               │
├──────────────────────────┤
│  🟠 Architect       [0]  │  ← current flat list, scoped to active folder
│  🟢 Coder           [2]  │
│  🔵 Ask             [0]  │
│  🩷 Debugger        [1]  │
│  🟣 Reviewer        [0]  │
│  ⚡ Orchestrator    [0]  │
├──────────────────────────┤
│  [+ Create Agent]        │
│  [⚙ Manage Folders]      │
└──────────────────────────┘
```

### Folder Selector

Two options (pick one during implementation):

**Option A: Dropdown** (simpler, recommended for v0.2)
- Compact dropdown at the top of the sidebar
- Shows active folder name + icon
- Click to see all folders
- Selected folder highlights with its color

**Option B: Horizontal tabs** (more visual, v0.3+)
- Small colored tabs at the top
- Each tab shows folder icon or first letter
- Active tab has underline in folder color

### Folder Management

"Manage Folders" button opens a dialog to:
- Create new folder (name, color, description, icon)
- Duplicate existing folder as starting point
- Delete folder (with confirmation — agents are just definitions, no data loss)
- Reorder folders via drag
- Import/export folder as JSON (share agent presets)

### Switching Folders

When the user switches the active folder:
1. Update `activeFolder` in config
2. The sidebar list re-renders with the new folder's agents
3. **Canvas instances are NOT affected** — running agents stay on canvas regardless of which folder is active
4. The folder switch only changes which agent *definitions* are available for spawning

This is important: folders are about which agents you can *create*, not about managing running instances.

---

## Default Folder — Agent Definitions

Prompts adapted from Kilo Code's built-in modes (source: `Kilo-Org/kilocode` `packages/types/src/mode.ts`), reworked for our agent system where each agent runs independently with its own session, tools, and LLM context.

```jsonc
[
  {
    "id": "architect",
    "name": "Architect",
    "description": "Plan and design before implementation",
    "color": "#FF9800",
    "role": "orchestrator",
    "prompt": "You are an experienced technical leader who is inquisitive and an excellent planner. Your goal is to gather information and get context to create a detailed plan for accomplishing the user's task, which the user will review and approve before implementation begins.\n\n## Instructions\n\n1. Do information gathering (using provided tools) to get more context about the task.\n\n2. Ask the user clarifying questions to get a better understanding of the task.\n\n3. Once you've gained context, break down the task into clear, actionable steps. Each step should be:\n   - Specific and actionable\n   - Listed in logical execution order\n   - Focused on a single, well-defined outcome\n   - Clear enough that another agent could execute it independently\n\n4. As you gather more information or discover new requirements, update the plan to reflect the current understanding.\n\n5. Ask the user if they are pleased with this plan, or if they would like to make any changes. Think of this as a brainstorming session where you can discuss the task and refine the plan.\n\n6. Include Mermaid diagrams if they help clarify complex workflows or system architecture.\n\nFocus on creating clear, actionable plans rather than lengthy documents. Never provide level-of-effort time estimates for tasks.",
    "model": { "providerID": "opencode", "modelID": "kimi-k2.5-free" },
    "spawnable": { "agents": ["coder", "ask", "debugger"], "limit": "auto" },
    "idle_timeout": 0,
    "order": 0
  },
  {
    "id": "coder",
    "name": "Coder",
    "description": "Write, modify, and refactor code",
    "color": "#4CAF50",
    "role": "coder",
    "prompt": "You are a highly skilled software engineer with extensive knowledge in many programming languages, frameworks, design patterns, and best practices.\n\nYour job is to write, modify, and refactor code with precision. Follow existing patterns and conventions in the codebase. Make minimal, focused changes. Read surrounding code before editing to understand context. Write clean, well-structured code and explain non-obvious decisions in comments.\n\nWhen given a task:\n1. Read the relevant files first to understand existing patterns\n2. Make the minimum changes needed to accomplish the goal\n3. Follow the project's existing code style and conventions\n4. Test your changes if testing infrastructure is available\n5. Report back what you changed and why",
    "model": { "providerID": "opencode", "modelID": "minimax-m2.5-free" },
    "idle_timeout": 90,
    "order": 1
  },
  {
    "id": "ask",
    "name": "Ask",
    "description": "Get answers and explanations",
    "color": "#2196F3",
    "role": "researcher",
    "prompt": "You are a knowledgeable technical assistant focused on answering questions and providing information about software development, technology, and related topics.\n\nYou can analyze code, explain concepts, and access external resources. Always answer the user's questions thoroughly, and do not switch to implementing code unless explicitly requested. Include diagrams when they clarify your response.\n\nWhen answering:\n1. Read relevant source files to ground your answers in the actual codebase\n2. Provide specific file references and line numbers when discussing code\n3. Explain both the what and the why\n4. If you're uncertain about something, say so and suggest how to verify",
    "model": { "providerID": "opencode", "modelID": "kimi-k2.5-free" },
    "idle_timeout": 120,
    "order": 2
  },
  {
    "id": "debugger",
    "name": "Debugger",
    "description": "Diagnose and fix software issues",
    "color": "#E91E63",
    "role": "debugger",
    "prompt": "You are an expert software debugger specializing in systematic problem diagnosis and resolution.\n\nWhen debugging:\n1. Reflect on 5-7 different possible sources of the problem\n2. Distill those down to 1-2 most likely sources\n3. Add logs or use tools to validate your assumptions\n4. Explicitly confirm the diagnosis before fixing the problem\n5. Implement a targeted fix\n6. Verify the fix doesn't introduce regressions\n\nBe systematic: reproduce the issue, identify the cause, implement the fix, and verify it works. Report your findings clearly back to the user or parent agent.",
    "model": { "providerID": "opencode", "modelID": "kimi-k2.5-free" },
    "idle_timeout": 120,
    "order": 3
  },
  {
    "id": "reviewer",
    "name": "Reviewer",
    "description": "Review code changes locally",
    "color": "#9C27B0",
    "role": "general",
    "prompt": "You are an expert code reviewer with deep expertise in software engineering best practices, security vulnerabilities, performance optimization, and code quality. Your role is advisory — provide clear, actionable feedback.\n\n## How to Review\n\n1. Start with git diff: run `git diff` (for uncommitted) or `git diff <base>..HEAD` (for branch) to see the actual changes.\n\n2. Examine specific files: for complex changes, read the full file context, not just the diff.\n\n3. Gather history context: use `git log`, `git blame`, or `git show` when you need to understand why code was written a certain way.\n\n4. Be confident: only flag issues where you have high confidence.\n   - CRITICAL (95%+): Security vulnerabilities, data loss risks, crashes\n   - WARNING (85%+): Bugs, logic errors, performance issues, unhandled errors\n   - SUGGESTION (75%+): Code quality improvements, best practices\n   - Below 75%: Don't comment — gather more context first\n\n5. Focus on what matters: security, bugs, performance, error handling.\n\n6. Don't flag: style preferences, minor naming suggestions, patterns matching existing conventions.\n\n## Output Format\n\n### Summary\n2-3 sentences on what changed and your overall assessment.\n\n### Issues Found\n| Severity | File:Line | Issue |\n\n### Recommendation\nOne of: APPROVE | APPROVE WITH SUGGESTIONS | NEEDS CHANGES",
    "model": { "providerID": "opencode", "modelID": "kimi-k2.5-free" },
    "idle_timeout": 120,
    "order": 4
  },
  {
    "id": "orchestrator",
    "name": "Orchestrator",
    "description": "Coordinate tasks across multiple agents",
    "color": "#78909C",
    "role": "orchestrator",
    "prompt": "You are a strategic workflow orchestrator who coordinates complex tasks by delegating them to appropriate specialized agents. You have a comprehensive understanding of each agent's capabilities and limitations, allowing you to effectively break down complex problems into discrete tasks.\n\n## Instructions\n\n1. When given a complex task, break it down into logical subtasks that can be delegated to appropriate specialized agents.\n\n2. For each subtask, spawn the most appropriate agent and provide comprehensive instructions including:\n   - All necessary context from the parent task or previous subtasks\n   - A clearly defined scope — what exactly the subtask should accomplish\n   - An explicit statement that the subtask should only perform the outlined work\n\n3. Track and manage the progress of all subtasks. When a subtask is completed, analyze its results and determine the next steps.\n\n4. Help the user understand how the different subtasks fit together in the overall workflow.\n\n5. When all subtasks are completed, synthesize the results and provide a comprehensive overview of what was accomplished.\n\n6. Ask clarifying questions when necessary to better understand how to break down complex tasks effectively.",
    "model": { "providerID": "opencode", "modelID": "kimi-k2.5-free" },
    "spawnable": { "agents": ["architect", "coder", "ask", "debugger", "reviewer"], "limit": "auto" },
    "idle_timeout": 0,
    "order": 5
  }
]
```

### Prompt Source Attribution

The Default folder agent prompts are adapted from [Kilo Code](https://github.com/Kilo-Org/kilocode) (`packages/types/src/mode.ts`, Apache-2.0 license). Key adaptations:

- Removed VS Code-specific tool references (`switch_mode`, `new_task`, `attempt_completion`, `fetch_instructions`)
- Removed references to "Kilo Code" branding — agents are identity-neutral
- Adapted from mode-switching paradigm (single session) to agent-spawning paradigm (per-agent sessions)
- Added spawning configuration for Orchestrator and Architect
- Simplified Reviewer output format (no VS Code follow-up action buttons)

---

## Implementation Checklist

### Backend

- [ ] Update `moose-agents.json` read/write to support folder schema
- [ ] Add backward compatibility (flat array → single folder migration)
- [ ] `GET /moose-agent` → returns agents for active folder (or add `?folder=` query param)
- [ ] `GET /moose-agent-folders` → returns all folders metadata (id, name, color, description, agent count)
- [ ] `PUT /moose-agent-folder/:id` → update folder (rename, reorder, change agents)
- [ ] `POST /moose-agent-folder` → create new folder
- [ ] `DELETE /moose-agent-folder/:id` → delete folder
- [ ] `PUT /moose-agent-active-folder` → switch active folder

### Sidebar (`sidebar-agents.tsx`)

- [ ] Add folder selector dropdown at top of panel
- [ ] Show active folder name + color indicator
- [ ] Dropdown lists all folders with agent counts
- [ ] Switching folders updates the agent list below
- [ ] "Manage Folders" button → opens folder management dialog
- [ ] Agent list scoped to active folder's agents only

### Folder Management Dialog (new: `folder-manage-dialog.tsx`)

- [ ] List all folders with name, color, agent count
- [ ] Create new folder (name, color, description)
- [ ] Duplicate folder
- [ ] Delete folder (with confirmation)
- [ ] Reorder folders via drag or arrows
- [ ] Import folder from JSON file
- [ ] Export folder as JSON file

### Canvas Context (`canvas.tsx`)

- [ ] `definitions` stays as-is (loaded from active folder's agents)
- [ ] Add `activeFolder` and `folders` to store if needed for UI reactivity
- [ ] Folder switch triggers `fetchDefinitions()` refresh

### Config Types (new or extend existing)

```typescript
type AgentFolder = {
  id: string
  name: string
  description?: string
  icon?: string
  color: string
  agents: AgentDefinitionInfo[]
}

type AgentFolderConfig = {
  activeFolder: string
  folders: AgentFolder[]
}
```

### Default Data

- [ ] Ship "Default" folder as built-in preset with Kilo-derived prompts
- [ ] Ship "Moose Herd" folder with current 7-agent orchestrator hierarchy
- [ ] First-time users get both folders, with "Default" active

---

## Files Touched

| File | Action |
|------|--------|
| `moose-agents.json` config | Schema change: flat array → folder structure |
| Backend agent routes | Add folder CRUD endpoints |
| `packages/app/src/components/sidebar-agents.tsx` | Add folder selector, scope agent list |
| `packages/app/src/components/folder-manage-dialog.tsx` | **New** — folder management UI |
| `packages/app/src/context/canvas.tsx` | Minor — refresh definitions on folder switch |
| Default agent presets | **New** — Default folder agents JSON |

---

## Open Questions

1. **Can agents exist in multiple folders?** No — each folder is self-contained. Duplicate the agent if needed in two folders.
2. **What happens to running instances when switching folders?** Nothing. Running instances stay on canvas. The folder only controls what's *available to spawn*.
3. **Import/export format?** Single folder as JSON file — just the `AgentFolder` object. Can be shared between users.
4. **Max folders?** No hard limit, but the dropdown UI works best with ~5-10.
5. **Folder-level model override?** Not in v0.2. Each agent defines its own model. Could add folder-wide model default in v0.3.
