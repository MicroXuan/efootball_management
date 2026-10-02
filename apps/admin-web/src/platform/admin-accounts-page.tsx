import { Alert, Button, Card, Empty, Form, Input, Modal, Select, Space, Spin, Table, Tag } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { AdminAccountSummarySchema, AdminLeagueGrantSchema, LeagueListResponseSchema, type AdminAccountSummary, type AdminLeagueGrant, type LeagueSummary } from '@efm/contracts';
import { ApiError, adminApi, type AdminApi } from '../lib/api';
import { useMutationKey } from '../lib/mutation-key';

const AccountsSchema = z.object({ items: z.array(AdminAccountSummarySchema) });
const GrantsSchema = z.object({ items: z.array(AdminLeagueGrantSchema) });
type AccountFields = { username: string; displayName: string; password: string };
type GrantFields = { adminId: string; leagueId: string };

export function AdminAccountsPage({ api = adminApi }: { api?: AdminApi }) {
  const [accounts, setAccounts] = useState<AdminAccountSummary[]>([]);
  const [leagues, setLeagues] = useState<LeagueSummary[]>([]);
  const [grantsByAdmin, setGrantsByAdmin] = useState<Record<string, AdminLeagueGrant[]>>({});
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<AdminAccountSummary | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [accountForm] = Form.useForm<AccountFields>();
  const [grantForm] = Form.useForm<GrantFields>();
  const selectedGrantAdminId = Form.useWatch('adminId', grantForm);
  const accountKey = useMutationKey();
  const grantKey = useMutationKey();
  const statusKey = useMutationKey();
  const passwordKey = useMutationKey();
  const revokeKey = useMutationKey();
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [accountResult, leagueResult] = await Promise.all([
        api.request('/v1/admin/accounts', { schema: AccountsSchema }),
        api.request('/v1/admin/platform/leagues', { schema: LeagueListResponseSchema })
      ]);
      const grants = await Promise.all(accountResult.items.map(async (account) => [
        account.id,
        (await api.request(`/v1/admin/accounts/${account.id}/league-grants`, { schema: GrantsSchema })).items
      ] as const));
      setAccounts(accountResult.items); setLeagues(leagueResult.items); setGrantsByAdmin(Object.fromEntries(grants));
      return accountResult.items;
    } catch { setError('管理员数据加载失败'); return null; }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  const create = async (values: AccountFields) => {
    if (pending) return; setPending('create'); setError(null);
    try {
      await api.request('/v1/admin/accounts', { method: 'POST', headers: { 'Idempotency-Key': accountKey.current() }, schema: AdminAccountSummarySchema, body: values });
      accountKey.reset(); accountForm.resetFields(); await load();
    } catch (caught) { setError(caught instanceof ApiError && caught.code === 'ADMIN_USERNAME_ALREADY_EXISTS' ? '管理员账号已存在' : '管理员创建失败'); }
    finally { setPending(null); }
  };
  const grant = async (values: GrantFields) => {
    if (pending) return; setPending('grant'); setError(null);
    try {
      await api.request(`/v1/admin/accounts/${values.adminId}/league-grants`, { method: 'POST', headers: { 'Idempotency-Key': grantKey.current() }, schema: AdminLeagueGrantSchema, body: { leagueId: values.leagueId, role: 'LEAGUE_MANAGER' } });
      grantKey.reset(); grantForm.resetFields(); await load();
    } catch { setError('联赛授权失败'); }
    finally { setPending(null); }
  };
  const toggleStatus = async (account: AdminAccountSummary) => {
    if (pending) return; setPending(`status:${account.id}`); setError(null);
    try {
      await api.request(`/v1/admin/accounts/${account.id}`, {
        method: 'PATCH', headers: { 'Idempotency-Key': statusKey.current() }, schema: AdminAccountSummarySchema,
        body: { status: account.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE', expectedVersion: account.version }
      });
      statusKey.reset(); await load();
    } catch { await load(); setError('账号状态保存失败，数据可能已更新'); }
    finally { setPending(null); }
  };
  const resetPassword = async ({ password }: { password: string }) => {
    if (!resetTarget || pending) return;
    const targetId = resetTarget.id;
    setPending(`password:${targetId}`); setError(null);
    try {
      await api.request(`/v1/admin/accounts/${targetId}/reset-password`, {
        method: 'POST', headers: { 'Idempotency-Key': passwordKey.current() }, schema: AdminAccountSummarySchema,
        body: { password, expectedVersion: resetTarget.version }
      });
      passwordKey.reset(); setResetTarget(null); setResetPasswordValue(''); await load();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'VERSION_CONFLICT') {
        const latest = await load();
        const current = latest?.find((item) => item.id === targetId) ?? null;
        if (current) setResetTarget(current);
        passwordKey.reset();
        setError(current ? '密码重置冲突，已加载最新账号版本，请重试' : '密码重置冲突，但最新账号数据加载失败，请重新加载页面');
      } else setError('密码重置失败，请稍后重试');
    } finally { setPending(null); }
  };
  const revoke = async (grant: AdminLeagueGrant) => {
    if (pending) return; setPending(`revoke:${grant.id}`); setError(null);
    try {
      await api.request(`/v1/admin/accounts/${grant.adminId}/league-grants/${grant.id}`, {
        method: 'DELETE', headers: { 'Idempotency-Key': revokeKey.current() }, schema: AdminLeagueGrantSchema,
        body: { expectedVersion: grant.version }
      });
      revokeKey.reset(); await load();
    } catch (caught) {
      await load();
      if (caught instanceof ApiError && caught.code === 'VERSION_CONFLICT') revokeKey.reset();
      setError(caught instanceof ApiError && caught.code === 'VERSION_CONFLICT' ? '授权已被其他管理员修改，已刷新列表' : '撤销授权失败');
    } finally { setPending(null); }
  };
  return <div className="page-stack">
    <header className="workspace-page-title"><div><span className="section-kicker">平台管理</span><h1>管理员账号</h1><p>管理登录状态、密码与联赛授权范围。</p></div></header>
    <Card title="管理员账号" className="data-card">
      {error ? <Alert role="alert" type="error" showIcon title={error} /> : null}
      {loading ? <div className="loading-block"><Spin /></div> : accounts.length ? <Table rowKey="id" pagination={false} dataSource={accounts} columns={[
        { title: '账号', dataIndex: 'username' }, { title: '显示名称', dataIndex: 'displayName' },
        { title: '状态', dataIndex: 'status', render: (value) => <Tag color={value === 'ACTIVE' ? 'green' : 'red'}>{value === 'ACTIVE' ? '启用' : '停用'}</Tag> },
        { title: '联赛权限', render: (_, row) => <Space wrap>{(grantsByAdmin[row.id] ?? []).length ? (grantsByAdmin[row.id] ?? []).map((grant) => <Tag key={grant.id} closable={!pending} onClose={(event) => { event.preventDefault(); void revoke(grant); }} closeIcon={<span aria-label={`撤销 ${grant.leagueName}`}>×</span>}>{grant.leagueName}</Tag>) : '暂无授权'}</Space> },
        { title: '上次登录', dataIndex: 'lastLoginAt', render: (value) => value ? new Date(value).toLocaleString() : '尚未登录' },
        { title: '操作', render: (_, row) => <Space><Button size="small" loading={pending === `status:${row.id}`} disabled={Boolean(pending)} onClick={() => void toggleStatus(row)}>{row.status === 'ACTIVE' ? '停用' : '启用'}</Button><Button size="small" disabled={Boolean(pending)} onClick={() => { passwordKey.reset(); setResetPasswordValue(''); setResetTarget(row); }}>重置密码</Button></Space> }
      ]} /> : <Empty description="暂无管理员" />}
    </Card>
    <div className="page-grid">
      <Card title="创建管理员" className="form-card"><Form<AccountFields> form={accountForm} layout="vertical" onValuesChange={() => accountKey.reset()} onFinish={create}>
        <Form.Item label="登录账号" name="username" rules={[{ required: true }]}><Input /></Form.Item><Form.Item label="显示名称" name="displayName" rules={[{ required: true }]}><Input /></Form.Item><Form.Item label="初始密码" name="password" rules={[{ required: true, min: 8 }]}><Input.Password /></Form.Item><Button type="primary" htmlType="submit" loading={pending === 'create'} disabled={Boolean(pending)}>创建管理员</Button>
      </Form></Card>
      <Card title="分配联赛权限" className="form-card"><Form<GrantFields> form={grantForm} layout="vertical" onValuesChange={() => grantKey.reset()} onFinish={grant}>
        <Form.Item label="管理员" name="adminId" rules={[{ required: true }]}><Select options={accounts.map((item) => ({ value: item.id, label: `${item.displayName} (${item.username})` }))} /></Form.Item><Form.Item label="联赛" name="leagueId" rules={[{ required: true }]}><Select options={leagues.filter((league) => !(grantsByAdmin[selectedGrantAdminId] ?? []).some((grant) => grant.leagueId === league.id)).map((item) => ({ value: item.id, label: item.name }))} /></Form.Item><Button type="primary" htmlType="submit" loading={pending === 'grant'} disabled={Boolean(pending)}>添加授权</Button>
      </Form></Card>
    </div>
    <Modal title={`重置密码 · ${resetTarget?.displayName ?? ''}`} open={Boolean(resetTarget)} footer={null} onCancel={() => setResetTarget(null)} destroyOnHidden>
      <label className="modal-field-label" htmlFor="reset-admin-password">新密码</label>
      <Input.Password id="reset-admin-password" value={resetPasswordValue} status={resetPasswordValue.length > 0 && resetPasswordValue.length < 8 ? 'error' : undefined} onChange={(event) => { passwordKey.reset(); setResetPasswordValue(event.target.value); }} />
      <Button type="primary" className="modal-primary-action" loading={pending === `password:${resetTarget?.id}`} disabled={Boolean(pending) || resetPasswordValue.length < 8} onClick={() => void resetPassword({ password: resetPasswordValue })}>确认重置</Button>
    </Modal>
  </div>;
}
