// @ts-nocheck
import type {
  VideoStoryboardBoard,
  VideoStoryboardConfig,
  VideoStoryboardShot,
} from '../types.ts';

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

const getSecondsFromDuration = (duration: VideoStoryboardConfig['duration']) => Number(duration.replace('s', ''));

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

const normalizeOriginalStoryboardPrompt = (
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
    config.actorType === 'real_person'
      ? `符合${config.countryLanguage}市场审美的真实人物出镜，手部和上半身动作自然，服装气质干净亲和，所有分段保持一致。`
      : '根据演员类型保持统一的人物或局部动作表达，出镜范围、动作节奏和商业广告气质在所有分段保持一致。',
  );
  const environmentDetail = extractCoreVisualDescription(
    raw,
    '环境/场景',
    String(config.scenes?.[0] || config.productInfo || '干净明亮的电商短视频拍摄场景，桌面道具、光线方向、景深和机位在全片保持连续。'),
  );

  return `${title}
{任务：根据输入按照要求制作一张${panelCount}宫格分镜图，保证每个分镜单元格画面都必须是${config.aspectRatio}视频比例。
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

const normalizeOriginalDynamicScriptPrompt = (
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
商品必须保持与商品参考图一致；人物/场景/道具/光影必须与对应宫格分镜保持一致。
【分镜详细描述】
${shots.map((shot, shotIndex) => `分镜${CHINESE_NUMERALS[shotIndex] || shotIndex + 1}：${shot.start} - ${shot.end}（脚本第二段也从00:00开始）
画面描述(视觉)：${shot.visual}；${shot.motion}
口播（${shot.voiceEmotion}）：“${shot.voiceover}”
音效：${shot.audio}`).join('\n')}}
`;
};

