import type { UploadedImage } from './service.js';

export const IMAGE_AI_SYSTEM_MESSAGE = '你只能输出符合要求的JSON。不要进行深度思考，不要输出思考过程。';

export function textRecognitionPayload(model: string, prompt: string): Record<string, unknown> {
  return { model, messages: [{ role: 'system', content: IMAGE_AI_SYSTEM_MESSAGE }, { role: 'user', content: prompt }], temperature: 0, response_format: { type: 'json_object' } };
}

export function imageRecognitionPayload(model: string, prompt: string, images: UploadedImage[]): Record<string, unknown> {
  return { model, messages: [{ role: 'system', content: IMAGE_AI_SYSTEM_MESSAGE }, { role: 'user', content: [{ type: 'text', text: prompt }, ...images.map((image) => ({ type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.bytes.toString('base64')}` } }))] }], temperature: 0, max_tokens: 1600, response_format: { type: 'json_object' } };
}