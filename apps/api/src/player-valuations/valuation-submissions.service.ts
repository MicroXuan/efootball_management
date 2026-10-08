import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  PublishValuationSubmissionRequestSchema,
  ReviewValuationSubmissionRequestSchema,
  SaveValuationDraftRequestSchema,
  type PublishValuationSubmissionRequest,
  type ReviewValuationSubmissionRequest,
  type SaveValuationDraftRequest,
  type ValuationSubmissionStatus,
  type ValuationSubmissionSummary
} from '@efm/contracts';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { AdminMutationReceiptService } from '../admin/admin-mutation-receipt.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { MutationReceiptService } from '../competitions/mutation-receipt.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { LeagueError } from '../leagues/league.errors.js';
import { valuationRange } from './valuation-calculator.js';
import { ValuationSnapshotsService } from './valuation-snapshots.service.js';
import { ValuationWindowsService } from './valuation-windows.service.js';
import { LeagueVisibilityService } from '../league-visibility/league-visibility.service.js';

type PreparedItem = {
  snapshotId: string;
  footballPlayerId: string;
  previousValueMinor: number | null;
  proposedValueMinor: number;
  minimumAllowedMinor: number;
  maximumAllowedMinor: number;
  exceedsRange: boolean;
};

@Injectable()
export class ValuationSubmissionsService {
  private readonly visibility: LeagueVisibilityService;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ValuationWindowsService) private readonly windows: ValuationWindowsService,
    @Inject(ValuationSnapshotsService) private readonly snapshots: ValuationSnapshotsService,
    @Inject(AdminAuthorizationService) private readonly authorization: AdminAuthorizationService,
    @Inject(MutationReceiptService) private readonly userReceipts: MutationReceiptService,
    @Inject(AdminMutationReceiptService) private readonly adminReceipts: AdminMutationReceiptService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Optional() @Inject(LeagueVisibilityService) visibility?: LeagueVisibilityService
  ) {
    this.visibility = visibility ?? new LeagueVisibilityService(prisma);
  }

  async saveDraft(userId: string, teamId: string, raw: SaveValuationDraftRequest, at = new Date()) {
    const input = SaveValuationDraftRequestSchema.parse(raw);
    await this.visibility.requireVisible({ type: 'TEAM', id: teamId });
    await this.visibility.requireVisible({ type: 'VALUATION_WINDOW', id: input.windowId });
    const context = await this.ownerContext(userId, teamId, input.windowId, at);
    const snapshots = await this.snapshots.ensureWindowSnapshot(input.windowId, at);
    const teamSnapshots = snapshots.filter((snapshot) => snapshot.leagueTeamId === teamId);
    const snapshotById = new Map(teamSnapshots.map((snapshot) => [snapshot.id, snapshot]));
    for (const item of input.items) {
      if (!snapshotById.has(item.snapshotId)) {
        throw new LeagueError('VALUATION_SNAPSHOT_NOT_OWNED', '草稿包含不属于本队快照的球员', 403);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const latest = await tx.valuationSubmission.findFirst({
        where: { windowId: input.windowId, leagueTeamId: teamId },
        orderBy: [{ attemptNumber: 'desc' }, { createdAt: 'desc' }]
      });
      let submission;
      if (!latest || latest.status === 'REJECTED') {
        submission = await tx.valuationSubmission.create({
          data: {
            windowId: input.windowId,
            leagueTeamId: teamId,
            ruleVersionId: context.rule.id,
            attemptNumber: (latest?.attemptNumber ?? 0) + 1,
            submittedByUserId: userId
          }
        });
      } else {
        if (latest.status !== 'DRAFT') {
          throw new LeagueError('VALUATION_SUBMISSION_NOT_EDITABLE', '当前申报不可编辑', 409);
        }
        const changed = await tx.valuationSubmission.updateMany({
          where: { id: latest.id, status: 'DRAFT', version: input.expectedVersion },
          data: { ruleVersionId: context.rule.id, version: { increment: 1 } }
        });
        if (changed.count !== 1) {
          throw new LeagueError('VALUATION_SUBMISSION_VERSION_CONFLICT', '草稿已发生变化，请刷新后重试', 409);
        }
        submission = await tx.valuationSubmission.findUniqueOrThrow({ where: { id: latest.id } });
      }
      for (const item of input.items) {
        const snapshot = snapshotById.get(item.snapshotId)!;
        const range = valuationRange(snapshot.baseValueMinor, context.rule);
        await tx.valuationSubmissionItem.upsert({
          where: { submissionId_snapshotId: { submissionId: submission.id, snapshotId: item.snapshotId } },
          create: {
            submissionId: submission.id,
            snapshotId: item.snapshotId,
            baseValueMinor: snapshot.baseValueMinor,
            proposedValueMinor: item.proposedValueMinor,
            minimumAllowedMinor: range.minimum,
            maximumAllowedMinor: range.maximum,
            exceedsRange: item.proposedValueMinor < range.minimum || item.proposedValueMinor > range.maximum
          },
          update: {
            baseValueMinor: snapshot.baseValueMinor,
            proposedValueMinor: item.proposedValueMinor,
            minimumAllowedMinor: range.minimum,
            maximumAllowedMinor: range.maximum,
            exceedsRange: item.proposedValueMinor < range.minimum || item.proposedValueMinor > range.maximum
          }
        });
      }
      return this.summary(submission);
    });
  }

  async publish(
    userId: string,
    teamId: string,
    raw: PublishValuationSubmissionRequest,
    idempotencyKey: string,
    at = new Date()
  ) {
    const input = PublishValuationSubmissionRequestSchema.parse(raw);
    await this.visibility.requireVisible({ type: 'TEAM', id: teamId });
    await this.visibility.requireVisible({ type: 'VALUATION_WINDOW', id: input.windowId });
    const context = await this.ownerContext(userId, teamId, input.windowId, at);
    const snapshots = (await this.snapshots.ensureWindowSnapshot(input.windowId, at))
      .filter((snapshot) => snapshot.leagueTeamId === teamId);

    return await this.userReceipts.execute(userId, `VALUATION_PUBLISH:${teamId}:${input.windowId}`, idempotencyKey, async (tx) => {
      const draft = await tx.valuationSubmission.findFirst({
        where: { windowId: input.windowId, leagueTeamId: teamId, status: 'DRAFT' },
        include: { items: true },
        orderBy: [{ attemptNumber: 'desc' }, { createdAt: 'desc' }]
      });
      if (!draft) throw new LeagueError('VALUATION_DRAFT_NOT_FOUND', '请先保存身价草稿', 409);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM valuation_submissions WHERE id = ${draft.id} FOR UPDATE`);
      const locked = await tx.valuationSubmission.findUniqueOrThrow({
        where: { id: draft.id },
        include: { items: true }
      });
      if (locked.status !== 'DRAFT') {
        throw new LeagueError('VALUATION_SUBMISSION_ALREADY_PUBLISHED', '该申报已经发布，请勿重复提交', 409);
      }
      if (locked.version !== input.expectedVersion) {
        throw new LeagueError('VALUATION_SUBMISSION_VERSION_CONFLICT', '草稿已发生变化，请刷新后重试', 409);
      }
      const draftBySnapshot = new Map(locked.items.map((item) => [item.snapshotId, item]));
      const prepared = snapshots.map((snapshot): PreparedItem => {
        const item = draftBySnapshot.get(snapshot.id);
        if (!item && snapshot.baseValueMinor === null) {
          throw new LeagueError('VALUATION_FIRST_VALUE_REQUIRED', '首次身价必须全部填写后才能发布', 422);
        }
        const proposedValueMinor = item?.proposedValueMinor ?? snapshot.baseValueMinor!;
        const range = valuationRange(snapshot.baseValueMinor, context.rule);
        if (snapshot.baseValueMinor === null
          && (proposedValueMinor < range.minimum || proposedValueMinor > range.maximum)) {
          throw new LeagueError(
            'VALUATION_FIRST_VALUE_OUT_OF_RANGE',
            `首次身价必须在 ${range.minimum} 至 ${range.maximum} 之间`,
            422
          );
        }
        const unchanged = snapshot.baseValueMinor !== null
          && proposedValueMinor === snapshot.baseValueMinor;
        if (!unchanged && (proposedValueMinor < context.rule.minimumValueMinor
          || proposedValueMinor > context.rule.maximumValueMinor)) {
          throw new LeagueError(
            'VALUATION_GLOBAL_RANGE_EXCEEDED',
            `身价必须在 ${context.rule.minimumValueMinor} 至 ${context.rule.maximumValueMinor} 之间`,
            422
          );
        }
        return {
          snapshotId: snapshot.id,
          footballPlayerId: snapshot.footballPlayerId,
          previousValueMinor: snapshot.baseValueMinor,
          proposedValueMinor,
          minimumAllowedMinor: range.minimum,
          maximumAllowedMinor: range.maximum,
          exceedsRange: !unchanged
            && (proposedValueMinor < range.minimum || proposedValueMinor > range.maximum)
        };
      });
      for (const item of prepared) {
        await tx.valuationSubmissionItem.upsert({
          where: { submissionId_snapshotId: { submissionId: locked.id, snapshotId: item.snapshotId } },
          create: { submissionId: locked.id, ...this.itemData(item) },
          update: this.itemData(item)
        });
      }
      const status = prepared.some((item) => item.exceedsRange) ? 'PENDING_REVIEW' : 'PUBLISHED';
      const updated = await tx.valuationSubmission.update({
        where: { id: locked.id },
        data: {
          status,
          ruleVersionId: context.rule.id,
          submittedAt: at,
          version: { increment: 1 }
        }
      });
      if (status === 'PUBLISHED') {
        await this.applyValuations(tx, context.leagueId, locked.id, prepared, at);
      }
      await this.audit.record(tx, {
        actorUserId: userId,
        leagueId: context.leagueId,
        action: status === 'PUBLISHED'
          ? 'VALUATION_SUBMISSION_AUTO_APPROVED'
          : 'VALUATION_SUBMISSION_PENDING_REVIEW',
        resourceType: 'ValuationSubmission',
        resourceId: locked.id,
        metadata: { windowId: input.windowId, leagueTeamId: teamId, playerCount: prepared.length }
      });
      return this.summary({ ...updated, status });
    }) as ValuationSubmissionSummary;
  }

  approve(adminId: string, submissionId: string, raw: ReviewValuationSubmissionRequest, key: string, at = new Date()) {
    return this.review(adminId, submissionId, raw, key, 'APPROVED', at);
  }

  reject(adminId: string, submissionId: string, raw: ReviewValuationSubmissionRequest, key: string, at = new Date()) {
    return this.review(adminId, submissionId, raw, key, 'REJECTED', at);
  }

  async listForLeague(adminId: string, leagueId: string) {
    await this.visibility.requireVisible({ type: 'LEAGUE', id: leagueId });
    await this.authorization.requireLeagueManager(adminId, leagueId);
    const submissions = await this.prisma.valuationSubmission.findMany({
      where: { window: { season: { leagueId } } },
      include: {
        window: true,
        leagueTeam: true,
        submittedByUser: true,
        reviewedByAdmin: true,
        items: { include: { snapshot: { include: { footballPlayer: true } } } }
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100
    });
    return {
      items: submissions.map((submission) => ({
        id: submission.id,
        windowId: submission.windowId,
        leagueTeamId: submission.leagueTeamId,
        ruleVersionId: submission.ruleVersionId,
        attemptNumber: submission.attemptNumber,
        status: submission.status,
        submittedAt: submission.submittedAt?.toISOString() ?? null,
        reviewedAt: submission.reviewedAt?.toISOString() ?? null,
        reviewReason: submission.reviewReason,
        version: submission.version,
        teamName: submission.leagueTeam.name,
        windowName: submission.window.name,
        submittedByDisplayName: submission.submittedByUser.displayName || '未命名用户',
        reviewedByDisplayName: submission.reviewedByAdmin?.displayName ?? null,
        items: submission.items.map((item) => ({
          snapshotId: item.snapshotId,
          playerId: item.snapshot.footballPlayerId,
          playerName: item.snapshot.footballPlayer.nameZh
            ?? item.snapshot.footballPlayer.nameEn
            ?? item.snapshot.footballPlayer.shortName
            ?? '未命名球员',
          baseValueMinor: item.baseValueMinor,
          proposedValueMinor: item.proposedValueMinor,
          minimumAllowedMinor: item.minimumAllowedMinor,
          maximumAllowedMinor: item.maximumAllowedMinor,
          exceedsRange: item.exceedsRange
        }))
      })),
      nextCursor: null
    };
  }

  private async review(
    adminId: string,
    submissionId: string,
    raw: ReviewValuationSubmissionRequest,
    key: string,
    decision: 'APPROVED' | 'REJECTED',
    at: Date
  ) {
    const input = ReviewValuationSubmissionRequestSchema.parse(raw);
    await this.visibility.requireVisible({ type: 'VALUATION_SUBMISSION', id: submissionId });
    const current = await this.prisma.valuationSubmission.findUniqueOrThrow({
      where: { id: submissionId },
      include: { window: { include: { season: true } } }
    });
    const leagueId = current.window.season.leagueId;
    await this.authorization.requireLeagueManager(adminId, leagueId);
    return await this.adminReceipts.execute(adminId, `VALUATION_REVIEW:${decision}:${submissionId}`, key, async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM valuation_submissions WHERE id = ${submissionId} FOR UPDATE`);
      const locked = await tx.valuationSubmission.findUniqueOrThrow({
        where: { id: submissionId },
        include: { items: { include: { snapshot: true } } }
      });
      if (locked.status !== 'PENDING_REVIEW') {
        throw new LeagueError('VALUATION_SUBMISSION_NOT_PENDING', '该申报已不在待审核状态', 409);
      }
      if (locked.version !== input.expectedVersion) {
        throw new LeagueError('VALUATION_SUBMISSION_VERSION_CONFLICT', '申报已发生变化，请刷新后重试', 409);
      }
      if (decision === 'APPROVED') {
        await this.applyValuations(tx, leagueId, submissionId, locked.items.map((item) => ({
          snapshotId: item.snapshotId,
          footballPlayerId: item.snapshot.footballPlayerId,
          previousValueMinor: item.baseValueMinor,
          proposedValueMinor: item.proposedValueMinor,
          minimumAllowedMinor: item.minimumAllowedMinor,
          maximumAllowedMinor: item.maximumAllowedMinor,
          exceedsRange: item.exceedsRange
        })), at);
      }
      const updated = await tx.valuationSubmission.update({
        where: { id: submissionId },
        data: {
          status: decision,
          reviewedByAdminId: adminId,
          reviewedAt: at,
          reviewReason: input.reason,
          version: { increment: 1 }
        }
      });
      await this.audit.record(tx, {
        actorAdminId: adminId,
        leagueId,
        action: decision === 'APPROVED' ? 'VALUATION_SUBMISSION_APPROVED' : 'VALUATION_SUBMISSION_REJECTED',
        resourceType: 'ValuationSubmission',
        resourceId: submissionId,
        reason: input.reason,
        metadata: { windowId: locked.windowId, leagueTeamId: locked.leagueTeamId, playerCount: locked.items.length }
      });
      return this.summary({ ...updated, status: decision });
    }, input);
  }

  private async ownerContext(userId: string, teamId: string, windowId: string, at: Date) {
    const team = await this.prisma.leagueTeam.findUnique({ where: { id: teamId } });
    if (!team || team.ownerUserId !== userId) {
      throw new LeagueError('VALUATION_TEAM_OWNER_REQUIRED', '只有球队拥有者可以提交身价', 403);
    }
    const effective = await this.windows.getEffectiveRule(windowId, at);
    if (effective.window.state !== 'OPEN') {
      throw new LeagueError('VALUATION_WINDOW_NOT_OPEN', '身价窗口当前未开放', 409);
    }
    const entry = await this.prisma.seasonEntry.findFirst({
      where: { seasonId: effective.window.seasonId, leagueTeamId: teamId, ownerUserId: userId, status: 'APPROVED' }
    });
    if (!entry) throw new LeagueError('VALUATION_SEASON_ENTRY_REQUIRED', '只有已报名并通过的球队可以提交身价', 403);
    return effective;
  }

  private async applyValuations(
    tx: Prisma.TransactionClient,
    leagueId: string,
    submissionId: string,
    items: PreparedItem[],
    at: Date
  ) {
    for (const item of items) {
      if (item.previousValueMinor === item.proposedValueMinor) continue;
      await tx.leaguePlayerValuation.upsert({
        where: { leagueId_footballPlayerId: { leagueId, footballPlayerId: item.footballPlayerId } },
        create: {
          leagueId,
          footballPlayerId: item.footballPlayerId,
          currentValueMinor: item.proposedValueMinor,
          sourceSubmissionId: submissionId,
          effectiveAt: at
        },
        update: {
          currentValueMinor: item.proposedValueMinor,
          sourceSubmissionId: submissionId,
          effectiveAt: at,
          version: { increment: 1 }
        }
      });
      await tx.playerValuationHistory.create({
        data: {
          leagueId,
          footballPlayerId: item.footballPlayerId,
          submissionId,
          previousValueMinor: item.previousValueMinor,
          newValueMinor: item.proposedValueMinor,
          effectiveAt: at
        }
      });
    }
  }

  private itemData(item: PreparedItem) {
    return {
      snapshotId: item.snapshotId,
      baseValueMinor: item.previousValueMinor,
      proposedValueMinor: item.proposedValueMinor,
      minimumAllowedMinor: item.minimumAllowedMinor,
      maximumAllowedMinor: item.maximumAllowedMinor,
      exceedsRange: item.exceedsRange
    };
  }

  private summary(submission: {
    id: string;
    windowId: string;
    leagueTeamId: string;
    ruleVersionId: string;
    attemptNumber: number;
    status: ValuationSubmissionStatus;
    submittedAt: Date | string | null;
    reviewedAt: Date | string | null;
    reviewReason: string | null;
    version: number;
  }): ValuationSubmissionSummary {
    return {
      id: submission.id,
      windowId: submission.windowId,
      leagueTeamId: submission.leagueTeamId,
      ruleVersionId: submission.ruleVersionId,
      attemptNumber: submission.attemptNumber,
      status: submission.status,
      submittedAt: submission.submittedAt instanceof Date ? submission.submittedAt.toISOString() : submission.submittedAt ?? null,
      reviewedAt: submission.reviewedAt instanceof Date ? submission.reviewedAt.toISOString() : submission.reviewedAt ?? null,
      reviewReason: submission.reviewReason ?? null,
      version: submission.version
    };
  }
}
