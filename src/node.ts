import {writeNodeResponse} from './node-response';
import {readBody,BodyError} from './node-body';
import {admitBodyRequest} from './request-admission';
import {mailNotification} from './mail-node';
import {adminLogin,adminIdentity,adminAuthConfig} from './admin-auth';
import {localAdminSetup} from './local-admin-setup';
import {withOperations} from './operations-node';
import {createServer} from 'node:http';
import {handle} from './handler';
import {localIdentity} from './local-auth';
import {postgres} from './db';
import {validGatewayMetadata,verifyGateway} from './security';
import {Fault} from './types';
import {anthropicGuide} from './anthropic-guide';
import {editorialRuntime} from './editorial-runtime';

const dev=process.env.DEV_DATABASE==='true';
const local=process.env.LOCAL_POSTGRES==='true';
if(process.env.NODE_ENV==='production'&&(dev||local))throw new Error('Production must not enable local/test authentication.');
if(local&&(!process.env.LOCAL_AUTH_SECRET||!['127.0.0.1','localhost'].includes(new URL(process.env.DATABASE_URL!).hostname)||!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(process.env.SITE_URL??'')))throw new Error('Local PostgreSQL requires loopback-only database, origin and authentication.');
if(!dev&&(!process.env.DATABASE_URL||!process.env.GATEWAY_SECRET))throw new Error('DATABASE_URL and GATEWAY_SECRET are required.');
if(!dev&&!local&&(process.env.GATEWAY_SECRET?.length??0)<32)throw new Error('GATEWAY_SECRET requires at least 32 characters.');
const ai=process.env.ANTHROPIC_API_KEY?anthropicGuide(process.env.ANTHROPIC_API_KEY):undefined;
const db=dev?await (await import('./pglite-dev')).devDatabase(process.env.DEV_DATA_PATH??'work/pgdata'):postgres(process.env.DATABASE_URL!);
const origin=process.env.SITE_URL??'http://127.0.0.1:5173';

const server=createServer({headersTimeout:10000,requestTimeout:35000,connectionsCheckingInterval:1000,maxHeaderSize:16384},async(incoming,outgoing)=>{
 try{
  const headers=new Headers();
  for(const[k,v]of Object.entries(incoming.headers))if(v)headers.set(k,Array.isArray(v)?v.join(','):v);
  const target=incoming.url??'/';
  if(!target.startsWith('/')||target.startsWith('//')||target.includes('\\'))throw new Fault(400,'잘못된 요청 주소입니다.');
  const reqUrl=new URL(target,origin);
  if(reqUrl.origin!==new URL(origin).origin)throw new Fault(400,'잘못된 요청 주소입니다.');
  // Reject invalid gateway metadata before buffering an unauthenticated upload.
  if(!dev&&!local&&!validGatewayMetadata(headers))throw new Fault(401,'Gateway authentication required');
  if(!admitBodyRequest(incoming,outgoing))return;
  const bytes=await readBody(incoming);
  let identity=null,clientKey='local';
  if(!dev&&!local){
   if(!await verifyGateway(incoming.method??'GET',reqUrl.pathname+reqUrl.search,headers,bytes,process.env.GATEWAY_SECRET!))throw new Fault(401,'Gateway authentication required');
   const nonce=headers.get('x-danwi-nonce')!;
   const replay=await db.query('INSERT INTO gateway_nonce(nonce) VALUES($1) ON CONFLICT DO NOTHING RETURNING nonce',[nonce]);
   if(!replay.rows.length)throw new Fault(401,'Replay rejected');
   await db.query("DELETE FROM gateway_nonce WHERE created_at<now()-interval '2 minutes'");
   const originalOrigin=headers.get('x-danwi-origin');
   if(originalOrigin)headers.set('origin',originalOrigin);else headers.delete('origin');
   const id=headers.get('x-danwi-user-id');
   if(id)identity={id,email:headers.get('x-danwi-user-email')??''};
   clientKey=headers.get('x-danwi-client')??'unknown';
  }else if(local){
   identity=localIdentity(headers.get('cookie')??'',process.env.LOCAL_AUTH_SECRET!);
  }else{
   identity=process.env.DEV_USER_ID?{id:process.env.DEV_USER_ID,email:process.env.DEV_USER_EMAIL??'local-test@example.invalid'}:null;
  }

  const requestAbort=new AbortController();
  outgoing.once('close',()=>{if(!outgoing.writableEnded)requestAbort.abort();});
  const req=new Request(reqUrl,{method:incoming.method,headers,body:['GET','HEAD'].includes(incoming.method??'GET')?undefined:new Uint8Array(bytes),signal:requestAbort.signal});
  if(local&&reqUrl.pathname==='/admin/setup-login'){
   await writeNodeResponse(await localAdminSetup(req,db),outgoing);return;
  }
  const login=await adminLogin(req,db,adminAuthConfig());
  if(login){await writeNodeResponse(login,outgoing);return;}
  const protectedRequest=reqUrl.pathname.startsWith('/admin')||reqUrl.pathname.startsWith('/api/admin/');
  const revalidateIdentity=protectedRequest&&!dev?()=>adminIdentity(req,db,adminAuthConfig()):undefined;
  if(revalidateIdentity)identity=await revalidateIdentity();
  const result=await handle(req,withOperations(editorialRuntime({db,identity,revalidateIdentity,origin,ownerEmail:process.env.OWNER_EMAIL,privateSite:process.env.PRIVATE_SITE!=='false',clientKey,ai,notify:mailNotification()})));
  await writeNodeResponse(result,outgoing);
 }catch(error){
  if(outgoing.headersSent){outgoing.destroy();return;}
  const status=error instanceof Fault||error instanceof BodyError?error.status:503;
  const message=error instanceof Fault||error instanceof BodyError?error.message:'처리 결과를 확인하지 못했습니다.';
  outgoing.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Connection':'close'});
  outgoing.end(JSON.stringify({ok:false,error:message}),()=>incoming.destroy());
 }
});
const port=Number(process.env.PORT??5196);
server.maxConnections=256;
server.maxRequestsPerSocket=1000;
server.listen(port,dev||local?'127.0.0.1':'0.0.0.0',()=>console.log(dev?'Local PGlite backend ready at http://127.0.0.1:'+port:local?'Local PostgreSQL backend ready at http://127.0.0.1:'+port:'PostgreSQL backend ready on port '+port));
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>server.close(async()=>{await db.close();process.exit(0);}));
