import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const checks=[];
async function tested(name,fn){try{await fn();checks.push({name,pass:true});console.log('PASS '+name);}catch(e){checks.push({name,pass:false,error:e.message});console.log('FAIL '+name+': '+e.message);}}
const root=process.cwd(),front=process.env.FRONTEND_ROOT||path.resolve(root,'../danwisoft-frontend');
const temp=await mkdtemp(path.join(tmpdir(),'danwi-redteam-http-'));
const env={};for(const k of ['SystemRoot','WINDIR','PATH','TEMP','TMP'])if(process.env[k])env[k]=process.env[k];
async function port(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;}
const backendPort=await port(),frontPort=await port(),origin='http://127.0.0.1:'+frontPort;
const children=[];
function child(cwd,args,extra){const p=spawn(process.execPath,args,{cwd,env:{...env,...extra},stdio:['ignore','pipe','pipe']});p.output='';p.stdout.on('data',x=>p.output+=x);p.stderr.on('data',x=>p.output+=x);children.push(p);return p;}
async function ready(p,base){for(let i=0;i<100;i++){if(p.exitCode!==null)throw Error('Isolated server exited: '+p.output.slice(-200));try{if((await fetch(base+'/health',{signal:AbortSignal.timeout(300)})).status===200)return;}catch{}await new Promise(r=>setTimeout(r,150));}throw Error('Isolated server readiness timeout');}
async function raw(target,headers,body=''){return new Promise((resolve,reject)=>{const r=http.request(target,{method:'POST',headers},res=>{let data='';res.setEncoding('utf8');res.on('data',c=>data+=c);res.on('end',()=>resolve({status:res.statusCode,body:data}));});r.on('error',reject);r.setTimeout(5000,()=>r.destroy(Error('Fixture timeout')));r.end(body);});}
try{
 const backend=child(root,['backend/index.js'],{NODE_ENV:'development',DEV_DATABASE:'true',DEV_DATA_PATH:path.join(temp,'pg'),MEDIA_ROOT:path.join(temp,'media'),SITE_URL:origin,PORT:String(backendPort),PRIVATE_SITE:'false'});
 await ready(backend,'http://127.0.0.1:'+backendPort);
 const gateway=child(front,['server.mjs'],{NODE_ENV:'development',SITE_URL:origin,BACKEND_URL:'http://127.0.0.1:'+backendPort,GATEWAY_SECRET:'synthetic-test-secret-over-32-characters',PORT:String(frontPort),HOST:'127.0.0.1',BODY_TIMEOUT_MS:'1000'});
 await ready(gateway,origin);
 await tested('real front gateway + SSR backend serves approved home',async()=>{const r=await fetch(origin);assert.equal(r.status,200);const h=await r.text();assert.match(h,/아이디어를 넘어/);assert.match(h,/logo-motion.js/);assert.match(h,/id="hero-demo"/);assert.match(h,/id="panel-geo"/);});
 await tested('existing service, work, process, FAQ, contact routes stay available',async()=>{for(const p of ['/services/website-development','/services/admin-systems','/services/ai-automation','/services/seo-geo','/work','/process','/faq','/contact','/insights'])assert.equal((await fetch(origin+p)).status,200,p);});
 await tested('real static assets and transport MIME headers preserved',async()=>{for(const p of ['/logo-motion.js','/site.js','/styles.css']){const r=await fetch(origin+p);assert.equal(r.status,200,p);assert.equal(r.headers.get('x-content-type-options'),'nosniff');}});
 await tested('actual HEAD response contains no HTML body',async()=>{const r=await fetch(origin,{method:'HEAD'});assert.equal(r.status,200);assert.equal(await r.text(),'');});
 await tested('anonymous admin path redirects only to login',async()=>{const r=await fetch(origin+'/admin',{redirect:'manual'});assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/admin/login');});
 await tested('unconfigured login fails closed with explanatory page',async()=>{const r=await fetch(origin+'/admin/login');assert.equal(r.status,503);assert.ok((await r.text()).includes('단위소프트'));});
 await tested('forged identities never grant real HTTP administrator access',async()=>{const r=await fetch(origin+'/api/admin/bootstrap',{headers:{'x-danwi-user-id':'local-owner','x-danwi-user-email':'owner@example.invalid','x-oai-user-id':'local-owner','x-oai-user-email':'owner@example.invalid','cookie':'danwi_admin=forged'}});assert.equal(r.status,401);});
 await tested('real anonymous admin SSE does not open a stream',async()=>{const r=await fetch(origin+'/api/admin/events');assert.equal(r.status,401);assert.ok(!r.headers.get('content-type')?.includes('event-stream'));});
 await tested('actual Origin remains foreign through the gateway',async()=>{const r=await fetch(origin+'/api/inquiries',{method:'POST',headers:{Origin:'https://attacker.invalid','Content-Type':'application/json'},body:'{}'});assert.equal(r.status,403);});
 await tested('real missing Origin is rejected',async()=>{const r=await fetch(origin+'/api/inquiries',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,403);});
 await tested('unapproved privacy configuration does not accept inquiries',async()=>{const r=await fetch(origin+'/api/inquiries',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({idempotencyKey:crypto.randomUUID()})});assert.equal(r.status,503);assert.equal((await r.json()).ok,false);});
 await tested('real declared oversize body fails 413 before forwarding',async()=>{const r=await raw(origin+'/api/inquiries',{'Content-Length':String(14*1024**2+1),'Content-Type':'application/json',Origin:origin});assert.equal(r.status,413);assert.ok(r.body.includes('용량'));});
 await tested('real malformed URL and unpublished routes do not crash servers',async()=>{assert.equal((await fetch(origin+'/%ZZ')).status,400);assert.equal((await fetch(origin+'/insights/not-published')).status,404);assert.equal((await fetch(origin+'/health')).status,200);});
 await tested('errors do not expose stack paths or secrets',async()=>{const r=await fetch(origin+'/api/admin/bootstrap');const body=await r.text();assert.ok(!body.includes('synthetic-test-secret'));assert.ok(!body.includes(root));assert.ok(!body.includes('Error:'));assert.match(r.headers.get('cache-control')||'',/no-store/);});
 for(const mode of ['DEV_DATABASE','LOCAL_POSTGRES'])await tested('production refuses '+mode+' bypass',async()=>{const p=child(root,['backend/index.js'],{NODE_ENV:'production',[mode]:'true',PORT:String(await port())});const result=await Promise.race([once(p,'exit'),new Promise((_,reject)=>setTimeout(()=>reject(Error('Unsafe production process remained running')),5000))]);assert.notEqual(result[0],0);assert.match(p.output,/must not enable local\/test authentication/);});
 await tested('production refuses short gateway secret before DB connection',async()=>{const p=child(root,['backend/index.js'],{NODE_ENV:'production',DATABASE_URL:'postgresql://synthetic@127.0.0.1:1/no-real-db',GATEWAY_SECRET:'short',PORT:String(await port())});const result=await Promise.race([once(p,'exit'),new Promise((_,reject)=>setTimeout(()=>reject(Error('Unsafe process remained running')),5000))]);assert.notEqual(result[0],0);assert.match(p.output,/at least 32 characters/);});
}finally{
 for(const p of children){if(p.exitCode===null){p.kill('SIGTERM');await Promise.race([once(p,'exit'),new Promise(r=>setTimeout(r,1500))]);if(p.exitCode===null)p.kill('SIGKILL');}}
 await mkdir('tests/results',{recursive:true});
 await writeFile('tests/results/redteam-http.json',JSON.stringify({passed:checks.filter(c=>c.pass).length,failed:checks.filter(c=>!c.pass).length,checks,scope:'Actual isolated frontend and compiled backend HTTP servers; synthetic filesystem PGlite only. No env-file, production DB, hosted site, external APIs or real browser.',finishedAt:new Date().toISOString()},null,2));
}
if(checks.some(c=>!c.pass))process.exitCode=1;
