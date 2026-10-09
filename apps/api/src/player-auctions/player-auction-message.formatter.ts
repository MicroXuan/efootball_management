import { Injectable } from '@nestjs/common';
import { formatAuctionMoney, type PlayerAuctionBidResult } from '@efm/contracts';

type OpeningLot = {
  displayOrder: number;
  playerName: string;
  playerSnapshot: Record<string, unknown>;
  startingPrice: number;
  minimumIncrement: number;
};

@Injectable()
export class PlayerAuctionMessageFormatter {
  money(value: number) {
    return formatAuctionMoney(value);
  }

  queue(lots: Array<{ displayOrder: number; playerName: string; startingPrice: number }>) {
    return ['接下来即将拍卖的球员：', ...lots.map((lot) => `${lot.displayOrder}. ${lot.playerName}（起拍价：${this.money(lot.startingPrice)}）`)].join('\n');
  }

  opening(lot: OpeningLot) {
    const card = lot.playerSnapshot.card as { position?: string; overallRating?: number } | null | undefined;
    const descriptor = [card?.position, card?.overallRating].filter((value) => value !== undefined).join(' / ');
    return [
      `提名拍卖：第${lot.displayOrder}名球员拍卖开始！`,
      '************************',
      `球员信息：【${descriptor ? `${descriptor} / ` : ''}${lot.playerName}】`,
      `起拍价：${this.money(lot.startingPrice)}`,
      `最低加价：${this.money(lot.minimumIncrement)}`,
      '************************',
      '请在30秒内发送纯数字出价；以机器人确认消息和倒计时为准。'
    ].join('\n');
  }

  validBid(teamName: string, amount: number) {
    return `【${teamName}】出价有效：${this.money(amount)}，倒计时重置为 30 秒。`;
  }

  invalidBid(result: PlayerAuctionBidResult, minimum?: number) {
    const amount = minimum === undefined ? '' : `，当前至少需要 ${this.money(minimum)}`;
    const messages: Record<PlayerAuctionBidResult, string> = {
      VALID: '出价有效',
      BELOW_STARTING_PRICE: `出价低于起拍价${amount}`,
      BELOW_MINIMUM_INCREMENT: `出价未达到最低加价幅度${amount}`,
      UNBOUND: '请先在小程序获取验证码并完成微信身份绑定',
      NO_ACTIVE_TEAM: '你在当前联赛没有有效球队',
      WRONG_LEAGUE: '你的球队不属于当前联赛',
      INACTIVE: '当前没有进行中的拍卖',
      PAUSED: '拍卖已暂停，本次数字消息仅记录、不计入有效出价',
      RECOVERY_REQUIRED: '机器人正在恢复，暂不接受出价',
      DEADLINE_PASSED: '本次出价已超过截止时间',
      DUPLICATE: '该出价消息已经处理',
      OVERFLOW: '出价必须是有效的正整数'
    };
    return messages[result];
  }

  countdown(mark: 20 | 10 | 5 | 4 | 3 | 2 | 1) {
    return String(mark);
  }

  pendingReview(playerName: string, teamName: string, amount: number) {
    return `【${playerName}】倒计时结束，计算结果：${teamName} ${this.money(amount)}。结果待管理员人工审核，下一位不会自动开始。`;
  }

  noBid(playerName: string) {
    return `【${playerName}】无人有效出价，本轮流拍。请管理员确认“下一位”。`;
  }

  recovery() {
    return '检测到机器人连接或发送状态异常，拍卖已安全暂停并进入人工恢复模式。';
  }

  completed() {
    return '本批次球员拍卖已全部结束，最终结果以管理员人工审核为准。';
  }
}
