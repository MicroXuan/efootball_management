import type { PlayerAcquisitionApplication } from '@efm/contracts'

function team(team: NonNullable<PlayerAcquisitionApplication['sourceTeam']>): string {
  return `${team.teamNumber ?? '未编号'}号（${team.name}-${team.ownerAlias}）`
}

export function forcedOfferCopy(application: PlayerAcquisitionApplication, playerEnglishName: string | null): string {
  if (application.type !== 'FORCED_TRANSFER' || !application.sourceTeam) throw new Error('只有已提交的强报申请可以生成文案')
  const player = playerEnglishName && playerEnglishName !== application.playerName
    ? `${playerEnglishName}（${application.playerName}）`
    : application.playerName
  return `${team(application.applicantTeam)} 强报 ${team(application.sourceTeam)} 的球员 ${player}，本次强报报价 ${application.amountMinor}。`
}

export function activeForcedOfferCopy(application: PlayerAcquisitionApplication | null, playerEnglishName: string | null): string | null {
  return application?.type === 'FORCED_TRANSFER' && application.sourceTeam && ['PENDING', 'REQUOTE_REQUIRED'].includes(application.status)
    ? forcedOfferCopy(application, playerEnglishName)
    : null
}
