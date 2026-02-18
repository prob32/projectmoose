import { createStore, produce, reconcile } from "solid-js/store"
import { batch, createEffect, createMemo, onCleanup } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useSDK } from "./sdk"
import { CanvasPhysics, type PhysicsNode } from "@/components/canvas/canvas-physics"

/** Types matching the backend MooseAgentInstance.Info and MooseAgentDefinition.Info shapes */
export type AgentInstanceInfo = {
  id: string
  workspaceSessionID: string
  agentDefinitionID: string
  sessionID?: string
  parentInstanceID?: string
  positionX: number
  positionY: number
  state: "idle" | "working" | "error" | "question" | "spawning"
  errorMessage?: string
  displayName?: string
  timeLastActive?: number
  time: { created: number; updated: number }
}

export type AgentDefinitionInfo = {
  id: string
  name: string
  description?: string
  color: string
  prompt: string
  role?: string
  model?: { providerID: string; modelID: string }
  temperature?: number
  permissionMode?: "build" | "plan"
  thinking?: { budget?: number; effort?: string }
  mcp?: { servers?: string[]; deny?: string[] }
  tools?: { mode: "all" | "scoped"; allow?: string[]; deny?: string[] }
  skills?: string[]
  spawnable?: { agents: string[]; limit: number | "auto" }
  idle_timeout: number
  order: number
}

export type AgentFolder = {
  id: string
  name: string
  description?: string
  icon?: string
  color: string
  agents: AgentDefinitionInfo[]
}

export type AgentFolderConfig = {
  activeFolder: string
  folders: AgentFolder[]
}

type GCWarningEntry = { secondsRemaining: number; timestamp: number }

export type AgentMessage = {
  fromInstanceID: string
  toInstanceID: string
  type: "question" | "scope_request" | "answer" | "result"
  content: string
  timestamp: number
}

type CanvasStore = {
  instances: AgentInstanceInfo[]
  definitions: AgentDefinitionInfo[]
  folders: AgentFolder[]
  activeFolder: string
  selectedID: string | undefined
  draggingID: string | undefined
  dragOffset: { x: number; y: number }
  contextMenu: { x: number; y: number; canvasX: number; canvasY: number } | undefined
  nodeContextMenu: { instanceID: string; x: number; y: number } | undefined
  viewport: { x: number; y: number; scale: number }
  gcWarnings: Record<string, GCWarningEntry>
  agentMessages: AgentMessage[]
  /** Instance IDs that recently completed a task (working → idle). Auto-expires after 2s. */
  completedInstances: Record<string, number>
}

