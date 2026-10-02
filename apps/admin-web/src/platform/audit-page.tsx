import { Alert, Button, Card, Descriptions, Drawer, Empty, Spin, Table } from 'antd';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { AuditLogSchema, type AuditLog } from '@efm/contracts';
import { adminApi, type AdminApi } from '../lib/api';
import { presentAuditLog } from './audit-presentation';

export function AuditPage({ api = adminApi }: { api?: AdminApi }) {
  const [items, setItems] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<AuditLog | null>(null);
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
    <Card title="审计日志" className="data-card audit-card">
    {error ? <Alert role="alert" type="error" showIcon title="审计日志加载失败" /> : null}
    {loading ? <div className="loading-block"><Spin /></div> : items.length ? <Table rowKey="id" pagination={{ pageSize: 20 }} dataSource={items} columns={[
      { title: '时间', dataIndex: 'createdAt', width: 176, render: (value) => new Date(value).toLocaleString('zh-CN') },
      { title: '操作人', render: (_, row) => presentAuditLog(row).actor },
      { title: '具体操作', render: (_, row) => presentAuditLog(row).action },
      { title: '影响对象', render: (_, row) => <div className="audit-subject"><strong>{presentAuditLog(row).subject}</strong><span>{presentAuditLog(row).summary}</span></div> },
      { title: '结果', render: (_, row) => presentAuditLog(row).result },
      { title: '查看详情', width: 104, render: (_, row) => <Button type="link" onClick={() => setSelected(row)}>查看详情</Button> }
    ]} /> : <Empty description="暂无审计记录" />}
    </Card>
    <Drawer open={selected !== null} onClose={() => setSelected(null)} title="审计记录详情" size="large">
      {selected ? <>
        <Descriptions column={1} bordered items={[
          { key: 'action', label: '动作码', children: selected.action },
          { key: 'logId', label: '日志 ID', children: selected.id },
          { key: 'resourceType', label: '资源类型', children: selected.resourceType },
          { key: 'resourceId', label: '资源 ID', children: selected.resourceId ?? '—' },
          { key: 'reason', label: '操作原因', children: selected.reason ?? '—' }
        ]} />
        <section className="audit-metadata"><h3>参数与版本</h3><dl>
          {Object.entries(selected.metadata).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd></div>)}
        </dl></section>
      </> : null}
    </Drawer>
  </div>;
}
