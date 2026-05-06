import { isRateLimitedError, sendJson } from './lib/http.js'
import { clampLimit, getLotteryResults } from './services/lotteryService.js'
import { serveStatic } from './staticServer.js'

async function handleLotteryResults(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`)
  const limit = clampLimit(url.searchParams.get('limit'))

  try {
    const payload = await getLotteryResults(limit)
    sendJson(response, 200, {
      status: 'success',
      response: payload,
    })
  } catch (error) {
    const isRateLimited = isRateLimitedError(error)

    sendJson(response, isRateLimited ? 429 : 503, {
      status: 'error',
      code: isRateLimited ? 'rate_limited' : 'external_unavailable',
      message: isRateLimited
        ? 'ผู้ให้บริการข้อมูลผลสลากจำกัดจำนวนการเรียกชั่วคราว'
        : 'ระบบยังเชื่อมต่อข้อมูลผลสลากภายนอกไม่ได้',
    })
  }
}

export function createRequestHandler() {
  return (request, response) => {
    if (request.method === 'GET' && request.url?.startsWith('/api/health')) {
      sendJson(response, 200, {
        status: 'ok',
        service: 'lottery-proxy',
      })
      return
    }

    if (request.method === 'GET' && request.url?.startsWith('/api/lottery-results')) {
      handleLotteryResults(request, response)
      return
    }

    if (request.method === 'GET' || request.method === 'HEAD') {
      serveStatic(request, response)
      return
    }

    sendJson(response, 405, {
      status: 'error',
      message: 'Method not allowed',
    })
  }
}
