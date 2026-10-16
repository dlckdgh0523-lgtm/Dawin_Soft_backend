import {z} from 'zod';
import {assert,Fault,uid,type Db,type Data,type Runtime,type ContentRow} from './types';
import {operator,audit} from './store';
import {publicContentRows} from './public-content';
import {digest} from './security';

const text=(max=10000)=>z.string().max(max).refine(v=>!v.includes('\0'));
const id=text(100).regex(/^[a-z0-9][a-z0-9-]*$/);
const evidenceIds=z.array(text(100)).max(12).default([]);
export const blockSchema=z.discriminatedUnion('type',[
 z.object({id:text(100),type:z.literal('paragraph'),text:text(12000),evidenceIds}),
 z.object({id:text(100),type:z.literal('heading'),text:text(300),level:z.union([z.literal(2),z.literal(3)])}),
 z.object({id:text(100),type:z.literal('list'),items:z.array(text(3000)).max(40),ordered:z.boolean().default(false),evidenceIds}),
 z.object({id:text(100),type:z.literal('quote'),text:text(3000),evidenceIds}),
 z.object({id:text(100),type:z.literal('code'),text:text(20000),language:text(40)}),
 z.object({id:text(100),type:z.literal('table'),headers:z.array(text(300)).max(12),rows:z.array(z.array(text(1000)).max(12)).max(80),caption:text(300).default('')}),
 z.object({id:text(100),type:z.literal('image'),mediaId:text(100),alt:text(500).min(1),caption:text(500).default('')})
]);
const sourceSchema=z.object({sourceId:text(100).default(''),evidenceId:text(100).default(''),title:text(500),url:text(1000).url().refine(s=>{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password;}),accessedAt:text(40).default('')});
export const articleSchema=z.object({slug:id,title:text(300).min(1),description:text(1000).default(''),body:text(60000).default(''),bodyBlocks:z.array(blockSchema).max(100).default([]),author:text(100).min(1),authorType:z.enum(['Organization','Person']).default('Organization'),writingMode:z.enum(['manual','ai_assisted']).default('manual'),articleType:z.enum(['news','guide','comparison']).default('guide'),audience:text(500).default(''),categoryId:id.default('website-cms'),tagIds:z.array(id).max(20).default([]),serviceIds:z.array(id).max(2).default([]),caseIds:z.array(id).max(2).default([]),sources:z.array(sourceSchema).max(30).default([]),mediaId:text(100).default(''),imageAlt:text(500).default(''),indexable:z.boolean().default(true),seoTitle:text(300).default(''),seoDescription:text(1000).default(''),commentsEnabled:z.boolean().default(true),reactionsEnabled:z.boolean().default(true),tocEnabled:z.boolean().default(false),faqKnowledgeApproved:z.boolean().default(false)});
export function validateArticle(raw:Data){
 const compatible={...raw,sources:(raw.sources??[]).map((s:any)=>typeof s==='string'?{title:s,url:s}:s)};
 let body:Data;try{body=articleSchema.parse(compatible);}catch{throw new Fault(400,'글의 제목·주소·본문·분류·출처 형식을 확인해 주세요.');}
 if(!body.bodyBlocks.length&&body.body)body.bodyBlocks=body.body.split(/\n\s*\n/).map((v:string,i:number)=>({id:'p-'+i,type:'paragraph',text:v,evidenceIds:[]}));
 body.body=body.bodyBlocks.map((b:Data)=>b.text??b.items?.join('\n')??b.rows?.map((r:string[])=>r.join(' | ')).join('\n')??b.alt??'').join('\n\n');
 assert(new Set(body.bodyBlocks.map((b:Data)=>b.id)).size===body.bodyBlocks.length,'본문 블록 ID가 중복되었습니다.');
 assert(body.body.length<=60000,'본문은 60,000자 이하로 저장해 주세요.');
 return body;
}
export const editorialCategories=[['website-cms','홈페이지·CMS'],['business-systems','업무 시스템'],['ai-automation','AI·RAG·자동화'],['seo-geo','SEO·GEO'],['deployment-operations','배포·운영'],['work-record','작업 기록']];
export const defaultEditorialConfig={enabled:false,paused:true,mode:'MANUAL',collectEnabled:false,aiEnabled:false,scheduleEnabled:false,newsEnabled:false,newsFeeds:[] as string[],allowedHosts:[],sourcesApproved:false,privacyApproved:false,model:'',modelVerifiedAt:'',modelMaxInputTokens:0,modelMaxOutputTokens:0,inputLimit:12000,outputLimit:3000,dailyDraftLimit:2,collectionHour:9,weeklySlots:[{day:1,hour:10},{day:3,hour:10},{day:5,hour:10}],currency:'USD',dailyBudget:0,monthlyBudget:0,globalMonthlyBudget:0,priceInputPerMillion:0,priceOutputPerMillion:0,pricingUrl:'',pricingVerifiedAt:'',pricingConfirmed:false,maxRequestsPerDay:12,sourceRetentionDays:30};
const candidateSeeds=[
 ['카페24 주문 정보를 사내 업무와 연결하기 전에','주문 상태와 내부 처리 규칙을 어떻게 맞출까요?','커머스 운영 담당자','admin-systems','카페24 공식 API·권한·호출 제한과 고객의 업무 규칙'],
 ['운영자가 직접 수정할 CMS 범위 정하기','화면 전체와 콘텐츠 수정은 어떻게 다른가요?','홈페이지 운영자','website-development','CMS 수정 항목과 권한·검수 범위'],
 ['서비스 운영비를 확인할 때 나눠 볼 항목','DB·파일·AI·알림 비용을 어떻게 확인할까요?','서비스 의뢰자','website-development','현재 공식 요금표·이용량 조건·확인일'],
 ['엑셀 업무를 자동화하기 전 확인할 규칙','중복 자료와 예외를 어떻게 처리할까요?','업무 담당자','admin-systems','실제 파일 구조를 익명화한 규칙·예외 사례'],
 ['n8n과 맞춤 개발을 선택하는 기준','연결 도구와 별도 시스템 중 무엇이 맞을까요?','업무 자동화 의뢰자','ai-automation','공식 기능·라이선스·운영 조건'],
 ['회사 문서 검색에 필요한 권한과 삭제 기준','RAG가 누구의 문서까지 읽어도 될까요?','사내 자료 관리자','ai-automation','권한 모델·삭제·색인 갱신 조건'],
 ['문서 요약과 실제 업무 실행의 차이','요약 결과를 바로 후속 처리해도 될까요?','AI 도입 담당자','ai-automation','승인·실패·재처리 조건'],
 ['CMS와 공개 페이지를 함께 설계하기','관리자 수정이 공개 페이지에 어떻게 반영되나요?','사이트 운영자','website-development','렌더링·공개 승인·캐시 구조'],
 ['생산 업무를 시스템으로 옮기기 전 상담할 자료','보고와 재고 규칙을 어떻게 확인할까요?','생산 업무 담당자','admin-systems','현장 관찰 또는 대화로 확인한 익명 업무 규칙'],
 ['FAQ가 많아졌을 때 분류와 검색을 설계하기','질문을 한 화면에 모두 보여줘야 할까요?','콘텐츠 운영자','website-development','분류·검색·페이지네이션의 실제 확인 자료'],
 ['새 AI 모델을 서비스에 도입하기 전','모델 발표에서 적용 결정까지 무엇을 확인하나요?','AI 운영 담당자','ai-automation','공식 모델 문서·요금·지원 기능·시험 조건'],
 ['경기권 발달센터의 CMS와 검색 구조 기록','공개 가능한 담당 범위를 어떻게 설명할까요?','홈페이지 의뢰자','seo-geo','공개 승인된 사례 DTO와 구현 범위만 사용']
];
export async function seedEditorial(db:Db){await db.transaction(async tx=>{
 for(const [slug,name]of editorialCategories)await tx.query('INSERT INTO editorial_category(id,slug,name) VALUES($1,$1,$2) ON CONFLICT DO NOTHING',[slug,name]);
 await tx.query("INSERT INTO editorial_config(id,body) VALUES('editorial',$1::jsonb) ON CONFLICT DO NOTHING",[JSON.stringify(defaultEditorialConfig)]);
 for(const [i,c]of candidateSeeds.entries())await tx.query("INSERT INTO topic_candidate(id,title,question,audience,service_ids,required_evidence) VALUES($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT DO NOTHING",['initial-topic-'+(i+1),c[0],c[1],c[2],JSON.stringify([c[3]]),c[4]]);
});}
export async function editorialConfig(db:Db){return{...defaultEditorialConfig,...(await db.query("SELECT body FROM editorial_config WHERE id='editorial'")).rows[0]?.body};}
export async function articleRecord(db:Db,id:string,lock=false){const row=(await db.query<ContentRow>('SELECT * FROM content WHERE id=$1 AND kind=\'article\''+(lock?' FOR UPDATE':''),[id])).rows[0];assert(row,'글을 찾을 수 없습니다.',404);return row;}
export async function articleState(db:Db,id:string){return(await db.query('SELECT * FROM article_state WHERE content_id=$1',[id])).rows[0];}
export async function saveArticle(rt:Runtime,id:string,raw:Data,expected?:number){const user=await operator(rt);assert(/^[a-z0-9-]{1,100}$/.test(id),'글 ID를 확인해 주세요.');const body=validateArticle(raw);return rt.db!.transaction(async tx=>{await tx.query('SELECT pg_advisory_xact_lock(7435802)');
 const prev=(await tx.query<ContentRow>('SELECT * FROM content WHERE id=$1 FOR UPDATE',[id])).rows[0];assert(!prev||prev.kind==='article','콘텐츠 종류를 바꿀 수 없습니다.');assert(!prev||prev.revision===expected,'다른 편집이 먼저 저장되었습니다. 입력은 유지하고 최신 버전과 비교해 주세요.',409);
 const cat=(await tx.query('SELECT id FROM editorial_category WHERE id=$1',[body.categoryId])).rows[0];assert(cat,'분류를 선택해 주세요.');
 for(const tag of body.tagIds)assert((await tx.query('SELECT id FROM editorial_tag WHERE id=$1 AND merged_into IS NULL',[tag])).rows.length,'현재 태그를 선택해 주세요.');
 const revision=(prev?.revision??0)+1;const nextState=prev?.archived?((await articleState(tx,id))?.state==='TRASH'?'TRASH':'ARCHIVED'):'DRAFT';
 if(prev)await tx.query('UPDATE content SET draft=$2::jsonb,revision=$3,updated_at=now() WHERE id=$1',[id,JSON.stringify(body),revision]);else await tx.query("INSERT INTO content(id,kind,draft,revision) VALUES($1,'article',$2::jsonb,$3)",[id,JSON.stringify(body),revision]);
 await tx.query('INSERT INTO content_version(content_id,revision,body,actor) VALUES($1,$2,$3::jsonb,$4)',[id,revision,JSON.stringify(body),user.user_id]);
 await tx.query("INSERT INTO article_state(content_id,state) VALUES($1,$2) ON CONFLICT(content_id) DO UPDATE SET state=$2,approved_revision=NULL,approved_by=NULL,approved_at=NULL,review_reason=''",[id,nextState]);
 await tx.query("UPDATE publish_job SET status='cancelled',error='새 버전 저장으로 승인·예약 해제',finished_at=now() WHERE content_id=$1 AND status IN ('queued','retry','running') AND db_committed_at IS NULL",[id]);
 await tx.query('DELETE FROM content_tag WHERE content_id=$1',[id]);for(const t of body.tagIds)await tx.query('INSERT INTO content_tag VALUES($1,$2) ON CONFLICT DO NOTHING',[id,t]);
 await audit(tx,user.user_id,'article.save',id,{revision});return{ok:true,id,revision,state:nextState,approvalInvalidated:!!prev};
});}
export function articleWarnings(body:Data){const all=JSON.stringify(body);const warnings:string[]=[];
 if(/비공개고객|legacy-center|아동.{0,8}(이름|진료|상담)|환자.{0,8}(성명|자료)/i.test(all))warnings.push('고객 식별·임상 자료가 포함되었는지 확인하세요.');
 if(/직접.{0,12}(테스트|방문|납품)|실측|납품했습니다|방문했습니다/.test(all))warnings.push('직접 수행 경험의 공개 가능한 근거를 확인하세요.');
 if(/\$\s*\d|\d+(?:\.\d+)?\s*(달러|원|%|배)|보장|상시 상담|24시간/.test(all))warnings.push('수치·요금·효과·회사 정책의 조건과 최신 출처를 확인하세요.');
 if(body.authorType==='Person')warnings.push('실제 작성자의 공개 동의와 표시 이름을 확인하세요.');
 return warnings;
}
export async function validatePublicArticle(db:Db,body:Data){assert(body.body.trim()&&body.description.trim(),'요약과 본문을 작성해 주세요.');
 assert(!/비공개고객|legacy-center/i.test(JSON.stringify(body)),'고객 식별 이름과 주소를 공개할 수 없습니다. 경기권 발달센터로 정리해 주세요.');
 assert((await db.query('SELECT 1 FROM editorial_category WHERE id=$1 AND visible',[body.categoryId])).rows.length,'공개 분류를 선택해 주세요.');
 for(const s of body.serviceIds)assert((await db.query("SELECT 1 FROM content WHERE id=$1 AND kind='service' AND published IS NOT NULL AND NOT archived",[s])).rows.length,'관련 서비스는 공개된 항목만 연결할 수 있습니다.');
 const publicCases=publicContentRows((await db.query<ContentRow>("SELECT * FROM content WHERE kind='project' AND published IS NOT NULL AND NOT archived")).rows);for(const c of body.caseIds)assert(publicCases.some(r=>r.id===c),'관련 사례는 공개 승인된 항목만 연결할 수 있습니다.');
 const media=[body.mediaId,...body.bodyBlocks.filter((b:Data)=>b.type==='image').map((b:Data)=>b.mediaId)].filter(Boolean);
 for(const m of media)assert((await db.query("SELECT 1 FROM media_asset WHERE id=$1 AND visibility='public' AND inquiry_id IS NULL AND length(alt)>0",[m])).rows.length,'공개 승인 이미지와 대체 텍스트가 필요합니다.');
 if(body.mediaId)assert(body.imageAlt.trim(),'대표 이미지 대체 텍스트를 입력해 주세요.');
 const used=[...new Set(body.bodyBlocks.flatMap((b:Data)=>b.evidenceIds??[]))];
 for(const eid of used){const s=body.sources.find((s:Data)=>s.evidenceId===eid);assert(s,'본문 근거가 참고자료에 연결되지 않았습니다.');}
 for(const s of body.sources){if(!s.evidenceId){assert(body.writingMode==='manual','AI 초안에는 확인된 근거 구간이 필요합니다.');continue;}
  const ev=(await db.query('SELECT e.*,d.excerpt,d.body_hash,d.expires_at,s.approved,s.status AS source_status,s.body_hash AS current_hash,s.final_url FROM editorial_evidence e JOIN source_document d ON d.id=e.document_id JOIN editorial_source s ON s.id=e.source_id WHERE e.id=$1',[s.evidenceId])).rows[0];
  assert(ev&&ev.source_id===s.sourceId&&ev.approved&&ev.status==='VERIFIED'&&ev.source_status==='BODY_ACQUIRED'&&ev.current_hash===ev.body_hash&&ev.final_url===s.url&&new Date(ev.expires_at)>new Date()&&ev.excerpt.slice(ev.start_offset,ev.end_offset)===ev.quote,'출처가 변경되었거나 확인되지 않았습니다. 근거를 재확인해 주세요.');
 }
 if(body.writingMode==='ai_assisted')assert(body.sources.some((s:Data)=>s.evidenceId),'AI 글은 확인된 출처 근거가 필요합니다.');
}
export async function articleAction(rt:Runtime,id:string,action:string,raw:Data={}){const user=await operator(rt,['request-review','restore-version'].includes(action)?'content':'publish');const db=rt.db!;
 if(action==='restore-version'){const v=(await db.query('SELECT body FROM content_version WHERE content_id=$1 AND revision=$2',[id,raw.restoreRevision])).rows[0];assert(v,'복원할 버전이 없습니다.',404);return saveArticle(rt,id,v.body,raw.revision);}
 return db.transaction(async tx=>{await tx.query('SELECT pg_advisory_xact_lock(7435802)');const row=await articleRecord(tx,id,true),state=await articleState(tx,id);assert(row.revision===raw.revision,'글 버전이 변경되었습니다.',409);
  if(action==='request-review'){assert(!row.archived,'복원 후 검토 요청해 주세요.');await tx.query("UPDATE article_state SET state='NEEDS_REVIEW',review_reason=$2 WHERE content_id=$1",[id,String(raw.reason??'').slice(0,2000)]);}
  else if(action==='approve'){assert(state?.state==='NEEDS_REVIEW','검토 요청한 버전만 승인할 수 있습니다.');await validatePublicArticle(tx,row.draft);const warnings=articleWarnings(row.draft);assert(raw.factChecked===true&&raw.privacyChecked===true&&raw.experienceChecked===true,'사실·개인정보·수행 경험을 확인한 뒤 승인해 주세요.');assert(!warnings.length||String(raw.reason??'').trim(),'주의 항목의 검토 사유를 남겨 주세요.');const reviewId=uid();await tx.query('INSERT INTO editorial_review(id,content_id,revision,actor,decision,reason) VALUES($1,$2,$3,$4,\'APPROVED\',$5)',[reviewId,id,row.revision,user.user_id,String(raw.reason??'').slice(0,2000)]);await tx.query("UPDATE article_state SET state='APPROVED',approved_revision=$2,approved_by=$3,approved_at=now(),review_reason=$4 WHERE content_id=$1",[id,row.revision,user.user_id,String(raw.reason??'').slice(0,2000)]);}
  else if(['reject','cancel-approval','cancel-schedule'].includes(action)){await tx.query("UPDATE article_state SET state='DRAFT',approved_revision=NULL,approved_by=NULL,approved_at=NULL,review_reason=$2 WHERE content_id=$1",[id,String(raw.reason??'').slice(0,2000)]);await tx.query("UPDATE publish_job SET status='cancelled',finished_at=now(),error='운영자 취소' WHERE content_id=$1 AND status IN ('queued','retry','running') AND db_committed_at IS NULL",[id]);await tx.query('INSERT INTO editorial_review(id,content_id,revision,actor,decision,reason) VALUES($1,$2,$3,$4,$5,$6)',[uid(),id,row.revision,user.user_id,action,String(raw.reason??'').slice(0,2000)]);}
  else if(['unpublish','archive','trash'].includes(action)){await tx.query('UPDATE content SET published=NULL,published_revision=NULL,archived=$2 WHERE id=$1',[id,action!=='unpublish']);await tx.query("UPDATE article_state SET state=$2,approved_revision=NULL,approved_by=NULL,approved_at=NULL,reflection_status='not_published' WHERE content_id=$1",[id,action==='trash'?'TRASH':action==='archive'?'ARCHIVED':'DRAFT']);await tx.query("UPDATE publish_job SET status='cancelled',finished_at=now() WHERE content_id=$1 AND status IN ('queued','retry','running')",[id]);await tx.query("UPDATE editorial_cache_epoch SET revision=revision+1,updated_at=now() WHERE id='public'");}
  else if(action==='restore'){assert(['TRASH','ARCHIVED'].includes(state.state),'보관된 글만 복원할 수 있습니다.');await tx.query('UPDATE content SET archived=false WHERE id=$1',[id]);await tx.query("UPDATE article_state SET state='DRAFT' WHERE content_id=$1",[id]);}
  else if(action==='delete'){assert(state.state==='TRASH'&&raw.confirm===id,'휴지통 글의 ID를 확인한 뒤 영구 삭제해 주세요.');await tx.query('DELETE FROM content_reaction WHERE target_id=$1 OR target_id IN(SELECT id FROM article_comment WHERE content_id=$1)',[id]);await tx.query('DELETE FROM article_comment WHERE parent_id IS NOT NULL AND content_id=$1',[id]);await tx.query('DELETE FROM publish_job WHERE content_id=$1',[id]);await tx.query('UPDATE generation_job SET base_content_id=NULL WHERE base_content_id=$1',[id]);await tx.query('UPDATE topic_candidate SET content_id=NULL WHERE content_id=$1',[id]);await tx.query('DELETE FROM article_state WHERE content_id=$1',[id]);await tx.query('DELETE FROM editorial_review WHERE content_id=$1',[id]);await tx.query('DELETE FROM content_version WHERE content_id=$1',[id]);await tx.query('DELETE FROM content WHERE id=$1',[id]);}
  else if(['publish','schedule'].includes(action)){const config=await editorialConfig(tx);assert(!config.paused,'글 운영이 일시 중지되어 있습니다. 설정에서 중지를 해제해 주세요.',409);assert(state.approved_revision===row.revision&&['APPROVED','SCHEDULED'].includes(state.state),'현재 버전의 운영자 승인이 필요합니다.',409);await validatePublicArticle(tx,row.draft);
   let scheduled=new Date();if(action==='schedule'){assert(config.scheduleEnabled,'예약 발행을 활성화해 주세요.');assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw.seoulTime??''),'한국 시간의 예약 날짜와 시각이 필요합니다.');scheduled=new Date(raw.seoulTime+':00+09:00');assert(Number.isFinite(+scheduled)&&+scheduled>Date.now()+60000,'예약은 1분 이후로 설정해 주세요.');}
   const review=(await tx.query("SELECT id,actor FROM editorial_review WHERE content_id=$1 AND revision=$2 AND decision='APPROVED' ORDER BY created_at DESC LIMIT 1",[id,row.revision])).rows[0];assert(review,'승인 기록이 없습니다.');
   const key=id+':'+row.revision+':'+review.id+':'+(action==='publish'?'immediate':scheduled.toISOString());const existing=(await tx.query('SELECT * FROM publish_job WHERE idempotency_key=$1 FOR UPDATE',[key])).rows[0];
   if(existing){assert(['queued','retry','running'].includes(existing.status),'종료된 작업은 작업 이력을 확인하고 다시 검토·승인해 주세요.',409);return{ok:true,jobId:existing.id,scheduledAt:existing.scheduled_at,state:'SCHEDULED'};}
   await tx.query("UPDATE publish_job SET status='cancelled',finished_at=now(),lease_token=NULL,lease_until=NULL WHERE content_id=$1 AND status IN ('queued','retry','running') AND db_committed_at IS NULL",[id]);const job=uid();await tx.query("INSERT INTO publish_job(id,content_id,action,status,revision,actor,scheduled_at,next_attempt_at,idempotency_key,review_id) VALUES($1,$2,'publish','queued',$3,$4,$5,$5,$6,$7)",[job,id,row.revision,review.actor,scheduled.toISOString(),key,review.id]);await tx.query("UPDATE article_state SET state='SCHEDULED' WHERE content_id=$1",[id]);await audit(tx,user.user_id,'article.'+action,id,{revision:row.revision,jobId:job});return{ok:true,jobId:job,scheduledAt:scheduled.toISOString(),state:'SCHEDULED'};
  }else throw new Fault(400,'글 작업을 확인해 주세요.');
  await audit(tx,user.user_id,'article.'+action,id,{revision:row.revision});return{ok:true};
 });
}
export async function publicEditorial(db:Db|null){if(!db)return{categories:editorialCategories.map(([id,name])=>({id,slug:id,name,visible:true})),tags:[]};return{categories:(await db.query('SELECT id,slug,name,description FROM editorial_category WHERE visible ORDER BY name')).rows,tags:(await db.query('SELECT id,slug,name,description FROM editorial_tag WHERE visible AND merged_into IS NULL ORDER BY name')).rows};}
export async function taxonomyAction(rt:Runtime,raw:Data){const user=await operator(rt,'settings'),db=rt.db!;assert(['category','tag'].includes(raw.kind),'분류를 확인해 주세요.');const table=raw.kind==='tag'?'editorial_tag':'editorial_category';return db.transaction(async tx=>{await tx.query('SELECT pg_advisory_xact_lock(7435802)');
 assert(/^[a-z0-9-]{1,100}$/.test(raw.id),'분류 ID를 확인해 주세요.');
 if(raw.action==='merge'){assert(table==='editorial_tag'&&raw.id!==raw.target,'태그 병합 대상을 확인해 주세요.');const target=(await tx.query('SELECT * FROM editorial_tag WHERE id=$1 AND merged_into IS NULL FOR UPDATE',[raw.target])).rows[0],old=(await tx.query('SELECT * FROM editorial_tag WHERE id=$1 AND merged_into IS NULL FOR UPDATE',[raw.id])).rows[0];assert(target&&old,'현재 태그를 선택해 주세요.');
  await tx.query('INSERT INTO content_tag(content_id,tag_id) SELECT content_id,$2 FROM content_tag WHERE tag_id=$1 ON CONFLICT DO NOTHING',[raw.id,raw.target]);await tx.query('DELETE FROM content_tag WHERE tag_id=$1',[raw.id]);
  const rows=(await tx.query<ContentRow>("SELECT * FROM content WHERE kind='article' FOR UPDATE")).rows;for(const row of rows){const replace=(b:Data|null)=>b?{...b,tagIds:[...new Set((b.tagIds??[]).map((t:string)=>t===raw.id?raw.target:t))]}:null;if((row.draft.tagIds??[]).includes(raw.id)){const next=replace(row.draft);await tx.query('UPDATE content SET draft=$2::jsonb,revision=revision+1,updated_at=now() WHERE id=$1',[row.id,JSON.stringify(next)]);await tx.query('INSERT INTO content_version(content_id,revision,body,actor) VALUES($1,$2,$3::jsonb,$4)',[row.id,row.revision+1,JSON.stringify(next),user.user_id]);await tx.query("UPDATE article_state SET state='DRAFT',approved_revision=NULL,approved_by=NULL,approved_at=NULL WHERE content_id=$1",[row.id]);await tx.query("UPDATE publish_job SET status='cancelled',error='태그 병합으로 새 버전 검토 필요',finished_at=now() WHERE content_id=$1 AND status IN('queued','retry','running') AND db_committed_at IS NULL",[row.id]);}}
  await tx.query('UPDATE editorial_tag SET merged_into=$2,visible=false WHERE id=$1',[raw.id,raw.target]);await tx.query('INSERT INTO redirect_rule(path,destination) VALUES($1,$2) ON CONFLICT(path) DO UPDATE SET destination=EXCLUDED.destination',['/tags/'+old.slug,'/tags/'+target.slug]);
 }else if(raw.action==='delete'){const used=(await tx.query(table==='editorial_tag'?"SELECT 1 FROM content WHERE draft->'tagIds' @> $2::jsonb OR published->'tagIds' @> $2::jsonb UNION ALL SELECT 1 FROM content_tag WHERE tag_id=$1 UNION ALL SELECT 1 FROM editorial_tag WHERE merged_into=$1 LIMIT 1":"SELECT 1 FROM content WHERE kind='article' AND (draft->>'categoryId'=$1 OR published->>'categoryId'=$1) LIMIT 1",table==='editorial_tag'?[raw.id,JSON.stringify([raw.id])]:[raw.id])).rows;assert(!used.length,'연결된 글이 있는 항목은 삭제할 수 없습니다.');await tx.query(`DELETE FROM ${table} WHERE id=$1`,[raw.id]);}
 else{assert(/^[a-z0-9][a-z0-9-]{0,99}$/.test(raw.slug)&&typeof raw.name==='string'&&raw.name.trim()&&raw.name.length<=100,'이름과 주소를 확인해 주세요.');const old=(await tx.query(`SELECT slug FROM ${table} WHERE id=$1`,[raw.id])).rows[0];await tx.query(`INSERT INTO ${table}(id,slug,name,description,visible) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET slug=$2,name=$3,description=$4,visible=$5`,[raw.id,raw.slug,raw.name,String(raw.description??'').slice(0,1000),raw.visible!==false]);if(old&&old.slug!==raw.slug)await tx.query('INSERT INTO redirect_rule(path,destination) VALUES($1,$2) ON CONFLICT(path) DO UPDATE SET destination=EXCLUDED.destination',[(table==='editorial_tag'?'/tags/':'/insights/categories/')+old.slug,(table==='editorial_tag'?'/tags/':'/insights/categories/')+raw.slug]);}
 await tx.query("UPDATE editorial_cache_epoch SET revision=revision+1,updated_at=now() WHERE id='public'");await audit(tx,user.user_id,'taxonomy.'+(raw.action??'save'),raw.id);return{ok:true};
 });}
export async function sourceFingerprint(text:string){return digest(new TextEncoder().encode(text));}
export function publicArticleRows(rows:ContentRow[]){return publicContentRows(rows).filter(r=>r.kind==='article').sort((a,b)=>+new Date(b.first_published_at??b.published_at!) - +new Date(a.first_published_at??a.published_at!));}
