const SUPPORTED_PLATFORMS = new Set(['tiktok', 'douyin']);
const MAX_FLATTEN_DEPTH = 20;
const MAX_FLATTEN_PATHS = 500;

const createIdleReport = () => ({
  status: 'idle',
  summary: '',
  evidence: [],
  inferences: [],
  actions: [],
});

const createErrorResult = ({ message, missingCriticalFields = [] }) => ({
  probe: {
    status: 'error',
    sources: [],
    fields: [],
    raw: null,
    normalized: null,
    missingCriticalFields,
    error: message,
    completedAt: Date.now(),
  },
  report: createIdleReport(),
});

export const extractTikTokVideoIdFromUrl = (url) => {
  return String(url || '').match(/\/video\/(\d+)/)?.[1] ?? '';
};

export const extractDouyinVideoIdFromUrl = (url) => {
  return String(url || '').match(/\/video\/(\d+)/)?.[1] ?? '';
};

export const flattenFieldPaths = (value, prefix = '', result = [], context = null, depth = 0) => {
  if (!context) {
    context = { seen: new WeakSet(), pathCount: 0 };
  }

  if (context.pathCount >= MAX_FLATTEN_PATHS || depth > MAX_FLATTEN_DEPTH) {
    return result;
  }

  if (value === null || value === undefined) {
    return result;
  }

  if (typeof value === 'object') {
    if (context.seen.has(value)) {
      return result;
    }
    context.seen.add(value);
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (context.pathCount >= MAX_FLATTEN_PATHS) {
        return;
      }
      const nextPath = `${prefix}[${index}]`;
      result.push(nextPath);
      context.pathCount += 1;
      if (depth < MAX_FLATTEN_DEPTH) {
        flattenFieldPaths(item, nextPath, result, context, depth + 1);
      }
    });
    return result;
  }

  if (typeof value === 'object') {
    Object.keys(value).forEach((key) => {
      if (context.pathCount >= MAX_FLATTEN_PATHS) {
        return;
      }
      const nextPath = prefix ? `${prefix}.${key}` : key;
      result.push(nextPath);
      context.pathCount += 1;
      if (depth < MAX_FLATTEN_DEPTH) {
        flattenFieldPaths(value[key], nextPath, result, context, depth + 1);
      }
    });
  }

  return result;
};

export const buildDiagnosisReport = ({ platform, normalized, missingCriticalFields }) => {
  const missing = Array.isArray(missingCriticalFields) ? missingCriticalFields : [];
  const playCount = Number(normalized?.video?.playCount ?? 0);
  const evidence = [
    {
      label: '播放量',
      source: platform === 'tiktok' ? 'tiktok/video-by-url-v2' : 'douyin/video-info',
      fieldPath: 'statistics.play_count',
      value: String(playCount),
    },
  ];

  const inferences = missing.length
    ? [
        {
          title: '缺少直接风险字段',
          level: 'warning',
          summary: `当前缺少 ${missing.join(', ')}，以下判断不代表平台后台真值。`,
        },
      ]
    : [];

  return {
    summary: `当前视频已获取基础字段，播放量为 ${playCount}。`,
    evidence,
    inferences,
    actions: [
      {
        title: '继续补齐评论和近期作品样本',
        detail: '优先检查评论样本与账号近期作品，增强诊断可信度。',
      },
    ],
  };
};

const pickPrimaryVideoDetail = (rawVideo) => {
  if (rawVideo?.data && typeof rawVideo.data === 'object' && !Array.isArray(rawVideo.data) && rawVideo.data.statistics) {
    return rawVideo.data;
  }

  if (Array.isArray(rawVideo?.data?.aweme_details) && rawVideo.data.aweme_details[0]) {
    return rawVideo.data.aweme_details[0];
  }

  if (rawVideo?.aweme_detail && typeof rawVideo.aweme_detail === 'object') {
    return rawVideo.aweme_detail;
  }

  return null;
};

export const createVideoDiagnosisProbe = ({ spiderFetch }) => async ({ platform, url, analysisItems }) => {
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    return createErrorResult({
      message: `不支持的平台 ${platform}`,
      missingCriticalFields: ['platform'],
    });
  }

  const videoId =
    platform === 'tiktok' ? extractTikTokVideoIdFromUrl(url) : extractDouyinVideoIdFromUrl(url);

  if (!videoId) {
    return createErrorResult({
      message: '无法从链接中解析视频 ID',
      missingCriticalFields: ['video.id'],
    });
  }

  let rawVideo;

  try {
    rawVideo = await spiderFetch({ platform, source: 'video', videoId, url, analysisItems });
  } catch (error) {
    return createErrorResult({
      message: error instanceof Error ? error.message : '抓取数据失败',
      missingCriticalFields: ['platform.review_status'],
    });
  }

  const fields = flattenFieldPaths(rawVideo);
  const videoDetail = pickPrimaryVideoDetail(rawVideo);
  const normalized = {
    video: {
      id: videoId,
      desc: videoDetail?.desc ?? '',
      playCount: videoDetail?.statistics?.play_count ?? 0,
      diggCount: videoDetail?.statistics?.digg_count ?? 0,
      commentCount: videoDetail?.statistics?.comment_count ?? 0,
    },
    author: {
      nickname: videoDetail?.author?.nickname ?? '',
    },
    platformSignals: {
      hasDirectRiskField:
        fields.includes('data.review_status') ||
        fields.includes('data.aweme_details[0].review_status') ||
        fields.includes('aweme_detail.review_status'),
    },
  };

  const missingCriticalFields = normalized.platformSignals.hasDirectRiskField
    ? []
    : ['platform.review_status'];

  return {
    probe: {
      status: 'success',
      sources: [{ key: 'video', status: 'success', summary: '已获取视频详情' }],
      fields,
      raw: { video: rawVideo },
      normalized,
      missingCriticalFields,
      error: '',
      completedAt: Date.now(),
    },
    report: {
      status: 'ready',
      ...buildDiagnosisReport({ platform, normalized, missingCriticalFields }),
    },
  };
};
