import {randomBytes,scrypt as nodeScrypt,createHmac,timingSafeEqual,createHash} from 'node:crypto';
import {Fault,type Db,type Identity} from './types';
import {adminLoginPage} from './admin-login-page';
import {audit,rate} from './store';
const scrypt=(password:string,salt:string,length:number,options:{N:number;r:number;p:number;maxmem:number})=>new Promise<Buffer>((resolve,reject)=>nodeScrypt(password,salt,length,options,(error,result)=>error?reject(error):resolve(result)));
export interface AdminAuthConfig {loginId:string;passwordHash:string;sessionSecret:string;userId:string;origin:string;local:boolean}
export function adminAuthConfig():AdminAuthConfig{return{loginId:process.env.ADMIN_LOGIN_ID??'',passwordHash:process.env.ADMIN_PASSWORD_HASH??'',sessionSecret:process.env.ADMIN_SESSION_SECRET??'',userId:process.env.ADMIN_USER_ID??'',origin:process.env.SITE_URL!,local:process.env.LOCAL_POSTGRES==='true'};}
export function configuredAdmin(c:AdminAuthConfig){return c.loginId.length>=3&&c.loginId.length<=120&&/^scrypt:32768:8:3:[a-f0-9]{32}:[a-f0-9]{128}$/.test(c.passwordHash)&&c.sessionSecret.length>=32&&!!c.userId;}
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const sign=(v:string,c:AdminAuthConfig)=>createHmac('sha256',c.sessionSecret).update(v).digest('hex');
const equal=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
// The frontend replaces client headers and signs this pseudonymous network key.
const clientKey=(req:Request)=>{const value=req.headers.get('x-danwi-client')??'';return /^[a-f0-9]{64}$/.test(value)?value:'local';};
const cookieValue=(req:Request,name:string)=>req.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1)??'';
const cookie=(name:string,value:string,c:AdminAuthConfig,age:number)=>`${name}=${value}; Path=/; HttpOnly; SameSite=${name==='danwi_admin_session'?'Lax':'Strict'}; Max-Age=${age}${c.local?'':'; Secure'}`;
function html(body:string,status=200,headers:Record<string,string>={}){return new Response(body,{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','X-Robots-Tag':'noindex,nofollow','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'",...headers}});}
export async function passwordHash(password:string){if(password.length<12||password.length>200)throw Error('비밀번호는 12~200자로 설정해 주세요.');const salt=randomBytes(16).toString('hex');const derived=await scrypt(password,salt,64,{N:32768,r:8,p:3,maxmem:64*1024*1024}) as Buffer;return`scrypt:32768:8:3:${salt}:${derived.toString('hex')}`;}
async function verify(password:string,encoded:string){const parts=encoded.split(':');const value=await scrypt(password,parts[4],64,{N:32768,r:8,p:3,maxmem:64*1024*1024}) as Buffer;return equal(value.toString('hex'),parts[5]);}
export async function adminIdentity(req:Request,db:Db,c:AdminAuthConfig):Promise<Identity|null>{if(!configuredAdmin(c))return null;const token=cookieValue(req,'danwi_admin_session');if(!/^[a-f0-9]{64}$/.test(token))return null;const row=(await db.query("SELECT u.user_id,u.email FROM admin_session s JOIN admin_user u ON u.user_id=s.user_id WHERE s.token_hash=$1 AND s.credential_version=$2 AND s.expires_at>now() AND s.revoked_at IS NULL AND u.active AND s.operator_session_version=u.session_version AND u.user_id=$3",[hash(token),hash(c.passwordHash+c.sessionSecret+c.loginId+c.userId),c.userId])).rows[0];return row?{id:row.user_id,email:row.email}:null;}
export async function adminLogin(req:Request,db:Db,c:AdminAuthConfig):Promise<Response|null>{const path=new URL(req.url).pathname;
 if(path==='/admin/local-login')return html('',303,{Location:'/admin/login'});
 if(path==='/admin/logout'){
  if(req.method!=='POST')return html('로그아웃 버튼을 사용해 주세요.',405);if(req.headers.get('sec-fetch-site')==='cross-site'||req.headers.get('origin')!==c.origin)return html('같은 사이트에서 요청해 주세요.',403);
  const token=cookieValue(req,'danwi_admin_session');if(/^[a-f0-9]{64}$/.test(token))await db.query('UPDATE admin_session SET revoked_at=now() WHERE token_hash=$1',[hash(token)]);
  return html('',303,{Location:'/admin/login','Set-Cookie':cookie('danwi_admin_session','',c,0)});
 }
 if(path!=='/admin/login')return null;
 if(!configuredAdmin(c))return html(adminLoginPage({passwordLogin:true,unconfigured:true,local:c.local}),503);
 const newNonce=()=>{const value=randomBytes(24).toString('hex')+'.'+(Date.now()+600000);return value+'.'+sign(value,c);};
 const loginPage=async(error='',status=200)=>{
  // The gateway signs this pseudonymous client value; do not allow unlimited nonce rows on refresh.
  try{await rate(db,'admin-login-page:'+hash(c.userId)+':'+clientKey(req),30,60);}catch(limit){if(limit instanceof Fault&&limit.status===429)return html(adminLoginPage({passwordLogin:true,error:'요청이 많습니다. 잠시 후 로그인 화면을 다시 열어 주세요.',local:c.local}),429);throw limit;}
  const nonce=newNonce();await db.query("INSERT INTO admin_login_nonce(nonce_hash,expires_at) VALUES($1,now()+interval '10 minutes')",[hash(nonce)]);await db.query("DELETE FROM admin_login_nonce WHERE expires_at<now()-interval '1 day'");return html(adminLoginPage({passwordLogin:true,nonce,error}),status,{'Set-Cookie':cookie('danwi_admin_nonce',nonce,c,600)});};
 if(req.method==='GET')return loginPage();
 if(req.method!=='POST')return html('지원하지 않는 요청입니다.',405);
 if(req.headers.get('origin')!==c.origin||!req.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))return html('로그인 화면에서 다시 시도하세요.',403);
 const text=await req.text();if(text.length>4096)return html('입력 길이를 확인하세요.',413);const form=new URLSearchParams(text),nonce=form.get('nonce')??'',parts=nonce.split('.');
 if(!equal(nonce,cookieValue(req,'danwi_admin_nonce'))||parts.length!==3||!/^\d{13}$/.test(parts[1])||Number(parts[1])<Date.now()||Number(parts[1])>Date.now()+600000||!equal(parts[2],sign(parts[0]+'.'+parts[1],c)))return html('로그인 화면을 새로 열어 주세요.',403);
 const consumed=await db.query('UPDATE admin_login_nonce SET consumed_at=now() WHERE nonce_hash=$1 AND consumed_at IS NULL AND expires_at>now() RETURNING nonce_hash',[hash(nonce)]);if(!consumed.rows.length)return html('로그인 화면을 새로 열어 주세요.',403);
 // A single guessing client must not lock out every other operator browser.
 // Keep an aggregate budget against distributed attempts in addition to the strict client quota.
 try{await rate(db,'admin-login:'+c.userId+':'+clientKey(req),5,60);await rate(db,'admin-login-total:'+c.userId,30,60);}catch{return loginPage('잠시 후 다시 시도하세요.',429);}
 const username=form.get('username')??'',password=form.get('password')??'';if(username.length>120||!password||password.length>200)return loginPage('아이디 또는 비밀번호를 확인하세요.',401);
 const valid=await verify(password,c.passwordHash);const user=(await db.query('SELECT user_id,email,session_version FROM admin_user WHERE user_id=$1 AND active',[c.userId])).rows[0];
 if(!valid||!equal(username,c.loginId)||!user){await audit(db,'login','auth.login-failed','admin');return loginPage('아이디 또는 비밀번호를 확인하세요.',401);}
 const token=randomBytes(32).toString('hex');await db.transaction(async tx=>{const previousToken=cookieValue(req,'danwi_admin_session');if(/^[a-f0-9]{64}$/.test(previousToken))await tx.query('UPDATE admin_session SET revoked_at=now() WHERE token_hash=$1',[hash(previousToken)]);await tx.query("INSERT INTO admin_session(token_hash,user_id,credential_version,operator_session_version,expires_at) VALUES($1,$2,$3,$4,now()+interval '8 hours')",[hash(token),user.user_id,hash(c.passwordHash+c.sessionSecret+c.loginId+c.userId),user.session_version]);await tx.query("DELETE FROM admin_session WHERE expires_at<now()-interval '7 days'");await audit(tx,user.user_id,'auth.login','admin');});
 const headers=new Headers({'Location':'/admin','Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});headers.append('Set-Cookie',cookie('danwi_admin_session',token,c,28800));headers.append('Set-Cookie',cookie('danwi_admin_nonce','',c,0));return new Response(null,{status:303,headers});
}
