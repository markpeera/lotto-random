import { createServer } from 'node:http'
import { PORT } from './config.js'
import { createRequestHandler } from './routes.js'
import { loadPersistentCache } from './services/lotteryCache.js'

await loadPersistentCache()

const server = createServer(createRequestHandler())

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the existing process or set PORT to another value.`)
    process.exit(1)
  }

  throw error
})

server.listen(PORT, () => {
  console.log(`Lotto proxy server listening on http://localhost:${PORT}`)
})
