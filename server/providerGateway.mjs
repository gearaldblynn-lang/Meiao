const ARK_RESPONSES_URL = 'https://ark.cn-beijing.volces.com/api/v3/responses';
const KIE_CREATE_TASK_URL = 'https://api.kie.ai/api/v1/jobs/createTask';
const KIE_RECORD_INFO_URL = 'https://api.kie.ai/api/v1/jobs/recordInfo';
const KIE_VEO_BASE_URL = 'https://api.kie.ai/api/v1/veo';
const KIE_CHAT_URL = 'https://api.kie.ai/gpt-5-2/v1/chat/completions';
const KIE_TRANSIENT_NOT_FOUND_GRACE_MS = 45_000;

const wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener?.('abort', onAbort);
      reject(createProviderError('request_cancelled', '任务已取消'));
    };

    if (signal) {
      signal.addEventListener('abort', onAbort);
    }
  });

const createProviderError = (code, message, extras = null) => {
  const error = new Error(message);
  error.code = code;
  if (extras && typeof extras === 'object') {
    Object.assign(error, extras);
  }
  return error;
};

const attachProviderTaskId = (error, providerTaskId) => {
  if (error && typeof error === 'object' && providerTaskId && !error.providerTaskId) {
    error.providerTaskId = providerTaskId;
  }
  return error;
};

const getEnvValue = (env, ...keys) => keys.map((key) => env[key]).find(Boolean) || '';

const getProviderEnv = (env) => ({
  arkApiKey: getEnvValue(env, 'ARK_API_KEY', 'MEIAO_ARK_API_KEY'),
  kieApiKey: getEnvValue(env, 'KIE_API_KEY', 'MEIAO_KIE_API_KEY'),
});

const ensureProviderKey = (value, label) => {
  if (!value) {
    throw createProviderError('provider_auth_invalid', `${label} 未配置`);
  }
};

const buildArkInputContent = (items) =>
  items.map((item) => {
    if (item.type === 'text') {
      return { type: 'input_text', text: item.text || '' };
    }

    return { type: 'input_image', image_url: item.image_url?.url || '' };
  });

const extractArkText = (data) => {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  if (Array.isArray(data?.output)) {
    for (const outputItem of data.output) {
      const content = outputItem?.content;
      if (!Array.isArray(content)) continue;

      const text = content
        .filter((item) => item?.type?.includes('text') && typeof item.text === 'string')
        .map((item) => item.text.trim())
        .filter(Boolean)
        .join('\n')
        .trim();

      if (text) return text;
    }
  }

  if (Array.isArray(data?.choices) && data.choices[0]?.message?.content) {
    return String(data.choices[0].message.content).trim();
  }

  throw createProviderError('provider_bad_response', 'AI 未返回可解析的文本内容');
};

const extractUrlFromResponse = (result) => {
  if (!result) return null;

  if (result.data) {
    if (typeof result.data === 'string' && result.data.startsWith('http')) return result.data;
    if (typeof result.data === 'object') {
      if (result.data.fileUrl && typeof result.data.fileUrl === 'string') return result.data.fileUrl;
      if (result.data.url && typeof result.data.url === 'string') return result.data.url;
      if (result.data.downloadUrl && typeof result.data.downloadUrl === 'string') return result.data.downloadUrl;
    }
  }
  if (result.fileUrl && typeof result.fileUrl === 'string') return result.fileUrl;
  if (result.url && typeof result.url === 'string') return result.url;

  const findUrlRecursively = (obj, depth = 0) => {
    if (!obj || depth > 3) return null;

    if (typeof obj === 'string') {
      if (obj.startsWith('http://') || obj.startsWith('https://')) return obj;
      return null;
    }

    if (typeof obj === 'object') {
      for (const key in obj) {
        if (key === 'msg' || key === 'message' || key === 'error') continue;
        const found = findUrlRecursively(obj[key], depth + 1);
        if (found) return found;
      }
    }
    return null;
  };

  return findUrlRecursively(result);
};

