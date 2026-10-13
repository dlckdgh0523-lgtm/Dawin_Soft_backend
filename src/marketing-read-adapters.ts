/** Standalone review prototype. No code here authorizes an account, publishes,
 * spends money, or calls an API until a caller explicitly invokes a read method.
 * Root must integrate the existing durable queue, encrypted credentials and RBAC.
 */
import { createHmac, randomBytes, createHash } from 'node:crypto';

export type Provider = 'GA4'|'GSC'|'THREADS'|'INSTAGRAM_LOGIN'|'GOOGLE_ADS'|'META_ADS'|'NAVER_SEARCH_AD'|'NAVER_WEB_SEARCH'|'NAVER_BLOG';
export type Json = null|boolean|number|string|Json[]|{[key:string]:Json};
export type DataState = 'AVAILABLE'|'PROVISIONAL'|'PARTIAL'|'UNCONNECTED'|'AUTH_REQUIRED'|'UNSUPPORTED'|'FAILED';
export interface Window { startDate:string; endDate:string; timeZone:string|null }
export interface EpochWindow { since:number; until:number }
export interface ReadContext {
  accessToken?:string;
  fetchImpl?:typeof fetch;
  signal?:AbortSignal;
  timeoutMs?:number;
  maxBytes?:number;
  now?:()=>Date;
}
export interface Report {
  provider:Provider;
  accountId:string;
  collectedAt:string;
  requestedWindow:Window|null;
  sourceWindow:Json;
  sourceTimeZone:string|null;
  currency:string|null;
  grain:'PERIOD_AGGREGATE'|'DAILY'|'DETAIL'|'LIFETIME_SNAPSHOT'|'PROVIDER_DEFINED';
  state:DataState;
  coverage:'SOURCE_AGGREGATE'|'TOP_ROWS'|'PAGINATED_SLICE'|'PROVIDER_DEFINED';
  definitionVersion:'2026-10-08.v1';
  flags:string[];
  data:Json;
  metadata:Json;
  nextCursor:string|null;
}
export type SafeErrorCode = 'UNCONNECTED'|'AUTH_REQUIRED'|'PERMISSION_DENIED'|'RATE_LIMITED'|'TIMEOUT'|'ABORTED'|'INVALID_CONFIG'|'UNSUPPORTED'|'PROVIDER_ERROR'|'INVALID_RESPONSE'|'RESPONSE_TOO_LARGE';
export class AdapterError extends Error {
  constructor(public readonly code:SafeErrorCode, public readonly httpStatus:number|null=null, public readonly retryAfterSeconds:number|null=null) {
    super(code); this.name='AdapterError';
  }
}

