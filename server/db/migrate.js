import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'
const { Client } = pg
const dir=path.resolve('server/db/migrations')
const files=(await fs.readdir(dir)).filter(x=>x.endsWith('.sql')).sort()
const client=new Client({host:process.env.PGHOST||'127.0.0.1',port:Number(process.env.PGPORT||5432),database:process.env.PGDATABASE||'safarpro',user:process.env.PGUSER||'safarpro_user',password:process.env.PGPASSWORD||''})
await client.connect()
try{for(const file of files){process.stdout.write(`Applying ${file} ... `);const sql=await fs.readFile(path.join(dir,file),'utf8');await client.query(sql);console.log('ok')}}finally{await client.end()}
console.log('Real estate database migrations completed.')
