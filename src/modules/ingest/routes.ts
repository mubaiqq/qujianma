import type { FastifyInstance, FastifyRequest } from 'fastify';
import { tokenHash } from '../../platform/legacy-crypto.js';
import { IngestAuthError, IngestStorageError, type IngestService } from './service.js';
export interface IngestRouteOptions { service:Pick<IngestService,'ingest'|'ingestManual'>; hashToken?:(token:string)=>string; now?:()=>Date; resolveUserId?:(request:FastifyRequest)=>Promise<number|null>; verifyCsrf?:(request:FastifyRequest)=>Promise<boolean> }
function token(headers:Record<string,string|string[]|undefined>,query:Record<string,unknown>) { const k=typeof query.k==='string'?query.k.trim():''; if(k)return k; const h=typeof headers.authorization==='string'?headers.authorization.trim():''; const m=/^Bearer\s+(.+)$/i.exec(h); return m?.[1]?.trim()??''; }
function field(data:Record<string,unknown>,...names:string[]) { for(const n of names)if(typeof data[n]==='string')return data[n]; return ''; }
function parseForm(raw:string) { return Object.fromEntries(new URLSearchParams(raw)); }
export function registerIngestRoutes(app:FastifyInstance,options:IngestRouteOptions):void {
 void app.register(routes=>{ routes.removeAllContentTypeParsers(); routes.addContentTypeParser('*',{parseAs:'buffer',bodyLimit:16384},(_r,b,d)=>d(null,b));
 routes.all('/api/ingest',async(request,reply)=>{ reply.header('Cache-Control','no-store'); if(request.method!=='GET'&&request.method!=='POST'){reply.header('Allow','GET, POST');return reply.status(405).send({code:1,status:'method_not_allowed',message:'仅支持GET或POST提交短信'});} const query=request.query as Record<string,unknown>; const rawToken=token(request.headers,query); if(!rawToken)return reply.status(401).send({code:1,status:'unauthorized',message:'API Token缺失'});
 let data:Record<string,unknown>; if(request.method==='GET'){data={...query};delete data.k;const txt=request.headers.txt;if(typeof txt==='string'&&!field(data,'txt','text','message'))data.txt=txt;} else { const raw=Buffer.isBuffer(request.body)?request.body.toString('utf8'):''; const ct=String(request.headers['content-type']??'').toLowerCase(), trimmed=raw.trimStart(), json=ct.includes('json')||trimmed.startsWith('{')||trimmed.startsWith('['); if(json){try{const parsed:unknown=JSON.parse(raw);data=parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed as Record<string,unknown>:{};}catch{if(ct.includes('json'))return reply.status(400).send({code:1,status:'invalid_json',message:'JSON格式错误'});data={message:raw.trim()};}}else if(ct.includes('application/x-www-form-urlencoded'))data=parseForm(raw);else data={message:raw.trim()}; }
 const message=field(data,'message','text','txt','sms','content').trim(); if(!message)return reply.status(422).send({code:1,status:'missing_message',message:'没有收到短信正文，请传入txt字段'}); if([...message].length>4000)return reply.status(413).send({code:1,status:'too_large',message:'短信正文不能超过4000字'});
 try{const receivedAt=field(data,'received_at','date'); const result=await options.service.ingest(rawToken,{message,sender:field(data,'sender','from','phone'),...(receivedAt===''?{}:{receivedAt})},request.ip); if(result.status==='duplicate')return {code:0,status:'duplicate',message:'该短信已接收过',data:{message_id:result.messageId,ai_status:result.aiStatus}}; const labels={created:'AI识别并添加成功',not_pickup:'原始短信已保存，AI判断不是取件短信',failed:'原始短信已保存，AI识别失败',no_config:'原始短信已保存，请先配置大模型'}; return {code:0,status:result.status,message:labels[result.status],data:{message_id:result.messageId,sender:result.sender,codes:result.codes,ai_status:result.aiStatus,server_received_at:(options.now?.()??new Date()).toISOString()}};}catch(error){if(error instanceof IngestAuthError)return reply.status(401).send({code:1,status:'unauthorized',message:'API Token错误或已失效'});if(error instanceof IngestStorageError)return reply.status(500).send({code:1,status:'storage_error',message:'短信原文保存失败'});throw error;}
 });
 if(options.resolveUserId&&options.verifyCsrf)routes.post('/api/manual-ingest',async(request,reply)=>{
  reply.header('Cache-Control','no-store');
  const userId=await options.resolveUserId!(request); if(!userId)return reply.status(401).send({code:1,message:'请先登录'});
  if(!await options.verifyCsrf!(request))return reply.status(403).send({code:1,message:'请求验证失败，请刷新页面后重试'});
  let data:Record<string,unknown>={};
  if(Buffer.isBuffer(request.body)){try{const parsed:unknown=JSON.parse(request.body.toString('utf8'));if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))data=parsed as Record<string,unknown>;}catch{return reply.status(400).send({code:1,message:'JSON格式错误'});}}
  else if(request.body&&typeof request.body==='object')data=request.body as Record<string,unknown>;
  const message=typeof data.message==='string'?data.message.trim():'';
  if(!message)return reply.status(422).send({code:1,message:'请粘贴短信内容'});
  if([...message].length>4000)return reply.status(413).send({code:1,message:'短信正文不能超过4000字'});
  try{const result=await options.service.ingestManual(userId,message,request.ip);if(result.status==='duplicate')return {code:0,status:'duplicate',message:'这条短信已经手动添加过',data:{message_id:result.messageId,ai_status:result.aiStatus}};if(result.status==='failed')return reply.status(422).send({code:1,message:'短信已保存，但AI识别失败',data:{message_id:result.messageId}});if(result.status==='no_config')return reply.status(422).send({code:1,message:'短信已保存，请先配置并启用大模型',data:{message_id:result.messageId}});if(result.status==='not_pickup')return reply.status(422).send({code:1,message:'短信已保存，但AI判断不是取件短信',data:{message_id:result.messageId}});return {code:0,status:'created',message:'添加成功',data:{message_id:result.messageId,codes:result.codes}};}catch(error){if(error instanceof IngestStorageError)return reply.status(500).send({code:1,message:'短信原文保存失败'});throw error;}
 });
 });
 void (options.hashToken??tokenHash);
}
