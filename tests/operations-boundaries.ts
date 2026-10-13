import assert from 'node:assert/strict';
import {devDatabase} from '../src/pglite-dev';
import {operator} from '../src/store';
import {editorialConfig,sourceFingerprint} from '../src/insights-core';
import {enqueue,processGeneration} from '../src/insights-jobs';
import {processOperations} from '../src/operations-jobs';
import type {Db,Runtime,Data} from '../src/types';

// Isolated PostgreSQL WASM fixtures only. No persistent directory, HTTP, keys or paid calls.
// The transition hook commits the simulated other worker's lease recovery BEFORE
// the old worker opens its result transaction, so the new fence must reject it.
let checks=0,fixtureProviderCalls=0;
async function makeRuntime(){const db=await devDatabase();const rt:Runtime={db,identity:{id:'boundary-owner',email:'owner@example.invalid'},ownerEmail:'owner@example.invalid',origin:'http://127.0.0.1:5195',privateSite:false,clientKey:'boundary'};await operator(rt);return{db,rt};}
async function resultBoundary(kind:'SEO_CHECK'|'MARKETING_REPORT',transition:'lease-recovered'|'owner-revoked'|'none'){
 const {db,rt}=await makeRuntime();
 try {
  const input=kind==='MARKETING_REPORT'?{start:'2026-10-01',end:'2026-10-07',timezone:'Asia/Seoul'}:{};
  const id='boundary-'+kind.toLowerCase();
  await db.query('INSERT INTO generation_job(id,idempotency_key,kind,input,actor) VALUES($1,$1,$2,$3::jsonb,$4)',[id,kind,JSON.stringify(input),rt.identity!.id]);
  let hooked=false;
  const wrapped:Db={query:(sql,params)=>db.query(sql,params),transaction:async fn=>{
   const pending=(await db.query('SELECT status FROM generation_job WHERE id=$1',[id])).rows[0];
   if(pending?.status==='RUNNING'&&!hooked&&transition!=='none'){
    hooked=true;
    if(transition==='lease-recovered')await db.query("UPDATE generation_job SET status='RETRY',lease_token=NULL,lease_until=NULL,next_attempt_at=now()+interval '1 hour' WHERE id=$1",[id]);
    else await db.query('UPDATE admin_user SET active=false WHERE user_id=$1',[rt.identity!.id]);
   }
   return db.transaction(fn);
  }};
  assert.equal(await processOperations({...rt,db:wrapped}),true);
  assert.equal(hooked,transition!=='none');
  const table=kind==='SEO_CHECK'?'diagnostic_run':'marketing_report';
  const count=(await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
  const job=(await db.query('SELECT status,proposal FROM generation_job WHERE id=$1',[id])).rows[0];
  const successAudit=(await db.query("SELECT count(*)::int AS n FROM audit_log WHERE action='operations.job' AND target=$1",[id])).rows[0].n;
  assert.equal(count,transition==='none'?1:0,'stale or revoked workers must leave no durable result');
  assert.equal(successAudit,transition==='none'?1:0,'no success audit without a committed result');
  assert.equal(job.status,transition==='none'?'SUCCEEDED':'RETRY');
  if(transition!=='none')assert.equal(job.proposal,null);
  checks++;console.log(`PASS ${kind}: ${transition}`);
 } finally {await db.close();}
}

async function writingDowngrade(){
 const {db,rt}=await makeRuntime();
 try {
  await db.query("INSERT INTO admin_user(user_id,email,role) VALUES('boundary-editor','editor@example.invalid','editor')");
  const c:Data={...await editorialConfig(db),paused:false,pricingConfirmed:true,dailyBudget:1,monthlyBudget:1,globalMonthlyBudget:1,model:'fixture',aiEnabled:true,privacyApproved:true,modelVerifiedAt:new Date().toISOString(),modelMaxInputTokens:100000,modelMaxOutputTokens:10000,inputLimit:40000,outputLimit:3000,priceInputPerMillion:1,priceOutputPerMillion:1};
  await db.query("UPDATE editorial_config SET body=$1::jsonb WHERE id='editorial'",[JSON.stringify(c)]);
  const excerpt='공개 운영 자료를 먼저 검토합니다.',hash=await sourceFingerprint(excerpt);
  await db.query("INSERT INTO editorial_source(id,input_url,final_url,origin_host,provider,title,approved,terms_status,status,body_hash,created_by) VALUES('boundary-source','https://example.com/a','https://example.com/a','example.com','URL_HTML','공개 자료',true,'APPROVED','BODY_ACQUIRED',$1,'boundary-owner')",[hash]);
  await db.query("INSERT INTO source_document(id,source_id,body_hash,excerpt,expires_at) VALUES('boundary-document','boundary-source',$1,$2,now()+interval '1 day')",[hash,excerpt]);
  await db.query("INSERT INTO editorial_evidence(id,source_id,document_id,claim,quote,start_offset,end_offset,status,created_by) VALUES('boundary-evidence','boundary-source','boundary-document','공개 운영 검토',$1,0,$2,'VERIFIED','boundary-owner')",[excerpt,excerpt.length]);
  const writer:Runtime={...rt,identity:{id:'boundary-editor',email:'editor@example.invalid'},editorial:{generate:async()=>{fixtureProviderCalls++;return{ok:true,inputTokens:1,outputTokens:1,result:{intent:'SKIP',summary:'fixture',citations:[],paragraphs:[]}};}}};
  for(const role of ['support','analyst']){
   await db.query("UPDATE admin_user SET role='editor',active=true WHERE user_id='boundary-editor'");
   const job=await enqueue(writer,'TITLE',{evidenceIds:['boundary-evidence'],question:'검토용 제목'});
   await db.query("UPDATE admin_user SET role=$1,session_version=session_version+1 WHERE user_id='boundary-editor'",[role]);
   await processGeneration(writer);
   assert.equal(fixtureProviderCalls,0);
   assert.equal((await db.query('SELECT status FROM generation_job WHERE id=$1',[job.jobId])).rows[0].status,'FAILED');
   assert.equal((await db.query('SELECT count(*)::int AS n FROM editorial_usage WHERE job_id=$1',[job.jobId])).rows[0].n,0);
   checks++;console.log('PASS queued TITLE demoted to '+role+': no call or budget hold');
  }
 } finally {await db.close();}
}

for(const kind of ['SEO_CHECK','MARKETING_REPORT'] as const){
 await resultBoundary(kind,'lease-recovered');
 await resultBoundary(kind,'owner-revoked');
 await resultBoundary(kind,'none');
}
await writingDowngrade();
console.log(JSON.stringify({checks,fixtureProviderCalls,externalRequests:0,paidCalls:0}));
