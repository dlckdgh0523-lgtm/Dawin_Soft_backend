import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {devDatabase} from '../src/pglite-dev';
import {seed,publicRows,saveContent,publish} from '../src/store';
import {handle} from '../src/handler';
import previous from '../src/seed-baseline-v1.json';
import {publicContentRows} from '../src/public-content';
import type {Runtime,ContentRow} from '../src/types';
import {verifyRender} from '../src/render';
const db=await devDatabase('work/alignment-pg-'+Date.now()),checks:string[]=[];
const rt:Runtime={db,identity:{id:'test-owner',email:'test@example.invalid'},ownerEmail:'test@example.invalid',origin:'http://127.0.0.1:5195',privateSite:false,clientKey:'alignment-test'};
function check(name:string,ok:unknown){assert(ok,name);checks.push(name);}
async function call(path:string){return handle(new Request(rt.origin+path),rt);}
await call('/api/admin/bootstrap');
for(const id of ['home','website-development','danwi-faq-01','danwi-faq-02']){
 const old=previous.find(s=>s.id===id)!;
 const body=id==='website-development'?{...old.body,body:'운영자가 작성한 본문 보존'}:old.body;
 await db.query('DELETE FROM content_version WHERE content_id=$1',[id]);
 await db.query('UPDATE content SET draft=$2::jsonb,published=$2::jsonb,revision=$3,published_revision=$3 WHERE id=$1',[id,JSON.stringify(body),id==='danwi-faq-02'?2:1]);
 if(id==='danwi-faq-02')await db.query('INSERT INTO content_version(content_id,revision,body,actor) VALUES($1,2,$2::jsonb,$3)',[id,JSON.stringify(body),'test-owner']);
}
await seed(db);
const all=(await db.query<ContentRow>('SELECT * FROM content')).rows;
check('Untouched v1 homepage upgraded to eight steps',all.find(r=>r.id==='home')!.draft.processSteps.length===8);
const history=(await db.query('SELECT * FROM content_version WHERE content_id=$1 ORDER BY revision',['home'])).rows;
check('Both old and upgraded revisions retained',history.length===2&&history[0].revision===1&&history[1].revision===2);
check('Operator-touched identical body preserved',all.find(r=>r.id==='danwi-faq-02')!.revision===2&&!all.find(r=>r.id==='danwi-faq-02')!.draft.scope);
check('Edited old service body preserved without DB overwrite',all.find(r=>r.id==='website-development')!.draft.body==='운영자가 작성한 본문 보존'&&!all.find(r=>r.id==='website-development')!.draft.technologies);
const bootstrap=await(await call('/api/admin/bootstrap')).json();
check('Old edited rows get usable admin scaffolding',bootstrap.rows.find((r:ContentRow)=>r.id==='website-development').draft.capabilities.length>=3&&bootstrap.rows.find((r:ContentRow)=>r.id==='danwi-faq-02').draft.scope==='HOME');
check('Public old FAQ gets missing scope without replacing question',(await publicRows(rt)).find(r=>r.id==='danwi-faq-02')!.published!.scope==='HOME');
const raw=all.find(r=>r.id==='legacy-center')!;
await saveContent(rt,raw.id,'project',{...raw.draft,body:'검증용 사례 초안',privateClientRecord:'내부 계약 기록 legacy-center'},raw.revision);
const preview=await(await call('/admin/preview?id='+raw.id)).text();
check('Anonymous project preview renders latest draft',preview.includes('검증용 사례 초안'));
check('Draft and private client note do not leak to public',!(await(await call('/work/development-center')).text()).includes('검증용 사례 초안')&&!preview.includes('내부 계약 기록'));
const faq=all.find(r=>r.id==='danwi-faq-43')!;
await saveContent(rt,faq.id,'faq',{...faq.draft,body:'검증용 사례 FAQ 초안'},faq.revision);
check('CASE FAQ previews on its case detail',(await(await call('/admin/preview?id='+faq.id)).text()).includes('검증용 사례 FAQ 초안'));
const projected=publicContentRows([{...raw,id:'future-case',published:{...raw.published,slug:'future-case',publicId:'future-case',body:'고객 링크 https://legacy-center.example.invalid/reference',mediaId:'test',mediaApprovedForPublic:false}}]);
check('Every unapproved project image omitted',!projected[0].published!.mediaId);
check('Existing published identifying URL removed',!JSON.stringify(projected).match(/legacy-center/i));
const mediaId=crypto.randomUUID();await db.query("INSERT INTO media_asset(id,original_name,mime,bytes,size,visibility) VALUES($1,'test.png','image/png',$2,3,'public')",[mediaId,new Uint8Array([1,2,3])]);
await db.query("UPDATE content SET published=jsonb_set(jsonb_set(published,'{mediaId}',to_jsonb($2::text)),'{mediaApprovedForPublic}','false') WHERE id=$1",[raw.id,mediaId]);
check('Direct unapproved image URL returns 404',(await call('/media/'+mediaId)).status===404);
await db.query("UPDATE content SET published=jsonb_set(published,'{mediaApprovedForPublic}','true') WHERE id=$1",[raw.id]);
check('Explicitly approved referenced public image available',(await call('/media/'+mediaId)).status===200);
const home=all.find(r=>r.id==='home')!;const selected=all.find(r=>r.id==='danwi-faq-01')!;
await saveContent(rt,selected.id,'faq',{...selected.draft,scope:'CASE',caseId:'development-center'},selected.revision);
let rejected=false;try{await publish(rt,selected.id,'publish',selected.revision+1,()=>{});}catch{rejected=true;}
check('Scope edit cannot invalidate selected home FAQ',rejected);
let cancelRejected=false;try{await publish(rt,selected.id,'unpublish',selected.revision+1,()=>{});}catch{cancelRejected=true;}
check('Selected home FAQ cannot be unpublished before replacement',cancelRejected);
const newProject=await saveContent(rt,'new-test-case','project',{...raw.draft,slug:'new-test-case',publicId:'',title:'새 검증 사례'});
check('Empty public ID defaults to canonical slug',(await db.query<ContentRow>('SELECT * FROM content WHERE id=$1',[newProject.id])).rows[0].draft.publicId==='new-test-case');
await seed(db);check('Repeat upgrade is idempotent',(await db.query<ContentRow>('SELECT * FROM content WHERE id=$1',['home'])).rows[0].revision===home.revision);
await saveContent(rt,'home','home',{...home.draft,seoTitle:'',seoDescription:''},home.revision);await publish(rt,'home','publish',home.revision+1,rows=>verifyRender(rows,rt.origin));
check('Blank optional SEO fields use body metadata and publish', (await call('/')).status===200&&(await(await call('/')).text()).includes('<title>아이디어를 넘어'));
await db.close();await mkdir('tests/results',{recursive:true});
await writeFile('tests/results/migration-results.json',JSON.stringify({passed:checks.length,checks,database:'Local PostgreSQL WASM engine',finishedAt:new Date().toISOString()},null,2));
console.log(checks.length+' alignment migration checks passed');
