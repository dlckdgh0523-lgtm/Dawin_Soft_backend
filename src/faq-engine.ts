import {Fault,type ContentRow,type Data} from './types';

export const FAQ_GROUPS=[
 {id:'website-cms',title:'홈페이지·웹앱·CMS',serviceId:'website-development'},
 {id:'business-systems',title:'관리자·업무 시스템',serviceId:'admin-systems'},
 {id:'ai-automation',title:'AI·업무 자동화',serviceId:'ai-automation'},
 {id:'seo-geo',title:'SEO·GEO',serviceId:'seo-geo'},
 {id:'deployment-cost',title:'배포·운영비',serviceId:''},
 {id:'consultation-support',title:'상담·수정·보수',serviceId:''}
] as const;
export const FAQ_DEFAULTS={home:4,service:4,page:6};
export function faqLimits(config:Data={}){return {home:Number(config.faqHomeLimit??4),service:Number(config.faqServiceLimit??4),page:Number(config.faqPageSize??6)};}
export function normalizeQuery(value:unknown){return String(value??'').normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g,' ');}
const aliases:[string[],string[]][]=[
 [['기존 홈페이지','현재 사이트','리뉴얼'],['기존','홈페이지','개선']],
 [['서버비','서버 비용','호스팅','운영비'],['운영비','비용']],
 [['사내 문서','회사 문서','지식 검색'],['회사','문서','검색']],
 [['자료 정리','자료 취합'],['자료','정리','취합']],
 [['수정','유지보수','버그'],['수정','보수','버그']]
];
export function faqGroup(body:Data){if(FAQ_GROUPS.some(g=>g.id===body.primaryGroup))return body.primaryGroup;const sid=body.relatedServiceSlugs?.[0];return FAQ_GROUPS.find(g=>g.serviceId&&g.serviceId===sid)?.id??(body.key==='danwi-faq-48'?'deployment-cost':'consultation-support');}
export function publicFaqs(rows:ContentRow[]){return [...new Map(rows.filter(r=>r.kind==='faq'&&r.published&&!r.archived&&r.published.scope!=='CASE'&&!r.published.mergedInto).map(r=>[r.id,r])).values()];}
export function faqCompare(a:ContentRow,b:ContentRow){return Number(a.published!.displayOrder??a.published!.sortOrder??0)-Number(b.published!.displayOrder??b.published!.sortOrder??0)||a.id.localeCompare(b.id);}
export function matchesGroup(row:ContentRow,group:string){const b=row.published!,g=FAQ_GROUPS.find(g=>g.id===group);return !group||faqGroup(b)===group||!!(g?.serviceId&&(b.relatedServiceSlugs??[]).includes(g.serviceId));}
function rank(row:ContentRow,q:string){if(!q)return 0;const b=row.published!,title=normalizeQuery(b.question),synonyms=(b.synonyms??[]).map(normalizeQuery),body=normalizeQuery(b.body??b.answer),topic=normalizeQuery(FAQ_GROUPS.find(g=>g.id===faqGroup(b))?.title);const terms=[q,...aliases.filter(([a])=>a.some(s=>normalizeQuery(s)===q)).flatMap(([,terms])=>terms)];let score=-1;for(const term of terms){if(title===term)score=Math.max(score,100);else if(title.includes(term))score=Math.max(score,80);if(synonyms.some((s:string)=>s===term))score=Math.max(score,70);else if(synonyms.some((s:string)=>s.includes(term)))score=Math.max(score,60);if(body.includes(term))score=Math.max(score,40);if(topic.includes(term))score=Math.max(score,20);}return score;}
export function findFaqs(rows:ContentRow[],group='',q=''){const normalized=normalizeQuery(q);return publicFaqs(rows).filter(r=>matchesGroup(r,group)).map(row=>({row,score:rank(row,normalized)})).filter(r=>!normalized||r.score>=0).sort((a,b)=>b.score-a.score||faqCompare(a.row,b.row)).map(r=>r.row);}
export function faqUrl(group='',page=1,q=''){const params=new URLSearchParams();if(q)params.set('q',q);if(page>1)params.set('page',String(page));return '/faq'+(group?'/'+group:'')+(params.size?'?'+params:'');}
export function faqPage(rows:ContentRow[],path:string,search:URLSearchParams=new URLSearchParams(),config:Data={}){
 const group=path==='/faq'?'':path.slice(5);if(group&&!FAQ_GROUPS.some(g=>g.id===group))throw new Fault(404,'FAQ 분류를 찾을 수 없습니다.');
 const raw=search.get('page');if(raw!==null&&!/^[1-9]\d{0,5}$/.test(raw))throw new Fault(404,'FAQ 페이지를 찾을 수 없습니다.');
 if(search.getAll('page').length>1||search.getAll('q').length>1)throw new Fault(400,'검색 조건을 확인해 주세요.');
 const q=(search.get('q')??'').trim();if(q.length>120)throw new Fault(400,'질문 검색은 120자 이내로 입력해 주세요.');
 const page=Number(raw??1),size=faqLimits(config).page,all=findFaqs(rows,group,q),total=all.length,pages=Math.max(1,Math.ceil(total/size));if(page>pages)throw new Fault(404,'FAQ 페이지 범위를 벗어났습니다.');
 return {group,q,page,size,total,pages,items:all.slice((page-1)*size,page*size),start:total?(page-1)*size+1:0,end:Math.min(page*size,total),canonical:faqUrl(group,page,q)};
}
export function faqLocation(rows:ContentRow[],id:string,config:Data={}){const alias=rows.find(r=>r.id===id&&r.kind==='faq'&&r.published?.mergedInto);const targetId=alias?.published?.mergedInto||id;const row=publicFaqs(rows).find(r=>r.id===targetId);if(!row)return null;const group=faqGroup(row.published!),list=findFaqs(rows,group),position=list.findIndex(r=>r.id===targetId);return faqUrl(group,Math.floor(position/faqLimits(config).page)+1)+'#faq-'+encodeURIComponent(targetId);}
export function faqNavigationPaths(rows:ContentRow[],config:Data={}){return ['',...FAQ_GROUPS.map(g=>g.id)].flatMap(group=>{const total=findFaqs(rows,group).length;return Array.from({length:Math.max(1,Math.ceil(total/faqLimits(config).page))},(_,i)=>faqUrl(group,i+1));});}
export function canonicalFaqIds(rows:ContentRow[],ids:string[]){return [...new Set(ids.map(id=>rows.find(r=>r.kind==='faq'&&r.id===id)?.published?.mergedInto||id))];}
export function quickFaqs(rows:ContentRow[],group='',config:Data={},selected?:string[]){const all=findFaqs(rows,group);const preferred=canonicalFaqIds(rows,selected??rows.find(r=>r.kind==='home')?.published?.faqIds??[]);const rest=all.filter(r=>!preferred.includes(r.id)).sort((a,b)=>Number(!!b.published!.featuredOnHome)-Number(!!a.published!.featuredOnHome)||faqCompare(a,b));return [...preferred.map((id:string)=>all.find(r=>r.id===id)).filter(Boolean) as ContentRow[],...rest].slice(0,faqLimits(config).home);}
