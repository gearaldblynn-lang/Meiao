export const STORYBOARD_GENERATION_PROMPT_PREFIX = '图片上传为商品素材多角度图以及视频分镜图，分镜脚本为：';
export const SEEDANCE_API_MODEL_VALUE = 'bytedance/seedance-2-fast';
export const SEEDANCE_MIN_DURATION_SECONDS = 4;
export const SEEDANCE_MAX_DURATION_SECONDS = 15;

const CHINESE_SEGMENT_NUMERAL = '一二三四五六七八九十百千万两〇零';
export const SEEDANCE_SUPPORTED_VIDEO_RATIOS = new Set(['1:1', '4:3', '3:4', '16:9', '9:16', '21:9', 'adaptive']);

const cleanText = (value = '') => String(value || '').replace(/\r\n/g, '\n').trim();

export const extractStoryboardDynamicScriptText = (text = '') => {
  const source = cleanText(text);
  if (!source) return '';
  const braceMatches = [...source.matchAll(/\{([^{}]+)\}/g)]
    .map((match) => cleanText(match[1]))
    .filter(Boolean);
  if (braceMatches.length > 0) return braceMatches.join('\n');

  return source
    .split('\n')
    .map((line) => line.replace(new RegExp(`^\\s*分段[${CHINESE_SEGMENT_NUMERAL}\\d]+\\s*[：:、.\\-—]*\\s*`), '').trim())
    .filter(Boolean)
    .join('\n')
    .replace(/[{}]/g, '')
    .trim();
};

const getProjectScriptForImport = (project = {}) => {
  const boards = Array.isArray(project.boards) ? project.boards : [];
  const boardScripts = boards
    .map((board) => extractStoryboardDynamicScriptText(board?.dynamicScriptPrompt || board?.scriptText || ''))
    .filter(Boolean);
  if (boardScripts.length > 0) return boardScripts.join('\n\n');
  return extractStoryboardDynamicScriptText(project.script || '');
};

