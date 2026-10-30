import assert from 'node:assert/strict';
import { it } from 'node:test';
import * as bot from './wechat-private-score.js';
it('requires version and idempotency for administrator identity changes', () => {
  assert.equal(bot.WechatAdminBindingMutationSchema.safeParse({ adminId: null }).success, false);
  assert.equal(bot.WechatAdminBindingMutationSchema.safeParse({ adminId: null, expectedVersion: 1, idempotencyKey: '11111111-1111-4111-8111-111111111111', reason: '' }).success, true);
});
