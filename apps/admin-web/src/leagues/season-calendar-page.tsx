import { Alert, Button, Card, Form, Input, Select, Space, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { SeasonAgendaResponseSchema, SeasonCalendarNoteSchema,
  type SeasonAgendaItem, type SeasonAgendaResponse } from '@efm/contracts';
import { adminApi, type AdminApi } from '../lib/api';
import { PaginatedRecords } from '../components/paginated-records';

const eightHours = 8 * 60 * 60 * 1000;
const currentBeijingMonth = () => new Date(Date.now() + eightHours).toISOString().slice(0, 7);
const kindLabel = { TRANSFER: '转会期', FORCED_OFFER: '强报期', VALUATION: '身价窗口', NOMINATION: '提名期', MANUAL: '事项' } as const;
const sourcePath = { TRANSFER: 'transfer-windows', FORCED_OFFER: 'forced-offer-windows', VALUATION: 'valuation-windows', NOMINATION: 'nomination-windows' } as const;
const noteKinds = [{ value: 'NOTICE', label: '普通说明' }, { value: 'HOLIDAY', label: '节假日' }, { value: 'MAINTENANCE', label: '维护日' }] as const;
type NoteKind = typeof noteKinds[number]['value'];
type Fields = { kind: NoteKind; title: string; description: string; startsOn: string; endsOn: string };
const emptyFields: Fields = { kind: 'NOTICE', title: '', description: '', startsOn: '', endsOn: '' };

export function shiftMonth(month: string, delta: number): string {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year!, number! - 1 + delta, 1)).toISOString().slice(0, 7);
}

export function calendarDays(month: string, items: SeasonAgendaItem[]) {
  const [year, number] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year!, number! - 1, 1));
  const leading = (first.getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(Date.UTC(year!, number! - 1, index + 1 - leading)).toISOString().slice(0, 10);
    return { date, day: Number(date.slice(-2)), inMonth: date.startsWith(month), items: items.filter((item) => item.firstDate <= date && item.lastDate >= date) };
  });
}

function displayRange(item: SeasonAgendaItem): string {
  if (item.kind === 'MANUAL') return `${item.firstDate} — ${item.lastDate} · 全天`;
  const format = (value: string) => new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
  return `${format(item.startsAt)} — ${format(item.endsAt)}`;
}

