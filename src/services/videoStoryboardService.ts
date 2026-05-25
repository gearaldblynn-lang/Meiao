// @ts-nocheck
import {
  AspectRatio,
  GlobalApiConfig,
  ModuleConfig,
  VideoStoryboardBoard,
  VideoStoryboardConfig,
  VideoStoryboardShot,
} from '../types.ts';
import { createInternalJob, fetchSystemConfig, waitForInternalJob, safeCreateInternalLog } from './internalApi';
import { processWithKieAi, recoverKieAiTask } from './kieAiService';
import { GPT_IMAGE_2_DEFAULT_QUALITY } from '../utils/gptImage2.mjs';
import { resolvePublicAssetUrl } from '../utils/modelAssetUrl.mjs';

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

let cachedPublicBaseUrl = '';
let cachedPublicBaseUrlAt = 0;
let cachedVideoAnalysisModel = '';
let cachedVideoAnalysisModelAt = 0;
const PUBLIC_BASE_URL_CACHE_TTL_MS = 30_000;
const VIDEO_ANALYSIS_MODEL_CACHE_TTL_MS = 2_000;

const resolveRuntimePublicBaseUrl = async () => {
  if (cachedPublicBaseUrl && Date.now() - cachedPublicBaseUrlAt < PUBLIC_BASE_URL_CACHE_TTL_MS) {
    return cachedPublicBaseUrl;
  }
  const result = await fetchSystemConfig();
  const nextBaseUrl = String(result.config.publicBaseUrl || '').trim();
  cachedPublicBaseUrl = nextBaseUrl;
  cachedPublicBaseUrlAt = Date.now();
  return nextBaseUrl;
};

const resolveVideoAnalysisModel = async () => {
  if (cachedVideoAnalysisModel && Date.now() - cachedVideoAnalysisModelAt < VIDEO_ANALYSIS_MODEL_CACHE_TTL_MS) {
    return cachedVideoAnalysisModel;
  }
  const result = await fetchSystemConfig();
  const configured = String(result.config.systemSettings.effectiveVideoAnalysisModel || '').trim();
  const availableModels = (result.config.videoAnalysisModels || result.config.agentModels.chat || [])
    .filter((item) => String(item.id || '').toLowerCase().startsWith('gemini'));
  const fallback = availableModels.some((item) => item.id === 'gemini-3-flash-openai')
    ? 'gemini-3-flash-openai'
    : availableModels[0]?.id || 'gemini-3-flash-openai';
  const videoAnalysisModel = availableModels.some((item) => item.id === configured)
    ? configured
    : fallback;
  cachedVideoAnalysisModel = videoAnalysisModel;
  cachedVideoAnalysisModelAt = Date.now();
  return videoAnalysisModel;
};

