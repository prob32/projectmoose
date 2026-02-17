import { createStore, produce, reconcile } from "solid-js/store"
import { batch, createEffect, createMemo, onCleanup } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useSDK } from "./sdk"

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
  mcp?: { servers?: string[]; deny?: string[] }
  spawnable?: { agents: string[]; limit: number | "auto" }
  idle_timeout: number
  order: number
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
  /** Lasso drag rectangle state (for multi-select) */
  lasso: { startX: number; startY: number; currentX: number; currentY: number } | undefined
  /** IDs of instances currently inside the lasso rectangle */
  lassoSelectedIDs: string[]
  /** Active group chat (undefined when no group is active) */
  groupChat: {
    memberInstanceIDs: string[]
    sessionID: string
    status: "idle" | "running"
    currentAgentIndex: number
  } | undefined
}

export const { use: useCanvas, provider: CanvasProvider } = createSimpleContext({
  name: "Canvas",
  gate: false,
  init: () => {
    const sdk = useSDK()

    const [store, setStore] = createStore<CanvasStore>({
      instances: [],
      definitions: [],
      selectedID: undefined,
      draggingID: undefined,
      dragOffset: { x: 0, y: 0 },
      contextMenu: undefined,
      nodeContextMenu: undefined,
      viewport: { x: 0, y: 0, scale: 1 },
      gcWarnings: {},
      agentMessages: [],
      completedInstances: {},
      lasso: undefined,
      lassoSelectedIDs: [],
      groupChat: undefined,
    })

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

    /** Fetch agent definitions from the backend */
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
        return created
      } catch {
        return undefined
      }
    }

    /** Move an instance to a new canvas position */
    async function moveInstance(instanceID: string, x: number, y: number) {
      // Optimistic update
      setStore(
        "instances",
        (inst) => inst.id === instanceID,
        produce((draft) => {
          draft.positionX = x
          draft.positionY = y
        }),
      )

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

    /** Remove an instance from the canvas */
    async function removeInstance(instanceID: string) {
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

    // Lasso (multi-select) helpers
    function startLasso(x: number, y: number) {
      setStore("lasso", { startX: x, startY: y, currentX: x, currentY: y })
    }

    function updateLasso(x: number, y: number) {
      setStore("lasso", { startX: store.lasso!.startX, startY: store.lasso!.startY, currentX: x, currentY: y })

      const l = store.lasso!
      const x1 = Math.min(l.startX, x), y1 = Math.min(l.startY, y)
      const x2 = Math.max(l.startX, x), y2 = Math.max(l.startY, y)
      const NODE_CENTER = 36

      const ids = store.instances
        .filter((inst) => {
          const cx = inst.positionX + NODE_CENTER
          const cy = inst.positionY + NODE_CENTER
          return cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2
        })
        .map((inst) => inst.id)

      setStore("lassoSelectedIDs", ids)
    }

    function endLasso() {
      setStore("lasso", undefined)
    }

    function clearLassoSelection() {
      setStore("lassoSelectedIDs", [])
    }

    // Group chat helpers
    function createGroupChat(sessionID: string, memberInstanceIDs: string[]) {
      setStore("groupChat", {
        memberInstanceIDs,
        sessionID,
        status: "idle" as const,
        currentAgentIndex: 0,
      })
      // Bake lasso selection into group — clear lasso visual
      setStore("lassoSelectedIDs", [])
    }

    function clearGroupChat() {
      setStore("groupChat", undefined)
    }

    function setGroupChatStatus(status: "idle" | "running", index?: number) {
      if (!store.groupChat) return
      setStore("groupChat", "status", status)
      if (index !== undefined) {
        setStore("groupChat", "currentAgentIndex", index)
      }
    }

    // Drag helpers
    function startDrag(id: string, offsetX: number, offsetY: number) {
      setStore("draggingID", id)
      setStore("dragOffset", { x: offsetX, y: offsetY })
    }

    function stopDrag() {
      setStore("draggingID", undefined)
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
      get lasso() {
        return store.lasso
      },
      get lassoSelectedIDs() {
        return store.lassoSelectedIDs
      },
      get groupChat() {
        return store.groupChat
      },
      selected,
      connections,
      definitionFor,
      definitionMap,
      fetchDefinitions,
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
      stopDrag,
      openContextMenu,
      closeContextMenu,
      openNodeContextMenu,
      closeNodeContextMenu,
      startLasso,
      updateLasso,
      endLasso,
      clearLassoSelection,
      createGroupChat,
      clearGroupChat,
      setGroupChatStatus,
    }
  },
})
