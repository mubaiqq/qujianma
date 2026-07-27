import { createHash } from 'node:crypto';
export type AiStatus='created'|'not_pickup'|'failed'|'no_config';
export interface AiProcessor { process(messageId:number,userId:number):Promise<{status:AiStatus;codes?:string[]}> }
export interface IngestRecord { userId:number;sender:string;rawSender:string;rawMessage:string;receivedAt:string;fingerprint:string;clientIp:string }
export interface IngestRepository { authenticate(tokenHash:string):Promise<{userId:number}|null>; findDuplicate(userId:number,fingerprint:string):Promise<{messageId:number;aiStatus:string}|null>; claimStalePending(userId:number,messageId:number):Promise<boolean>; insert(record:IngestRecord):Promise<number>; findDuplicateAfterConflict(userId:number,fingerprint:string):Promise<{messageId:number;aiStatus:string}|null>; markFailed(messageId:number,userId:number,error:string):Promise<void> }
export interface IngestInput { message:string;sender?:string;receivedAt?:string }
export class IngestAuthError extends Error {}
export class IngestStorageError extends Error {}
export function normalizeSmsText(text:string):string { return text.replace(/[\u200B\uFEFF\r]/gu,'').replaceAll('：',':').replaceAll('，',',').replaceAll('；',';').replaceAll('（','(').replaceAll('）',')').replace(/[ \t]+/gu,' ').trim(); }
function normalizeSender(value:string) { const sender=value.trim(); return sender!==''&&!sender.startsWith('+')&&/^86\d+$/.test(sender)?`+${sender}`:sender; }
function safeError(error:unknown):string { const message=error instanceof Error?error.message:String(error); return /(?:api[_ -]?key|token|secret|authorization|bearer|密码|密钥)/iu.test(message)?'识别失败（敏感错误详情已隐藏）':message.replace(/https?:\/\/\S+/gu,'[地址已隐藏]').slice(0,500); }
function shanghai(value:Date) { const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(value); const v=(t:Intl.DateTimeFormatPartTypes)=>p.find(x=>x.type===t)?.value??''; return `${v('year')}-${v('month')}-${v('day')} ${v('hour')}:${v('minute')}:${v('second')}`; }
export class IngestService {
 constructor(private readonly repository:IngestRepository,private readonly ai:AiProcessor,private readonly crypto:{hashToken(token:string):string},private readonly now:()=>Date=()=>new Date()){}
 async ingest(token:string,input:IngestInput,clientIp:string) {
  const auth=await this.repository.authenticate(this.crypto.hashToken(token)); if(!auth) throw new IngestAuthError();
  const rawMessage=input.message.trim(), rawSender=(input.sender??'').trim(), sender=normalizeSender(rawSender); const parsed=input.receivedAt?new Date(input.receivedAt):this.now(); const valid=Number.isNaN(parsed.getTime())?this.now():parsed; const receivedAt=shanghai(valid); const fingerprintTime=input.receivedAt?receivedAt:receivedAt.slice(0,16); const fingerprint=createHash('sha256').update(`${sender}\n${normalizeSmsText(rawMessage)}\n${fingerprintTime}`).digest('hex');
  const old=await this.repository.findDuplicate(auth.userId,fingerprint); let messageId:number; if(old) { if(old.aiStatus!=='pending'||!await this.repository.claimStalePending(auth.userId,old.messageId)) return {status:'duplicate' as const,...old}; messageId=old.messageId; }
  else try { messageId=await this.repository.insert({userId:auth.userId,sender:sender.slice(0,120),rawSender:rawSender.slice(0,120),rawMessage,receivedAt,fingerprint,clientIp}); } catch { const duplicate=await this.repository.findDuplicateAfterConflict(auth.userId,fingerprint); if(duplicate) return {status:'duplicate' as const,...duplicate}; throw new IngestStorageError(); }
  try { const result=await this.ai.process(messageId,auth.userId); return {status:result.status,messageId,sender,codes:result.codes??[],aiStatus:result.status}; } catch(error) { await this.repository.markFailed(messageId,auth.userId,safeError(error)); return {status:'failed' as const,messageId,sender,codes:[],aiStatus:'failed' as const}; }
 }
 async ingestManual(userId:number,message:string,clientIp:string) {
  const rawMessage=message.trim();
  const fingerprint=createHash('sha256').update(`manual\n${normalizeSmsText(rawMessage)}`).digest('hex');
  const old=await this.repository.findDuplicate(userId,fingerprint);
  if(old)return {status:'duplicate' as const,...old,codes:[]};
  let messageId:number;
  try { messageId=await this.repository.insert({userId,sender:'',rawSender:'',rawMessage,receivedAt:shanghai(this.now()),fingerprint,clientIp}); }
  catch { const duplicate=await this.repository.findDuplicateAfterConflict(userId,fingerprint); if(duplicate)return {status:'duplicate' as const,...duplicate,codes:[]}; throw new IngestStorageError(); }
  try { const result=await this.ai.process(messageId,userId); return {status:result.status,messageId,codes:result.codes??[],aiStatus:result.status}; }
  catch(error) { await this.repository.markFailed(messageId,userId,safeError(error)); return {status:'failed' as const,messageId,codes:[],aiStatus:'failed' as const}; }
 }
}
