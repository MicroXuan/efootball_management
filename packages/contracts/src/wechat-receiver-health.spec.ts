import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WechatReceiverHealthSchema } from './wechat-bot.js';

test('accepts Python UTC offsets and normalizes diagnostics to Z for older frontends', () => {
  const result = WechatReceiverHealthSchema.parse({ status: 'HEALTHY', errorCode: null, lastSuccessAt: '2026-10-30T14:41:18.062849+00:00' });
  assert.equal(result.lastSuccessAt, '2026-10-30T14:41:18.062Z');
});
test('accepts initial null, canonical Z and rejects invalid timestamps', () => {
  for (const value of [null, '2026-10-30T14:41:18.062Z']) {
    assert.equal(WechatReceiverHealthSchema.parse({status:'STARTING',errorCode:null,lastSuccessAt:value}).lastSuccessAt,value);
  }
  assert.equal(WechatReceiverHealthSchema.safeParse({status:'HEALTHY',errorCode:null,lastSuccessAt:'invalid'}).success,false);
});
