import 'dotenv/config';
import mysql from 'mysql2/promise';
import {readFile} from 'node:fs/promises';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {performance} from 'node:perf_hooks';
const db=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_WRITE_USER||process.env.DB_USER,password:process.env.DB_WRITE_PASSWORD??process.env.DB_PASSWORD,database:process.env.DB_NAME});
let userId=0; const prefix=`perf_job19_${Date.now()}`;
try{
 const [u]=await db.execute("INSERT INTO users(username,password_hash) VALUES(?,'benchmark-no-login')",[prefix]); userId=u.insertId;
 const token=randomBytes(32).toString('hex'), tokenHash=createHash('sha256').update(token).digest('hex'), csrf=createHmac('sha256',token).update('pickup-csrf').digest('hex');
 await db.execute("INSERT INTO login_tokens(user_id,token_hash,expires_at) VALUES(?,?,DATE_ADD(NOW(),INTERVAL 1 DAY))",[userId,tokenHash]);
 await db.execute("INSERT INTO ai_providers(user_id,display_name,base_url,api_key_ciphertext,api_key_hint,model_name,is_active,last_test_status) SELECT ?,'benchmark-isolated',base_url,api_key_ciphertext,'',model_name,1,'untested' FROM ai_providers WHERE user_id=1 AND is_active=1 ORDER BY id DESC LIMIT 1",[userId]);
 const imagePath=process.argv[2]||'/tmp/qujianma-job19-benchmark/job19.png',mime=imagePath.endsWith('.jpg')?'image/jpeg':imagePath.endsWith('.webp')?'image/webp':'image/png'; const image=await readFile(imagePath); const form=new FormData(); form.append('images[]',new Blob([image],{type:mime}),`benchmark.${mime==='image/jpeg'?'jpg':mime.split('/')[1]}`);
 const started=new Date(); const t0=performance.now(); const response=await fetch('http://127.0.0.1:32200/api/image_recognize.php',{method:'POST',headers:{cookie:`${process.env.COOKIE_NAME||'pickup_login'}=${token}`,'x-csrf-token':csrf},body:form}); const accepted=new Date(); const body=await response.json(); const acceptMs=Math.round(performance.now()-t0); const messageId=Number(body?.data?.message_ids?.[0]); console.log(JSON.stringify({kind:'enqueue',http_status:response.status,accept_ms:acceptMs,started:started.toISOString(),accepted:accepted.toISOString(),queue_status:body?.data?.status??null,message_id_present:Number.isSafeInteger(messageId)}));
 if(!messageId)throw new Error('enqueue did not return message id');
 let row; const pollStart=performance.now();
 while(performance.now()-pollStart<190000){const [rows]=await db.execute(`SELECT j.id,j.status,j.created_at,j.started_at,j.completed_at,j.updated_at,j.attempt_count,m.ai_status,m.ai_processed_at,CHAR_LENGTH(COALESCE(m.raw_message,'')) ocr_chars,JSON_LENGTH(JSON_EXTRACT(m.ai_result_json,'$.items')) items FROM recognition_jobs j JOIN incoming_messages m ON m.id=j.message_id WHERE j.message_id=? AND j.user_id=?`,[messageId,userId]);row=rows[0];if(row&&['succeeded','failed'].includes(row.status))break;await new Promise(r=>setTimeout(r,250));}
 if(!row)throw new Error('job missing'); console.log(JSON.stringify({kind:'e2e_result',status:row.status,ai_status:row.ai_status,attempts:row.attempt_count,queue_wait_ms:row.started_at?new Date(row.started_at).getTime()-accepted.getTime():null,worker_to_job_end_ms:row.started_at&&row.completed_at?new Date(row.completed_at).getTime()-new Date(row.started_at).getTime():null,accept_to_db_end_ms:row.completed_at?new Date(row.completed_at).getTime()-accepted.getTime():null,total_client_poll_ms:Math.round(performance.now()-t0),items:row.items??0,ocr_chars:row.ocr_chars??0,parcel_count:row.parcel_count??0,persist_at_present:Boolean(row.ai_processed_at)}));
}finally{
 if(userId){await db.execute('DELETE FROM users WHERE id=?',[userId]);const [tables]=await db.execute("SELECT table_name FROM information_schema.columns WHERE table_schema=? AND column_name='user_id'",[process.env.DB_NAME]);let residual=0;for(const {TABLE_NAME} of tables){const [rows]=await db.execute(`SELECT COUNT(*) n FROM \`${TABLE_NAME}\` WHERE user_id=?`,[userId]);residual+=Number(rows[0].n);}const [users]=await db.execute('SELECT COUNT(*) n FROM users WHERE id=?',[userId]);residual+=Number(users[0].n);console.log(JSON.stringify({kind:'cleanup',tables_checked:tables.length+1,residual_rows:residual}));}
 await db.end();
}
