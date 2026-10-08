import { Inject, Injectable } from '@nestjs/common';
import type {
  PlatformPresentation,
  UpdatePlatformPresentationRequest,
} from '@efm/contracts';
import { AuditLogService } from '../admin/audit-log.service.js';
import { AdminError } from '../admin/admin.errors.js';
import { PrismaService } from '../database/prisma.service.js';

const PRESENTATION_ID = 'global';

@Injectable()
export class PlatformPresentationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  async get(): Promise<PlatformPresentation> {
    const presentation = await this.prisma.platformPresentation.findUnique({
      where: { id: PRESENTATION_ID },
    });
    return presentation
      ? this.present(presentation)
      : { leagueCenterBannerUrl: null, version: 0 };
  }

  update(
    adminId: string,
    input: UpdatePlatformPresentationRequest,
  ): Promise<PlatformPresentation> {
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.platformPresentation.findUnique({
        where: { id: PRESENTATION_ID },
      });
      if ((current?.version ?? 0) !== input.expectedVersion) {
        throw this.versionConflict();
      }

      let saved;
      if (!current) {
        saved = await transaction.platformPresentation.create({
          data: {
            id: PRESENTATION_ID,
            leagueCenterBannerUrl: input.leagueCenterBannerUrl,
          },
        });
      } else {
        const changed = await transaction.platformPresentation.updateMany({
          where: { id: PRESENTATION_ID, version: input.expectedVersion },
          data: {
            leagueCenterBannerUrl: input.leagueCenterBannerUrl,
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw this.versionConflict();
        saved = {
          ...current,
          leagueCenterBannerUrl: input.leagueCenterBannerUrl,
          version: input.expectedVersion + 1,
        };
      }

      await this.audit.record(transaction, {
        actorAdminId: adminId,
        action: 'admin.platform-presentation.update',
        resourceType: 'PlatformPresentation',
        resourceId: PRESENTATION_ID,
        metadata: { leagueCenterBannerUrl: input.leagueCenterBannerUrl },
      });
      return this.present(saved);
    });
  }

  private present(value: {
    leagueCenterBannerUrl: string | null;
    version: number;
  }): PlatformPresentation {
    return {
      leagueCenterBannerUrl: value.leagueCenterBannerUrl,
      version: value.version,
    };
  }

  private versionConflict() {
    return new AdminError('VERSION_CONFLICT', 'Platform presentation has changed', 409);
  }
}
