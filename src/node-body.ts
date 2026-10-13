// Bounded HTTP body reader. Does not destroy the socket before an error response is sent.
export class BodyError extends Error {
  constructor(public status:number, message:string) { super(message); this.status = status; }
}
export function readBody(req:import('node:http').IncomingMessage, { limit = 14 * 1024 ** 2, timeoutMs = 30_000 } = {}) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks:Buffer[] = []; let length = 0; let settled = false;
    const finish = (error?:Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      req.off('data', onData); req.off('end', onEnd); req.off('error', onError); req.off('aborted', onAbort);
      if (error) { req.pause(); reject(error); } else resolve(Buffer.concat(chunks, length));
    };
    const onData = (chunk:Buffer) => { length += chunk.length; if (length > limit) finish(new BodyError(413, '첨부 용량을 줄여 다시 시도하세요.')); else chunks.push(chunk); };
    const onEnd = () => finish();
    const onError = () => finish(new BodyError(400, '요청 전송이 완료되지 않았습니다.'));
    const onAbort = () => finish(new BodyError(400, '요청 전송이 중단됐습니다.'));
    const timer = setTimeout(() => finish(new BodyError(408, '전송 시간이 초과됐습니다. 다시 시도하세요.')), timeoutMs);
    timer.unref();
    req.on('data', onData); req.once('end', onEnd); req.once('error', onError); req.once('aborted', onAbort);
    if (Number(req.headers['content-length'] || 0) > limit) finish(new BodyError(413, '첨부 용량을 줄여 다시 시도하세요.'));
    else if (req.readableEnded) finish();
    else if (req.destroyed) finish(new BodyError(400, '요청이 중단됐습니다.'));
  });
}
