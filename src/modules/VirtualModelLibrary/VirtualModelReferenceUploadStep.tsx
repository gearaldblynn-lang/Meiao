import React, { useRef, useState } from 'react';
import { LoaderCircle, Star, Trash2, Upload } from 'lucide-react';
import AuthenticatedAssetImage from '../../components/AuthenticatedAssetImage';
import { uploadInternalAssetStream } from '../../services/internalApi';

export type VirtualModelReferenceAsset = {
  assetId: string;
  fileUrl: string;
  name: string;
};

type Props = {
  assets: VirtualModelReferenceAsset[];
  primaryAssetId: string;
  disabled: boolean;
  onChange: (assets: VirtualModelReferenceAsset[]) => void;
  onPrimaryChange: (assetId: string) => void;
  onError: (message: string) => void;
};

const VirtualModelReferenceUploadStep: React.FC<Props> = ({
  assets,
  primaryAssetId,
  disabled,
  onChange,
  onPrimaryChange,
  onError,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const handleFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList || []).filter((file) => file.type.startsWith('image/'));
    if (!files.length) {
      onError('请选择图片文件。');
      return;
    }
    if (assets.length + files.length > 5) {
      onError('最多上传 5 张同一模特的参考图。');
      return;
    }
    setUploading(true);
    onError('');
    try {
      const uploaded: VirtualModelReferenceAsset[] = [];
      for (const file of files) {
        const result = await uploadInternalAssetStream({
          module: 'virtual_model_generation',
          file,
          fileName: file.name,
        });
        if (!result.assetId) {
          throw new Error('参考图未保存为本地受管素材，请重新上传。');
        }
        uploaded.push({
          assetId: result.assetId,
          fileUrl: result.fileUrl,
          name: file.name,
        });
      }
      const next = [...assets, ...uploaded];
      onChange(next);
      if (!primaryAssetId && next[0]) onPrimaryChange(next[0].assetId);
    } catch (error) {
      onError(error instanceof Error ? error.message : '参考图上传失败。');
    } finally {
      setUploading(false);
    }
  };

  const removeAsset = (assetId: string) => {
    const next = assets.filter((asset) => asset.assetId !== assetId);
    onChange(next);
    if (primaryAssetId === assetId) onPrimaryChange(next[0]?.assetId || '');
  };

  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold">上传模特参考图</h3>
        <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
          支持 1-5 张同一模特图片，近景和全身图可以混合上传。
        </p>
      </div>
      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{assets.length}/5</span>
    </div>
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      multiple
      className="hidden"
      disabled={disabled || uploading}
      onChange={(event) => {
        void handleFiles(event.target.files);
        event.currentTarget.value = '';
      }}
    />
    <button
      type="button"
      disabled={disabled || uploading || assets.length >= 5}
      onClick={() => inputRef.current?.click()}
      className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm disabled:opacity-50"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      {uploading
        ? <LoaderCircle size={16} className="animate-spin" />
        : <Upload size={16} />}
      {uploading ? '上传中' : '选择图片'}
    </button>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {assets.map((asset) => {
        const primary = asset.assetId === primaryAssetId;
        return <div
          key={asset.assetId}
          className="overflow-hidden rounded-md border"
          style={{ borderColor: primary ? 'var(--accent)' : 'var(--border-subtle)' }}
        >
          <AuthenticatedAssetImage src={asset.fileUrl} alt={asset.name} className="aspect-[3/4] w-full object-cover" />
          <div className="flex items-center justify-between gap-1 p-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPrimaryChange(asset.assetId)}
              className="inline-flex min-w-0 items-center gap-1 text-xs"
              style={{ color: primary ? 'var(--accent)' : 'var(--text-secondary)' }}
              title="设为主参考"
            >
              <Star size={14} fill={primary ? 'currentColor' : 'none'} />
              <span className="truncate">{primary ? '主参考' : '设为主参考'}</span>
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => removeAsset(asset.assetId)}
              className="inline-flex h-7 w-7 items-center justify-center rounded"
              aria-label={`删除参考图 ${asset.name}`}
              title="删除参考图"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>;
      })}
    </div>
  </div>;
};

export default VirtualModelReferenceUploadStep;
