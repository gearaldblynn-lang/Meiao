import {
  AspectRatio,
  GlobalApiConfig,
  ModuleConfig,
  VideoStoryboardBoard,
  VideoStoryboardConfig,
  VideoStoryboardShot,
} from '../types';
import { createInternalJob, waitForInternalJob, safeCreateInternalLog } from './internalApi';
import { processWithKieAi, recoverKieAiTask } from './kieAiService';

const logStoryboardEvent = (
  action: string,
  message: string,
  status: 'started' | 'success' | 'failed',
  detail = '',
  meta: Record<string, unknown> | null = null,
) => {
  void safeCreateInternalLog({
    level: status === 'failed' ? 'error' : 'info',
    module: 'video',
    action,
    message,
    detail,
    status,
    meta: meta || undefined,
  });
};

const ACTOR_LABELS: Record<VideoStoryboardConfig['actorType'], string> = {
  no_real_face: 'No Real Face',
  real_person: 'Real Person',
  '3d_digital_human': '3D Digital Human',
  cartoon_character: 'Cartoon Character',
};

const getSplitRanges = (config: VideoStoryboardConfig) => {
  if (config.duration !== '30s') {
    return [{ title: `${config.duration} 分镜板`, start: 0, end: config.shotCount }];
  }

  const firstCount = Math.floor(config.shotCount / 2);
  return [
    { title: '前 15 秒分镜板', start: 0, end: firstCount },
    { title: '后 15 秒分镜板', start: firstCount, end: config.shotCount },
  ];
};

const isPortraitRatio = (aspectRatio: VideoStoryboardConfig['aspectRatio']) =>
  aspectRatio === AspectRatio.P_9_16 ||
  aspectRatio === AspectRatio.P_4_5 ||
  aspectRatio === AspectRatio.P_3_4 ||
  aspectRatio === AspectRatio.SQUARE;

const getBoardGrid = (aspectRatio: VideoStoryboardConfig['aspectRatio'], panelCount: number) => {
  if (panelCount <= 1) return { cols: 1, rows: 1 };
  if (panelCount === 2) return isPortraitRatio(aspectRatio) ? { cols: 1, rows: 2 } : { cols: 2, rows: 1 };
  if (panelCount === 3) return isPortraitRatio(aspectRatio) ? { cols: 1, rows: 3 } : { cols: 3, rows: 1 };
  if (panelCount === 4) return { cols: 2, rows: 2 };
  if (panelCount === 6) return isPortraitRatio(aspectRatio) ? { cols: 3, rows: 2 } : { cols: 2, rows: 3 };
  if (panelCount === 8) return isPortraitRatio(aspectRatio) ? { cols: 4, rows: 2 } : { cols: 2, rows: 4 };
  if (panelCount === 9) return { cols: 3, rows: 3 };
  if (panelCount === 12) return isPortraitRatio(aspectRatio) ? { cols: 4, rows: 3 } : { cols: 3, rows: 4 };
  return isPortraitRatio(aspectRatio)
    ? { cols: Math.ceil(panelCount / 2), rows: 2 }
    : { cols: 2, rows: Math.ceil(panelCount / 2) };
};

const getSecondsFromDuration = (duration: VideoStoryboardConfig['duration']) => Number(duration.replace('s', ''));

const getPerShotTimingGuide = (config: VideoStoryboardConfig) => {
  const totalSeconds = getSecondsFromDuration(config.duration);
  const averageSeconds = totalSeconds / config.shotCount;
  const averageWords = config.countryLanguage.includes('英文') || config.countryLanguage.includes('西班牙文') || config.countryLanguage.includes('葡萄牙文') || config.countryLanguage.includes('德文') || config.countryLanguage.includes('法文')
    ? `${Math.max(2, Math.round(averageSeconds * 2.5))}-${Math.max(3, Math.round(averageSeconds * 3))} 个单词`
    : `${Math.max(4, Math.round(averageSeconds * 4.5))}-${Math.max(5, Math.round(averageSeconds * 5.5))} 个字`;

  return {
    totalSeconds,
    averageSeconds: averageSeconds.toFixed(1),
    averageWords,
  };
};

