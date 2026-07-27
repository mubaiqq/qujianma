import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';

export interface QueueImageInput { uploadPath: string; mime: string; size: number; fingerprint: string; clientIp: string }
export interface RetryableImage { id: number; upload_path: string; ai_status: string }
export interface ImageQueueRepository {
  enqueueImage(userId: number, input: QueueImageInput): Promise<{ messageId: number; disposition: 'queued'|'duplicate'|'failed_history'; aiStatus?: string }>;
  imageForRetry(userId: number, messageId: number): Promise<RetryableImage | null>;
  requeueImage(userId: number, messageId: number): Promise<boolean>;
  deleteFailedImage(userId: number, messageId: number): Promise<{ deleted: boolean; uploadPath: string | null }>;
}
export interface UploadedImage { bytes: Buffer; mime: string }
type Result = { status: number; body: { code: 0 | 1; message: string; data?: unknown } };
const extensions: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'image/heif': '.heif' };

export class ImageRecognitionQueueService {
  private readonly uploadRoot: string;
  private readonly maxBytes: number;
  constructor(private readonly repository: ImageQueueRepository, options: { uploadRoot: string; maxBytes?: number }) {
    this.uploadRoot = resolve(options.uploadRoot);
    this.maxBytes = options.maxBytes ?? 6 * 1024 * 1024;
  }

  async enqueue(userId: number, images: UploadedImage[], clientIp: string): Promise<Result> {
    if (!Number.isSafeInteger(userId) || userId < 1 || images.length < 1) return { status: 422, body: { code: 1, message: '请上传需要识别的图片' } };
    if (images.length > 5) return { status: 422, body: { code: 1, message: '最多上传5张图片' } };
    for (const image of images) {
      if (image.bytes.length === 0 || image.bytes.length > this.maxBytes) return { status: 413, body: { code: 1, message: '每张图片不能超过6MB' } };
      if (!extensions[image.mime]) return { status: 422, body: { code: 1, message: '仅支持 JPG、PNG、WebP 或 HEIC 图片' } };
    }
    const files: Array<{message_id:number;status:'queued'|'duplicate'|'failed_history';ai_status?:string}> = [];
    for (const image of images) {
        const relative = `${userId}/${randomUUID()}${extensions[image.mime] ?? ''}`;
        const absolute = this.safePath(relative);
        await mkdir(dirname(absolute), { recursive: true, mode: 0o750 });
        await writeFile(absolute, image.bytes, { mode: 0o640, flag: 'wx' });
        try {
          const queued=await this.repository.enqueueImage(userId, { uploadPath: relative, mime: image.mime, size: image.bytes.length, fingerprint: createHash('sha256').update(image.bytes).digest('hex'), clientIp });
          files.push({message_id:queued.messageId,status:queued.disposition,...(queued.aiStatus?{ai_status:queued.aiStatus}:{})});
          if(queued.disposition!=='queued')await rm(absolute,{force:true});
        } catch (error) {
          await rm(absolute, { force: true });
          throw error;
        }
    }
    const status=files.every(file=>file.status==='duplicate')?'duplicate':files.every(file=>file.status==='failed_history')?'failed_history':'queued';
    return { status: 202, body: { code: 0, message: status==='queued'?'图片已提交，正在后台识别':status==='duplicate'?'图片已提交过，无需重复识别':'该图片曾识别失败，请在记录中重试', data: { message_ids: files.map(file=>file.message_id), status, files } } };
  }

  async retry(userId: number, messageId: number): Promise<Result> {
    const image = await this.repository.imageForRetry(userId, messageId);
    if (!image) return { status: 404, body: { code: 1, message: '图片识别记录不存在' } };
    if (!['failed', 'no_config'].includes(image.ai_status) || !image.upload_path || !this.isSafeRelative(image.upload_path)) return { status: 409, body: { code: 1, message: '图片识别记录当前不能重试' } };
    if (!await this.repository.requeueImage(userId, messageId)) return { status: 409, body: { code: 1, message: '记录状态已变化，请刷新后重试' } };
    return { status: 202, body: { code: 0, message: '已重新加入识别队列', data: { message_id: messageId, status: 'queued' } } };
  }

  async deleteFailed(userId: number, messageId: number): Promise<Result> {
    const deleted = await this.repository.deleteFailedImage(userId, messageId);
    if (!deleted.deleted) return { status: 404, body: { code: 1, message: '记录不存在或当前不能删除' } };
    if (deleted.uploadPath && this.isSafeRelative(deleted.uploadPath)) await rm(this.safePath(deleted.uploadPath), { force: true });
    return { status: 200, body: { code: 0, message: '失败识别记录已删除' } };
  }

  safePath(relative: string): string {
    if (!this.isSafeRelative(relative)) throw new Error('非法上传路径');
    const absolute = resolve(this.uploadRoot, relative);
    if (!absolute.startsWith(`${this.uploadRoot}${sep}`)) throw new Error('非法上传路径');
    return absolute;
  }

  private isSafeRelative(path: string): boolean {
    return /^[1-9]\d*\/[a-f0-9-]+\.(jpg|png|webp|heic|heif)$/i.test(path) && extname(path) !== '';
  }
}