const GOOGLE_AUTH='https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN='https://oauth2.googleapis.com/token';
export const oauthSpecs = {
  GA4:{authorizationEndpoint:GOOGLE_AUTH,tokenEndpoint:GOOGLE_TOKEN,revocationEndpoint:'https://oauth2.googleapis.com/revoke',scopes:['https://www.googleapis.com/auth/analytics.readonly'],pkce:'S256',offlineParameter:'access_type=offline',verified:'PRIMARY_DOCS'},
  GSC:{authorizationEndpoint:GOOGLE_AUTH,tokenEndpoint:GOOGLE_TOKEN,revocationEndpoint:'https://oauth2.googleapis.com/revoke',scopes:['https://www.googleapis.com/auth/webmasters.readonly'],pkce:'S256',offlineParameter:'access_type=offline',verified:'PRIMARY_DOCS'},
  GOOGLE_ADS:{authorizationEndpoint:GOOGLE_AUTH,tokenEndpoint:GOOGLE_TOKEN,revocationEndpoint:'https://oauth2.googleapis.com/revoke',scopes:['https://www.googleapis.com/auth/adwords'],pkce:'S256',offlineParameter:'access_type=offline',verified:'PRIMARY_DOCS',readOnlyCaveat:'No read-only OAuth scope. Enforce read-only account role and endpoint allowlist. Developer token sunset 2026-09-09; Cloud project API access is required.'},
  THREADS:{authorizationEndpoint:'https://www.threads.com/oauth/authorize',tokenEndpoint:'https://graph.threads.com/oauth/access_token',extendEndpoint:'https://graph.threads.com/access_token',extendGrant:'th_exchange_token',refreshEndpoint:'https://graph.threads.com/refresh_access_token',refreshGrant:'th_refresh_token',scopes:['threads_basic','threads_manage_insights'],pkce:'NOT_VERIFIED',verified:'OFFICIAL_SAMPLE',callbackCaveat:'Official sample requires an HTTPS hostname and does not support localhost callbacks.'},
  INSTAGRAM_LOGIN:{authorizationEndpoint:'https://www.instagram.com/oauth/authorize',tokenEndpoint:'https://api.instagram.com/oauth/access_token',extendEndpoint:'https://graph.instagram.com/access_token',extendGrant:'ig_exchange_token',refreshEndpoint:'https://graph.instagram.com/refresh_access_token',refreshGrant:'ig_refresh_token',scopes:['instagram_business_basic','instagram_business_manage_insights'],pkce:'NOT_VERIFIED',verified:'APP_PERMISSION_AND_METRIC_MATRIX_REQUIRE_VERIFICATION',loginPath:'Instagram professional account with Instagram Login; do not mix Facebook Page login token or fb_exchange_token.'},
  META_ADS:{authorizationEndpoint:'https://www.facebook.com/{appVersion}/dialog/oauth',tokenEndpoint:'https://graph.facebook.com/{appVersion}/oauth/access_token',scopes:['ads_read'],pkce:'NOT_VERIFIED',verified:'META_OWNED_REPORT_SAMPLE',readOnlyCaveat:'Reporting only. Do not request ads_management or implement campaign/budget mutations.'},
} as const;

export function createOAuthState():string { return randomBytes(32).toString('base64url'); }
export function createGooglePkce():{verifier:string;challenge:string;method:'S256'} {
  const verifier=randomBytes(48).toString('base64url');
  return {verifier,challenge:createHash('sha256').update(verifier).digest('base64url'),method:'S256'};
}

