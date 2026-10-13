import {assert,uid,type Runtime,type Data} from './types';
import {operator,audit} from './store';
import {pageQuery,text} from './operations-core';

export async function mediaOperations(rt:Runtime,url:URL,raw?:Data){
 const user=await operator(rt,'content'),db=rt.db!;
 if(!raw){
  const q='%'+(url.searchParams.get('q')??'')+'%';
  const data=await pageQuery(db,url,'FROM media_asset',"WHERE inquiry_id IS NULL AND archived=$1 AND (original_name ILIKE $2 OR alt ILIKE $2 OR description ILIKE $2)",[url.searchParams.get('state')==='trash',q],'created_at DESC,id');
  for(const row of data.rows){delete row.bytes;delete row.storage_key;}
  return{ok:true,...data};
 }
 const id=raw.id||uid();
 assert(typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id),'미디어 식별값을 확인하세요.');
 let file:Data|undefined,supersededKey:string|undefined,result:Data;
 try{
  result=await db.transaction(async tx=>{
   // Share the publication fence so a file cannot be archived/replaced between
   // a content reference check and the content's approved publication commit.
   await tx.query('SELECT pg_advisory_xact_lock(7435802)');
   await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',['media:'+id]);
   assert((await tx.query("SELECT 1 FROM admin_user WHERE user_id=$1 AND active AND role IN ('owner','editor') FOR SHARE",[user.user_id])).rows.length,'미디어 운영자의 권한이 회수되었습니다.',403);
   const old=(await tx.query('SELECT * FROM media_asset WHERE id=$1 FOR UPDATE',[id])).rows[0];
   assert(!old?.inquiry_id,'문의 파일은 문의에서 관리하세요.',403);
   const references=(await tx.query("SELECT DISTINCT content_id AS id FROM content_version WHERE body::text LIKE $1 UNION SELECT id FROM content WHERE draft::text LIKE $1 OR published::text LIKE $1",['%'+id+'%'])).rows;
   if(raw.action==='archive'||raw.action==='delete'){
    assert(old,'미디어를 찾을 수 없습니다.',404);
    assert(!references.length,'초안·공개·저장 버전에서 사용 중입니다. 먼저 연결을 해제하세요.',409);
    await tx.query("UPDATE media_asset SET archived=true,visibility='private',updated_at=now() WHERE id=$1",[id]);
    await audit(tx,user.user_id,'media.archive',id);
    return{ok:true};
   }
   assert(['public','private'].includes(raw.visibility),'공개 상태를 확인하세요.');
   assert(!references.length||raw.visibility==='public','저장 버전에서 사용 중인 파일은 공개 상태를 유지하세요.',409);
   const alt=text(raw.alt??'',500),description=text(raw.description??'',2000);
   const tags=Array.isArray(raw.tags)?raw.tags.map((t:unknown)=>text(t,60)):[];
   assert(tags.length<=20,'태그는 20개 이하로 입력하세요.');
   if(raw.file){
    assert(!old||!references.length,'사용 중인 파일 교체는 새 파일 ID로 등록하세요.',409);
    assert(rt.operations?.mediaWrite,'이미지 저장소 연결이 필요합니다.',503);
    file=await rt.operations.mediaWrite({...raw.file,visibility:raw.visibility});
   }
   if(old){
    if(file){
     await tx.query("UPDATE media_asset SET original_name=$2,mime=$3,bytes=$4,size=$5,alt=$6,visibility=$7,storage_backend='filesystem',storage_key=$8,checksum=$9,description=$10,tags=$11,archived=false,updated_at=now() WHERE id=$1",[id,text(raw.file.name,160,true),file.mime,new Uint8Array(),file.size,alt,raw.visibility,file.key,file.checksum,description,tags]);
     if(old.storage_backend==='filesystem')supersededKey=old.storage_key;
    }else{
     await tx.query('UPDATE media_asset SET alt=$2,visibility=$3,description=$4,tags=$5,archived=false,updated_at=now() WHERE id=$1',[id,alt,raw.visibility,description,tags]);
    }
   }else{
    assert(file,'이미지를 선택하세요.');
    await tx.query("INSERT INTO media_asset(id,original_name,mime,bytes,size,alt,visibility,storage_backend,storage_key,checksum,description,tags) VALUES($1,$2,$3,$4,$5,$6,$7,'filesystem',$8,$9,$10,$11)",[id,text(raw.file.name,160,true),file.mime,new Uint8Array(),file.size,alt,raw.visibility,file.key,file.checksum,description,tags]);
   }
   await audit(tx,user.user_id,'media.save',id,{sanitized:!!file});
   return{ok:true,id};
  });
 }catch(error){
  // Only discard the uncommitted replacement. Never delete the file referenced
  // by the original row when validation, DB commit or its audit fails.
  if(file)try{await rt.operations?.mediaRemove?.(file.key);}catch{}
  throw error;
 }
 if(supersededKey){
  try{await rt.operations?.mediaRemove?.(supersededKey);}catch{
   // The database already committed successfully. Do not misreport the save as
   // failed or discard its live file because an obsolete-file cleanup failed.
   result.cleanupPending=true;
  }
 }
 return result;
}

