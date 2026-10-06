import { Alert, Button, Empty, Input, Spin, Tag } from 'antd';
import { TeamCatalogListResponseSchema, type TeamCatalogItem } from '@efm/contracts';
import { useCallback, useEffect, useState } from 'react';
import { adminApi, type AdminApi } from '../lib/api';

function catalogName(item: TeamCatalogItem) {
  return item.nameZh ?? item.nameEn ?? item.nameJa ?? item.shortName;
}

export function TeamShellPicker({
  api = adminApi,
  leagueId,
  value,
  onChange
}: {
  api?: AdminApi;
  leagueId: string;
  value?: string | null;
  onChange?: (catalogTeamId: string) => void;
}) {
  const [items, setItems] = useState<TeamCatalogItem[]>([]);
  const [keyword, setKeyword] = useState('');
  const [sourceLeagueName, setSourceLeagueName] = useState('');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (nextKeyword = '', nextSourceLeagueName = '') => {
    setLoading(true);
    setFailed(false);
    const query = new URLSearchParams({ leagueId });
    if (nextKeyword.trim()) query.set('keyword', nextKeyword.trim());
    if (nextSourceLeagueName.trim()) query.set('sourceLeagueName', nextSourceLeagueName.trim());
    try {
      const response = await api.request(`/v1/admin/team-catalog?${query.toString()}`, {
        schema: TeamCatalogListResponseSchema
      });
      setItems(response.items);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [api, leagueId]);

  useEffect(() => { void load(); }, [load]); // Search is explicit to avoid firing on every key stroke.

  return <div className="team-shell-picker">
    <div className="team-shell-picker__filters">
      <Input
        aria-label="搜索队壳"
        allowClear
        value={keyword}
        placeholder="球队名称或简称"
        onChange={(event) => setKeyword(event.target.value)}
      />
      <Input
        aria-label="来源联赛"
        allowClear
        value={sourceLeagueName}
        placeholder="来源联赛，例如荷甲"
        onChange={(event) => setSourceLeagueName(event.target.value)}
      />
      <Button aria-label="搜索队壳" onClick={() => void load(keyword, sourceLeagueName)}>搜索</Button>
    </div>
    {failed ? <Alert
      role="alert"
      type="error"
      showIcon
      title="队壳目录加载失败"
      description="请检查网络后重新加载，不会直接访问 PESDATA。"
      action={<Button onClick={() => void load(keyword, sourceLeagueName)}>重新加载队壳</Button>}
    /> : null}
    {loading ? <div className="team-shell-picker__loading"><Spin size="small" /><span>正在加载队壳目录</span></div> : null}
    {!loading && !failed && items.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有可选队壳，请调整搜索条件" /> : null}
    {!loading && !failed && items.length > 0 ? <div className="team-shell-picker__grid">
      {items.map((item) => {
        const name = catalogName(item);
        const unavailable = item.isAssigned || item.status !== 'ACTIVE';
        const selected = value === item.id;
        return <article className={`team-shell-option${selected ? ' team-shell-option--selected' : ''}`} key={item.id}>
          <div className="team-shell-option__crest">
            {item.storedLogoUrl
              ? <img src={item.storedLogoUrl} alt={`${name}队徽`} />
              : <span aria-label={`${name}暂无队徽`}>{item.shortName.slice(0, 2)}</span>}
          </div>
          <div className="team-shell-option__copy">
            <strong>{name}</strong>
            <span>{item.sourceLeagueName ?? '自定义队壳'} · {item.shortName}</span>
          </div>
          <div className="team-shell-option__action">
            {item.isAssigned ? <Tag>本联赛已使用</Tag> : item.status !== 'ACTIVE' ? <Tag>不可使用</Tag> : null}
            <Button
              type={selected ? 'primary' : 'default'}
              disabled={unavailable}
              aria-label={`选择${name}`}
              onClick={() => onChange?.(item.id)}
            >{selected ? '已选择' : '选择'}</Button>
          </div>
        </article>;
      })}
    </div> : null}
  </div>;
}
