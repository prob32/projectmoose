# Tool Scoping & Skills by Agent

## Overview

Allow per-agent customization of:
1. **Which tools are available** — every tool (read, edit, bash, question, todos, web, etc.) should be individually toggleable via a proper dropdown picklist, not a text field
2. **Which skills are attached** — agents can have specific skills from the skill library pre-loaded, giving them domain-specific knowledge and workflows

An Architect agent shouldn't be able to edit code files. A Reviewer shouldn't have write access. A Coder might have a "bun-file-io" skill attached. Tool scoping makes agents safer and more focused; skills make them smarter.

---

## Current State

### Tool Scoping — What Exists

The agent definition already has an `mcp` field:

```typescript
mcp?: {
  servers?: string[]    // Which MCP servers are available (undefined = all)
  deny?: string[]       // Tool names to deny (e.g. "browser_search")
}
```

This works through the **permission system** — denied tools get converted to `{ permission: toolName, action: "deny", pattern: "*" }` rules in `agent.ts` line 243-286.

**UI is poor** — the deny list is a raw comma-separated text field. No visual picker.

### Skills — What Exists

Skills are **specialized instruction packs** defined as `SKILL.md` files with YAML frontmatter:

```yaml
---
name: bun-file-io
description: Use when working on file operations...
---
# Detailed instructions, workflows, examples...
```

Skills are discovered from:
- `.opencode/skill/` directories (project-level)
- `~/.claude/skills/` and `~/.agents/skills/` (global)
- Config `skills.paths[]` and `skills.urls[]` (explicit)

The `SkillTool` is a standard tool — agents call it to load a skill's content dynamically. Skills appear in the slash command popover. But there's **no way to pre-attach skills to an agent definition**.

### What's Missing

1. **No built-in tool scoping** — can't disable `bash`, `edit`, `write`, `read`, `question`, `todowrite`, etc. per agent
2. **No picklist UI** — just a comma-separated text field for deny
3. **No allow-list mode** — can only deny, not scope to a specific set
4. **No skill attachment** — skills exist but can't be pre-configured per agent definition
5. **No frontend tool awareness** — the frontend doesn't know what built-in tools exist

---

## Design: Tool Scoping

### Agent Definition Schema Change

```typescript
type AgentDefinitionInfo = {
  // ... existing fields ...

  // EXISTING — keep for backward compatibility
  mcp?: {
    servers?: string[]
    deny?: string[]
  }

  // NEW — explicit tool scoping
  tools?: {
    // Mode: "all" (default) = all tools available minus deny list
    //        "scoped" = only explicitly listed tools/groups available
    mode: "all" | "scoped"

    // When mode="scoped": these tool groups or individual tool IDs are available
    allow?: string[]

    // When mode="all": these tool groups or individual tool IDs are denied
    deny?: string[]
  }

  // NEW — pre-attached skills
  skills?: string[]  // Skill names to auto-load for this agent
}
```

### Tool Groups

Group tools into logical categories so users can toggle at the group level or drill into individual tools:

| Group | Tool IDs | Description |
|-------|----------|-------------|
| `read` | `read`, `glob`, `grep`, `codesearch`, `lsp` | Read and search files |
| `edit` | `edit`, `write`, `apply_patch` | Modify files |
| `command` | `bash` | Execute shell commands |
| `browser` | `web_fetch`, `web_search` | Web access |
| `task` | `task` | Spawn subtask agents |
| `planning` | `todoread`, `todowrite` | Todo list management |
| `interaction` | `question` | Ask user questions |
| `skills` | `skill` | Load skill content |
| `mcp` | All MCP server tools | External integrations |

Every tool has a home. Users can toggle at the group level or expand to toggle individual tools within a group.

### Resolution Logic

