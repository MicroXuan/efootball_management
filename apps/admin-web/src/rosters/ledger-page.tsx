import {
  Alert, Button, Card, Descriptions, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography
} from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  FinanceLedgerEntrySchema, FinanceLedgerListResponseSchema, LeagueTeamListResponseSchema,
  LeagueTransactionListResponseSchema,
  TransactionFeeRuleVersionListResponseSchema, TransactionFeeRuleVersionSchema,
  type FinanceLedgerListResponse, type LeagueTransactionListResponse, type TransactionFeeRuleVersion
} from '@efm/contracts';
import { adminApi, type AdminApi } from '../lib/api';
import { useMutationKey } from '../lib/mutation-key';

const financeTypeLabels: Record<string, string> = {
  PLAYER_PURCHASE: '购买球员', PLAYER_SALE: '出售球员', PLAYER_TRANSFER: '球员转会',
  CARD_UPGRADE: '卡片升级', TRANSACTION_FEE: '交易手续费', LUXURY_TAX: '奢侈税',
  OFFSEASON_FEE: '休赛期费用', UNFINISHED_MATCH_PENALTY: '未完赛处罚', AUCTION: '拍卖',
  ROOKIE_SELECTION: '新秀选择', INSTALLMENT_PAYMENT: '分期付款', MANUAL_ADJUSTMENT: '其他调整'
};
const manualTypes = ['LUXURY_TAX', 'OFFSEASON_FEE', 'UNFINISHED_MATCH_PENALTY', 'AUCTION', 'ROOKIE_SELECTION', 'INSTALLMENT_PAYMENT', 'MANUAL_ADJUSTMENT'];
const transactionTypeLabels: Record<string, string> = {
  BUY: '购买', SELL: '出售', RELEASE: '解约', TRANSFER: '转会', CARD_UPGRADE: '卡片升级',
  SALARY_RECALCULATION: '工资重算', EMERGENCY_CORRECTION: '紧急修正'
};

const money = (value: number | null) => value === null ? '未记录' : value.toLocaleString('zh-CN');
const dateTime = (value: string) => value.slice(0, 16).replace('T', ' ');

type ManualFields = {
  leagueTeamId: string; seasonId?: string; direction: 'CREDIT' | 'DEBIT';
  type: 'LUXURY_TAX' | 'OFFSEASON_FEE' | 'UNFINISHED_MATCH_PENALTY' | 'AUCTION' | 'ROOKIE_SELECTION' | 'INSTALLMENT_PAYMENT' | 'MANUAL_ADJUSTMENT';
  amountMinor: number; note: string; reason: string;
};
type FeeFields = { rateBps: number; minimumFeeMinor: number; effectiveAt: string };

