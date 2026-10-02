import { Alert, Card, Empty, Spin, Table } from 'antd';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { AuditLogSchema, type AuditLog } from '@efm/contracts';
import { adminApi, type AdminApi } from '../lib/api';

export function AuditPage({ api = adminApi }: { api?: AdminApi }) {
  const [items, setItems] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void api.request('/v1/admin/audit-logs', { schema: z.array(AuditLogSchema) })
      .then((result) => { if (active) setItems(result); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api]);
  return <div className="page-stack">
    <header className="workspace-page-title"><div><span className="section-kicker">平台管理</span><h1>审计日志</h1><p>按时间追踪不可变的后台操作记录。</p></div></header>
    <Card title="审计日志" className="data-card">
    {error ? <Alert role="alert" type="error" showIcon title="审计日志加载失败" /> : null}
    {loading ? <div className="loading-block"><Spin /></div> : items.length ? <Table rowKey="id" pagination={{ pageSize: 20 }} dataSource={items} columns={[
      { title: '时间', dataIndex: 'createdAt', render: (value) => new Date(value).toLocaleString() },
      { title: '动作', dataIndex: 'action' }, { title: '资源', render: (_, row) => `${row.resourceType}${row.resourceId ? ` · ${row.resourceId}` : ''}` },
      { title: '原因', dataIndex: 'reason', render: (value) => value ?? '—' }
    ]} /> : <Empty description="暂无审计记录" />}
    </Card>
  </div>;
}
