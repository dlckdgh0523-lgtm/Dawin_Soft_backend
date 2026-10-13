export async function digest(bytes:ArrayBuffer|Uint8Array){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function signature(secret:string,text:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export function signingText(method:string,path:string,headers:Headers,hash:string){return [method,path,headers.get('x-danwi-timestamp')??'',headers.get('x-danwi-nonce')??'',headers.get('x-danwi-user-id')??'',headers.get('x-danwi-user-email')??'',headers.get('x-danwi-origin')??'',headers.get('x-danwi-client')??'',headers.get('cookie')??'',hash].join('\n');}
export function constantEqual(a:string,b:string){if(a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;}
export async function limitedBody(req:Request,limit=14*1024*1024){const reader=req.body?.getReader();if(!reader)return new Uint8Array();const chunks:Uint8Array[]=[];let size=0;while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>limit){await reader.cancel();throw new Error('Payload too large');}chunks.push(next.value);}const result=new Uint8Array(size);let position=0;for(const c of chunks){result.set(c,position);position+=c.byteLength;}return result;}

export function validGatewayMetadata(headers:Headers,now=Date.now()){
 const timestamp=headers.get('x-danwi-timestamp')??'',nonce=headers.get('x-danwi-nonce')??'',mac=headers.get('x-danwi-signature')??'';
 return /^\d{13}$/.test(timestamp)&&Number.isSafeInteger(Number(timestamp))&&Math.abs(now-Number(timestamp))<=30000&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(nonce)&&/^[a-f0-9]{64}$/i.test(mac);
}
export async function verifyGateway(method:string,path:string,headers:Headers,bytes:Uint8Array,secret:string,now=Date.now()){
 if(!validGatewayMetadata(headers,now))return false;
 return constantEqual(await signature(secret,signingText(method,path,headers,await digest(bytes))),headers.get('x-danwi-signature')??'');
}
