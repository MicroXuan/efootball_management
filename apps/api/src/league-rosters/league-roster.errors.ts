import { HttpException } from '@nestjs/common';

export class LeagueRosterError extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: number,
    details: Record<string, unknown> = {}
  ) {
    super({ code, message, ...details }, status);
  }
}