function fail():never { throw new AdapterError('INVALID_CONFIG'); }
function numericId(input:string):string { if(!/^\d{1,30}$/.test(input))fail();return input; }
function version(input:string):string { if(!/^v\d{1,2}\.\d{1,2}$/.test(input))fail();return input; }
function date(input:string):string {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input))fail();
  const t=new Date(input+'T00:00:00.000Z');if(!Number.isFinite(t.valueOf())||t.toISOString().slice(0,10)!==input)fail();return input;
}
function window(input:Window):Window {
  date(input.startDate);date(input.endDate);
  if(input.startDate>input.endDate||(Date.parse(input.endDate)-Date.parse(input.startDate))/86400000>366)fail();
  if(input.timeZone!==null){try{new Intl.DateTimeFormat('en',{timeZone:input.timeZone});}catch{fail();}}
  return input;
}
function epochWindow(input:EpochWindow):EpochWindow {
  if(!Number.isSafeInteger(input.since)||!Number.isSafeInteger(input.until)||input.since<0||input.until<=input.since||input.until-input.since>367*86400)fail();return input;
}
function bearer(ctx:ReadContext):Record<string,string> {
  if(!ctx.accessToken)throw new AdapterError('UNCONNECTED');
  if(ctx.accessToken.length>8192||/[\r\n]/.test(ctx.accessToken))fail();
  return {Authorization:'Bearer '+ctx.accessToken};
}
function cleanJson(value:unknown,secrets:string[],depth=0):Json {
  if(depth>14)throw new AdapterError('INVALID_RESPONSE');
  if(value===null||typeof value==='boolean')return value;
  if(typeof value==='number'){if(!Number.isFinite(value))throw new AdapterError('INVALID_RESPONSE');return value;}
  if(typeof value==='string'){
    let out=value;for(const secret of secrets)if(secret.length>5)out=out.split(secret).join('[redacted]');
    return out.replace(/([?&](?:access_token|client_secret|refresh_token|api_key|code)=)[^&#\s]*/gi,'$1[redacted]');
  }
  if(Array.isArray(value))return value.map(v=>cleanJson(v,secrets,depth+1));
  if(typeof value==='object'&&value){const out:{[k:string]:Json}={};for(const [k,v]of Object.entries(value)){
    if(/^(access_token|refresh_token|client_secret|authorization|password|secret|api_key|signature)$/i.test(k))continue;
    if(k==='__proto__'||k==='prototype'||k==='constructor')continue;
    out[k]=cleanJson(v,secrets,depth+1);
  }return out;}
  throw new AdapterError('INVALID_RESPONSE');
}
function record(value:unknown):Record<string,unknown> { if(!value||Array.isArray(value)||typeof value!=='object')throw new AdapterError('INVALID_RESPONSE');return value as Record<string,unknown>; }
function retryAfter(input:string|null):number|null {
  if(!input)return null;const seconds=/^\d+$/.test(input)?Number(input):(Date.parse(input)-Date.now())/1000;
  return Number.isFinite(seconds)?Math.max(0,Math.min(3600,Math.ceil(seconds))):null;
}
async function requestJson(ctx:ReadContext,url:URL,method:'GET'|'POST'='GET',body?:unknown,extraHeaders:Record<string,string>={},useBearer=true,additionalSecrets:string[]=[],allowArray=false):Promise<Record<string,unknown>> {
  // All URLs are constructed below from fixed providers, never caller-supplied URLs.
  const controller=new AbortController();const abort=()=>controller.abort(ctx.signal?.reason);
  if(ctx.signal?.aborted)throw new AdapterError('ABORTED');ctx.signal?.addEventListener('abort',abort,{once:true});
  const timeout=Math.min(30000,Math.max(500,ctx.timeoutMs??12000));let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeout);
  try{
    const response=await(ctx.fetchImpl??fetch)(url,{method,headers:{...(useBearer?bearer(ctx):{}),Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'}),...extraHeaders},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal,redirect:'error'});
    if(!response.ok){
      const code:SafeErrorCode=response.status===401?'AUTH_REQUIRED':response.status===403?'PERMISSION_DENIED':response.status===429?'RATE_LIMITED':'PROVIDER_ERROR';
      await response.body?.cancel();throw new AdapterError(code,response.status,retryAfter(response.headers.get('retry-after')));
    }
    const limit=Math.min(8*1024*1024,Math.max(1024,ctx.maxBytes??4*1024*1024));
    const contentLength=response.headers.get('content-length');if(contentLength&&Number(contentLength)>limit){await response.body?.cancel();throw new AdapterError('RESPONSE_TOO_LARGE');}
    if(!response.body)throw new AdapterError('INVALID_RESPONSE');
    const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
    while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>limit){await reader.cancel();throw new AdapterError('RESPONSE_TOO_LARGE');}chunks.push(chunk.value);}
    const joined=new Uint8Array(size);let at=0;for(const chunk of chunks){joined.set(chunk,at);at+=chunk.byteLength;}
    let parsed:unknown;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(joined));}catch{throw new AdapterError('INVALID_RESPONSE');}
    // A few providers return a provider error in HTTP 200. Never return raw error text.
    const result:Record<string,unknown>=allowArray&&Array.isArray(parsed)?{providerArray:parsed}:record(parsed);
    if(result.error||(result.errorCode!==undefined&&result.errorCode!==0&&result.errorCode!=='0'))throw new AdapterError('PROVIDER_ERROR',response.status);
    return record(cleanJson(result,[ctx.accessToken??'',...Object.values(extraHeaders),...additionalSecrets]));
  }catch(e){
    if(e instanceof AdapterError)throw e;
    if(timedOut)throw new AdapterError('TIMEOUT');if(ctx.signal?.aborted)throw new AdapterError('ABORTED');
    throw new AdapterError('PROVIDER_ERROR');
  }finally{clearTimeout(timer);ctx.signal?.removeEventListener('abort',abort);}
}
function url(base:string,path:string,params:Record<string,string|number|undefined>={}):URL {
  const result=new URL(path,base);for(const [key,val]of Object.entries(params))if(val!==undefined)result.searchParams.set(key,String(val));return result;
}
function report(ctx:ReadContext,input:Omit<Report,'collectedAt'|'definitionVersion'>):Report {
  return {...input,collectedAt:(ctx.now?.()??new Date()).toISOString(),definitionVersion:'2026-10-08.v1'};
}
function text(value:unknown):string|null {return typeof value==='string'?value:null;}
function openDay(ctx:ReadContext,input:Window,sourceTimeZone:string|null):boolean {
  if(!sourceTimeZone)return false;
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:sourceTimeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(ctx.now?.()??new Date());
  const pick=(type:string)=>parts.find(p=>p.type===type)?.value;
  const today=`${pick('year')}-${pick('month')}-${pick('day')}`;return input.endDate>=today;
}
function currencyCode(input:string|null):string|null {if(input!==null&&!/^[A-Z]{3}$/.test(input))fail();return input;}
const GA4_METRICS=['activeUsers','totalUsers','sessions','screenPageViews','eventCount','engagedSessions'] as const;
const GA4_DIMENSIONS=['date','pagePath','landingPage','sessionSourceMedium','sessionCampaignName','eventName'] as const;
function allowedNames(names:string[],allowed:readonly string[],max:number):void {
  if(names.length>max||new Set(names).size!==names.length||names.some(name=>!allowed.includes(name)))fail();
}
export async function discoverGa4(ctx:ReadContext,pageToken?:string) {
  if(pageToken&&pageToken.length>4096)fail();
  return requestJson(ctx,url('https://analyticsadmin.googleapis.com','/v1beta/accountSummaries',{pageSize:200,pageToken}));
}
export async function ga4Metadata(ctx:ReadContext,propertyId:string) {
  return requestJson(ctx,url('https://analyticsdata.googleapis.com',`/v1beta/properties/${numericId(propertyId)}/metadata`));
}
export async function ga4CheckCompatibility(ctx:ReadContext,propertyId:string,dimensions:string[],metrics:string[]) {
  allowedNames(dimensions,GA4_DIMENSIONS,9);allowedNames(metrics,GA4_METRICS,10);if(!metrics.length)fail();
  return requestJson(ctx,url('https://analyticsdata.googleapis.com',`/v1beta/properties/${numericId(propertyId)}:checkCompatibility`),'POST',{dimensions:dimensions.map(name=>({name})),metrics:metrics.map(name=>({name})),compatibilityFilter:'COMPATIBLE'});
}
export async function ga4Report(ctx:ReadContext,propertyId:string,input:Window,dimensions:string[],metrics:string[],offset=0):Promise<Report> {
  window(input);numericId(propertyId);allowedNames(dimensions,GA4_DIMENSIONS,9);allowedNames(metrics,GA4_METRICS,10);if(!metrics.length||!Number.isSafeInteger(offset)||offset<0||offset>250000)fail();
  const raw=await requestJson(ctx,url('https://analyticsdata.googleapis.com',`/v1beta/properties/${propertyId}:runReport`),'POST',{dimensions:dimensions.map(name=>({name})),metrics:metrics.map(name=>({name})),dateRanges:[{startDate:input.startDate,endDate:input.endDate}],limit:'10000',offset:String(offset),returnPropertyQuota:true});
  const metadata=raw.metadata?record(raw.metadata):{};const flags:string[]=[];
  for(const key of ['dataLossFromOtherRow','subjectToThresholding'])if(metadata[key]===true)flags.push(key);
  for(const key of ['samplingMetadatas','dataTruncationReasons'])if(Array.isArray(metadata[key])&&(metadata[key]as unknown[]).length)flags.push(key);
  if(dimensions.includes('date')&&metrics.some(m=>['activeUsers','totalUsers'].includes(m)))flags.push('UNIQUE_USERS_NOT_ADDITIVE_OVER_DAYS');
  const count=Array.isArray(raw.rows)?raw.rows.length:0;const more=Number(raw.rowCount??0)>offset+count;
  if(more&&count===0)throw new AdapterError('INVALID_RESPONSE');
  if(more)flags.push('PAGINATION_INCOMPLETE');
  const sourceTimeZone=text(metadata.timeZone)??input.timeZone;const provisional=openDay(ctx,input,sourceTimeZone);if(provisional)flags.push('INCLUDES_UNFINISHED_DAY');
  return report(ctx,{provider:'GA4',accountId:propertyId,requestedWindow:input,sourceWindow:cleanJson(raw.dateRanges??[{startDate:input.startDate,endDate:input.endDate}],[]),sourceTimeZone,currency:text(metadata.currencyCode),grain:dimensions.length===0?'PERIOD_AGGREGATE':dimensions.length===1&&dimensions[0]==='date'?'DAILY':'DETAIL',state:provisional?'PROVISIONAL':more||flags.some(f=>f!=='UNIQUE_USERS_NOT_ADDITIVE_OVER_DAYS')?'PARTIAL':'AVAILABLE',coverage:dimensions.length?'PAGINATED_SLICE':'SOURCE_AGGREGATE',flags,data:cleanJson({dimensionHeaders:raw.dimensionHeaders??[],metricHeaders:raw.metricHeaders??[],rows:raw.rows??[],totals:raw.totals??[]},[]),metadata:cleanJson({reportMetadata:metadata,propertyQuota:raw.propertyQuota??null,rowCount:raw.rowCount??null},[]),nextCursor:more?String(offset+count):null});
}
export async function discoverGsc(ctx:ReadContext) {return requestJson(ctx,url('https://www.googleapis.com','/webmasters/v3/sites'));}
function gscSite(input:string):string {
  if(/^sc-domain:[a-z0-9.-]+$/i.test(input)&&input.length<=300)return input;
  let parsed:URL;try{parsed=new URL(input);}catch{return fail();}
  if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.hash||parsed.search||input.length>1000)fail();return input;
}
export async function gscReport(ctx:ReadContext,siteUrl:string,input:Window,dimensions:string[]=[],dataState:'final'|'all'='final',startRow=0):Promise<Report> {
  window(input);gscSite(siteUrl);allowedNames(dimensions,['date','page','query','device','country'],5);if(!Number.isSafeInteger(startRow)||startRow<0||startRow>100000)fail();
  const raw=await requestJson(ctx,url('https://www.googleapis.com',`/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`),'POST',{startDate:input.startDate,endDate:input.endDate,dimensions,type:'web',dataState,rowLimit:25000,startRow,aggregationType:'auto'});
  const rows=Array.isArray(raw.rows)?raw.rows:[];const more=rows.length===25000;
  return report(ctx,{provider:'GSC',accountId:siteUrl,requestedWindow:input,sourceWindow:cleanJson({startDate:input.startDate,endDate:input.endDate,dataState},[]),sourceTimeZone:'America/Los_Angeles',currency:null,grain:dimensions.length===0?'PERIOD_AGGREGATE':dimensions.length===1&&dimensions[0]==='date'?'DAILY':'DETAIL',state:dataState==='all'?'PROVISIONAL':more?'PARTIAL':'AVAILABLE',coverage:dimensions.some(d=>d==='query'||d==='page')?'TOP_ROWS':'SOURCE_AGGREGATE',flags:[...(dimensions.length?['DETAILS_NOT_GUARANTEED_COMPLETE']:[]),...(more?['PAGINATION_INCOMPLETE']:[]),'CTR_WEIGHTED_BY_IMPRESSIONS','POSITION_IS_REPORT_AVERAGE'],data:cleanJson(rows,[]),metadata:cleanJson({responseAggregationType:raw.responseAggregationType??null,providerMetadata:raw.metadata??null},[]),nextCursor:more?String(startRow+rows.length):null});
}

