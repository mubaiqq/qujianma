import { describe, expect, it } from 'vitest';
import { IMAGE_AI_SYSTEM_MESSAGE, imageRecognitionPayload, textRecognitionPayload } from '../../../src/modules/recognition/payload.js';

describe('recognition AI payload contract', () => {
  it('sends the exact independent system message for text and image payloads', () => {
    const exact = '你只能输出符合要求的JSON。不要进行深度思考，不要输出思考过程。';
    expect(IMAGE_AI_SYSTEM_MESSAGE).toBe(exact);
    expect(textRecognitionPayload('model', 'prompt').messages).toEqual([{ role: 'system', content: exact }, { role: 'user', content: 'prompt' }]);
    expect(imageRecognitionPayload('model', 'prompt', [{ bytes: Buffer.from('image'), mime: 'image/png' }]).messages).toEqual([{ role: 'system', content: exact }, { role: 'user', content: [{ type: 'text', text: 'prompt' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=' } }] }]);
  });
  it('caps image output tokens without lowering vision detail needed for small pickup codes', () => {
    const payload = imageRecognitionPayload('model', 'prompt', [{ bytes: Buffer.from('image'), mime: 'image/png' }]);
    expect(payload.max_tokens).toBe(1600);
    const imageUrl = ((payload.messages as Array<{ content?: unknown }>)[1]?.content as Array<{ image_url?: { detail?: string } }>)[1]?.image_url;
    expect(imageUrl?.detail).toBeUndefined();
  });
});