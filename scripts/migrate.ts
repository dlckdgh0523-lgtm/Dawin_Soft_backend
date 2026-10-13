import {postgres} from '../src/db';import {migrateDatabase} from '../src/migrations';
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
const db=postgres(process.env.DATABASE_URL);try{await migrateDatabase(db);console.log('Additive migrations applied; existing records retained');}finally{await db.close();}
