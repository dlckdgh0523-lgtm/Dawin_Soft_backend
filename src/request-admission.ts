import type {IncomingMessage,ServerResponse} from 'node:http';
// Bound simultaneous request bodies, including bodies awaiting an upstream response.
// This process-wide limit supplements body byte/time limits; ordinary GET/HEAD/SSE remain available.
export const MAX_BODY_REQUESTS = 8;
let activeBodyRequests = 0;
export function hasRequestBody(req:IncomingMessage) {
  return !['GET', 'HEAD'].includes(String(req.method || 'GET').toUpperCase())
    || Number(req.headers['content-length'] || 0) > 0
    || Boolean(req.headers['transfer-encoding']);
}
export function admitBodyRequest(req:IncomingMessage, res:ServerResponse) {
  if (res.destroyed || res.writableEnded) return false;
  if (!hasRequestBody(req)) return true;
  if (activeBodyRequests >= MAX_BODY_REQUESTS) {
    req.pause();
    res.writeHead(503, {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Retry-After': '1', 'Connection': 'close',
    });
    res.end(JSON.stringify({ ok: false, error: '현재 처리 중인 요청이 많습니다. 잠시 후 다시 시도해 주세요.' }), () => req.destroy());
    return false;
  }
  activeBodyRequests++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeBodyRequests--;
    res.off('finish', release); res.off('close', release);
  };
  // Retain the slot through application/upstream work, not just while reading the body.
  res.once('finish', release); res.once('close', release);
  return true;
}
