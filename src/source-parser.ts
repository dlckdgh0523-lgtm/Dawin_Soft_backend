import {parentPort} from 'node:worker_threads';
import {JSDOM} from 'jsdom';import {Readability} from '@mozilla/readability';import createDOMPurify from 'dompurify';
import type {Data} from './types';
export function parseSource(input:Data){
 const html=String(input.text);if(Buffer.byteLength(html)>2*1024*1024)throw new Error('BODY_LIMIT');
 const declarations=input.xml?html.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g,''):html;
 // HTML parsing does not resolve DTDs; legacy HTML PUBLIC declarations are inert.
 if(/<!ENTITY/i.test(declarations)||input.xml&&/<!DOCTYPE\s+[^>]*(?:SYSTEM|PUBLIC)/i.test(declarations))throw new Error('XML_ENTITY');
 if(input.xml){if(/<!DOCTYPE/i.test(declarations))throw new Error('XML_DOCTYPE');const dom=new JSDOM(html,{contentType:'text/xml',url:input.url});try{
  const d=dom.window.document,items=[...d.querySelectorAll('item,entry')].slice(0,50).map(n=>({title:(n.querySelector('title')?.textContent??'').slice(0,500),url:n.querySelector('link')?.getAttribute('href')??n.querySelector('link')?.textContent??'',publishedAt:n.querySelector('pubDate,published,updated')?.textContent??'',summary:(n.querySelector('description,summary')?.textContent??'').slice(0,1000)})).flatMap(v=>{try{const u=new URL(v.url,input.url);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?[{...v,url:u.href}]:[];}catch{return [];}});
  return{status:'DISCOVERY_ONLY',title:(d.querySelector('channel>title,feed>title')?.textContent??'').slice(0,500),feedItems:items,excerpt:'',warnings:['RSS/Atom은 발견 경로입니다. 기사 본문은 별도로 확보해야 합니다.']};
 }finally{dom.window.close();}}
 const dom=new JSDOM(html,{url:input.url});try{const d=dom.window.document;assertNodes(d);const meta=(name:string)=>d.querySelector(`meta[property="${name}"],meta[name="${name}"]`)?.getAttribute('content')??'';
 const author=meta('author')||meta('article:author');const publishedAt=meta('article:published_time'),modifiedAt=meta('article:modified_time');
 const hadScript=!!d.querySelector('script');const article=new Readability(d,{maxElemsToParse:20000,charThreshold:120}).parse();const raw=article?.content??'';const purify=createDOMPurify(dom.window as any);const safe=purify.sanitize(raw,{ALLOWED_TAGS:['p','h1','h2','h3','ul','ol','li','blockquote','pre','code','table','thead','tbody','tr','th','td','strong','em','br'],ALLOWED_ATTR:[]});
 const clean=new JSDOM(safe);let excerpt='';try{excerpt=(clean.window.document.body.textContent??'').replace(/\r/g,'').replace(/[ \t]+/g,' ').trim().slice(0,16000);}finally{clean.window.close();}
 const status=/captcha|access denied|로그인.{0,12}(필요|하세요)|sign in to continue|subscribe to continue/i.test(excerpt)?'BLOCKED':excerpt.length>=120?'BODY_ACQUIRED':hadScript&&excerpt.length<120?'DYNAMIC_PAGE':'EMPTY';
 return{status,title:(article?.title||d.title||'').slice(0,500),author:(article?.byline||author).slice(0,300),publishedAt,modifiedAt,excerpt:status==='BODY_ACQUIRED'?excerpt:'',safeHtml:'',segments:status==='BODY_ACQUIRED'?[{start:0,end:excerpt.length}]:[],warnings:status==='BODY_ACQUIRED'?['추출 결과는 사실 검토와 이용 조건 확인을 대신하지 않습니다.']:['원문 본문을 확보하지 못했습니다.']};
 }finally{dom.window.close();}
}
function assertNodes(d:Document){if(d.getElementsByTagName('*').length>20000)throw new Error('PARSER_ELEMENT_LIMIT');}
if(parentPort)parentPort.on('message',(input:Data)=>{try{parentPort!.postMessage({ok:true,result:parseSource(input)});}catch(e){parentPort!.postMessage({ok:false,error:e instanceof Error?e.message:'PARSER_FAILED'});}});
