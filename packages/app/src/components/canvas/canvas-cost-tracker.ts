import { createSignal, createEffect, onCleanup } from "solid-js"
import type { AgentInstanceInfo, AgentDefinitionInfo } from "@/context/canvas"

export type DefinitionCostEntry = {
  definitionID: string
  cost: number
  tokens: {
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite: number
  }
}

/** Map from definitionID → aggregated cost for all instances of that type */
export type CostByDefinition = Record<string, DefinitionCostEntry>

/**
 * Fetches messages for all active agent instances and aggregates cost/token data
 * by agent definition type. Designed to work outside the SyncProvider.
 */
export function createCanvasCostTracker(
  getInstances: () => AgentInstanceInfo[],
  getDefinitions: () => AgentDefinitionInfo[],
  serverUrl: string,
  directory: string,
) {
  const [costByDefinition, setCostByDefinition] = createSignal<CostByDefinition>({})
  let abortController: AbortController | null = null

  async function refresh() {
    const instances = getInstances()
    if (instances.length === 0) {
      setCostByDefinition({})
      return
    }

    abortController?.abort()
    abortController = new AbortController()
    const signal = abortController.signal

    // Fetch cost per instance
    type InstanceResult = { definitionID: string; cost: number; tokens: DefinitionCostEntry["tokens"] }
    const fetches = instances
      .filter((inst) => inst.sessionID)
      .map(async (inst): Promise<InstanceResult | null> => {
        try {
          const res = await fetch(
            `${serverUrl}/session/${inst.sessionID}/message`,
            { headers: { "x-opencode-directory": directory }, signal },
          )
          if (!res.ok) return null

          const messages: any[] = await res.json()
          let cost = 0
          const tokens = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }

          for (const raw of messages) {
            const msg = raw.info ?? raw
            if (msg.role !== "assistant") continue
            cost += msg.cost ?? 0
            if (msg.tokens) {
              tokens.input += msg.tokens.input ?? 0
              tokens.output += msg.tokens.output ?? 0
              tokens.reasoning += msg.tokens.reasoning ?? 0
              tokens.cacheRead += msg.tokens.cache?.read ?? 0
              tokens.cacheWrite += msg.tokens.cache?.write ?? 0
            }
          }

          return { definitionID: inst.agentDefinitionID, cost, tokens }
        } catch {
          return null
        }
      })

    const results = await Promise.all(fetches)
    if (signal.aborted) return

    // Aggregate by definition ID
    const byDef: CostByDefinition = {}
    for (const r of results) {
      if (!r) continue
      if (!byDef[r.definitionID]) {
        byDef[r.definitionID] = {
          definitionID: r.definitionID,
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        }
      }
      const entry = byDef[r.definitionID]
      entry.cost += r.cost
      entry.tokens.input += r.tokens.input
      entry.tokens.output += r.tokens.output
      entry.tokens.reasoning += r.tokens.reasoning
      entry.tokens.cacheRead += r.tokens.cacheRead
      entry.tokens.cacheWrite += r.tokens.cacheWrite
    }

    setCostByDefinition(byDef)
  }

  // React to instance changes — debounce to 1s
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  createEffect(() => {
    const instances = getInstances()
    const _len = instances.length
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(refresh, 1000)
  })

  // Poll every 10s while any agent is working
  const pollInterval = setInterval(() => {
    const instances = getInstances()
    const hasWorking = instances.some((i) => i.state === "working")
    if (hasWorking) refresh()
  }, 10000)

  onCleanup(() => {
    if (debounceTimer) clearTimeout(debounceTimer)
    clearInterval(pollInterval)
    abortController?.abort()
  })

  refresh()

  return { costByDefinition, refresh }
}

/** Format cost as dollar amount: $0.0847 (4 decimals) or $1.23 (2 decimals if > $1) */
export function formatCost(n: number): string {
  if (n === 0) return "$0.00"
  if (n >= 1) return `$${n.toFixed(2)}`
  return `$${n.toFixed(4)}`
}

/** Format token count: 12.4K, 1.2M, or plain number if < 1000 */
export function formatTokens(n: number): string {
  if (n === 0) return "0"
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}