const buildScriptRequestPrompt = (config: VideoStoryboardConfig, sceneDescription: string) => {
  const timingGuide = getPerShotTimingGuide(config);
  const isNoRealFace = config.actorType === 'no_real_face';
  const actorInstruction =
    config.actorType === 'no_real_face'
      ? '禁止出现真实人物完整面部，可使用手部、背影、局部动作、上半身不露脸等真实合理方式呈现，禁止无头人体等异常画面。'
      : config.actorType === 'real_person'
        ? `允许出现真实人物，人物人种、肤色、面部特征、穿搭气质需与目标国家/语言 ${config.countryLanguage} 相匹配。`
        : config.actorType === '3d_digital_human'
          ? '如涉及人物，优先使用 3D 数字人，统一商业广告质感。'
          : '如涉及人物，优先使用卡通角色，保持角色形象统一。';
  const durationRule =
    config.duration === '30s'
      ? '整套分镜必须按时间顺序排列，前半段对应前 15 秒，后半段对应前 15 秒；如果镜头数为奇数，则前 15 秒镜头更少，后 15 秒镜头更多。'
      : '整套分镜必须按时间顺序排列。';

  const sceneInstruction = sceneDescription && sceneDescription.trim()
    ? `【重要】场景描述：${sceneDescription}\n所有分镜必须严格遵循此场景描述，不得偏离。每个分镜的画面、动作、环境都必须与此场景描述高度一致。`
    : '未指定固定场景，可按产品调性合理设计。';

  return `
角色：专业电商短视频分镜导演。
任务：基于参考产品图，为一个 ${config.duration} 的视频生成 ${config.shotCount} 个连续分镜。

背景信息：
- 产品信息：${config.productInfo || '未补充'}
- 脚本逻辑：${config.scriptLogic || '未补充'}
- 演员类型：${ACTOR_LABELS[config.actorType]}
- 演员限制：${actorInstruction}
- 目标国家/语言：${config.countryLanguage}

${sceneInstruction}

硬性要求：
1. 只输出 JSON 数组，不要 markdown，不要解释。
2. 必须输出刚好 ${config.shotCount} 个对象，并按视频时间顺序排列。
3. 每个对象必须包含 description、prompt、script 三个字段。
4. description：描述静态分镜画面，不是视频运镜，不允许字幕、logo、水印。
5. prompt：用于分镜板生成的单格画面提示词，必须严格保持产品与参考图一致，不要重复堆砌形容词。
6. script 格式必须为：
   分镜X（时长）
   画面：...
   动作：...
   口播：...
7. "画面" 和 "动作" 用中文；"口播" 用 ${config.countryLanguage} 对应语言。
8. 总时长是 ${timingGuide.totalSeconds} 秒，平均每个镜头约 ${timingGuide.averageSeconds} 秒。每个分镜的时长分配必须合理，不可全部机械写成同一个秒数。
9. 每个分镜的口播长度必须严格匹配该镜头时长。按当前语言，单镜头口播建议控制在 ${timingGuide.averageWords} 左右；镜头越短，口播越短。
10. 每个分镜的动作描述必须符合镜头时长，短镜头只允许单一明确动作，不能塞进过多连续动作。
11. 所有分镜必须符合电商广告逻辑，画面清楚、卖点明确、时间线连续。
12. ${durationRule}
13. 最终这些分镜将被排入单张分镜板中，请确保各分镜描述风格统一，便于一次性生成整板画面。
  `.trim();
};

const extractJsonArray = (content: string) => {
  const match = content.match(/\[[\s\S]*\]/);
  return match ? match[0] : content.replace(/```json/g, '').replace(/```/g, '').trim();
};

const allocateDurations = (totalSeconds: number, count: number) => {
  const totalTicks = Math.round(totalSeconds * 10);
  const baseTicks = Math.floor(totalTicks / count);
  const remainder = totalTicks - baseTicks * count;

  return Array.from({ length: count }, (_, index) => baseTicks + (index >= count - remainder ? 1 : 0));
};

const formatDuration = (ticks: number) => {
  const seconds = ticks / 10;
  return Number.isInteger(seconds) ? `${seconds}` : seconds.toFixed(1);
};