const requireModelAssetUrl = (value: string, publicBaseUrl: string, label: string) => {
  const raw = String(value || '').trim();
  if (!raw) {
    throw new Error(`${label} 没有可用于模型读取的公网地址，请重新上传后重试。`);
  }
  const safeUrl = resolvePublicAssetUrl(raw, publicBaseUrl);
  if (!safeUrl) {
    throw new Error(`${label} 没有可用于模型读取的公网地址，请重新上传后重试。`);
  }
  return safeUrl;
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

const formatUrlList = (urls: string[], label: string) =>
  urls.length > 0
    ? urls.map((url, index) => `${label}${index + 1}：${url}`).join('\n')
    : `${label}：未提供`;

const getSceneReferenceUrls = (config: VideoStoryboardConfig) =>
  Array.isArray(config.sceneReferenceUrls)
    ? config.sceneReferenceUrls.map((url) => String(url || '').trim()).filter(Boolean)
    : [];

const buildScriptRequestPrompt = (
  config: VideoStoryboardConfig,
  sceneDescription: string,
  productImageUrls: string[] = [],
  referenceVideoUrl = '',
  sceneReferenceUrls: string[] = [],
) => {
  if (config.videoGenerationMode === 'viral_split') {
    return `
你是“短视频爆款拆解复刻导演”，你的任务：根据提供的爆款视频逐分镜输出“15秒左右为一个分段的连续性宫格分镜提示词”+“分镜对应动态视频脚本提示词”。

输入A：商品参考图。商品外观以商品参考图为唯一真实来源，必须保证商品一致性。
${formatUrlList(productImageUrls, '商品参考图公网URL')}
输入B：商品真实信息、卖点、数据等：${config.productInfo || '未补充。若未补充，则在不改变商品真实外观的前提下尽量复刻原视频表达。'}
输入C：爆款复刻视频公网URL：${referenceVideoUrl || config.uploadedReferenceVideoUrl || '已上传参考视频。'}
输出画幅：每个分镜单元格都必须是 ${config.aspectRatio} 视频比例。

核心任务：
- 拆解参考爆款短视频的镜头顺序、节奏、人物/商品/场景/运镜/口播/音效。
- 按原视频内容自然分段，每段约 15 秒左右。15秒左右为一个分段，不要把关键口播或关键动作硬切在分段尾部。
- 每个分段都必须产出一条“宫格分镜图 prompt”和一条“动态视频脚本提示词”，两者一一对应。
- 如参考视频口播宣传内容与输入B的商品真实信息冲突，必须按输入B修改，不得虚构不符合本产品的信息。
- 保持全局一致性，尤其是商品参考图一致性、人物、场景、道具、光影、镜头语言。
- 所有输出里的“商品：”字段必须固定写为“商品：保持与商品参考图完全一致，不展开描述包装细节”。禁止描述、复述或猜测商品包装的颜色、品牌、标签、文字、形状、材质和内容物细节。
- 口播内容必须来自爆款视频中真实可识别的原始口播；如与输入B冲突，只能基于输入B做事实修正，不得新增原视频没有表达过的卖点、功效、数据或营销话术。
- 音效描述必须来自爆款视频中真实可识别的声音内容，包括背景音乐、环境声、操作声、转场声等；禁止为了让脚本完整而补写、扩写、编造口播或音效。
- 如果某个分镜的口播或音效在参考视频中无法清晰识别，必须分别写为“参考视频该分镜口播未清晰识别”“参考视频该分镜音效未清晰识别”，不要改写成“无口播”或自行补写。

宫格分镜图 prompt 必须严格使用以下格式，不能压缩成一段话：
分段一
{任务：根据输入按照要求制作一张x（当前分段数量）宫格分镜图，保证每个分镜单元格画面都必须是${config.aspectRatio}的画面比例。
【全片核心视觉基调】
人物细节：用一句完整中文描述从爆款视频拆解出的人物类型、手部/身体动作、服装气质和出镜范围，所有分段保持一致
环境/场景：用一句完整中文描述从爆款视频拆解出的具体场景、桌面/厨房/办公/道具、光线方向、景深和机位，并在全片保持连续
全局一致性：商品参考图一致性、人物、场景、道具、光影、镜头语言在所有分段保持连续一致
分镜内容如下
分镜一：xxx
……
固定要求:
-所有分镜头集中在“一张大图”中，采用均等的网格排列（例如 2x2, 3x4 根据视频镜头数量而定，严格按${config.aspectRatio}比例对单格内容先构图，保证每一个分镜单元格内容都是${config.aspectRatio}比例，再组合成整个画面，）
-分镜画面需要保持纯净，严禁出现以下元素：字幕、广告语、水印、分镜序号等任何形式的后期叠加文本
-如果是第二段及后续分段，必须写入：请延续上一张宫格分镜制作，并保持人物、商品、环境、光影、排版连续}

注意：“人物细节”和“环境/场景”后的文字是填写要求，最终输出必须替换成从爆款视频中拆解出的具体描述，不得原样保留“用一句完整中文描述”、不得出现 xxx。

动态视频脚本提示词必须严格使用以下格式，不能压缩成一段话：
分段一
{前置要求：保持视频画面纯净，禁止出现任何文字字幕！
【全局一致性要求】
商品必须保持与商品参考图一致；人物/场景/道具/光影必须与爆款视频拆解以及对应宫格分镜保持一致。
【分镜详细描述】
分镜一：00:00 - 00:00（脚本第二段也从00:00开始）
画面描述(视觉)：xxx（运镜+带有动作状态的画面内容描述）
口播（情绪描写）：“xxx（必须是爆款视频中该分镜真实可识别口播；识别不清写参考视频该分镜口播未清晰识别）”
音效：xxx（必须是爆款视频中该分镜真实可识别声音；识别不清写参考视频该分镜音效未清晰识别）}
每个分段时间码都从 00:00 开始。

只输出 JSON 数组，不要 markdown，不要解释。每个数组对象代表一个分段：
[
  {
    "title": "分段一",
    "durationSeconds": 15,
    "panelCount": 9,
    "storyboardPrompt": "用于生成该分段宫格分镜图的完整 prompt",
    "dynamicScriptPrompt": "用于生成该分段动态视频的完整脚本提示词"
  }
]
`.trim();
  }

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
  const sceneReferenceInstruction = sceneReferenceUrls.length > 0
    ? `\n场景/风格参考图：\n${formatUrlList(sceneReferenceUrls, '场景参考图公网URL')}\n使用方式：这些图片只作为拍摄环境、光线、道具、景深、机位和风格参考；不得把场景参考图中的非商品物体误当成商品，不得改变商品参考图中的产品外观。`
    : '';
  const viralInstruction = config.videoGenerationMode === 'viral_split'
    ? `\n爆款裂变要求：
- 当前模式：爆款裂变。
- 参考爆款视频：${config.uploadedReferenceVideoUrl || '已上传占位，分析逻辑后续接入'}。
- 裂变修改幅度：${config.viralVariationStrength === 'custom' ? (config.viralCustomVariationStrength || '自定义') : `${config.viralVariationStrength}%`}。
- 不需要遵循用户单独填写的脚本逻辑，请直接按爆款视频的节奏、卖点组织和市场语言做商品替换式裂变。`
    : '';

  return `
R Role 角色
专业电商短视频分镜导演。

T Task 任务
基于参考产品图，为一个 ${config.duration} 的视频生成 ${config.shotCount} 个连续分镜。

C Constraint 约束
- 产品信息：${config.productInfo || '未补充'}
- 脚本逻辑：${config.scriptLogic || '未补充'}
- 演员类型：${ACTOR_LABELS[config.actorType]}
- 演员限制：${actorInstruction}
- 目标国家/语言：${config.countryLanguage}

${sceneInstruction}
${sceneReferenceInstruction}
${viralInstruction}

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

F Format 格式
[
  {
    "description": "静态分镜画面描述",
    "prompt": "单格分镜板提示词",
    "script": "分镜1（时长）\\n画面：...\\n动作：...\\n口播：..."
  }
]

E Example 示例
[
  {
    "description": "产品置于干净台面，侧光突出材质。",
    "prompt": "clean product on tabletop, soft side light, commercial frame",
    "script": "分镜1（2秒）\\n画面：产品位于桌面中央。\\n动作：镜头轻推近。\\n口播：..."
  }
]
  `.trim();
};

const CHINESE_NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];

