import {randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import {readFile,writeFile,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {Client} from 'pg';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {adminAuthConfig,configuredAdmin,passwordHash} from './admin-auth';
import {esc,type Db} from './types';
import {rate,audit} from './store';
const used=new Map<string,number>();let configuring=false;
const execute=promisify(execFile);
const sign=(v:string)=>createHmac('sha256',process.env.LOCAL_AUTH_SECRET!).update(v).digest('hex');
const equal=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
function page(nonce:string,error=''){return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>관리자 계정 설정 | 단위소프트</title><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/admin-access.css"></head><body class="login-body"><header class="login-header"><a class="wordmark" href="/">단위소프트<span>DANWI SOFT</span></a><a href="/admin/login">로그인 화면</a></header><main class="login-main"><p class="login-label">LOCAL SETUP</p><h1>관리자 계정 설정</h1><p class="login-intro">기존 운영자 권한을 확인한 뒤 전용 로그인 계정을 설정합니다. 이 화면은 이 PC에서 최초 한 번만 사용합니다.</p><form class="login-form" method="post" action="/admin/setup-login"><input type="hidden" name="nonce" value="${esc(nonce)}"><label>PostgreSQL 설치 비밀번호<input type="password" name="postgresPassword" required maxlength="200" autocomplete="off"></label><label>관리자 아이디<input name="username" required minlength="3" maxlength="120" pattern="[A-Za-z0-9_.@\\-]+" autocomplete="username"></label><label>새 관리자 비밀번호 · 12자 이상<input type="password" name="password" required minlength="12" maxlength="200" autocomplete="new-password"></label><label>새 비밀번호 확인<input type="password" name="confirm" required minlength="12" maxlength="200" autocomplete="new-password"></label><button class="login-submit" type="submit">계정 설정하고 로그인 화면으로<span aria-hidden="true">→</span></button><p class="login-error" role="alert">${esc(error)}</p></form><p class="login-help">설치 비밀번호는 확인에만 사용하고 저장하지 않습니다. 관리자 비밀번호는 해시로 저장하며 새 운영자나 추가 Owner를 만들지 않습니다.</p></main></body></html>`;}
const response=(body:string,status=200,headers:Record<string,string>={})=>new Response(body,{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','X-Robots-Tag':'noindex','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'",...headers}});
export async function localAdminSetup(req:Request,db:Db){const origin=process.env.SITE_URL??'';
 if(process.env.LOCAL_POSTGRES!=='true'||!process.env.LOCAL_AUTH_SECRET||!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)||req.headers.get('host')!==new URL(origin).host)return response('사용할 수 없는 설정 화면입니다.',404);
 if(configuredAdmin(adminAuthConfig()))return response('',303,{Location:'/admin/login'});
 const newNonce=()=>{const value=randomBytes(24).toString('hex')+'.'+(Date.now()+600000);return value+'.'+sign(value);};
 const show=(error='',status=200)=>{const nonce=newNonce();return response(page(nonce,error),status,{'Set-Cookie':`danwi_setup_nonce=${nonce}; Path=/admin/setup-login; HttpOnly; SameSite=Strict; Max-Age=600`});};
 if(req.method==='GET')return show();
 if(req.method!=='POST'||req.headers.get('origin')!==origin||!req.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))return response('같은 설정 화면에서 다시 시도하세요.',403);
 const body=await req.text();if(body.length>8192)return response('입력 길이를 확인하세요.',413);const form=new URLSearchParams(body),nonce=form.get('nonce')??'',parts=nonce.split('.'),cookie=req.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith('danwi_setup_nonce='))?.slice(18)??'';
 for(const[k,expires]of used)if(expires<Date.now())used.delete(k);
 if(!cookie||!equal(cookie,nonce)||parts.length!==3||!/^\d{13}$/.test(parts[1])||Number(parts[1])<Date.now()||Number(parts[1])>Date.now()+600000||!equal(parts[2],sign(parts[0]+'.'+parts[1]))||used.has(nonce))return show('설정 화면을 새로 열어 주세요.',403);used.set(nonce,Number(parts[1]));
 try{await rate(db,'admin-local-setup',5,60);}catch{return show('잠시 후 다시 시도하세요.',429);}
 const username=form.get('username')??'',password=form.get('password')??'',installPassword=form.get('postgresPassword')??'';
 if(!/^[A-Za-z0-9_.@-]{3,120}$/.test(username)||password.length<12||password.length>200||password!==form.get('confirm')||!installPassword||installPassword.length>200)return show('아이디 형식과 12자 이상 비밀번호·확인을 확인하세요.',400);
 const owner=(await db.query("SELECT user_id,email FROM admin_user WHERE user_id='local-owner' AND role='owner' AND active")).rows[0];if(!owner||owner.email!==process.env.OWNER_EMAIL)return response('기존 운영자 설정을 확인하세요.',403);
 const dbUrl=new URL(process.env.DATABASE_URL!);const client=new Client({host:'127.0.0.1',port:Number(dbUrl.port||5432),user:'postgres',password:installPassword,database:'postgres',connectionTimeoutMillis:5000,statement_timeout:5000});
 try{await client.connect();const role=(await client.query('SELECT current_user AS name,rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0];if(role?.name!=='postgres'||!role.rolsuper)throw Error('Owner verification failed');}
 catch{return show('PostgreSQL 설치 비밀번호를 확인하세요.',401);}finally{try{await client.end();}catch{}}
 if(configuring||configuredAdmin(adminAuthConfig()))return show('계정 설정 상태를 확인한 뒤 로그인 화면으로 이동하세요.',409);configuring=true;
 try{const values={ADMIN_LOGIN_ID:username,ADMIN_PASSWORD_HASH:await passwordHash(password),ADMIN_SESSION_SECRET:randomBytes(32).toString('hex'),ADMIN_USER_ID:owner.user_id};
 // Server-configured private path, never a browser-supplied filesystem destination.
 const file=path.resolve(process.env.LOCAL_ENV_FILE||'.env'),temporary=file+'.admin-setup-'+randomBytes(12).toString('hex');
 try{let contents=await readFile(file,'utf8');for(const[k,v]of Object.entries(values)){const rule=new RegExp('^'+k+'=.*$','m');contents=rule.test(contents)?contents.replace(rule,k+'='+v):contents.trimEnd()+'\n'+k+'='+v+'\n';}await writeFile(temporary,'',{encoding:'utf8',flag:'wx',mode:0o600});if(process.platform==='win32')await execute(path.join(process.env.SystemRoot??'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-File',path.resolve('scripts/preserve-env-acl.ps1'),'-Source',file,'-Destination',temporary],{windowsHide:true,timeout:10000});await writeFile(temporary,contents,{encoding:'utf8'});await rename(temporary,file);}
 catch{return show('보호된 설정 파일에 저장하지 못했습니다. 설정 화면을 다시 확인해 주세요.',503);}finally{try{await rm(temporary,{force:true});}catch{}}
 Object.assign(process.env,values);await audit(db,owner.user_id,'auth.setup','admin');return response('',303,{Location:'/admin/login','Set-Cookie':'danwi_setup_nonce=; Path=/admin/setup-login; HttpOnly; SameSite=Strict; Max-Age=0'});
 }finally{configuring=false;}
}
