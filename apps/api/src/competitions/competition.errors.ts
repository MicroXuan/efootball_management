import { HttpException } from '@nestjs/common';

export class CompetitionError extends HttpException {
  readonly code: string;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(details === undefined ? { code, message } : { code, message, details }, status);
    this.code = code;
  }
}

export function assertExpectedVersion(
  actual: number,
  expected: number,
  resource: string
): void {
  if (actual !== expected) {
    throw new CompetitionError('VERSION_CONFLICT', `${resource} has changed`, 409);
  }
}
