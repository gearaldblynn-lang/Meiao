import { deleteVirtualModel } from './virtualModelStore.mjs';

const NOT_FOUND_CODES = new Set([
  'MODEL_NOT_FOUND',
  'MODEL_NOT_PUBLISHED',
  'MODEL_VERSION_CHANGED',
]);

const REQUEST_ERROR_CODES = new Set([
  'MODEL_ASSET_INCOMPLETE',
  'MODEL_ASSET_INVALID',
  'MODEL_ASSET_UNAVAILABLE',
  'MODEL_ID_INVALID',
  'MODEL_PREVIEW_INVALID',
  'MODEL_PREVIEW_UNAVAILABLE',
  'MODEL_SNAPSHOT_UNAVAILABLE',
  'MODEL_VERSION_IMMUTABLE',
]);

const writeJsonResponse = (res, statusCode, payload) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...(res.__corsHeaders || {}),
  });
  res.end(JSON.stringify(payload));
};

export const respondVirtualModelApiError = (res, error, writeJson = writeJsonResponse) => {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (NOT_FOUND_CODES.has(code)) {
    writeJson(res, 404, { code, message: error?.message || 'Virtual model not found.', issues: error?.issues });
    return;
  }
  if (REQUEST_ERROR_CODES.has(code)) {
    writeJson(res, 400, { code, message: error?.message || 'Virtual model request failed.', issues: error?.issues });
    return;
  }
  writeJson(res, 500, { code: 'MODEL_REQUEST_FAILED', message: 'Virtual model request failed.' });
};

export const handleVirtualModelDeleteApiRequest = async ({
  req,
  res,
  url,
  user,
  pool = null,
  store = null,
  persist = () => {},
  writeJson = writeJsonResponse,
} = {}) => {
  const adminDeleteMatch = url?.pathname?.match(/^\/api\/admin\/virtual-models\/([^/]+)$/);
  if (!adminDeleteMatch || req?.method !== 'DELETE') return false;
  if (user?.role !== 'admin') {
    writeJson(res, 403, { code: 'MODEL_PERMISSION_DENIED', message: 'Admin only.' });
    return true;
  }
  try {
    let virtualModelId;
    try {
      virtualModelId = decodeURIComponent(adminDeleteMatch[1]);
    } catch (error) {
      if (error instanceof URIError) {
        throw Object.assign(new Error('Virtual model ID is invalid.'), { code: 'MODEL_ID_INVALID' });
      }
      throw error;
    }
    const result = await deleteVirtualModel({ pool, store, virtualModelId });
    await persist();
    writeJson(res, 200, { result });
  } catch (error) {
    respondVirtualModelApiError(res, error, writeJson);
  }
  return true;
};

