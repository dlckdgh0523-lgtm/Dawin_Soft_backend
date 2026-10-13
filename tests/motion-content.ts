import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {devDatabase} from '../src/pglite-dev';
import {seed,publicRows} from '../src/store';
import {renderPage,paths} from '../src/render-aligned';
import previous from '../src/seed-baseline-v3.json';
import type {ContentRow,Runtime} from '../src/types';
const db=await devDatabase('work/motion-content-'+Date.now());
const rt:Runtime={db,identity:null,origin:'http://127.0.0.1:5195',privateSite:false,clientKey:'motion-migration'};
const checks:string[]=[];const check=(name:string,ok:unknown)=>{assert(ok,name);checks.push(name);};
for(const id of ['home','website-development','danwi-faq-62','danwi-faq-53']){
 const old=previous.find(s=>s.id===id)!;
 await db.query('DELETE FROM content_version WHERE content_id=$1',[id]);
 await db.query('UPDATE content SET draft=$2::jsonb,published=$2::jsonb,revision=3,published_revision=3 WHERE id=$1',[id,JSON.stringify(old.body)]);
 await db.query('INSERT INTO content_version(content_id,revision,body,actor) VALUES($1,3,$2::jsonb,$3)',[id,JSON.stringify(old.body),id==='danwi-faq-53'?'operator-test':'content-expansion-v3']);
}
await seed(db);
for(const id of ['home','website-development','danwi-faq-62']){
 const row=(await db.query<ContentRow>('SELECT * FROM content WHERE id=$1',[id])).rows[0];
 check('Exact v3 default upgrades with retained history '+id,row.revision===4&&(await db.query('SELECT revision FROM content_version WHERE content_id=$1',[id])).rows.length===2);
}
check('Operator-saved revision is not overwritten',(await db.query<ContentRow>("SELECT * FROM content WHERE id='danwi-faq-53'")).rows[0].revision===3);
// Restore the test-only edited record to the new default before auditing every page.
const fresh=await import('../src/seeds');const body=fresh.seedData.find(s=>s.id==='danwi-faq-53')!.body;
await db.query("UPDATE content SET published=$1::jsonb WHERE id='danwi-faq-53'",[JSON.stringify(body)]);
const rows=await publicRows(rt);
const forbidden=/TypeScript|React|Next\.js|Node\.js|PostgreSQL|MySQL|NestJS|FastAPI|Python|Flutter|n8n|Vercel|Cloudflare|Anthropic|카페24|RAG|US\$7|7달러|월\s*\$7|id="technology"/i;
for(const path of paths(rows)){
 const result=renderPage(path,rows,{},rt.origin,false,false);
 // The Insights category label is intentional; keep checking all other public markup.
 const presentationHtml=result.html.replace(/(<a href="\/insights\/categories\/ai-automation"[^>]*>)AI·RAG·자동화(<\/a>)/g,'$1AI·자동화$2');
 check('Public page omits stack and fixed dollar price '+path,!forbidden.test(presentationHtml));
}
check('Public DTO omits stack catalogue',rows.filter(r=>r.kind==='service').every(r=>!('technologies' in r.published!)));
check('Public case DTO omits technology field',rows.filter(r=>r.kind==='project').every(r=>!('technology' in r.published!)));
await seed(db);check('v3 migration idempotent',(await db.query<ContentRow>("SELECT * FROM content WHERE id='home'")).rows[0].revision===4);
await db.close();await mkdir('tests/results',{recursive:true});await writeFile('tests/results/public-content-results.json',JSON.stringify({passed:checks.length,checks,finishedAt:new Date().toISOString()},null,2));console.log(checks.length+' public-content and v3 migration checks passed');
