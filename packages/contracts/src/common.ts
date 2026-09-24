import { z } from 'zod';

export const ResourceIdSchema = z.uuid();

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string(),
    requestId: z.string().min(1),
    fields: z.array(z.object({
      path: z.string(),
      message: z.string()
    })).optional()
  })
});

export type ApiErrorResponse = z.infer<typeof ApiErrorSchema>;
