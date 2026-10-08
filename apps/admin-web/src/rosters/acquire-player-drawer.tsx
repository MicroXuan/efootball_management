import { Alert, Button, Drawer, Empty, Form, Input, InputNumber, Radio, Select, Tag } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import {
  CardPackListResponseSchema,
  RosterMutationResponseSchema,
  RosterPlayerCandidateListResponseSchema,
  type CardPackSummary,
  type PlayerCardType,
  type PlayerPosition,
  type RosterPlayerCandidate
} from '@efm/contracts';
import { ApiError, adminApi, type AdminApi } from '../lib/api';
import { useMutationKey } from '../lib/mutation-key';

type Summary = { rosterCount: number; salaryMinor: number; salaryCapMinor: number };
type Props = { open: boolean; leagueId: string; teamId: string; seasonId: string; summary: Summary; api?: AdminApi; onClose(): void; onCompleted(): void };

const positionLabels: Record<PlayerPosition, string> = {
  GK: '门将', CB: '中后卫', LB: '左后卫', RB: '右后卫',
  DMF: '后腰', CMF: '中前卫', LMF: '左前卫', RMF: '右前卫',
  AMF: '前腰', LWF: '左边锋', RWF: '右边锋', SS: '影锋', CF: '中锋'
};

const money = new Intl.NumberFormat('zh-CN');