const getSegmentLabel = (index: number) => `分段${CHINESE_NUMERALS[index] || index + 1}`;

const extractStoryboardCells = (text = '', panelCount = 9) => {
  const normalized = String(text || '').replace(/\r/g, '').trim();
  const matches = Array.from(normalized.matchAll(/(?:^|[；;\n])\s*(?:分镜)?(?:\d+|[一二三四五六七八九十]+)[\.、：:]\s*([^；;\n]+)/g))
    .map((match) => match[1]?.trim())
    .filter(Boolean);
  if (matches.length > 0) return matches.slice(0, panelCount);
  return Array.from({ length: panelCount }, (_, index) => `延续参考爆款视频的第${index + 1}个关键镜头，保持商品、人物、环境和光影连续一致。`);
};

const normalizeCoreVisualDescription = (value: string, fallback: string) => {
  const text = String(value || '')
    .replace(/[（(][^（）()]*?(?:从爆款视频拆解|所有分段保持一致|并在全片保持连续|填写要求|输出时删除|描述要求)[^（）()]*[）)]/g, '')
    .trim();
  if (!text || /^x+$/i.test(text) || /xxx|待填写|请填写|用一句完整中文描述/.test(text)) {
    return fallback;
  }
  return /[。.!！?？]$/.test(text) ? text : `${text}。`;
};

const extractCoreVisualDescription = (text: string, label: '人物细节' | '环境/场景', fallback: string) => {
  const normalized = String(text || '').replace(/\r/g, '').trim();
  const pattern = label === '人物细节'
    ? /人物细节\s*[：:]\s*([^\n]+)/
    : /环境\/场景\s*[：:]\s*([^\n]+)/;
  const match = normalized.match(pattern);
  return normalizeCoreVisualDescription(match?.[1] || '', fallback);
};

const getFallbackVoiceover = (_config: VideoStoryboardConfig, _shotIndex: number) => '参考视频该分镜口播未清晰识别';

