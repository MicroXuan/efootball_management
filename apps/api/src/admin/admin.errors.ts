import { HttpException } from '@nestjs/common';

export class AdminError extends HttpException {
  constructor(code: string, message: string, status: number) {
    super({ code, message }, status);
  }
}
