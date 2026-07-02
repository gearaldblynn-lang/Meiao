import { executeProviderJob } from '../providerGateway.mjs';

const clean = (value, max = 5000) => String(value ?? '').trim().slice(0, max);
const list = (value) => (Array.isArray(value) ? value : []);

const DEFAULT_IMAGE_MODEL = 'gpt-image-2';
const DEFAULT_VIDEO_MODEL = 'veo3_fast';

const normalizeImageUrls = (...values) => Array.from(new Set(
  values.flatMap((value) => list(value)).map((item) => clean(item, 2000)).filter(Boolean),
));

const normalizeAspectRatio = (value = '', fallback = 'auto') => {
  const normalized = clean(value, 20);
  return ['auto', '1:1', '4:3', '3:4', '4:5', '16:9', '9:16'].includes(normalized) ? normalized : fallback;
};

const normalizeVideoAspectRatio = (value = '') => {
  const normalized = clean(value, 20);
  return ['16:9', '9:16', '1:1'].includes(normalized) ? normalized : '16:9';
};

const normalizeDuration = (value, fallback = 5) => {
  const parsed = Number.parseInt(String(value ?? '').replace('秒', '').trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(4, Math.min(15, parsed));
};

const getToolModel = (tool = {}, fallback = '') => clean(tool.model || tool.modelName || fallback, 160) || fallback;
const getToolProvider = (tool = {}, fallback = 'kie') => clean(tool.modelProvider || tool.model_provider || tool.provider || fallback, 120) || fallback;

const pickVideoTaskType = (model = '') => {
  const normalized = clean(model).toLowerCase();
  if (normalized.includes('seedance')) return 'kie_seedance_video';
  if (normalized.includes('veo')) return 'kie_veo';
  return 'kie_video';
};

const extractResultUrl = (result = {}, kind = 'image') => {
  const payload = result?.result && typeof result.result === 'object' ? result.result : {};
  return clean(
    kind === 'video'
      ? (payload.videoUrl || result.videoUrl || payload.resultUrl || result.resultUrl)
      : (payload.imageUrl || result.imageUrl || payload.resultUrl || result.resultUrl),
    2000,
  );
};

const toToolMessages = ({ kind, provider, model, result }) => {
  const resultUrl = extractResultUrl(result, kind);
  const payload = result?.result && typeof result.result === 'object' ? result.result : {};
  const taskId = clean(result?.providerTaskId || payload.providerTaskId || payload.taskId || result?.taskId, 200);
  const status = clean(payload.status || result?.status || (resultUrl ? 'success' : 'submitted'), 80);
  return [
    ...(resultUrl ? [{ type: 'link', message: { text: resultUrl } }] : []),
    {
      type: 'json',
      message: {
        json_object: {
          kind,
          provider,
          model,
          status,
          ...(taskId ? { taskId } : {}),
          ...(resultUrl ? { url: resultUrl } : {}),
        },
      },
    },
  ];
};

export const runBuiltinMediaTool = async ({
  executorRef = '',
  args = {},
  tool = {},
  env = process.env,
  signal,
  executeProvider = executeProviderJob,
} = {}) => {
  const ref = clean(executorRef || tool.executorRef || tool.executor_ref, 200);
  if (ref === 'media.generate_image') {
    const prompt = clean(args.prompt || args.input || args.description, 8000);
    if (!prompt) throw new Error('generate_image requires prompt');
    const model = getToolModel(tool, DEFAULT_IMAGE_MODEL);
    const provider = getToolProvider(tool, 'kie');
    const result = await executeProvider({
      taskType: 'kie_image',
      provider,
      payload: {
        prompt,
        model,
        imageUrls: normalizeImageUrls(args.input_image_urls, args.image_urls, args.reference_images),
        aspectRatio: normalizeAspectRatio(args.aspect_ratio || args.aspectRatio, 'auto'),
        resolution: clean(args.resolution || args.quality || '1K', 40),
        requestId: `smart-factory-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      },
    }, env, signal);
    return toToolMessages({ kind: 'image', provider, model, result });
  }

  if (ref === 'media.generate_video') {
    const prompt = clean(args.prompt || args.script || args.description || args.input, 12000);
    if (!prompt) throw new Error('generate_video requires prompt');
    const model = getToolModel(tool, DEFAULT_VIDEO_MODEL);
    const provider = getToolProvider(tool, 'kie');
    const aspectRatio = normalizeVideoAspectRatio(args.aspect_ratio || args.aspectRatio);
    const imageUrls = normalizeImageUrls(args.image_urls, args.input_image_urls, args.reference_images);
    const taskType = pickVideoTaskType(model);
    const duration = normalizeDuration(args.duration, model.includes('sora') ? 15 : 5);
    const payload = taskType === 'kie_veo'
      ? {
          script: {
            description: prompt,
            spokenContent: clean(args.spoken_content || args.spokenContent || '', 3000),
            bgm: clean(args.bgm || '', 1000),
          },
          aspectRatio,
          imageUrls,
          previousTaskId: clean(args.previous_task_id || args.previousTaskId, 200) || undefined,
          requestId: `smart-factory-video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        }
      : taskType === 'kie_seedance_video'
        ? {
            prompt,
            imageUrls,
            duration,
            aspectRatio,
            resolution: clean(args.resolution || '720p', 40),
            generateAudio: args.generate_audio ?? args.generateAudio ?? true,
            requestId: `smart-factory-video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          }
        : {
            imageUrls,
            videoConfig: {
              duration,
              aspectRatio: aspectRatio === '16:9' ? 'landscape' : 'portrait',
              promptMode: 'auto',
              script: prompt,
            },
            requestId: `smart-factory-video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          };
    const result = await executeProvider({ taskType, provider, payload }, env, signal);
    return toToolMessages({ kind: 'video', provider, model, result });
  }

  throw new Error(`Unknown Smart Factory builtin executor: ${ref}`);
};

export const createBuiltinMediaToolExecutors = (tools = []) => Object.fromEntries(
  list(tools)
    .filter((tool) => tool?.enabled !== false && clean(tool?.name) && clean(tool?.type) === 'builtin')
    .map((tool) => [
      clean(tool.name),
      ({ args, env, context }) => runBuiltinMediaTool({
        executorRef: tool.executorRef || tool.executor_ref,
        args,
        tool,
        env,
        signal: context?.signal,
      }),
    ]),
);