function PlayerCardArtwork({ src, alt, fallback }: { src: string | null; alt: string; fallback: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <span className="candidate-card__image-fallback" aria-label={`${alt}暂无图片`}>{fallback.slice(0, 1)}</span>;
  return <img src={src} alt={alt} onError={() => setFailed(true)} />;
}

export function AcquirePlayerDrawer({ open, leagueId, teamId, seasonId, summary, api = adminApi, onClose, onCompleted }: Props) {
  const [keyword, setKeyword] = useState('');
  const [position, setPosition] = useState<PlayerPosition | undefined>();
  const [cardType, setCardType] = useState<PlayerCardType | undefined>();
  const [cardPackId, setCardPackId] = useState<string | undefined>();
  const [packs, setPacks] = useState<Array<CardPackSummary & { cardCount: number }>>([]);
  const [results, setResults] = useState<RosterPlayerCandidate[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mutationKey = useMutationKey();
  const selectedPlayer = useMemo(() => results.find((player) => player.cards.some((card) => card.id === selectedCardId)), [results, selectedCardId]);
  const selected = useMemo(() => selectedPlayer?.cards.find((card) => card.id === selectedCardId), [selectedCardId, selectedPlayer]);
  const cardCount = useMemo(() => results.reduce((total, player) => total + player.cards.length, 0), [results]);
  const projectedSalary = selected?.salaryMinor === null || selected?.salaryMinor === undefined ? null : summary.salaryMinor + selected.salaryMinor;
  const purchaseBlockReason = useMemo(() => {
    if (!selected) return '请先选择一张球员卡';
    if (selectedPlayer?.ownedByTeamId) return '该球员在本联赛已归属其他球队';
    if (selected.dtRating === null) return '缺少自动加点总评，不能加入阵容';
    if (selected.salaryMinor === null) return '未找到适用的工资规则';
    if (summary.rosterCount >= 25) return '阵容已满 25 人，请先移出球员';
    if (projectedSalary !== null && projectedSalary > summary.salaryCapMinor) return '购买后将超过球队工资帽';
    if (amountMinor === null) return '请填写成交金额';
    return null;
  }, [amountMinor, projectedSalary, reason, selected, selectedPlayer?.ownedByTeamId, summary.rosterCount, summary.salaryCapMinor]);

  useEffect(() => {
    if (!open) return;
    void api.request('/v1/card-packs?limit=100', { schema: CardPackListResponseSchema })
      .then((response) => setPacks(response.items))
      .catch(() => setPacks([]));
  }, [api, open]);

  const search = async () => {
    if (!keyword.trim()) return;
    setBusy(true); setError(null);
    try {
      const params = new URLSearchParams({ keyword: keyword.trim() });
      if (position) params.set('position', position);
      if (cardType) params.set('cardType', cardType);
      if (cardPackId) params.set('cardPackId', cardPackId);
      const response = await api.request(`/v1/admin/roster/leagues/${leagueId}/player-candidates?${params.toString()}`, { schema: RosterPlayerCandidateListResponseSchema });
      setResults(response.items);
      setHasSearched(true);
      const recommended = response.items.find((player) => player.recommendedPlayerCardId)?.recommendedPlayerCardId ?? null;
      setSelectedCardId(recommended ?? response.items[0]?.cards[0]?.id ?? null);
    } catch { setError('球员搜索失败，请检查关键词后重试'); }
    finally { setBusy(false); }
  };

  const submit = async () => {
    if (!selectedCardId || amountMinor === null || purchaseBlockReason || busy) return;
    setBusy(true); setError(null);
    try {
      await api.request('/v1/admin/roster/acquisitions', { method: 'POST', schema: RosterMutationResponseSchema, body: { seasonId, targetLeagueTeamId: teamId, playerCardId: selectedCardId, amountMinor, ...(reason.trim() ? { reason: reason.trim() } : {}), idempotencyKey: mutationKey.current() } });
      mutationKey.reset(); onCompleted(); onClose();
    } catch (caught) {
      if (caught instanceof ApiError && (caught.code === 'TEAM_ROSTER_FULL' || caught.code === 'TEAM_SALARY_CAP_EXCEEDED')) {
        setError(`操作被拒绝：阵容人数 ${summary.rosterCount}/25，工资 ${summary.salaryMinor}/${summary.salaryCapMinor}`);
      } else if (caught instanceof ApiError && caught.code === 'PLAYER_ALREADY_OWNED') setError('该球员在本联赛已归属其他球队');
      else setError('购买失败，表单已保留，请重试');
    } finally { setBusy(false); }
  };

  const blockDescription = selected?.dtRating === null
    ? '系统暂时无法根据成长等级计算这张卡的自动加点总评，请选择其他卡片，或先完成球员卡数据同步。'
    : undefined;

  return <Drawer
    open={open}
    onClose={onClose}
    title={<div className="acquire-drawer-title"><strong>购买球员</strong><span>搜索球员，选择要签入的具体球员卡</span></div>}
    size="large"
    destroyOnHidden
    rootClassName="acquire-player-drawer"
    footer={<div className="acquire-order-panel">
      <div className="acquire-order-summary" aria-label="购买影响摘要">
        <div><span>阵容人数</span><strong>{summary.rosterCount} / 25</strong></div>
        <div><span>当前工资</span><strong>{money.format(summary.salaryMinor)} / {money.format(summary.salaryCapMinor)}</strong></div>
        <div><span>购买后工资</span><strong>{projectedSalary === null ? '—' : `${money.format(projectedSalary)} / ${money.format(summary.salaryCapMinor)}`}</strong></div>
      </div>
      <Form layout="vertical" className="acquire-order-form">
        <Form.Item label="成交金额" required><InputNumber aria-label="成交金额" min={1} precision={0} value={amountMinor} placeholder="输入金额" onChange={(value) => { setAmountMinor(value); mutationKey.reset(); }} /></Form.Item>
        <Form.Item label="操作原因（选填）"><Input aria-label="操作原因" value={reason} placeholder="例如：补强中后卫" onChange={(event) => { setReason(event.target.value); mutationKey.reset(); }} /></Form.Item>
      </Form>
      {purchaseBlockReason ? <Alert type={selected?.dtRating === null ? 'error' : 'warning'} showIcon title={purchaseBlockReason} description={blockDescription} /> : <div className="acquire-order-ready">信息已完整，确认后将写入不可修改的阵容交易和财务流水。</div>}
      <Button aria-label="确认购买" type="primary" block onClick={() => void submit()} loading={busy} disabled={Boolean(purchaseBlockReason)}>确认购买{selectedPlayer ? ` · ${selectedPlayer.playerName}` : ''}</Button>
    </div>}
  >
    {error ? <Alert role="alert" type="error" showIcon title={error} /> : null}
    <section className="acquire-search-panel" aria-label="搜索和筛选球员">
      <div className="acquire-search-row">
        <Input aria-label="搜索球员" value={keyword} onChange={(event) => setKeyword(event.target.value)} onPressEnter={() => void search()} placeholder="输入球员中文名、英文名或球员卡名称" />
        <Button aria-label="搜索" loading={busy} disabled={!keyword.trim()} onClick={() => void search()}>搜索</Button>
      </div>
      <div className="acquire-filter-row">
        <Select aria-label="位置" allowClear placeholder="全部位置" value={position} onChange={(value) => setPosition(value)} options={Object.entries(positionLabels).map(([value, label]) => ({ value, label }))} />
        <Select aria-label="卡种" allowClear placeholder="全部卡种" value={cardType} onChange={(value) => setCardType(value)} options={[
          { value: 'STANDARD', label: '基础卡' }, { value: 'FEATURED', label: '精选' }, { value: 'TRENDING', label: '状态火热' },
          { value: 'HIGHLIGHT', label: '高光' }, { value: 'EPIC', label: '史诗' }, { value: 'BIG_TIME', label: '时刻' }, { value: 'OTHER', label: '其他' }
        ]} />
        <Select aria-label="球员包" allowClear showSearch optionFilterProp="label" placeholder="全部球员包" value={cardPackId} onChange={(value) => setCardPackId(value)} options={packs.map((pack) => ({
          value: pack.id,
          label: pack.nameZh ?? pack.nameEn ?? '未命名球员包'
        }))} />
      </div>
    </section>

    {hasSearched && results.length > 0 ? <div className="candidate-result-summary">找到 {results.length} 名球员 · {cardCount} 张球员卡</div> : null}
    {hasSearched && results.length === 0 && !busy ? <Empty description="没有符合筛选条件的球员" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : null}
    {!hasSearched ? <div className="candidate-search-empty"><strong>先搜索球员</strong><span>可以用中文名、英文名或球员卡名称搜索。</span></div> : null}

    {results.map((player) => <section className="candidate-group" key={player.playerId}>
      <div className="candidate-title">
        <div><span>球员</span><strong>{player.playerName}</strong></div>
        {player.ownedByTeamId ? <Tag color="error">本联赛已归属</Tag> : <Tag color="success">可签入</Tag>}
      </div>
      <Radio.Group value={selectedCardId} onChange={(event) => { setSelectedCardId(event.target.value); mutationKey.reset(); }}>
        <div className="candidate-card-grid">{player.cards.map((card) => {
          const isSelected = card.id === selectedCardId;
          return <Radio className={`candidate-card-option${isSelected ? ' candidate-card-option--selected' : ''}`} key={card.id} value={card.id} aria-label={card.cardName} disabled={Boolean(player.ownedByTeamId)}>
            <div className="candidate-card">
              <div className="candidate-card__image">
                <PlayerCardArtwork src={card.imageUrl} alt={`${player.playerName} ${card.cardName} 球员卡`} fallback={player.playerName} />
              </div>
              <div className="candidate-card__content">
                <div className="candidate-card__heading"><strong>{card.cardName}</strong><div>{card.recommended ? <Tag color="success">系统推荐</Tag> : null}{isSelected ? <Tag color="processing">已选择</Tag> : null}</div></div>
                <dl className="candidate-card__stats">
                  <div><dt>位置</dt><dd>{positionLabels[card.position as PlayerPosition] ?? card.position}</dd></div>
                  <div><dt>初始能力</dt><dd>{card.overallRating}</dd></div>
                  <div><dt>自动加点总评</dt><dd>{card.maxOverall ?? '未计算'}</dd></div>
                  <div><dt>球员工资</dt><dd>{card.salaryMinor === null ? '未配置' : money.format(card.salaryMinor)}</dd></div>
                </dl>
              </div>
            </div>
          </Radio>;
        })}</div>
      </Radio.Group>
    </section>)}
  </Drawer>;
}
