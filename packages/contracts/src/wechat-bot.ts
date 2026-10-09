import { z } from 'zod';
import { ExpectedVersionSchema, ResourceIdSchema } from './common.js';

const TimestampSchema = z.iso.datetime();
const WechatStableIdSchema = z.string().trim().min(1).max(256);
const DisplayNameSchema = z.string().trim().min(1).max(128);

export const WechatBotDeviceStatusSchema = z.enum(['ACTIVE', 'DISABLED']);
export const WechatLoginStatusSchema = z.enum(['UNKNOWN', 'LOGGED_IN', 'LOGGED_OUT']);
export const WechatCircuitStatusSchema = z.enum(['CLOSED', 'OPEN']);
export const WechatConversationTypeSchema = z.enum(['GROUP', 'PRIVATE']);

export const WechatObservedGroupInputSchema = z.object({
  wechatGroupId: WechatStableIdSchema,
  displayName: DisplayNameSchema
});

export const WechatBridgeHeartbeatSchema = z.object({
  wechatAccountId: WechatStableIdSchema.optional(),
  wechatVersion: z.string().trim().min(1).max(64),
  loginStatus: WechatLoginStatusSchema,
  listenerWatermark: z.string().trim().min(1).max(256).optional(),
  screenLocked: z.boolean(),
  outboundQueueDepth: z.number().int().min(0).max(100_000),
  observedGroups: z.array(WechatObservedGroupInputSchema).max(500)
});

export const WechatBridgeHeartbeatResponseSchema = z.object({
  acceptedAt: TimestampSchema,
  enabledGroups: z.array(WechatObservedGroupInputSchema).max(500)
});

export const WechatInboundMessageSchema = z.object({
  messageId: WechatStableIdSchema,
  conversationType: WechatConversationTypeSchema,
  conversationId: WechatStableIdSchema,
  senderId: WechatStableIdSchema,
  sentAt: TimestampSchema,
  messageType: z.literal('TEXT'),
  text: z.string().min(1).max(2_000),
  sequence: z.string().trim().min(1).max(128).optional()
});

export const WechatInboundBatchSchema = z.object({
  messages: z.array(WechatInboundMessageSchema).min(1).max(100)
});

export const WechatInboundBatchResultSchema = z.object({
  results: z.array(z.object({
    messageId: WechatStableIdSchema,
    status: z.enum(['ACCEPTED', 'DUPLICATE', 'IGNORED']),
    inboundId: ResourceIdSchema.nullable(),
    resultCode: z.string().trim().min(1).max(64).nullable()
  })).max(100)
});

export const WechatOutboxClaimRequestSchema = z.object({
  limit: z.number().int().min(1).max(50).default(20)
});

export const WechatOutboxMessageSchema = z.object({
  id: ResourceIdSchema,
  targetType: WechatConversationTypeSchema,
  targetId: WechatStableIdSchema,
  text: z.string().min(1).max(2_000),
  priority: z.number().int().min(0).max(1_000),
  scheduledAt: TimestampSchema
});

export const WechatOutboxClaimResponseSchema = z.object({
  messages: z.array(WechatOutboxMessageSchema).max(50)
});

export const WechatOutboxAckSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('SENT'),
    readbackMessageId: WechatStableIdSchema
  }),
  z.object({
    status: z.literal('FAILED'),
    errorCode: z.string().trim().min(1).max(64),
    errorMessage: z.string().trim().min(1).max(512),
    readbackMessageId: z.never().optional()
  }),
  z.object({
    status: z.literal('AMBIGUOUS'),
    errorCode: z.string().trim().min(1).max(64),
    errorMessage: z.string().trim().min(1).max(512),
    readbackMessageId: z.never().optional()
  })
]);

export const WechatBindingStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('UNBOUND') }),
  z.object({
    status: z.literal('BOUND'),
    deviceName: DisplayNameSchema,
    boundAt: TimestampSchema
  })
]);

export const WechatBindingCodeResponseSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  expiresAt: TimestampSchema
});

export const AdminWechatBotDeviceSchema = z.object({
  id: ResourceIdSchema,
  name: DisplayNameSchema,
  status: WechatBotDeviceStatusSchema,
  loginStatus: WechatLoginStatusSchema,
  circuitStatus: WechatCircuitStatusSchema,
  circuitReason: z.string().max(512).nullable().optional(),
  lastHeartbeatAt: TimestampSchema.nullable(),
  wechatVersion: z.string().max(64).nullable(),
  outboundQueueDepth: z.number().int().min(0),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});

