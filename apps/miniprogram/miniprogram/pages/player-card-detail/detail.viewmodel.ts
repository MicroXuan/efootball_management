import type { PlayerCardDetail, PlayerPosition } from '@efm/contracts'
import { toCardViewModel, type PlayerCardViewModel } from '../players/players.viewmodel'

const attributeOrder = [
  'overall',
  'speed',
  'acceleration',
  'finishing',
  'passing',
  'dribbling',
  'defending',
  'physical',
  'stamina',
  'goalkeeping',
]

const attributeLabels: Record<string, string> = {
  overall: '总评',
  speed: '速度',
  acceleration: '加速',
  finishing: '射门',
  passing: '传球',
  dribbling: '盘带',
  defending: '防守',
  physical: '身体',
  stamina: '体力',
  goalkeeping: '守门',
  offensiveAwareness: '进攻意识',
  ballControl: '控球',
  tightPossession: '紧密控球',
  lowPass: '地面传球',
  loftedPass: '空中传球',
  heading: '头球',
  placeKicking: '罚定位球',
  setPieceTaking: '罚定位球',
  curl: '弧线球',
  defensiveAwareness: '防守意识',
  tackling: '铲球',
  aggression: '积极性',
  defensiveEngagement: '防守参与度',
  gkAwareness: '守门员意识',
  gkCatching: '守门员接球',
  gkParrying: '守门员扑救',
  gkReflexes: '守门员扑救反应',
  gkReach: '守门员臂展',
  kickingPower: '脚下力量',
  jump: '跳起',
  physicalContact: '身体接触',
  balance: '平衡',
  weight: '体重',
}

const profileAttributeKeys = new Set([
  'age',
  'height',
  'heightCm',
  'preferredFoot',
  'foot',
  'atRating',
  'at',
])

const positionCodes: PlayerPosition[] = [
  'LWF', 'CF', 'RWF', 'LMF', 'AMF', 'RMF', 'CMF', 'DMF', 'LB', 'CB', 'RB', 'SS', 'GK',
]

const positionLabels: Record<PlayerPosition, string> = {
  GK: '门将', CB: '中后卫', LB: '左后卫', RB: '右后卫', DMF: '后腰', CMF: '中前卫',
  LMF: '左前卫', RMF: '右前卫', AMF: '前腰', LWF: '左边锋', RWF: '右边锋', SS: '影锋', CF: '中锋',
}

const allocationLabels: Record<string, string> = {
  shooting: '射门',
  passing: '传球',
  dribbling: '盘球',
  dexterity: '灵巧',
  lowerBodyStrength: '下肢力量',
  aerialStrength: '空中力量',
  defending: '防守',
  goalkeeping: '守门',
  goalkeeping1: '守门1',
  goalkeeping2: '守门2',
  goalkeeping3: '守门3',
}

const allocationOrder = [
  'shooting', 'passing', 'dribbling', 'dexterity', 'lowerBodyStrength',
  'aerialStrength', 'defending', 'goalkeeping', 'goalkeeping1', 'goalkeeping2', 'goalkeeping3',
]

const allocationAttributeKeys: Record<string, string[]> = {
  shooting: ['finishing', 'heading', 'setPieceTaking', 'curl'],
  passing: ['passing', 'lowPass', 'loftedPass'],
  dribbling: ['dribbling', 'ballControl', 'tightPossession'],
  dexterity: ['offensiveAwareness', 'acceleration', 'balance'],
  lowerBodyStrength: ['speed', 'kickingPower', 'stamina'],
  aerialStrength: ['heading', 'jump', 'physical', 'physicalContact'],
  defending: ['defending', 'defensiveAwareness', 'tackling', 'aggression', 'defensiveEngagement'],
  goalkeeping: ['goalkeeping', 'gkAwareness', 'gkCatching', 'gkParrying', 'gkReflexes', 'gkReach'],
  goalkeeping1: ['goalkeeping', 'gkAwareness', 'jump'],
  goalkeeping2: ['gkParrying', 'gkReach'],
  goalkeeping3: ['gkCatching', 'gkReflexes'],
}

