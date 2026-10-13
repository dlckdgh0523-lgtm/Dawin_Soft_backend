import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import type {ServerResponse} from 'node:http';
export async function writeNodeResponse(response:Response,outgoing:ServerResponse){
 const headers:Record<string,string|string[]>=Object.fromEntries(response.headers);
 const cookies=response.headers.getSetCookie();if(cookies.length)headers['set-cookie']=cookies;
 outgoing.writeHead(response.status,headers);
 // Flush headers before awaiting any body chunk. SSE remains an open stream.
 outgoing.flushHeaders();
 if(!response.body){outgoing.end();return;}
 await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),outgoing);
}
