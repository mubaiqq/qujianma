import { describe, expect, it, vi } from 'vitest';
/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */
import { RecognitionService, type RecognitionRepository } from '../../../src/modules/recognition/service.js';

function repository(): RecognitionRepository { return { activeProvider: vi.fn().mockResolvedValue(null), message: vi.fn().mockResolvedValue({ id: 8, user_id: 7, raw_message: '包裹已到东门，取件码A-1', received_at: 'now', ai_status: 'failed' }), stations: vi.fn().mockResolvedValue([]), persist: vi.fn().mockResolvedValue({ status: 'created', codes: ['A-1'], station_id: 2 }), markFailure: vi.fn(), saveImageFailure: vi.fn().mockResolvedValue(10), createImageMessage: vi.fn().mockResolvedValue({ id: 11, duplicate: false }) }; }

describe('RecognitionService boundaries', () => {
  it('persists queued image items on the existing source message without creating more messages', async () => {
    const repo=repository(); vi.mocked(repo.activeProvider).mockResolvedValue({id:1,base_url:'https://api.example/v1',api_key_ciphertext:'c',model_name:'vision'}); const imageAi=vi.fn().mockResolvedValue({ocr_text:'东门 A-1 B-2',items:[{is_pickup_message:true,station_name:'东门',station_address:'',courier_name:'',pickup_codes:['A-1'],pickup_time:''},{is_pickup_message:true,station_name:'东门',station_address:'',courier_name:'',pickup_codes:['B-2'],pickup_time:''}]}); const service=new RecognitionService(repo,{decrypt:()=> 'key',textAi:vi.fn(),imageAi});
    await expect(service.processQueuedImage(8,7,[{bytes:Buffer.from('jpeg'),mime:'image/jpeg'}])).resolves.toMatchObject({status:'created'});
    expect(repo.createImageMessage).not.toHaveBeenCalled(); expect(repo.persist).toHaveBeenCalledTimes(2); for(const call of vi.mocked(repo.persist).mock.calls) expect(call.slice(0,2)).toEqual([8,7]);
  });
  it('keeps one auditable normalized items array after persisting every queued image item', async () => {
    const repo=repository(); repo.updateImageSource=vi.fn(); vi.mocked(repo.activeProvider).mockResolvedValue({id:1,base_url:'https://api.example/v1',api_key_ciphertext:'c',model_name:'vision'}); const ocr='东门站\n取件码 A-1、A-2\nEMS EE123456789CN'; const imageAi=vi.fn().mockResolvedValue({ocr_text:ocr,items:[{pickup_code:'A-1'},{pickup_code:'A-2'}]}); const service=new RecognitionService(repo,{decrypt:()=> 'key',textAi:vi.fn(),imageAi});
    await service.processQueuedImage(8,7,[{bytes:Buffer.from('jpeg'),mime:'image/jpeg'}]);
    expect(repo.updateImageSource).toHaveBeenCalledTimes(1); expect(repo.updateImageSource).toHaveBeenCalledWith(8,7,ocr,expect.objectContaining({items:[expect.objectContaining({pickup_codes:['A-1'],evidence_text:expect.stringContaining('A-1')}),expect.objectContaining({pickup_codes:['A-2'],evidence_text:expect.stringContaining('A-2')})]}));
  });
  it('retry only accepts failed/no_config user messages and locally falls back without AI', async () => { const repo = repository(); const service = new RecognitionService(repo, { decrypt: String, textAi: vi.fn(), imageAi: vi.fn() }); const result = await service.retry(7, 8); expect(result).toMatchObject({ status: 200, body: { code: 0, data: { recognition_source: 'local' } } }); expect(repo.persist).toHaveBeenCalled(); vi.mocked(repo.message).mockResolvedValueOnce({ id: 8, user_id: 7, raw_message: 'x', received_at: 'now', ai_status: 'success' }); await expect(service.retry(7, 8)).resolves.toMatchObject({ status: 404 }); });
  it('accepts at most five valid images and persists a reason when vision fails', async () => { const repo = repository(); vi.mocked(repo.activeProvider).mockResolvedValue({ id: 1, base_url: 'https://api.example/v1', api_key_ciphertext: 'c', model_name: 'vision' }); const imageAi = vi.fn().mockRejectedValue(new Error('vision timeout')); const service = new RecognitionService(repo, { decrypt: () => 'key', textAi: vi.fn(), imageAi }); const image = { bytes: Buffer.from('jpeg'), mime: 'image/jpeg' }; await expect(service.recognizeImages(7, Array(6).fill(image), '')).resolves.toMatchObject({ status: 422, body: { message: '最多上传5张图片' } }); const failed = await service.recognizeImages(7, [image], '1.2.3.4'); expect(failed).toMatchObject({ status: 422, body: { data: { details: { stage: 'image_recognition' }, message_id: 10 } } }); expect(repo.saveImageFailure).toHaveBeenCalledWith(7, expect.objectContaining({ error: 'vision timeout' })); });
  it('marks text failed when result persistence throws instead of leaving pending',async()=>{const repo=repository();vi.mocked(repo.activeProvider).mockResolvedValue(null);vi.mocked(repo.persist).mockRejectedValue(new Error('SQL 1366'));const service=new RecognitionService(repo,{decrypt:String,textAi:vi.fn(),imageAi:vi.fn()});await expect(service.process(8,7)).resolves.toMatchObject({status:'failed'});expect(repo.markFailure).toHaveBeenCalledWith(8,7,null,'SQL 1366');});
  it('uses the official provider when selected and reports an unavailable official model without changing global health',async()=>{const repo=repository();vi.mocked(repo.activeProvider).mockResolvedValueOnce({id:null,base_url:'https://official.example/v1',api_key_ciphertext:'official-cipher',model_name:'official-vision',source:'official'});const service=new RecognitionService(repo,{decrypt:()=> 'official-key',textAi:vi.fn().mockRejectedValue(new Error('official offline')),imageAi:vi.fn()});await expect(service.process(8,7)).resolves.toMatchObject({status:'failed',error:expect.stringContaining('官方模型异常，请在大模型设置中添加自己的模型')});});
  it('persists the validated image item rather than the untrusted model item', async () => {
    const repo = repository(); vi.mocked(repo.activeProvider).mockResolvedValue({ id: 1, base_url: 'https://api.example/v1', api_key_ciphertext: 'c', model_name: 'vision' });
    const imageAi = vi.fn<() => Promise<Record<string, unknown>>>().mockResolvedValue({ is_pickup_message: true, ocr_text: '【火车站店】\n李红云\n取件码：R-2-1001', items: [{ pickup_code: 'R-2-1001', courier_name: '李红云' }] });
    const service = new RecognitionService(repo, { decrypt: () => 'key', textAi: vi.fn(), imageAi });
    await expect(service.recognizeImages(7, [{ bytes: Buffer.from('jpeg'), mime: 'image/jpeg' }], '')).resolves.toMatchObject({ status: 200 });
    expect(repo.createImageMessage).toHaveBeenCalledWith(7, expect.objectContaining({ result: expect.objectContaining({ courier_name: '' }) }));
    expect(repo.persist).toHaveBeenCalledWith(11, 7, expect.anything(), expect.objectContaining({ courier_name: '' }), expect.anything());
  });
  it('does not leak courier or station fields across separate visual blocks', async () => {
    const repo = repository(); vi.mocked(repo.activeProvider).mockResolvedValue({ id: 1, base_url: 'https://api.example/v1', api_key_ciphertext: 'c', model_name: 'vision' });
    const ocr = '【甲站】\n韵达快递\n取件码：A-1001\n\n----------------\n\n【乙站】\n取件码：B-2002';
    const imageAi = vi.fn<() => Promise<Record<string, unknown>>>().mockResolvedValue({ is_pickup_message: true, ocr_text: ocr, items: [{ pickup_code: 'A-1001', station_name: '甲站', courier_name: '韵达快递' }, { pickup_code: 'B-2002', station_name: '甲站', courier_name: '韵达快递' }] });
    const service = new RecognitionService(repo, { decrypt: () => 'key', textAi: vi.fn(), imageAi });
    await expect(service.recognizeImages(7, [{ bytes: Buffer.from('redacted-image-replay'), mime: 'image/jpeg' }], '')).resolves.toMatchObject({ status: 200 });
    expect(repo.persist).toHaveBeenNthCalledWith(1, 11, 7, expect.anything(), expect.objectContaining({ pickup_codes: ['A-1001'], station_name: '甲站', courier_name: '韵达快递' }), expect.anything());
    expect(repo.persist).toHaveBeenNthCalledWith(2, 11, 7, expect.anything(), expect.objectContaining({ pickup_codes: ['B-2002'], station_name: '乙站', courier_name: '' }), expect.anything());
  });
  it('does not break multiple codes belonging to one visual block', async () => {
    const repo = repository(); vi.mocked(repo.activeProvider).mockResolvedValue({ id: 1, base_url: 'https://api.example/v1', api_key_ciphertext: 'c', model_name: 'vision' });
    const block = '【同一站】\nEMS\n取件码：C-3001、C-3002';
    const imageAi = vi.fn<() => Promise<Record<string, unknown>>>().mockResolvedValue({ is_pickup_message: true, ocr_text: block, items: [{ pickup_code: 'C-3001' }, { pickup_code: 'C-3002' }] });
    const service = new RecognitionService(repo, { decrypt: () => 'key', textAi: vi.fn(), imageAi });
    await service.recognizeImages(7, [{ bytes: Buffer.from('redacted-image-replay'), mime: 'image/jpeg' }], '');
    expect(repo.persist).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(repo.persist).mock.calls) expect(call[3]).toMatchObject({ station_name: '同一站', courier_name: '中国邮政' });
  });
});
