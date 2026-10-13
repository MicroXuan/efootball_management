import { Alert, Button, Card, Form, Input, InputNumber, Select, Space, Table, Tag } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  LeagueSeasonSummarySchema,
  ValuationWindowListResponseSchema,
  ValuationWindowSchema,
  type ValuationWindow,
} from '@efm/contracts';
import { z } from 'zod';
import { adminApi, ApiError, type AdminApi } from '../lib/api';
import { formatDateTime } from '../lib/date-time';
import { useMutationKey } from '../lib/mutation-key';

type Fields = {
  name: string;
  startsAt: string;
  endsAt: string;
  minimumValueMinor: number;
  maximumValueMinor: number;
  maximumIncreasePercent: number;
  maximumDecreasePercent: number;
};

const initial: Fields = {
  name: '',
  startsAt: '',
  endsAt: '',
  minimumValueMinor: 0,
  maximumValueMinor: 100000,
  maximumIncreasePercent: 20,
  maximumDecreasePercent: 20,
};
const states = { SCHEDULED: ['未开始', 'default'], OPEN: ['开放中', 'success'], CLOSED: ['已关闭', 'default'] } as const;

function errorCopy(error: unknown): string {
  if (!(error instanceof ApiError)) return '保存失败，请检查时间和身价规则';
  const messages: Record<string, string> = {
    VALUATION_WINDOW_CLOSED: '该窗口已关闭，不能继续修改。请复制为新窗口后重新设置时间',
    VALUATION_WINDOW_TIMELINE_INVALID: '结束时间必须晚于开始时间',
    VALUATION_WINDOW_VERSION_CONFLICT: '该窗口已被其他管理员修改，请刷新后重试',
  };
  return messages[error.code] ?? `保存失败（${error.code}），请检查时间和身价规则`;
}

function percent(basisPoints: number): number {
  return basisPoints / 100;
}

function basisPoints(value: number): number {
  return Math.round(value * 100);
}

function formatPercent(value: string | number | undefined): string {
  return value === undefined || value === '' ? '' : String(Number(value));
}

