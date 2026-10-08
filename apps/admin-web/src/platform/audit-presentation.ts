import type { AuditLog } from '@efm/contracts';

const ACTION_LABELS: Record<string, string> = {
  'admin.account.create': '创建管理员账号',
  'admin.account.update': '更新管理员账号',
  'admin.password.reset': '重置管理员密码',
  'admin.league-grant.create': '授予联赛管理权限',
  'admin.league-grant.revoke': '撤销联赛管理权限',
  'admin.league.create': '创建联赛',
  'admin.league.update': '更新联赛',
  'admin.league-season.create': '创建赛季',
  'admin.league-season.update': '更新赛季',
  'admin.league-season.rename': '修改赛季名称',
  'admin.league-season.set-current': '设置当前赛季',
  'admin.league-season.enroll-teams': '录入参赛球队',
  'league-team.create': '创建联赛球队',
  'league-team.update': '更新联赛球队',
  'admin.cup.create': '创建杯赛',
  'cup.registration.create': '报名杯赛',
  'cup.registration.withdraw': '撤回杯赛报名',
  'admin.cup-group-proposal.generate': '生成杯赛分组方案',
  'admin.cup-group-proposal.confirm': '确认杯赛分组方案',
  'admin.cup-bracket.generate': '生成杯赛淘汰赛签表',
  'admin.cup-bracket.confirm': '确认杯赛淘汰赛签表',
  'admin.competition-stage.schedule.publish': '发布赛事阶段赛程',
  'admin.league-allocation.generate': '生成赛季分组方案',
  'admin.league-allocation.confirm': '确认赛季分组方案',
  'admin.league-allocation.reopen': '重新打开赛季分组',
  'admin.platform-presentation.update': '更新联赛中心 Banner',
  START_PLAYER_CARD_SAMPLE_SYNC: '启动球员卡抽样同步',
  START_PLAYER_CARD_INCREMENTAL_SYNC: '启动球员卡增量同步',
  START_PLAYER_CARD_FULL_SYNC: '启动球员卡全量同步',
  RESUME_PLAYER_CARD_SYNC: '继续球员卡同步',
  PUBLISH_PLAYER_CARD_IMPORT_BATCH: '发布球员卡导入批次',
  REJECT_PLAYER_CARD_IMPORT_BATCH: '驳回球员卡导入批次',
  START_TEAM_SHELL_SAMPLE_SYNC: '启动球队队壳抽样同步',
  START_TEAM_SHELL_INCREMENTAL_SYNC: '启动球队队壳增量同步',
  START_TEAM_SHELL_FULL_SYNC: '启动球队队壳全量同步',
  RESUME_TEAM_SHELL_SYNC: '继续球队队壳同步',
  BATCH_PUBLISH_TEAM_SHELLS: '批量发布球队队壳',
  BATCH_REJECT_TEAM_SHELLS: '批量驳回球队队壳',
  PUBLISH_TEAM_SHELL_SYNC_ITEM: '发布球队队壳',
  REJECT_TEAM_SHELL_SYNC_ITEM: '驳回球队队壳',
  RETRY_TEAM_SHELL_SYNC_ITEM: '重试球队队壳同步失败项',
  RETRY_TEAM_SHELL_SYNC_ITEMS: '重试球队队壳同步失败项',
  SALARY_RULE_VERSION_CREATED: '发布工资规则',
  TRANSFER_WINDOW_CREATED: '创建交易窗口',
  TRANSFER_WINDOW_UPDATED: '更新交易窗口',
  ROSTER_PLAYER_ACQUIRED: '购入球员',
  ROSTER_PLAYER_RELEASED: '解约球员',
  ROSTER_PLAYER_SOLD: '出售球员',
  ROSTER_PLAYER_TRANSFERRED: '转会球员',
  ROSTER_PLAYER_CARD_UPGRADED: '升级球员卡片',
  ROSTER_PLAYER_LIFECYCLE_UPDATED: '更新球员阵容状态',
  ROSTER_EMERGENCY_CORRECTED: '紧急修正阵容',
  ROSTER_SALARIES_RECALCULATED: '重新计算阵容工资',
  VALUATION_WINDOW_CREATED: '创建身价窗口',
  VALUATION_WINDOW_UPDATED: '更新身价窗口',
  VALUATION_WINDOW_CLOSED: '关闭身价窗口',
  VALUATION_SUBMISSION_PUBLISHED: '发布身价申报',
  VALUATION_SUBMISSION_AUTO_APPROVED: '身价申报自动生效',
  VALUATION_SUBMISSION_PENDING_REVIEW: '提交身价人工审核',
  VALUATION_SUBMISSION_APPROVED: '通过身价申报',
  VALUATION_SUBMISSION_REJECTED: '驳回身价申报',
  LEAGUE_TEAM_SHELL_VALUE_UPDATED: '更新队壳价值',
  ROSTER_PLAYER_STATUS_UPDATED: '更新球员状态',
  TRANSACTION_FEE_RULE_CREATED: '发布交易手续费规则',
  TRANSACTION_FEE_CALCULATED: '计算交易手续费',
  FINANCE_ENTRY_CREATED: '登记财务流水',
  FINANCE_MANUAL_ENTRY_CREATED: '登记手工财务流水'
};

