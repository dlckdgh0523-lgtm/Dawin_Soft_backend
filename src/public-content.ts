import type {ContentRow,Data} from './types';
import {faqContent} from './faq-content';
import {homeFaqIds,processSteps,serviceContent} from './service-content';
// Explicit public DTO. Drafts, private client notes and contract/evidence records are excluded.
const common=['slug','title','description','body','indexable','seoTitle','seoDescription'];
const fields:Record<string,string[]>={
 home:[...common,'heroEyebrow','ctaHref','solutionsTitle','solutionsDescription','processTitle','processDescription','policyTitle','faqTitle','contactTitle','contactBody','sectionConfigurationApproved','selectedCaseIds','cta','sections','hiddenSections','logoAsset','faqIds','processSteps'],
 service:[...common,'excludedScopes','operatingConditions','headline','audience','scopes','capabilities','outputs','preparation','processEmphasis','faqIds','relatedProjects','visualLabels','visualCaption','timeline'],
 project:[...common,'publicId','publicDisplayName','category','contribution','problem','implementation','result','evidence','mediaId','mediaApprovedForPublic'],
 faq:[...common,'key','question','answer','scope','category','sortOrder','displayOrder','synonyms','primaryGroup','mergedInto','featuredOnHome','relatedServiceSlugs','caseId'],
 article:[...common,'author','authorType','writingMode','articleType','bodyBlocks','sources','mediaId','imageAlt','categoryId','tagIds','serviceIds','caseIds','commentsEnabled','reactionsEnabled','tocEnabled']
};
export const publicCaseId='development-center';
export const legacyCaseId='legacy-center';
export function neutralText(value:unknown):any{
 if(typeof value==='string')return value.replace(/https?:\/\/[^\s<>"']*legacy-center[^\s<>"']*/gi,'[비공개 고객 링크]').replace(/비공개고객\s*ABA|비공개고객/gi,'경기권 발달센터').replace(/legacy-center/gi,publicCaseId).replace(/legacy-center/gi,'경기권 발달센터');
 if(Array.isArray(value))return value.map(neutralText);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,neutralText(v)]));
 return value;
}
export function publicContentRows(rows:ContentRow[]):ContentRow[]{return rows.filter(r=>r.published&&fields[r.kind]&&!r.archived&&!/playground|demo-project/.test(r.id)).map(r=>{
 // Supply new relationship/display fields when upgrading an edited v1 row, without
 // replacing any operator-authored body, title or saved selection.
 const defaults:Data=r.kind==='home'?{faqIds:homeFaqIds,processSteps}:r.kind==='service'?serviceContent[r.id]??{}:r.kind==='faq'?faqContent.find(f=>f.key===r.id)??{}:{};
 const published={...defaults,...r.published};
 // A missing new alias field must not hide an operator's distinct edited answer.
 if(r.kind==='faq'&&r.published?.mergedInto===undefined&&defaults.mergedInto&&(r.published?.body!==defaults.body||r.published?.question!==defaults.question))published.mergedInto='';
 const b:Data={};for(const key of fields[r.kind])if(published[key]!==undefined)b[key]=neutralText(published[key]);
 const legacy=r.kind==='project'&&(r.id===legacyCaseId||r.id===publicCaseId);
 if(legacy){b.publicId=publicCaseId;b.slug=publicCaseId;b.publicDisplayName='경기권 발달센터';}
 if(r.kind==='project'&&b.mediaApprovedForPublic!==true)delete b.mediaId;
 if(r.kind==='faq'&&/^danwi-faq-4[345]$/.test(r.id)){b.scope='CASE';b.caseId=publicCaseId;b.featuredOnHome=false;b.relatedServiceSlugs=[];}
 return{id:legacy?publicCaseId:r.id,kind:r.kind,draft:{},published:b,revision:r.published_revision??1,published_revision:r.published_revision,updated_at:r.updated_at,published_at:r.published_at,first_published_at:r.first_published_at,archived:false};
 });}