const findVideoUrlRecursively = (data) => {
  if (!data) return null;
  if (typeof data === 'string') {
    const trimmed = data.trim();
    if (trimmed.startsWith('http')) return trimmed.split(',')[0].trim();
    return null;
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findVideoUrlRecursively(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof data === 'object') {
    const priorityKeys = ['resultUrls', 'videoUrl', 'url', 'playUrl', 'video_url', 'downloadUrl', 'uri', 'video_uri'];
    for (const key of priorityKeys) {
      if (data[key]) {
        const found = findVideoUrlRecursively(data[key]);
        if (found) return found;
      }
    }
    for (const key in data) {
      if (!priorityKeys.includes(key) && typeof data[key] === 'object') {
        const found = findVideoUrlRecursively(data[key]);
        if (found) return found;
      }
    }
  }
  return null;
};

const mapHttpError = async (response, defaultMessage) => {
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    throw createProviderError('provider_auth_invalid', data?.error?.message || data?.message || defaultMessage);
  }
  if (response.status === 400 || response.status === 404) {
    throw createProviderError('provider_bad_request', data?.error?.message || data?.message || defaultMessage);
  }
  if (response.status === 429) {
    throw createProviderError('provider_rate_limited', data?.error?.message || data?.message || defaultMessage);
  }
  if (response.status >= 500) {
    throw createProviderError('provider_internal_error', data?.error?.message || data?.message || defaultMessage);
  }
  throw createProviderError('provider_network_error', data?.error?.message || data?.message || defaultMessage);
};

const pollKieTask = async (taskId, kieApiKey, signal, isVideo = false) => {
  const maxRetries = isVideo ? 180 : 90;
  const startedAt = Date.now();

  for (let i = 0; i < maxRetries; i += 1) {
    if (signal?.aborted) {
      throw createProviderError('request_cancelled', '任务已取消');
    }

    const response = await fetch(`${KIE_RECORD_INFO_URL}?taskId=${encodeURIComponent(taskId)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${kieApiKey}`,
      },
      signal,
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 || response.status === 403 || result?.code === 401 || result?.code === 403) {
        throw createProviderError('provider_auth_invalid', result?.msg || 'Kie 鉴权失败');
      }
      if (response.status === 404 || result?.code === 404) {
        if (Date.now() - startedAt < KIE_TRANSIENT_NOT_FOUND_GRACE_MS) {
          await wait(4000, signal);
          continue;
        }
        throw createProviderError('task_not_found', result?.msg || '任务不存在或已过期', { providerTaskId: taskId });
      }
      if (response.status === 429) {
        throw createProviderError('provider_rate_limited', result?.msg || 'Kie 请求过于频繁');
      }
      if (response.status >= 500) {
        throw createProviderError('provider_internal_error', result?.msg || 'Kie 服务异常');
      }
    }

    if (result?.code === 200) {
      const state = result.data?.state;
      if (state === 'success') {
        const resultJson = JSON.parse(result.data.resultJson || '{}');
        const url = Array.isArray(resultJson.resultUrls) ? resultJson.resultUrls[0] : '';
        if (!url) {
          throw createProviderError('provider_bad_response', 'Kie 返回成功但没有结果链接');
        }
        return {
          providerTaskId: taskId,
          result: {
            imageUrl: url,
            videoUrl: isVideo ? url : undefined,
            taskId,
            status: 'success',
          },
        };
      }
      if (state === 'fail') {
        throw createProviderError('provider_bad_request', result.data?.failMsg || 'Kie 任务失败', { providerTaskId: taskId });
      }
    } else if (result?.code === 404) {
      if (Date.now() - startedAt < KIE_TRANSIENT_NOT_FOUND_GRACE_MS) {
        await wait(4000, signal);
        continue;
      }
      throw createProviderError('task_not_found', result?.msg || '任务不存在或已过期', { providerTaskId: taskId });
    } else if (result?.code === 401 || result?.code === 403) {
      throw createProviderError('provider_auth_invalid', result?.msg || 'Kie 鉴权失败');
    } else if (result?.code >= 500) {
      throw createProviderError('provider_internal_error', result?.msg || 'Kie 服务异常');
    }

    await wait(4000, signal);
  }

  throw createProviderError('provider_timeout', isVideo ? '视频合成超时' : '图像任务超时');
};