const rewriteScriptForBoard = (
  script: string,
  nextIndex: number,
  durationTicks: number
) => {
  const normalized = script
    .replace(/分镜\s*\d+\s*（[^）]*）/u, `分镜${nextIndex}（${formatDuration(durationTicks)}秒）`)
    .replace(/分镜\s*\d+/u, `分镜${nextIndex}`);

  if (/分镜\d+（/.test(normalized)) return normalized;
  return `分镜${nextIndex}（${formatDuration(durationTicks)}秒）\n${normalized}`;
};

export const generateStoryboardScript = async (
  config: VideoStoryboardConfig,
  imageUrls: string[],
  sceneDescription: string,
  apiConfig: GlobalApiConfig
): Promise<{ script: string; shots: VideoStoryboardShot[]; boards: VideoStoryboardBoard[] }> => {
  logStoryboardEvent('storyboard_script', '开始生成分镜脚本', 'started', '', {
    shotCount: config.shotCount,
    duration: config.duration,
    imageCount: imageUrls.length,
  });
  const prompt = buildScriptRequestPrompt(config, sceneDescription);
  const userContent: any[] = [{ type: 'text', text: prompt }];

  imageUrls.filter(Boolean).forEach((url) => {
    userContent.push({
      type: 'image_url',
      image_url: { url },
    });
  });

  const { job } = await createInternalJob({
    module: 'video',
    taskType: 'kie_chat',
    provider: 'kie',
    payload: {
      messages: [
        {
          role: 'system',
          content: 'You are a professional video storyboard script writer. Output only valid JSON.',
        },
        {
          role: 'user',
          content: userContent,
        },
      ],
      kieClientConfigPresent: Boolean(apiConfig.kieApiKey),
      requestId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    },
    maxRetries: 1,
  });

  const finalJob = await waitForInternalJob(job.id);
  if (finalJob.status !== 'succeeded') {
    throw new Error(finalJob.errorMessage || '分镜脚本生成失败');
  }

  const content = String(finalJob.result?.content || '');

  if (!content) throw new Error('分镜脚本返回为空');

  let parsed: Array<{ description: string; prompt: string; script: string }>;
  try {
    parsed = JSON.parse(extractJsonArray(content));
  } catch {
    logStoryboardEvent('storyboard_script', '分镜脚本解析失败', 'failed', content.slice(0, 200));
    throw new Error('分镜脚本解析失败');
  }

  const limited = parsed.slice(0, config.shotCount);
  const shots: VideoStoryboardShot[] = limited.map((item, index) => ({
    id: `shot_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
    description: item.description,
    scriptContent: item.script,
    prompt: item.prompt,
    status: 'pending',
  }));

  const ranges = getSplitRanges(config);
  const boards: VideoStoryboardBoard[] = ranges.map((range, index) => ({
    id: `board_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
    title: range.title,
    shotIds: shots.slice(range.start, range.end).map((shot) => shot.id),
    scriptText: (() => {
      const currentShots = shots.slice(range.start, range.end);
      const boardTotalSeconds = config.duration === '30s' ? 15 : getSecondsFromDuration(config.duration);
      const durationTicks = allocateDurations(boardTotalSeconds, currentShots.length);

      return `禁止出现任何字幕！\n\n${currentShots
        .map((shot, shotIndex) => rewriteScriptForBoard(shot.scriptContent, shotIndex + 1, durationTicks[shotIndex]))
        .join('\n\n')}`;
    })(),
    prompt: '',
    status: 'pending',
  }));

  logStoryboardEvent('storyboard_script', '分镜脚本生成成功', 'success', '', {
    shotCount: shots.length,
    boardCount: boards.length,
  });

  return {
    script: boards.length === 1
      ? boards[0].scriptText
      : boards.map((board) => `${board.title}\n${board.scriptText}`).join('\n\n====================\n\n'),
    shots,
    boards,
  };
};

const createImageModuleConfig = (
  aspectRatio: VideoStoryboardConfig['aspectRatio'],
  model: ModuleConfig['model'],
  quality: ModuleConfig['quality']
): ModuleConfig => ({
  targetLanguage: 'KEEP_ORIGINAL',
  customLanguage: '',
  removeWatermark: false,
  aspectRatio,
  quality,
  model,
  resolutionMode: 'original',
  targetWidth: 0,
  targetHeight: 0,
  maxFileSize: 2,
});