export function LedgerPage({ api = adminApi }: { api?: AdminApi }) {
  const { leagueId = '' } = useParams();
  const [data, setData] = useState<FinanceLedgerListResponse>({ items: [], nextCursor: null });
  const [transactions, setTransactions] = useState<LeagueTransactionListResponse>({ items: [], nextCursor: null });
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [rules, setRules] = useState<TransactionFeeRuleVersion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false); const [feeOpen, setFeeOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [manualForm] = Form.useForm<ManualFields>(); const [feeForm] = Form.useForm<FeeFields>();
  const manualKey = useMutationKey(); const feeKey = useMutationKey();
  const load = useCallback(async () => {
    try {
      const [ledger, transactionResult, teamResult, ruleResult] = await Promise.all([
        api.request(`/v1/admin/roster/leagues/${leagueId}/ledger`, { schema: FinanceLedgerListResponseSchema }),
        api.request(`/v1/admin/leagues/${leagueId}/transactions`, { schema: LeagueTransactionListResponseSchema }),
        api.request(`/v1/admin/leagues/${leagueId}/teams`, { schema: LeagueTeamListResponseSchema }),
        api.request(`/v1/admin/leagues/${leagueId}/transaction-fee-rules`, { schema: TransactionFeeRuleVersionListResponseSchema })
      ]);
      setData(ledger); setTransactions(transactionResult);
      setTeams(teamResult.items.map(({ id, name }) => ({ id, name }))); setRules(ruleResult.items);
    } catch { setError('财务数据加载失败'); }
  }, [api, leagueId]);
  useEffect(() => { void load(); }, [load]);
  const createManual = async (values: ManualFields) => {
    setSubmitting(true); setError(null);
    try {
      await api.request(`/v1/admin/leagues/${leagueId}/finance-entries`, {
        method: 'POST', headers: { 'Idempotency-Key': manualKey.current() }, schema: FinanceLedgerEntrySchema,
        body: { ...values, seasonId: values.seasonId?.trim() || null }
      });
      manualKey.reset(); setManualOpen(false); manualForm.resetFields(); await load();
    } catch { setError('新增财务项目失败，请检查球队、赛季和权限'); }
    finally { setSubmitting(false); }
  };
  const createRule = async (values: FeeFields) => {
    setSubmitting(true); setError(null);
    try {
      await api.request(`/v1/admin/leagues/${leagueId}/transaction-fee-rules`, {
        method: 'POST', headers: { 'Idempotency-Key': feeKey.current() }, schema: TransactionFeeRuleVersionSchema,
        body: { ...values, effectiveAt: new Date(values.effectiveAt).toISOString(), expectedCurrentVersion: rules[0]?.version ?? 0 }
      });
      feeKey.reset(); setFeeOpen(false); feeForm.resetFields(); await load();
    } catch { setError('手续费规则发布失败，请刷新后重试'); }
    finally { setSubmitting(false); }
  };
  return <Space orientation="vertical" size="large" style={{ width: '100%' }}>
  <Card title="财务流水">
    {error ? <Alert role="alert" type="warning" title={error} /> : null}
    <Alert type="info" showIcon title="实时数据，非最终结算" description="流水写入后不可修改或删除；赛季为空的旧流水归入“历史未归档”。" />
    <Descriptions column={2} items={[
      { key: 'rule', label: '当前手续费规则', children: rules[0] ? `${rules[0].rateBps / 100}% · 最低 ${rules[0].minimumFeeMinor}` : '尚未配置' },
      { key: 'history', label: '历史未归档', children: `${data.items.filter(({ seasonId }) => seasonId === null).length} 条` }
    ]} />
    <Space wrap><Button type="primary" onClick={() => setManualOpen(true)}>新增财务项目</Button><Button onClick={() => setFeeOpen(true)}>配置手续费规则</Button></Space>
    <Typography.Paragraph type="secondary">所有分类均以中文展示，技术类型码仅保留在接口和审计详情中。</Typography.Paragraph>
    <Table pagination={false} rowKey="id" dataSource={data.items} columns={[
      { title: '时间', dataIndex: 'createdAt' }, { title: '球队', dataIndex: 'teamName' },
      { title: '赛季', render: (_, row) => row.seasonId ?? '历史未归档' },
      { title: '方向', render: (_, row) => <Tag color={row.direction === 'CREDIT' ? 'success' : 'gold'}>{row.direction === 'CREDIT' ? '收入' : '支出'}</Tag> },
      { title: '类型', render: (_, row) => financeTypeLabels[row.type] ?? '其他项目' },
      { title: '金额', dataIndex: 'amountMinor' }, { title: '说明', dataIndex: 'note' }
    ]} />
    <Modal open={manualOpen} title="新增财务项目" footer={null} onCancel={() => setManualOpen(false)} destroyOnHidden>
      <Form<ManualFields> form={manualForm} layout="vertical" initialValues={{ direction: 'DEBIT', type: 'MANUAL_ADJUSTMENT' }} onValuesChange={() => manualKey.reset()} onFinish={(values) => void createManual(values)}>
        <Form.Item label="球队" name="leagueTeamId" rules={[{ required: true }]}><Select options={teams.map(({ id, name }) => ({ value: id, label: name }))} /></Form.Item>
        <Form.Item label="赛季 ID（留空归入历史未归档）" name="seasonId"><Input /></Form.Item>
        <Form.Item label="收支方向" name="direction" rules={[{ required: true }]}><Select options={[{ value: 'CREDIT', label: '收入' }, { value: 'DEBIT', label: '支出' }]} /></Form.Item>
        <Form.Item label="项目类型" name="type" rules={[{ required: true }]}><Select options={manualTypes.map((value) => ({ value, label: financeTypeLabels[value] }))} /></Form.Item>
        <Form.Item label="金额" name="amountMinor" rules={[{ required: true }]}><InputNumber min={1} precision={0} style={{ width: '100%' }} /></Form.Item>
        <Form.Item label="流水说明" name="note"><Input maxLength={512} /></Form.Item>
        <Form.Item label="操作原因" name="reason" rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={512} /></Form.Item>
        <Button type="primary" htmlType="submit" loading={submitting}>确认新增</Button>
      </Form>
    </Modal>
    <Modal open={feeOpen} title="发布手续费规则版本" footer={null} onCancel={() => setFeeOpen(false)} destroyOnHidden>
      <Form<FeeFields> form={feeForm} layout="vertical" onValuesChange={() => feeKey.reset()} onFinish={(values) => void createRule(values)}>
        <Form.Item label="费率（基点）" name="rateBps" rules={[{ required: true }]}><InputNumber min={0} max={10000} precision={0} style={{ width: '100%' }} /></Form.Item>
        <Form.Item label="最低手续费" name="minimumFeeMinor" rules={[{ required: true }]}><InputNumber min={0} precision={0} style={{ width: '100%' }} /></Form.Item>
        <Form.Item label="生效时间" name="effectiveAt" rules={[{ required: true }]}><Input type="datetime-local" /></Form.Item>
        <Button type="primary" htmlType="submit" loading={submitting}>发布新版本</Button>
      </Form>
    </Modal>
  </Card>
  <Card title="阵容交易历史" extra={<Tag color="success">正式记录</Tag>}>
    <Typography.Paragraph type="secondary">
      买入、转会、出售、解约和卡片调整会自动写入这里。历史不可编辑，确保金额与手续费可追溯。
    </Typography.Paragraph>
    <Table pagination={false} rowKey="id" dataSource={transactions.items} scroll={{ x: 960 }} locale={{ emptyText: '暂无阵容交易记录' }} columns={[
      { title: '时间', dataIndex: 'createdAt', render: (value: string) => dateTime(value) },
      { title: '类型', render: (_, row) => <Tag color={row.type === 'EMERGENCY_CORRECTION' ? 'gold' : 'green'}>{transactionTypeLabels[row.type] ?? '其他交易'}</Tag> },
      { title: '球员', dataIndex: 'playerName' },
      { title: '买卖双方', render: (_, row) => `${row.sourceTeamName ?? '外部'} → ${row.targetTeamName ?? '外部'}` },
      { title: '原值 → 新值', render: (_, row) => `${money(row.valuationSnapshotMinor)} → ${money(row.amountMinor)}` },
      { title: '手续费', render: (_, row) => `手续费 ${money(row.transactionFeeMinor)}` },
      { title: '备注', dataIndex: 'reason' }
    ]} />
  </Card>
  </Space>;
}