const automaticBuildWeights: number[][] = [
  [13, 40, 0, 66, 67, 213, 13, 412, 399, 399],
  [41, 164, 55, 231, 109, 368, 573, 0, 0, 0],
  [184, 269, 72, 440, 208, 159, 294, 0, 0, 0],
  [184, 269, 72, 440, 208, 159, 294, 0, 0, 0],
  [183, 134, 61, 306, 244, 220, 464, 0, 0, 0],
  [318, 208, 97, 330, 367, 85, 233, 0, 0, 0],
  [354, 318, 134, 367, 331, 48, 109, 0, 0, 0],
  [354, 318, 134, 367, 331, 48, 109, 0, 0, 0],
  [391, 281, 208, 257, 355, 60, 84, 0, 0, 0],
  [404, 391, 183, 330, 171, 85, 60, 0, 0, 0],
  [404, 391, 183, 330, 171, 85, 60, 0, 0, 0],
  [419, 346, 308, 234, 173, 99, 36, 0, 0, 0],
  [222, 419, 382, 259, 49, 210, 36, 0, 0, 0],
]

const positionIndex: Record<PlayerPosition, number> = {
  GK: 0, CB: 1, LB: 2, RB: 3, DMF: 4, CMF: 5, LMF: 6,
  RMF: 7, AMF: 8, LWF: 9, RWF: 10, SS: 11, CF: 12,
}

const positionMetricWeights: Record<PlayerPosition, [number, number, number, number, number, number]> = {
  GK: [0.02, 0.02, 0.02, 0.02, 0.08, 0.84],
  CB: [0.03, 0.08, 0.04, 0.12, 0.46, 0.27],
  LB: [0.04, 0.16, 0.08, 0.26, 0.28, 0.18],
  RB: [0.04, 0.16, 0.08, 0.26, 0.28, 0.18],
  DMF: [0.04, 0.22, 0.10, 0.15, 0.34, 0.15],
  CMF: [0.08, 0.30, 0.20, 0.16, 0.16, 0.10],
  LMF: [0.12, 0.24, 0.25, 0.25, 0.08, 0.06],
  RMF: [0.12, 0.24, 0.25, 0.25, 0.08, 0.06],
  AMF: [0.18, 0.30, 0.30, 0.14, 0.04, 0.04],
  LWF: [0.23, 0.16, 0.29, 0.25, 0.03, 0.04],
  RWF: [0.23, 0.16, 0.29, 0.25, 0.03, 0.04],
  SS: [0.28, 0.20, 0.27, 0.17, 0.03, 0.05],
  CF: [0.38, 0.07, 0.13, 0.19, 0.04, 0.19],
}

export type PlayerProfileFact = {
  key: string
  label: string
  value: string
  wide?: boolean
}

export type PlayerCardDetailViewModel = PlayerCardViewModel & {
  nationality: string | null
  club: string | null
  status: PlayerCardDetail['status']
  skills: PlayerCardDetail['skills']
  profileFacts: PlayerProfileFact[]
  attributes: Array<{
    key: string
    label: string
    value: number
    tone: 'elite' | 'standard'
    barWidth: number
  }>
  siblings: Array<{
    id: string
    title: string
    overallRating: number
    positionLabel: string
    cardTypeLabel: string
  }>
  autoBuild: {
    available: boolean
    maxOverall: number | null
    dtRating: number | null
    allocationRows: Array<{ key: string; label: string; points: number }>
    unavailableReason: string
  }
}

export type PlayerCardPresentation = {
  overallRating: number
  attributes: Array<{
    key: string
    label: string
    value: number
    delta: number
    tone: 'elite' | 'standard'
    barWidth: number
  }>
  radarMetrics: Array<{ key: string; label: string; value: number | null }>
  radarChart: RadarChartGeometry
  positions: Array<{ code: PlayerPosition; label: string; rating: number | null; isPrimary: boolean }>
}

export type RadarChartGeometry = {
  polygon: string
  dots: Array<{ key: string; style: string }>
  outline: Array<{ key: string; style: string }>
  axes: Array<{ key: string; style: string }>
  rings: Array<{ key: string; segments: Array<{ key: string; style: string }> }>
}

export type AutomaticBuildPanelState = {
  buttonLabel: string
  note: string
  showVisuals: boolean
}

