import {adminLoginPage} from './admin-login-page';
import {randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import {Client} from 'pg';
import type {Db} from './types';

const attempts:number[]=[];
const signed=(value:string)=>createHmac('sha256',process.env.LOCAL_AUTH_SECRET!).update(value).digest('hex');
function equal(a:string,b:string){return a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));}
const page=(nonce:string,error='')=>adminLoginPage({local:true,nonce,error});
function response(body:string,status=200,headers:Record<string,string>={}){return new Response(body,{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'",...headers}});}
export async function localLogin(req:Request,db:Db):Promise<Response|null>{
 const route=new URL(req.url).pathname;if(route==='/admin/local-login')return response('',303,{Location:'/admin/login'});if(route==='/admin/logout')return response('',303,{Location:'/admin/login','Set-Cookie':'danwi_local_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'});if(route!=='/admin/login')return null;
 const origin=process.env.SITE_URL!,secret=process.env.LOCAL_AUTH_SECRET!;
 if(!secret||!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin))return response('로컬 로그인 설정을 확인하세요.',503);
 const newNonce=()=>{const value=randomBytes(24).toString('hex')+'.'+(Date.now()+600000);return value+'.'+signed(value);};
 if(req.method==='GET'){const nonce=newNonce();return response(page(nonce),200,{'Set-Cookie':`danwi_login_nonce=${nonce}; Path=/admin/login; HttpOnly; SameSite=Strict; Max-Age=600`});}
 if(req.method!=='POST'||req.headers.get('origin')!==origin||!req.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))return response('같은 로컬 화면에서 다시 시도하세요.',403);
 const text=await req.text();if(text.length>4096)return response('입력 길이를 확인하세요.',413);
 const form=new URLSearchParams(text),nonce=form.get('nonce')??'',cookie=req.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith('danwi_login_nonce='))?.slice(18)??'';
 const parts=nonce.split('.');
 if(!cookie||!equal(cookie,nonce)||parts.length!==3||Number(parts[1])<Date.now()||!equal(parts[2],signed(parts[0]+'.'+parts[1])))return response('로그인 화면을 새로 열어 주세요.',403);
 while(attempts.length&&attempts[0]<Date.now()-60000)attempts.shift();if(attempts.length>=5)return response('잠시 후 다시 시도하세요.',429);attempts.push(Date.now());
 const password=form.get('password')??'';if(!password||password.length>200)return response(page(nonce,'비밀번호를 확인하세요.'),400);
 const dbUrl=new URL(process.env.DATABASE_URL!);const client=new Client({host:'127.0.0.1',port:Number(dbUrl.port||5432),user:'postgres',password,database:'postgres',connectionTimeoutMillis:5000,statement_timeout:5000});
 try{await client.connect();const role=(await client.query('SELECT current_user AS name,rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0];if(role?.name!=='postgres'||!role.rolsuper)throw new Error('Authentication failed');const owner=(await db.query("SELECT email FROM admin_user WHERE user_id='local-owner' AND role='owner' AND active")).rows[0];if(!owner||owner.email!==process.env.OWNER_EMAIL)throw new Error('Existing Owner required');const encoded=Buffer.from(JSON.stringify({id:'local-owner',email:owner.email,expires:Date.now()+43200000})).toString('base64url');return response('',303,{'Location':'/admin','Set-Cookie':`danwi_local_session=${encoded}.${signed(encoded)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200`});}
 catch{return response(page(nonce,'PostgreSQL 설치 비밀번호와 기존 운영자 설정을 확인하세요.'),401);}
 finally{try{await client.end();}catch{}}
}
