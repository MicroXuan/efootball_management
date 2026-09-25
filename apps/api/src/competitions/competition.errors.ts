import { HttpException } from '@nestjs/common';

export class CompetitionError extends HttpException {
  readonly code: string;

  constructor(code: string, message: string, status: number) {
    super({ code, message }, status);
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
