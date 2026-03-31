
import { GlobalApiConfig, ArkAnalysisResult, OneClickConfig, ArkSchemeResult, OneClickSubMode, VisualDirectionResult, ArkBuyerShowResult, BuyerShowPersistentState, ArkPureEvaluationResult, VideoConfig, SceneItem, AspectRatio, VeoScriptSegment } from "../types";
import { cancelInternalJob, createInternalJob, getActiveModuleContext, safeCreateInternalLog, waitForInternalJob } from "./internalApi";

const ARK_MODEL = 'doubao-seed-2-0-lite-260215';

type ArkResponseContentItem = {
  type?: string;
  text?: string;
};

const buildArkInputContent = (items: Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }>) =>
  items.map(item => {
    if (item.type === 'text') {
      return { type: 'input_text', text: item.text || '' };
    }

    return { type: 'input_image', image_url: item.image_url?.url || '' };
  });

const extractArkText = (data: any): string => {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  if (Array.isArray(data?.output)) {
    for (const outputItem of data.output) {
      const content = outputItem?.content;
      if (!Array.isArray(content)) continue;

      const text = (content as ArkResponseContentItem[])
        .filter(item => item?.type?.includes('text') && typeof item.text === 'string')
        .map(item => item.text!.trim())
        .filter(Boolean)
        .join('\n')
        .trim();

      if (text) return text;
    }
  }

  if (Array.isArray(data?.choices) && data.choices[0]?.message?.content) {
    return String(data.choices[0].message.content).trim();
  }

  throw new Error("AI 未返回可解析的文本内容");
};

const requestArkResponse = async (
  inputContent: Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }>,
  apiConfig: GlobalApiConfig,
  signal?: AbortSignal
) => {
  const module = getActiveModuleContext() || 'unknown';
  const { job } = await createInternalJob({
    module,
    taskType: 'ark_response',
    provider: 'ark',
    payload: {
      model: ARK_MODEL,
      inputContent,
      arkClientConfigPresent: Boolean(apiConfig.arkApiKey),
      requestId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    },
    maxRetries: 2,
  });

  try {
    const finalJob = await waitForInternalJob(job.id, signal);
    if (finalJob.status !== 'succeeded') {
      throw new Error(finalJob.errorMessage || 'Ark 请求失败');
    }
    return String(finalJob.result?.text || '');
  } catch (error: any) {
    if (error.message === 'INTERRUPTED') {
      void cancelInternalJob(job.id).catch(() => null);
    }
    throw error;
  }
};

const logArkEvent = (action: string, message: string, status: 'started' | 'success' | 'failed' | 'interrupted', detail = '', meta: Record<string, unknown> | null = null) => {
  const module = getActiveModuleContext() || 'unknown';
  void safeCreateInternalLog({
    level: status === 'failed' ? 'error' : 'info',
    module,
    action,
    message,
    detail,
    status,
    meta: meta || undefined,
  });
};

/**
 * 分析产品精修任务
 */
export const analyzeRetouchTask = async (
  imageUrl: string,
  mode: 'original' | 'white_bg',
  apiConfig: GlobalApiConfig,
  referenceUrl: string | null = null,
  signal?: AbortSignal
): Promise<ArkAnalysisResult> => {
  try {
    logArkEvent('retouch_analysis', '开始分析精修任务', 'started', '', { mode });
    const isWhiteBg = mode === 'white_bg';
    const systemPrompt = `你是一位世界顶级的商业摄影修图师 and 视觉总监。你的任务是分析原始图，并给出专业的精修指令。
    【精修核心原则】：
    1. 主体保真：严禁改变品牌 Logo、标签文字内容。
    2. 风格匹配：根据品类自动匹配（食品类追求食欲感，护肤品追求清透感）。
    3. 商业重塑：优化光影对比，使产品在视觉上符合高端商业大片的质感。`;

    const modeSpecificPrompt = isWhiteBg 
      ? `【目标：纯净白底精修模式】请输出如下英文指令：[主体白底精修]、[渲染风格定义]、[主体构图矫正]、[主体光影重塑]、[质感细节还原]、[色彩微调]。`
      : `【目标：原图精修模式】请输出如下英文指令：[画面内容调整]、[构图平衡]、[渲染风格定义]、[对比度增强]、[形体液化]、[质感还原]。`;

    const userPrompt = `分析原图。${referenceUrl ? `参考图。` : ""}\n${modeSpecificPrompt}\n请用简洁专业的英文输出。`;

    const inputContent: any[] = [];
    inputContent.push({ type: "text", text: `${systemPrompt}\n\n${userPrompt}` });
    inputContent.push({ type: "image_url", image_url: { url: imageUrl } });
    if (referenceUrl) {
      inputContent.push({ type: "image_url", image_url: { url: referenceUrl } });
    }

    const content = await requestArkResponse(inputContent, apiConfig, signal);
    logArkEvent('retouch_analysis', '精修分析完成', 'success', '', { mode });
    return { status: 'success', description: content };
  } catch (error: any) {
    logArkEvent('retouch_analysis', '精修分析失败', 'failed', error.message, { mode });
    return { status: 'error', description: '', message: error.message };
  }
};

