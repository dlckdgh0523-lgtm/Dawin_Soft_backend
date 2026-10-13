import {trackingApi} from './marketing-tracking';
import {api,mediaResponse} from './api';
import {json,esc,Fault,uid,type Runtime,type ContentRow,type Db} from './types';
import {publicRows,settings,operator} from './store';
import {renderPage,sitemap,contentPath} from './render';
import {adminHtml} from './admin';
import {adminLoginPage} from './admin-login-page';
import {adminEvents} from './admin-events';
import {publicContentRows} from './public-content';
import {faqLocation,faqPage} from './faq-engine';
import {publicRate} from './faq-assistant';import {publicEditorial} from './insights-core';import {publicComments} from './insights-social';import {insightFeed} from './insights-ui';
function assertPreview(v:unknown){if(!v)throw new Fault(404,'저장 버전을 찾을 수 없습니다.');}
function htmlResponse(html:string,status=200,privateSite=true){return new Response(html,{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','X-Frame-Options':'DENY','X-Robots-Tag':privateSite?'noindex, nofollow':'all','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"}});}
export async function handle(req:Request,rt:Runtime):Promise<Response>{const id=uid();const scoped=(db:Db):Db=>({requestId:id,query:(sql,params)=>db.query(sql,params),transaction:fn=>db.transaction(tx=>fn(scoped(tx)))});const runtime={...rt,db:rt.db?scoped(rt.db):null};const response=await handleInner(req,runtime);response.headers.set('X-Request-ID',id);if(response.status>=400&&rt.identity&&runtime.db&&new URL(req.url).pathname.startsWith('/api/admin/'))try{await runtime.db.query("INSERT INTO audit_log(actor,action,target,detail,request_id,outcome) VALUES($1,'request.failed',$2,$3::jsonb,$4,'failure')",[rt.identity.id,'admin.request',JSON.stringify({status:response.status}),id]);}catch{}return response;}
async function handleInner(req:Request,rt:Runtime):Promise<Response>{const url=new URL(req.url),path=url.pathname;
 try{
  if(path==='/health'){let connected=false;if(rt.db)try{await rt.db.query('SELECT 1');connected=true;}catch{}return json({status:connected?'ready':'connection_pending',database:connected?'postgresql':'unconfigured'},connected?200:503);}
  if(path.startsWith('/media/'))return await mediaResponse(req,rt,path.slice(7));
  if(path.startsWith('/api/admin/files/'))return await mediaResponse(req,rt,path.slice(17));
  if(path.startsWith('/api/marketing/'))return (await trackingApi(req,rt))!;
  if(path==='/api/admin/events')return await adminEvents(req,rt);
  if(path.startsWith('/api/'))return await api(req,rt);
  if(path==='/admin/oauth/callback'){const {oauthCallback}=await import('./operations-oauth');return await oauthCallback(req,rt);}
  if(path==='/admin/login'&&req.method==='GET')return htmlResponse(adminLoginPage({passwordLogin:true,unconfigured:true}));
  if(path==='/admin/logout'&&req.method==='GET')return new Response(null,{status:303,headers:{Location:'/admin/login','Cache-Control':'no-store'}});
  if(path==='/admin'||path==='/admin/marketing'){
   if(!rt.identity||!rt.db)return new Response(null,{status:303,headers:{Location:'/admin/login','Cache-Control':'no-store','X-Robots-Tag':'noindex'}});
   if(rt.db)await operator(rt,'shell');return htmlResponse(adminHtml(rt.origin));
  }
  if(path==='/admin/preview'){
   await operator(rt);const row=(await rt.db!.query<ContentRow>('SELECT * FROM content WHERE id=$1 AND NOT archived',[url.searchParams.get('id')])).rows[0];if(!row)throw new Fault(404,'초안을 찾을 수 없습니다.');const requestedRevision=Number(url.searchParams.get('revision'));if(url.searchParams.has('revision')){if(!Number.isInteger(requestedRevision)||requestedRevision<1)throw new Fault(400,'미리보기 버전을 확인해 주세요.');const v=(await rt.db!.query('SELECT body FROM content_version WHERE content_id=$1 AND revision=$2',[row.id,requestedRevision])).rows[0];assertPreview(v);row.draft=v.body;}if(row.kind==='article')row.draft={...row.draft,commentsEnabled:false,reactionsEnabled:false};const preview=publicContentRows([{...row,published:row.draft}])[0]??{...row,published:row.draft};const rows=(await publicRows(rt)).filter(r=>r.id!==preview.id);rows.push(preview);if(row.kind==='settings')await operator(rt,'settings');const config=row.kind==='settings'?row.draft:await settings(rt);const result=renderPage((row.kind==='faq'&&preview.published?.scope!=='CASE'?faqLocation(rows,preview.id,config):contentPath(preview))?.split('#')[0]||'/',rows,config,rt.origin,true,false);result.html=result.html.replace('<body',`<body`).replace(/(<body[^>]*>)/,`$1<aside style="position:fixed;z-index:99;bottom:0;left:0;right:0;background:#244a88;padding:10px;text-align:center">운영자 미리보기 · 선택한 저장 버전</aside>`);return htmlResponse(result.html,result.status);
  }
  if(req.method!=='GET'&&req.method!=='HEAD')return json({error:'지원하지 않는 요청입니다.'},405);
  const rows=await publicRows(rt);const config=await settings(rt);config.editorialPublic=await publicEditorial(rt.db);if(rt.db){config.editorialPublic.tagAliases=Object.fromEntries((await rt.db.query('SELECT id,merged_into FROM editorial_tag WHERE merged_into IS NOT NULL')).rows.map(r=>[r.id,r.merged_into]));const aliases=config.editorialPublic.tagAliases;for(const id of Object.keys(aliases)){let target=aliases[id],depth=0;while(aliases[target]&&depth++<100)target=aliases[target];aliases[id]=target;}config.editorialPublic.reactions=Object.fromEntries((await rt.db.query("SELECT target_id,count(*)::int AS count FROM content_reaction WHERE target_type='article' GROUP BY target_id")).rows.map(r=>[r.target_id,r.count]));const article=rows.find(r=>r.kind==='article'&&contentPath(r)===path);if(article?.published?.commentsEnabled!==false&&article)config.editorialPublic.comments=await publicComments(rt,article.id,Number(url.searchParams.get('commentPage')??1));}
  if(path==='/work/legacy-center')return rows.some(r=>r.kind==='project'&&r.id==='development-center')?new Response(null,{status:308,headers:{Location:rt.origin+'/work/development-center','Cache-Control':'no-store'}}):htmlResponse('<!doctype html><html lang="ko"><head><title>사례 공개 종료 | 단위소프트</title></head><body><h1>공개되지 않은 사례입니다.</h1><a href="/work">작업 사례</a></body></html>',410,rt.privateSite);
  if(/^\/(?:playground|demo)(?:\/|$)/.test(path))return htmlResponse('<!doctype html><html lang="ko"><head><title>페이지 운영 종료 | 단위소프트</title></head><body><h1>운영이 종료된 페이지입니다.</h1><a href="/">단위소프트 홈</a></body></html>',410,rt.privateSite);
  if(path.startsWith('/faq/go/')){const location=faqLocation(rows,path.slice(8),config);if(!location)throw new Fault(404,'공개된 답변을 찾을 수 없습니다.');return new Response(null,{status:302,headers:{Location:rt.origin+location,'Cache-Control':'no-store','X-Robots-Tag':'noindex'}});}
  if(path==='/faq'||path.startsWith('/faq/')){const view=faqPage(rows,path,url.searchParams,config);if(view.q)await publicRate(rt,'faq-search',60);if(path+url.search!==view.canonical)return new Response(null,{status:308,headers:{Location:rt.origin+view.canonical,'Cache-Control':'no-store'}});}
  if(path==='/insights/rss.xml')return new Response(insightFeed(rt.privateSite?[]:rows,rt.origin),{headers:{'Content-Type':'application/rss+xml; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':rt.privateSite?'noindex':'all'}});
  if(path==='/sitemap.xml')return new Response(sitemap(rows,rt.origin,rt.privateSite,config),{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'no-store'}});
  if(path==='/robots.txt')return new Response(rt.privateSite?'User-agent: *\nDisallow: /\n':`User-agent: *\nDisallow: /admin\nDisallow: /api/\nSitemap: ${rt.origin}/sitemap.xml\n`,{headers:{'Content-Type':'text/plain; charset=utf-8'}});
  if(rt.db){const rule=(await rt.db.query('SELECT destination FROM redirect_rule WHERE path=$1',[path])).rows[0];if(rule)return new Response(null,{status:308,headers:{Location:rt.origin+rule.destination,'Cache-Control':'no-store'}});}
  const result=renderPage(path,rows,config,rt.origin,rt.privateSite,!!rt.db,url.searchParams);const response=htmlResponse(req.method==='HEAD'?'':result.html.replace('</body>','<script src="/measurement.js" defer></script></body>'),result.status,rt.privateSite);if((url.searchParams.has('q')||url.searchParams.has('sort'))&&!rt.privateSite)response.headers.set('X-Robots-Tag','noindex, follow');return response;
 }catch(e){const known=e instanceof Fault;return path.startsWith('/api/')?json({ok:false,error:known?e.message:'저장소 연결 또는 처리 중 오류가 발생했습니다. 완료되지 않았습니다.'},known?e.status:503):htmlResponse(`<!doctype html><html lang="ko"><head><title>처리 확인 | 단위소프트</title><meta name="robots" content="noindex"></head><body><h1>${esc(known?e.message:'연결을 확인하고 있습니다.')}</h1><p>잠시 후 다시 확인해 주세요.</p><a href="/">홈으로 돌아가기</a></body></html>`,known?e.status:503);}
}