const pollKieVeoTask = async (taskId, kieApiKey, signal) => {
  for (let attempts = 0; attempts < 120; attempts += 1) {
    if (signal?.aborted) {
      throw createProviderError('request_cancelled', '任务已取消');
    }

    await wait(15000, signal);

    const response = await fetch(`${KIE_VEO_BASE_URL}/record-info?taskId=${encodeURIComponent(taskId)}`, {
      headers: {
        Authorization: `Bearer ${kieApiKey}`,
      },
      signal,
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw createProviderError('provider_auth_invalid', result?.msg || 'Veo 鉴权失败');
      }
      if (response.status === 404) {
        throw createProviderError('task_not_found', result?.msg || 'Veo 任务不存在');
      }
      if (response.status === 429) {
        throw createProviderError('provider_rate_limited', result?.msg || 'Veo 请求过于频繁');
      }
      if (response.status >= 500) {
        throw createProviderError('provider_internal_error', result?.msg || 'Veo 服务异常');
      }
    }

    if (result?.code === 200) {
      const data = result.data;
      if (data?.successFlag === 1) {
        const videoUrl = findVideoUrlRecursively(data);
        if (!videoUrl) {
          throw createProviderError('provider_bad_response', 'Veo 返回成功但没有视频地址');
        }
        return {
          providerTaskId: taskId,
          result: {
            taskId,
            videoUrl,
            status: 'success',
          },
        };
      }
      if (data?.successFlag === 2 || data?.successFlag === 3) {
        throw createProviderError('provider_bad_request', data.failReason || 'Veo 任务失败');
      }
    }
  }

  throw createProviderError('provider_timeout', 'Veo 任务超时');
};

const uploadAssetViaKie = async (payload, env) => {
  const { kieApiKey } = getProviderEnv(env);
  ensureProviderKey(kieApiKey, 'Kie API Key');

  const uploadPath = payload.uploadPath || 'mayo-storage/internal';
  const uploadFileName = payload.fileName || `upload_${Date.now()}.bin`;

  const response = await fetch('https://kieai.redpandaai.co/api/file-base64-upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${kieApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      base64Data: `data:${payload.mimeType || 'application/octet-stream'};base64,${payload.base64Data}`,
      uploadPath,
      fileName: uploadFileName,
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw createProviderError('provider_auth_invalid', result?.msg || '素材上传鉴权失败');
    }
    if (response.status === 429) {
      throw createProviderError('provider_rate_limited', result?.msg || '素材上传过于频繁');
    }
    if (response.status >= 500) {
      throw createProviderError('provider_internal_error', result?.msg || '素材上传服务异常');
    }
    throw createProviderError('provider_bad_request', result?.msg || '素材上传失败');
  }

  const fileUrl = extractUrlFromResponse(result);
  if (!fileUrl) {
    throw createProviderError('provider_bad_response', '上传成功但未返回素材地址');
  }

  return {
    result: {
      fileUrl,
    },
  };
};

export const uploadAssetViaKieStream = async (payload, env) => {
  const { kieApiKey } = getProviderEnv(env);
  ensureProviderKey(kieApiKey, 'Kie API Key');

  const formData = new FormData();
  const fileBuffer = payload.fileBuffer instanceof Uint8Array ? payload.fileBuffer : Buffer.from(payload.fileBuffer || '');
  const mimeType = payload.mimeType || 'application/octet-stream';
  const fileName = payload.fileName || `upload_${Date.now()}.bin`;
  formData.append('file', new Blob([fileBuffer], { type: mimeType }), fileName);
  formData.append('fileName', fileName);
  formData.append('uploadPath', payload.uploadPath || 'mayo-storage/internal');

  const response = await fetch('https://kieai.redpandaai.co/api/file-stream-upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${kieApiKey}`,
    },
    body: formData,
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw createProviderError('provider_auth_invalid', result?.msg || '素材上传鉴权失败');
    }
    if (response.status === 429) {
      throw createProviderError('provider_rate_limited', result?.msg || '素材上传过于频繁');
    }
    if (response.status >= 500) {
      throw createProviderError('provider_internal_error', result?.msg || '素材上传服务异常');
    }
    throw createProviderError('provider_bad_request', result?.msg || '素材上传失败');
  }

  const fileUrl = extractUrlFromResponse(result);
  if (!fileUrl) {
    throw createProviderError('provider_bad_response', '上传成功但未返回素材地址');
  }

  return {
    result: {
      fileUrl,
    },
  };
};

