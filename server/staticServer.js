import { createReadStream, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { DIST_DIR } from './config.js'

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
}

export async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`)
  const requestedPath = decodeURIComponent(url.pathname)
  const filePath = path.normalize(path.join(DIST_DIR, requestedPath === '/' ? 'index.html' : requestedPath))

  if (!filePath.startsWith(DIST_DIR)) {
    response.writeHead(403)
    response.end('Forbidden')
    return
  }

  const finalPath = existsSync(filePath) ? filePath : path.join(DIST_DIR, 'index.html')
  const extension = path.extname(finalPath)
  const contentType = contentTypes[extension] ?? 'application/octet-stream'

  try {
    await readFile(finalPath, { flag: 'r' })
    response.writeHead(200, {
      'content-type': contentType,
    })
    createReadStream(finalPath).pipe(response)
  } catch {
    response.writeHead(404, {
      'content-type': 'text/plain; charset=utf-8',
    })
    response.end('Not found')
  }
}