const getDurationFallbackSeconds = (duration) => {
  const seconds = Number.parseInt(String(duration || '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 5;
};

const normalizeSupportedDurationSeconds = (seconds) => {
  const value = Math.ceil(Number(seconds) || 0);
  return Math.min(Math.max(value || SEEDANCE_MIN_DURATION_SECONDS, SEEDANCE_MIN_DURATION_SECONDS), SEEDANCE_MAX_DURATION_SECONDS);
};

const parseTimeTokenSeconds = (token = '') => {
  const value = cleanText(token);
  if (!value) return 0;
  if (value.includes(':')) {
    const parts = value.split(':').map((part) => Number.parseFloat(part));
    if (parts.some((part) => !Number.isFinite(part))) return 0;
    return parts.reduce((total, part) => (total * 60) + part, 0);
  }
  const seconds = Number.parseFloat(value);
  return Number.isFinite(seconds) ? seconds : 0;
};

export const detectStoryboardSegmentSeconds = (text = '', fallbackSeconds = 5) => {
  const source = Array.isArray(text) ? text.map((value) => String(value || '')).join('\n') : String(text || '');
  const ranges = [];
  const clockRangePattern = /(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:-|~|－|—|–|到|至)\s*(\d{1,2}:\d{2}(?::\d{2})?)/g;
  for (const match of source.matchAll(clockRangePattern)) {
    const start = parseTimeTokenSeconds(match[1]);
    const end = parseTimeTokenSeconds(match[2]);
    if (end > start) ranges.push({ start, end });
  }
  const numericRangePattern = /(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*(?:-|~|－|—|–|到|至)\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?/gi;
  for (const match of source.matchAll(numericRangePattern)) {
    const start = parseTimeTokenSeconds(match[1]);
    const end = parseTimeTokenSeconds(match[2]);
    if (end > start) ranges.push({ start, end });
  }
  if (ranges.length > 0) {
    const minStart = Math.min(...ranges.map((range) => range.start));
    const maxEnd = Math.max(...ranges.map((range) => range.end));
    return Math.max(Math.ceil(maxEnd - minStart), 1);
  }

  const durationPatterns = [
    new RegExp(`(?:分镜|镜头)\\s*[${CHINESE_SEGMENT_NUMERAL}\\d]*\\s*[（(]\\s*(\\d+(?:\\.\\d+)?)\\s*(?:s|秒)\\s*[)）]`, 'gi'),
    /(?:时长|持续|耗时)\s*[：:]?\s*(\d+(?:\.\d+)?)\s*(?:s|秒)/gi,
  ];
  let durationTotal = 0;
  durationPatterns.forEach((pattern) => {
    for (const match of source.matchAll(pattern)) {
      durationTotal += Number.parseFloat(match[1]) || 0;
    }
  });
  if (durationTotal > 0) return Math.max(Math.ceil(durationTotal), 1);
  return Math.max(Math.ceil(Number(fallbackSeconds) || 5), 1);
};

export const detectStoryboardEndSeconds = (project = {}) => {
  const boards = Array.isArray(project.boards) ? project.boards : [];
  const timingText = [
    project.script,
    ...boards.flatMap((board) => [board?.title, board?.scriptText, board?.dynamicScriptPrompt]),
  ].map((value) => String(value || '')).join('\n');
  let maxSeconds = 0;
  const rangePattern = /(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*(?:-|~|－|—|到|至)\s*(\d+(?:\.\d+)?)\s*(?:s|秒)/gi;
  for (const match of timingText.matchAll(rangePattern)) {
    maxSeconds = Math.max(maxSeconds, Number.parseFloat(match[2]) || 0);
  }
  const endPattern = /(?:到|至|截至|结束于)\s*(\d+(?:\.\d+)?)\s*(?:s|秒)/gi;
  for (const match of timingText.matchAll(endPattern)) {
    maxSeconds = Math.max(maxSeconds, Number.parseFloat(match[1]) || 0);
  }
  const shotDurationPattern = /分镜\s*\d+\s*（\s*(\d+(?:\.\d+)?)\s*(?:s|秒)\s*）/gi;
  let shotDurationTotal = 0;
  for (const match of timingText.matchAll(shotDurationPattern)) {
    shotDurationTotal += Number.parseFloat(match[1]) || 0;
  }
  maxSeconds = Math.max(maxSeconds, shotDurationTotal);
  const fallback = getDurationFallbackSeconds(project?.config?.duration);
  return Math.max(Math.ceil(maxSeconds || fallback), 1);
};

const normalizeStoryboardRatio = (ratio) => {
  const value = cleanText(ratio);
  if (SEEDANCE_SUPPORTED_VIDEO_RATIOS.has(value)) return value;
  if (value === '4:5') return '3:4';
  if (value === 'portrait') return '9:16';
  if (value === 'landscape') return '16:9';
  return '9:16';
};

const getFileNameFromUrl = (url = '', fallback = '素材.png') => {
  const value = cleanText(url);
  try {
    const pathname = new URL(value).pathname;
    const name = decodeURIComponent(pathname.split('/').filter(Boolean).pop() || '');
    return name || fallback;
  } catch {
    const name = decodeURIComponent(value.split('?')[0].split('/').filter(Boolean).pop() || '');
    return name || fallback;
  }
};

const dedupeUrls = (urls = []) => {
  const seen = new Set();
  return urls
    .map((url) => cleanText(url))
    .filter((url) => {
      if (!url || seen.has(url)) return false;
      seen.add(url);
      return true;
    });
};

const resolveStoryboardBoard = (project = {}, ref = {}) => {
  const boards = Array.isArray(project.boards) ? project.boards : [];
  if (boards.length === 0) return { board: null, index: -1 };
  const boardId = cleanText(ref.boardId);
  if (boardId) {
    const idIndex = boards.findIndex((board) => cleanText(board?.id) === boardId);
    if (idIndex >= 0) return { board: boards[idIndex], index: idIndex };
  }
  const numericIndex = Number(ref.boardIndex);
  if (Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < boards.length) {
    return { board: boards[numericIndex], index: numericIndex };
  }
  return { board: boards[0], index: 0 };
};

export const buildStoryboardBoardGenerationImport = (project = {}, ref = {}) => {
  const { board, index } = resolveStoryboardBoard(project, ref);
  const boardScriptSource = board?.dynamicScriptPrompt || board?.scriptText || board?.prompt || project.script || '';
  const script = extractStoryboardDynamicScriptText(boardScriptSource);
  const prompt = `${STORYBOARD_GENERATION_PROMPT_PREFIX}\n${script}`.trim();
  const boards = Array.isArray(project.boards) ? project.boards : [];
  const projectFallback = getDurationFallbackSeconds(project?.config?.duration);
  const boardFallback = boards.length > 0 ? projectFallback / boards.length : projectFallback;
  const rawDurationSeconds = detectStoryboardSegmentSeconds([
    board?.title,
    board?.scriptText,
    board?.dynamicScriptPrompt,
    board?.prompt,
  ], boardFallback);
  const durationSeconds = normalizeSupportedDurationSeconds(rawDurationSeconds);
  const ratio = normalizeStoryboardRatio(project?.config?.aspectRatio);
  const productUrls = dedupeUrls(project?.config?.uploadedProductUrls || []);
  const storyboardUrl = cleanText(board?.imageUrl);

  return {
    prompt,
    params: {
      dreaminaMode: 'multimodal2video',
      videoMode: 'multimodal2video',
      duration: `${durationSeconds}秒`,
      modelVersion: SEEDANCE_API_MODEL_VALUE,
      videoResolution: '720p',
      ratio,
      aspectRatio: ratio,
    },
    materials: [
      ...productUrls.map((url, productIndex) => ({
        type: 'product',
        url,
        remoteUrl: url,
        fileName: getFileNameFromUrl(url, `商品素材${productIndex + 1}.png`),
      })),
      ...(storyboardUrl ? [{
        type: 'scene',
        url: storyboardUrl,
        remoteUrl: storyboardUrl,
        fileName: `${cleanText(board?.title) || `分镜${index + 1}`}.png`,
      }] : []),
    ],
  };
};

export const buildStoryboardGenerationImport = (project = {}) => {
  const script = getProjectScriptForImport(project);
  const prompt = `${STORYBOARD_GENERATION_PROMPT_PREFIX}\n${script}`.trim();
  const durationSeconds = detectStoryboardEndSeconds(project);
  const ratio = normalizeStoryboardRatio(project?.config?.aspectRatio);
  const productUrls = dedupeUrls(project?.config?.uploadedProductUrls || []);
  const boards = Array.isArray(project.boards) ? project.boards : [];
  const storyboardUrls = dedupeUrls(boards.map((board) => board?.imageUrl));

  return {
    prompt,
    params: {
      dreaminaMode: 'multimodal2video',
      videoMode: 'multimodal2video',
      duration: `${durationSeconds}秒`,
      modelVersion: SEEDANCE_API_MODEL_VALUE,
      videoResolution: '720p',
      ratio,
      aspectRatio: ratio,
    },
    materials: [
      ...productUrls.map((url, index) => ({
        type: 'product',
        url,
        remoteUrl: url,
        fileName: getFileNameFromUrl(url, `商品素材${index + 1}.png`),
      })),
      ...storyboardUrls.map((url, index) => {
        const board = boards.find((item) => cleanText(item?.imageUrl) === url);
        return {
          type: 'scene',
          url,
          remoteUrl: url,
          fileName: `${cleanText(board?.title) || `分镜${index + 1}`}.png`,
        };
      }),
    ],
  };
};
