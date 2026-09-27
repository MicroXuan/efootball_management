import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

type AuditClient = PrismaService | Prisma.TransactionClient;
type AuditInput = {
  actorAdminId: string;
  leagueId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
};

const SENSITIVE_KEY = /password|token|secret/i;

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !SENSITIVE_KEY.test(key))
        .map(([key, entry]) => [key, sanitize(entry)])
    );
  }
  return value;
}

@Injectable()
export class AuditLogService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  record(client: AuditClient, input: AuditInput) {
    return client.auditLog.create({
      data: {
        actorAdminId: input.actorAdminId,
        leagueId: input.leagueId ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        reason: input.reason ?? null,
        metadata: sanitize(input.metadata ?? {}) as Prisma.InputJsonValue
      }
    });
  }

  async list(leagueId?: string) {
    const logs = await this.prisma.auditLog.findMany({
      ...(leagueId ? { where: { leagueId } } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100
    });
    return logs.map((log) => ({
      ...log,
      createdAt: log.createdAt.toISOString()
    }));
  }
}
