import { z } from 'zod';

export const WechatAdminBindingMutationSchema = z.strictObject({
  adminId: z.uuid().nullable(), expectedVersion: z.number().int().positive(),
  idempotencyKey: z.uuid(), reason: z.string().trim().max(512).default('')
});
export type WechatAdminBindingMutation = z.infer<typeof WechatAdminBindingMutationSchema>;
export const WechatAdminContactsResponseSchema = z.object({
  enabled: z.boolean(),
  items: z.array(z.object({ id: z.uuid(), wechatContactId: z.string(), version: z.number(),
    lastObservedAt: z.string(), observedName: z.string().nullable(), observedNameAt: z.string().nullable(),
    adminId: z.uuid().nullable(), adminName: z.string().nullable() })),
  admins: z.array(z.object({ id: z.uuid(), username: z.string(), displayName: z.string() }))
});
