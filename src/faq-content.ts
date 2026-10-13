import type {Data} from './types';
import {responseHours} from './support-content';
import publicFaqs from './faq-public-content.json';
// Stable question IDs and scopes preserve links and operator history.
export const faqContent:Data[]=publicFaqs.map(f=>[6,42].includes(Number(f.key.slice(-2)))?{...f,body:responseHours+' 상세 검토·현장 방문·실제 오류 복구 일정은 상황과 합의한 작업 범위를 확인해 안내합니다.',answer:responseHours+' 상세 검토·현장 방문·실제 오류 복구 일정은 상황과 합의한 작업 범위를 확인해 안내합니다.'}:f);
