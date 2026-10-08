import { Alert, Button, Modal, Slider } from 'antd';
import { useEffect, useRef, useState } from 'react';

const PREVIEW_WIDTH = 900;
const PREVIEW_HEIGHT = 300;
const OUTPUT_WIDTH = 1500;
const OUTPUT_HEIGHT = 500;

type CropPosition = { x: number; y: number };

export type CropSourceRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function calculateCropSourceRect(
  imageWidth: number,
  imageHeight: number,
  zoom: number,
  position: CropPosition,
): CropSourceRect {
  const targetRatio = OUTPUT_WIDTH / OUTPUT_HEIGHT;
  const imageRatio = imageWidth / imageHeight;
  const baseWidth = imageRatio > targetRatio ? imageHeight * targetRatio : imageWidth;
  const baseHeight = imageRatio > targetRatio ? imageHeight : imageWidth / targetRatio;
  const width = baseWidth / zoom;
  const height = baseHeight / zoom;

  return {
    x: (imageWidth - width) * ((position.x + 1) / 2),
    y: (imageHeight - height) * ((position.y + 1) / 2),
    width,
    height,
  };
}

function clamp(value: number) {
  return Math.max(-1, Math.min(1, value));
}

export function BannerCropper({
  file,
  onCancel,
  onConfirm,
}: {
  file: File | null;
  onCancel: () => void;
  onConfirm: (file: File) => void;
}) {
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [imageReady, setImageReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState<CropPosition>({ x: 0, y: 0 });
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!file) {
      setSourceUrl(null);
      return undefined;
    }
    const nextUrl = URL.createObjectURL(file);
    setSourceUrl(nextUrl);
    setImageReady(false);
    setZoom(1);
    setPosition({ x: 0, y: 0 });
    setError(null);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !imageReady) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const crop = calculateCropSourceRect(
      image.naturalWidth,
      image.naturalHeight,
      zoom,
      position,
    );
    context.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
    context.drawImage(
      image,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      PREVIEW_WIDTH,
      PREVIEW_HEIGHT,
    );
  }, [imageReady, position, sourceUrl, zoom]);

  const reset = () => {
    setZoom(1);
    setPosition({ x: 0, y: 0 });
  };

  const createCroppedFile = async () => {
    const image = imageRef.current;
    if (!image || !imageReady || processing) return;
    setProcessing(true);
    setError(null);
    try {
      const output = document.createElement('canvas');
      output.width = OUTPUT_WIDTH;
      output.height = OUTPUT_HEIGHT;
      const context = output.getContext('2d');
      if (!context) throw new Error('Canvas is unavailable');
      const crop = calculateCropSourceRect(
        image.naturalWidth,
        image.naturalHeight,
        zoom,
        position,
      );
      context.drawImage(
        image,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        OUTPUT_WIDTH,
        OUTPUT_HEIGHT,
      );
      const blob = await new Promise<Blob | null>((resolve) => {
        output.toBlob(resolve, 'image/webp', 0.9);
      });
      if (!blob) throw new Error('Image export failed');
      if (blob.size > 2 * 1024 * 1024) {
        setError('裁剪后的图片仍超过 2MB，请缩小原图后重试');
        return;
      }
      onConfirm(new File([blob], 'banner-cropped.webp', { type: 'image/webp' }));
    } catch {
      setError('图片裁剪失败，请重新选择图片');
    } finally {
      setProcessing(false);
    }
  };

  return <Modal
    title="裁剪 Banner"
    open={Boolean(file)}
    width={960}
    destroyOnHidden
    onCancel={onCancel}
    footer={[
      <Button key="cancel" onClick={onCancel}>取消</Button>,
      <Button key="reset" disabled={!imageReady || processing} onClick={reset}>重置</Button>,
      <Button
        key="confirm"
        type="primary"
        loading={processing}
        disabled={!imageReady || processing}
        onClick={() => void createCroppedFile()}
      >使用裁剪结果</Button>,
    ]}
  >
    <p className="banner-cropper__intro">拖动图片调整位置，使用缩放滑块控制取景范围。最终图片固定为 3:1。</p>
    {error ? <Alert type="error" showIcon title={error} /> : null}
    <div className="banner-cropper__viewport">
      {sourceUrl ? <img
        ref={imageRef}
        className="banner-cropper__source"
        src={sourceUrl}
        alt="待裁剪 Banner 原图"
        onLoad={() => setImageReady(true)}
      /> : null}
      <canvas
        ref={canvasRef}
        className="banner-cropper__canvas"
        width={PREVIEW_WIDTH}
        height={PREVIEW_HEIGHT}
        aria-label="3:1 Banner 裁剪预览"
        onPointerDown={(event) => {
          dragRef.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          const previous = dragRef.current;
          if (!previous) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          const width = bounds.width || PREVIEW_WIDTH;
          const height = bounds.height || PREVIEW_HEIGHT;
          setPosition((current) => ({
            x: clamp(current.x - ((event.clientX - previous.x) * 2) / width),
            y: clamp(current.y - ((event.clientY - previous.y) * 2) / height),
          }));
          dragRef.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerUp={() => { dragRef.current = null; }}
        onPointerCancel={() => { dragRef.current = null; }}
      />
      {!imageReady ? <div className="banner-cropper__loading">正在读取图片…</div> : null}
    </div>
    <div className="banner-cropper__controls">
      <span>缩放</span>
      <Slider
        min={1}
        max={3}
        step={0.01}
        value={zoom}
        disabled={!imageReady}
        aria-label="Banner 缩放"
        onChange={setZoom}
      />
      <strong>{zoom.toFixed(2)}×</strong>
    </div>
  </Modal>;
}
