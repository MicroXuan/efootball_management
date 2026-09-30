import { Alert, Button, Card, Empty, Form, Input, InputNumber, Select, Spin, Table, Tag, Upload } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LeagueDetailSchema, LeagueListResponseSchema, type LeagueEdition, type LeagueSummary } from '@efm/contracts';
import { z } from 'zod';
import { ApiError, adminApi, type AdminApi } from '../lib/api';
import { useMutationKey } from '../lib/mutation-key';

type Fields = { name: string; shortName: string; description?: string; status?: 'ACTIVE' | 'ARCHIVED'; edition: LeagueEdition; defaultSuperCapacity: number; defaultChampionCapacity: number; defaultPromotionCount: number };
const UploadResultSchema = z.object({ key: z.string(), url: z.url(), mimeType: z.string(), size: z.number().int() });
const acceptedImages = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function LeaguesPage({ api = adminApi }: { api?: AdminApi }) {
  const [items, setItems] = useState<LeagueSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState<LeagueSummary | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [form] = Form.useForm<Fields>();
  const mutationKey = useMutationKey();
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const next = (await api.request('/v1/admin/platform/leagues', { schema: LeagueListResponseSchema })).items;
      setItems(next); return next;
    }
    catch { setError('联赛列表加载失败'); return null; }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  const save = async (values: Fields) => {
    if (submitting) return; setSubmitting(true); setError(null);
    try {
      let logoUrl = editing?.logoUrl ?? null;
      if (imageFile) {
        try {
          if (!api.upload) throw new Error('Upload is unavailable');
          logoUrl = (await api.upload('/v1/admin/uploads/league-images', imageFile, UploadResultSchema)).url;
        } catch {
          setError('联赛图片上传失败，请稍后重试');
          return;
        }
      }
      await api.request(editing ? `/v1/admin/platform/leagues/${editing.id}` : '/v1/admin/platform/leagues', {
        method: editing ? 'PATCH' : 'POST', headers: { 'Idempotency-Key': mutationKey.current() }, schema: LeagueDetailSchema,
        body: editing
          ? { ...values, description: values.description ?? '', logoUrl, expectedVersion: editing.version }
          : { ...values, status: undefined, description: values.description ?? '', logoUrl }
      });
      mutationKey.reset(); setEditing(null); setImageFile(null); form.resetFields(); await load();
    } catch (caught) {
      if (editing && caught instanceof ApiError && caught.code === 'VERSION_CONFLICT') {
        const editingId = editing.id;
        const latest = await load();
        const current = latest?.find((item) => item.id === editingId) ?? null;
        mutationKey.reset();
        if (current) {
          setEditing(current);
          form.setFieldsValue(current);
          setError('联赛已被其他管理员更新，已为你加载最新版本');
        } else setError('联赛已被其他管理员更新，但最新数据加载失败，请重新加载页面');
      } else setError(editing ? '联赛保存失败，请稍后重试' : '联赛创建失败，请检查填写内容');
    } finally { setSubmitting(false); }
  };
  return <div className="page-grid">
    <Card title="联赛管理" className="data-card">
      {error ? <Alert role="alert" type="error" showIcon title={error} /> : null}
      {loading ? <div className="loading-block"><Spin /></div> : items.length ? <Table rowKey="id" pagination={false} dataSource={items} columns={[
        { title: '联赛', dataIndex: 'name', render: (value, row) => <Link to={`/leagues/${row.id}/teams`}>{value}</Link> },
        { title: '简称', dataIndex: 'shortName' }, { title: '版本', dataIndex: 'edition', render: (value) => value === 'NATIONAL' ? '国服' : '国际服' },
        { title: '当前赛季', render: (_, row) => row.currentSeason?.displayName ?? '未设置' },
        { title: '状态', dataIndex: 'status', render: (value) => <Tag color={value === 'ACTIVE' ? 'green' : 'default'}>{value === 'ACTIVE' ? '启用' : '归档'}</Tag> },
        { title: '操作', render: (_, row) => <Button type="link" disabled={submitting} onClick={() => { mutationKey.reset(); setEditing(row); setImageFile(null); form.setFieldsValue(row); }}>编辑</Button> }
      ]} /> : <Empty description="暂无联赛" />}
    </Card>
    <Card title={editing ? `编辑联赛 · ${editing.name}` : '新建联赛'} className="form-card"><Form<Fields> form={form} layout="vertical" onValuesChange={() => mutationKey.reset()} onFinish={save} initialValues={{ defaultSuperCapacity: 23, defaultChampionCapacity: 18, defaultPromotionCount: 4 }}>
      <Form.Item label="联赛名称" name="name" rules={[{ required: true }]}><Input /></Form.Item>
      <Form.Item label="联赛简称" name="shortName" rules={[{ required: true }]}><Input /></Form.Item>
      <Form.Item label="说明" name="description"><Input.TextArea rows={3} /></Form.Item>
      <Form.Item label="版本" name="edition" rules={[{ required: true, message: '请选择国服或国际服' }]}><Select options={[{ value: 'NATIONAL', label: '国服' }, { value: 'INTERNATIONAL', label: '国际服' }]} /></Form.Item>
      <Form.Item label="联赛图片" extra="支持 JPG、PNG、WebP，图片大小不超过 2MB">
        <Upload accept="image/jpeg,image/png,image/webp" maxCount={1} fileList={imageFile ? [{ uid: 'league-image', name: imageFile.name, status: 'done' }] : []}
          beforeUpload={(file) => {
            if (!acceptedImages.has(file.type)) { setError('仅支持 JPG、PNG、WebP 格式的图片'); return Upload.LIST_IGNORE; }
            if (file.size > 2 * 1024 * 1024) { setError('图片大小不能超过 2MB'); return Upload.LIST_IGNORE; }
            setError(null); setImageFile(file); return false;
          }}
          onRemove={() => { setImageFile(null); return true; }}>
          <Button>选择图片</Button>
        </Upload>
      </Form.Item>
      {editing ? <Form.Item label="联赛状态" name="status"><Select options={[{ value: 'ACTIVE', label: '启用' }, { value: 'ARCHIVED', label: '归档' }]} /></Form.Item> : null}
      <div className="inline-fields"><Form.Item label="超级组人数" name="defaultSuperCapacity"><InputNumber min={2} max={64} /></Form.Item><Form.Item label="冠军组人数" name="defaultChampionCapacity"><InputNumber min={2} max={64} /></Form.Item><Form.Item label="升级建议数" name="defaultPromotionCount"><InputNumber min={0} max={32} /></Form.Item></div>
      <Button type="primary" htmlType="submit" loading={submitting} disabled={submitting}>{editing ? '保存联赛' : '创建联赛'}</Button>
      {editing ? <Button disabled={submitting} onClick={() => { mutationKey.reset(); setEditing(null); setImageFile(null); form.resetFields(); }}>取消编辑</Button> : null}
    </Form></Card>
  </div>;
}
