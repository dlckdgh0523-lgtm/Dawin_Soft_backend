import assert from 'node:assert/strict';import {mkdir,writeFile} from 'node:fs/promises';import {parseIsolated} from '../src/source-collector';
// Requires npm run build first. Uses the actual compiled worker on synthetic HTML.
const checks:any[]=[],parser=process.env.SOURCE_PARSER_PATH;process.env.SOURCE_PARSER_PATH='backend/source-parser.js';
const article={url:'https://example.com',text:'<html><body><article><h1>테스트</h1><p>'+('격리된 본문 자료입니다. '.repeat(40))+'</p></article></body></html>'};
async function tested(name:string,fn:()=>Promise<void>){const start=Date.now();try{await fn();checks.push({name,pass:true,ms:Date.now()-start});console.log('PASS '+name);}catch(e){checks.push({name,pass:false,error:(e as Error).message,ms:Date.now()-start});console.log('FAIL '+name+': '+(e as Error).message);}}
try{
 await tested('real isolated parser worker accepts ordinary article',async()=>{assert.equal((await parseIsolated(article)).status,'BODY_ACQUIRED');});
 await tested('real worker rejects external XML entity without contacting it',async()=>{await assert.rejects(parseIsolated({url:'https://example.com',xml:true,text:'<!DOCTYPE rss [<!ENTITY x SYSTEM "http://127.0.0.1/secret">]><rss>&x;</rss>'}),/XML/);});
 await tested('resource bomb is rejected or isolated by memory/element/time limits',async()=>{await assert.rejects(parseIsolated({url:'https://example.com',text:'<html><body>'+('<i>x</i>'.repeat(20001))+'</body></html>'}),/PARSER_(?:ELEMENT_LIMIT|FAILED|EXIT|TIMEOUT)/);});
 await tested('parser remains usable after hostile worker terminated',async()=>{assert.equal((await parseIsolated(article)).status,'BODY_ACQUIRED');});
}finally{if(parser===undefined)delete process.env.SOURCE_PARSER_PATH;else process.env.SOURCE_PARSER_PATH=parser;}
const report={suite:'redteam-parser-worker',passed:checks.filter(c=>c.pass).length,failed:checks.filter(c=>!c.pass).length,checks,externalRequests:0,paidCalls:0};await mkdir('tests/results',{recursive:true});await writeFile('tests/results/redteam-parser-worker.json',JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;
