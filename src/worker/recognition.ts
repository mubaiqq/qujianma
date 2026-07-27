import { readFile, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { UploadedImage } from '../modules/recognition/service.js';
import { recognitionError, type RecognitionErrorType } from '../modules/recognition/errors.js';

export interface ClaimedImageJob { id: number; message_id: number; user_id: number; upload_path: string; mime_type: string; attempt_count: number }
export interface RecognitionWorkerRepository {
  claim(workerId: string, leaseSeconds: number): Promise<ClaimedImageJob | null>;
  complete(jobId: number): Promise<void>;
  fail(jobId: number, messageId: number, error: string, retry: boolean, errorType?: RecognitionErrorType): Promise<void>;
}
export class ImageRecognitionWorker {
  private readonly root: string;
  private readonly workerId: string;
  constructor(private readonly repository: RecognitionWorkerRepository, private readonly options: { uploadRoot: string; process(messageId: number, userId: number, images: UploadedImage[]): Promise<Record<string, unknown>>; leaseSeconds?: number; maxAttempts?: number; workerId?: string }) {
    this.root = resolve(options.uploadRoot);
    this.workerId = options.workerId ?? `recognition-${process.pid}`;
  }
  async runOnce(): Promise<{ status: 'idle' | 'succeeded' | 'failed'; jobId?: number; error?: string }> {
    const job = await this.repository.claim(this.workerId, this.options.leaseSeconds ?? 180);
    if (!job) return { status: 'idle' };
    try {
      const absolute = this.path(job.upload_path, job.user_id);
      const bytes = await readFile(absolute);
      const result = await this.options.process(job.message_id, job.user_id, [{ bytes, mime: job.mime_type }]);
      if (result.status === 'failed' || result.status === 'no_config') throw new (class extends Error { readonly retryable=Boolean(result.retryable); readonly errorType=(result.error_type === 'no_config' ? 'no_config' : result.error_type === 'provider_transient' ? 'provider_transient' : 'validation') as RecognitionErrorType; })(typeof result.error === 'string' ? result.error : '图片识别失败');
      await this.repository.complete(job.id);
      await rm(absolute, { force: true });
      return { status: 'succeeded', jobId: job.id };
    } catch (error) {
      const classified = recognitionError(error); const embedded = error as { errorType?: RecognitionErrorType; retryable?: boolean };
      const errorType=embedded.errorType ?? classified.errorType; const message = classified.message.slice(0, 500);
      const retryable=embedded.retryable ?? classified.retryable; const retry=retryable && job.attempt_count < (this.options.maxAttempts ?? 2);
      if(errorType==='provider_transient') await this.repository.fail(job.id, job.message_id, message, retry); else await this.repository.fail(job.id, job.message_id, message, retry, errorType);
      return { status: 'failed', jobId: job.id, error: message };
    }
  }
  private path(relative: string, userId: number): string {
    const absolute = resolve(this.root, relative);
    if (relative.includes('\0') || !relative.startsWith(`${userId}/`) || !absolute.startsWith(`${this.root}${sep}`)) throw new Error('非法上传路径');
    return absolute;
  }
}
