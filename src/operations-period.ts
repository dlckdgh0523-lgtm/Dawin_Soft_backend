import type {Db,Data} from './types';

// Provider dates and dimensions remain separate. Only additive daily definitions
// can form a period value; unique users, reach and lifetime snapshots cannot.
export async function dailyPeriodReports(db:Db,w:Data):Promise<Data[]>{
 const days=(Date.parse(w.end)-Date.parse(w.start))/86400000+1;
 const result=await db.query(`WITH chosen AS (
 SELECT DISTINCT ON(m.account_id,m.report,m.dimension_key,m.metric,m.query_version,m.timezone,m.currency,m.window_start,m.window_end)
 m.*,a.provider,a.name AS account_name,d.aggregation,d.definition
 FROM metric_snapshot m JOIN marketing_account a ON a.id=m.account_id
 JOIN metric_definition d ON d.name=m.metric
 WHERE m.voided_at IS NULL AND m.grain='day' AND m.window_start=m.window_end
 AND m.window_start BETWEEN $1 AND $2 AND d.aggregation='sum'
 ORDER BY m.account_id,m.report,m.dimension_key,m.metric,m.query_version,m.timezone,m.currency,m.window_start,m.window_end,
 CASE m.source_type WHEN 'api' THEN 0 ELSE 1 END,m.observed_at DESC
 ) SELECT account_id,report,dimension_key,metric,query_version,timezone,currency,provider,account_name,aggregation,definition,
 sum(value)::text AS value,count(DISTINCT window_start)::int AS covered_days,
 CASE WHEN count(DISTINCT window_start)=$3 AND bool_and(status='complete' AND value IS NOT NULL) THEN 'complete' ELSE 'partial' END AS status,
 CASE WHEN bool_and(source_type='api') THEN 'api' WHEN bool_and(source_type='csv') THEN 'csv' ELSE 'mixed' END AS source_type,
 max(observed_at) AS observed_at
 FROM chosen GROUP BY account_id,report,dimension_key,metric,query_version,timezone,currency,provider,account_name,aggregation,definition`,[w.start,w.end,days]);
 return result.rows.map(r=>({...r,grain:'period',window_start:w.start,window_end:w.end,provider_metadata:{aggregation:'additive_daily',coveredDays:r.covered_days,expectedDays:days}}));
}

export function withCtr(reports:Data[]):Data[]{
 const output=[...reports];
 for(const clicks of reports.filter(r=>r.metric==='clicks'&&r.value!==null&&r.status==='complete')){
  const impressions=reports.find(r=>r.metric==='impressions'&&r.value!==null&&r.status==='complete'&&['account_id','report','dimension_key','query_version','timezone','window_start','window_end','source_type'].every(k=>String(r[k])===String(clicks[k])));
  if(!impressions||Number(impressions.value)<=0)continue;
  const value=Number(clicks.value)/Number(impressions.value)*100;
  if(Number.isFinite(value))output.push({...clicks,metric:'ctr',value:value.toFixed(4),definition:'동일 출처·보고 범위의 전체 클릭 ÷ 전체 노출 × 100. 일별 CTR 평균이 아닙니다.',provider_metadata:{...clicks.provider_metadata,aggregation:'weighted_ratio'}});
 }
 return output;
}
