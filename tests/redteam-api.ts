import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {devDatabase} from '../src/pglite-dev';
import {handle} from '../src/handler';
import {operator,saveContent,publish} from '../src/store';
import {day,windowFor} from '../src/operations-core';
import {hashPassword} from '../src/insights-social';
import {signature,digest,signingText,validGatewayMetadata,verifyGateway} from '../src/security';
import {Fault,type Runtime,type Data,type ContentRow} from '../src/types';
const before=process.argv.includes('--probe-before');
const checks:Data[]=[];
async function tested(name:string,fn:()=>Promise<void>|void){try{await fn();checks.push({name,pass:true});console.log('PASS '+name);}catch(e){checks.push({name,pass:false,error:e instanceof Error?e.message:'FAILED'});console.log('FAIL '+name+': '+(e instanceof Error?e.message:'FAILED'));}}
const db=await devDatabase();
const rt:Runtime={db,identity:{id:'api-owner',email:'owner@example.invalid'},ownerEmail:'owner@example.invalid',origin:'http://127.0.0.1:5987',privateSite:false,clientKey:'api-owner',editorial:{visitorSecret:'synthetic-visitor-secret-no-production'}};
const guest:Partial<Runtime>={identity:null,clientKey:'guest'};
async function call(path:string,data?:unknown,extra:Partial<Runtime>={},options:{method?:string;origin?:string|null;type?:string;raw?:string;cookie?:string}={}){
 const method=options.method??(data===undefined&&options.raw===undefined?'GET':'POST');
 const headers=new Headers();
 if(method!=='GET'&&method!=='HEAD'){if(options.origin!==null)headers.set('Origin',options.origin??rt.origin);headers.set('Content-Type',options.type??'application/json');}
 if(options.cookie)headers.set('Cookie',options.cookie);
 return handle(new Request(rt.origin+path,{method,headers,body:method==='GET'||method==='HEAD'?undefined:options.raw??JSON.stringify(data)}),{...rt,...extra});
}
const scalar=(v:unknown)=>new URLSearchParams({page:String(v)}).toString();
try{
 await operator(rt);
 for(const role of ['editor','support','analyst'])await db.query('INSERT INTO admin_user(user_id,email,role) VALUES($1,$2,$3)',['api-'+role,role+'@example.invalid',role]);
 await db.query("INSERT INTO admin_user(user_id,email,role,active) VALUES('api-disabled','disabled@example.invalid','owner',false)");
 await db.query("INSERT INTO content(id,kind,draft,published,first_published_at) VALUES('api-article','article',$1::jsonb,$1::jsonb,now()),('api-other','article',$2::jsonb,$2::jsonb,now()),('api-draft','article',$3::jsonb,NULL,NULL)",[
 JSON.stringify({slug:'api-article',title:'공개 검수 글',description:'합성 테스트',body:'합성 공개 본문',author:'검수',commentsEnabled:true,reactionsEnabled:true,indexable:true}),
 JSON.stringify({slug:'api-other',title:'다른 글',description:'합성 테스트',body:'다른 글',author:'검수',commentsEnabled:true,reactionsEnabled:true}),
 JSON.stringify({slug:'api-draft',title:'비공개 합성 글',body:'PRIVATE_DRAFT_MARKER'})]);
 for(const p of ['Infinity','1.5','100001','-1'])await tested('comment API rejects invalid pagination '+p,async()=>assert.equal((await call('/api/insights/comments?article=api-article&'+scalar(p),undefined,guest)).status,400));
 await tested('article SSR rejects fractional comment page',async()=>assert.equal((await call('/insights/api-article?commentPage=1.5',undefined,guest)).status,400));
 await tested('ordinary comment pagination remains usable',async()=>assert.equal((await call('/api/insights/comments?article=api-article&page=1',undefined,guest)).status,200));
 for(const invalid of ['2026-99-99','2026-02-30','0000-00-00'])await tested('date validation returns input Fault '+invalid,()=>assert.throws(()=>day(invalid),e=>e instanceof Fault&&e.status===400));
 await tested('date window validates impossible calendar input',()=>assert.throws(()=>windowFor(new URL(rt.origin+'/api/admin/marketing/summary?start=2026-13-02')),e=>e instanceof Fault&&e.status===400));
 await tested('normal leap day remains valid',()=>assert.equal(day('2024-02-29'),'2024-02-29'));
 if(!before){
 for(const [name,actor,status]of [['anonymous',null,401],['unregistered',{id:'unknown',email:'unknown@example.invalid'},403],['disabled',{id:'api-disabled',email:'disabled@example.invalid'},403]] as const)await tested('privileged data denied to '+name,async()=>{for(const p of ['/api/admin/bootstrap','/api/admin/inquiries','/api/admin/audit','/api/admin/insights/sources'])assert.equal((await call(p,undefined,{identity:actor as any})).status,status,p);});
 for(const role of ['editor','support','analyst'])await tested(role+' cannot read owner settings or source documents',async()=>{const identity={id:'api-'+role,email:role+'@example.invalid'};for(const p of ['/api/admin/operators','/api/admin/audit','/api/admin/insights/sources'])assert.equal((await call(p,undefined,{identity})).status,403,p);});
 await tested('support cannot edit content, editor cannot read inquiries',async()=>{assert.equal((await call('/api/admin/content',{}, {identity:{id:'api-support',email:'support@example.invalid'}})).status,403);assert.equal((await call('/api/admin/inquiries',undefined,{identity:{id:'api-editor',email:'editor@example.invalid'}})).status,403);});
 await tested('editor cannot publish a draft or approve comments',async()=>{const identity={id:'api-editor',email:'editor@example.invalid'};assert.equal((await call('/api/admin/publish',{id:'api-draft',action:'publish',revision:1},{identity})).status,403);assert.equal((await call('/api/admin/insights/comments',{id:'absent',status:'APPROVED'},{identity})).status,403);});
 for(const origin of [null,'null','https://attacker.invalid'])await tested('CSRF missing/null/foreign origin rejected '+(origin===null?'[missing]':origin),async()=>{for(const p of ['/api/admin/content','/api/insights/comments','/api/inquiries'])assert.equal((await call(p,{},guest,{origin})).status,403);});
 await tested('non-JSON content types rejected',async()=>{for(const p of ['/api/inquiries','/api/insights/comments'])assert.equal((await call(p,{},guest,{type:'text/plain'})).status,415);});
 for(const raw of ['{','null','[]','"text"'])await tested('malformed JSON or scalar rejected '+raw,async()=>{for(const p of ['/api/inquiries','/api/insights/comments'])assert.equal((await call(p,undefined,guest,{raw})).status,400);});
 await tested('oversize editorial payload rejected before mutation',async()=>assert.equal((await call('/api/insights/comments',undefined,guest,{raw:JSON.stringify({body:'X'.repeat(250001)})})).status,413));
 await tested('non-read public page method rejected',async()=>assert.equal((await call('/',{},guest,{method:'DELETE'})).status,405));
 await tested('non-POST editorial mutation rejected',async()=>assert.equal((await call('/api/insights/comments',{},guest,{method:'PUT'})).status,405));
 await tested('SQL-like identifiers and query filters are parameters',async()=>{assert.equal((await call('/api/insights/comments?article='+encodeURIComponent("' OR 1=1; DROP TABLE content;--"),undefined,guest)).status,404);assert.equal((await call('/api/admin/insights/bootstrap?q='+encodeURIComponent("' OR 1=1;--"))).status,200);assert.ok((await db.query("SELECT id FROM content WHERE id='api-article'")).rows.length);});
 await tested('prototype keys do not pollute global objects or stored CMS fields',async()=>{const row=(await db.query<ContentRow>("SELECT * FROM content WHERE id='danwi-faq-01'")).rows[0];const raw=JSON.stringify({id:row.id,kind:row.kind,revision:row.revision,body:{...row.draft}}).replace('"body":{','"body":{"__proto__":{"redteamPolluted":true},');assert.equal((await call('/api/admin/content',undefined,{}, {raw})).status,200);assert.equal(({} as any).redteamPolluted,undefined);assert.ok(!Object.hasOwn((await db.query("SELECT draft FROM content WHERE id='danwi-faq-01'")).rows[0].draft,'__proto__'));});
 const password='synthetic-comment-password';
 const hash=await hashPassword(password);
 await db.query("INSERT INTO article_comment(id,content_id,nickname,body,password_hash,status) VALUES('api-comment','api-article','합성 방문자',$1,$2,'APPROVED'),('api-pending','api-article','검토 대기','SECRET_PENDING',$2,'PENDING')",['<img src=x onerror="globalThis.pwned=1"><script>globalThis.pwned=2</script>',hash]);
 await db.query("INSERT INTO article_comment(id,content_id,nickname,body,official_actor,status) VALUES('api-official','api-article','단위소프트','공식 답글','api-owner','APPROVED')");
 await tested('comment wrong password denied without mutation',async()=>{assert.equal((await call('/api/insights/comments',{articleId:'api-article',id:'api-comment',action:'delete',password:'wrong-password'}, {...guest,clientKey:'wrong'})).status,403);assert.equal((await db.query("SELECT status FROM article_comment WHERE id='api-comment'")).rows[0].status,'APPROVED');});
 await tested('comment IDOR across article boundaries rejected',async()=>assert.equal((await call('/api/insights/comments',{articleId:'api-other',id:'api-comment',action:'delete',password},{...guest,clientKey:'cross'})).status,404));
 await tested('guest cannot delete official author comment',async()=>assert.equal((await call('/api/insights/comments',{articleId:'api-article',id:'api-official',action:'delete',password},{...guest,clientKey:'official'})).status,404));
 await tested('draft article cannot accept comments or reactions',async()=>{assert.equal((await call('/api/insights/comments',{articleId:'api-draft',nickname:'방문자',body:'비공개 글 댓글',password},{...guest,clientKey:'draft'})).status,404);assert.equal((await call('/api/insights/reactions',{targetType:'article',targetId:'api-draft',active:true},{...guest,clientKey:'draft'})).status,404);});
 await tested('pending comments and password hashes never enter public DTO',async()=>{const text=await (await call('/api/insights/comments?article=api-article',undefined,guest)).text();assert.ok(!text.includes('SECRET_PENDING'));assert.ok(!text.includes('password_hash'));assert.ok(!text.includes('pbkdf2:'));});
 await tested('stored and reflected XSS remain text under SSR and JSON-LD',async()=>{
 const payload='</script><script id="redteam-xss">globalThis.pwned=1</script><img src=x onerror="globalThis.pwned=2">';
 await db.query("UPDATE content SET published=jsonb_set(jsonb_set(published,'{title}',$1::jsonb),'{description}',$1::jsonb) WHERE id='api-article'",[JSON.stringify(payload)]);
 for(const p of ['/insights/api-article','/insights?q='+encodeURIComponent(payload),'/faq?q='+encodeURIComponent(payload)]){let response=await call(p,undefined,guest);if(response.status===308){const location=new URL(response.headers.get('location')!);assert.equal(location.origin,rt.origin);response=await call(location.pathname+location.search,undefined,guest);}assert.equal(response.status,200);const dom=new JSDOM(await response.text());assert.equal(dom.window.document.querySelector('#redteam-xss'),null);assert.equal(dom.window.document.querySelector('[onerror]'),null);for(const node of dom.window.document.querySelectorAll('script[type="application/ld+json"]'))assert.doesNotThrow(()=>JSON.parse(node.textContent!));dom.window.close();}
 });
 await tested('public draft SSR remains absent, private endpoints not cached',async()=>{assert.equal((await call('/insights/api-draft',undefined,guest)).status,404);const response=await call('/api/admin/inquiries');assert.match(response.headers.get('cache-control')??'',/no-store/);assert.equal(response.headers.get('x-content-type-options'),'nosniff');});
 await tested('HTML denies framing and constrains executable sources',async()=>{const response=await call('/contact',undefined,guest);assert.equal(response.headers.get('x-frame-options'),'DENY');assert.match(response.headers.get('content-security-policy')??'',/frame-ancestors 'none'/);assert.match(response.headers.get('content-security-policy')??'',/form-action 'self'/);});
 const settings=(await db.query<ContentRow>("SELECT * FROM content WHERE id='settings'")).rows[0];
 await saveContent(rt,'settings','settings',{...settings.draft,privacyApproved:true,privacyConsentRequired:true,inquiriesEnabled:true,privacyController:'합성 담당자',privacyContact:'qa@example.invalid',privacyRetention:'테스트',privacyRecipients:'테스트',privacyDeletion:'테스트',privacyLegalBasis:'테스트',privacyBackupRetention:'테스트',privacyLogRetention:'테스트'},settings.revision);
 await publish(rt,'settings','publish',settings.revision+1,()=>{});
 const inquiry={idempotencyKey:crypto.randomUUID(),name:'합성 문의',email:'qa@example.invalid',phone:'',description:'분리 검수에서만 사용하는 합성 문의입니다.',service:'undecided',sourcePage:'/contact',privacy:true,website:'',files:[]};
 for(const [field,value] of [['email','bad email'],['privacy',false],['website','honeypot'],['description','짧음'],['existingUrl','javascript:alert(1)'],['sourcePage','http://169.254.169.254/']] as const)await tested('inquiry rejects invalid '+field,async()=>assert.equal((await call('/api/inquiries',{...inquiry,idempotencyKey:crypto.randomUUID(),[field]:value},{...guest,clientKey:'invalid-'+field})).status,400));
 await tested('executable or mismatched inquiry attachment denied',async()=>{for(const file of [{name:'attack.svg',mime:'image/svg+xml',data:Buffer.from('<svg onload="alert(1)"/>').toString('base64')},{name:'image.png',mime:'image/png',data:Buffer.from('<script>alert(1)</script>').toString('base64')}])assert.equal((await call('/api/inquiries',{...inquiry,idempotencyKey:crypto.randomUUID(),files:[file]},{...guest,clientKey:'files-'+file.name})).status,400);});
 await tested('concurrent inquiry clicks persist exactly one receipt',async()=>{const responses=await Promise.all(Array.from({length:4},()=>call('/api/inquiries',inquiry,{...guest,clientKey:'concurrent'})));const receipts=await Promise.all(responses.map(r=>r.json()));assert.ok(receipts.every(r=>r.ok&&r.receipt===receipts[0].receipt));assert.equal((await db.query('SELECT count(*)::int AS n FROM inquiry WHERE idempotency_key=$1',[inquiry.idempotencyKey])).rows[0].n,1);});
 await tested('public inquiry throttled after five distinct requests',async()=>{for(let i=0;i<6;i++){const r=await call('/api/inquiries',{...inquiry,idempotencyKey:crypto.randomUUID()},{...guest,clientKey:'rate-probe'});assert.equal(r.status,i===5?429:201);}});
 await tested('correct comment edit returns to moderation and hides old public body',async()=>{assert.equal((await call('/api/insights/comments',{articleId:'api-article',id:'api-comment',action:'edit',nickname:'수정 방문자',body:'수정 검수 내용',password},{...guest,clientKey:'good-edit'})).status,200);assert.equal((await db.query("SELECT status FROM article_comment WHERE id='api-comment'")).rows[0].status,'PENDING');assert.ok(!(await (await call('/api/insights/comments?article=api-article',undefined,guest)).text()).includes('수정 검수 내용'));});
 const bytes=new TextEncoder().encode('{"synthetic":true}'),secret='synthetic-gateway-secret-32chars-only',now=Date.now();
 async function signed(overrides:Record<string,string>={}){const headers=new Headers({'x-danwi-timestamp':String(now),'x-danwi-nonce':crypto.randomUUID(),'x-danwi-client':'client','cookie':'session=synthetic',...overrides});headers.set('x-danwi-signature',await signature(secret,signingText('POST','/api/test?x=1',headers,await digest(bytes))));return headers;}
 await tested('ordinary signed gateway request validates',async()=>assert.equal(await verifyGateway('POST','/api/test?x=1',await signed(),bytes,secret,now),true));
 for(const timestamp of ['NaN','Infinity','1e12',String(now-30001),String(now+30001)])await tested('signed malformed or stale timestamp rejected '+timestamp,async()=>assert.equal(await verifyGateway('POST','/api/test?x=1',await signed({'x-danwi-timestamp':timestamp}),bytes,secret,now),false));
 await tested('malformed nonce and MAC rejected before body digest',async()=>{assert.equal(validGatewayMetadata(await signed({'x-danwi-nonce':'x'.repeat(36)}),now),false);const headers=await signed();headers.set('x-danwi-signature','g'.repeat(64));assert.equal(validGatewayMetadata(headers,now),false);});
 await tested('signature binds method/path/body/cookie/client and secret',async()=>{const headers=await signed();for(const [method,path,body,key]of [['GET','/api/test?x=1',bytes,secret],['POST','/api/test?x=2',bytes,secret],['POST','/api/test?x=1',new Uint8Array([1]),secret],['POST','/api/test?x=1',bytes,secret+'wrong']] as const)assert.equal(await verifyGateway(method,path,headers,body,key,now),false);for(const name of ['cookie','x-danwi-client']){const tamper=new Headers(headers);tamper.set(name,'tampered');assert.equal(await verifyGateway('POST','/api/test?x=1',tamper,bytes,secret,now),false);}});
 await tested('gateway nonce insertion permits no concurrent replay',async()=>{const nonce=crypto.randomUUID();const inserts=await Promise.all([db.query('INSERT INTO gateway_nonce(nonce) VALUES($1) ON CONFLICT DO NOTHING RETURNING nonce',[nonce]),db.query('INSERT INTO gateway_nonce(nonce) VALUES($1) ON CONFLICT DO NOTHING RETURNING nonce',[nonce])]);assert.equal(inserts.reduce((n,r)=>n+r.rows.length,0),1);});
 }
}finally{await db.close();}
await mkdir('tests/results',{recursive:true});
await writeFile('tests/results/redteam-api'+(before?'-before':'')+'.json',JSON.stringify({scope:'Synthetic memory PostgreSQL and handler requests only. No ENV, operating DB, hosted website or external provider accessed.',passed:checks.filter(c=>c.pass).length,failed:checks.filter(c=>!c.pass).length,checks,finishedAt:new Date().toISOString()},null,2));
if(checks.some(c=>!c.pass))process.exitCode=1;
