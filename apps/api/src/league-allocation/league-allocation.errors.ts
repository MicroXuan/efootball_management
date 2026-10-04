import { HttpException } from '@nestjs/common';

export class LeagueAllocationError extends HttpException {
  constructor(readonly code: string, message: string, status: number) {
    super({ code, message }, status);
  }
}
