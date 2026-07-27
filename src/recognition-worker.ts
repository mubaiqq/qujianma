import 'dotenv/config';
import { loadConfig } from './platform/config.js';
import { createDatabase } from './platform/database.js';
import { decryptLegacySecret } from './platform/legacy-crypto.js';
import { OpenAiCompatibleClient } from './modules/ai/client.js';
import { MysqlRecognitionRepository } from './modules/recognition/repository.js';
import { RecognitionService, type UploadedImage } from './modules/recognition/service.js';
import { imageRecognitionPayload } from './modules/recognition/payload.js';
import { ImageRecognitionWorker } from './worker/recognition.js';
import { MysqlRecognitionWorkerRepository } from './worker/recognition-repository.js';
import { runWorkerLoop } from './worker/runtime.js';

async function main():Promise<void>{
  const config=loadConfig(process.env);
  if(!config.RECOGNITION_WORKER_ENABLED){console.info(JSON.stringify({service:'qujianma-recognition-worker',event:'worker_disabled'}));return;}
  const appKey=config.APP_KEY_HEX;if(!appKey)throw new Error('识别Worker需要APP_KEY_HEX');
  const database=createDatabase(config);const pool=database.write as never;const ai=new OpenAiCompatibleClient(undefined,config.AI_ALLOW_PRIVATE_URLS);
  const service=new RecognitionService(new MysqlRecognitionRepository(pool),{decrypt:(value)=>decryptLegacySecret(value,appKey),textAi:()=>Promise.reject(new Error('recognition worker does not process text')),imageAi:async(base,key,model,prompt,images:UploadedImage[])=>ai.content(await ai.chat(base,key,imageRecognitionPayload(model,prompt,images),75_000))});
  const worker=new ImageRecognitionWorker(new MysqlRecognitionWorkerRepository(pool),{uploadRoot:config.RECOGNITION_UPLOAD_ROOT??'/var/lib/qujianma-node/recognition-uploads',maxAttempts:1,process:(messageId,userId,images)=>service.processQueuedImage(messageId,userId,images)});
  const abort=new AbortController();const stop=()=>abort.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{await runWorkerLoop(async()=>{const result=await worker.runOnce();if(result.status!=='idle')console.info(JSON.stringify({service:'qujianma-recognition-worker',...result}));},{intervalMs:1000,signal:abort.signal});}finally{await database.close();}
}
main().catch((error:unknown)=>{process.exitCode=1;console.error(JSON.stringify({service:'qujianma-recognition-worker',event:'fatal',error:error instanceof Error?error.message:String(error)}));});
