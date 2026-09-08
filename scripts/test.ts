import { config } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { readFileSync,readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { Pool } from 'pg';
config({path:'.env.local',quiet:true});
if(!process.env.ADMIN_DATABASE_URL||!process.env.DATABASE_URL)throw new Error('Run npm run setup before database tests.');
const name=`navair_test_${randomBytes(8).toString('hex')}`;
const adminUrl=new URL(process.env.ADMIN_DATABASE_URL),appUrl=new URL(process.env.DATABASE_URL);
if(!['127.0.0.1','localhost'].includes(adminUrl.hostname))throw new Error('The test harness only creates disposable databases on localhost.');
const control=new Pool({connectionString:adminUrl.toString()});
await control.query(`CREATE DATABASE "${name}"`);
adminUrl.pathname=`/${name}`;appUrl.pathname=`/${name}`;
const admin=new Pool({connectionString:adminUrl.toString()});
try{
 for(const file of readdirSync('db/migrations').filter(x=>x.endsWith('.sql')).sort())await admin.query(readFileSync(`db/migrations/${file}`,'utf8'));
 await admin.end();
 const code=await new Promise<number>((resolve,reject)=>{
  const child=spawn(process.execPath,['node_modules/vitest/vitest.mjs','run',...process.argv.slice(2)],{stdio:'inherit',env:{...process.env,DATABASE_URL:appUrl.toString(),ADMIN_DATABASE_URL:adminUrl.toString(),LOCAL_DEMO_MODE:'true',MAIL_MODE:'preview'}});
  child.on('error',reject);child.on('exit',code=>resolve(code??1));
 });
 process.exitCode=code;
}finally{
 await admin.end().catch(()=>{});
 await control.query(`DROP DATABASE "${name}" WITH (FORCE)`);await control.end();
}
