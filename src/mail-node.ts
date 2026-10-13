import type {Runtime} from './types';

export function mailNotification(env:Record<string,string|undefined>=process.env,transport:typeof fetch=fetch):Runtime['notify']{
 if(env.MAIL_PROVIDER!=='resend'||!env.MAIL_API_KEY||!env.MAIL_FROM||!env.OWNER_EMAIL||!env.SITE_URL)return undefined;
 const from=env.MAIL_FROM,to=env.OWNER_EMAIL,key=env.MAIL_API_KEY,origin=new URL(env.SITE_URL).origin;
 return async receipt=>{
  if(!/^[a-f0-9-]{36}$/.test(receipt))throw new Error('Invalid receipt');
  const response=await transport('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json','Idempotency-Key':'danwi-inquiry-'+receipt},body:JSON.stringify({from,to:[to],subject:'단위소프트 새 문의 접수',text:`새 문의가 관리자에 저장되었습니다.\n접수 번호: ${receipt}\n관리자에서 확인: ${origin}/admin?view=inquiries\n이 알림에는 고객 연락처나 문의 본문을 포함하지 않습니다.`})});
  if(!response.ok){await response.body?.cancel();throw new Error('Notification request failed');}
  await response.body?.cancel();
 };
}
