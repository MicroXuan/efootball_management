import { PlayerAuctionMessageFormatter } from './player-auction-message.formatter.js';

describe('PlayerAuctionMessageFormatter', () => {
  const formatter = new PlayerAuctionMessageFormatter();

  it('renders every price between stars and preserves the required bid confirmation', () => {
    expect(formatter.validBid('申花', 120)).toBe('【申花】出价有效：⭐120⭐，倒计时重置为 30 秒。');
    expect(formatter.opening({ displayOrder: 37, playerName: '车范根', playerSnapshot: { card: { position: 'CF', overallRating: 96 } }, startingPrice: 50, minimumIncrement: 10 }))
      .toContain('起拍价：⭐50⭐');
    expect(formatter.opening({ displayOrder: 37, playerName: '车范根', playerSnapshot: { card: { position: 'CF', overallRating: 96 } }, startingPrice: 50, minimumIncrement: 10 }))
      .toContain('最低加价：⭐10⭐');
  });

  it('formats countdown, invalid bids, pending review, no bid, recovery and completion', () => {
    expect(formatter.countdown(5)).toBe('5');
    expect(formatter.invalidBid('BELOW_MINIMUM_INCREMENT', 130)).toContain('⭐130⭐');
    expect(formatter.pendingReview('车范根', '申花', 120)).toContain('⭐120⭐');
    expect(formatter.noBid('车范根')).toContain('流拍');
    expect(formatter.recovery()).toContain('暂停');
    expect(formatter.completed()).toContain('全部结束');
  });
});