/**
 * 策划详情页/主图营销策划全案
 */
export const generateMarketingSchemes = async (
  productUrls: string[],
  styleUrl: string | null,
  config: OneClickConfig,
  apiConfig: GlobalApiConfig,
  subMode: OneClickSubMode,
  directionPreference: string | null,
  signal?: AbortSignal
): Promise<ArkSchemeResult> => {
  try {
    const isDetail = subMode === OneClickSubMode.DETAIL_PAGE;
    logArkEvent('marketing_plan', `开始策划${isDetail ? '详情页' : '主图'}方案`, 'started', '', {
      count: config.count,
      subMode,
    });
    const targetLang = config.language;
    const platform = config.platform;
    const isCrossBorder = config.platformType === 'crossborder';
    const copyLayoutTemplate = `文案内容排版格式模板：
- 文案内容排版:
主标题(26px，黑体Bold，上方居中，#333333):"这里填写主标题"
副标题(17px，黑体Light，主标题下方，#666666):"这里填写副标题"
场景文案(15px，黑体Medium，每个小场景下方，#333333):"这里填写场景短语，多个场景用 | 分隔"

硬性格式要求：
1. 禁止把“文案内容排版”写成一整段解释、总述或散文。
2. 必须严格按“主标题 / 副标题 / 场景文案”三行结构输出；若某屏不需要其中某项，也要明确写“无”。
3. 每一行都必须包含：文案内容、字号、字重、位置、颜色。
4. 不得把文案信息混入“画面描述”栏位。`;
    
    // 逻辑还原：处理 "Auto" 比例
    // 详情页模式：允许 Auto，传递智能适配指令给 AI
    // 主图模式：UI已屏蔽Auto，但作为防守逻辑回退到 1:1
    let ratioPromptInstruction = "";
    let effectiveMainRatio = config.aspectRatio;

    if (config.aspectRatio === AspectRatio.AUTO) {
        if (isDetail) {
             ratioPromptInstruction = "按单屏内容与展示场景智能填写具体比例(如1:1、3:4、4:3、9:16)，严禁整套默认都写成9:16";
        } else {
             ratioPromptInstruction = "必须填入：1:1";
             effectiveMainRatio = AspectRatio.SQUARE;
        }
    } else {
        ratioPromptInstruction = `必须填入：${config.aspectRatio}`;
        effectiveMainRatio = config.aspectRatio;
    }
    
    // 构建平台与文化适配的 Prompt 模块
    const platformLogicPrompt = isDetail 
      ? `【详情页策划规则】：
         1. **智能比例适配**：根据每一屏的展示任务决定比例。首屏、大场景氛围图、模特场景图可用 3:4 或 9:16；卖点拆解、细节特写、参数展示、对比展示可用 1:1 或 4:3。**严禁整套都默认写成 9:16**，也**严禁输出 auto**。
         2. **内容服从产品调性**：画面内容必须贴合产品品类、价格带、使用场景与品牌气质，不能空泛堆场景。
         3. **移动端优先**：主体清晰，信息层级明确，手机端浏览时一眼能看懂。`
      : `【主图策略：平台/设备/文化深度适配】：
         1. **全局强制比例约束**：本案用户指定全局画面比例为【${effectiveMainRatio}】。你必须基于此比例进行构图策划（例如若为 3:4 则设计竖向构图，1:1 则设计正方形构图），并在每一屏方案的[-画面比例]栏位严格回填“${effectiveMainRatio}”。
         2. **平台算法匹配**：
            - 若目标平台是 **Amazon/Walmart/Ebay**：【主图1】必须严格遵循平台合规性（纯白底、无文字、无Logo、无水印、主体占比85%），侧重展示产品全貌与质感。
            - 若目标平台是 **TikTok/Shopee/Lazada/淘宝/拼多多**：【主图1】必须具备极强的“点击欲望(CTR)”。
         3. **移动端优先原则**：
            - 鉴于【${platform}】大部分流量来自移动端，所有视觉元素（尤其是产品主体）必须足够大，避免复杂的微小细节，确保在手机首屏列表页能一眼识别。
         4. **国家文化审美适配**：
            - 目标语言/地区为【${targetLang}】，请确保画面风格符合该地区的本土化审美。`;

    const systemPrompt = `你是一位顶级电商视觉总监，负责为【${platform}】输出高转化的${isDetail ? '详情页全案' : '主图系列'}。

    【硬性要求】
    1. 每一屏必须用 [SCHEME_START] 和 [SCHEME_END] 单独包裹，不能混屏。
    2. 全套视觉必须统一，不能一屏一个风格。
    3. 禁止编造促销活动、价格、赠品等未提供信息。
    4. 文案排版要简洁明确，写清内容、字重字号、颜色和位置。
    5. ${platformLogicPrompt}`;

    const userPrompt = `为【${platform}】策划 ${config.count} 屏【${isDetail ? '详情页长卷方案' : '全套主图方案'}】。
产品描述：${config.description}
目标语言：${targetLang}
${config.planningLogic ? `自定义叙事逻辑：${config.planningLogic}` : ""}
${styleUrl ? `风格参考图：${styleUrl}。仅提炼其配色、光影、材质与氛围作为整套视觉基调。` : ""}

单屏输出字段：
- 屏序/类型：${isDetail ? '[如：第1屏-Hero首屏]' : '[如：主图1-核心卖点展示]'}
- 设计意图：一句话说明
- 画面风格：简明描述整体调性
- 画面描述：聚焦主体、场景、构图与卖点表达
- 文案内容排版：写清文案、字号字重颜色位置
- 画面比例：[${ratioPromptInstruction}]

${copyLayoutTemplate}

要求：描述简练、精准，避免重复表达；内容必须服务产品卖点与产品调性。请开始策划。`;

    const inputContent: any[] = [];
    inputContent.push({ type: "text", text: `${systemPrompt}\n\n${userPrompt}` });
    
    // 将产品图作为输入
    productUrls.forEach(url => {
      inputContent.push({ type: "image_url", image_url: { url } });
    });
    // 将风格参考图作为输入
    if (styleUrl) {
      inputContent.push({ type: "image_url", image_url: { url: styleUrl } });
    }

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), 60000); // 60s timeout

    try {
      const content = await requestArkResponse(inputContent, apiConfig, signal || timeoutController.signal);
      let schemes: string[] = [];
      const tagRegex = /\[SCHEME_START\]([\s\S]*?)\[SCHEME_END\]/g;
      let match;
      while ((match = tagRegex.exec(content)) !== null) {
        if (match[1].trim()) schemes.push(match[1].trim());
      }
      
      // 深度补救逻辑：如果标签匹配失败，尝试使用正则表达式分割
      if (schemes.length === 0) {
        // 匹配常见的屏序标识符：第n屏、主图n、Screen n、屏序/类型
        const splitRegex = /(?=\n-?\s*(?:第\d+屏|主图\d+|Screen\s*\d+|屏序\/类型[：:]))/i;
        const parts = content.split(splitRegex).filter(p => p.trim().length > 20);
        
        // 如果分割后依然只有一个块，且内容较长，尝试按行分割
        if (parts.length <= 1 && content.length > 100) {
          schemes = [content];
        } else {
          schemes = parts;
        }
      }
      
      if (schemes.length === 0) {
        throw new Error("AI 返回的内容格式不正确，无法解析为有效的策划方案。内容预览: " + content.substring(0, 100) + "...");
      }
      
      logArkEvent('marketing_plan', `${isDetail ? '详情页' : '主图'}方案策划成功`, 'success', '', {
        count: schemes.slice(0, config.count).length,
        subMode,
      });
      return { status: 'success', schemes: schemes.slice(0, config.count) };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error: any) {
    logArkEvent('marketing_plan', `${subMode === OneClickSubMode.DETAIL_PAGE ? '详情页' : '主图'}方案策划失败`, 'failed', error.message, {
      count: config.count,
      subMode,
    });
    return { status: 'error', schemes: [], message: error.message };
  }
};