export const { use: useCanvas, provider: CanvasProvider } = createSimpleContext({
  name: "Canvas",
  gate: false,
  init: () => {
    const sdk = useSDK()

    const [store, setStore] = createStore<CanvasStore>({
      instances: [],
      definitions: [],
      folders: [],
      activeFolder: "default",
      selectedID: undefined,
      draggingID: undefined,
      dragOffset: { x: 0, y: 0 },
      contextMenu: undefined,
      nodeContextMenu: undefined,
      viewport: { x: 0, y: 0, scale: 1 },
      gcWarnings: {},
      agentMessages: [],
      completedInstances: {},
    })

    // ===== Physics Engine =====
    const physics = new CanvasPhysics()

    // Sync physics positions → Solid.js store (throttled to ~30fps by the engine)
    physics.setOnTick((nodes) => {
      batch(() => {
        for (const [id, node] of nodes) {
          setStore(
            "instances",
            (inst) => inst.id === id,
            produce((draft) => {
              draft.positionX = Math.round(node.x)
              draft.positionY = Math.round(node.y)
            }),
          )
        }
      })
    })

    // On simulation settle, persist all final positions to backend
    physics.setOnSettle((nodes) => {
      for (const [id, node] of nodes) {
        const x = Math.round(node.x)
        const y = Math.round(node.y)
        fetch(`${sdk.url}/agent-instance/${id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "x-opencode-directory": sdk.directory,
          },
          body: JSON.stringify({ positionX: x, positionY: y }),
        }).catch(() => {})
      }
    })

    onCleanup(() => physics.destroy())

    /** Feed all current instances and connections into the physics engine */
    function syncPhysicsFromStore() {
      // Add nodes that aren't in physics yet, update positions for ones that are
      const existingIds = new Set<string>()
      for (const inst of store.instances) {
        existingIds.add(inst.id)
        const existing = physics.getNode(inst.id)
        if (!existing) {
          physics.addNode({ id: inst.id, x: inst.positionX, y: inst.positionY })
        }
      }
      // Remove nodes that were deleted from the store
      for (const [id] of physics.getAllNodes()) {
        if (!existingIds.has(id)) {
          physics.removeNode(id)
        }
      }
      // Sync links from connections
      const conns = connections()
      for (const conn of conns) {
        physics.addLink(conn.parentID, conn.childID)
      }
    }

    // Subscribe to real-time agent events via SSE
    // Note: sdk.event.listen() (createGlobalEmitter) delivers { name, details }
    // where details = the actual event { type, properties }
    const unsub = sdk.event.listen((raw: any) => {
      const event = raw?.details ?? raw
      const { type, properties } = event
      if (!type || !properties) return

      switch (type) {
        case "moose.agent.spawned": {
          const inst = properties.instance as AgentInstanceInfo
          if (!inst) break
          batch(() => {
            setStore(
              "instances",
              produce((draft) => {
                if (!draft.find((i) => i.id === inst.id)) {
                  draft.push(inst)
                }
              }),
            )
          })
          // Add to physics engine with spawn animation
          if (!physics.getNode(inst.id)) {
            physics.spawnNode(
              { id: inst.id, x: inst.positionX, y: inst.positionY },
              inst.parentInstanceID,
            )
            if (inst.parentInstanceID) {
              physics.addLink(inst.parentInstanceID, inst.id)
            }
          }
          break
        }
        case "moose.agent.state_changed": {
          // Detect working → idle transition for task completion visual
          const prevInstance = store.instances.find((i) => i.id === properties.instanceID)
          const wasWorking = prevInstance?.state === "working"
          const nowIdle = properties.state === "idle"
          if (wasWorking && nowIdle) {
            setStore("completedInstances", properties.instanceID, Date.now())
            // Auto-remove the completion flag after 2s
            setTimeout(() => {
              setStore("completedInstances", properties.instanceID, undefined!)
            }, 2000)
          }

          setStore(
            "instances",
            (i) => i.id === properties.instanceID,
            produce((draft) => {
              draft.state = properties.state
              if (properties.error) draft.errorMessage = properties.error
              if (properties.timeLastActive) draft.timeLastActive = properties.timeLastActive
            }),
          )
          break
        }
        case "moose.agent.moved": {
          setStore(
            "instances",
            (i) => i.id === properties.instanceID,
            produce((draft) => {
              draft.positionX = properties.x
              draft.positionY = properties.y
            }),
          )
          break
        }
        case "moose.agent.deleted": {
          setStore("instances", (instances) => instances.filter((i) => i.id !== properties.instanceID))
          setStore("gcWarnings", properties.instanceID, undefined!)
          break
        }
        case "moose.agent.gc_warning": {
          setStore("gcWarnings", properties.instanceID, {
            secondsRemaining: properties.secondsRemaining,
            timestamp: Date.now(),
          })
          break
        }
        case "moose.agent.message": {
          const msg: AgentMessage = {
            fromInstanceID: properties.fromInstanceID,
            toInstanceID: properties.toInstanceID,
            type: properties.type,
            content: properties.content,
            timestamp: Date.now(),
          }
          setStore(
            "agentMessages",
            produce((draft) => {
              draft.push(msg)
              // Keep only last 50 messages to avoid memory bloat
              if (draft.length > 50) draft.splice(0, draft.length - 50)
            }),
          )
          break
        }
        case "moose.definition.updated": {
          if (properties.definitions) {
            setStore("definitions", reconcile(properties.definitions, { key: "id" }))
          }
          break
        }
        case "session.status": {
          // Sync agent state with its session status (busy → working, idle → idle)
          const sessionID = properties.sessionID as string
          const status = properties.status as { type: string }
          if (!sessionID || !status) break

          const inst = store.instances.find((i) => i.sessionID === sessionID)
          if (!inst) break

          if (status.type === "busy" && (inst.state === "idle" || inst.state === "spawning")) {
            // Session started processing → set agent to working
            setStore(
              "instances",
              (i) => i.id === inst.id,
              produce((draft) => {
                draft.state = "working"
              }),
            )
          } else if (status.type === "idle" && inst.state !== "idle" && inst.state !== "error") {
            // Session finished processing → set agent to idle + trigger completion visual
            // Handle all active states (working, spawning, question) → idle
            if (inst.state === "working") {
              setStore("completedInstances", inst.id, Date.now())
              setTimeout(() => {
                setStore("completedInstances", inst.id, undefined!)
              }, 2000)
            }

            setStore(
              "instances",
              (i) => i.id === inst.id,
              produce((draft) => {
                draft.state = "idle"
                draft.timeLastActive = Date.now()
              }),
            )
          }
          break
        }
      }
    })
    onCleanup(unsub)

    // Auto-prune old messages every second so message pulse animations expire
    const MESSAGE_EXPIRY_MS = 3000
    const pruneInterval = setInterval(() => {
      const now = Date.now()
      const messages = store.agentMessages
      if (messages.length > 0 && now - messages[0].timestamp > MESSAGE_EXPIRY_MS) {
        setStore(
          "agentMessages",
          messages.filter((m) => now - m.timestamp < MESSAGE_EXPIRY_MS),
        )
      }
    }, 1000)
    onCleanup(() => clearInterval(pruneInterval))

    /** Fetch agent definitions from the backend (active folder's agents) */
    async function fetchDefinitions() {
      try {
        const res = await fetch(`${sdk.url}/moose-agent`, {
          headers: { "x-opencode-directory": sdk.directory },
        })
        if (!res.ok) return
        const data: AgentDefinitionInfo[] = await res.json()
        setStore("definitions", reconcile(data, { key: "id" }))
      } catch {
        // silently ignore — definitions may not be configured yet
      }
    }

    /** Fetch all folders metadata from the backend */
    async function fetchFolders() {
      try {
        const res = await fetch(`${sdk.url}/moose-agent-folder`, {
          headers: { "x-opencode-directory": sdk.directory },
        })
        if (!res.ok) return
        const data: AgentFolderConfig = await res.json()
        setStore("folders", data.folders)
        setStore("activeFolder", data.activeFolder)
      } catch {
        // ignore
      }
    }

    /** Switch the active folder */
    async function switchFolder(folderId: string) {
      try {
        const res = await fetch(`${sdk.url}/moose-agent-active-folder`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "x-opencode-directory": sdk.directory,
          },
          body: JSON.stringify({ folderId }),
        })
        if (!res.ok) return
        setStore("activeFolder", folderId)
        // Refresh definitions from the new active folder
        await fetchDefinitions()
      } catch {
        // ignore
      }
    }

    /** Fetch all instances for a given workspace session */
    async function fetchInstances(workspaceSessionID: string) {
      try {
        const res = await fetch(
          `${sdk.url}/agent-instance?workspaceSessionID=${encodeURIComponent(workspaceSessionID)}`,
          { headers: { "x-opencode-directory": sdk.directory } },
        )
        if (!res.ok) return
        const data: AgentInstanceInfo[] = await res.json()
        setStore("instances", reconcile(data, { key: "id" }))
        // Sync physics engine with loaded instances
        requestAnimationFrame(() => {
          syncPhysicsFromStore()
          // Start with a gentle initial layout pass
          physics.reheat(0.5)
        })
      } catch {
        // ignore
      }
    }

    /** Create a new agent instance on the canvas */
    async function addInstance(input: {
      workspaceSessionID: string
      agentDefinitionID: string
      parentInstanceID?: string
      positionX: number
      positionY: number
    }) {
      try {
        const res = await fetch(`${sdk.url}/agent-instance`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-opencode-directory": sdk.directory,
          },
          body: JSON.stringify(input),
        })
        if (!res.ok) return
        const created: AgentInstanceInfo = await res.json()
        setStore(
          "instances",
          produce((draft) => {
            draft.push(created)
          }),
        )
        // Add to physics with spawn animation (starts at parent, pushes outward)
        physics.spawnNode(
          { id: created.id, x: created.positionX, y: created.positionY },
          input.parentInstanceID,
        )
        if (input.parentInstanceID) {
          physics.addLink(input.parentInstanceID, created.id)
        }
        return created
      } catch {
        return undefined
      }
    }

    /** Move an instance to a new canvas position.
     *  During physics drag, this updates the physics fixed position.
     *  For non-physics moves (e.g. backend sync), it updates the store directly + persists. */
    async function moveInstance(instanceID: string, x: number, y: number, persistNow = true) {
      // Update store
      setStore(
        "instances",
        (inst) => inst.id === instanceID,
        produce((draft) => {
          draft.positionX = x
          draft.positionY = y
        }),
      )

      // Also update physics node position
      physics.updateNodePosition(instanceID, x, y)

      if (persistNow) {
        try {
          await fetch(`${sdk.url}/agent-instance/${instanceID}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              "x-opencode-directory": sdk.directory,
            },
            body: JSON.stringify({ positionX: x, positionY: y }),
          })
        } catch {
          // Revert on failure — will be corrected on next fetch
        }
      }
    }

    /** Spawn a child agent from a parent instance */
    async function spawnChild(parentInstanceID: string, childDefinitionID: string, workspaceSessionID: string) {
      try {
        const res = await fetch(`${sdk.url}/agent-instance/${parentInstanceID}/spawn`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-opencode-directory": sdk.directory,
          },
          body: JSON.stringify({ childDefinitionID, workspaceSessionID }),
        })
        if (!res.ok) return undefined
        const child: AgentInstanceInfo = await res.json()
        // Optimistically add if not already present (SSE may also add it)
        setStore(
          "instances",
          produce((draft) => {
            if (!draft.find((i) => i.id === child.id)) {
              draft.push(child)
            }
          }),
        )
        return child
      } catch {
        return undefined
      }
    }

    /** Send a message between parent and child agent instances */
    async function sendAgentMessage(
      fromInstanceID: string,
      toInstanceID: string,
      type: AgentMessage["type"],
      content: string,
    ) {
      try {
        const res = await fetch(`${sdk.url}/agent-instance/${fromInstanceID}/message`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-opencode-directory": sdk.directory,
          },
          body: JSON.stringify({ toInstanceID, type, content }),
        })
        return res.ok
      } catch {
        return false
      }
    }

    /** Set the state of an agent instance via the backend */
    async function setInstanceState(instanceID: string, state: AgentInstanceInfo["state"]) {
      // Optimistic update
      setStore(
        "instances",
        (inst) => inst.id === instanceID,
        produce((draft) => {
          draft.state = state
        }),
      )

      try {
        await fetch(`${sdk.url}/agent-instance/${instanceID}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "x-opencode-directory": sdk.directory,
          },
          body: JSON.stringify({ state }),
        })
      } catch {
        // Backend will emit the event that corrects the state if needed
      }
    }

    /** Remove an instance from the canvas and clean up its session */
    async function removeInstance(instanceID: string) {
      const instance = store.instances.find((i) => i.id === instanceID)
      const sessionID = instance?.sessionID

      // Remove from physics
      physics.removeNode(instanceID)

      // Optimistic removal
      setStore(
        "instances",
        (instances) => instances.filter((i) => i.id !== instanceID),
      )

      try {
        await fetch(`${sdk.url}/agent-instance/${instanceID}`, {
          method: "DELETE",
          headers: { "x-opencode-directory": sdk.directory },
        })

        // Also clean up the session if it exists
        if (sessionID) {
          fetch(`${sdk.url}/session/${sessionID}`, {
            method: "DELETE",
            headers: { "x-opencode-directory": sdk.directory },
          }).catch(() => {}) // Best effort
        }
      } catch {
        // Revert on next fetch
      }
    }

    // Selection helpers
    function select(id: string | undefined) {
      setStore("selectedID", id)
    }

    function deselect() {
      setStore("selectedID", undefined)
    }

    // Drag helpers — delegate to physics engine for organic connected-node movement
    function startDrag(id: string, offsetX: number, offsetY: number) {
      setStore("draggingID", id)
      setStore("dragOffset", { x: offsetX, y: offsetY })
      const inst = store.instances.find((i) => i.id === id)
      if (inst) {
        physics.startDrag(id, inst.positionX, inst.positionY)
      }
    }

    function dragMove(id: string, x: number, y: number) {
      physics.drag(id, x, y)
    }

    function stopDrag() {
      const dragging = store.draggingID
      if (dragging) {
        physics.endDrag(dragging)
        // Persist final drag position to backend
        const inst = store.instances.find((i) => i.id === dragging)
        if (inst) {
          fetch(`${sdk.url}/agent-instance/${dragging}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              "x-opencode-directory": sdk.directory,
            },
            body: JSON.stringify({ positionX: inst.positionX, positionY: inst.positionY }),
          }).catch(() => {})
        }
      }
      setStore("draggingID", undefined)
    }

    // Viewport helpers
    function setViewport(vp: Partial<{ x: number; y: number; scale: number }>) {
      setStore("viewport", produce((draft) => {
        if (vp.x !== undefined) draft.x = vp.x
        if (vp.y !== undefined) draft.y = vp.y
        if (vp.scale !== undefined) draft.scale = vp.scale
      }))
    }

    function fitView(containerWidth: number, containerHeight: number) {
      if (store.instances.length === 0) return
      const padding = 80

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const inst of store.instances) {
        minX = Math.min(minX, inst.positionX)
        minY = Math.min(minY, inst.positionY)
        maxX = Math.max(maxX, inst.positionX + 72)
        maxY = Math.max(maxY, inst.positionY + 100)
      }

      const width = maxX - minX + padding * 2
      const height = maxY - minY + padding * 2
      const scale = Math.min(containerWidth / width, containerHeight / height, 2)

      setStore("viewport", {
        x: (containerWidth - width * scale) / 2 - minX * scale + padding * scale,
        y: (containerHeight - height * scale) / 2 - minY * scale + padding * scale,
        scale,
      })
    }

    // Context menu
    function openContextMenu(x: number, y: number, canvasX: number, canvasY: number) {
      setStore("contextMenu", { x, y, canvasX, canvasY })
    }

    function closeContextMenu() {
      setStore("contextMenu", undefined)
    }

    // Node-specific context menu (right-click on agent node)
    function openNodeContextMenu(instanceID: string, x: number, y: number) {
      setStore("nodeContextMenu", { instanceID, x, y })
      setStore("contextMenu", undefined) // close canvas bg menu if open
    }

    function closeNodeContextMenu() {
      setStore("nodeContextMenu", undefined)
    }

    // Helpers for looking up definitions
    const definitionMap = createMemo(() => {
      const map = new Map<string, AgentDefinitionInfo>()
      for (const def of store.definitions) {
        map.set(def.id, def)
      }
      return map
    })

    function definitionFor(instance: AgentInstanceInfo) {
      return definitionMap().get(instance.agentDefinitionID)
    }

    // Get parent-child connections
    const connections = createMemo(() => {
      const conns: Array<{
        parentID: string
        childID: string
        parent: AgentInstanceInfo
        child: AgentInstanceInfo
      }> = []
      for (const inst of store.instances) {
        if (inst.parentInstanceID) {
          const parent = store.instances.find((i) => i.id === inst.parentInstanceID)
          if (parent) {
            conns.push({
              parentID: parent.id,
              childID: inst.id,
              parent,
              child: inst,
            })
          }
        }
      }
      return conns
    })

    // Selected instance accessor
    const selected = createMemo(() => {
      if (!store.selectedID) return undefined
      return store.instances.find((i) => i.id === store.selectedID)
    })

    return {
      get instances() {
        return store.instances
      },
      get definitions() {
        return store.definitions
      },
      get folders() {
        return store.folders
      },
      get activeFolder() {
        return store.activeFolder
      },
      get selectedID() {
        return store.selectedID
      },
      get draggingID() {
        return store.draggingID
      },
      get dragOffset() {
        return store.dragOffset
      },
      get contextMenu() {
        return store.contextMenu
      },
      get nodeContextMenu() {
        return store.nodeContextMenu
      },
      get viewport() {
        return store.viewport
      },
      get gcWarnings() {
        return store.gcWarnings
      },
      get agentMessages() {
        return store.agentMessages
      },
      get completedInstances() {
        return store.completedInstances
      },
      physics,
      setViewport,
      fitView,
      selected,
      connections,
      definitionFor,
      definitionMap,
      fetchDefinitions,
      fetchFolders,
      switchFolder,
      fetchInstances,
      addInstance,
      spawnChild,
      sendAgentMessage,
      moveInstance,
      setInstanceState,
      removeInstance,
      select,
      deselect,
      startDrag,
      dragMove,
      stopDrag,
      openContextMenu,
      closeContextMenu,
      openNodeContextMenu,
      closeNodeContextMenu,
    }
  },
})
