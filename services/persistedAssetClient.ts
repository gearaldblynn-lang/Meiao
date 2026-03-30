import { uploadInternalAssetStream } from './internalApi';
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
  const response = await uploadInternalAssetStream({
    module,
    file: uploadFile,
    fileName,
  });
  return response.fileUrl;
};
