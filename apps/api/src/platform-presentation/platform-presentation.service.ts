import { Inject, Injectable } from '@nestjs/common';
import type {
  PlatformPresentation,
  UpdatePlatformPresentationRequest,
} from '@efm/contracts';
import { AuditLogService } from '../admin/audit-log.service.js';
import { AdminError } from '../admin/admin.errors.js';
import { PrismaService } from '../database/prisma.service.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/object-storage.js';

const PRESENTATION_ID = 'global';

@Injectable()
export class PlatformPresentationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async get(): Promise<PlatformPresentation> {
    const presentation = await this.prisma.platformPresentation.findUnique({
      where: { id: PRESENTATION_ID },
    });
    return presentation
      ? this.present(presentation)
      : {
          leagueCenterBannerUrl: null,
          leagueCenterBannerCloudFileId: null,
          leagueCenterBannerDataUrl: null,
          version: 0,
        };
  }

  async update(
    adminId: string,
    input: UpdatePlatformPresentationRequest,
  ): Promise<PlatformPresentation> {
    const saved = await this.prisma.$transaction(async (transaction) => {
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
      return saved;
    });
    return this.present(saved);
  }

  private async present(value: {
    leagueCenterBannerUrl: string | null;
    version: number;
  }): Promise<PlatformPresentation> {
    const isCloudFile = value.leagueCenterBannerUrl?.startsWith('cloud://') ?? false;
    const [leagueCenterBannerUrl, storedBanner] = isCloudFile
      ? await Promise.all([
          this.storage.temporaryReadUrl?.(value.leagueCenterBannerUrl!, 3600),
          this.storage.read?.(value.leagueCenterBannerUrl!),
        ])
      : [value.leagueCenterBannerUrl, null];
    if (value.leagueCenterBannerUrl?.startsWith('cloud://') && !leagueCenterBannerUrl) {
      throw new Error('CloudBase banner reads are unavailable');
    }
    return {
      leagueCenterBannerUrl: leagueCenterBannerUrl ?? null,
      leagueCenterBannerCloudFileId: isCloudFile
        ? value.leagueCenterBannerUrl
        : null,
      leagueCenterBannerDataUrl: storedBanner
        ? `data:${storedBanner.mimeType};base64,${storedBanner.buffer.toString('base64')}`
        : null,
      version: value.version,
    };
  }

  private versionConflict() {
    return new AdminError('VERSION_CONFLICT', 'Platform presentation has changed', 409);
  }
}