const getFallbackAudio = () => '参考视频该分镜音效未清晰识别';

const normalizeVoiceoverText = (value: string, config: VideoStoryboardConfig, shotIndex: number) => {
  const text = String(value || '').trim();
  if (!text || /口播\s*(无|为空)|无口播|静音|none/i.test(text)) {
    return getFallbackVoiceover(config, shotIndex);
  }
  return text.replace(/^["“]|["”]$/g, '');
};

const extractScriptShots = (text = '', panelCount = 9, config: VideoStoryboardConfig) => {
  const normalized = String(text || '').replace(/\r/g, '').trim();
  const timeMatches = Array.from(normalized.matchAll(/(\d{2}:\d{2})\s*[-–—]\s*(\d{2}:\d{2})/g));
  if (timeMatches.length > 0) {
    return timeMatches.slice(0, panelCount).map((match, index) => {
      const startIndex = match.index ?? 0;
      const nextMatch = timeMatches[index + 1];
      const endIndex = nextMatch?.index ?? normalized.length;
      const body = normalized.slice(startIndex, endIndex).trim();
      const lines = body.split('\n').map((line) => line.trim()).filter(Boolean);
      const visualLine = lines.find((line) => line.startsWith('画面描述(视觉)：')) || lines.find((line) => line.startsWith('画面：')) || '';
      const motionLine = lines.find((line) => line.startsWith('动作/运镜：')) || lines.find((line) => line.startsWith('动作：')) || '';
      const voiceLine = lines.find((line) => line.startsWith('口播')) || '';
      const audioLine = lines.find((line) => line.startsWith('音效')) || '';
      const voiceMatch = voiceLine.match(/口播\s*[（(]?([^）)]*)[）)]?\s*[：:]?\s*[“"]?([^”"\n]*)/);
      const audioMatch = audioLine.match(/音效\s*[：:]?\s*(.*)$/);
      return {
        start: match[1],
        end: match[2],
        visual: visualLine.replace(/^画面描述\(视觉\)：|^画面：/, '').trim() || `参考视频第${index + 1}个镜头的画面内容`,
        motion: motionLine.replace(/^动作\/运镜：|^动作：/, '').trim() || `延续参考视频第${index + 1}个镜头的动作和运镜节奏`,
        voiceEmotion: voiceMatch?.[1]?.trim() || '自然、可信',
        voiceover: normalizeVoiceoverText(voiceMatch?.[2] || '', config, index),
        audio: audioMatch?.[1]?.trim() || getFallbackAudio(),
      };
    });
  }

  const durations = allocateDurations(15, panelCount);
  let cursor = 0;
  return Array.from({ length: panelCount }, (_, index) => {
    const start = cursor;
    const end = cursor + durations[index] / 10;
    cursor = end;
    return {
      start: `00:${String(Math.floor(start)).padStart(2, '0')}`,
      end: `00:${String(Math.floor(end)).padStart(2, '0')}`,
      visual: `参考视频第${index + 1}个关键镜头画面，结合商品参考图替换为当前产品`,
      motion: `按参考视频第${index + 1}个镜头的运动节奏执行`,
      voiceEmotion: '自然、有说服力',
      voiceover: getFallbackVoiceover(config, index),
      audio: getFallbackAudio(),
    };
  });
};

const normalizeViralStoryboardPrompt = (
  item: { title?: string; storyboardPrompt?: string },
  index: number,
  panelCount: number,
  config: VideoStoryboardConfig,
) => {
  const title = item.title || getSegmentLabel(index);
  const raw = String(item.storyboardPrompt || '').trim();
  const cells = extractStoryboardCells(raw, panelCount);
  const personDetail = extractCoreVisualDescription(
    raw,
    '人物细节',
    '参考爆款视频中可见的人物出镜范围、手部/身体动作和服装气质，所有分段保持一致。',
  );
  const environmentDetail = extractCoreVisualDescription(
    raw,
    '环境/场景',
    '参考爆款视频中可见的真实拍摄场景、道具、光线方向、景深和机位，所有分段保持连续。',
  );

  return `${title}
{任务：根据输入按照要求制作一张${panelCount}宫格分镜图，保证每个分镜单元格画面都必须是${config.aspectRatio}的画面比例。
【全片核心视觉基调】
人物细节：${personDetail}
环境/场景：${environmentDetail}
全局一致性：商品参考图一致性、人物、场景、道具、光影、镜头语言、画面质感在所有分段保持连续一致。
分镜内容如下
${cells.map((cell, cellIndex) => `分镜${CHINESE_NUMERALS[cellIndex] || cellIndex + 1}：${cell}`).join('\n')}
固定要求:
-所有分镜头集中在“一张大图”中，采用均等的网格排列（例如 2x2, 3x4 根据视频镜头数量而定，严格按${config.aspectRatio}比例对单格内容先构图，保证每一个分镜单元格内容都是${config.aspectRatio}比例，再组合成整个画面，）
-分镜画面需要保持纯净，严禁出现以下元素：字幕、广告语、水印、分镜序号等任何形式的后期叠加文本
-${index > 0 ? '请延续上一张宫格分镜制作，并保持人物、商品、环境、光影、排版连续' : '建立可供后续分段延续的人物、商品、环境、光影、排版标准'}}`;
};

