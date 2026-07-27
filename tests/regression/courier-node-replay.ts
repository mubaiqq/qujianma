import { readFileSync } from 'node:fs';
import { buildLocalPickupResult, normalizeImageResult, validatePickupResult } from '../../src/modules/recognition/domain.js';

type Fixture={source_id:number;ocr_text:string;model_courier_name:string;expected_courier_name:string};
const fixtures=JSON.parse(readFileSync(new URL('./courier-layer-fixtures.json',import.meta.url),'utf8')) as Fixture[];
const cases=fixtures.map((fixture)=>{
  const code=`R-2-${String(fixture.source_id).slice(-2)}01`;
  const imageItem=normalizeImageResult({items:[{pickup_code:code,courier_name:fixture.model_courier_name}]})[0];
  if(!imageItem) throw new Error(`fixture ${fixture.source_id} did not normalize`);
  const checked=validatePickupResult(imageItem as unknown as Record<string,unknown>,fixture.ocr_text,[]);
  const actual=checked.ok?checked.data.courier_name:'<rejected>';
  return {source_id:fixture.source_id,image_normalized:imageItem.courier_name,validated:actual,local:buildLocalPickupResult(fixture.ocr_text,'2026-07-25 20:00:00',[]).courier_name,expected:fixture.expected_courier_name,pass:actual===fixture.expected_courier_name};
});
console.log(JSON.stringify({runtime:'node',cases},null,2));
process.exitCode=cases.some((x)=>!x.pass)?1:0;