const RESOURCE_LABELS: Record<string, string> = {
  AdminAccount: '管理员账号',
  AdminLeagueRole: '联赛管理权限',
  League: '联赛',
  LeagueSeason: '赛季',
  LeagueTeam: '球队',
  Competition: '赛事',
  CompetitionRegistration: '赛事报名',
  CompetitionStage: '赛事阶段',
  CupGroupProposal: '杯赛分组方案',
  CupBracketProposal: '杯赛淘汰赛签表',
  SeasonAllocationProposal: '赛季分组方案',
  PlatformPresentation: '联赛中心 Banner',
  ExternalSyncRun: '球员卡同步任务',
  ImportBatch: '球员卡导入批次',
  TeamCatalogSyncRun: '球队队壳同步任务',
  TeamCatalogSyncItem: '球队队壳同步项目',
  TeamCatalogSyncItemBatch: '球队队壳同步项目',
  LEAGUE_PLAYER_OWNERSHIP: '球员阵容记录',
  LEAGUE_SALARY_RULE_VERSION: '工资规则',
  LEAGUE_TRANSACTION_FEE_RULE_VERSION: '交易手续费规则',
  TRANSFER_WINDOW: '交易窗口',
  ValuationWindow: '身价窗口',
  ValuationSubmission: '身价申报',
  FinanceLedgerEntry: '财务流水',
  FINANCE_LEDGER_ENTRY: '财务流水'
};

export type PresentedAuditLog = {
  actor: string;
  action: string;
  subject: string;
  result: string;
  summary: string;
};

export function presentAuditLog(log: AuditLog): PresentedAuditLog {
  const actor = log.actorDisplayName ?? '未知管理员';
  const isBannerUpdate = log.action === 'admin.platform-presentation.update';
  const isBannerRestore = isBannerUpdate && log.metadata.leagueCenterBannerUrl === null;
  const action = isBannerRestore
    ? '恢复联赛中心默认背景'
    : ACTION_LABELS[log.action] ?? log.action;
  const subject = log.subjectDisplayName
    ?? log.leagueName
    ?? RESOURCE_LABELS[log.resourceType]
    ?? log.resourceType;
  const isTeamBatchAction = ['BATCH_PUBLISH_TEAM_SHELLS', 'BATCH_REJECT_TEAM_SHELLS', 'RETRY_TEAM_SHELL_SYNC_ITEMS'].includes(log.action);
  const isBatchProcessing = isTeamBatchAction && log.metadata.status === 'PROCESSING';
  const result = isBatchProcessing ? '处理中' : log.reason ? `已完成 · ${log.reason}` : '已完成';
  const succeededCount = typeof log.metadata.succeededCount === 'number' ? log.metadata.succeededCount : 0;
  const failedCount = typeof log.metadata.failedCount === 'number' ? log.metadata.failedCount : 0;
  const summary = log.action === 'admin.league-season.set-current' && log.leagueName && log.subjectDisplayName
    ? `平台管理员“${actor}”将 ${log.leagueName}的当前赛季设置为“${log.subjectDisplayName}”`
    : isBannerUpdate
      ? isBannerRestore
        ? `平台管理员“${actor}”恢复了联赛中心默认背景`
        : `平台管理员“${actor}”更新了联赛中心 Banner`
      : isTeamBatchAction
        ? isBatchProcessing
          ? `平台管理员“${actor}”${action}已开始，结果待确认`
          : `平台管理员“${actor}”${action}：成功 ${succeededCount} 条，失败 ${failedCount} 条`
        : `平台管理员“${actor}”对 ${subject} 执行了“${action}”`;
  return { actor, action, subject, result, summary };
}