/**
 * 策划买家秀拍摄方案
 */
export const generateBuyerShowPrompts = async (
  productUrls: string[],
  referenceUrl: string | null,
  state: BuyerShowPersistentState,
  apiConfig: GlobalApiConfig,
  setIndex: number = 0, // 增加 Set Index 参数，用于发散思维
  signal?: AbortSignal
): Promise<ArkBuyerShowResult> => {
  try {
    logArkEvent('buyer_show_plan', '开始生成买家秀策划', 'started', '', {
      imageCount: state.imageCount,
      setIndex,
    });
    // 动态调整 System Prompt 逻辑
    const modelPrompt = state.includeModel 
      ? `3. **Include Model Strategy**: The set must include human presence suitable for ${state.targetCountry}. The FIRST task MUST be a benchmark shot. Subsequent shots must maintain consistency.`
      : `3. **STILL LIFE Strategy**: **NO HUMAN FACES/BODIES.** Focus on product details and scenes. Hands are allowed if necessary for usage demonstration.`;

    const systemPrompt = `You are an expert in generating authentic e-commerce Buyer Reviews (UGC).
    Target Market: ${state.targetCountry}.
    Task: Create ${state.imageCount} realistic buyer show photo concepts (JSON) + one review.
    
    VISUAL STYLE: **Authentic, Aesthetic & Clean Daily Life (iPhone Style)**.
    - **Core Concept**: "Casual/Spontaneous" means natural and relaxed, **NOT** dirty, messy, or chaotic.
    - **Environment**: Must be **CLEAN**, tidy, and visually pleasing (e.g., organized desk, cozy bedroom, bright cafe, neat shelf). **STRICTLY FORBID** messy rooms, trash, stained surfaces, or bad/dark lighting.
    - **Angle**: Natural user angles. Can be slightly handheld/dynamic, but ensure the product is clearly visible.
    - **Lighting**: Bright natural light or warm aesthetic indoor light. Avoid dark, gloomy, or flash-glare styles unless specified as artistic.
    - **Vibe**: Aspirational but attainable. Like a high-quality post on Xiaohongshu or Instagram.
    
    PLANNING LOGIC (Coherent Story):
    The ${state.imageCount} images must form a logical set covering multiple aspects:
    1. **Context**: Show the product in a NICE, CLEAN real-life environment.
    2. **Detail**: Close-up of texture/material.
    3. **Usage/Interaction**: How it is used.
    
    Output Format: JSON ONLY.
    Structure:
    {
      "tasks": [
        { 
          "prompt": "Visual description in English for Image AI. Keywords: aesthetic iPhone shot, clean background, natural light.",
          "style": "中文简短描述(例如: '午后阳光下的整洁桌面', '温馨的卧室一角', '手持细节展示'). 必须使用中文.",
          "hasFace": boolean (true ONLY if a human face is clearly visible)
        }
      ],
      "evaluation": "A single, authentic, enthusiastic review text in the native language of ${state.targetCountry}."
    }`;

    // 合并产品信息
    const productInfo = state.productName 
        ? `${state.productName}\nDetails & Scenarios: ${state.productFeatures}` 
        : state.productFeatures;

    // 核心差异化逻辑：根据 setIndex 强制发散场景
    let divergenceInstruction = "";
    if (setIndex === 0) divergenceInstruction = "Focus on **Indoor/Home** setting (e.g., Living room, Bedroom, Kitchen). Cozy and warm vibe.";
    else if (setIndex === 1) divergenceInstruction = "Focus on **Outdoor/Street** setting (e.g., Park, City street, Cafe terrace). Natural sunlight, dynamic vibe.";
    else if (setIndex === 2) divergenceInstruction = "Focus on **Office/Workplace/Study** setting (e.g., Desk setup, Meeting room). Clean, professional but casual vibe.";
    else divergenceInstruction = "Create a **Unique & Creative** setting different from typical home/outdoor scenes. Maybe travel, gym, or artistic background.";

    const refInstruction = referenceUrl 
      ? `IMPORTANT: A reference image is provided. **Analyze the style/environment of the reference image** and incorporate its vibe (e.g. lighting, color palette) into your prompts, BUT adapt it to the specific divergence theme: ${divergenceInstruction}`
      : `Creative Direction: ${divergenceInstruction}`;

    const userPrompt = `Product Info: ${productInfo}
    ${refInstruction}
    
    Requirement:
    1. Scenarios must feel 100% authentic to local users in ${state.targetCountry}.
    2. **Diversity & Logic**: The set of ${state.imageCount} images must tell a complete story.
    ${modelPrompt}
    4. Generate exactly ${state.imageCount} tasks.
    
    Generate the JSON response. Ensure valid JSON format.`;

    const inputContent: any[] = [];
    inputContent.push({ type: "text", text: `${systemPrompt}\n\n${userPrompt}` });
    
    // 将产品图作为输入
    productUrls.forEach(url => {
      inputContent.push({ type: "image_url", image_url: { url } });
    });
    // 将风格参考图作为输入
    if (referenceUrl) {
      inputContent.push({ type: "image_url", image_url: { url: referenceUrl } });
    }

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), 60000);

    try {
      let content = await requestArkResponse(inputContent, apiConfig, signal || timeoutController.signal);
      content = content.replace(/```json/g, '').replace(/```/g, '').trim();
      
      const firstBrace = content.indexOf('{');
      const lastBrace = content.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1) {
        content = content.substring(firstBrace, lastBrace + 1);
      }

      const result = JSON.parse(content);
      
      return {
        tasks: result.tasks || [],
        evaluation: result.evaluation || '',
        status: 'success'
      };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error: any) {
    logArkEvent('buyer_show_plan', '买家秀策划失败', 'failed', error.message, {
      imageCount: state.imageCount,
      setIndex,
    });
    return { tasks: [], evaluation: '', status: 'error', message: error.message };
  }
};

