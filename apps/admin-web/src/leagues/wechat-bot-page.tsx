import {
  AdminLeagueWechatBotConfigSchema,
  AdminWechatGroupBindingSchema,
  type AdminLeagueWechatBotConfig,
  type WechatGroupCapabilityType,
} from '@efm/contracts';
import { Alert, Button, Card, Checkbox, Empty, Spin, Switch, Tag } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError, adminApi, type AdminApi } from '../lib/api';

const competitionStatus: Record<string, string> = {
  DRAFT: '草稿',
  REGISTRATION_OPEN: '报名中',
  REGISTRATION_CLOSED: '报名结束',
  SCHEDULED: '已排赛程',
  IN_PROGRESS: '进行中',
  COMPLETED: '已结束',
  CANCELLED: '已取消',
};

export function WechatBotPage({ api = adminApi }: { api?: AdminApi }) {
  const { leagueId = '' } = useParams();
  const [config, setConfig] = useState<AdminLeagueWechatBotConfig | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<WechatGroupCapabilityType[]>([]);
  const [scheduleSourceIds, setScheduleSourceIds] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const hydrate = useCallback((next: AdminLeagueWechatBotConfig) => {
    setConfig(next);
    setSelectedGroupId((current) => {
      if (current && next.observedGroups.some((group) => group.id === current)) return current;
      const binding = next.bindings[0];
      if (!binding) return null;
      return next.observedGroups.find(
        (group) => group.deviceId === binding.deviceId && group.wechatGroupId === binding.wechatGroupId
      )?.id ?? null;
    });
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      hydrate(await api.request(`/v1/admin/leagues/${leagueId}/wechat-bot`, {
        schema: AdminLeagueWechatBotConfigSchema,
      }));
    } catch {
      setError('群机器人配置加载失败，请稍后重试');
    }
  }, [api, hydrate, leagueId]);

  useEffect(() => { void load(); }, [load]);

  const selectedGroup = useMemo(() => config?.observedGroups.find((group) => group.id === selectedGroupId), [config, selectedGroupId]);
  const selectedBinding = useMemo(() => selectedGroup
    ? config?.bindings.find(
        (binding) => binding.deviceId === selectedGroup.deviceId && binding.wechatGroupId === selectedGroup.wechatGroupId
      )
    : undefined, [config, selectedGroup]);

  useEffect(() => {
    setCapabilities(selectedBinding?.capabilities ?? []);
    setScheduleSourceIds(selectedBinding?.scheduleSourceIds ?? []);
    setEnabled(selectedBinding?.enabled ?? true);
  }, [selectedBinding, selectedGroupId]);

  const setCapability = (capability: WechatGroupCapabilityType, checked: boolean) => {
    setCapabilities((current) => checked
      ? current.includes(capability) ? current : [...current, capability]
      : current.filter((item) => item !== capability));
  };

  const save = async () => {
    if (!selectedGroup || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const binding = await api.request(`/v1/admin/leagues/${leagueId}/wechat-bot/group`, {
        method: 'PUT',
        schema: AdminWechatGroupBindingSchema,
        body: {
          deviceId: selectedGroup.deviceId,
          observedGroupId: selectedGroup.id,
          enabled,
          capabilities,
          scheduleSourceIds,
          ...(selectedBinding ? { expectedVersion: selectedBinding.version } : {}),
        },
      });
      setConfig((current) => current ? {
        ...current,
        bindings: current.bindings.some((item) => item.id === binding.id)
          ? current.bindings.map((item) => item.id === binding.id ? binding : item)
          : [...current.bindings, binding],
      } : current);
      setNotice('配置已保存，机器人将在下一次轮询后使用新配置。');
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'WECHAT_GROUP_ALREADY_BOUND') {
        setError('该微信群已绑定其他联赛，请在原联赛解除后再试');
      } else if (caught instanceof ApiError && caught.code === 'VERSION_CONFLICT') {
        await load();
        setError('配置已被其他管理员更新，已加载最新版本，请重新确认');
      } else if (caught instanceof ApiError && caught.code === 'WECHAT_GROUP_HAS_ACTIVE_AUCTION') {
        setError('该群存在未结束的球员拍卖，请先结束或取消该群的拍卖批次');
      } else {
        setError('群机器人配置保存失败，请稍后重试');
      }
    } finally {
      setBusy(false);
    }
  };

  if (!config && !error) return <div className="loading-block"><Spin /><span>正在读取群机器人配置…</span></div>;

  return <div className="wechat-league-page">
    <section className="wechat-league-intro">
      <div><span className="section-kicker">群消息入口</span><h2>配置联赛微信群</h2></div>
      <p>一个联赛可以配置多个微信群，每个群可独立承担赛程查询、球员拍卖或两种功能。每个微信群仍只能归属一个联赛。</p>
    </section>
    {error ? <Alert role="alert" type="error" showIcon title={error} /> : null}
    {notice ? <Alert role="status" type="success" showIcon title={notice} closable onClose={() => setNotice(null)} /> : null}
    {config ? <>
      <Card className="wechat-config-section" title={<><span className="wechat-step">01</span> 选择微信群</>}>
        {config.observedGroups.length ? <div className="wechat-group-grid">{config.observedGroups.map((group) => {
          const device = config.devices.find((item) => item.id === group.deviceId);
          const isSelected = selectedGroupId === group.id;
          return <button
            type="button"
            key={group.id}
            className={`wechat-group-option${isSelected ? ' is-selected' : ''}`}
            aria-label={`选择群 ${group.displayName}`}
            aria-pressed={isSelected}
            onClick={() => setSelectedGroupId(group.id)}
          >
            <span className="wechat-group-option__mark">群</span>
            <span><strong>{group.displayName}</strong><small>{device?.name ?? '未知设备'} · {device?.loginStatus === 'LOGGED_IN' ? '设备在线' : '设备离线'}</small></span>
            <Tag color={device?.loginStatus === 'LOGGED_IN' ? 'success' : 'default'}>{isSelected ? '已选择' : '可绑定'}</Tag>
          </button>;
        })}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="机器人尚未观察到微信群，请先启动 Windows 桥接程序并保持目标群可见。" />}
      </Card>
      <Card className="wechat-config-section" title={<><span className="wechat-step">02</span> 设置群功能</>}>
        <p className="wechat-section-description">功能可以单选或多选，切换微信群后会加载该群自己的配置。</p>
        <div className="wechat-source-list">
          <div className="wechat-source-option">
            <Checkbox
              checked={capabilities.includes('SCHEDULE_QUERY')}
              disabled={!selectedGroup}
              onChange={(event) => setCapability('SCHEDULE_QUERY', event.target.checked)}
            >赛程查询</Checkbox>
            <Tag color="processing">回复群友的赛程查询</Tag>
          </div>
          <div className="wechat-source-option">
            <Checkbox
              checked={capabilities.includes('PLAYER_AUCTION')}
              disabled={!selectedGroup}
              onChange={(event) => setCapability('PLAYER_AUCTION', event.target.checked)}
            >球员拍卖</Checkbox>
            <Tag color="gold">接收出价并发送倒计时</Tag>
          </div>
        </div>
      </Card>
      {capabilities.includes('SCHEDULE_QUERY') ? <Card className="wechat-config-section" title={<><span className="wechat-step">03</span> 选择可查询赛程</>}>
        <p className="wechat-section-description">群友发送“查询赛程”时，机器人只返回这里勾选的赛事。可同时选择多个联赛或杯赛。</p>
        {config.scheduleSourceOptions.length ? <div className="wechat-source-list">{config.scheduleSourceOptions.map((source) => <div key={source.id} className="wechat-source-option">
          <Checkbox
            checked={scheduleSourceIds.includes(source.id)}
            disabled={source.status === 'CANCELLED'}
            onChange={(event) => setScheduleSourceIds((current) => event.target.checked ? [...current, source.id] : current.filter((id) => id !== source.id))}
          >{source.name}</Checkbox>
          <Tag>{competitionStatus[source.status]}</Tag>
        </div>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有可作为查询来源的赛事，请先创建联赛或杯赛。" />}
      </Card> : null}
      <Card className="wechat-config-footer">
        <div>
          <strong>启用群机器人</strong>
          <span>关闭后保留绑定与赛程来源，但机器人不再响应群消息。</span>
        </div>
        <Switch checked={enabled} onChange={setEnabled} aria-label="启用群机器人" />
        <Button type="primary" size="large" loading={busy} disabled={!selectedGroup || busy} onClick={() => void save()}>保存群机器人配置</Button>
      </Card>
    </> : null}
  </div>;
}
