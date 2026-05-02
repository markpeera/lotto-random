import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '..')
const API_PORT = Number(process.env.PORT ?? 4173)
const API_HEALTH_URL = `http://127.0.0.1:${API_PORT}/api/health`

const processes = []

async function isApiServerRunning() {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 1000)
    const response = await fetch(API_HEALTH_URL, {
      signal: controller.signal,
    })
    clearTimeout(timeout)
    return response.ok
  } catch {
    return false
  }
}

function spawnChild(label, command, args) {
  const child = spawn(command, args, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
  })

  child.on('error', (error) => {
    console.error(`${label} failed to start: ${error.message}`)
    shutdown(1)
  })

  processes.push(child)
  return child
}

let isShuttingDown = false

function shutdown(exitCode = 0) {
  if (isShuttingDown) {
    return
  }

  isShuttingDown = true
  processes.forEach((child) => {
    if (!child.killed) {
      child.kill()
    }
  })
  process.exit(exitCode)
}

function watchChild(child) {
  child.on('exit', (code) => {
    if (!isShuttingDown && code !== 0) {
      shutdown(code ?? 1)
    }
  })
}

if (await isApiServerRunning()) {
  console.log(`Using existing lotto proxy server on ${API_HEALTH_URL}`)
} else {
  watchChild(spawnChild('lotto proxy server', process.execPath, ['server/index.js']))
}

watchChild(spawnChild('Vite dev server', process.execPath, [
  'node_modules/vite/bin/vite.js',
  '--host',
  '127.0.0.1',
]))

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