/**
 * 生成纯文本买家评价
 */
export const generatePureEvaluations = async (
  productUrls: string[],
  state: BuyerShowPersistentState,
  apiConfig: GlobalApiConfig,
  signal?: AbortSignal
): Promise<ArkPureEvaluationResult> => {
  try {
    logArkEvent('buyer_show_review', '开始生成买家评价文案', 'started', '', {
      targetCountry: state.targetCountry,
    });
    const count = 5;
    const systemPrompt = `You are a local customer in ${state.targetCountry}. Write ${count} distinct, authentic product reviews for an e-commerce site.`;
    
    const productInfo = state.productName 
        ? `${state.productName}\nFeatures: ${state.productFeatures}` 
        : state.productFeatures;

    const userPrompt = `Product Info: ${productInfo}
    Language: Native language of ${state.targetCountry}.
    
    Output Format: JSON array of strings. 
    Example: ["Review 1...", "Review 2..."]`;

    const inputContent: any[] = [];
    inputContent.push({ type: "text", text: `${systemPrompt}\n\n${userPrompt}` });

    let content = await requestArkResponse(inputContent, apiConfig, signal);
    content = content.replace(/```json/g, '').replace(/```/g, '').trim();
    let evaluations = [];
    try {
      evaluations = JSON.parse(content);
    } catch (e) {
      evaluations = content.split('\n').filter((l: string) => l.length > 10);
    }
    
    return {
      evaluations: Array.isArray(evaluations) ? evaluations : [],
      status: 'success'
    };
  } catch (error: any) {
    logArkEvent('buyer_show_review', '买家评价文案生成失败', 'failed', error.message, {
      targetCountry: state.targetCountry,
    });
    return { evaluations: [], status: 'error', message: error.message };
  }
};

