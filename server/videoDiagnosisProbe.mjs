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
  if (!context) context = { seen: new WeakSet(), pathCount: 0 };
  if (context.pathCount >= MAX_FLATTEN_PATHS || depth > MAX_FLATTEN_DEPTH) return result;
  if (value === null || value === undefined) return result;
  if (typeof value === 'object') {
    if (context.seen.has(value)) return result;
    context.seen.add(value);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (context.pathCount >= MAX_FLATTEN_PATHS) return;
      const nextPath = `${prefix}[${index}]`;
      result.push(nextPath);
      context.pathCount += 1;
      if (depth < MAX_FLATTEN_DEPTH) flattenFieldPaths(item, nextPath, result, context, depth + 1);
    });
    return result;
  }
  if (typeof value === 'object') {
    Object.keys(value).forEach((key) => {
      if (context.pathCount >= MAX_FLATTEN_PATHS) return;
      const nextPath = prefix ? `${prefix}.${key}` : key;
      result.push(nextPath);
      context.pathCount += 1;
      if (depth < MAX_FLATTEN_DEPTH) flattenFieldPaths(value[key], nextPath, result, context, depth + 1);
    });
  }
  return result;
};

// 从 video-by-url-v2 / video-info 响应中提取视频详情对象
const pickVideoDetail = (rawVideo) => {
  if (Array.isArray(rawVideo?.data?.aweme_details) && rawVideo.data.aweme_details[0]) {
    return rawVideo.data.aweme_details[0];
  }
  if (rawVideo?.data && typeof rawVideo.data === 'object' && rawVideo.data.statistics) {
    return rawVideo.data;
  }
  if (rawVideo?.aweme_detail && typeof rawVideo.aweme_detail === 'object') {
    return rawVideo.aweme_detail;
  }
  return null;
};

// 安全执行，失败返回 null 而不是抛出
const safeCall = async (fn) => {
  try { return await fn(); } catch { return null; }
};

// 构建结构化诊断数据
export const buildNormalizedDiagData = ({ detail, profileData, recentPosts, comments, musicData }) => {
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

  // 近期作品统计
  const recentPostsStats = (() => {
    if (!Array.isArray(recentPosts) || recentPosts.length === 0) return null;
    const plays = recentPosts.map(p => Number(p.statistics?.play_count || 0));
    const diggs = recentPosts.map(p => Number(p.statistics?.digg_count || 0));
    const avgPlay = Math.round(plays.reduce((a, b) => a + b, 0) / plays.length);
    const maxPlay = Math.max(...plays);
    const minPlay = Math.min(...plays);
    return {
      count: recentPosts.length,
      avgPlayCount: avgPlay,
      maxPlayCount: maxPlay,
      minPlayCount: minPlay,
      playList: plays,
      diggList: diggs,
      createTimes: recentPosts.map(p => p.create_time || 0),
    };
  })();

  // 评论质量分析
  const commentStats = (() => {
    if (!Array.isArray(comments) || comments.length === 0) return null;
    const total = comments.length;
    const withReplies = comments.filter(c => (c.reply_comment_total || 0) > 0).length;
    const avgDigg = Math.round(comments.reduce((a, c) => a + (c.digg_count || 0), 0) / total);
    const sampleTexts = comments.slice(0, 5).map(c => c.text || '').filter(Boolean);
    return { total, withReplies, avgDigg, sampleTexts };
  })();

  // 音乐信息
  const musicStats = (() => {
    const src = musicData?.data?.music_info || musicData?.data || null;
    if (!src) return null;
    return {
      id: src.id ? String(src.id) : '',
      mid: src.mid || '',
      title: src.title || '',
      author: src.author || '',
      userCount: src.user_count || 0,
      isOriginal: src.is_original ?? null,
      status: src.status ?? null,
      duration: src.duration || 0,
    };
  })();

  // 账号完整画像（优先用独立接口数据，fallback 到视频内嵌的 author 字段）
  const profileStats = (() => {
    const p = profileData?.data?.user || profileData?.data || null;
    const src = p || author;
    return {
      nickname: src.nickname || '',
      uniqueId: src.unique_id || src.sec_uid || '',
      followerCount: src.follower_count || 0,
      followingCount: src.following_count || 0,
      totalFavorited: src.total_favorited || 0,
      awemeCount: src.aweme_count || 0,
      region: src.region || '',
      withCommerceEntry: src.with_commerce_entry ?? null,
      commerceUserInfo: src.commerce_user_info || null,
      sellerInfo: src.seller_info || null,
      fromIndependentFetch: Boolean(p),
    };
  })();

  return {
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
    statistics: {
      playCount: stats.play_count || 0,
      diggCount: stats.digg_count || 0,
      commentCount: stats.comment_count || 0,
      shareCount: stats.share_count || 0,
      collectCount: stats.collect_count || 0,
      repostCount: stats.repost_count || 0,
    },
    author: profileStats,
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
    originality: {
      contentOriginalType: detail.content_original_type ?? null,
      aigcLabelType: aigcInfo.aigc_label_type ?? null,
      createdByAi: aigcInfo.created_by_ai ?? null,
      musicIsOriginal: music.is_original ?? null,
      musicId: music.id ? String(music.id) : '',
      musicMid: music.mid || '',
      musicAuthor: music.author || '',
      musicTitle: music.title || '',
      creationFunctions: creationInfo.creation_used_functions || [],
    },
    commerce: {
      hasPromoteEntry: detail.has_promote_entry ?? null,
      isAds: detail.is_ads ?? null,
      isPaidContent: detail.is_paid_content ?? null,
      advPromotable: commerceInfo.adv_promotable ?? null,
      auctionAdInvited: commerceInfo.auction_ad_invited ?? null,
      brandedContentType: commerceInfo.branded_content_type ?? null,
      isDiversionAd: commerceInfo.is_diversion_ad ?? null,
    },
    risk: {
      riskSink: riskInfos.risk_sink ?? null,
      riskType: riskInfos.type ?? null,
      riskContent: riskInfos.content || '',
      videoLabels: detail.video_labels || [],
      coverLabels: detail.cover_labels || [],
      vidProfileLabels: detail.vid_profile_labels || null,
    },
    algo: {
      solariaProfile: detail.solaria_profile || null,
      suggestWords: detail.suggest_words || null,
    },
    // 新增：多接口补充数据
    recentPosts: recentPostsStats,
    commentQuality: commentStats,
    musicDetail: musicStats,
  };
};

