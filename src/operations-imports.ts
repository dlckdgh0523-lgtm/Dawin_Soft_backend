import {assert,uid,type Db,type Data} from './types';
import {snapshots} from './operations-core';
import {audit} from './store';
export async function commitImport(db:Db,accountId:string,id:string,rows:Data[],actor:string){return db.transaction(async tx=>{
 await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',['import:'+accountId]);
 const batch=(await tx.query('SELECT * FROM marketing_import WHERE id=$1 AND account_id=$2 FOR UPDATE',[id,accountId])).rows[0];assert(batch,'가져오기 계정을 확인하세요.',404);if(batch.status==='committed')return;
 assert(batch.status==='preview','취소한 파일은 새 정정 파일로 등록해 주세요.',409);
 for(const row of rows){const report=row.report??'manual-import',grain=row.grain??'period',dimension=row.dimensionKey??'';
  await tx.query('INSERT INTO metric_import_value(id,import_id,account_id,report,grain,window_start,window_end,query_version,dimension_key,metric,value,status,timezone,currency) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT DO NOTHING',[uid(),id,accountId,report,grain,row.start,row.end,'mapping-1',dimension,row.metric,row.value,'complete',row.timezone,row.currency??null]);
  await snapshots(tx,accountId,{start:row.start,end:row.end,sourceType:'csv',importId:id},{report,grain,queryVersion:'mapping-1',timezone:row.timezone,metrics:[{...row,dimensionKey:dimension,status:'complete'}]});
 }
 await tx.query("UPDATE marketing_import SET status='committed',committed_at=clock_timestamp() WHERE id=$1",[id]);await audit(tx,actor,'import.commit',id,{rows:rows.length});
});}
export async function cancelImport(db:Db,accountId:string,id:string,actor:string,reason:string){return db.transaction(async tx=>{
 await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',['import:'+accountId]);const batch=(await tx.query('SELECT * FROM marketing_import WHERE id=$1 AND account_id=$2 FOR UPDATE',[id,accountId])).rows[0];assert(batch,'가져오기 계정을 확인하세요.',404);if(batch.status==='cancelled')return;
 await tx.query("UPDATE marketing_import SET status='cancelled' WHERE id=$1",[id]);
 const affected=(await tx.query('SELECT * FROM metric_snapshot WHERE account_id=$1 AND import_id=$2 AND source_type=\'csv\' FOR UPDATE',[accountId,id])).rows;
 for(const current of affected){const previous=(await tx.query("SELECT v.* FROM metric_import_value v JOIN marketing_import b ON b.id=v.import_id WHERE v.account_id=$1 AND v.report=$2 AND v.grain=$3 AND v.window_start=$4 AND v.window_end=$5 AND v.query_version=$6 AND v.dimension_key=$7 AND v.metric=$8 AND b.status='committed' ORDER BY b.committed_at DESC,v.created_at DESC LIMIT 1",[accountId,current.report,current.grain,current.window_start,current.window_end,current.query_version,current.dimension_key,current.metric])).rows[0];
  if(previous)await snapshots(tx,accountId,{start:previous.window_start,end:previous.window_end,sourceType:'csv',importId:previous.import_id},{report:previous.report,grain:previous.grain,queryVersion:previous.query_version,timezone:previous.timezone,metrics:[{metric:previous.metric,value:previous.value,currency:previous.currency,dimensionKey:previous.dimension_key,status:previous.status}]});
  else await tx.query('UPDATE metric_snapshot SET voided_at=now() WHERE id=$1',[current.id]);
 }await audit(tx,actor,'import.cancel',id,{reason});
});}