const runArkResponseJob = async (payload, env, signal) => {
  const { arkApiKey } = getProviderEnv(env);
  ensureProviderKey(arkApiKey, 'Ark API Key');

  const response = await fetch(ARK_RESPONSES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${arkApiKey}`,
    },
    body: JSON.stringify({
      model: payload.model || 'doubao-seed-2-0-lite-260215',
      input: [
        {
          role: 'user',
          content: buildArkInputContent(payload.inputContent || []),
        },
      ],
    }),
    signal,
  });

  if (!response.ok) {
    await mapHttpError(response, 'Ark 请求失败');
  }

  const data = await response.json();
  return {
    result: {
      text: extractArkText(data),
    },
  };
};

const runKieImageJob = async (payload, env, signal) => {
  const { kieApiKey } = getProviderEnv(env);
  ensureProviderKey(kieApiKey, 'Kie API Key');

  const response = await fetch(KIE_CREATE_TASK_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${kieApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: payload.model || 'nano-banana-2',
      input: {
        prompt: payload.prompt,
        image_input: payload.imageUrls,
        aspect_ratio: payload.aspectRatio || 'auto',
        resolution: payload.resolution || '1K',
        output_format: 'png',
      },
    }),
    signal,
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.code !== 200 || !result?.data?.taskId) {
    if (response.status === 401 || response.status === 403 || result?.code === 401 || result?.code === 403) {
      throw createProviderError('provider_auth_invalid', result?.msg || 'Kie 图像任务鉴权失败');
    }
    if (response.status === 429) {
      throw createProviderError('provider_rate_limited', result?.msg || 'Kie 图像任务请求过于频繁');
    }
    if (response.status >= 500 || result?.code >= 500) {
      throw createProviderError('provider_internal_error', result?.msg || 'Kie 图像任务服务异常');
    }
    throw createProviderError('provider_bad_request', result?.msg || 'Kie 图像任务创建失败');
  }

  try {
    return await pollKieTask(result.data.taskId, kieApiKey, signal, false);
  } catch (error) {
    throw attachProviderTaskId(error, result.data.taskId);
  }
};

const runKieRecoverJob = async (payload, env, signal) => {
  const { kieApiKey } = getProviderEnv(env);
  ensureProviderKey(kieApiKey, 'Kie API Key');
  const providerTaskId = payload.providerTaskId || payload.taskId;
  try {
    return await pollKieTask(providerTaskId, kieApiKey, signal, Boolean(payload.isVideo));
  } catch (error) {
    throw attachProviderTaskId(error, providerTaskId);
  }
};

const runKieVideoJob = async (payload, env, signal) => {
  const { kieApiKey } = getProviderEnv(env);
  ensureProviderKey(kieApiKey, 'Kie API Key');

  const targetImageUrls = Array.isArray(payload.imageUrls) ? payload.imageUrls.slice(0, 1) : [];
  const input = {
    n_frames: Number.parseInt(String(payload.videoConfig?.duration || '15'), 10),
    image_urls: targetImageUrls,
    aspect_ratio: payload.videoConfig?.aspectRatio === 'landscape' ? '16:9' : '9:16',
  };

  if (payload.videoConfig?.promptMode === 'manual' && Array.isArray(payload.videoConfig?.scenes) && payload.videoConfig.scenes.length > 0) {
    input.scenes = payload.videoConfig.scenes.map((scene) => ({
      Scene: scene.Scene,
      duration: Number(scene.duration),
    }));
  } else {
    input.prompt = payload.videoConfig?.script || 'Professional commercial product advertisement, cinematic lighting.';
  }

  const response = await fetch(KIE_CREATE_TASK_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${kieApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sora-2-pro-storyboard',
      input,
    }),
    signal,
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.code !== 200 || !result?.data?.taskId) {
    if (response.status === 401 || response.status === 403 || result?.code === 401 || result?.code === 403) {
      throw createProviderError('provider_auth_invalid', result?.msg || 'Kie 视频任务鉴权失败');
    }
    if (response.status === 429) {
      throw createProviderError('provider_rate_limited', result?.msg || 'Kie 视频任务请求过于频繁');
    }
    if (response.status >= 500 || result?.code >= 500) {
      throw createProviderError('provider_internal_error', result?.msg || 'Kie 视频任务服务异常');
    }
    throw createProviderError('provider_bad_request', result?.msg || 'Kie 视频任务创建失败');
  }

  try {
    return await pollKieTask(result.data.taskId, kieApiKey, signal, true);
  } catch (error) {
    throw attachProviderTaskId(error, result.data.taskId);
  }
};

const runKieVeoJob = async (payload, env, signal) => {
  const { kieApiKey } = getProviderEnv(env);
  ensureProviderKey(kieApiKey, 'Kie API Key');

  const fullPrompt = `视频内容描述：${payload.script?.description || ''}；人声口播：${payload.script?.spokenContent || ''}；背景音乐：${payload.script?.bgm || ''}`.trim();
  let endpoint = `${KIE_VEO_BASE_URL}/generate`;
  let requestPayload = {
    prompt: fullPrompt,
    model: 'veo3_fast',
    aspect_ratio: payload.aspectRatio === '9:16' ? '9:16' : '16:9',
  };

  if (payload.previousTaskId) {
    endpoint = `${KIE_VEO_BASE_URL}/extend`;
    requestPayload = {
      taskId: payload.previousTaskId,
      prompt: fullPrompt,
    };
  } else if (Array.isArray(payload.imageUrls) && payload.imageUrls.length > 0) {
    requestPayload.generationType = 'REFERENCE_2_VIDEO';
    requestPayload.imageUrls = payload.imageUrls;
  } else {
    requestPayload.generationType = 'TEXT_2_VIDEO';
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${kieApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestPayload),
    signal,
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.code !== 200 || !result?.data?.taskId) {
    if (response.status === 401 || response.status === 403 || result?.code === 401 || result?.code === 403) {
      throw createProviderError('provider_auth_invalid', result?.msg || 'Kie Veo 鉴权失败');
    }
    if (response.status === 429) {
      throw createProviderError('provider_rate_limited', result?.msg || 'Kie Veo 请求过于频繁');
    }
    if (response.status >= 500 || result?.code >= 500) {
      throw createProviderError('provider_internal_error', result?.msg || 'Kie Veo 服务异常');
    }
    throw createProviderError('provider_bad_request', result?.msg || 'Kie Veo 任务创建失败');
  }

  try {
    return await pollKieVeoTask(result.data.taskId, kieApiKey, signal);
  } catch (error) {
    throw attachProviderTaskId(error, result.data.taskId);
  }
};

const runKieChatJob = async (payload, env, signal) => {
  const { kieApiKey } = getProviderEnv(env);
  ensureProviderKey(kieApiKey, 'Kie API Key');

  const response = await fetch(KIE_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${kieApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: payload.messages,
      stream: false,
    }),
    signal,
  });

  if (!response.ok) {
    await mapHttpError(response, 'Kie 对话请求失败');
  }

  const data = await response.json().catch(() => ({}));
  const content =
    data?.choices?.[0]?.message?.content ||
    data?.content ||
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    '';

  if (!content) {
    throw createProviderError('provider_bad_response', 'Kie 对话返回为空');
  }

  return {
    result: {
      content,
    },
  };
};

export const executeProviderJob = async (job, env, signal) => {
  switch (job.taskType) {
    case 'upload_asset':
      if (job.payload?.fileBuffer) {
        return uploadAssetViaKieStream(job.payload, env);
      }
      return uploadAssetViaKie(job.payload, env);
    case 'ark_response':
      return runArkResponseJob(job.payload, env, signal);
    case 'kie_image':
      return runKieImageJob(job.payload, env, signal);
    case 'kie_recover':
      return runKieRecoverJob(job.payload, env, signal);
    case 'kie_video':
      return runKieVideoJob(job.payload, env, signal);
    case 'kie_veo':
      return runKieVeoJob(job.payload, env, signal);
    case 'kie_chat':
      return runKieChatJob(job.payload, env, signal);
    default:
      throw createProviderError('provider_bad_request', `不支持的任务类型：${job.taskType}`);
  }
};

export const getProviderConfigStatus = (env) => {
  const providerEnv = getProviderEnv(env);
  return {
    ark: Boolean(providerEnv.arkApiKey),
    kie: Boolean(providerEnv.kieApiKey),
  };
};
