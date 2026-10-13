import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {adminLogin,adminIdentity,configuredAdmin,passwordHash,type AdminAuthConfig} from '../../src/admin-auth';
import {devDatabase} from '../../src/pglite-dev';

// Memory PostgreSQL fixture only. Does not read private env, local PostgreSQL or user passwords.
const db=await devDatabase();
const result:{name:string;passed:boolean}[]=[];
const check=(name:string)=>{result.push({name,passed:true});console.log('PASS '+name);};
const origin='http://127.0.0.1:5195';
const fixturePassword='Fixture-only-password-2026!';
const c:AdminAuthConfig={loginId:'fixture-admin',passwordHash:await passwordHash(fixturePassword),sessionSecret:'fixture-secret-'.repeat(6),userId:'fixture-owner',origin,local:true};
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
const request=(path:string,init:RequestInit={})=>new Request(origin+path,init);
const cookiePair=(response:Response,name:string)=>response.headers.getSetCookie().find(v=>v.startsWith(name+'='))?.split(';')[0]??'';
async function page(config=c){const response=(await adminLogin(request('/admin/login'),db,config))!;const html=await response.text();const nonce=html.match(/name="nonce" value="([^"]+)"/)?.[1];assert(nonce);return{response,nonce,cookie:cookiePair(response,'danwi_admin_nonce')};}
async function post(p:Awaited<ReturnType<typeof page>>,options:{username?:string;password?:string;nonce?:string;origin?:string;extraCookie?:string}={}){const body=new URLSearchParams({username:options.username??c.loginId,password:options.password??fixturePassword,nonce:options.nonce??p.nonce});return(await adminLogin(request('/admin/login',{method:'POST',headers:{origin:options.origin??origin,'content-type':'application/x-www-form-urlencoded',cookie:p.cookie+(options.extraCookie?'; '+options.extraCookie:'')},body}),db,c))!;}
async function clearRate(){await db.query("DELETE FROM rate_bucket WHERE key LIKE 'admin-login%'");}
async function login(){await clearRate();const response=await post(await page());assert.equal(response.status,303);const pair=cookiePair(response,'danwi_admin_session');assert(pair);return{response,pair,token:pair.split('=')[1]};}
async function identity(pair:string,config=c){return adminIdentity(request('/api/admin/bootstrap',{headers:{cookie:pair}}),db,config);}

