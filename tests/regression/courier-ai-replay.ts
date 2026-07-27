import 'dotenv/config';
import { createConnection } from 'mysql2/promise';
import { readFileSync, writeFileSync } from 'node:fs';
import { decryptLegacySecret } from '../../src/platform/legacy-crypto.js';
import { OpenAiCompatibleClient } from '../../src/modules/ai/client.js';
import { pickupRecognitionStandard } from '../../src/modules/recognition/domain.js';

type Fixture={source_id:number;ocr_text:string;expected_courier_name:string};
const fixtures=JSON.parse(readFileSync(new URL('./courier-layer-fixtures.json',import.meta.url),'utf8')) as Fixture[];
const required=(name:string):string=>{const value=process.env[name];if(value===undefined)throw new Error(`missing ${name}`);return value;};
const db=await createConnection({host:required('DB_HOST'),port:Number(process.env.DB_PORT??3306),database:required('DB_NAME'),user:required('DB_USER'),password:required('DB_PASSWORD'),charset:'utf8mb4'});
try{
  const [grantRows]=await db.query('SHOW GRANTS');
  const grants=Object.values((grantRows as Record<string,unknown>[])[0]??{}).map(String);
  if(!grants.length||grants.some((x)=>/\b(?:INSERT|UPDATE|DELETE|ALL PRIVILEGES)\b/iu.test(x))) throw new Error('拒绝运行：数据库账号不是可证明的只读账号');
  const [rows]=await db.execute('SELECT base_url,api_key_ciphertext,model_name FROM ai_providers WHERE user_id=1 AND is_active=1 ORDER BY id DESC LIMIT 1');
  const provider=(rows as {base_url:string;api_key_ciphertext:string;model_name:string}[])[0];
  if(!provider||!process.env.APP_KEY_HEX) throw new Error('active provider or APP_KEY_HEX unavailable');
  const key=decryptLegacySecret(provider.api_key_ciphertext,process.env.APP_KEY_HEX);
  if(!key) throw new Error('provider credential decrypt failed');
  const evidence=fixtures.map(({source_id,ocr_text})=>({source_id,ocr_text}));
  const schema='严格输出：{"items":[{"source_id":integer,"courier_name":string,"evidence":string}]}。每条都输出；不确定courier_name留空。';
  const prompts={
    current:`${pickupRecognitionStandard()}\n${schema}\n以下是图片OCR区块：${JSON.stringify(evidence)}`,
    enhanced:`${pickupRecognitionStandard()}\n增强明确规则：courier_name只能是承运包裹的快递公司。人名、收件人、取件人、快递员姓名一律不是快递公司；孤立姓名必须留空。地址或station_name内部出现的“圆通速递、韵达超市”等品牌词只描述领取网点，不证明该包裹由该公司承运，必须留空。只有OCR明确写“某某快递包裹”、运单所属公司或独立承运商标签时才填写。\n${schema}\n以下是图片OCR区块：${JSON.stringify(evidence)}`,
  };
  const client=new OpenAiCompatibleClient();
  const results:Record<string,unknown>={model:provider.model_name};
  for(const [variant,prompt] of Object.entries(prompts)){
    const response=await client.chat(provider.base_url,key,{model:provider.model_name,messages:[{role:'system',content:'只输出严格JSON，不输出思考过程。'},{role:'user',content:prompt}],temperature:0,response_format:{type:'json_object'}},45_000);
    results[variant]=client.content(response);
  }
  writeFileSync(new URL('./courier-ai-replay-output.json',import.meta.url),`${JSON.stringify(results,null,2)}\n`,{mode:0o600});
  console.log(JSON.stringify(results,null,2));
}finally{await db.end();}