export function ValuationWindowsPage({ api = adminApi }: { api?: AdminApi }) {
  const { leagueId = '' } = useParams();
  const [seasons, setSeasons] = useState<z.infer<typeof LeagueSeasonSummarySchema>[]>([]);
  const [seasonId, setSeasonId] = useState('');
  const [windows, setWindows] = useState<ValuationWindow[]>([]);
  const [editing, setEditing] = useState<ValuationWindow | null>(null);
  const [copySource, setCopySource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm<Fields>();
  const key = useMutationKey();

  useEffect(() => {
    void api.request(`/v1/admin/leagues/${leagueId}/roster-seasons`, {
      schema: z.array(LeagueSeasonSummarySchema),
    }).then((items) => {
      setSeasons(items);
      setSeasonId(items[0]?.id ?? '');
    }).catch(() => setError('赛季加载失败'));
  }, [api, leagueId]);

  const load = useCallback(async () => {
    if (!seasonId) return;
    try {
      const response = await api.request(`/v1/admin/seasons/${seasonId}/valuation-windows`, {
        schema: ValuationWindowListResponseSchema,
      });
      setWindows(response.items);
    } catch {
      setError('身价窗口加载失败');
    }
  }, [api, seasonId]);

  useEffect(() => { void load(); }, [load]);

  const save = async (values: Fields) => {
    if (!seasonId) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: values.name,
        startsAt: new Date(values.startsAt).toISOString(),
        endsAt: new Date(values.endsAt).toISOString(),
        rule: {
          minimumValueMinor: values.minimumValueMinor,
          maximumValueMinor: values.maximumValueMinor,
          maximumIncreaseBps: basisPoints(values.maximumIncreasePercent),
          maximumDecreaseBps: basisPoints(values.maximumDecreasePercent),
        },
        ...(editing ? { expectedVersion: editing.version } : {}),
      };
      await api.request(
        editing
          ? `/v1/admin/valuation-windows/${editing.id}`
          : `/v1/admin/seasons/${seasonId}/valuation-windows`,
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Idempotency-Key': key.current() },
          schema: ValuationWindowSchema,
          body,
        },
      );
      key.reset();
      setEditing(null);
      setCopySource(null);
      form.resetFields();
      await load();
    } catch (caught) {
      setError(errorCopy(caught));
    } finally {
      setBusy(false);
    }
  };

  const ruleFields = (window: ValuationWindow) => ({
    minimumValueMinor: window.currentRule.minimumValueMinor,
    maximumValueMinor: window.currentRule.maximumValueMinor,
    maximumIncreasePercent: percent(window.currentRule.maximumIncreaseBps),
    maximumDecreasePercent: percent(window.currentRule.maximumDecreaseBps),
  });

  const edit = (window: ValuationWindow) => {
    setEditing(window);
    setCopySource(null);
    setError(null);
    key.reset();
    form.setFieldsValue({
      name: window.name,
      startsAt: window.startsAt.slice(0, 16),
      endsAt: window.endsAt.slice(0, 16),
      ...ruleFields(window),
    });
  };

  const copy = (window: ValuationWindow) => {
    setEditing(null);
    setCopySource(window.name);
    setError(null);
    key.reset();
    form.setFieldsValue({
      name: `${window.name}（新窗口）`,
      startsAt: '',
      endsAt: '',
      ...ruleFields(window),
    });
  };

  const cancel = () => {
    setEditing(null);
    setCopySource(null);
    setError(null);
    key.reset();
    form.resetFields();
  };

  const changeSeason = (nextSeasonId: string) => {
    cancel();
    setSeasonId(nextSeasonId);
  };

  return (
    <div className="workspace-grid valuation-workspace">
      <Card title="身价申报窗口">
        {error ? <Alert role="alert" type="warning" title={error} /> : null}
        <Select
          aria-label="选择赛季"
          value={seasonId || undefined}
          onChange={changeSeason}
          options={seasons.map(({ id, displayName }) => ({ value: id, label: displayName }))}
        />
        <Table
          scroll={{ x: 920 }}
          pagination={false}
          rowKey="id"
          dataSource={windows}
          columns={[
            { title: '窗口', dataIndex: 'name' },
            { title: '状态', render: (_, row) => <Tag color={states[row.state][1]}>{states[row.state][0]}</Tag> },
            { title: '时间范围', render: (_, row) => `${formatDateTime(row.startsAt)} — ${formatDateTime(row.endsAt)}` },
            { title: '规则版本', render: (_, row) => `V${row.currentRule.version}` },
            { title: '身价范围', render: (_, row) => `${row.currentRule.minimumValueMinor} — ${row.currentRule.maximumValueMinor}` },
            { title: '涨/跌上限', render: (_, row) => `${percent(row.currentRule.maximumIncreaseBps)}% / ${percent(row.currentRule.maximumDecreaseBps)}%` },
            {
              title: '操作',
              render: (_, row) => row.state === 'CLOSED'
                ? <Button type="link" onClick={() => copy(row)}>复制为新窗口</Button>
                : <Button type="link" onClick={() => edit(row)}>调整规则</Button>,
            },
          ]}
        />
      </Card>
      <Card title={editing ? '调整窗口与发布新规则版本' : copySource ? `基于“${copySource}”创建新窗口` : '新增身价窗口'}>
        <Form<Fields>
          form={form}
          layout="vertical"
          initialValues={initial}
          onValuesChange={() => key.reset()}
          onFinish={(values) => void save(values)}
        >
          <Form.Item label="窗口名称" name="name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <div className="valuation-fields">
            <Form.Item label="开始时间" name="startsAt" rules={[{ required: true }]}>
              <Input type="datetime-local" />
            </Form.Item>
            <Form.Item label="结束时间" name="endsAt" rules={[{ required: true }]}>
              <Input type="datetime-local" />
            </Form.Item>
          </div>
          <div className="valuation-fields">
            <Form.Item label="最低身价" name="minimumValueMinor" rules={[{ required: true }]}>
              <InputNumber min={0} step={10} precision={0} />
            </Form.Item>
            <Form.Item label="最高身价" name="maximumValueMinor" rules={[{ required: true }]}>
              <InputNumber min={0} step={10} precision={0} />
            </Form.Item>
          </div>
          <div className="valuation-fields">
            <Form.Item label="最大涨幅（%）" name="maximumIncreasePercent" rules={[{ required: true }]}>
              <InputNumber
                min={0} max={100} step={1} precision={2}
                formatter={(value, info) => info.userTyping ? info.input : formatPercent(value)}
              />
            </Form.Item>
            <Form.Item label="最大跌幅（%）" name="maximumDecreasePercent" rules={[{ required: true }]}>
              <InputNumber
                min={0} max={100} step={1} precision={2}
                formatter={(value, info) => info.userTyping ? info.input : formatPercent(value)}
              />
            </Form.Item>
          </div>
          <Alert
            className="valuation-rule-guide"
            type="info"
            showIcon
            title="涨跌幅直接按百分比填写"
            description="例：基础身价 10,000，最大跌幅 10%，无需复核的最低申报价为 9,000。超出涨跌幅会进入管理员审核；首次定价仅受全局身价范围限制。"
          />
          {editing ? <p className="valuation-version-note">修改规则会生成新版本，已保存的旧申报仍引用原规则。</p> : null}
          {copySource ? <p className="valuation-version-note">已复制原窗口的身价规则，请设置新的开始与结束时间。</p> : null}
          <Space>
            <Button type="primary" htmlType="submit" loading={busy}>
              {editing ? '保存并发布新版本' : copySource ? '创建新窗口' : '创建窗口'}
            </Button>
            {editing || copySource ? <Button onClick={cancel}>取消</Button> : null}
          </Space>
        </Form>
      </Card>
    </div>
  );
}