function social(ctx:ReadContext,provider:'THREADS'|'INSTAGRAM_LOGIN',accountId:string,raw:Record<string,unknown>,input:Window|null,sourceWindow:Json,grain:Report['grain']):Report {
  const paging=raw.paging?record(raw.paging):{};const cursors=paging.cursors?record(paging.cursors):{};
  return report(ctx,{provider,accountId,requestedWindow:input,sourceWindow,sourceTimeZone:input?.timeZone??null,currency:null,grain,state:'AVAILABLE',coverage:'PROVIDER_DEFINED',flags:['PRESERVE_PROVIDER_PERIOD_TOTAL_VALUE_AND_END_TIME','DO_NOT_SUM_LIFETIME_OR_UNIQUE_REACH',...(provider==='INSTAGRAM_LOGIN'?['APP_PERMISSION_AND_METRIC_MATRIX_UNVERIFIED']:[])],data:cleanJson(raw.data??raw,[]),metadata:cleanJson({pagingCursors:cursors,providerTimeZoneNotAssumed:true},[]),nextCursor:text(cursors.after)});
}
export async function discoverThreads(ctx:ReadContext) {return requestJson(ctx,url('https://graph.threads.com','/me',{fields:'id,username'}));}
export async function threadsPosts(ctx:ReadContext,accountId:string,after?:string) {
  if(after&&after.length>4096)fail();return requestJson(ctx,url('https://graph.threads.com',`/${numericId(accountId)}/threads`,{fields:'id,permalink,timestamp,media_type',limit:100,after}));
}
export async function threadsAccountInsights(ctx:ReadContext,accountId:string,input:Window,epochs:EpochWindow,metric:string):Promise<Report> {
  window(input);epochWindow(epochs);allowedNames([metric],['views','likes','replies','reposts','quotes','clicks','followers_count'],1);
  const raw=await requestJson(ctx,url('https://graph.threads.com',`/${numericId(accountId)}/threads_insights`,{metric,since:epochs.since,until:epochs.until}));
  return social(ctx,'THREADS',accountId,raw,input,cleanJson(epochs,[]),'PROVIDER_DEFINED');
}
export async function threadsPostInsights(ctx:ReadContext,accountId:string,postId:string,metric:string):Promise<Report> {
  numericId(accountId);allowedNames([metric],['views','likes','replies','reposts','quotes','shares'],1);
  const raw=await requestJson(ctx,url('https://graph.threads.com',`/${numericId(postId)}/insights`,{metric}));
  return social(ctx,'THREADS',accountId,raw,null,{postId,period:'lifetime'},'LIFETIME_SNAPSHOT');
}
// Version must come from the configured Meta app, not an invented latest-version default.
export async function discoverInstagramLogin(ctx:ReadContext,apiVersion:string) {
  return requestJson(ctx,url('https://graph.instagram.com',`/${version(apiVersion)}/me`,{fields:'user_id,username'}));
}
export async function instagramLoginMedia(ctx:ReadContext,apiVersion:string,accountId:string,after?:string) {
  if(after&&after.length>4096)fail();return requestJson(ctx,url('https://graph.instagram.com',`/${version(apiVersion)}/${numericId(accountId)}/media`,{fields:'id,permalink,timestamp,media_type,media_product_type',limit:100,after}));
}
export async function instagramLoginInsights(ctx:ReadContext,apiVersion:string,accountId:string,targetId:string,metric:string,kind:'ACCOUNT'|'MEDIA',input?:Window,epochs?:EpochWindow):Promise<Report> {
  numericId(accountId);const params:Record<string,string|number|undefined>={metric};
  if(kind==='ACCOUNT'){
    allowedNames([metric],['views','reach','likes','comments','shares','saves','total_interactions'],1);
    if(!input||!epochs)fail();window(input);epochWindow(epochs);params.period='day';params.metric_type='total_value';params.since=epochs.since;params.until=epochs.until;
  }else allowedNames([metric],['views','reach','likes','comments','saved','shares','total_interactions'],1);
  const raw=await requestJson(ctx,url('https://graph.instagram.com',`/${version(apiVersion)}/${numericId(targetId)}/insights`,params));
  return social(ctx,'INSTAGRAM_LOGIN',accountId,raw,input??null,kind==='MEDIA'?{mediaId:targetId,period:'lifetime'}:cleanJson(epochs,[]),kind==='MEDIA'?'LIFETIME_SNAPSHOT':'PROVIDER_DEFINED');
}

