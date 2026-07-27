import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ImageRecognitionQueueService, type ImageQueueRepository } from '../../../src/modules/recognition/queue.js';
import { ImageRecognitionWorker, type ClaimedImageJob, type RecognitionWorkerRepository } from '../../../src/worker/recognition.js';
/* eslint-disable @typescript-eslint/unbound-method */

function repository(): ImageQueueRepository {
  return { enqueueImage: vi.fn().mockResolvedValue({ messageId: 41, disposition: 'queued' }), imageForRetry: vi.fn(), requeueImage: vi.fn(), deleteFailedImage: vi.fn() };
}

describe('durable image recognition queue', () => {
  it('stores random user-isolated files and returns queued message ids', async () => {
    const root = await mkdtemp(join(tmpdir(), 'recognition-upload-')); const repo = repository(); const service = new ImageRecognitionQueueService(repo, { uploadRoot: root });
    const result = await service.enqueue(7, [{ bytes: Buffer.from('jpeg-data'), mime: 'image/jpeg' }], '127.0.0.1');
    expect(result).toMatchObject({ status: 202, body: { code: 0, data: { message_ids: [41], status: 'queued' } } });
    const input = vi.mocked(repo.enqueueImage).mock.calls[0]?.[1]; expect(input?.uploadPath).toMatch(/^7\/[a-f0-9-]+\.jpg$/); expect(await readFile(join(root, input?.uploadPath ?? ''))).toEqual(Buffer.from('jpeg-data')); expect((await stat(join(root, '7'))).isDirectory()).toBe(true); expect(input?.fingerprint).toBe('4cd68a377f4b350468ba84edbfb23601e6c34c40ee06101987fd5a9f585b53d5');
  });
  it('returns a per-file duplicate without retaining the redundant upload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'recognition-upload-')); const repo = repository(); vi.mocked(repo.enqueueImage).mockResolvedValue({ messageId: 9, disposition: 'duplicate', aiStatus: 'success' }); const service = new ImageRecognitionQueueService(repo, { uploadRoot: root });
    const result = await service.enqueue(7, [{ bytes: Buffer.from('same-image'), mime: 'image/jpeg' }], '');
    expect(result).toMatchObject({ status: 202, body: { data: { message_ids: [9], status: 'duplicate', files: [{ message_id: 9, status: 'duplicate', ai_status: 'success' }] } } });
    const input=vi.mocked(repo.enqueueImage).mock.calls[0]?.[1]; await expect(stat(join(root,input?.uploadPath??''))).rejects.toThrow();
  });
  it('rejects invalid mime and oversized uploads before writing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'recognition-upload-')); const repo = repository(); const service = new ImageRecognitionQueueService(repo, { uploadRoot: root, maxBytes: 4 });
    await expect(service.enqueue(7, [{ bytes: Buffer.from('12345'), mime: 'image/jpeg' }], '')).resolves.toMatchObject({ status: 413 }); await expect(service.enqueue(7, [{ bytes: Buffer.from('x'), mime: 'text/plain' }], '')).resolves.toMatchObject({ status: 422 }); expect(repo.enqueueImage).not.toHaveBeenCalled();
  });
  it('requeues only an owned failed image and deletes only an owned deletable record', async () => {
    const root = await mkdtemp(join(tmpdir(), 'recognition-upload-')); const repo = repository(); vi.mocked(repo.imageForRetry).mockResolvedValue({ id: 8, upload_path: '7/a.jpg', ai_status: 'failed' }); vi.mocked(repo.requeueImage).mockResolvedValue(true); vi.mocked(repo.deleteFailedImage).mockResolvedValue({ deleted: true, uploadPath: '7/a.jpg' }); const service = new ImageRecognitionQueueService(repo, { uploadRoot: root });
    await expect(service.retry(7, 8)).resolves.toMatchObject({ status: 202, body: { data: { status: 'queued' } } }); await expect(service.deleteFailed(7, 8)).resolves.toMatchObject({ status: 200 }); expect(repo.requeueImage).toHaveBeenCalledWith(7, 8);
  });
  it('does not classify an existing image in a non-retryable state as a text message', async () => {
    const root = await mkdtemp(join(tmpdir(), 'recognition-upload-')); const repo = repository(); vi.mocked(repo.imageForRetry).mockResolvedValue({ id: 8, upload_path: '7/a.jpg', ai_status: 'pending' }); const service = new ImageRecognitionQueueService(repo, { uploadRoot: root });
    await expect(service.retry(7, 8)).resolves.toMatchObject({ status: 409 });
  });
});

