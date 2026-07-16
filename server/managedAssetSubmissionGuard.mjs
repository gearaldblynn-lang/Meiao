const MANAGED_ASSET_PATH_SEGMENT = '/api/assets/file/';

const containsManagedAssetReference = (value) => {
  if (Array.isArray(value)) return value.some((item) => containsManagedAssetReference(item));
  if (value && typeof value === 'object') {
    return Object.values(value).some((item) => containsManagedAssetReference(item));
  }
  return typeof value === 'string' && value.includes(MANAGED_ASSET_PATH_SEGMENT);
};

const normalizeImageUrls = (value) => {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items.map((item) => String(item || '').trim()).filter(Boolean);
};

const createSubmissionGuardError = ({
  code,
  message,
  inputImageUrls = [],
  inputImageCount = inputImageUrls.length,
}) => {
  const error = new Error(message);
  error.code = code;
  error.providerStage = 'input_prepare';
  error.providerStatus = 'failed';
  error.providerMessage = message;
  error.inputImageCount = inputImageCount;
  error.inputImageUrls = inputImageUrls;
  error.usedImageReferenceUrls = inputImageUrls;
  return error;
};

export const assertManagedAssetSubmissionUserContext = ({ payload, userId } = {}) => {
  if (!containsManagedAssetReference(payload)) return;
  if (String(userId || '').trim()) return;
  const inputImageUrls = normalizeImageUrls(payload?.imageUrls)
    .filter((url) => url.includes(MANAGED_ASSET_PATH_SEGMENT));
  throw createSubmissionGuardError({
    code: 'managed_asset_user_context_missing',
    message: '托管素材提交缺少账号上下文，已停止调用模型，避免引用图被错误清除。',
    inputImageUrls,
  });
};

export const assertManagedImageInputsPreserved = ({ taskType, originalPayload, scrubbedPayload } = {}) => {
  if (String(taskType || '') !== 'kie_image') return;
  const originalImageUrls = normalizeImageUrls(originalPayload?.imageUrls);
  if (originalImageUrls.length === 0) return;
  const scrubbedImageUrls = normalizeImageUrls(scrubbedPayload?.imageUrls);
  const inputsUnchanged = originalImageUrls.length === scrubbedImageUrls.length
    && originalImageUrls.every((url, index) => url === scrubbedImageUrls[index]);
  if (inputsUnchanged) return;
  throw createSubmissionGuardError({
    code: 'managed_image_input_removed',
    message: '改图引用素材在提交前未通过账号或可用性校验，已停止调用模型，禁止降级为文生图。',
    inputImageCount: originalImageUrls.length,
    inputImageUrls: originalImageUrls.filter((url) => url.includes(MANAGED_ASSET_PATH_SEGMENT)),
  });
};
