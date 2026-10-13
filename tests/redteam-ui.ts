import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {JSDOM,VirtualConsole} from 'jsdom';
import {devDatabase} from '../src/pglite-dev';
import {publicRows,settings} from '../src/store';
import {renderPage} from '../src/render';
import {validateArticle} from '../src/insights-core';
import type {Runtime,ContentRow,Data} from '../src/types';
// DOM simulation only: no browser, external resources, .env, real DB or external fetch.
const db=await devDatabase(),origin='https://ui-fixture.example.invalid';
const rt:Runtime={db,identity:null,origin,privateSite:false,clientKey:'synthetic-ui'};
const rows=await publicRows(rt),config={...await settings(rt),privacyApproved:true,inquiriesEnabled:true,privacyConsentRequired:true};
const scripts=Object.fromEntries(await Promise.all(['site.js','faq-guide.js','insights.js'].map(async name=>[name,await readFile('../danwisoft-frontend/public/'+name,'utf8')])));
let passed=0;const checks:string[]=[];const findings:any[]=[];const doms:JSDOM[]=[];const errors:string[]=[];
function check(name:string,value:unknown){assert(value,name);checks.push(name);passed++;}
const tick=()=>new Promise<void>(r=>setTimeout(r,0));async function settle(){for(let i=0;i<4;i++)await tick();}
function response(body:any,status=200){return Response.json(body,{status});}
function setup(path:string,script:string,fetchImpl:(url:string,init:any)=>Promise<Response>,cfg=config,input=rows){
 const rendered=renderPage(path,input,cfg,origin,false,true);const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!/Not implemented/.test(e.message))errors.push(e.message);});
 const dom=new JSDOM(rendered.html,{url:origin+path,runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});doms.push(dom);const w=dom.window as any;
 w.fetch=fetchImpl;w.crypto.randomUUID=randomUUID;w.HTMLElement.prototype.scrollIntoView=()=>{};w.confirm=()=>true;
 if(w.HTMLDialogElement){w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};}
 w.eval(scripts[script]);return{dom,w,doc:w.document,rendered};
}
function submit(w:any,form:any){form.dispatchEvent(new w.SubmitEvent('submit',{bubbles:true,cancelable:true}));}
function fill(form:any){form.elements.name.value='가상 문의자';form.elements.email.value='fixture@example.invalid';form.elements.description.value='독립 DOM 검수용 문의입니다.';form.elements.privacy.checked=true;}
function files(form:any,list:any[]){Object.defineProperty(form.elements.files,'files',{configurable:true,value:list});}
const payload='<img src=x onerror="window.__pwned=1"><svg onload="window.__pwned=2">';
try{
 let calls:{url:string;init:any}[]=[];let firstReject!:(e:unknown)=>void;const pending=new Promise<Response>((_r,j)=>firstReject=j);let attempt=0;
 const c=setup('/contact?service=seo-geo&source=%2Fservices%2Fseo-geo','site.js',async(url,init)=>{calls.push({url,init});return ++attempt===1?pending:response({ok:true,receipt:payload},201);});const form=c.doc.querySelector('#inquiry-form') as any;
 check('Actual contact SSR selectors and enabled consent form present',form&&form.dataset.enabled==='true'&&form.elements.privacy&&form.elements.files);
 check('Contact service URL preselect reveals SEO fields',form.elements.service.value==='seo-geo'&&!c.doc.querySelector('[data-seo-fields]').hidden);
 form.elements.service.value='admin-systems';form.elements.service.dispatchEvent(new c.w.Event('change'));check('Changing service hides unrelated SEO fields',c.doc.querySelector('[data-seo-fields]').hidden);
 submit(c.w,form);await settle();check('Empty required fields cannot submit inquiry',calls.length===0);
 fill(form);form.elements.email.value='invalid-email';submit(c.w,form);await settle();check('Malformed email cannot submit inquiry',calls.length===0);
 form.elements.email.value='';form.elements.phone.value='';submit(c.w,form);await settle();check('Missing both contact methods shows actionable error',calls.length===0&&c.doc.querySelector('#form-status').textContent.includes('한 가지'));
 fill(form);form.elements.privacy.checked=false;submit(c.w,form);await settle();check('Missing required consent cannot submit inquiry',calls.length===0);form.elements.privacy.checked=true;
 files(form,[{size:3*1024*1024+1}]);submit(c.w,form);await settle();check('Oversized attachment rejected before fetch',calls.length===0&&c.doc.querySelector('#form-status').textContent.includes('3MB'));
 files(form,Array.from({length:4},()=>({size:1})));submit(c.w,form);await settle();check('Fourth attachment rejected before fetch',calls.length===0);files(form,[]);
 submit(c.w,form);submit(c.w,form);await settle();check('Repeated inquiry submit sends only one in-flight request',calls.length===1&&form.querySelector('[type=submit]').disabled);
 const firstBody=JSON.parse(calls[0].init.body);check('Inquiry carries UUID and contextual source',/^[a-f0-9-]{36}$/.test(firstBody.idempotencyKey)&&firstBody.sourcePage==='/services/seo-geo'&&firstBody.privacy===true);
 firstReject(Error('synthetic transport failure '+payload));await settle();check('Transport failure preserves inquiry data and re-enables retry',form.elements.description.value==='독립 DOM 검수용 문의입니다.'&&form.elements.email.value==='fixture@example.invalid'&&!form.querySelector('[type=submit]').disabled);
 check('Inquiry error text cannot insert executable DOM',!c.doc.querySelector('#form-status img')&&!c.w.__pwned);
 submit(c.w,form);await settle();check('Retry reuses idempotency key',calls.length===2&&JSON.parse(calls[1].init.body).idempotencyKey===firstBody.idempotencyKey);
 check('Successful inquiry resets form and disables completed submit',form.elements.name.value===''&&form.querySelector('[type=submit]').disabled&&form.querySelector('[type=submit]').textContent==='접수 완료');
 check('Untrusted receipt text is rendered as text',!c.doc.querySelector('#form-status img')&&c.doc.querySelector('#form-status').textContent.includes(payload));submit(c.w,form);await settle();check('Completed inquiry cannot resubmit in same page',calls.length===2);
 let disabledCalls=0;const disabled=setup('/contact','site.js',async()=>{disabledCalls++;return response({ok:true});},{...config,privacyApproved:false});const df=disabled.doc.querySelector('#inquiry-form') as any;fill(df);submit(disabled.w,df);await settle();check('Unapproved privacy keeps public inquiry form blocked',df.dataset.enabled==='false'&&disabledCalls===0);
 const hostile=setup('/contact?service=unexpected','site.js',async()=>response({ok:false}));check('Unknown service query cannot inject select option',hostile.doc.querySelector('#inquiry-form').elements.service.value==='undecided');

 const work=setup('/work','site.js',async()=>{throw Error('Unexpected fetch');});const projects=[...work.doc.querySelectorAll('[data-case]')];check('Actual work filter selectors exist',work.doc.querySelectorAll('[data-case-filters] button').length===5&&projects.length===1);
 work.doc.querySelector('[data-filter=ai-automation]').click();check('Empty work category shows correct service inquiry links',work.doc.querySelector('[data-case-empty]').hidden===false&&projects.every((p:any)=>p.hidden)&&work.doc.querySelector('[data-case-empty] a').getAttribute('href')==='/services/ai-automation');
 work.doc.querySelector('[data-filter=all]').click();check('All work filter restores case/count and pressed state',projects.every((p:any)=>!p.hidden)&&work.doc.querySelector('[data-case-count]').textContent.includes('1개')&&work.doc.querySelector('[data-filter=all]').getAttribute('aria-pressed')==='true');

 let faqCalls:any[]=[];let abortRejected=false;const faq=setup('/faq','faq-guide.js',async(url,init)=>{faqCalls.push({url,init});if(String(url).startsWith('/api/faq/guide'))return response({aiAvailable:false});return new Promise<Response>((_r,j)=>init.signal.addEventListener('abort',()=>{abortRejected=true;j(new DOMException('aborted','AbortError'));},{once:true}));});
 faq.doc.querySelector('[data-guide-mode=direct]').click();await settle();check('FAQ direct mode reveals form and AI opt-in stays hidden',!faq.doc.querySelector('#guide-direct-panel').hidden&&faq.doc.querySelector('[data-ai-optin]').hidden);
 const gf=faq.doc.querySelector('[data-guide-form]') as any;submit(faq.w,gf);await settle();check('Empty FAQ question does not request answer',faqCalls.filter(r=>r.url==='/api/faq/ask').length===0);
 gf.elements.message.value=payload;submit(faq.w,gf);await settle();check('Typed FAQ payload renders as text',!faq.doc.querySelector('.chat-question img')&&faq.doc.querySelector('.chat-question').textContent===payload);
 faq.doc.querySelector('[data-guide-cancel]').click();await settle();check('FAQ cancel aborts request and retains input',abortRejected&&gf.elements.message.value===payload&&!gf.querySelector('[type=submit]').disabled);
 const answered=setup('/faq','faq-guide.js',async(url)=>String(url).includes('/guide')?response({aiAvailable:false}):response({mode:'FAQ_DIRECT',notice:payload,answer:{id:'fixture-faq',question:payload,answer:payload,href:'/faq/go/fixture-faq'},contactService:'admin-systems'}));const af=answered.doc.querySelector('[data-guide-form]') as any;af.elements.message.value='업무 시스템도 가능한가요?';submit(answered.w,af);await settle();check('FAQ answer/question/notice payloads remain non-executable text',!answered.doc.querySelector('.chat-entry img')&&answered.doc.querySelector('.chat-entry').textContent.includes(payload)&&!answered.w.__pwned);
 check('FAQ answer links to official source and relevant contact',answered.doc.querySelector('.chat-entry .answer-source').getAttribute('href')==='/faq/go/fixture-faq'&&answered.doc.querySelector('.chat-entry .button').getAttribute('href').includes('service=admin-systems'));
 const faqSearch=renderPage('/faq?q='+encodeURIComponent(payload),rows,config,origin,false,true);const searchDom=new JSDOM(faqSearch.html);doms.push(searchDom);check('FAQ search query escapes HTML and retains input',searchDom.window.document.querySelector('#faq-search')?.getAttribute('value')===payload&&!searchDom.window.document.querySelector('[onerror]'));

 const articleBody=validateArticle({slug:'ui-article',title:'DOM 검수 글 '+payload,description:'독립 시험',body:'본문 '+payload,author:'가상 운영자',commentsEnabled:true,reactionsEnabled:true});const article:ContentRow={id:'ui-article',kind:'article',draft:{},published:articleBody,revision:1,published_revision:1,updated_at:new Date().toISOString(),published_at:new Date().toISOString(),first_published_at:new Date().toISOString(),archived:false};
 const articleConfig={...config,editorialPublic:{comments:{rows:[{id:'fixture-comment',nickname:payload,body:payload,status:'APPROVED',created_at:new Date().toISOString()}],page:1,pages:1}}};let insightCalls:any[]=[];let failComment=true;
 const insights=setup('/insights/ui-article','insights.js',async(url,init)=>{const body=JSON.parse(init.body);insightCalls.push({url,body});if(url.endsWith('reaction-state'))return response({active:false,count:0});if(url.endsWith('/reactions'))return response({active:body.active,count:body.active?1:0});if(url.endsWith('/comments')){if(failComment){failComment=false;return response({error:'synthetic rejection '+payload},400);}return response({ok:true});}return response({ok:true});},articleConfig,[...rows,article]);await settle();
 check('Published article/comment SSR escapes stored XSS payload',!insights.doc.querySelector('[onerror]')&&!insights.doc.querySelector('[onload]')&&!insights.w.__pwned);
 const reaction=insights.doc.querySelector('[data-reaction-type=article]');reaction.click();await settle();reaction.click();await settle();check('Article recommendation toggles on and off with count',insightCalls.filter(r=>r.url.endsWith('/reactions')).map(r=>r.body.active).join(',')==='true,false'&&reaction.getAttribute('aria-pressed')==='false'&&reaction.querySelector('span').textContent==='0');
 const cf=insights.doc.querySelector('[data-comment-form]') as any;submit(insights.w,cf);await settle();check('Blank comment required fields prevent request',insightCalls.filter(r=>r.url.endsWith('/comments')).length===0);cf.elements.nickname.value='가상 댓글';cf.elements.password.value='synthetic-password';cf.elements.body.value=payload;submit(insights.w,cf);await settle();check('Rejected comment retains text and shows safe error',cf.elements.body.value===payload&&!cf.querySelector('[type=submit]').disabled&&!insights.doc.querySelector('[data-comment-status] img'));submit(insights.w,cf);await settle();check('Accepted comment resets form and announces moderation',cf.elements.body.value===''&&insights.doc.querySelector('[data-comment-status]').textContent.includes('검토 후 공개'));
 insights.doc.querySelector('[data-comment-reply]').click();check('Comment reply selects actual parent',cf.elements.parentId.value==='fixture-comment'&&!insights.doc.querySelector('[data-cancel-reply]').hidden);insights.doc.querySelector('[data-cancel-reply]').click();check('Comment reply cancel clears parent',cf.elements.parentId.value===''&&insights.doc.querySelector('[data-cancel-reply]').hidden);
 insights.doc.querySelector('[data-comment-edit]').click();check('Comment edit dialog uses literal text values',insights.doc.querySelector('dialog input[name=nickname]').value===payload&&!insights.doc.querySelector('dialog img'));[...insights.doc.querySelectorAll('dialog button')].find((b:any)=>b.textContent==='닫기').click();await settle();check('Closing edit dialog removes transient DOM',!insights.doc.querySelector('.article-edit-dialog'));
 const list=renderPage('/insights?q='+encodeURIComponent('없는 검색어 '+payload),[...rows,article],config,origin,false,true);const ld=new JSDOM(list.html);doms.push(ld);check('Insights search SSR has no executable query and offers reset',ld.window.document.querySelector('#insight-q')?.getAttribute('value')==='없는 검색어 '+payload&&!ld.window.document.querySelector('[onerror]')&&ld.window.document.querySelector('.empty-state a')?.getAttribute('href')==='/insights');
 check('DOM script execution produced no unexpected jsdom errors',errors.length===0);
}finally{await mkdir('tests/results',{recursive:true});await writeFile('tests/results/redteam-ui.json',JSON.stringify({passed,checks,findings,method:'JSDOM actual server-rendered pages + trusted frontend script evaluation; mocked fetch only; no external resources',limitations:['No actual browser run: CUA failed, so responsive screenshots, physical input and native file/dialog UX are not verified here.','Native dialog/scroll methods are minimal test polyfills.','Finite practical paths, not every button permutation or all attack possibilities.','In-memory PGlite and synthetic data only; production configuration and network excluded.'],errors,finishedAt:new Date().toISOString()},null,2));for(const dom of doms)dom.window.close();await db.close();}
console.log(`${passed} DOM user-flow checks passed (simulated; not browser verification)`);