export function automaticBuildPanelState(
  buildAvailable: boolean,
  applied: boolean,
): AutomaticBuildPanelState {
  if (!buildAvailable) {
    return {
      buttonLabel: '已是最终能力',
      note: '无需加点',
      showVisuals: true,
    }
  }
  if (!applied) {
    return {
      buttonLabel: '自动加点',
      note: '可自动加点',
      showVisuals: true,
    }
  }
  return {
    buttonLabel: '重置加点',
    note: '已应用',
    showVisuals: true,
  }
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function recordedNumber(value: unknown): string {
  const number = finiteNumber(value)
  return number === null ? '未记录' : String(number)
}

function preferredFoot(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '未记录'
  const normalized = value.trim().toLocaleUpperCase('en-US')
  const labels: Record<string, string> = {
    LEFT: '左脚',
    L: '左脚',
    RIGHT: '右脚',
    R: '右脚',
    BOTH: '双足',
  }
  return labels[normalized] ?? value.trim()
}

function displayDate(value: string): string {
  return value.slice(0, 10).replace(/-/g, '.')
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function average(values: Array<number | null>): number | null {
  const finite = values.filter((value): value is number => value !== null)
  return finite.length ? Math.round(finite.reduce((sum, value) => sum + value, 0) / finite.length) : null
}

function sourceNumber(source: Record<string, unknown> | null, key: string): number | null {
  const value = source?.[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function canonicalAttributes(detail: PlayerCardDetail): Record<string, number> {
  const values = Object.fromEntries(Object.entries(detail.attributes).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]),
  ))
  const source = objectRecord(detail.attributes.sourceMetadata)
  const direct: Record<string, string> = {
    speed: 'Speed', acceleration: 'Acceleration', finishing: 'Finishing', dribbling: 'Dribbling',
    stamina: 'Stamina', goalkeeping: 'Goalkeeping', ballControl: 'BallControl',
    tightPossession: 'TightPossession', lowPass: 'LowPass', loftedPass: 'LoftedPass',
    defensiveAwareness: 'DefensiveAwareness', tackling: 'Tackling', aggression: 'Aggression',
    defensiveEngagement: 'DefensiveEngagement', physicalContact: 'PhysicalContact',
    kickingPower: 'KickingPower', jump: 'Jump', heading: 'Heading', placeKicking: 'PlaceKicking',
    curl: 'Curl', gkCatching: 'gkCatching', gkParrying: 'gkParrying',
    gkReflexes: 'gkReflexes', gkReach: 'gkReach', offensiveAwareness: 'OffensiveAwareness',
    balance: 'Balance',
  }
  for (const [target, sourceKey] of Object.entries(direct)) {
    const value = sourceNumber(source, sourceKey)
    if (values[target] === undefined && value !== null) values[target] = value
  }
  const derived = {
    passing: average([values.lowPass ?? null, values.loftedPass ?? null]),
    dribbling: average([values.ballControl ?? null, values.dribbling ?? null, values.tightPossession ?? null]),
    defending: average([
      values.defensiveAwareness ?? null, values.tackling ?? null,
      values.aggression ?? null, values.defensiveEngagement ?? null,
    ]),
    physical: average([values.physicalContact ?? null, values.kickingPower ?? null, values.jump ?? null]),
    goalkeeping: average([
      values.goalkeeping ?? null, values.gkCatching ?? null, values.gkParrying ?? null,
      values.gkReflexes ?? null, values.gkReach ?? null,
    ]),
  }
  for (const [key, value] of Object.entries(derived)) {
    if (value !== null) values[key] = value
  }
  return values
}

function attributeRows(
  detail: PlayerCardDetail,
  applied: boolean,
): PlayerCardPresentation['attributes'] {
  const deltas = new Map<string, number>()
  if (applied && detail.autoBuild) {
    for (const [category, points] of Object.entries(detail.autoBuild.allocation)) {
      for (const key of allocationAttributeKeys[category] ?? []) {
        deltas.set(key, (deltas.get(key) ?? 0) + points)
      }
    }
  }
  const known = new Map(attributeOrder.map((key, index) => [key, index]))
  return Object.entries(canonicalAttributes(detail))
    .filter((entry): entry is [string, number] => (
      !profileAttributeKeys.has(entry[0])
      && typeof entry[1] === 'number'
      && Number.isFinite(entry[1])
    ))
    .sort(([left], [right]) => {
      const leftOrder = known.get(left)
      const rightOrder = known.get(right)
      if (leftOrder !== undefined || rightOrder !== undefined) {
        return (leftOrder ?? Number.MAX_SAFE_INTEGER) - (rightOrder ?? Number.MAX_SAFE_INTEGER)
      }
      return left.localeCompare(right, 'en-US')
    })
    .map(([key, baseValue]) => {
      const delta = deltas.get(key) ?? 0
      const value = Math.min(110, baseValue + delta)
      return {
        key,
        label: attributeLabels[key] ?? key,
        value,
        delta,
        tone: value >= 90 ? 'elite' as const : 'standard' as const,
        barWidth: Math.min(100, Math.max(0, value)),
      }
    })
}

function automaticAllocation(position: PlayerPosition, availablePoints: number): Record<string, number> {
  const categoryKeys = [
    'dribbling', 'dexterity', 'shooting', 'lowerBodyStrength', 'passing',
    'aerialStrength', 'defending', 'goalkeeping1', 'goalkeeping2', 'goalkeeping3',
  ]
  const baseWeights = automaticBuildWeights[positionIndex[position]]!
  const weights = [...baseWeights]
  const levels = new Array(10).fill(0) as number[]
  let remaining = Math.max(0, Math.floor(availablePoints))
  for (let pass = 0; pass < categoryKeys.length; pass += 1) {
    while (remaining > 0) {
      const currentWeight = [...weights].sort((left, right) => right - left)[pass]
      const category = weights.indexOf(currentWeight ?? -1)
      if (category < 0) break
      const cost = Math.ceil((levels[category]! + 1) / 4)
      if (remaining < cost) break
      levels[category] = levels[category]! + 1
      remaining -= Math.ceil(levels[category]! / 4)
      weights[category] = Math.floor(baseWeights[category]! / Math.ceil((levels[category]! + 1) / 4))
    }
  }
  return Object.fromEntries(categoryKeys.map((key, index) => [key, levels[index] ?? 0]))
}

function derivedAutomaticBuild(detail: PlayerCardDetail): PlayerCardDetailViewModel['autoBuild'] {
  if (detail.cardType === 'TRENDING') {
    return {
      available: false, maxOverall: null, dtRating: null, allocationRows: [],
      unavailableReason: '状态火热卡为成品卡，无需分配成长点。',
    }
  }
  const source = objectRecord(detail.attributes.sourceMetadata)
  const availablePoints = sourceNumber(source, 'maxLevel')
  if (availablePoints === null || availablePoints <= 0) {
    return {
      available: false, maxOverall: null, dtRating: null, allocationRows: [],
      unavailableReason: '该卡未提供成长等级，暂时无法自动加点。',
    }
  }
  const allocationRows = Object.entries(automaticAllocation(detail.position, availablePoints))
    .filter(([, points]) => points > 0)
    .sort(([left], [right]) => allocationOrder.indexOf(left) - allocationOrder.indexOf(right))
    .map(([key, points]) => ({ key, label: allocationLabels[key] ?? key, points }))
  const allocatedLevels = allocationRows.reduce((sum, row) => sum + row.points, 0)
  return {
    available: true,
    maxOverall: Math.min(110, detail.overallRating + Math.round(allocatedLevels / 3.15)),
    dtRating: null,
    allocationRows,
    unavailableReason: '',
  }
}

function estimatedPositionRatings(
  detail: PlayerCardDetail,
  attributes: Record<string, number>,
  overallRating: number,
): Partial<Record<PlayerPosition, number>> {
  const metrics = [
    attributes.finishing, attributes.passing, attributes.dribbling,
    attributes.speed, attributes.defending, attributes.physical,
  ]
  if (metrics.some((value) => typeof value !== 'number')) return {}
  const score = (position: PlayerPosition) => positionMetricWeights[position]
    .reduce((sum, weight, index) => sum + weight * metrics[index]!, 0)
  const primaryScore = score(detail.position)
  return Object.fromEntries(positionCodes.map((position) => [
    position,
    position === detail.position
      ? overallRating
      : position === 'GK'
        ? Math.min(110, Math.max(40, Math.round(
          (attributes.goalkeeping ?? 40) + (overallRating - primaryScore) * 0.65,
        )))
        : Math.min(110, Math.max(40, Math.round(
          overallRating + (score(position) - primaryScore) * 0.9,
        ))),
  ]))
}

export function playerCardPresentation(
  detail: PlayerCardDetail,
  applied: boolean,
): PlayerCardPresentation {
  const attributes = attributeRows(detail, applied)
  const attributeValues = Object.fromEntries(attributes.map(({ key, value }) => [key, value]))
  const radarKeys = [
    ['finishing', '射门'],
    ['passing', '传球'],
    ['dribbling', '盘带'],
    ['speed', '速度'],
    ['defending', '防守'],
    ['physical', '力量'],
  ] as const
  const overallRating = applied && detail.autoBuild ? detail.autoBuild.maxOverall : detail.overallRating
  const importedPositionRatings = objectRecord(detail.attributes.positionRatings)
  const derivedPositionRatings = estimatedPositionRatings(detail, attributeValues, overallRating)
  const baseAttributeValues = applied
    ? Object.fromEntries(attributeRows(detail, false).map(({ key, value }) => [key, value]))
    : attributeValues
  const basePositionRatings = estimatedPositionRatings(detail, baseAttributeValues, detail.overallRating)
  const radarMetrics = radarKeys.map(([key, label]) => ({
    key,
    label,
    value: typeof attributeValues[key] === 'number' ? attributeValues[key] : null,
  }))
  return {
    overallRating,
    attributes,
    radarMetrics,
    radarChart: radarChartGeometry(radarMetrics.map(({ value }) => value ?? 0)),
    positions: positionCodes.map((code) => {
      const importedRating = importedPositionRatings?.[code]
      const importedNumber = typeof importedRating === 'number' && Number.isFinite(importedRating)
        ? importedRating
        : null
      const derivedRating = derivedPositionRatings[code]
      const baseDerivedRating = basePositionRatings[code]
      const rating = applied && detail.autoBuild
        ? code === detail.position
          ? overallRating
          : importedNumber !== null && derivedRating !== undefined && baseDerivedRating !== undefined
            ? Math.min(110, Math.max(40, importedNumber + derivedRating - baseDerivedRating))
            : derivedRating ?? null
        : importedNumber ?? derivedRating ?? (code === detail.position ? overallRating : null)
      return { code, label: positionLabels[code], rating, isPrimary: code === detail.position }
    }),
  }
}

export function radarVertices(
  values: number[],
  width: number,
  height: number,
): Array<{ x: number; y: number }> {
  const radius = Math.min(width, height) * 0.4
  const centerX = width / 2
  const centerY = height / 2
  return values.map((value, index) => {
    const angle = -Math.PI / 2 + index * (Math.PI * 2 / values.length)
    const scaled = radius * Math.min(100, Math.max(0, value)) / 100
    return {
      x: Math.round((centerX + Math.cos(angle) * scaled) * 100) / 100,
      y: Math.round((centerY + Math.sin(angle) * scaled) * 100) / 100,
    }
  })
}

function decimal(value: number): string {
  return String(Math.round(value * 100) / 100)
}

function lineStyle(
  start: { x: number; y: number },
  end: { x: number; y: number },
): string {
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  const length = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
  const angle = Math.atan2(deltaY, deltaX) * 180 / Math.PI
  return `left:${decimal(start.x)}%;top:${decimal(start.y)}%;width:${decimal(length)}%;transform:rotate(${decimal(angle)}deg);`
}

export function radarChartGeometry(values: number[]): RadarChartGeometry {
  const normalized = new Array(6).fill(0).map((_, index) => {
    const value = values[index]
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
  })
  const points = radarVertices(normalized, 100, 100)
  const axes = radarVertices(new Array(6).fill(100), 100, 100).map((point, index) => ({
    key: `axis-${index}`,
    style: lineStyle({ x: 50, y: 50 }, point),
  }))
  const rings = [25, 50, 75, 100].map((level) => {
    const vertices = radarVertices(new Array(6).fill(level), 100, 100)
    return {
      key: `ring-${level}`,
      segments: vertices.map((point, index) => ({
        key: `ring-${level}-${index}`,
        style: lineStyle(point, vertices[(index + 1) % vertices.length]!),
      })),
    }
  })
  return {
    polygon: points.map(({ x, y }) => `${decimal(x)}% ${decimal(y)}%`).join(', '),
    dots: points.map(({ x, y }, index) => ({
      key: `point-${index}`,
      style: `left:${decimal(x)}%;top:${decimal(y)}%;`,
    })),
    outline: points.map((point, index) => ({
      key: `outline-${index}`,
      style: lineStyle(point, points[(index + 1) % points.length]!),
    })),
    axes,
    rings,
  }
}

function buildProfileFacts(detail: PlayerCardDetail, card: PlayerCardViewModel): PlayerProfileFact[] {
  const age = finiteNumber(detail.attributes.age)
  const height = finiteNumber(detail.attributes.heightCm ?? detail.attributes.height)
  const packName = card.packName
    ? [card.packName, detail.pack?.season].filter(Boolean).join(' · ')
    : '未记录'

  return [
    { key: 'position', label: '位置', value: card.positionLabel },
    { key: 'nationality', label: '国籍', value: detail.nationality ?? '未记录' },
    { key: 'club', label: '俱乐部', value: detail.club ?? '未记录', wide: true },
    { key: 'age', label: '年龄', value: age === null ? '未记录' : `${age} 岁` },
    { key: 'height', label: '身高', value: height === null ? '未记录' : `${height} cm` },
    {
      key: 'foot',
      label: '惯用脚',
      value: preferredFoot(detail.attributes.preferredFoot ?? detail.attributes.foot),
    },
    {
      key: 'atRating',
      label: 'AT 评分',
      value: recordedNumber(detail.attributes.atRating ?? detail.attributes.at),
    },
    { key: 'playStyle', label: '比赛风格', value: detail.playStyle ?? '未记录', wide: true },
    { key: 'cardType', label: '卡片类型', value: card.cardTypeLabel },
    { key: 'pack', label: '球员包', value: packName, wide: true },
    { key: 'publishedAt', label: '发布日期', value: displayDate(detail.publishedAt) },
    { key: 'status', label: '卡片状态', value: detail.status === 'ACTIVE' ? '可用' : '已下架' },
  ]
}

export function toCardDetailViewModel(detail: PlayerCardDetail): PlayerCardDetailViewModel {
  const enrichedDetail = playerCardDetailWithAutomaticBuild(detail)
  const card = toCardViewModel(enrichedDetail)
  const attributes = attributeRows(enrichedDetail, false)

  return {
    ...card,
    nationality: enrichedDetail.nationality,
    club: enrichedDetail.club,
    status: enrichedDetail.status,
    skills: enrichedDetail.skills,
    profileFacts: buildProfileFacts(enrichedDetail, card),
    attributes,
    autoBuild: enrichedDetail.autoBuild ? {
      available: true,
      maxOverall: enrichedDetail.autoBuild.maxOverall,
      dtRating: enrichedDetail.autoBuild.dtRating,
      allocationRows: Object.entries(enrichedDetail.autoBuild.allocation)
        .filter(([, points]) => points > 0)
        .sort(([left], [right]) => {
          const leftIndex = allocationOrder.indexOf(left)
          const rightIndex = allocationOrder.indexOf(right)
          return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex)
            - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex)
        })
        .map(([key, points]) => ({ key, label: allocationLabels[key] ?? key, points })),
      unavailableReason: '',
    } : derivedAutomaticBuild(enrichedDetail),
    siblings: enrichedDetail.otherCards.map((sibling) => {
      const siblingCard = toCardViewModel(sibling)
      return {
        id: sibling.id,
        title: sibling.cardName,
        overallRating: sibling.overallRating,
        positionLabel: siblingCard.positionLabel,
        cardTypeLabel: siblingCard.cardTypeLabel,
      }
    }),
  }
}

export function playerCardDetailWithAutomaticBuild(detail: PlayerCardDetail): PlayerCardDetail {
  if (detail.autoBuild) return detail
  const derived = derivedAutomaticBuild(detail)
  if (!derived.available || derived.maxOverall === null) return detail
  return {
    ...detail,
    autoBuild: {
      allocation: Object.fromEntries(derived.allocationRows.map(({ key, points }) => [key, points])),
      maxOverall: derived.maxOverall,
      dtRating: derived.dtRating,
      algorithmVersion: 'pesdata-position-auto-v1',
    },
  }
}

export function favoritePlayerId(card: PlayerCardDetailViewModel): string {
  return card.playerId
}

export function favoriteMutationState(
  current: boolean,
  succeeded: boolean,
  next: boolean,
): boolean {
  return succeeded ? next : current
}