const ADS_VERSION='v25';
function googleAdsHeaders(loginCustomerId?:string):Record<string,string> {return loginCustomerId?{'login-customer-id':numericId(loginCustomerId)}:{};}
export async function discoverGoogleAds(ctx:ReadContext) {
  return requestJson(ctx,url('https://googleads.googleapis.com',`/${ADS_VERSION}/customers:listAccessibleCustomers`));
}
export async function googleAdsAccount(ctx:ReadContext,customerId:string,loginCustomerId?:string) {
  return requestJson(ctx,url('https://googleads.googleapis.com',`/${ADS_VERSION}/customers/${numericId(customerId)}/googleAds:search`),'POST',{query:'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1'},googleAdsHeaders(loginCustomerId));
}
export async function googleAdsCampaignReport(ctx:ReadContext,customerId:string,input:Window,currency:string|null,pageToken?:string,loginCustomerId?:string):Promise<Report> {
  window(input);currencyCode(currency);if(pageToken&&pageToken.length>4096)fail();
  const raw=await requestJson(ctx,url('https://googleads.googleapis.com',`/${ADS_VERSION}/customers/${numericId(customerId)}/googleAds:search`),'POST',{query:`SELECT campaign.id, campaign.name, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros FROM campaign WHERE segments.date BETWEEN '${input.startDate}' AND '${input.endDate}'`,...(pageToken?{pageToken}:{})},googleAdsHeaders(loginCustomerId));
  const next=text(raw.nextPageToken);
  return report(ctx,{provider:'GOOGLE_ADS',accountId:customerId,requestedWindow:input,sourceWindow:{startDate:input.startDate,endDate:input.endDate},sourceTimeZone:input.timeZone,currency,grain:'DETAIL',state:openDay(ctx,input,input.timeZone)?'PROVISIONAL':next?'PARTIAL':'AVAILABLE',coverage:'PAGINATED_SLICE',flags:['COST_IS_INTEGER_MICROS','REPORT_ONLY_NO_MUTATIONS',...(!input.timeZone?['ACCOUNT_TIMEZONE_NOT_CONFIGURED']:[])],data:cleanJson(raw.results??[],[]),metadata:cleanJson({fieldMask:raw.fieldMask??null},[]),nextCursor:next});
}
export async function discoverMetaAds(ctx:ReadContext,apiVersion:string,after?:string) {
  if(after&&after.length>4096)fail();return requestJson(ctx,url('https://graph.facebook.com',`/${version(apiVersion)}/me/adaccounts`,{fields:'id,name,currency,timezone_name,account_status',limit:100,after}));
}
export async function metaAdsCampaignReport(ctx:ReadContext,apiVersion:string,accountId:string,input:Window,currency:string|null,after?:string):Promise<Report> {
  window(input);currencyCode(currency);if(after&&after.length>4096)fail();const id=numericId(accountId.replace(/^act_/,''));
  const raw=await requestJson(ctx,url('https://graph.facebook.com',`/${version(apiVersion)}/act_${id}/insights`,{fields:'account_id,account_currency,campaign_id,campaign_name,date_start,date_stop,impressions,clicks,spend',level:'campaign',time_range:JSON.stringify({since:input.startDate,until:input.endDate}),time_increment:1,limit:100,after}));
  const paging=raw.paging?record(raw.paging):{};const cursors=paging.cursors?record(paging.cursors):{};const next=text(cursors.after);const more=Boolean(paging.next);
  return report(ctx,{provider:'META_ADS',accountId:id,requestedWindow:input,sourceWindow:{since:input.startDate,until:input.endDate,time_increment:1},sourceTimeZone:input.timeZone,currency,grain:'DETAIL',state:openDay(ctx,input,input.timeZone)?'PROVISIONAL':more?'PARTIAL':'AVAILABLE',coverage:'PAGINATED_SLICE',flags:['ACCOUNT_LOCAL_DATES','REPORT_ONLY_ADS_READ'],data:cleanJson(raw.data??[],[]),metadata:{pagingCursors:cleanJson(cursors,[])},nextCursor:more?next:null});
}
export interface NaverCredentials {apiKey:string;secretKey:string;customerId:string}
function naverHeaders(credentials:NaverCredentials,path:string):Record<string,string> {
  numericId(credentials.customerId);if(!credentials.apiKey||!credentials.secretKey||/[\r\n]/.test(credentials.apiKey))fail();
  const timestamp=String(Date.now());const signature=createHmac('sha256',credentials.secretKey).update(`${timestamp}.GET.${path}`).digest('base64');
  return {'X-Timestamp':timestamp,'X-API-KEY':credentials.apiKey,'X-Customer':credentials.customerId,'X-Signature':signature};
}
async function naverGet(ctx:ReadContext,credentials:NaverCredentials,path:'/stats'|'/ncc/campaigns',params:Record<string,string|number|undefined>={}):Promise<Record<string,unknown>> {
  // Naver uses signed headers, not Bearer; native array responses retain their shape under providerArray.
  const headers=naverHeaders(credentials,path);
  const raw=await requestJson(ctx,url('https://api.searchad.naver.com',path,params),'GET',undefined,headers,false,[credentials.secretKey,credentials.apiKey],true);
  return raw;
}
export async function discoverNaverSearchAd(ctx:ReadContext,credentials:NaverCredentials) {return naverGet(ctx,credentials,'/ncc/campaigns');}
export async function naverSearchAdReport(ctx:ReadContext,credentials:NaverCredentials,campaignId:string,input:Window,currency:string|null):Promise<Report> {
  window(input);currencyCode(currency);if(!/^[A-Za-z0-9_-]{1,100}$/.test(campaignId))fail();
  const raw=await naverGet(ctx,credentials,'/stats',{id:campaignId,fields:JSON.stringify(['impCnt','clkCnt','salesAmt']),timeRange:JSON.stringify({since:input.startDate,until:input.endDate}),timeIncrement:1});
  return report(ctx,{provider:'NAVER_SEARCH_AD',accountId:credentials.customerId,requestedWindow:input,sourceWindow:{since:input.startDate,until:input.endDate,timeIncrement:1},sourceTimeZone:input.timeZone,currency,grain:'DAILY',state:'AVAILABLE',coverage:'PROVIDER_DEFINED',flags:['SALES_AMT_IS_AD_SPEND_NOT_CONTRACT_REVENUE','NCC_AND_STATS_READ_PATHS_ONLY'],data:cleanJson(raw.providerArray??raw,[]),metadata:{campaignId},nextCursor:null});
}
export const manualOnlyProviders = {
  NAVER_WEB_SEARCH:{apiState:'UNSUPPORTED',importState:'AVAILABLE',reason:'No official general performance API verified. Import authorized Search Advisor report. Web search excludes blog and ad statistics.',source:'https://searchadvisor.naver.com/guide/report-expose-ctr'},
  NAVER_BLOG:{apiState:'UNSUPPORTED',importState:'AVAILABLE',reason:'Naver Blog Search API discovers public documents, not private owned-account performance. Register owned post URL and import authorized statistics.',source:'https://developers.naver.com/docs/serviceapi/search/blog/blog.md'},
} as const;

/** Integration tests should inject fetchImpl; this module never makes a call on import. */
