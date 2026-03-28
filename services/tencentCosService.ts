import { GlobalApiConfig } from '../types';
import { fileToBase64 } from '../utils/imageUtils';
import { getActiveModuleContext, getCurrentUserContext, safeCreateInternalLog, uploadInternalAsset, uploadInternalAssetStream } from './internalApi';

const sanitizePathPart = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) || 'anonymous';

const buildUniqueFileName = (file: File, customFileName?: string) => {
  const currentUser = getCurrentUserContext();
  const sourceName = customFileName || file.name || 'upload.bin';
  const dotIndex = sourceName.lastIndexOf('.');
  const baseName = dotIndex > 0 ? sourceName.slice(0, dotIndex) : sourceName;
  const extension = dotIndex > 0 ? sourceName.slice(dotIndex) : '';
  const safeBaseName = sanitizePathPart(baseName);
  const userPrefix = sanitizePathPart(currentUser?.username || currentUser?.id || 'local');
  const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return `${userPrefix}_${safeBaseName}_${uniqueSuffix}${extension}`;
};

export const uploadToCos = async (
  file: File,
  _apiConfig: GlobalApiConfig,
  customFileName?: string,
  logMeta?: Record<string, unknown>
): Promise<string> => {
  if (!file) {
    throw new Error('文件对象为空');
  }

  const activeModule = getActiveModuleContext() || 'unknown';
  const uploadFileName = buildUniqueFileName(file, customFileName);

  const uploadStartedAt = Date.now();
  void safeCreateInternalLog({
    level: 'info',
    module: activeModule,
    action: 'upload_asset',
    message: `开始上传素材：${file.name}`,
    status: 'started',
    meta: {
      fileName: uploadFileName,
      fileSize: file.size,
      uploadMethod: 'stream',
      uploadStartedAt,
      ...logMeta,
    },
  });

  try {
    let result;
    let uploadMethod: 'stream' | 'base64' = 'stream';
    try {
      result = await uploadInternalAssetStream({
        module: activeModule,
        file,
        fileName: uploadFileName,
      });
    } catch (streamError: any) {
      uploadMethod = 'base64';
      void safeCreateInternalLog({
        level: 'info',
        module: activeModule,
        action: 'upload_asset_fallback',
        message: `流式上传失败，回退 Base64：${file.name}`,
        detail: streamError?.message || '流式上传失败',
        status: 'started',
        meta: {
          fileName: uploadFileName,
          fileSize: file.size,
          uploadMethod,
          uploadStartedAt,
          ...logMeta,
        },
      });
      const base64Data = await fileToBase64(file);
      result = await uploadInternalAsset({
        module: activeModule,
        fileName: uploadFileName,
        mimeType: file.type || 'application/octet-stream',
        base64Data,
      });
    }

    void safeCreateInternalLog({
      level: 'info',
      module: activeModule,
      action: 'upload_asset',
      message: `素材上传成功：${file.name}`,
      status: 'success',
      meta: {
        fileUrl: result.fileUrl,
        fileName: uploadFileName,
        fileSize: file.size,
        uploadMethod,
        uploadStartedAt,
        uploadFinishedAt: Date.now(),
        uploadDurationMs: Date.now() - uploadStartedAt,
        ...logMeta,
      },
    });

    return result.fileUrl;
  } catch (error: any) {
    void safeCreateInternalLog({
      level: 'error',
      module: activeModule,
      action: 'upload_asset',
      message: `素材上传失败：${file.name}`,
      detail: error.message,
      status: 'failed',
      meta: {
        fileName: uploadFileName,
        fileSize: file.size,
        uploadStartedAt,
        uploadFinishedAt: Date.now(),
        uploadDurationMs: Date.now() - uploadStartedAt,
        ...logMeta,
      },
    });
    throw error;
  }
};