try{
 if(!(await db.query("SELECT to_regclass('public.admin_session') AS name")).rows[0].name){const ddl=await readFile('db/006_admin_sessions.sql','utf8');for(const statement of ddl.split(/;\s*(?:\r?\n|$)/).map(v=>v.trim()).filter(Boolean))await db.query(statement);}
 await db.query("INSERT INTO admin_user(user_id,email,role) VALUES('fixture-owner','owner@example.invalid','owner')");
 assert(configuredAdmin(c));assert(!c.passwordHash.includes(fixturePassword));check('fixed scrypt hash does not contain plaintext');
 assert(!configuredAdmin({...c,passwordHash:c.passwordHash.replace('32768','999999')}));check('untrusted KDF parameter profile is rejected');
 const unconfigured=(await adminLogin(request('/admin/login'),db,{...c,passwordHash:''}))!;assert.equal(unconfigured.status,503);assert((await unconfigured.text()).includes('disabled'));check('unconfigured login is disabled with 503');
 let p=await page();assert.equal(p.response.status,200);assert(p.response.headers.get('cache-control')?.includes('no-store'));assert(p.response.headers.get('x-robots-tag')?.includes('noindex'));assert(p.response.headers.get('x-frame-options')==='DENY');assert(p.response.headers.get('set-cookie')?.includes('HttpOnly'));assert(p.response.headers.get('set-cookie')?.includes('SameSite=Strict'));check('login page and nonce cookie protection');
 const production=await page({...c,origin:'https://example.invalid',local:false});assert(production.response.headers.get('set-cookie')?.includes('; Secure'));check('production nonce cookie requires HTTPS');
 await clearRate();let response=await post(p,{origin:'https://attacker.invalid'});assert.equal(response.status,403);check('cross-origin login is rejected');
 response=await post(p,{nonce:p.nonce.slice(0,-1)+'0'});assert.equal(response.status,403);check('tampered nonce is rejected');
 response=await post(p,{nonce:'단'+p.nonce.slice(1)});assert.equal(response.status,403);check('nonce with unequal UTF-8 byte lengths is rejected without exception');
 response=await post(p,{password:'wrong-fixture-password'});assert.equal(response.status,401);assert((await response.text()).includes('아이디 또는 비밀번호를 확인하세요.'));check('incorrect password has generic login error');
 response=await post(p);assert.equal(response.status,403);check('a consumed nonce cannot be replayed');
 await clearRate();p=await page();response=await post(p,{username:'other-admin'});assert.equal(response.status,401);assert((await response.text()).includes('아이디 또는 비밀번호를 확인하세요.'));check('unknown ID receives the same generic error');
 await clearRate();p=await page();response=await post(p,{username:'단'.repeat(c.loginId.length)});assert.equal(response.status,401);check('Unicode ID with unequal byte lengths returns generic failure');
 await clearRate();p=await page();await db.query('UPDATE admin_login_nonce SET expires_at=now()-interval \'1 second\' WHERE nonce_hash=$1',[sha(p.nonce)]);response=await post(p);assert.equal(response.status,403);check('expired persisted nonce is rejected');
 let valid=await login();assert.equal(valid.response.headers.get('location'),'/admin');assert.deepEqual(await identity(valid.pair),{id:'fixture-owner',email:'owner@example.invalid'});const stored=(await db.query('SELECT token_hash,credential_version,expires_at,revoked_at FROM admin_session WHERE token_hash=$1',[sha(valid.token)])).rows[0];assert(stored);assert.equal(stored.token_hash,sha(valid.token));assert.notEqual(stored.token_hash,valid.token);check('successful login stores only token hash and resolves existing operator');
 const rawSetCookie=valid.response.headers.getSetCookie().find(v=>v.startsWith('danwi_admin_session='))!;assert(rawSetCookie.includes('Path=/'));assert(rawSetCookie.includes('Max-Age=28800'));assert(rawSetCookie.includes('HttpOnly'));assert(rawSetCookie.includes('SameSite=Lax'));check('session cookie supports OAuth return with Lax and eight-hour lifetime');
 const old=valid;await clearRate();response=await post(await page(),{extraCookie:old.pair});const nextPair=cookiePair(response,'danwi_admin_session');assert(nextPair);assert.notEqual(nextPair,old.pair);assert.equal(await identity(old.pair),null);assert(await identity(nextPair));check('login replaces prior browser session and prevents fixation');
 valid=await login();assert.equal(await identity(valid.pair,{...c,loginId:'changed-admin'}),null);assert.equal(await identity(valid.pair,{...c,passwordHash:await passwordHash('Another-fixture-password!')}),null);assert.equal(await identity(valid.pair,{...c,sessionSecret:'rotated-fixture-secret'.repeat(3)}),null);check('ID, password and secret rotation invalidate prior sessions');
 await db.query('UPDATE admin_session SET expires_at=now()-interval \'1 second\' WHERE token_hash=$1',[sha(valid.token)]);assert.equal(await identity(valid.pair),null);check('expired session is rejected');
 valid=await login();await db.query('UPDATE admin_user SET active=false WHERE user_id=$1',[c.userId]);assert.equal(await identity(valid.pair),null);check('disabled operator loses access immediately');
 await clearRate();response=await post(await page());assert.equal(response.status,401);await db.query('UPDATE admin_user SET active=true WHERE user_id=$1',[c.userId]);check('disabled operator cannot create a fresh session');
 valid=await login();await db.query('UPDATE admin_user SET session_version=session_version+1 WHERE user_id=$1',[c.userId]);assert.equal(await identity(valid.pair),null);check('operator session-version revocation is enforced');
 valid=await login();response=(await adminLogin(request('/admin/logout',{headers:{cookie:valid.pair,'sec-fetch-site':'cross-site'}}),db,c))!;assert.equal(response.status,405);assert(await identity(valid.pair));check('GET logout cannot revoke a session');
 response=(await adminLogin(request('/admin/logout',{method:'POST',headers:{cookie:valid.pair,origin:'https://attacker.invalid'}}),db,c))!;assert.equal(response.status,403);assert(await identity(valid.pair));check('POST logout requires exact site Origin');
 response=(await adminLogin(request('/admin/logout',{method:'POST',headers:{cookie:valid.pair,origin}}),db,c))!;assert.equal(response.status,303);assert.equal(response.headers.get('location'),'/admin/login');assert(response.headers.get('set-cookie')?.includes('Max-Age=0'));assert.equal(await identity(valid.pair),null);check('same-origin POST logout revokes persisted session and clears cookie');
 await clearRate();for(let i=0;i<5;i++){response=await post(await page(),{password:'incorrect-fixture-password'});assert.equal(response.status,401);}response=await post(await page(),{password:'incorrect-fixture-password'});assert.equal(response.status,429);check('persisted login rate limit blocks attempt six');
 await clearRate();const missing={...c,userId:'missing-operator'};const initial=(await adminLogin(request('/admin/login'),db,missing))!;const missingHtml=await initial.text();const nonce=missingHtml.match(/name="nonce" value="([^"]+)"/)?.[1];assert(nonce);response=(await adminLogin(request('/admin/login',{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded',cookie:cookiePair(initial,'danwi_admin_nonce')},body:new URLSearchParams({username:c.loginId,password:fixturePassword,nonce})}),db,missing))!;assert.equal(response.status,401);assert.equal((await db.query("SELECT count(*)::int AS n FROM admin_user WHERE user_id='missing-operator'")).rows[0].n,0);check('login never bootstraps a missing Owner');
 const report={checks:result.length,results:result,database:'isolated memory PostgreSQL',externalRequests:0,paidCalls:0,privateSecretsRead:false};await writeFile('tests/results/password-auth-test-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({checks:result.length,externalRequests:0,paidCalls:0,privateSecretsRead:false}));
}finally{await db.close();}
