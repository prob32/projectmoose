import type { AgentDefinitionInfo } from "./schema"
import { LAYOUT } from "./layout"

/** Check if parentDef allows spawning childDefID */
export function isSpawnAllowed(parentDef: AgentDefinitionInfo, childDefID: string): boolean {
  if (!parentDef.spawnable?.agents?.length) return false
  return parentDef.spawnable.agents.includes(childDefID)
}

/** Throw if spawn limit exceeded */
export function checkSpawnLimit(parentDef: AgentDefinitionInfo, existingChildCount: number): void {
  const limit = parentDef.spawnable?.limit
  if (typeof limit === "number" && existingChildCount >= limit) {
    throw new Error(`Spawn limit reached: ${existingChildCount}/${limit} children`)
  }
  if (limit === "auto" && existingChildCount >= 20) {
    throw new Error(`Auto spawn limit reached: maximum 20 children`)
  }
}

/** Calculate initial child position relative to parent */
export function calculateChildPosition(
  parentX: number,
  parentY: number,
  explicitX?: number,
  explicitY?: number,
): { x: number; y: number } {
  return {
    x: explicitX ?? Math.round(parentX),
    y: explicitY ?? Math.round(parentY + LAYOUT.SPAWN_DISTANCE),
  }
}

/** Determine if a definition is an orchestrator (has spawnable agents) */
export function isOrchestrator(def: AgentDefinitionInfo): boolean {
  return !!(def.spawnable?.agents?.length)
}
