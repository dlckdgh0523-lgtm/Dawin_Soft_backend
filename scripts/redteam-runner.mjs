import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const env={};
for(const key of ['SystemRoot','WINDIR','PATH','TEMP','TMP'])if(process.env[key])env[key]=process.env[key];
env.REDTEAM_EXPECT_FIXED='true';
env.FRONTEND_ROOT=process.env.FRONTEND_ROOT||path.resolve('../danwisoft-frontend');
const full=process.argv.includes('--full');
const suites=[
 'tests/redteam-auth.ts','tests/redteam-api.ts','tests/redteam-ingestion.ts','tests/redteam-media-atomic.ts',
 'tests/redteam-parser-worker.ts','tests/redteam-inquiry-cleanup.ts','tests/redteam-ui.ts','tests/redteam-admin-ui.ts','tests/redteam-admission.ts','tests/redteam-http.mjs',
 'tests/legacy-auth/password-auth-test.ts','tests/legacy-auth/oauth-auth-compat-test.ts',
 'tests/legacy-auth/local-setup-boundaries-test.ts','tests/legacy-auth/admin-events-tests.ts',
 ...(full?['tests/integration.ts','tests/insights.ts','tests/editorial-workflows.ts','tests/operations.ts','tests/operations-boundaries.ts','tests/mail-node.ts','tests/content-alignment.ts','tests/faq-final.ts','tests/motion-content.ts']:[])
];
const results=[];
async function run(name,args){
 console.log('\nRunning '+name);
 const started=Date.now();
 const child=spawn(process.execPath,args,{cwd:process.cwd(),env,stdio:['ignore','pipe','pipe']});
 let output='';
 child.stdout.on('data',b=>{output+=b;process.stdout.write(b);});
 child.stderr.on('data',b=>{output+=b;process.stderr.write(b);});
 const deadline=setTimeout(()=>child.kill('SIGKILL'),180000);deadline.unref();
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});clearTimeout(deadline);
 results.push({name,pass:code===0,exitCode:code,elapsedMs:Date.now()-started});
 await mkdir('tests/results',{recursive:true});
 await writeFile('tests/results/'+name.replace(/[^a-zA-Z0-9_-]/g,'_')+'.log',output);
 return code===0;
}
if(!await run('backend-build',['scripts/build.mjs']))process.exitCode=1;
else{
 for(const file of suites){const args=file.endsWith('.ts')?['--experimental-transform-types','--import','./scripts/typescript-loader.mjs',file]:[file];await run(file,args);}
 if(results.some(r=>!r.pass))process.exitCode=1;
}
await writeFile('tests/results/redteam-run.json',JSON.stringify({mode:full?'security + existing regressions':'security',passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results,scope:'Disposable synthetic data and local loopback only. Environment allowlist excludes actual DB URLs, credentials and provider keys. No .env file loaded.',finishedAt:new Date().toISOString()},null,2));
