import { Alert, Button, Card, Empty, Form, Input, InputNumber, Select, Spin, Tabs, Tag, Upload } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [statusTab, setStatusTab] = useState<'ACTIVE' | 'ARCHIVED'>('ACTIVE');
  const [editing, setEditing] = useState<LeagueSummary | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [form] = Form.useForm<Fields>();
  const editorRef = useRef<HTMLDivElement>(null);
  const editorTitleRef = useRef<HTMLHeadingElement>(null);
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
  useEffect(() => {
    if (!editing) return;
    editorTitleRef.current?.focus({ preventScroll: true });
    editorRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [editing]);
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
  const activeCount = items.filter((item) => item.status === 'ACTIVE').length;
  const archivedCount = items.filter((item) => item.status === 'ARCHIVED').length;
  const visibleItems = items.filter((item) => item.status === statusTab);
  return <div className="page-grid">
    <header className="workspace-page-title"><div><span className="section-kicker">平台管理</span><h1>联赛管理</h1><p>创建联赛、确认当前赛季，并进入各赛事工作区。</p></div></header>
    <Card title="联赛目录" extra={!loading ? `共 ${items.length} 个联赛` : undefined} className="data-card league-directory">
      {error ? <Alert role="alert" type="error" showIcon title={error} /> : null}
      {loading ? <div className="loading-block"><Spin /></div> : <>
        <Tabs
          activeKey={statusTab}
          onChange={(key) => setStatusTab(key as 'ACTIVE' | 'ARCHIVED')}
          items={[
            { key: 'ACTIVE', label: `启用联赛（${activeCount}）` },
            { key: 'ARCHIVED', label: `已归档（${archivedCount}）` },
          ]}
        />
        {visibleItems.length ? <div className="league-card-grid">
        {visibleItems.map((item) => <article key={item.id} className={`league-card${item.status === 'ARCHIVED' ? ' league-card--archived' : ''}`}>
          <div className="league-card__main">
            {item.logoUrl
              ? <img className="league-card__logo" src={item.logoUrl} alt={`${item.shortName} 联赛标识`} />
              : <span className="league-card__logo league-card__logo--fallback" aria-label={`${item.shortName} 联赛标识`}>{item.shortName.slice(0, 2)}</span>}
            <div className="league-card__identity">
              <div className="league-card__badges"><Tag>{item.edition === 'NATIONAL' ? '国服' : '国际服'}</Tag><Tag color={item.status === 'ACTIVE' ? 'success' : 'default'}>{item.status === 'ACTIVE' ? '启用' : '归档'}</Tag></div>
              <h2 title={item.name}><Link to={`/leagues/${item.id}/teams`}>{item.name}</Link></h2>
              <p>{item.description || `${item.shortName} 赛事运营工作区`}</p>
            </div>
          </div>
          <div className="league-card__season">
            <span>当前赛季</span>
            {item.currentSeason ? <strong>{item.currentSeason.displayName}</strong> : <strong>尚未设置当前赛季</strong>}
            <Link to={`/leagues/${item.id}/seasons`}>{item.status === 'ARCHIVED' ? '查看赛季' : item.currentSeason ? '管理赛季' : '设置首个赛季'}</Link>
          </div>
          <div className="league-card__actions">
            <Button type={item.status === 'ACTIVE' ? 'primary' : 'default'} href={`/leagues/${item.id}/teams`}>{item.status === 'ACTIVE' ? '进入联赛' : '查看历史'}</Button>
            <Button aria-label={`编辑 ${item.name}`} disabled={submitting} onClick={() => { mutationKey.reset(); setEditing(item); setImageFile(null); form.setFieldsValue(item); }}>编辑</Button>
          </div>
        </article>)}
      </div> : <Empty description={items.length ? (statusTab === 'ACTIVE' ? '暂无启用联赛' : '暂无已归档联赛') : '暂无联赛'} />}
      </>}
    </Card>
    <div ref={editorRef} className="league-editor-anchor">
    <Card title={<h2 ref={editorTitleRef} className="form-card__title" tabIndex={-1}>{editing ? `编辑联赛 · ${editing.name}` : '新建联赛'}</h2>} className="form-card"><Form<Fields> form={form} layout="vertical" onValuesChange={() => mutationKey.reset()} onFinish={save} initialValues={{ defaultSuperCapacity: 23, defaultChampionCapacity: 18, defaultPromotionCount: 4 }}>
      <div className="form-section-title"><strong>基础资料</strong><span>用于前台展示与管理员识别</span></div>
      <Form.Item label="联赛名称" name="name" rules={[{ required: true, message: '请输入联赛名称' }]}><Input /></Form.Item>
      <Form.Item label="联赛简称" name="shortName" rules={[{ required: true, message: '请输入联赛简称' }]}><Input /></Form.Item>
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
      <div className="form-section-title"><strong>默认竞赛规则</strong><span>新赛季可单独覆盖这些参数</span></div>
      <div className="inline-fields"><Form.Item label="超级组人数" name="defaultSuperCapacity"><InputNumber min={2} max={64} /></Form.Item><Form.Item label="冠军组人数" name="defaultChampionCapacity"><InputNumber min={2} max={64} /></Form.Item><Form.Item label="升级建议数" name="defaultPromotionCount"><InputNumber min={0} max={32} /></Form.Item></div>
      <Button type="primary" htmlType="submit" loading={submitting} disabled={submitting}>{editing ? '保存联赛' : '创建联赛'}</Button>
      {editing ? <Button disabled={submitting} onClick={() => { mutationKey.reset(); setEditing(null); setImageFile(null); form.resetFields(); }}>取消编辑</Button> : null}
    </Form></Card>
    </div>
  </div>;
}
