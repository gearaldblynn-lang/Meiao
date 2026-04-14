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

// 从 video-by-url-v2 响应中提取视频详情对象
const pickVideoDetail = (rawVideo) => {
  // video-by-url-v2: data.aweme_details[0]
  if (Array.isArray(rawVideo?.data?.aweme_details) && rawVideo.data.aweme_details[0]) {
    return rawVideo.data.aweme_details[0];
  }
  // 其他格式兼容
  if (rawVideo?.data && typeof rawVideo.data === 'object' && rawVideo.data.statistics) {
    return rawVideo.data;
  }
  if (rawVideo?.aweme_detail && typeof rawVideo.aweme_detail === 'object') {
    return rawVideo.aweme_detail;
  }
  return null;
};

// 构建结构化的诊断数据，供 AI 分析使用
export const buildNormalizedDiagData = (detail) => {
  if (!detail) return null;

  const stats = detail.statistics || {};
  const author = detail.author || {};
  const status = detail.status || {};
  const reviewResult = status.review_result || {};
  const music = detail.added_sound_music_info || detail.music || {};
  const commerceInfo = detail.commerce_info || {};
  const aigcInfo = detail.aigc_info || {};
  const riskInfos = detail.risk_infos || {};
  const creationInfo = detail.creation_info || {};

  return {
    // 视频基础
    video: {
      awemeId: detail.aweme_id || '',
      desc: detail.desc || '',
      createTime: detail.create_time || 0,
      region: detail.region || '',
      distributeType: detail.distribute_type,
      contentOriginalType: detail.content_original_type,
      contentLevel: detail.content_level,
      descLanguage: detail.desc_language || '',
    },
    // 互动数据
    statistics: {
      playCount: stats.play_count || 0,
      diggCount: stats.digg_count || 0,
      commentCount: stats.comment_count || 0,
      shareCount: stats.share_count || 0,
      collectCount: stats.collect_count || 0,
      repostCount: stats.repost_count || 0,
    },
    // 作者信息
    author: {
      nickname: author.nickname || '',
      uniqueId: author.unique_id || '',
      followerCount: author.follower_count || 0,
      followingCount: author.following_count || 0,
      totalFavorited: author.total_favorited || 0,
      awemeCount: author.aweme_count || 0,
      region: author.region || '',
      sellerInfo: author.seller_info || null,
      solariaProfile: author.solaria_profile || null,
    },
    // 平台审核状态
    platformStatus: {
      isProhibited: status.is_prohibited ?? null,
      privateStatus: status.private_status ?? null,
      reviewStatus: reviewResult.review_status ?? null,
      inReviewing: status.in_reviewing ?? null,
      isDelete: status.is_delete ?? null,
      allowComment: status.allow_comment ?? null,
      allowShare: status.allow_share ?? null,
      downloadStatus: status.download_status ?? null,
    },
    // 原创性信号
    originality: {
      contentOriginalType: detail.content_original_type ?? null,
      createdByAi: aigcInfo.aigc_label_type !== undefined ? aigcInfo.aigc_label_type : null,
      aigcLabelType: aigcInfo.aigc_label_type ?? null,
      musicIsOriginal: music.is_original ?? null,
      musicId: music.id ? String(music.id) : '',
      musicMid: music.mid || '',
      musicAuthor: music.author || '',
      musicTitle: music.title || '',
      creationFunctions: creationInfo.creation_used_functions || [],
    },
    // 商业化信号
    commerce: {
      hasPromoteEntry: detail.has_promote_entry ?? null,
      isAds: detail.is_ads ?? null,
      isPaidContent: detail.is_paid_content ?? null,
      advPromotable: commerceInfo.adv_promotable ?? null,
      auctionAdInvited: commerceInfo.auction_ad_invited ?? null,
      brandedContentType: commerceInfo.branded_content_type ?? null,
      isDiversionAd: commerceInfo.is_diversion_ad ?? null,
    },
    // 风险信号
    risk: {
      riskSink: riskInfos.risk_sink ?? null,
      riskType: riskInfos.type ?? null,
      riskContent: riskInfos.content || '',
      videoLabels: detail.video_labels || [],
      coverLabels: detail.cover_labels || [],
      vidProfileLabels: detail.vid_profile_labels || null,
    },
    // 算法标签
    algo: {
      solariaProfile: detail.solaria_profile || null,
      suggestWords: detail.suggest_words || null,
      smartSearchInfo: detail.smart_search_info || null,
    },
  };
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
  const videoDetail = pickVideoDetail(rawVideo);
  const normalizedDiag = buildNormalizedDiagData(videoDetail);

  // 兼容旧格式
  const normalized = {
    video: {
      id: videoId,
      desc: videoDetail?.desc ?? '',
      playCount: normalizedDiag?.statistics?.playCount ?? 0,
      diggCount: normalizedDiag?.statistics?.diggCount ?? 0,
      commentCount: normalizedDiag?.statistics?.commentCount ?? 0,
    },
    author: {
      nickname: videoDetail?.author?.nickname ?? '',
    },
    platformSignals: {
      hasDirectRiskField: normalizedDiag?.platformStatus?.reviewStatus !== null,
    },
    // 完整结构化数据
    diag: normalizedDiag,
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
