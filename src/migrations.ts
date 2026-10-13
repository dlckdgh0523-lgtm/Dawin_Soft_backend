import {readFile} from 'node:fs/promises';
import type {Db} from './types';
export async function migrateDatabase(db:Db){await db.transaction(async tx=>{
 await tx.query('SELECT pg_advisory_xact_lock(7435801)');
 const exists=(await tx.query("SELECT to_regclass('public.schema_migration') AS name")).rows[0].name;
 const ddl=async(file:string)=>{const source=await readFile(file,'utf8');for(const statement of source.split(/;\s*(?:\r?\n|$)/).map(s=>s.trim()).filter(Boolean))await tx.query(statement);};
 if(!exists)await ddl('db/001_initial.sql');
 for(const version of ['002','003'])if(!(await tx.query('SELECT 1 FROM schema_migration WHERE version=$1',[version])).rows.length)await ddl(`db/${version}_insights.sql`);
 if(!(await tx.query("SELECT 1 FROM schema_migration WHERE version='004'")).rows.length)await ddl('db/004_operations.sql');
 if(!(await tx.query("SELECT 1 FROM schema_migration WHERE version='005'")).rows.length)await ddl('db/005_operations_integrity.sql');
 if(!(await tx.query("SELECT 1 FROM schema_migration WHERE version='006'")).rows.length)await ddl('db/006_admin_sessions.sql');
});}