const normalizeViralDynamicScriptPrompt = (
  item: { title?: string; dynamicScriptPrompt?: string },
  index: number,
  panelCount: number,
  config: VideoStoryboardConfig,
) => {
  const title = item.title || getSegmentLabel(index);
  const shots = extractScriptShots(item.dynamicScriptPrompt || '', panelCount, config);
  return `${title}
{前置要求：保持视频画面纯净，禁止出现任何文字字幕！
【全局一致性要求】
商品必须保持与商品参考图一致；人物/场景/道具/光影必须与爆款视频拆解以及对应宫格分镜保持一致。
【分镜详细描述】
${shots.map((shot, shotIndex) => `分镜${CHINESE_NUMERALS[shotIndex] || shotIndex + 1}：${shot.start} - ${shot.end}（脚本第二段也从00:00开始）
画面描述(视觉)：${shot.visual}；${shot.motion}
口播（${shot.voiceEmotion}）：“${shot.voiceover}”
音效：${shot.audio}`).join('\n')}}
`;
};

const buildViralSplitShotsAndBoards = (
  parsed: Array<{
    title?: string;
    durationSeconds?: number;
    panelCount?: number;
    storyboardPrompt?: string;
    dynamicScriptPrompt?: string;
  }>,
  config: VideoStoryboardConfig,
  productImageUrls: string[] = [],
  referenceVideoUrl = '',
) => {
  const segments = parsed.filter((item) => item && (item.storyboardPrompt || item.dynamicScriptPrompt));
  if (segments.length === 0) throw new Error('爆款复刻拆解结果为空');
  const shots: VideoStoryboardShot[] = [];
  const boards: VideoStoryboardBoard[] = segments.map((item, index) => {
    const panelCount = Math.max(1, Math.min(12, Number(item.panelCount || config.shotCount || 9) || 9));
    const storyboardPrompt = normalizeViralStoryboardPrompt(item, index, panelCount, config);
    const dynamicScriptPrompt = normalizeViralDynamicScriptPrompt(item, index, panelCount, config);
    const shotIds = Array.from({ length: panelCount }, (_, shotIndex) => {
      const id = `shot_${Date.now()}_${index}_${shotIndex}_${Math.random().toString(36).slice(2, 7)}`;
      shots.push({
        id,
        description: `${item.title || `分段${index + 1}`} 分镜 ${shotIndex + 1}`,
        scriptContent: dynamicScriptPrompt,
        prompt: storyboardPrompt,
      });
      return id;
    });
    return {
      id: `board_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
      title: item.title || `分段${index + 1}`,
      shotIds,
      scriptText: dynamicScriptPrompt,
      dynamicScriptPrompt,
      prompt: storyboardPrompt,
      status: 'pending',
    };
  });

  return {
    script: boards.map((board) => `${board.title}\n${board.dynamicScriptPrompt || board.scriptText}`).join('\n\n====================\n\n'),
    shots,
    boards,
  };
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
): Promise<{ script: string; shots: VideoStoryboardShot[]; boards: VideoStoryboardBoard[]; taskId?: string; creditsConsumed?: number }> => {
  if (config.videoGenerationMode === 'viral_split' && !config.uploadedReferenceVideoUrl && !config.referenceVideoFile) {
    throw new Error('请先上传爆款复刻视频');
  }
  logStoryboardEvent('storyboard_script', '开始生成分镜脚本', 'started', '', {
    shotCount: config.shotCount,
    duration: config.duration,
    imageCount: imageUrls.length,
  });
  const publicBaseUrl = await resolveRuntimePublicBaseUrl();
  const safeReferenceVideoUrl = config.videoGenerationMode === 'viral_split' && config.uploadedReferenceVideoUrl
    ? requireModelAssetUrl(config.uploadedReferenceVideoUrl, publicBaseUrl, '爆款复刻视频')
    : '';
  const safeImageUrls = imageUrls.filter(Boolean).map((url, index) =>
    requireModelAssetUrl(url, publicBaseUrl, `参考图${index + 1}`)
  );
  const safeSceneReferenceUrls = getSceneReferenceUrls(config).map((url, index) =>
    requireModelAssetUrl(url, publicBaseUrl, `场景参考图${index + 1}`)
  );
  const prompt = buildScriptRequestPrompt(config, sceneDescription, safeImageUrls, safeReferenceVideoUrl, safeSceneReferenceUrls);
  const userContent: any[] = [{ type: 'text', text: prompt }];
  const videoAnalysisModel = await resolveVideoAnalysisModel();

  if (safeReferenceVideoUrl) {
    userContent.push({ type: 'text', text: `[爆款复刻视频URL] ${safeReferenceVideoUrl}` });
    userContent.push({
      type: 'input_file',
      file_url: safeReferenceVideoUrl,
      filename: 'viral-reference-video',
    });
  }

  safeImageUrls.forEach((safeUrl) => {
    userContent.push({
      type: 'image_url',
      image_url: { url: safeUrl },
    });
  });

  safeSceneReferenceUrls.forEach((safeUrl) => {
    userContent.push({
      type: 'image_url',
      image_url: { url: safeUrl },
    });
  });

  const { job } = await createInternalJob({
    module: 'video',
    taskType: 'kie_chat',
    provider: 'kie',
    payload: {
      model: videoAnalysisModel,
      reasoningLevel: 'high',
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
  const taskId = String(finalJob.providerTaskId || finalJob.result?.providerTaskId || '').trim() || undefined;
  const creditsConsumed = Number.isFinite(Number(finalJob.result?.creditsConsumed)) ? Number(finalJob.result?.creditsConsumed) : undefined;

  if (config.videoGenerationMode === 'viral_split') {
    let parsedSegments: Array<{
      title?: string;
      durationSeconds?: number;
      panelCount?: number;
      storyboardPrompt?: string;
      dynamicScriptPrompt?: string;
    }>;
    try {
      parsedSegments = JSON.parse(extractJsonArray(content));
    } catch {
      logStoryboardEvent('storyboard_script', '爆款复刻拆解解析失败', 'failed', content.slice(0, 200));
      throw new Error('爆款复刻拆解解析失败');
    }
    const result = buildViralSplitShotsAndBoards(parsedSegments, config, safeImageUrls, safeReferenceVideoUrl);
    logStoryboardEvent('storyboard_script', '爆款复刻拆解成功', 'success', '', {
      boardCount: result.boards.length,
    });
    return { ...result, taskId, creditsConsumed };
  }

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
    taskId,
    creditsConsumed,
  };
};

const createImageModuleConfig = (
  aspectRatio: ModuleConfig['aspectRatio'],
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
  previousBoardImageUrl?: string,
  revisionInstruction?: string,
  productImageUrls: string[] = [],
  sceneReferenceUrls: string[] = [],
  supplementReferenceUrls: string[] = [],
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
  const revisionLine = revisionInstruction?.trim()
    ? `修改要求：请基于当前已生成分镜板和商品参考图重新生成，并严格按以下意见调整，生成后覆盖原图位置：${revisionInstruction.trim()}`
    : '';
  const supplementReferenceLine = supplementReferenceUrls.length > 0
    ? `补充参考图：\n${formatUrlList(supplementReferenceUrls, '补充参考图公网URL')}\n这些图片仅用于用户修改说明明确点名的局部、包装、元素或场景参考；未点名的产品主体、卖点层级、版式关系和分镜连续性仍以当前分镜板与商品参考图为准。`
    : '';
  if (config.videoGenerationMode === 'viral_split' && board.prompt?.trim()) {
    return [
      '【生成输入素材公网URL】',
      formatUrlList(productImageUrls, '商品参考图公网URL'),
      previousBoardImageUrl ? `上一张宫格分镜图公网URL：${previousBoardImageUrl}` : '',
      supplementReferenceLine,
      '【使用方式】商品参考图作为商品一致性参考；上一张宫格图用于第二段及后续分段的视觉连续性。',
      board.prompt.trim(),
      previousBoardImageUrl
        ? `连续性参考：上一张宫格分镜图地址为 ${previousBoardImageUrl}，请延续该宫格分镜制作，保持人物、商品、环境、光影、镜头语言和整板排版连续。`
        : '',
      revisionLine,
    ].filter(Boolean).join('\n\n');
  }
  const actorLine =
    config.actorType === 'real_person'
      ? `如出现人物，人物人种和整体气质需跟随目标国家/语言 ${config.countryLanguage}。`
      : config.actorType === 'no_real_face'
        ? '如出现人物，仅允许不露脸的局部真实人物表达。'
        : '';

  const sceneReferenceLine = sceneReferenceUrls.length > 0
    ? `场景/风格参考图：\n${formatUrlList(sceneReferenceUrls, '场景参考图公网URL')}\n这些图片只用于参考环境、光线、道具、景深、机位和整体风格；产品外观仍以参考产品图为唯一来源。`
    : '';

  return `
R Role 角色
你是商业视频分镜板设计助手。

T Task 任务
将以下 ${panelCount} 个连续分镜一次性做成单张分镜板。

C Constraint 约束
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
15. ${revisionLine || '无额外修改要求。'}
16. ${sceneReferenceLine || '无额外场景参考图。'}
17. ${supplementReferenceLine || '无额外补充参考图。'}

F Format 格式
直接输出单张完整分镜板图像。

E Example 示例
${grid.cols} 列 × ${grid.rows} 行宫格，按从左到右、从上到下顺序排布。

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
  previousBoardImageUrl?: string,
  revisionInstruction?: string,
  supplementReferenceUrls: string[] = []
) => {
  logStoryboardEvent('storyboard_board_image', `开始生成分镜板图像: ${board.title}`, 'started', '', {
    boardId: board.id,
    shotCount: board.shotIds.length,
  });
  const publicBaseUrl = await resolveRuntimePublicBaseUrl();
  const safeImageUrls = imageUrls.filter(Boolean).map((url, index) =>
    requireModelAssetUrl(url, publicBaseUrl, `参考图${index + 1}`)
  );
  const safeSceneReferenceUrls = getSceneReferenceUrls(config).map((url, index) =>
    requireModelAssetUrl(url, publicBaseUrl, `场景参考图${index + 1}`)
  );
  const safeSupplementReferenceUrls = supplementReferenceUrls.filter(Boolean).map((url, index) =>
    requireModelAssetUrl(url, publicBaseUrl, `补充参考图${index + 1}`)
  );
  const safePreviousBoardImageUrl = previousBoardImageUrl ? requireModelAssetUrl(previousBoardImageUrl, publicBaseUrl, '上一张分镜板') : '';
  const safeCurrentBoardImageUrl = revisionInstruction?.trim() && board.imageUrl
    ? requireModelAssetUrl(board.imageUrl, publicBaseUrl, '当前分镜板')
    : '';
  const prompt = buildBoardPrompt(
    board,
    shots,
    config,
    safePreviousBoardImageUrl || undefined,
    revisionInstruction,
    safeImageUrls,
    safeSceneReferenceUrls,
    safeSupplementReferenceUrls
  );
  const inputImages = [
    ...safeImageUrls,
    ...safeSceneReferenceUrls,
    ...safeSupplementReferenceUrls,
    ...(safePreviousBoardImageUrl ? [safePreviousBoardImageUrl] : []),
    ...(safeCurrentBoardImageUrl ? [safeCurrentBoardImageUrl] : []),
  ];

  return {
    prompt,
    result: await processWithKieAi(
      inputImages,
      apiConfig,
      createImageModuleConfig(AspectRatio.AUTO, 'gpt-image-2', config.quality || GPT_IMAGE_2_DEFAULT_QUALITY),
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
    createImageModuleConfig(AspectRatio.SQUARE, 'gpt-image-2', GPT_IMAGE_2_DEFAULT_QUALITY),
    false,
    new AbortController().signal,
    'Product on pure white background, front view, clean shadow, commercial catalog quality, product consistency preserved.',
    false
  );
};

export const refetchStoryboardImage = async (taskId: string, apiConfig: GlobalApiConfig) => {
  return await recoverKieAiTask(taskId, apiConfig, new AbortController().signal);
};