```typescript
function resolveToolsForAgent(definition: AgentDefinitionInfo, allTools: string[]): Set<string> {
  const toolsConfig = definition.tools

  // No config or mode="all" → all tools minus deny list
  if (!toolsConfig || toolsConfig.mode === "all") {
    const denied = new Set(expandGroups(toolsConfig?.deny ?? []))
    // Also merge legacy mcp.deny
    for (const d of definition.mcp?.deny ?? []) denied.add(d)
    return new Set(allTools.filter(t => !denied.has(t)))
  }

  // mode="scoped" → only allowed tools/groups
  const allowed = expandGroups(toolsConfig.allow ?? [])
  return allowed
}

function expandGroups(items: string[]): Set<string> {
  const result = new Set<string>()
  for (const item of items) {
    if (TOOL_GROUPS[item]) {
      for (const tool of TOOL_GROUPS[item]) result.add(tool)
    } else {
      result.add(item)  // Individual tool ID
    }
  }
  return result
}
```

---

## Design: Skill Attachment

### How It Works

When an agent has `skills: ["bun-file-io", "testing-patterns"]`:

1. **At session start** — before the first user prompt, the orchestrator auto-loads each attached skill's content into the agent's system context
2. **Implementation** — on the backend, when building the agent's system prompt, append each skill's content (same as if the agent had called the `skill` tool)
3. **UI** — the agent edit dialog shows a skill picker populated from `GET /skill`

### Agent System Prompt Assembly

```
[Agent's base prompt from definition]

[Skill: bun-file-io]
<skill_content name="bun-file-io">
... skill markdown content ...
</skill_content>

[Skill: testing-patterns]
<skill_content name="testing-patterns">
... skill markdown content ...
</skill_content>
```

This means the agent starts every session already knowing its attached skills — no need to invoke the skill tool manually.

### Alternative: Inject via First Prompt

Instead of modifying the system prompt, skills could be injected as part of the first `promptAsync` call by prepending skill content to the user's message. This avoids backend system prompt changes but uses more context tokens per turn. The system prompt approach is cleaner.

---

## UI: Agent Edit Dialog

### Current
```
MCP Servers:  [✓] All servers  [ ] browser  [ ] github
Deny tools:   [browser_search, github_create_issue____]
```

### New Layout

```
┌─ Tool Access ─────────────────────────────────────┐
│                                                   │
│  (●) All tools    ( ) Scoped                      │
│                                                   │
│  ┌─ Tool Groups ─────────────────────────────┐    │
│  │                                           │    │
│  │  [✓] Read         read, glob, grep, ...   │    │
│  │  [✓] Edit         edit, write, patch      │    │
│  │  [✓] Command      bash                    │    │
│  │  [✓] Browser      web_fetch, web_search   │    │
│  │  [✓] Subtasks     task                    │    │
│  │  [✓] Planning     todoread, todowrite     │    │
│  │  [✓] Interaction  question                │    │
│  │  [✓] Skills       skill                   │    │
│  │  [✓] MCP          external tools          │    │
│  │                                           │    │
│  │  ▸ Show individual tools                  │    │
│  └───────────────────────────────────────────┘    │
│                                                   │
│  When "All tools" → unchecked groups = denied     │
│  When "Scoped"   → checked groups = allowed       │
│                                                   │
│  MCP Servers: [multi-select dropdown]             │
└───────────────────────────────────────────────────┘

┌─ Skills ──────────────────────────────────────────┐
│                                                   │
│  Attach skills to pre-load for this agent:        │
│                                                   │
│  [multi-select dropdown ▾]                        │
│  ┌───────────────────────────────────────────┐    │
│  │  ☐ bun-file-io                            │    │
│  │    File operations: read, write, scan     │    │
│  │  ☐ testing-patterns                       │    │
│  │    Jest + integration test best practices  │    │
│  │  ☐ git-workflow                           │    │
│  │    Branching, PR, and commit conventions   │    │
│  └───────────────────────────────────────────┘    │
│                                                   │
│  Selected: bun-file-io, testing-patterns          │
└───────────────────────────────────────────────────┘
```

### Individual Tool Expansion

When "Show individual tools" is expanded:

