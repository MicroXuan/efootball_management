import { HttpException } from '@nestjs/common';

export class PlayerAuctionError extends HttpException {
  constructor(readonly code: string, message: string, status: number) {
    super({ code, message }, status);
  }
}

export const auctionVersionConflict = () =>
  new PlayerAuctionError('VERSION_CONFLICT', '拍卖配置已更新，请刷新后重试', 409);
