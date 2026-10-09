import { Injectable } from '@nestjs/common';

@Injectable()
export class PlayerAuctionClock {
  now() {
    return new Date();
  }
}