```
┌─ Read ────────────────────────────────────┐
│  [✓] read       — Read file contents      │
│  [✓] glob       — Find files by pattern   │
│  [✓] grep       — Search file contents    │
│  [✓] codesearch — Semantic code search    │
│  [ ] lsp        — Language server (exp.)  │
├─ Edit ────────────────────────────────────┤
│  [✓] edit       — Edit existing files     │
│  [✓] write      — Create new files        │
│  [✓] apply_patch — Apply unified diffs    │
├─ Command ─────────────────────────────────┤
│  [✓] bash       — Execute shell commands  │
├─ Browser ─────────────────────────────────┤
│  [✓] web_fetch  — Fetch URL content       │
│  [✓] web_search — Search the web          │
├─ Subtasks ────────────────────────────────┤
│  [✓] task       — Spawn subtask agent     │
├─ Planning ────────────────────────────────┤
│  [✓] todoread   — Read todo list          │
│  [✓] todowrite  — Update todo list        │
├─ Interaction ─────────────────────────────┤
│  [✓] question   — Ask user a question     │
├─ Skills ──────────────────────────────────┤
│  [✓] skill      — Load skill content      │
├─ MCP ─────────────────────────────────────┤
│  [✓] browser_navigate                     │
│  [✓] browser_search                       │
│  [✓] github_create_issue                  │
│  [ ] github_delete_repo                   │
│  ...                                      │
└───────────────────────────────────────────┘
```

---

## Default Tool Scopes for Default Folder Agents

| Agent | Mode | Tool Groups | Skills | Rationale |
|-------|------|-------------|--------|-----------|
| Architect | scoped | `read`, `browser`, `planning`, `interaction`, `skills`, `task` | — | Can read, research, plan, spawn agents. Cannot edit code. |
| Coder | scoped | `read`, `edit`, `command`, `planning`, `interaction`, `skills` | — | Full code access. No web, no subtask spawning. |
| Ask | scoped | `read`, `browser`, `interaction`, `skills` | — | Read-only. Can search web. Cannot modify anything. |
| Debugger | scoped | `read`, `edit`, `command`, `browser`, `planning`, `interaction`, `skills` | — | Broad access — debugging requires many capabilities. |
| Reviewer | scoped | `read`, `command`, `interaction` | — | Read + git commands. No edit (advisory only). |
| Orchestrator | scoped | `read`, `task`, `planning`, `interaction` | — | Delegates everything. Reads for context, doesn't edit. |

Skills column is empty for defaults — users attach project-specific skills as needed.

---

## Backend Changes

### New `GET /tools` Endpoint

Returns all available tools grouped by category:

```json
{
  "groups": {
    "read": {
      "label": "Read & Search",
      "tools": [
        { "id": "read", "name": "Read File", "description": "Read file contents" },
        { "id": "glob", "name": "Find Files", "description": "Find files by glob pattern" },
        { "id": "grep", "name": "Search", "description": "Search file contents with regex" },
        { "id": "codesearch", "name": "Code Search", "description": "Semantic code search" },
        { "id": "lsp", "name": "LSP", "description": "Language server protocol (experimental)" }
      ]
    },
    "edit": { ... },
    "command": { ... },
    "browser": { ... },
    "task": { ... },
    "planning": { ... },
    "interaction": { ... },
    "skills": { ... },
    "mcp": {
      "label": "MCP Tools",
      "tools": [
        { "id": "browser_navigate", "name": "Navigate", "server": "browser" },
        ...
      ]
    }
  }
}
```

### Skill Injection in Agent System Prompt

In `session/prompt.ts` or the agent initialization path:

```typescript
// When building agent system prompt
let systemPrompt = agent.prompt

if (agent.skills?.length) {
  const allSkills = await Skill.all()
  for (const skillName of agent.skills) {
    const skill = allSkills.find(s => s.name === skillName)
    if (skill) {
      systemPrompt += `\n\n<skill_content name="${skill.name}">\n${skill.content}\n</skill_content>`
    }
  }
}
```

### Tool Filtering in `resolveTools`