const buildBoardPrompt = (
  board: VideoStoryboardBoard,
  shots: VideoStoryboardShot[],
  config: VideoStoryboardConfig,
  previousBoardImageUrl?: string
) => {
  const boardShots = shots.filter((shot) => board.shotIds.includes(shot.id));
  const panelCount = boardShots.length;
  const grid = getBoardGrid(config.aspectRatio, panelCount);
  const panelLines = boardShots
    .map((shot, index) => `${index + 1}. ${shot.prompt.replace(/8k/gi, '').replace(/resolution/gi, '').trim()}`)
    .join('\n');
  const referenceLine = previousBoardImageUrl
    ? `补充参考：${previousBoardImageUrl} 是上一张分镜板，请将其作为前序分镜风格与排版连续性的参考，再制作本次分镜板。`
    : '';
  const actorLine =
    config.actorType === 'real_person'
      ? `如出现人物，人物人种和整体气质需跟随目标国家/语言 ${config.countryLanguage}。`
      : config.actorType === 'no_real_face'
        ? '如出现人物，仅允许不露脸的局部真实人物表达。'
        : '';

  return `
任务：将以下 ${panelCount} 个连续分镜一次性做成单张分镜板。
要求：
1. 输出单张完整分镜板，不是单独一格一格分开生成。
2. 分镜板内所有格子的产品必须严格与参考产品图一致，整体光影、色彩、风格、画面精度保持统一。
3. 所有分镜格必须是统一尺寸、统一比例，禁止某些格子忽高忽低、忽宽忽窄。
4. 每个分镜格都必须是 ${config.aspectRatio} 视频比例。
5. 这张图必须做成 ${panelCount} 宫格，排版固定为 ${grid.cols} 列 × ${grid.rows} 行，镜头顺序从左到右、从上到下连续排列。
6. 整张分镜板画布比例请按宫格内容智能适配，不要强行拉伸，不要让某一行或某一列尺寸异常。
7. 画面中禁止任何字幕、logo、水印。
8. 每个分镜格的内部尺寸必须完全一致，不允许某格更高、某格更低、某格更宽。
9. 请按 ${config.aspectRatio} 单格内容先构图，再组合成整板，不要先生成混乱拼图再硬裁切。
10. 输出整张分镜板时使用智能适配画布比例即可。
11. 分镜格数量必须与输入一致，不可缺格，不可多格。
12. 每格都要明显不同，但仍属于同一支视频的连续内容。
13. ${actorLine}
14. ${referenceLine || '无需参考上一张分镜板。'}

分镜内容：
${panelLines}
  `.trim();
};

export const generateStoryboardBoardImage = async (
  board: VideoStoryboardBoard,
  shots: VideoStoryboardShot[],
  config: VideoStoryboardConfig,
  imageUrls: string[],
  apiConfig: GlobalApiConfig,
  previousBoardImageUrl?: string
) => {
  logStoryboardEvent('storyboard_board_image', `开始生成分镜板图像: ${board.title}`, 'started', '', {
    boardId: board.id,
    shotCount: board.shotIds.length,
  });
  const prompt = buildBoardPrompt(board, shots, config, previousBoardImageUrl);
  const inputImages = previousBoardImageUrl ? [...imageUrls, previousBoardImageUrl] : imageUrls;

  return {
    prompt,
    result: await processWithKieAi(
      inputImages,
      apiConfig,
      createImageModuleConfig(config.aspectRatio, 'nano-banana-pro', '2k'),
      false,
      new AbortController().signal,
      prompt,
      false
    ),
  };
};

export const generateStoryboardWhiteBgImage = async (
  config: VideoStoryboardConfig,
  imageUrls: string[],
  apiConfig: GlobalApiConfig
) => {
  logStoryboardEvent('storyboard_white_bg', '开始生成白底图', 'started', '', {
    imageCount: imageUrls.length,
  });
  return await processWithKieAi(
    imageUrls,
    apiConfig,
    createImageModuleConfig(AspectRatio.SQUARE, 'nano-banana-2', '1k'),
    false,
    new AbortController().signal,
    'Product on pure white background, front view, clean shadow, commercial catalog quality, product consistency preserved.',
    false
  );
};

export const refetchStoryboardImage = async (taskId: string, apiConfig: GlobalApiConfig) => {
  return await recoverKieAiTask(taskId, apiConfig, new AbortController().signal);
};