/**
 * 智能 Veo 剧本生成 (ported from Doubao Service)
 */
export const generateVeoScript = async (
  imageUrls: string[],
  config: VideoConfig,
  apiConfig: GlobalApiConfig,
  signal?: AbortSignal
): Promise<VeoScriptSegment[]> => {
  logArkEvent('veo_script_plan', '开始生成短视频脚本', 'started', '', {
    imageCount: imageUrls.length,
    duration: config.duration,
  });
  const totalDuration = parseInt(config.duration);
  const segmentCount = Math.max(1, Math.floor(totalDuration / 8));

  const systemPrompt = `你是一个拥有 10 年经验的短视频导演，擅长极简视觉和精准口播。
任务：基于参考图和卖点规划一套高一致性的视频剧本。

[视觉开场规范]（极重要）：
1. **全主体整合**：第一个 8 秒分镜（INITIAL）的视觉描述必须整合并包含 [所有提供的参考图] 中的核心主体元素（如产品全貌、细节特质、使用环境）。
2. **视觉锚点**：确保开场即建立品牌/产品的视觉基准，让观众一眼识别出参考图中的核心信息。

[音色一致性规范]：
1. **全局唯一音色**：你必须先选定一个确定的【音色特质描述】（如：25岁活力女声）。
2. **标签复用**：所有分镜的 "spokenContent" 必须以该音色标签开头，格式：(音色描述)：文案内容。

[口播内容与时长适配规范]（严格执行）：
1. **严禁编造**：绝对禁止编造具体的折扣（如 20% off）、库存状态（如 limited stock）或价格，除非用户在“核心卖点”中明确提供。
2. **字数严格压缩**：每个分镜仅 8 秒，为保证语速自然且有呼吸感，请严格控制文案长度。
   - **中文/日文**：每个分镜文案【严禁超过 35 字】。
   - **英文/西语**：每个分镜文案【严禁超过 20 个单词】。
3. **目标**：文案必须能在 7 秒内悠闲读完，预留 1 秒转场呼吸。

[返回格式]:
必须返回符合 [目标语言] 的纯 JSON 格式：
{
  "voice_tag": "选定的唯一音色描述（如：25岁活力女声）",
  "segments": [
    {
      "title": "分镜1(0-8s) - 全主体呈现",
      "description": "整合了所有参考图主体的镜头运动细节描述（严禁提及字幕、文字）",
      "spokenContent": "(音色描述)：精炼、真实、适配 8 秒时长的文案",
      "bgm": "音乐风格"
    }
  ]
}`;

  // 仅当用户填写了叙事逻辑时才将其加入 prompt，否则不传，避免 AI 使用默认预设。
  const logicPromptPart = config.logicInfo && config.logicInfo.trim() 
    ? `- 叙事逻辑: ${config.logicInfo}` 
    : '';

  const userPrompt = `[用户核心输入]:
- 产品卖点: ${config.sellingPoints}
- 目标语言: ${config.targetLanguage}
- 分镜总数: ${segmentCount}
${logicPromptPart}
[参考图列表 (首个分镜必须整合这些图片的主体)]: ${imageUrls.join('\n')}`;

  try {
    const inputContent: any[] = [];
    inputContent.push({ type: "text", text: `${systemPrompt}\n\n${userPrompt}` });
    
    imageUrls.forEach(url => {
      inputContent.push({ type: "image_url", image_url: { url } });
    });

    const rawText = await requestArkResponse(inputContent, apiConfig, signal);
    if (rawText) {
        let rawContent = rawText.trim();
        if (rawContent.includes('```')) {
          rawContent = rawContent.replace(/```json/g, '').replace(/```/g, '').trim();
        }
    
        const parsed = JSON.parse(rawContent);
        const voiceTag = parsed.voice_tag || "(25岁活力女声)";
        
        const cleanSpoken = (text: string) => {
          if (!text) return '';
          let cleaned = text.replace(/^-?(人声口播|口播内容|口播文字|声音描述|Voiceover)[：:]\s*/gi, '').trim();
          if (!cleaned.startsWith('(')) {
            cleaned = `${voiceTag}：${cleaned.replace(/^[：:]\s*/, '')}`;
          }
          return cleaned;
        };
    
        return (parsed.segments || []).slice(0, segmentCount).map((s: any, index: number) => ({
          id: `seg-${index}-${Date.now()}`,
          type: index === 0 ? 'INITIAL' : 'EXTENSION',
          title: s.title || `分镜${index+1}`,
          description: s.description || '',
          spokenContent: cleanSpoken(s.spokenContent), 
          bgm: s.bgm || '',
          style: '',
          duration: 8
        }));
    }
    throw new Error("AI 策划引擎未返回有效数据");
  } catch (error: any) {
    logArkEvent('veo_script_plan', '短视频脚本生成失败', 'failed', error.message, {
      imageCount: imageUrls.length,
      duration: config.duration,
    });
    return [];
  }
};

