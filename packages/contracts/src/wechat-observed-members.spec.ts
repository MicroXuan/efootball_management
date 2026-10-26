import assert from 'node:assert/strict';
import { it } from 'node:test';
import * as contracts from './wechat-bot.js';

it('accepts identity-only observations and rejects chat content and oversized batches', () => {
  const schema = contracts.WechatObservedMembersBatchSchema;
  assert.ok(schema, 'member observation contract must exist');
  const item = { wechatGroupId: 'group@chatroom', wechatContactId: 'wxid_member', displayName: null, observedAt: '2026-10-26T12:00:00.000Z' };
  assert.equal(schema.safeParse({ items: [item] }).success, true);
  assert.equal(schema.safeParse({ items: [{ ...item, text: 'private text' }] }).success, false);
  assert.equal(schema.safeParse({ items: Array(101).fill(item) }).success, false);
  assert.equal(schema.safeParse({ items: [{ ...item, wechatContactId: '', observedAt: 'bad' }] }).success, false);
});

it('preserves zero-prefixed public user numbers and requires mutation concurrency context', () => {
  const lookup = contracts.WechatIdentityUserQuerySchema;
  const mutation = contracts.AdminWechatIdentityMutationSchema;
  assert.ok(lookup, 'user lookup contract must exist');
  assert.deepEqual(lookup.parse({ publicUserNo: '001234' }), { publicUserNo: '001234' });
  assert.equal(lookup.safeParse({ publicUserNo: 1234 }).success, false);
  assert.ok(mutation);
  assert.equal(mutation.safeParse({ userId: null }).success, false);
});
