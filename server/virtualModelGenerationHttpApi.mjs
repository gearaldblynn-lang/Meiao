const NOT_FOUND_CODES = new Set([
  'MODEL_GENERATION_BATCH_NOT_FOUND',
  'MODEL_NOT_FOUND',
]);

const REQUEST_ERROR_CODES = new Set([
  'MODEL_GENERATION_BATCH_INVALID',
  'MODEL_GENERATION_INCOMPLETE',
  'MODEL_GENERATION_RESULT_UNAVAILABLE',
  'MODEL_GENERATION_RESULT_INVALID',
  'MODEL_GENERATION_REFERENCE_INVALID',
  'MODEL_GENERATION_FINALIZE_FAILED',
  'MODEL_VERSION_IMMUTABLE',
  'MODEL_ASSET_INVALID',
  'MODEL_ASSET_UNAVAILABLE',
]);

const SAFE_ADAPTER_ERRORS = new Map([
  ['account_credit_insufficient', {
    statusCode: 402,
    message: 'Insufficient account credits.',
  }],
  ['managed_asset_forbidden', {
    statusCode: 403,
    message: 'Managed asset is unavailable.',
  }],
  ['job_submission_lock_timeout', {
    statusCode: 409,
    message: 'Matching job submission is already in progress.',
  }],
  ['MODEL_GENERATION_SUBMISSION_KEY_CONFLICT', {
    statusCode: 409,
    message: 'Submission key is already used for another target.',
  }],
]);

const writeJsonResponse = (res, statusCode, payload) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...(res.__corsHeaders || {}),
  });
  res.end(JSON.stringify(payload));
};

const decodePathPart = (value) => {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    if (error instanceof URIError) {
      throw Object.assign(
        new Error('Virtual model generation path is invalid'),
        { code: 'MODEL_GENERATION_BATCH_INVALID' },
      );
    }
    throw error;
  }
};

const respondError = (res, error, writeJson) => {
  const code = String(error?.code || '');
  const safeAdapterError = SAFE_ADAPTER_ERRORS.get(code);
  if (safeAdapterError) {
    writeJson(res, safeAdapterError.statusCode, {
      code,
      message: safeAdapterError.message,
    });
    return;
  }
  if (NOT_FOUND_CODES.has(code)) {
    writeJson(res, 404, {
      code,
      message: error?.message || 'Virtual model generation batch not found.',
    });
    return;
  }
  if (REQUEST_ERROR_CODES.has(code)) {
    writeJson(res, 400, {
      code,
      message: error?.message || 'Virtual model generation request failed.',
    });
    return;
  }
  writeJson(res, 500, {
    code: 'MODEL_GENERATION_REQUEST_FAILED',
    message: 'Virtual model generation request failed.',
  });
};

export const handleVirtualModelGenerationApiRequest = async ({
  req,
  res,
  url,
  user,
  readJson = async () => ({}),
  writeJson = writeJsonResponse,
  service,
} = {}) => {
  const createMatch = url?.pathname === '/api/admin/virtual-model-generation-batches'
    && req?.method === 'POST';
  const findMatch = url?.pathname === '/api/admin/virtual-model-generation-batches'
    && req?.method === 'GET';
  const detailMatch = url?.pathname?.match(
    /^\/api\/admin\/virtual-model-generation-batches\/([^/]+)$/,
  );
  const retryMatch = url?.pathname?.match(
    /^\/api\/admin\/virtual-model-generation-batches\/([^/]+)\/poses\/([^/]+)\/retry$/,
  );
  const regenerateDerivedMatch = url?.pathname?.match(
    /^\/api\/admin\/virtual-model-generation-batches\/([^/]+)\/regenerate-derived$/,
  );
  const cancelMatch = url?.pathname?.match(
    /^\/api\/admin\/virtual-model-generation-batches\/([^/]+)\/cancel$/,
  );
  const finalizeMatch = url?.pathname?.match(
    /^\/api\/admin\/virtual-model-generation-batches\/([^/]+)\/finalize$/,
  );
  const matched = createMatch
    || findMatch
    || (detailMatch && req?.method === 'GET')
    || (retryMatch && req?.method === 'POST')
    || (regenerateDerivedMatch && req?.method === 'POST')
    || (cancelMatch && req?.method === 'POST')
    || (finalizeMatch && req?.method === 'POST');

  if (!matched) return false;
  if (!user?.id) {
    writeJson(res, 401, {
      code: 'MODEL_AUTH_REQUIRED',
      message: 'Authentication required.',
    });
    return true;
  }
  if (user.role !== 'admin') {
    writeJson(res, 403, {
      code: 'MODEL_PERMISSION_DENIED',
      message: 'Admin only.',
    });
    return true;
  }

  try {
    if (findMatch) {
      const virtualModelId = String(url.searchParams.get('virtualModelId') || '').trim();
      const virtualModelVersionId = String(
        url.searchParams.get('virtualModelVersionId') || '',
      ).trim();
      if (!virtualModelId || !virtualModelVersionId) {
        throw Object.assign(
          new Error('Virtual model generation target is invalid'),
          { code: 'MODEL_GENERATION_BATCH_INVALID' },
        );
      }
      const batch = await service.find({
        userId: user.id,
        virtualModelId,
        virtualModelVersionId,
      });
      writeJson(res, 200, { batch });
      return true;
    }

    if (createMatch) {
      const body = await readJson(req);
      if (!String(body?.clientSubmissionKey || '').trim()) {
        throw Object.assign(
          new Error('Virtual model generation submission key is required'),
          { code: 'MODEL_GENERATION_BATCH_INVALID' },
        );
      }
      const batch = await service.create({
        ...(body && typeof body === 'object' ? body : {}),
        userId: user.id,
      });
      writeJson(res, 201, { batch });
      return true;
    }

    if (detailMatch && req.method === 'GET') {
      const batch = await service.get({
        userId: user.id,
        batchId: decodePathPart(detailMatch[1]),
      });
      writeJson(res, 200, { batch });
      return true;
    }

    if (retryMatch && req.method === 'POST') {
      await readJson(req);
      const batch = await service.retry({
        userId: user.id,
        batchId: decodePathPart(retryMatch[1]),
        poseId: decodePathPart(retryMatch[2]),
      });
      writeJson(res, 200, { batch });
      return true;
    }

    if (regenerateDerivedMatch && req.method === 'POST') {
      await readJson(req);
      const batch = await service.regenerateDerived({
        userId: user.id,
        batchId: decodePathPart(regenerateDerivedMatch[1]),
      });
      writeJson(res, 200, { batch });
      return true;
    }

    if (cancelMatch && req.method === 'POST') {
      await readJson(req);
      const batch = await service.cancel({
        userId: user.id,
        batchId: decodePathPart(cancelMatch[1]),
      });
      writeJson(res, 200, { batch });
      return true;
    }

    await readJson(req);
    const result = await service.finalize({
      userId: user.id,
      batchId: decodePathPart(finalizeMatch[1]),
    });
    writeJson(res, 200, { result });
  } catch (error) {
    respondError(res, error, writeJson);
  }
  return true;
};