export const AdminWechatBotDeviceListSchema = z.object({
  items: z.array(AdminWechatBotDeviceSchema)
});

export const CreateWechatBotDeviceRequestSchema = z.object({
  name: DisplayNameSchema
});

export const UpdateWechatBotDeviceStatusRequestSchema = z.object({
  status: WechatBotDeviceStatusSchema,
  reason: z.string().trim().min(1).max(512).optional()
});

export const WechatBotDeviceCredentialResponseSchema = z.object({
  device: AdminWechatBotDeviceSchema,
  token: z.string().min(32)
});

export const AdminWechatObservedGroupSchema = z.object({
  id: ResourceIdSchema,
  deviceId: ResourceIdSchema,
  wechatGroupId: WechatStableIdSchema,
  displayName: DisplayNameSchema,
  lastObservedAt: TimestampSchema
});

export const AdminWechatObservedGroupListSchema = z.object({
  items: z.array(AdminWechatObservedGroupSchema)
});

export const AdminWechatGroupBindingSchema = z.object({
  id: ResourceIdSchema,
  deviceId: ResourceIdSchema,
  leagueId: ResourceIdSchema,
  wechatGroupId: WechatStableIdSchema,
  displayName: DisplayNameSchema,
  enabled: z.boolean(),
  version: ExpectedVersionSchema,
  scheduleSourceIds: z.array(ResourceIdSchema),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});

export const SaveWechatGroupBindingRequestSchema = z.object({
  deviceId: ResourceIdSchema,
  observedGroupId: ResourceIdSchema,
  enabled: z.boolean().default(true),
  scheduleSourceIds: z.array(ResourceIdSchema).max(50).default([]),
  expectedVersion: ExpectedVersionSchema.optional()
}).superRefine((value, context) => {
  if (new Set(value.scheduleSourceIds).size !== value.scheduleSourceIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['scheduleSourceIds'],
      message: 'scheduleSourceIds must be unique'
    });
  }
});

export const AdminWechatScheduleSourceOptionSchema = z.object({
  id: ResourceIdSchema,
  name: z.string().trim().min(1).max(80),
  status: z.enum(['DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])
});

export const AdminLeagueWechatBotConfigSchema = z.object({
  bindings: z.array(AdminWechatGroupBindingSchema),
  devices: z.array(AdminWechatBotDeviceSchema),
  observedGroups: z.array(AdminWechatObservedGroupSchema),
  scheduleSourceOptions: z.array(AdminWechatScheduleSourceOptionSchema)
});

export type WechatBridgeHeartbeat = z.infer<typeof WechatBridgeHeartbeatSchema>;
export type WechatBridgeHeartbeatResponse = z.infer<typeof WechatBridgeHeartbeatResponseSchema>;
export type WechatConversationType = z.infer<typeof WechatConversationTypeSchema>;
export type WechatInboundBatch = z.infer<typeof WechatInboundBatchSchema>;
export type WechatInboundBatchResult = z.infer<typeof WechatInboundBatchResultSchema>;
export type WechatOutboxClaimRequest = z.infer<typeof WechatOutboxClaimRequestSchema>;
export type WechatOutboxClaimResponse = z.infer<typeof WechatOutboxClaimResponseSchema>;
export type WechatOutboxAck = z.infer<typeof WechatOutboxAckSchema>;
export type WechatBindingStatus = z.infer<typeof WechatBindingStatusSchema>;
export type WechatBindingCodeResponse = z.infer<typeof WechatBindingCodeResponseSchema>;
export type AdminWechatBotDevice = z.infer<typeof AdminWechatBotDeviceSchema>;
export type AdminWechatGroupBinding = z.infer<typeof AdminWechatGroupBindingSchema>;
export type SaveWechatGroupBindingRequest = z.infer<typeof SaveWechatGroupBindingRequestSchema>;
export type CreateWechatBotDeviceRequest = z.infer<typeof CreateWechatBotDeviceRequestSchema>;
export type UpdateWechatBotDeviceStatusRequest = z.infer<typeof UpdateWechatBotDeviceStatusRequestSchema>;
export type AdminLeagueWechatBotConfig = z.infer<typeof AdminLeagueWechatBotConfigSchema>;
