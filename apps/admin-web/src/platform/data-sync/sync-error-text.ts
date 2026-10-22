const errorText: Record<string, string> = {
  TEAM_SYNC_ITEM_NOT_PENDING: '状态已变化，无法发布',
  TEAM_SYNC_ITEM_NOT_FOUND: '记录已不存在',
  TEAM_SYNC_ITEM_INVALID: '队壳资料不完整，无法发布',
  PESDATA_CREST_INVALID: '队徽图片无效',
  CREST_INVALID: '队徽图片无效',
  IMPORT_BATCH_NOT_READY: '批次尚未准备好，无法发布'
};

export function syncErrorText(code: string): string {
  return errorText[code] ?? '处理失败，请重试或联系管理员';
}
