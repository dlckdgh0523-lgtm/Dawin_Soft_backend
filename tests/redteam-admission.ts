import assert from 'node:assert/strict';
import http,{type IncomingMessage,type ServerResponse} from 'node:http';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {admitBodyRequest,MAX_BODY_REQUESTS,hasRequestBody} from '../src/request-admission';
import {readBody} from '../src/node-body';
// Actual loopback HTTP requests; tiny synthetic bodies only. No environment files, DB or external services.
const {proxy}=await import(pathToFileURL(resolve(process.env.FRONTEND_ROOT||'../danwisoft-frontend','src/gateway.mjs')).href);
let passed=0;const checks:string[]=[];
function check(name:string,value:unknown){assert(value,name);passed++;checks.push(name);}
const delay=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
async function until(predicate:()=>boolean){const until=Date.now()+3000;while(!predicate()){if(Date.now()>until)throw Error('Local HTTP probe timed out');await delay(5);}}
async function listen(server:http.Server){server.listen(0,'127.0.0.1');await once(server,'listening');const a=server.address();assert(a&&typeof a==='object');return a.port;}
function call(port:number,method='POST',path='/',headers:Record<string,string>={'content-length':'2'},body?:string){
 let resolveResponse!:(value:any)=>void,rejectResponse!:(error:unknown)=>void;let gotResponse=false;
 const response=new Promise<any>((r,j)=>{resolveResponse=r;rejectResponse=j;});
 const req=http.request({hostname:'127.0.0.1',port,path,method,headers},res=>{gotResponse=true;let data='';res.on('data',b=>data+=b);res.once('end',()=>resolveResponse({status:res.statusCode,headers:res.headers,data}));res.once('error',rejectResponse);});
 req.on('error',e=>{if(!gotResponse)rejectResponse(e);});response.catch(()=>{});
 if(body!==undefined)req.end(body);else req.write('a');return{req,response};
}
async function scenario(layer:'frontend'|'backend'){
 const waiting:ServerResponse[]=[];let ready=0,entered=0,autoRespond=false;const open:any[]=[];const backend=http.createServer(async(req,res)=>{
  if(layer==='backend'&&!admitBodyRequest(req,res))return;
  if(req.method==='GET'||req.method==='HEAD'){
   if(req.url==='/api/admin/events'){res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('event: snapshot\ndata: {}\n\n');}
   else res.end('ordinary read');return;
  }
  try{const bytes=await readBody(req,{timeoutMs:3000});assert.equal(bytes.toString(),'ab');ready++;if(autoRespond)res.end('done');else waiting.push(res);}catch(e){if(!res.destroyed){res.writeHead(400);res.end('aborted');}}
 });const backendPort=await listen(backend);
 const env={SITE_URL:'http://127.0.0.1:59312',BACKEND_URL:'http://127.0.0.1:'+backendPort,GATEWAY_SECRET:'admission-fixture-only-secret-more-than-32',BODY_TIMEOUT_MS:'3000'};
 const gateway=layer==='frontend'?http.createServer((req,res)=>{entered++;void proxy(req,res,env).catch(()=>{if(!res.headersSent)res.writeHead(503);res.end();});}):undefined;
 if(!gateway)backend.on('request',()=>entered++);
 const port=gateway?await listen(gateway):backendPort;
 try{
  for(let i=0;i<MAX_BODY_REQUESTS;i++)open.push(call(port));await until(()=>entered===MAX_BODY_REQUESTS);
  check(layer+': eight incomplete bodies accepted without early response',ready===0);
  const overflow=call(port);open.push(overflow);const denied=await overflow.response;
  check(layer+': ninth incomplete body receives 503 before full upload',denied.status===503);
  check(layer+': overload supplies Retry-After and closes connection',denied.headers['retry-after']==='1'&&denied.headers.connection==='close');
  check(layer+': overload error does not reveal synthetic gateway secret',!denied.data.includes(env.GATEWAY_SECRET));
  const get=call(port,'GET','/',{},'');check(layer+': ordinary GET still available when body slots full',(await get.response).status===200);
  const head=call(port,'HEAD','/',{},'');check(layer+': ordinary HEAD still available when body slots full',(await head.response).status===200);
  const events=call(port,'GET','/api/admin/events',{},'');const sse=await events.response;check(layer+': SSE GET excluded from body admission',sse.status===200&&sse.headers['content-type']==='text/event-stream');
  const bodyGet=call(port,'GET','/',{'transfer-encoding':'chunked'});open.push(bodyGet);check(layer+': chunked GET cannot bypass body admission',(await bodyGet.response).status===503);
  open[0].req.end('b');await until(()=>waiting.length===1&&ready===1);
  const stillFull=call(port);open.push(stillFull);check(layer+': fully read body retains slot while response pending',(await stillFull.response).status===503);
  waiting.shift()!.end('done');check(layer+': admitted request completes normally',(await open[0].response).status===200);
  autoRespond=true;const recovered=call(port,'POST','/',{'content-length':'2'},'ab');check(layer+': finished response releases slot for normal request',(await recovered.response).status===200);
  const aborted=call(port);open.push(aborted);await delay(25);aborted.req.destroy();await delay(50);
  const afterAbort=call(port,'POST','/',{'content-length':'2'},'ab');check(layer+': disconnected body request releases slot',(await afterAbort.response).status===200);
  for(let i=1;i<MAX_BODY_REQUESTS;i++)open[i].req.end('b');const remaining=await Promise.all(open.slice(1,MAX_BODY_REQUESTS).map(x=>x.response));check(layer+': remaining admitted requests finish without slot leak',remaining.every(r=>r.status===200));
  const final=call(port,'POST','/',{'content-length':'2'},'ab');check(layer+': next request remains healthy after finish/close race',(await final.response).status===200);
 }finally{for(const x of open)x.req.destroy();for(const res of waiting)res.destroy();gateway?.closeAllConnections();backend.closeAllConnections();if(gateway)await new Promise<void>(r=>gateway.close(()=>r()));await new Promise<void>(r=>backend.close(()=>r()));}
}
try{
 check('Admission maximum is eight',MAX_BODY_REQUESTS===8);
 check('Non-body GET/HEAD do not consume body budget',!hasRequestBody({method:'GET',headers:{}} as IncomingMessage)&&!hasRequestBody({method:'HEAD',headers:{}} as IncomingMessage));
 check('Positive length GET and chunked HEAD count as bodies',hasRequestBody({method:'GET',headers:{'content-length':'1'}} as IncomingMessage)&&hasRequestBody({method:'HEAD',headers:{'transfer-encoding':'chunked'}} as IncomingMessage));
 await scenario('frontend');await scenario('backend');
}finally{await mkdir('tests/results',{recursive:true});await writeFile('tests/results/redteam-admission.json',JSON.stringify({passed,checks,maximumBodiesPerProcess:8,maximumIndividualBodyBytes:14*1024**2,maximumRawBodyBytesHeld:8*14*1024**2,method:'Actual loopback HTTP front gateway + isolated backend HTTP handler with production admission module/body reader; no DB or external API',limitations:['No large-volume or memory-exhaustion stress test: each probe body is two synthetic bytes.','Byte ceiling describes retained raw body payload; transient copies and total process memory require additional allowance.','Per-process admission does not replace CDN/IP limits, replicas sizing or timeouts.'],externalRequests:0,privateEnvReads:0,finishedAt:new Date().toISOString()},null,2));}
console.log(`${passed} live HTTP admission checks passed`);