In `session/prompt.ts`, after loading all tools:

```typescript
// After collecting all built-in + MCP tools
if (agent.tools?.mode === "scoped") {
  const allowed = expandGroups(agent.tools.allow ?? [])
  // Filter: only keep tools whose ID is in the allowed set
  for (const [id, tool] of Object.entries(result)) {
    if (!allowed.has(id)) delete result[id]
  }
} else if (agent.tools?.deny?.length) {
  const denied = expandGroups(agent.tools.deny)
  for (const id of denied) delete result[id]
}
```

---

## Implementation Checklist

### Backend (`packages/opencode`)

- [ ] Add `tools` and `skills` fields to agent definition schema in `agent/moose/definition.ts`
- [ ] Define `TOOL_GROUPS` constant mapping group names → tool IDs in `tool/registry.ts`
- [ ] Add `GET /tools` endpoint returning tool IDs + groups + descriptions
- [ ] Extend `resolveTools` in `session/prompt.ts` to filter based on `tools.mode`/`tools.allow`/`tools.deny`
- [ ] Extend agent permission building in `agent/agent.ts` for new `tools.deny`
- [ ] Implement skill injection: when agent has `skills[]`, append skill content to system prompt
- [ ] Backward compat: if `tools`/`skills` fields absent, behave exactly as today

### Frontend (`packages/app`)

- [ ] Extend `AgentDefinitionInfo` type in `canvas.tsx` with `tools` and `skills` fields
- [ ] Build `ToolScopeEditor` component:
  - Radio toggle: All / Scoped
  - Group checkboxes with tool counts
  - Expandable individual tool toggles per group
  - MCP server multi-select (within MCP group)
- [ ] Build `SkillPicker` component:
  - Multi-select dropdown populated from `GET /skill`
  - Shows skill name + description
  - Selected skills displayed as tags
- [ ] Integrate both into `agent-edit-dialog.tsx`, replacing the old MCP deny text field
- [ ] Fetch tool list from `GET /tools` on dialog open
- [ ] Update form serialization to include `tools` and `skills` in API calls
- [ ] Show tool scope summary on agent canvas node tooltip

### Default Folder Data

- [ ] Add `tools` config to each Default folder agent definition
- [ ] Moose Herd agents keep `tools: undefined` (all tools, existing behavior)

---

## Files Touched

| File | Action |
|------|--------|
| `packages/opencode/src/agent/moose/definition.ts` | Add `tools` and `skills` to schema |
| `packages/opencode/src/agent/agent.ts` | Extend permission building |
| `packages/opencode/src/session/prompt.ts` | Tool filtering + skill injection |
| `packages/opencode/src/server/routes/session.ts` | Add `GET /tools` endpoint |
| `packages/opencode/src/tool/registry.ts` | Export `TOOL_GROUPS` constant |
| `packages/app/src/context/canvas.tsx` | Extend type definitions |
| `packages/app/src/components/agent-edit-dialog.tsx` | New tool scope + skill picker UI |
| `packages/app/src/components/tool-scope-editor.tsx` | **New** — tool group/individual picker |
| `packages/app/src/components/skill-picker.tsx` | **New** — skill multi-select |
| Default folder agent definitions | Add `tools` config per agent |

---

## Open Questions

1. **Should any tool always be available?** No. Even `question` should be toggleable — some headless/automated agents shouldn't pause for user input.
2. **MCP tool granularity?** MCP is one group for toggling. Individual MCP tool control uses the existing `mcp.deny` mechanism plus the individual tool expansion UI.
3. **Skill auto-load vs. lazy-load?** Auto-load at session start (inject into system prompt). This uses tokens but ensures the agent always has the context. Lazy-load (via skill tool) remains available for ad-hoc use.
4. **Can skills be scoped per folder?** Not in v0.2 — skills are global. Folder-scoped skill libraries could be v0.3.
5. **Runtime enforcement?** Both — tool not sent to LLM (can't attempt to use it) AND permission system denies it as a safety net.
