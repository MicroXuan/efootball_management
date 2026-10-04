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
  'admin.league-season.set-current': '设置当前赛季',
  'admin.league-season.enroll-teams': '录入参赛球队',
  'league-team.create': '创建联赛球队',
  'league-team.update': '更新联赛球队',
  SALARY_RULE_VERSION_CREATED: '发布工资规则',
  TRANSFER_WINDOW_CREATED: '创建交易窗口',
  TRANSFER_WINDOW_UPDATED: '更新交易窗口',
  ROSTER_PLAYER_ACQUIRED: '购入球员',
  ROSTER_PLAYER_RELEASED: '解约球员',
  ROSTER_PLAYER_SOLD: '出售球员',
  ROSTER_PLAYER_TRANSFERRED: '转会球员',
  ROSTER_PLAYER_CARD_UPGRADED: '升级球员卡片',
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
  FINANCE_ENTRY_CREATED: '登记财务流水'
};

const RESOURCE_LABELS: Record<string, string> = {
  AdminAccount: '管理员账号',
  AdminLeagueRole: '联赛管理权限',
  League: '联赛',
  LeagueSeason: '赛季',
  LeagueTeam: '球队',
  LEAGUE_PLAYER_OWNERSHIP: '球员阵容记录',
  LEAGUE_SALARY_RULE_VERSION: '工资规则',
  TRANSFER_WINDOW: '交易窗口',
  ValuationWindow: '身价窗口',
  ValuationSubmission: '身价申报',
  FinanceLedgerEntry: '财务流水'
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
  const action = ACTION_LABELS[log.action] ?? '其他后台操作';
  const subject = log.subjectDisplayName
    ?? log.leagueName
    ?? RESOURCE_LABELS[log.resourceType]
    ?? '后台资源';
  const result = log.reason ? `已完成 · ${log.reason}` : '已完成';
  const summary = log.action === 'admin.league-season.set-current' && log.leagueName && log.subjectDisplayName
    ? `平台管理员“${actor}”将 ${log.leagueName}的当前赛季设置为“${log.subjectDisplayName}”`
    : `平台管理员“${actor}”对${subject}执行了“${action}”`;
  return { actor, action, subject, result, summary };
}