describe('image recognition worker', () => {
  it('claims, processes and deletes the successful upload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'recognition-worker-')); await mkdir(join(root, '7')); await writeFile(join(root, '7/image.jpg'), 'jpeg');
    const job: ClaimedImageJob = { id: 2, message_id: 8, user_id: 7, upload_path: '7/image.jpg', mime_type: 'image/jpeg', attempt_count: 1 };
    const repo: RecognitionWorkerRepository = { claim: vi.fn().mockResolvedValue(job), complete: vi.fn(), fail: vi.fn() };
    const worker = new ImageRecognitionWorker(repo, { uploadRoot: root, process: vi.fn().mockResolvedValue({ status: 'created' }) });
    await expect(worker.runOnce()).resolves.toEqual({ status: 'succeeded', jobId: 2 }); expect(repo.complete).toHaveBeenCalledWith(2); await expect(stat(join(root, '7/image.jpg'))).rejects.toThrow();
  });
  it('retains upload and records bounded retry on failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'recognition-worker-')); await mkdir(join(root, '7')); await writeFile(join(root, '7/image.jpg'), 'jpeg');
    const job: ClaimedImageJob = { id: 2, message_id: 8, user_id: 7, upload_path: '7/image.jpg', mime_type: 'image/jpeg', attempt_count: 1 };
    const repo: RecognitionWorkerRepository = { claim: vi.fn().mockResolvedValue(job), complete: vi.fn(), fail: vi.fn() };
    const worker = new ImageRecognitionWorker(repo, { uploadRoot: root, process: vi.fn().mockRejectedValue(new Error('timeout')) });
    await expect(worker.runOnce()).resolves.toEqual({ status: 'failed', jobId: 2, error: 'timeout' }); expect(repo.fail).toHaveBeenCalledWith(2, 8, 'timeout', true); expect((await stat(join(root, '7/image.jpg'))).isFile()).toBe(true);
  });
  it('stops retrying after the second claimed attempt and retains the upload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'recognition-worker-')); await mkdir(join(root, '7')); await writeFile(join(root, '7/image.jpg'), 'jpeg');
    const job: ClaimedImageJob = { id: 2, message_id: 8, user_id: 7, upload_path: '7/image.jpg', mime_type: 'image/jpeg', attempt_count: 2 };
    const repo: RecognitionWorkerRepository = { claim: vi.fn().mockResolvedValue(job), complete: vi.fn(), fail: vi.fn() };
    const worker = new ImageRecognitionWorker(repo, { uploadRoot: root, process: vi.fn().mockRejectedValue(new Error('timeout')) });
    await worker.runOnce(); expect(repo.fail).toHaveBeenCalledWith(2, 8, 'timeout', false); expect((await stat(join(root, '7/image.jpg'))).isFile()).toBe(true);
  });
  it('finalizes deterministic validation failures after the first attempt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'recognition-worker-')); await mkdir(join(root, '7')); await writeFile(join(root, '7/image.jpg'), 'jpeg');
    const job: ClaimedImageJob = { id: 2, message_id: 8, user_id: 7, upload_path: '7/image.jpg', mime_type: 'image/jpeg', attempt_count: 1 };
    const repo: RecognitionWorkerRepository = { claim: vi.fn().mockResolvedValue(job), complete: vi.fn(), fail: vi.fn() };
    const worker = new ImageRecognitionWorker(repo, { uploadRoot: root, process: vi.fn().mockResolvedValue({ status: 'failed', error: '第1个取件码无法归属视觉区块', error_type: 'validation', retryable: false }) });
    await worker.runOnce(); expect(repo.fail).toHaveBeenCalledWith(2, 8, '第1个取件码无法归属视觉区块', false, 'validation');
  });
  it('finalizes no-config immediately without retrying', async () => {
    const root = await mkdtemp(join(tmpdir(), 'recognition-worker-')); await mkdir(join(root, '7')); await writeFile(join(root, '7/image.jpg'), 'jpeg');
    const job: ClaimedImageJob = { id: 3, message_id: 9, user_id: 7, upload_path: '7/image.jpg', mime_type: 'image/jpeg', attempt_count: 1 };
    const repo: RecognitionWorkerRepository = { claim: vi.fn().mockResolvedValue(job), complete: vi.fn(), fail: vi.fn() };
    const worker = new ImageRecognitionWorker(repo, { uploadRoot: root, process: vi.fn().mockResolvedValue({ status: 'no_config', error: '未配置AI', error_type: 'no_config', retryable: false }) });
    await worker.runOnce(); expect(repo.fail).toHaveBeenCalledWith(3, 9, '未配置AI', false, 'no_config');
  });
});
