export type Data = Record<string, any>;
export interface Db { requestId?:string; query<T = Data>(sql: string, params?: any[]): Promise<{rows:T[]}>; transaction<T>(fn:(db:Db)=>Promise<T>):Promise<T>; }
export interface ContentRow {id:string;kind:string;draft:Data;published:Data|null;revision:number;published_revision:number|null;updated_at:string;published_at:string|null;first_published_at?:string|null;archived:boolean}
export interface Identity {id:string;email:string}
export interface OperationsCapabilities {provider?:(input:Data,signal:AbortSignal)=>Promise<Data>;oauth?:(input:Data)=>Promise<Data>;mediaWrite?:(input:Data)=>Promise<Data>;mediaRead?:(key:string)=>Promise<Uint8Array>;mediaRemove?:(key:string)=>Promise<void>;connectionStatus?:()=>Data;}
export interface EditorialCapabilities {collect?:(url:string,allowedHosts:string[],cached?:Data)=>Promise<Data>;generate?:(input:Data,signal:AbortSignal)=>Promise<Data>;model?:(id:string)=>Promise<Data>;visitorSecret?:string;reflection?:(contentId:string)=>Promise<void>;}
export interface Runtime {db:Db|null;identity:Identity|null;revalidateIdentity?:()=>Promise<Identity|null>;origin:string;ownerId?:string;ownerEmail?:string;privateSite:boolean;clientKey:string;editorial?:EditorialCapabilities;operations?:OperationsCapabilities;notify?:(receipt:string)=>Promise<void>;ai?:(input:{message:string;sources:{id:string;question:string;answer:string}[];policy:Data;model:string;maxTokens:number;signal:AbortSignal})=>Promise<{answer:string;sourceIds:string[];usage?:{inputTokens:number;outputTokens:number}}>;}
export class Fault extends Error { constructor(public status:number, message:string){super(message);} }
export function assert(value:unknown,message:string,status=400):asserts value {if(!value)throw new Fault(status,message);}
export const uid=()=>crypto.randomUUID();
export const iso=()=>new Date().toISOString();
export const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Robots-Tag':'noindex','X-Content-Type-Options':'nosniff'}});
export const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
