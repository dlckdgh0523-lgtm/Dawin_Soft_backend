import {assert,Fault,type Runtime,type Data} from './types';
import {operator} from './store';
import {adminEventActions,adminEventLabels} from './admin-event-types';

const connections=new Map<string,number>();
export function eventCursor(req:Request){const value=req.headers.get('last-event-id')??'0';assert(/^\d{1,19}$/.test(value)&&BigInt(value)<=9223372036854775807n,'알림 연결 식별값을 확인해 주세요.');return BigInt(value).toString();}
function eventDto(row:Data){return {id:String(row.id),action:row.action,label:adminEventLabels[row.action]??'',contentId:row.target,revision:row.detail?.revision??null,at:row.created_at};}
export async function adminEvents(req:Request,rt:Runtime,options={interval:2000,lifetime:55000}){
 assert(req.method==='GET','지원하지 않는 요청입니다.',405);
 assert(!req.headers.has('origin')||req.headers.get('origin')===rt.origin,'같은 사이트에서 요청해 주세요.',403);
 assert(req.headers.get('sec-fetch-site')!=='cross-site','같은 사이트에서 요청해 주세요.',403);
 await operator(rt,'content');const requested=eventCursor(req),db=rt.db!;
 const snapshot=async()=> (await db.query(`SELECT (SELECT count(*)::int FROM article_state s JOIN content c ON c.id=s.content_id WHERE s.state='NEEDS_REVIEW' AND NOT c.archived) AS pending, (SELECT coalesce(max(id),0)::text FROM audit_log WHERE action=ANY($1) AND outcome='success') AS cursor`,[adminEventActions])).rows[0];
 // A role/session may be revoked while the initial database snapshot is being read.
 const initial=await snapshot();await operator(rt,'content');assert(BigInt(requested)<=BigInt(initial.cursor),'알림 연결 식별값을 다시 확인해 주세요.');
 const userId=rt.identity!.id;assert((connections.get(userId)??0)<4,'이미 여러 관리자 화면에서 알림을 받고 있습니다.',429);connections.set(userId,(connections.get(userId)??0)+1);let released=false;const release=()=>{if(released)return;released=true;const left=(connections.get(userId)??1)-1;if(left)connections.set(userId,left);else connections.delete(userId);};
 let cursor=requested==='0'?initial.cursor:requested,stopped=false,timer:ReturnType<typeof setTimeout>|undefined;
 const encoder=new TextEncoder();let cleanup=()=>{};
 const stream=new ReadableStream<Uint8Array>({
  start(controller){const send=(event:string,data:unknown,id?:string)=>{if(!stopped)controller.enqueue(encoder.encode(`${id!==undefined?'id: '+id+'\n':''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));};
   const stop=()=>{if(stopped)return;stopped=true;release();clearTimeout(timer);req.signal.removeEventListener('abort',stop);controller.close();};cleanup=()=>{stopped=true;release();clearTimeout(timer);req.signal.removeEventListener('abort',stop);};
   req.signal.addEventListener('abort',stop,{once:true});if(req.signal.aborted){stop();return;}
   controller.enqueue(encoder.encode('retry: 3000\n\n'));send('snapshot',{pending:initial.pending,cursor:initial.cursor});
   const started=Date.now();let lastHeartbeat=started;
   const poll=async()=>{try{
    await operator(rt,'content');if(stopped)return;
    const rows=(await db.query("SELECT id::text,action,target,detail,created_at FROM audit_log WHERE action=ANY($1) AND outcome='success' AND id>$2::bigint ORDER BY audit_log.id LIMIT 100",[adminEventActions,cursor])).rows;
    // Recheck membership after the read, before disclosing any event.
    await operator(rt,'content');if(stopped)return;
    for(const row of rows){cursor=String(row.id);send('notification',eventDto(row),cursor);}
    const current=await snapshot();await operator(rt,'content');if(stopped)return;send('snapshot',{pending:current.pending,cursor:current.cursor},rows.length?undefined:cursor);
    if(Date.now()-lastHeartbeat>=10000){controller.enqueue(encoder.encode(': heartbeat\n\n'));lastHeartbeat=Date.now();}
    if(Date.now()-started>=options.lifetime){stop();return;}timer=setTimeout(poll,options.interval);
   }catch(error){if(!stopped){send(error instanceof Fault&&[401,403].includes(error.status)?'access-ended':'connection-error',{message:'알림 연결을 확인해 주세요.'});stop();}}};
   void poll();
  },cancel(){clearTimeout(timer);cleanup();}
 });
 return new Response(stream,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'private, no-store, no-transform','X-Accel-Buffering':'no','X-Robots-Tag':'noindex','X-Content-Type-Options':'nosniff'}});
}