const buildOriginalSplitShotsAndBoards = (
  parsed: Array<{
    title?: string;
    durationSeconds?: number;
    panelCount?: number;
    storyboardPrompt?: string;
    dynamicScriptPrompt?: string;
  }>,
  config: VideoStoryboardConfig,
  identitySeed: string,
) => {
  const ranges = getSplitRanges(config);
  const segments = parsed.filter((item) => item && (item.storyboardPrompt || item.dynamicScriptPrompt));
  if (segments.length === 0) throw new Error('原创分镜策划结果为空');
  const shots: VideoStoryboardShot[] = [];
  const boards: VideoStoryboardBoard[] = segments.map((item, index) => {
    const fallbackRange = ranges[index] || ranges[ranges.length - 1] || { start: 0, end: config.shotCount };
    const panelCount = Math.max(1, Math.min(12, Number(item.panelCount || (fallbackRange.end - fallbackRange.start) || config.shotCount || 9) || 9));
    const storyboardPrompt = normalizeOriginalStoryboardPrompt(item, index, panelCount, config);
    const dynamicScriptPrompt = normalizeOriginalDynamicScriptPrompt(item, index, panelCount, config);
    const cells = extractStoryboardCells(storyboardPrompt, panelCount);
    const scriptShots = extractScriptShots(dynamicScriptPrompt, panelCount, config);
    const shotIds = Array.from({ length: panelCount }, (_, shotIndex) => {
      const id = buildStoryboardEntityId('shot', identitySeed, index, shotIndex);
      shots.push({
        id,
        description: cells[shotIndex] || `原创分镜 ${shotIndex + 1}`,
        scriptContent: dynamicScriptPrompt,
        prompt: cells[shotIndex] || scriptShots[shotIndex]?.visual || `原创分镜 ${shotIndex + 1}`,
        status: 'pending',
      });
      return id;
    });
    return {
      id: buildStoryboardEntityId('board', identitySeed, index),
      title: item.title || getSegmentLabel(index),
      shotIds,
      scriptText: dynamicScriptPrompt,
      dynamicScriptPrompt,
      prompt: storyboardPrompt,
      status: 'pending' as const,
    };
  });
  return {
    script: boards.map((board) => `${board.title}\n${board.dynamicScriptPrompt || board.scriptText}`).join('\n\n====================\n\n'),
    shots,
    boards,
  };
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
  identitySeed = '',
) => {
  const segments = parsed.filter((item) => item && (item.storyboardPrompt || item.dynamicScriptPrompt));
  if (segments.length === 0) throw new Error('爆款复刻拆解结果为空');
  const shots: VideoStoryboardShot[] = [];
  const boards: VideoStoryboardBoard[] = segments.map((item, index) => {
    const panelCount = Math.max(1, Math.min(12, Number(item.panelCount || config.shotCount || 9) || 9));
    const storyboardPrompt = normalizeViralStoryboardPrompt(item, index, panelCount, config);
    const dynamicScriptPrompt = normalizeViralDynamicScriptPrompt(item, index, panelCount, config);
    const shotIds = Array.from({ length: panelCount }, (_, shotIndex) => {
      const id = buildStoryboardEntityId('shot', identitySeed, index, shotIndex);
      shots.push({
        id,
        description: `${item.title || `分段${index + 1}`} 分镜 ${shotIndex + 1}`,
        scriptContent: dynamicScriptPrompt,
        prompt: storyboardPrompt,
      });
      return id;
    });
    return {
      id: buildStoryboardEntityId('board', identitySeed, index),
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
  const cleaned = content.replace(/```json/g, '').replace(/```/g, '').trim();
  for (let start = cleaned.indexOf('['); start >= 0; start = cleaned.indexOf('[', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < cleaned.length; index += 1) {
      const char = cleaned[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }
      if (char === '"') {
        inString = true;
      } else if (char === '[') {
        depth += 1;
      } else if (char === ']') {
        depth -= 1;
        if (depth === 0) {
          const candidate = cleaned.slice(start, index + 1);
          try {
            JSON.parse(candidate);
            return candidate;
          } catch {
            break;
          }
        }
      }
    }
  }
  return cleaned;
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

const normalizeIdentitySeed = (value: unknown) => {
  const normalized = String(value || 'storyboard')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.slice(0, 96) || 'storyboard';
};

const buildStoryboardEntityId = (
  kind: 'shot' | 'board',
  identitySeed: unknown,
  segmentIndex: number,
  shotIndex?: number,
) => [
  kind,
  normalizeIdentitySeed(identitySeed),
  segmentIndex + 1,
  shotIndex == null ? undefined : shotIndex + 1,
].filter((item) => item != null).join('_');

export const parseStoryboardPlanningResult = ({
  content,
  config,
  identitySeed,
}: {
  content: string;
  config: VideoStoryboardConfig;
  identitySeed: string;
}) => {
  let parsed: Array<{
    description?: string;
    prompt?: string;
    script?: string;
    title?: string;
    durationSeconds?: number;
    panelCount?: number;
    storyboardPrompt?: string;
    dynamicScriptPrompt?: string;
  }>;
  try {
    parsed = JSON.parse(extractJsonArray(String(content || '')));
  } catch {
    throw new Error(config.videoGenerationMode === 'viral_split' ? '爆款复刻拆解解析失败' : '分镜脚本解析失败');
  }

  if (config.videoGenerationMode === 'viral_split') {
    return buildViralSplitShotsAndBoards(parsed, config, [], '', identitySeed);
  }
  if (parsed.some((item) => item?.storyboardPrompt || item?.dynamicScriptPrompt)) {
    return buildOriginalSplitShotsAndBoards(parsed, config, identitySeed);
  }

  const limited = parsed.slice(0, config.shotCount);
  const shots: VideoStoryboardShot[] = limited.map((item, index) => ({
    id: buildStoryboardEntityId('shot', identitySeed, 0, index),
    description: item.description || '',
    scriptContent: item.script || '',
    prompt: item.prompt || item.description || '',
    status: 'pending',
  }));
  const ranges = getSplitRanges(config);
  const boards: VideoStoryboardBoard[] = ranges.map((range, index) => ({
    id: buildStoryboardEntityId('board', identitySeed, index),
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

  return {
    script: boards.length === 1
      ? boards[0].scriptText
      : boards.map((board) => `${board.title}\n${board.scriptText}`).join('\n\n====================\n\n'),
    shots,
    boards,
  };
};