export const buildDiagnosisReport = ({ platform, normalized, missingCriticalFields }) => {
  const missing = Array.isArray(missingCriticalFields) ? missingCriticalFields : [];
  const playCount = Number(normalized?.statistics?.playCount ?? 0);
  const evidence = [
    {
      label: '播放量',
      source: platform === 'tiktok' ? 'tiktok/video-by-url-v2' : 'douyin/video-info',
      fieldPath: 'statistics.play_count',
      value: String(playCount),
    },
  ];
  const inferences = missing.length
    ? [{ title: '缺少直接风险字段', level: 'warning', summary: `当前缺少 ${missing.join(', ')}，以下判断不代表平台后台真值。` }]
    : [];
  return {
    summary: `当前视频已获取基础字段，播放量为 ${playCount}。`,
    evidence,
    inferences,
    actions: [{ title: '继续补齐评论和近期作品样本', detail: '优先检查评论样本与账号近期作品，增强诊断可信度。' }],
  };
};

// TikTok 多接口并发抓取
const fetchTikTokAllSources = async (spiderFetch, { videoId, url }) => {
  const videoRaw = await spiderFetch({ platform: 'tiktok', source: 'video', videoId, url });
  const detail = pickVideoDetail(videoRaw);
  const uniqueId = detail?.author?.unique_id || '';
  const musicMid = (detail?.added_sound_music_info?.mid || detail?.music?.mid || '');

  const [profileRaw, postsRaw, commentsRaw, musicRaw] = await Promise.all([
    uniqueId ? safeCall(() => spiderFetch({ platform: 'tiktok', source: 'user_profile', uniqueId })) : null,
    uniqueId ? safeCall(() => spiderFetch({ platform: 'tiktok', source: 'user_posts', uniqueId })) : null,
    safeCall(() => spiderFetch({ platform: 'tiktok', source: 'video_comments', videoId })),
    musicMid ? safeCall(() => spiderFetch({ platform: 'tiktok', source: 'music_detail', musicId: musicMid })) : null,
  ]);

  const recentPosts = postsRaw?.data?.aweme_list || [];
  const comments = commentsRaw?.data?.comments || [];

  return { videoRaw, detail, profileRaw, recentPosts, comments, musicRaw };
};

