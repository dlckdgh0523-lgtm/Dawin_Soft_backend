import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {devDatabase} from '../../src/pglite-dev';
import {localAdminSetup} from '../../src/local-admin-setup';
import {passwordHash} from '../../src/admin-auth';

// All setup checks stop BEFORE PostgreSQL Client or private-file writes.
process.env.LOCAL_POSTGRES='true';process.env.LOCAL_AUTH_SECRET='fixture-setup-secret'.repeat(3);process.env.SITE_URL='http://127.0.0.1:5195';
process.env.ADMIN_LOGIN_ID='';process.env.ADMIN_PASSWORD_HASH='';process.env.ADMIN_SESSION_SECRET='';process.env.ADMIN_USER_ID='';
process.env.DATABASE_URL='postgresql://fixture:fixture@127.0.0.1:1/fixture';process.env.OWNER_EMAIL='owner@example.invalid';
const origin=process.env.SITE_URL,db=await devDatabase();let checks=0;
const request=(init:RequestInit={})=>new Request(origin+'/admin/setup-login',init);
async function page(){const response=await localAdminSetup(request({headers:{host:'127.0.0.1:5195'}}),db);const html=await response.text();const nonce=html.match(/name="nonce" value="([^"]+)"/)?.[1];assert(nonce);return{response,nonce,cookie:response.headers.getSetCookie()[0].split(';')[0]};}
async function post(p:Awaited<ReturnType<typeof page>>,changes:Record<string,string>={},headers:Record<string,string>={}){return localAdminSetup(request({method:'POST',headers:{host:'127.0.0.1:5195',origin,'content-type':'application/x-www-form-urlencoded',cookie:p.cookie,...headers},body:new URLSearchParams({nonce:p.nonce,username:'fixture-admin',password:'Fixture-only-password-2026!',confirm:'Fixture-only-password-2026!',postgresPassword:'unusable-fixture-install-password',...changes})}),db);}
const check=(name:string)=>{checks++;console.log('PASS '+name);};
try{
 process.env.LOCAL_POSTGRES='false';assert.equal((await localAdminSetup(request({headers:{host:'127.0.0.1:5195'}}),db)).status,404);process.env.LOCAL_POSTGRES='true';check('setup is unavailable outside local mode');
 assert.equal((await localAdminSetup(request({headers:{host:'evil.example'}}),db)).status,404);check('unmatched Host rejects setup');
 let p=await page();assert.equal(p.response.status,200);assert(p.response.headers.get('cache-control')?.includes('no-store'));assert(p.response.headers.get('x-frame-options')==='DENY');assert(p.response.headers.get('set-cookie')?.includes('HttpOnly'));assert(p.response.headers.get('set-cookie')?.includes('SameSite=Strict'));check('setup page and nonce are private');
 assert.equal((await post(p,{}, {origin:'https://attacker.invalid'})).status,403);check('cross-origin setup is rejected');
 assert.equal((await post(p,{nonce:'단'+p.nonce.slice(1)})).status,403);check('Unicode setup nonce is rejected without byte-length exception');
 assert.equal((await post(p,{username:'한글아이디'})).status,400);check('invalid setup ID is rejected before DB authentication');
 assert.equal((await post(p)).status,403);check('setup nonce cannot be replayed');
 p=await page();assert.equal((await post(p,{confirm:'different-fixture-password'})).status,400);check('password confirmation must match');
 p=await page();assert.equal((await post(p,{password:'short',confirm:'short'})).status,400);check('short new password is rejected');
 p=await page();assert.equal((await post(p)).status,403);assert.equal((await db.query("SELECT count(*)::int AS n FROM admin_user WHERE user_id='local-owner'")).rows[0].n,0);check('missing existing Owner prevents both setup and DB administrator connection');
 process.env.ADMIN_LOGIN_ID='fixture-admin';process.env.ADMIN_PASSWORD_HASH=await passwordHash('Fixture-only-password-2026!');process.env.ADMIN_SESSION_SECRET='fixture-session-secret'.repeat(3);process.env.ADMIN_USER_ID='fixture-owner';assert.equal((await localAdminSetup(request({headers:{host:'127.0.0.1:5195'}}),db)).status,303);check('configured setup cannot be reopened to overwrite credentials');
 const report={checks,actualPostgresConnections:0,privateFileReads:0,privateFileWrites:0,externalRequests:0,paidCalls:0};await writeFile('tests/results/local-setup-boundaries-test-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await db.close();}
