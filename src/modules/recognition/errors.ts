export type RecognitionErrorType = 'validation' | 'no_config' | 'provider_transient' | 'internal';

export class RecognitionError extends Error {
  readonly originalCause?: unknown;
  constructor(message: string, readonly errorType: RecognitionErrorType, readonly retryable: boolean, cause?: unknown) {
    super(message);
    this.name = 'RecognitionError';
    this.originalCause = cause;
  }
}

export function recognitionError(error: unknown): RecognitionError {
  if (error instanceof RecognitionError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (error !== null && typeof error === 'object' && typeof (error as { retryable?: unknown }).retryable === 'boolean') return new RecognitionError(message, (error as { retryable: boolean }).retryable ? 'provider_transient' : 'validation', (error as { retryable: boolean }).retryable, error);
  if (/timeout|timed out|network|socket|fetch failed|econnreset|econnrefused|enotfound|eai_again/iu.test(message)) return new RecognitionError(message, 'provider_transient', true, error);
  return new RecognitionError(message, 'internal', false, error);
}
