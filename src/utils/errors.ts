export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  override readonly cause?: unknown;

  constructor(message: string, code: string, statusCode = 500, cause?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.cause = cause;
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
