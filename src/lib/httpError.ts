export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export const toSafeHttpError = (error: unknown): HttpError =>
  error instanceof HttpError ? error : new HttpError(500, 'INTERNAL_ERROR', 'Unexpected server error');
