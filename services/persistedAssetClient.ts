import { uploadInternalAssetStream, safeCreateInternalLog } from './internalApi';
import { buildPersistedResultFileName } from '../utils/cloudAssetState.mjs';
import { prepareImageForUpload } from '../utils/imageUtils';

export const persistGeneratedAsset = async (
  blob: Blob,
  module: string,
  baseName: string,
  suffix = 'result'
) => {
  const fileName = buildPersistedResultFileName(baseName, suffix);
  const file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
  const uploadFile = await prepareImageForUpload(file);
  const startedAt = Date.now();
  try {
    const response = await uploadInternalAssetStream({
      module,
      file: uploadFile,
      fileName,
    });
    void safeCreateInternalLog({
      level: 'info',
      module,
      action: 'persist_asset',
      message: '资产持久化成功',
      status: 'success',
      meta: {
        fileName,
        sizeBytes: blob.size,
        latencyMs: Date.now() - startedAt,
      },
    });
    return response.fileUrl;
  } catch (error: any) {
    void safeCreateInternalLog({
      level: 'error',
      module,
      action: 'persist_asset',
      message: '资产持久化失败',
      detail: error?.message || '',
      status: 'failed',
      meta: { fileName, sizeBytes: blob.size },
    });
    throw error;
  }
};