export function SeasonCalendarPage({ api = adminApi }: { api?: AdminApi }) {
  const { leagueId = '' } = useParams();
  const [month, setMonth] = useState(currentBeijingMonth);
  const [response, setResponse] = useState<SeasonAgendaResponse | null>(null);
  const [fields, setFields] = useState<Fields>(emptyFields);
  const [editing, setEditing] = useState<Extract<SeasonAgendaItem, { kind: 'MANUAL' }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mutationKeys = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api.request(`/v1/admin/leagues/${leagueId}/current-season/agenda?month=${month}`, { schema: SeasonAgendaResponseSchema });
      setResponse(data);
    } catch {
      setResponse(null);
      setError('赛季日历加载失败');
    }
  }, [api, leagueId, month]);
  useEffect(() => { void load(); }, [load]);

  const days = useMemo(() => calendarDays(month, response?.items ?? []), [month, response]);
  const canSave = Boolean(response?.seasonId && fields.title.trim() && fields.startsOn && fields.endsOn && fields.endsOn >= fields.startsOn);
  const noteUrl = response?.seasonId ? `/v1/admin/leagues/${leagueId}/seasons/${response.seasonId}/calendar-notes` : '';
  const keyFor = (signature: string) => {
    if (!mutationKeys.current.has(signature)) mutationKeys.current.set(signature, crypto.randomUUID());
    return mutationKeys.current.get(signature)!;
  };
  const change = (key: keyof Fields, value: string) => setFields((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!canSave || !noteUrl) return;
    const body = { ...fields, title: fields.title.trim(), description: fields.description.trim() || null,
      ...(editing ? { expectedVersion: editing.version } : {}) };
    const signature = JSON.stringify({ noteUrl, editing: editing?.id, body });
    setBusy(true); setError(null);
    try {
      await api.request(`${noteUrl}${editing ? `/${editing.id}` : ''}`, {
        method: editing ? 'PATCH' : 'POST', body, schema: SeasonCalendarNoteSchema,
        headers: { 'Idempotency-Key': keyFor(signature) }
      });
      mutationKeys.current.delete(signature);
      setEditing(null); setFields(emptyFields);
      await load();
    } catch { setError('保存日历事项失败，请重试'); }
    finally { setBusy(false); }
  };

  const remove = async (item: Extract<SeasonAgendaItem, { kind: 'MANUAL' }>) => {
    if (!noteUrl) return;
    const signature = `delete:${item.id}:${item.version}`;
    setBusy(true); setError(null);
    try {
      await api.request(`${noteUrl}/${item.id}`, { method: 'DELETE', body: { expectedVersion: item.version },
        schema: SeasonCalendarNoteSchema, headers: { 'Idempotency-Key': keyFor(signature) } });
      mutationKeys.current.delete(signature);
      await load();
    } catch { setError('删除日历事项失败，请重试'); }
    finally { setBusy(false); }
  };

  const edit = (item: Extract<SeasonAgendaItem, { kind: 'MANUAL' }>) => {
    setEditing(item);
    setFields({ kind: item.noteKind, title: item.title, description: item.description ?? '', startsOn: item.firstDate, endsOn: item.lastDate });
  };

  return <div className="season-phase-layout">
    <Card className="season-phase-calendar" title="赛季日历" extra={<Space>
      <Button aria-label="上个月" onClick={() => setMonth((value) => shiftMonth(value, -1))}>‹</Button>
      <Typography.Text strong>{month}</Typography.Text>
      <Button aria-label="下个月" onClick={() => setMonth((value) => shiftMonth(value, 1))}>›</Button>
    </Space>}>
      <Typography.Paragraph type="secondary">按北京时间查看当前赛季的转会、强报、身价、提名及管理员事项。阶段时间请到相应窗口设置页修改。</Typography.Paragraph>
      {error && <Alert role="alert" type="error" showIcon title={error} action={<Button onClick={() => void load()}>重试</Button>} />}
      {response?.seasonId === null && <Alert type="info" showIcon title="尚未设置当前赛季" />}
      {response?.seasonId && <>
        <div className="season-phase-weekdays">{['一', '二', '三', '四', '五', '六', '日'].map((day) => <span key={day}>{day}</span>)}</div>
        <div className="season-phase-days">{days.map((day) => <div key={day.date} className={`season-phase-day${day.inMonth ? '' : ' is-adjacent'}`}>
          <span className="season-phase-number">{day.day}</span>
          <div className="season-phase-markers">{day.items.map((item) => <span key={`${item.kind}:${item.id}`} className={`season-phase-marker kind-${item.kind.toLowerCase().replace('_', '-')}`} title={item.title}>{kindLabel[item.kind]}</span>)}</div>
        </div>)}</div>
      </>}
    </Card>
    <div className="season-phase-sidebar">
      <Card title="本月阶段与事项" className="season-phase-summary">
        {response?.seasonId && response.items.length === 0 && <Typography.Text type="secondary">本月暂无赛季阶段或事项</Typography.Text>}
        <PaginatedRecords items={response?.items ?? []} label="本月事项分页" render={(pageItems) => pageItems.map((item) => <div key={`${item.kind}:${item.id}`} className={`season-phase-summary-row kind-${item.kind.toLowerCase().replace('_', '-')}`}>
          <div className="season-phase-summary-head"><span className="season-phase-kind">{kindLabel[item.kind]}</span><strong>{item.title}</strong></div>
          <Typography.Text type="secondary">{displayRange(item)}{item.kind === 'MANUAL' ? ' · 北京时间' : ''}</Typography.Text>
          {item.description && <Typography.Paragraph>{item.description}</Typography.Paragraph>}
          {item.kind === 'MANUAL' ? <Space><Button type="link" onClick={() => edit(item)}>编辑{item.title}</Button><Button type="link" danger disabled={busy} onClick={() => void remove(item)}>删除{item.title}</Button></Space>
            : <Link to={`/leagues/${leagueId}/${sourcePath[item.kind]}`}>来自窗口设置 · 查看</Link>}
        </div>)} />
      </Card>
      {response?.seasonId && <Card title={editing ? '编辑全天事项' : '新增全天事项'}>
        <Form layout="vertical">
          <Form.Item label="事项类型"><Select aria-label="事项类型" value={fields.kind} options={[...noteKinds]} onChange={(value) => change('kind', value)} /></Form.Item>
          <Form.Item label="事项标题"><Input aria-label="事项标题" maxLength={64} value={fields.title} onChange={(event) => change('title', event.target.value)} /></Form.Item>
          <Form.Item label="说明"><Input.TextArea aria-label="说明" maxLength={300} value={fields.description} onChange={(event) => change('description', event.target.value)} /></Form.Item>
          <div className="season-phase-form-dates">
            <Form.Item label="开始日期"><Input aria-label="开始日期" type="date" value={fields.startsOn} onChange={(event) => change('startsOn', event.target.value)} /></Form.Item>
            <Form.Item label="结束日期（包含）"><Input aria-label="结束日期" type="date" value={fields.endsOn} onChange={(event) => change('endsOn', event.target.value)} /></Form.Item>
          </div>
        </Form>
        <Space><Button type="primary" disabled={!canSave} loading={busy} onClick={() => void save()}>{editing ? '保存事项' : '新增事项'}</Button>
          {editing && <Button onClick={() => { setEditing(null); setFields(emptyFields); }}>取消编辑</Button>}</Space>
      </Card>}
    </div>
  </div>;
}
