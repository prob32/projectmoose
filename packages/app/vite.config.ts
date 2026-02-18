import { defineConfig } from "vite"
import { spawn, type ChildProcess } from "child_process"
import { resolve } from "path"
import desktopPlugin from "./vite"

const BACKEND_PORT = 4096

/**
 * Vite plugin that auto-starts the opencode backend server in dev mode.
 * The backend runs as a child process and is killed when vite exits.
 */
function backendPlugin(): import("vite").Plugin {
  let backend: ChildProcess | null = null

  return {
    name: "opencode-backend",
    apply: "serve",
    async configureServer() {
      if (backend) return

      const cwd = resolve(__dirname, "../opencode")
      backend = spawn("bun", ["run", "--conditions=browser", "src/index.ts", "web", "--port", String(BACKEND_PORT)], {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
      })

      backend.stdout?.on("data", (data: Buffer) => {
        const line = data.toString().trim()
        if (line) console.log(`\x1b[36m[backend]\x1b[0m ${line}`)
      })
      backend.stderr?.on("data", (data: Buffer) => {
        const line = data.toString().trim()
        if (line) console.error(`\x1b[31m[backend]\x1b[0m ${line}`)
      })
      backend.on("exit", (code) => {
        if (code !== null && code !== 0) {
          console.error(`\x1b[31m[backend]\x1b[0m exited with code ${code}`)
        }
        backend = null
      })

      // Wait for backend to be ready
      const maxWait = 15_000
      const start = Date.now()
      while (Date.now() - start < maxWait) {
        try {
          const res = await fetch(`http://localhost:${BACKEND_PORT}/config`)
          if (res.ok) {
            console.log(`\x1b[36m[backend]\x1b[0m ready on port ${BACKEND_PORT}`)
            return
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 300))
      }
      console.warn(`\x1b[33m[backend]\x1b[0m did not become ready within ${maxWait / 1000}s — continuing anyway`)
    },
    closeBundle() {
      if (backend) {
        backend.kill()
        backend = null
      }
    },
  }
}

export default defineConfig({
  plugins: [desktopPlugin, backendPlugin()] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
  },
  build: {
    target: "esnext",
    // sourcemap: true,
  },
})
