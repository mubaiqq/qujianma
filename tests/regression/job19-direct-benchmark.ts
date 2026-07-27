import 'dotenv/config';
import mysql from 'mysql2/promise';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { loadConfig } from '../../src/platform/config.js';
import { decryptLegacySecret } from '../../src/platform/legacy-crypto.js';
import { OpenAiCompatibleClient } from '../../src/modules/ai/client.js';
import { buildImagePrompt, normalizeImageResult } from '../../src/modules/recognition/domain.js';
import { imageRecognitionPayload } from '../../src/modules/recognition/payload.js';

const config=loadConfig(process.env), imagePath=process.argv[2];
if(!imagePath||!config.APP_KEY_HEX)throw new Error('missing image path or APP_KEY_HEX');
const db=await mysql.createConnection({host:config.DB_HOST,port:config.DB_PORT,user:config.DB_USER,password:config.DB_PASSWORD,database:config.DB_NAME});
try{
 const [rows]=await db.execute('SELECT base_url,api_key_ciphertext,model_name FROM ai_providers WHERE user_id=1 AND is_active=1 ORDER BY id DESC LIMIT 1');
 const provider=(rows as Array<{base_url:string;api_key_ciphertext:string;model_name:string}>)[0];if(!provider)throw new Error('active provider missing');
 const [stations]=await db.execute('SELECT id,name,address,courier_names FROM stations WHERE user_id=1 ORDER BY last_used_at DESC LIMIT 20');
 const bytes=await readFile(imagePath),mime=imagePath.endsWith('.webp')?'image/webp':imagePath.endsWith('.jpg')?'image/jpeg':'image/png',prompt=buildImagePrompt(stations as never[]),payload=imageRecognitionPayload(provider.model_name,prompt,[{bytes,mime}]);
 const serialized=Buffer.byteLength(JSON.stringify(payload)),client=new OpenAiCompatibleClient(undefined,config.AI_ALLOW_PRIVATE_URLS),started=performance.now(),ocrChars=(value:unknown):number=>typeof value==='string'?value.length:0;
 try{const raw=client.content(await client.chat(provider.base_url,decryptLegacySecret(provider.api_key_ciphertext,config.APP_KEY_HEX),payload,75_000));console.log(JSON.stringify({status:'success',elapsed_ms:Math.round(performance.now()-started),image_bytes:bytes.length,request_bytes:serialized,prompt_chars:prompt.length,items:normalizeImageResult(raw).length,ocr_chars:ocrChars(raw.ocr_text)}));}
 catch(error){console.log(JSON.stringify({status:'failed',elapsed_ms:Math.round(performance.now()-started),image_bytes:bytes.length,request_bytes:serialized,prompt_chars:prompt.length,error_class:error instanceof Error?error.name:'Error',error:String(error instanceof Error?error.message:error).replace(/https?:\/\/\S+/g,'[redacted-url]')}));process.exitCode=2;}
}finally{await db.end();}
