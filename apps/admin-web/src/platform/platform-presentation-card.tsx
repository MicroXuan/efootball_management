import {
  Alert,
  Button,
  Card,
  Space,
  Spin,
  Upload,
} from 'antd';
import {
  PlatformPresentationSchema,
  type PlatformPresentation,
} from '@efm/contracts';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { ApiError, adminApi, type AdminApi } from '../lib/api';
import { BannerCropper } from './banner-cropper';

const UploadResultSchema = z.object({
  key: z.string(),
  url: z.url(),
  mimeType: z.string(),
  size: z.number().int(),
});
const acceptedImages = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function PlatformPresentationCard({ api = adminApi }: { api?: AdminApi }) {
  const [presentation, setPresentation] = useState<PlatformPresentation | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [cropSourceFile, setCropSourceFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const next = await api.request('/v1/admin/platform/presentation', {
        schema: PlatformPresentationSchema,
      });
      setPresentation(next);
      return next;
    } catch {
      setError('Banner 配置加载失败，请稍后重试');
      return null;
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  const save = async (url: string | null) => {
    if (!presentation || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await api.request('/v1/admin/platform/presentation', {
        method: 'PATCH',
        schema: PlatformPresentationSchema,
        body: {
          leagueCenterBannerUrl: url,
          expectedVersion: presentation.version,
        },
      });
      setPresentation(next);
      setImageFile(null);
      setNotice(url ? 'Banner 已更新，用户重新进入联赛页后即可看到。' : '已恢复默认球场背景。');
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'VERSION_CONFLICT') {
        await load();
        setError('配置已被其他管理员更新，已加载最新版本，请重新选择图片');
      } else {
        setError('Banner 保存失败，请稍后重试');
      }
    } finally {
      setBusy(false);
    }
  };

  const uploadAndSave = async () => {
    if (!imageFile || !presentation || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (!api.upload) throw new Error('Upload is unavailable');
      const stored = await api.upload(
        '/v1/admin/uploads/league-center-banners',
        imageFile,
        UploadResultSchema,
      );
      const next = await api.request('/v1/admin/platform/presentation', {
        method: 'PATCH',
        schema: PlatformPresentationSchema,
        body: {
          leagueCenterBannerUrl: stored.url,
          expectedVersion: presentation.version,
        },
      });
      setPresentation(next);
      setImageFile(null);
      setNotice('Banner 已更新，用户重新进入联赛页后即可看到。');
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'VERSION_CONFLICT') {
        await load();
        setError('配置已被其他管理员更新，已加载最新版本，请重新选择图片');
      } else {
        setError('Banner 上传或保存失败，请稍后重试');
      }
    } finally {
      setBusy(false);
    }
  };

  return <div className="page-stack">
    <header className="workspace-page-title">
      <span className="section-kicker">平台管理</span>
      <h1>前台展示</h1>
      <p>管理小程序联赛首页的宽幅主题图片。只换图片不需要重新发布小程序代码。</p>
    </header>
    <Card title="联赛中心 Banner" className="data-card platform-presentation-card">
      {error ? <Alert role="alert" type="error" showIcon title={error} /> : null}
      {notice ? <Alert role="status" type="success" showIcon title={notice} /> : null}
      {!presentation ? <div className="loading-block"><Spin /></div> : <>
        <div className="platform-banner-preview">
          {presentation.leagueCenterBannerUrl
            ? <img src={presentation.leagueCenterBannerUrl} alt="当前联赛中心 Banner" />
            : <div className="platform-banner-preview__fallback">尚未配置图片，前台会显示默认球场背景。</div>}
        </div>
        <p className="platform-banner-hint">建议使用约 3:1 的 JPG、PNG 或 WebP 图片，大小不超过 2MB；请避免在图片边缘放置重要文字。</p>
        <Upload
          accept="image/jpeg,image/png,image/webp"
          maxCount={1}
          fileList={imageFile ? [{ uid: 'league-center-banner', name: imageFile.name, status: 'done' }] : []}
          beforeUpload={(file) => {
            if (!acceptedImages.has(file.type)) {
              setError('仅支持 JPG、PNG、WebP 格式的图片');
              return Upload.LIST_IGNORE;
            }
            if (file.size > 2 * 1024 * 1024) {
              setError('图片大小不能超过 2MB');
              return Upload.LIST_IGNORE;
            }
            setError(null);
            setNotice(null);
            setCropSourceFile(file);
            return false;
          }}
          onRemove={() => { setImageFile(null); return true; }}
        >
          <Button>选择 Banner</Button>
        </Upload>
        {imageFile ? <Button className="platform-banner-recrop" onClick={() => setCropSourceFile(imageFile)}>重新裁剪</Button> : null}
        <Space className="platform-banner-actions">
          <Button type="primary" loading={busy} disabled={!imageFile || busy} onClick={() => void uploadAndSave()}>上传并保存</Button>
          {presentation.leagueCenterBannerUrl
            ? <Button danger disabled={busy} onClick={() => void save(null)}>恢复默认背景</Button>
            : null}
        </Space>
      </>}
    </Card>
    <BannerCropper
      file={cropSourceFile}
      onCancel={() => setCropSourceFile(null)}
      onConfirm={(croppedFile) => {
        setImageFile(croppedFile);
        setCropSourceFile(null);
      }}
    />
  </div>;
}
