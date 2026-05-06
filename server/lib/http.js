export function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(payload))
}

export function isRateLimitedError(error) {
  return error?.status === 429
    || error?.errors?.some((item) => item?.status === 429)
}
