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


it('accepts omitted or blank identity notes while retaining the length limit', () => {
  const input = {
    observedMemberId: '11111111-1111-4111-8111-111111111111', userId: null,
    expectedBindingId: null, expectedVersion: null,
    idempotencyKey: '22222222-2222-4222-8222-222222222222'
  };
  const schema = contracts.AdminWechatIdentityMutationSchema;
  assert.equal(schema.parse(input).reason, '');
  assert.equal(schema.parse({ ...input, reason: '   ' }).reason, '');
  assert.equal(schema.parse({ ...input, reason: ' 核实记录 ' }).reason, '核实记录');
  assert.equal(schema.safeParse({ ...input, reason: '字'.repeat(513) }).success, false);
});
