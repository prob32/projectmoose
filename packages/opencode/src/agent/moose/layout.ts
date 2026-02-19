export const LAYOUT = {
  MIN_DISTANCE: 100,
  REPEL_ITERATIONS: 3,
  SPAWN_DISTANCE: 160,
  SPREAD_ANGLE: Math.PI * 0.8, // 144-degree arc
  MAX_SLOTS: 12,
} as const

/**
 * Run a simple force-directed repulsion pass to push overlapping nodes apart.
 * Iterates a few times to resolve clusters. Only moves nodes that overlap
 * within a minimum distance threshold.
 *
 * Uses callback injection to avoid circular imports with instance.ts.
 */
export async function repelOverlaps(
  workspaceSessionID: string,
  listByWorkspace: (wsID: string) => Array<{ id: string; positionX: number; positionY: number }>,
  moveInstance: (input: { instanceID: string; x: number; y: number }) => Promise<void>,
): Promise<void> {
  for (let iter = 0; iter < LAYOUT.REPEL_ITERATIONS; iter++) {
    const all = listByWorkspace(workspaceSessionID)
    if (all.length < 2) return

    const moves: Array<{ id: string; x: number; y: number }> = []

    for (let i = 0; i < all.length; i++) {
      let fx = 0
      let fy = 0
      for (let j = 0; j < all.length; j++) {
        if (i === j) continue
        const dx = all[i].positionX - all[j].positionX
        const dy = all[i].positionY - all[j].positionY
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < LAYOUT.MIN_DISTANCE && dist > 0) {
          // Push apart proportionally to overlap
          const force = (LAYOUT.MIN_DISTANCE - dist) / 2
          fx += (dx / dist) * force
          fy += (dy / dist) * force
        } else if (dist === 0) {
          // Identical positions: push in a random-ish direction based on index
          const angle = (i * 2.39996) % (Math.PI * 2) // golden angle
          fx += Math.cos(angle) * (LAYOUT.MIN_DISTANCE / 2)
          fy += Math.sin(angle) * (LAYOUT.MIN_DISTANCE / 2)
        }
      }

      if (Math.abs(fx) > 1 || Math.abs(fy) > 1) {
        moves.push({
          id: all[i].id,
          x: Math.round(all[i].positionX + fx),
          y: Math.round(all[i].positionY + fy),
        })
      }
    }

    if (moves.length === 0) break // no overlaps, done

    for (const m of moves) {
      await moveInstance({ instanceID: m.id, x: m.x, y: m.y })
    }
  }
}

/**
 * Redistribute all siblings evenly in an arc around the parent to prevent overlap.
 * Handles concurrent spawns: each spawn redistributes everyone.
 *
 * Uses callback injection to avoid circular imports with instance.ts.
 */
export async function redistributeSiblings(
  parentInstanceID: string,
  parentX: number,
  parentY: number,
  listByParent: (parentID: string) => Array<{ id: string }>,
  moveInstance: (input: { instanceID: string; x: number; y: number }) => Promise<void>,
): Promise<void> {
  const allSiblings = listByParent(parentInstanceID)
  const total = allSiblings.length
  const startAngle = Math.PI / 2 - LAYOUT.SPREAD_ANGLE / 2

  for (let i = 0; i < total; i++) {
    const step = total <= 1 ? 0 : LAYOUT.SPREAD_ANGLE / (Math.min(LAYOUT.MAX_SLOTS, total) - 1)
    const angle = total === 1 ? Math.PI / 2 : startAngle + i * step
    const newX = Math.round(parentX + Math.cos(angle) * LAYOUT.SPAWN_DISTANCE)
    const newY = Math.round(parentY + Math.sin(angle) * LAYOUT.SPAWN_DISTANCE)
    await moveInstance({ instanceID: allSiblings[i].id, x: newX, y: newY })
  }
}