/**
 * 策划 Sora 2 Pro 视频分镜脚本
 */
export const generateVideoScript = async (
  imageUrls: string[],
  referenceVideoUrl: string | null,
  config: VideoConfig,
  apiConfig: GlobalApiConfig,
  signal?: AbortSignal
): Promise<{ scenes: SceneItem[], status: 'success' | 'error', message?: string }> => {
  try {
    logArkEvent('video_scene_plan', '开始生成视频分镜脚本', 'started', '', {
      imageCount: imageUrls.length,
      duration: config.duration,
    });
    const totalDuration = parseInt(config.duration);
    const sceneCount = Math.max(1, Math.floor(totalDuration / 5));

    const systemPrompt = `你是一位世界顶级的电商视频导演和视觉策划专家。
    任务：为一款产品策划一段时长为 ${totalDuration} 秒的短视频分镜脚本。
    
    【策划核心原则】：
    1. 视觉冲击力：开场 3 秒必须抓住眼球。
    2. 卖点聚焦：根据用户提供的“产品卖点”进行视觉化呈现。
    3. 节奏感：分镜切换自然，符合商业大片节奏。
    
    【输出格式】：
    必须返回纯 JSON 格式：
    {
      "scenes": [
        {
          "Scene": "详细的画面描述，包含镜头运动、光影氛围、产品动态。严禁提及文字/字幕。",
          "duration": 5
        }
      ]
    }`;

    const userPrompt = `
    产品卖点：${config.sellingPoints}
    目标市场：${config.targetLanguage}
    视频时长：${totalDuration}秒
    分镜数量：${sceneCount}
    ${config.logicInfo ? `叙事逻辑：${config.logicInfo}` : ""}
    ${referenceVideoUrl ? `参考视频风格：${referenceVideoUrl}` : ""}
    
    请开始策划。`;

    const inputContent: any[] = [];
    inputContent.push({ type: "text", text: `${systemPrompt}\n\n${userPrompt}` });
    
    imageUrls.forEach(url => {
      inputContent.push({ type: "image_url", image_url: { url } });
    });

    let content = await requestArkResponse(inputContent, apiConfig, signal);
    content = content.replace(/```json/g, '').replace(/```/g, '').trim();
    
    const firstBrace = content.indexOf('{');
    const lastBrace = content.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      content = content.substring(firstBrace, lastBrace + 1);
    }

    const result = JSON.parse(content);
    logArkEvent('video_scene_plan', '视频分镜脚本生成成功', 'success', '', {
      sceneCount: (result.scenes || []).length,
      duration: config.duration,
    });
    return { 
      status: 'success', 
      scenes: (result.scenes || []).map((s: any) => ({
        Scene: s.Scene || s.description || '',
        duration: s.duration || 5
      }))
    };
  } catch (error: any) {
    logArkEvent('video_scene_plan', '视频分镜脚本生成失败', 'failed', error.message, {
      imageCount: imageUrls.length,
      duration: config.duration,
    });
    return { status: 'error', scenes: [], message: error.message };
  }
};
export const getVisualDirections = async (p: string[], s: string|null, c: OneClickConfig, ac: GlobalApiConfig, sig?: AbortSignal): Promise<VisualDirectionResult> => ({ directions: [], status: 'success' });