// 抖音多接口并发抓取
const fetchDouyinAllSources = async (spiderFetch, { videoId, url }) => {
  const videoRaw = await spiderFetch({ platform: 'douyin', source: 'video', videoId, url });
  const detail = pickVideoDetail(videoRaw);
  const secUid = detail?.author?.sec_uid || '';

  const [profileRaw, postsRaw] = await Promise.all([
    secUid ? safeCall(() => spiderFetch({ platform: 'douyin', source: 'user_info', secUid })) : null,
    secUid ? safeCall(() => spiderFetch({ platform: 'douyin', source: 'video_list', secUid })) : null,
  ]);

  // 抖音 video-list 数据在 data.videos
  const recentPosts = postsRaw?.data?.videos || postsRaw?.data?.aweme_list || [];

  return { videoRaw, detail, profileRaw, recentPosts, comments: [], musicRaw: null };
};

export const createVideoDiagnosisProbe = ({ spiderFetch }) => async ({ platform, url, analysisItems }) => {
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    return createErrorResult({ message: `不支持的平台 ${platform}`, missingCriticalFields: ['platform'] });
  }

  const videoId = platform === 'tiktok'
    ? extractTikTokVideoIdFromUrl(url)
    : extractDouyinVideoIdFromUrl(url);

  // videoId 可能为空（短链接），Spider API 的 share_url 字段本身支持短链接，继续执行

  let sources;
  try {
    sources = platform === 'tiktok'
      ? await fetchTikTokAllSources(spiderFetch, { videoId, url })
      : await fetchDouyinAllSources(spiderFetch, { videoId, url });
  } catch (error) {
    return createErrorResult({
      message: error instanceof Error ? error.message : '抓取数据失败',
      missingCriticalFields: ['platform.review_status'],
    });
  }

  const { videoRaw, detail, profileRaw, recentPosts, comments, musicRaw } = sources;

  if (!detail) {
    return createErrorResult({ message: '视频不存在或链接无效，请检查链接后重试', missingCriticalFields: ['video.detail'] });
  }

  const fields = flattenFieldPaths(videoRaw);
  const normalizedDiag = buildNormalizedDiagData({ detail, profileData: profileRaw, recentPosts, comments, musicData: musicRaw });

  const normalized = {
    video: {
      id: videoId,
      desc: detail?.desc ?? '',
      playCount: normalizedDiag?.statistics?.playCount ?? 0,
      diggCount: normalizedDiag?.statistics?.diggCount ?? 0,
      commentCount: normalizedDiag?.statistics?.commentCount ?? 0,
    },
    author: { nickname: detail?.author?.nickname ?? '' },
    platformSignals: { hasDirectRiskField: normalizedDiag?.platformStatus?.reviewStatus !== null },
    diag: normalizedDiag,
  };

  const missingCriticalFields = normalized.platformSignals.hasDirectRiskField ? [] : ['platform.review_status'];

  // 记录各数据源状态
  const probeSources = [
    { key: 'video', status: detail ? 'success' : 'error', summary: detail ? '已获取视频详情' : '视频详情获取失败' },
    { key: 'author_profile', status: profileRaw ? 'success' : 'skipped', summary: profileRaw ? '已获取账号画像' : '账号画像未获取' },
    { key: 'recent_posts', status: recentPosts.length > 0 ? 'success' : 'skipped', summary: recentPosts.length > 0 ? `已获取近期 ${recentPosts.length} 条作品` : '近期作品未获取' },
    { key: 'comments', status: comments.length > 0 ? 'success' : 'skipped', summary: comments.length > 0 ? `已获取 ${comments.length} 条评论` : '评论未获取（仅 TikTok）' },
    { key: 'music', status: musicRaw ? 'success' : 'skipped', summary: musicRaw ? '已获取音乐详情' : '音乐详情未获取' },
  ];

  return {
    probe: {
      status: 'success',
      sources: probeSources,
      fields,
      raw: { video: videoRaw },
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
