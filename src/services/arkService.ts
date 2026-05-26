// @ts-nocheck

import { GlobalApiConfig, ArkAnalysisResult, OneClickConfig, ArkSchemeResult, OneClickSubMode, VisualDirectionResult, ArkBuyerShowResult, BuyerShowPersistentState, ArkPureEvaluationResult, VideoConfig, SceneItem, AspectRatio, VeoScriptSegment, SkuConfig, OneClickReferenceDimension } from "../types";
import { cancelInternalJob, createInternalJob, fetchInternalJob, fetchSystemConfig, getActiveModuleContext, safeCreateInternalLog, waitForInternalJob } from "./internalApi";
import { resolvePublicAssetUrl } from "../utils/modelAssetUrl.mjs";

const estimatePromptTokens = (items: Array<{ type: string; text?: string }>) =>
  items.reduce((sum, item) => sum + Math.ceil((item.text || '').length / 4), 0);

let cachedAnalysisModel = '';
let cachedAnalysisModelAt = 0;
let cachedPublicBaseUrl = '';
let cachedPublicBaseUrlAt = 0;
const ANALYSIS_MODEL_CACHE_TTL_MS = 30_000;
const PUBLIC_BASE_URL_CACHE_TTL_MS = 30_000;

const resolveAnalysisModel = async () => {
  if (cachedAnalysisModel && Date.now() - cachedAnalysisModelAt < ANALYSIS_MODEL_CACHE_TTL_MS) {
    return cachedAnalysisModel;
  }

  const result = await fetchSystemConfig();
  const nextModel = String(
    result.config.systemSettings.effectiveAnalysisModel ||
    result.config.agentModels.chat?.[0]?.id ||
    'gpt-5-4-openai-resp'
  ).trim();

  cachedAnalysisModel = nextModel;
  cachedAnalysisModelAt = Date.now();
  return nextModel;
};

const resolveRuntimePublicBaseUrl = async () => {
  if (Date.now() - cachedPublicBaseUrlAt < PUBLIC_BASE_URL_CACHE_TTL_MS) {
    return cachedPublicBaseUrl;
  }

  const result = await fetchSystemConfig();
  const nextBaseUrl = String(result.config.publicBaseUrl || '').trim();
  cachedPublicBaseUrl = nextBaseUrl;
  cachedPublicBaseUrlAt = Date.now();
  return nextBaseUrl;
};

const requireModelAssetUrl = (value: string | null | undefined, publicBaseUrl: string, label: string) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const safeUrl = resolvePublicAssetUrl(raw, publicBaseUrl);
  if (!safeUrl) {
    throw new Error(`${label} 没有可用于模型读取的公网地址，请重新上传后重试。`);
  }
  return safeUrl;
};

const requireModelAssetUrls = (values: string[] | null | undefined, publicBaseUrl: string, label: string) =>
  (Array.isArray(values) ? values : [])
    .map((value, index) => requireModelAssetUrl(value, publicBaseUrl, `${label}${index + 1}`))
    .filter(Boolean);

const normalizeCreditsConsumed = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

type AnalysisJobCreatedCallback = (jobId: string, providerTaskId?: string) => void;

const isPendingAnalysisJobStatus = (status: unknown) =>
  ['queued', 'running', 'retry_waiting'].includes(String(status || ''));

const createRecoverableAnalysisSyncError = () => {
  const error = new Error('AI 分析任务已提交云端，结果待同步，请稍后同步任务结果。') as Error & { code?: string };
  error.code = 'job_timeout';
  return error;
};

const buildAnalysisResponseFromJob = (
  finalJob: any,
  normalizedContent: Array<{ type: string; text?: string }>,
  startedAt: number,
  model: string,
  module: string,
  jobId: string,
): { content: string; creditsConsumed?: number; taskId?: string } => {
  if (!finalJob || typeof finalJob !== 'object') {
    throw new Error('AI 分析任务状态同步失败，请稍后在任务列表中同步任务结果');
  }
  if (finalJob.status !== 'succeeded') {
    throw new Error(finalJob.errorMessage || 'AI 分析请求失败');
  }
  const content = String(finalJob.result?.content || finalJob.result?.text || '');
  const creditsConsumed = normalizeCreditsConsumed(finalJob.result?.creditsConsumed);
  const promptTokens = estimatePromptTokens(normalizedContent);
  const completionTokens = Math.ceil(content.length / 4);
  const estimatedCost = ((promptTokens + completionTokens) * 0.000002).toFixed(6);
  void safeCreateInternalLog({
    level: 'info',
    module,
    action: 'analysis_token_usage',
    message: `分析调用完成`,
    status: 'success',
    meta: {
      model,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      estimatedCost: Number(estimatedCost),
      creditsConsumed: finalJob.result?.creditsConsumed,
      latencyMs: Date.now() - startedAt,
      jobId,
    },
  });
  return {
    content,
    creditsConsumed,
    taskId: String(finalJob.providerTaskId || finalJob.result?.providerTaskId || '').trim() || undefined,
  };
};

const requestAnalysisResponseDetailed = async (
  inputContent: Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }>,
  _apiConfig: GlobalApiConfig,
  signal?: AbortSignal,
  onJobCreated?: AnalysisJobCreatedCallback,
  jobMetadata: Record<string, unknown> = {},
): Promise<{ content: string; creditsConsumed?: number; taskId?: string }> => {
  const module = getActiveModuleContext() || 'unknown';
  const startedAt = Date.now();
  const [model, publicBaseUrl] = await Promise.all([
    resolveAnalysisModel(),
    resolveRuntimePublicBaseUrl(),
  ]);
  const normalizedContent = inputContent.map((item, index) => {
    if (item.type === 'text') {
      return { type: 'text', text: item.text || '' };
    }
    return {
      type: 'image_url',
      image_url: {
        url: requireModelAssetUrl(item.image_url?.url || '', publicBaseUrl, `图片素材${index + 1}`),
      },
    };
  });
  const { job } = await createInternalJob({
    module,
    taskType: 'kie_chat',
    provider: 'kie',
    payload: {
      ...jobMetadata,
      model,
      messages: [
        {
          role: 'user',
          content: normalizedContent,
        },
      ],
      requestId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    },
    maxRetries: 2,
  });
  onJobCreated?.(job.id);
  let notifiedProviderTaskId = '';
  const notifyProviderTaskId = (providerTaskId: unknown) => {
    const value = String(providerTaskId || '').trim();
    if (!value || value === notifiedProviderTaskId) return;
    notifiedProviderTaskId = value;
    onJobCreated?.(job.id, value);
  };

  try {
    const finalJob = await waitForInternalJob(job.id, signal, 2500, 0, (currentJob) => {
      notifyProviderTaskId(currentJob?.providerTaskId);
    });
    if (!finalJob || typeof finalJob !== 'object') {
      throw new Error('AI 分析任务状态同步失败，请稍后在任务列表中同步任务结果');
    }
    notifyProviderTaskId(finalJob.providerTaskId || finalJob.result?.providerTaskId);
    return buildAnalysisResponseFromJob(finalJob, normalizedContent as any[], startedAt, model, module, job.id);
  } catch (error: any) {
    if (error.message === 'INTERRUPTED') {
      void cancelInternalJob(job.id).catch(() => null);
      throw error;
    }
    const recoveredJob = await fetchInternalJob(job.id)
      .then((response) => response.job)
      .catch(() => null);
    notifyProviderTaskId(recoveredJob?.providerTaskId || recoveredJob?.result?.providerTaskId);
    if (recoveredJob?.status === 'succeeded') {
      void safeCreateInternalLog({
        level: 'info',
        module,
        action: 'analysis_job_recovered_after_poll_error',
        message: '分析任务轮询异常后已从后台成功结果恢复',
        status: 'success',
        detail: error?.message || '',
        meta: { jobId: job.id, errorCode: error?.code || '', providerTaskId: recoveredJob.providerTaskId || recoveredJob.result?.providerTaskId || '' },
      });
      return buildAnalysisResponseFromJob(recoveredJob, normalizedContent as any[], startedAt, model, module, job.id);
    }
    if (isPendingAnalysisJobStatus(recoveredJob?.status)) {
      throw createRecoverableAnalysisSyncError();
    }
    throw error;
  }
};

const requestAnalysisResponse = async (
  inputContent: Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }>,
  apiConfig: GlobalApiConfig,
  signal?: AbortSignal,
  onJobCreated?: AnalysisJobCreatedCallback
) => (await requestAnalysisResponseDetailed(inputContent, apiConfig, signal, onJobCreated)).content;

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

const REFERENCE_DIMENSION_LABELS: Record<OneClickReferenceDimension, string> = {
  visual_style: '视觉风格',
  typography: '字体',
  color_palette: '色调',
  layout: '排版',
  copy_content: '文案内容',
};

const RTCFE_COPY_LAYOUT_FORMAT_BLOCK = `-文案内容排版：
主标题（字体，字号字重，位置，颜色色值）：“xxx”
其他内容（字体，字号字重，位置，颜色色值）：“xxx”
...`;

const RTCFE_COPY_LAYOUT_EXAMPLE_BLOCK = `-文案内容排版：
主标题（宋体，28pt Bold，画面顶部居中，#3d3d3d）：“全屋持久留香”
副标题（黑体，16pt Light，主标题下方居中，#000000）：“法式沙龙调香，持续散香”
点缀（潇洒手写体，16pt Medium，右上角，#ff6600）：“love potion”`;

const RTCFE_COPY_LAYOUT_CONSTRAINTS = [
  '文案内容排版必须严格按输出规范和示例输出。',
  '圆括号内必须依次填写字体、字号字重、位置、颜色色值。',
  '只有中文引号“”内的文字才是最终需要渲染到画面中的正文文案。',
  '字段名、冒号、说明文字、示例标签都不得出现在最终画面中。',
  '不得输出旧格式或自由格式。',
].join('\n');

export const analyzeOneClickReferenceSet = async (
  referenceUrls: string[],
  dimensions: OneClickReferenceDimension[],
  scene: OneClickSubMode,
  apiConfig: GlobalApiConfig,
  signal?: AbortSignal,
  logoUrl?: string | null
): Promise<ArkAnalysisResult> => {
  try {
    const publicBaseUrl = await resolveRuntimePublicBaseUrl();
    const dimensionText = (Array.isArray(dimensions) && dimensions.length > 0
      ? dimensions
      : ['visual_style', 'color_palette', 'layout']
    ).map((item) => REFERENCE_DIMENSION_LABELS[item] || item).join('、');

    const sceneInstruction = scene === OneClickSubMode.MAIN_IMAGE
      ? '主图模式：重点总结主图框内的主体摆放、文案区摆放、信息层级与首屏吸睛方式。画面描述要尽量详细，明确前景/中景/背景关系、标题区位置、卖点区位置、留白和视觉落点。'
      : scene === OneClickSubMode.DETAIL_PAGE
        ? '详情模式：重点总结整套详情的风格统一方式、版式节奏、模块排布与长图阅读层级。更关注风格延续、信息分段方式、文案区和图像区的排版逻辑。'
        : 'SKU模式：重点总结SKU排版结构、组合呈现方式、不同SKU之间如何保持统一又有区分。更关注SKU组合的呈现框架、文案区结构和商品/赠品的排布方式。';

    const userPrompt = `R Role 角色
你是电商视觉参考分析师。

T Task 任务
分析这组设计参考图，并输出后续策划可直接复用的参考结论。

C Constraint 约束
1. 请只分析用户勾选的参考维度：${dimensionText}。
2. 若勾选了文案内容，只提炼可复用的宣传表达方向、语气、卖点组织方式，不要照抄具体品牌名、商品名或不可复用的专属文案。
3. 不要分析这是什么产品、卖什么功能、适合什么人群，只分析设计语言、版式规则、视觉表达方式。
4. ${sceneInstruction}
5. 只总结被勾选的维度；未勾选的维度不要输出。
6. 如果某个维度在这组图里不稳定，要明确写出“不建议强绑定”。
7. 结论必须可直接进入后续策划，不要空泛；统一时总结具体共性，差异大时提炼抽象共性。
8. 如果同一维度在这组图中风格高度统一，要总结出更具体的共性特征。
9. 如果同一维度在这组图中差异较大，要提炼更抽象、更上位的大致共性。
10. 例如统一时可写到字体类别、常见字重、字号区间、气质倾向；例如差异较大时可写成现代无衬线、字重大、字号偏大、爆点醒目这类抽象共性。
11. 以上内容作为方案策划内容的设计参考，三个模块的策划输出内容需要参考以上的设计风格进行制作并输出结果。

F Format 格式
只输出用户实际勾选的维度对应栏目，没勾选的维度不要输出。
如果用户勾选了“视觉风格”，输出：- 视觉风格：xxx（主要描述视觉形式，设计风格，设计偏向）
如果用户勾选了“字体”，输出：- 字体：主要描述不同的字体的选用，字体的大小，字重，字体间配色，营造的调性
如果用户勾选了“色调”，输出：- 色调：主要描述整体的色调搭配，色彩倾向，背景，点缀，辅助色等等
如果用户勾选了“排版”，输出：- 排版：版式设计，构图设计内容，组合等等
如果用户勾选了“文案内容”，输出：- 文案内容：摘选一些直接抄的文案卖点（一般只有跟产品是同样的产品的时候才会选择）

E Example 示例
- 视觉风格：高饱和撞色、强对比、首屏爆点明确
- 排版：主体居中偏大，标题区上置，卖点区右下角补充`;

    const inputContent: any[] = [{ type: "text", text: userPrompt }];
    requireModelAssetUrls(referenceUrls, publicBaseUrl, '设计参考图').forEach((url, index) => {
      inputContent.push({ type: "text", text: `[设计参考图${index + 1}] 图片URL：${url}` });
      inputContent.push({ type: "image_url", image_url: { url } });
    });
    if (logoUrl) {
      const safeLogoUrl = requireModelAssetUrl(logoUrl, publicBaseUrl, '品牌logo图');
      inputContent.push({ type: "text", text: `[品牌logo图] 图片URL：${safeLogoUrl}。仅用于识别我方品牌，不要把其他品牌logo当作我方品牌元素。` });
      inputContent.push({ type: "image_url", image_url: { url: safeLogoUrl } });
    }

    const content = await requestAnalysisResponse(inputContent, apiConfig, signal);
    return { status: 'success', description: content.trim() };
  } catch (error: any) {
    return { status: 'error', description: '', message: error.message };
  }
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
    const publicBaseUrl = await resolveRuntimePublicBaseUrl();
    logArkEvent('retouch_analysis', '开始分析精修任务', 'started', '', { mode });
    const isWhiteBg = mode === 'white_bg';
    const systemPrompt = `R Role 角色
你是一位世界顶级的商业摄影修图师 and 视觉总监。

T Task 任务
分析原始图，并给出专业的精修指令。

C Constraint 约束
1. 主体保真：严禁改变品牌 Logo、标签文字内容。
2. 原图连续性：原图精修必须以原图现有画面为基础做优化，不得脱离原图重新设计一张新画面。
3. 构图连续性：禁止随意替换原图的主体、场景、拍摄角度、构图关系和主要陈列方式。
4. 内容克制：若无明确要求，不得新增不存在的背景、道具、装饰元素或额外产品。
5. 风格匹配：根据品类自动匹配（食品类追求食欲感，护肤品追求清透感）。
6. 商业重塑：优化光影对比，使产品在视觉上符合高端商业大片的质感。

F Format 格式
输出简洁专业的英文精修指令。

E Example 示例
[渲染风格定义] clean premium studio lighting`;

    const modeSpecificPrompt = isWhiteBg
      ? `【目标：纯净白底精修模式】请输出如下英文指令：[主体白底精修]、[渲染风格定义]、[主体构图矫正]、[主体光影重塑]、[质感细节还原]、[色彩微调]。`
      : `【目标：原图精修模式】必须以原图现有画面为基础做精修优化，不得脱离原图重新设计一张新画面。禁止随意替换原图的主体、场景、拍摄角度、构图关系和主要陈列方式。若无明确要求，不得新增不存在的背景、道具、装饰元素或额外产品。请输出如下英文指令：[画面内容调整]、[构图平衡]、[渲染风格定义]、[对比度增强]、[形体液化]、[质感还原]。`;

    const safeImageUrl = requireModelAssetUrl(imageUrl, publicBaseUrl, '精修原图');
    const safeReferenceUrl = referenceUrl ? requireModelAssetUrl(referenceUrl, publicBaseUrl, '精修参考图') : '';
    const userPrompt = `分析原图。${safeReferenceUrl ? `参考图：${safeReferenceUrl}。` : ""}\n${modeSpecificPrompt}\n请用简洁专业的英文输出。`;

    const inputContent: any[] = [];
    inputContent.push({ type: "text", text: `${systemPrompt}\n\n${userPrompt}` });
    inputContent.push({ type: "image_url", image_url: { url: safeImageUrl } });
    if (safeReferenceUrl) {
      inputContent.push({ type: "image_url", image_url: { url: safeReferenceUrl } });
    }

    const content = await requestAnalysisResponse(inputContent, apiConfig, signal);
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
  signal?: AbortSignal,
  referenceAnalysisSummary?: string | null,
  logoUrl?: string | null,
  onJobCreated?: AnalysisJobCreatedCallback,
  jobMetadata: Record<string, unknown> = {},
): Promise<ArkSchemeResult> => {
  try {
    const publicBaseUrl = await resolveRuntimePublicBaseUrl();
    const isDetail = subMode === OneClickSubMode.DETAIL_PAGE;
    const isFirstImage = subMode === OneClickSubMode.FIRST_IMAGE;
    const planningLabel = isDetail ? '详情页' : isFirstImage ? '首图' : '主图';
    const planningTaskLabel = isDetail ? '详情页长卷方案' : isFirstImage ? '首图方案' : '全套主图方案';
    const planningSeriesLabel = isDetail ? '详情页全案' : isFirstImage ? '单屏首图' : '主图系列';

    logArkEvent('marketing_plan', `开始策划${planningLabel}方案`, 'started', '', {
      count: config.count,
      subMode,
    });
    const targetLang = config.language;
    const platform = config.platform;
    const isCrossBorder = config.platformType === 'crossborder';
    // 逻辑还原：处理 "Auto" 比例
    // 详情页模式：允许 Auto，传递智能适配指令给 AI
    // 主图模式：UI已屏蔽Auto，但作为防守逻辑回退到 1:1
    let ratioPromptInstruction = "";
    let effectiveMainRatio = config.aspectRatio;

    if (config.aspectRatio === AspectRatio.AUTO) {
        if (isDetail) {
             ratioPromptInstruction = "移动端优先智能填写具体比例，优先使用竖图3:4或9:16；仅在参数、对比、横向流程图等确实需要横向信息展开时才使用1:1或4:3，严禁输出auto";
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
         1. **移动端优先比例适配**：详情页默认面向手机端浏览，Auto比例下优先规划 3:4 或 9:16 竖图；首屏、大场景氛围图、模特场景图、卖点展示图应优先使用 3:4 或 9:16。只有参数展示、对比展示、横向流程图等确实需要横向展开时，才允许使用 1:1 或 4:3。**严禁输出 auto**，也禁止整套大量横图。
         2. **内容服从产品调性**：画面内容必须贴合产品品类、价格带、使用场景与品牌气质，不能空泛堆场景。
         3. **移动端优先**：主体清晰，信息层级明确，手机端浏览时一眼能看懂。`
      : isFirstImage
        ? `【首图策划规则】：
           1. **只输出单屏首图**：当前任务只需要 1 个首图方案，禁止扩写成整套主图、多张主图或多个备选屏。
           2. **首屏点击力优先**：画面必须服务首图点击率，第一眼突出主体、核心卖点和品牌气质。
           3. **移动端优先**：主体清晰放大，信息层级明确，确保手机端缩略图和首屏都能一眼识别重点。
           4. **国家文化审美适配**：目标语言/地区为【${targetLang}】，请确保画面风格符合该地区的本土化审美。`
      : `【主图策略：平台/设备/文化深度适配】：
         1. **全局强制比例约束**：本案用户指定全局画面比例为【${effectiveMainRatio}】。你必须基于此比例进行构图策划（例如若为 3:4 则设计竖向构图，1:1 则设计正方形构图），并在每一屏方案的[-画面比例]栏位严格回填“${effectiveMainRatio}”。
         2. **平台算法匹配**：
            - 若目标平台是 **Amazon/Walmart/Ebay**：【主图1】必须严格遵循平台合规性（纯白底、无文字、无Logo、无水印、主体占比85%），侧重展示产品全貌与质感。
            - 若目标平台是 **TikTok/Shopee/Lazada/淘宝/拼多多**：【主图1】必须具备极强的“点击欲望(CTR)”。
         3. **移动端优先原则**：
            - 鉴于【${platform}】大部分流量来自移动端，所有视觉元素（尤其是产品主体）必须足够大，避免复杂的微小细节，确保在手机首屏列表页能一眼识别。
         4. **国家文化审美适配**：
            - 目标语言/地区为【${targetLang}】，请确保画面风格符合该地区的本土化审美。`;

    const systemPrompt = `R Role 角色
你是顶级电商视觉总监，负责为【${platform}】输出高转化的${planningSeriesLabel}。

T Task 任务
为【${platform}】策划 ${config.count} 屏【${planningTaskLabel}】，每屏都要给出完整可执行的视觉方案。

C Constraint 约束
1. 每一屏必须用 [SCHEME_START] 和 [SCHEME_END] 单独包裹，不能混屏。
2. 全套视觉必须统一，不能一屏一个风格。
3. 禁止编造促销活动、价格、赠品等未提供信息。
4. 描述简练、精准，内容必须服务产品卖点与产品调性。
5. ${platformLogicPrompt}
6. ${isFirstImage ? '首图模式下只允许输出 1 个首图方案；即使你想到多个方向，也只能保留当前最优方案输出。' : '按用户要求输出对应屏数，不得擅自增加屏数或补充额外方案。'}
7. ${RTCFE_COPY_LAYOUT_CONSTRAINTS}
8. 不得把文案信息混入“画面描述”栏位；若上游输入是旧格式，必须先改写成标准格式再输出。
9. ${logoUrl ? '品牌logo图仅用于识别和还原我方品牌logo，不得带入任何竞品logo或他牌标识。' : '若产品素材中出现竞品logo或他牌标识，最终方案与生成图都必须去除这些非我方品牌标识。'}

F Format 格式
每屏必须严格按以下字段顺序输出：
[SCHEME_START]
- 屏序/类型：${isDetail ? '[如：第1屏-Hero首屏]' : isFirstImage ? '[如：首图-核心视觉]' : '[如：主图1-核心卖点展示]'}
- 设计意图：一句话说明
- 画面风格：简明描述整体调性
- 画面描述：聚焦主体、场景、构图与卖点表达
${RTCFE_COPY_LAYOUT_FORMAT_BLOCK}
- 画面比例：[${ratioPromptInstruction}]
[SCHEME_END]

E Example 示例
${RTCFE_COPY_LAYOUT_EXAMPLE_BLOCK}
点缀（潇洒手写体，16pt Medium，右上角,#ff6600）：“love potion”`;

    const safeProductUrls = requireModelAssetUrls(productUrls, publicBaseUrl, '产品素材图');
    const safeStyleUrl = styleUrl ? requireModelAssetUrl(styleUrl, publicBaseUrl, '风格参考图') : '';
    const safeLogoUrl = logoUrl ? requireModelAssetUrl(logoUrl, publicBaseUrl, '品牌logo图') : '';

const userPrompt = `产品描述：${config.description}
目标语言：${targetLang}
${config.planningLogic ? `自定义叙事逻辑：${config.planningLogic}` : ""}
${referenceAnalysisSummary ? `【参考分析结论】\n${referenceAnalysisSummary}` : safeStyleUrl ? `风格参考图（已附）：${safeStyleUrl}。仅提炼其配色、光影、材质与氛围作为整套视觉基调。` : ""}
${safeLogoUrl ? `品牌logo图（已附）：${safeLogoUrl}。该图仅用于识别和还原我方品牌logo，不得把产品素材图或设计参考图中的其他品牌logo带入最终画面。若产品素材中出现竞品logo或他牌标识，最终生成图必须去除或替换为品牌logo图对应的我方logo。` : ""}

请开始策划。`;

    const inputContent: any[] = [];
    inputContent.push({ type: "text", text: `${systemPrompt}\n\n${userPrompt}` });

    // 将产品图作为输入
    safeProductUrls.forEach((url, index) => {
      inputContent.push({ type: "text", text: `[产品素材图${index + 1}] 图片URL：${url}` });
      inputContent.push({ type: "image_url", image_url: { url } });
    });
    // 将风格参考图作为输入
    if (safeStyleUrl) {
      inputContent.push({ type: "text", text: `[设计参考图] 图片URL：${safeStyleUrl}` });
      inputContent.push({ type: "image_url", image_url: { url: safeStyleUrl } });
    }
    if (safeLogoUrl) {
      inputContent.push({ type: "text", text: `[品牌logo图] 图片URL：${safeLogoUrl}` });
      inputContent.push({ type: "image_url", image_url: { url: safeLogoUrl } });
    }

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), 60000); // 60s timeout

    try {
      const analysis = await requestAnalysisResponseDetailed(inputContent, apiConfig, signal || timeoutController.signal, onJobCreated, jobMetadata);
      const content = analysis.content;
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

      logArkEvent('marketing_plan', `${planningLabel}方案策划成功`, 'success', '', {
        count: schemes.slice(0, config.count).length,
        subMode,
        creditsConsumed: analysis.creditsConsumed,
        taskId: analysis.taskId,
      });
      return { status: 'success', schemes: schemes.slice(0, config.count), creditsConsumed: analysis.creditsConsumed, taskId: analysis.taskId };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error: any) {
    const failureLabel = subMode === OneClickSubMode.DETAIL_PAGE ? '详情页' : subMode === OneClickSubMode.FIRST_IMAGE ? '首图' : '主图';
    logArkEvent('marketing_plan', `${failureLabel}方案策划失败`, 'failed', error.message, {
      count: config.count,
      subMode,
    });
    return { status: 'error', schemes: [], message: error.message };
  }
};

export const generateFirstImageReplicationSchemes = async (
  productUrls: string[],
  referenceUrls: string[],
  config: OneClickConfig,
  apiConfig: GlobalApiConfig,
  signal?: AbortSignal,
  logoUrl?: string | null,
  onJobCreated?: AnalysisJobCreatedCallback,
  jobMetadata: Record<string, unknown> = {},
): Promise<ArkSchemeResult> => {
  try {
    const publicBaseUrl = await resolveRuntimePublicBaseUrl();
    const targetLang = config.language;
    const platform = config.platform;
    const firstImageColorMode = config.firstImageColorMode === 'reference_locked' ? 'reference_locked' : 'product_adaptive';
    const ratioInstruction = config.aspectRatio === AspectRatio.AUTO
      ? '必须填入：1:1'
      : `必须填入：${config.aspectRatio || AspectRatio.SQUARE}`;
    const validReferenceUrls = referenceUrls.filter(Boolean);

    if (validReferenceUrls.length === 0) {
      return { status: 'error', schemes: [], message: '首图裂变模式必须至少上传 1 张主图参考。' };
    }
    const safeProductUrls = requireModelAssetUrls(productUrls, publicBaseUrl, '产品素材图');
    const safeReferenceUrls = requireModelAssetUrls(validReferenceUrls, publicBaseUrl, '复刻主图参考');
    const safeLogoUrl = logoUrl ? requireModelAssetUrl(logoUrl, publicBaseUrl, '品牌logo图') : '';

    logArkEvent('first_image_replication_plan', '开始策划首图裂变方案', 'started', '', {
      count: validReferenceUrls.length,
      subMode: OneClickSubMode.FIRST_IMAGE,
    });

    const settledResults = await Promise.allSettled(validReferenceUrls.map(async (referenceUrl, index) => {
      if (signal?.aborted) throw new Error('ABORTED');

      const systemPrompt = `R Role 角色
你是电商主图复刻策划总监，负责把参考主图改稿成我方商品首图方案。

T Task 任务
基于复刻主图参考、产品素材、产品卖点与目标平台，输出 1 套可直接生图的首图复刻方案。

C Constraint 约束
1. 图片角色必须严格区分：复刻主图参考${index + 1} 是唯一版式参考；产品素材图只用于识别商品本体外观、包装、配件和真实结构；品牌logo图只用于识别我方品牌，未上传时不得编造独立品牌logo。
2. 版式、构图、背景、配色、海报/页面文案位、信息层级和商品区关系只参考复刻主图参考${index + 1}；商品在画面中的位置、角度、大小关系、前后层级、道具关系和背景来自参考图原商品区；不得新增参考图中没有的模块、角标、卡片或颜色体系。
3. 商品本体必须保持与产品素材一致，禁止编造或改写包装形态、标签、颜色、配件；不得改写我方产品包装上的文字、logo、标签和外观；若策划描述与产品素材冲突，以产品素材为准。
4. 文案替换只作用于参考图里的海报/页面文案位，并对齐原文案位的字数和信息密度，禁止明显超字数；删除参考图原 logo、品牌名、店铺名、平台标识和原文案，原位置${safeLogoUrl ? '用品牌logo图或通用信息补足' : '用通用信息补足'}。
5. 品牌隔离：品牌隔离只作用于参考图里的海报/页面品牌位、店铺位、logo位、平台标识位、官方背书位和原文案，不作用于我方产品包装本体。${safeLogoUrl ? '仅使用品牌logo图识别我方独立品牌标识；不得使用参考图品牌、店铺名或模型推断品牌。' : '未上传品牌logo图时，海报/页面品牌位统一写通用信息，不写官方自营/旗舰店，不新增独立品牌logo、店铺名或模型推断品牌。'}产品素材图中商品包装自带的文字、logo、品牌名、标签和外观必须按素材原样保留，不得删除、遮挡、改写或替换。
6. 配色规则：${firstImageColorMode === 'reference_locked' ? '保持参考图配色基准，不主动改色。' : '在参考图结构内按商品属性轻量适配，并写明主色、辅助色和背景色如何调整。'}

F Format 格式
[SCHEME_START]
- 屏序/类型：首图裂变1-复刻主图参考${index + 1}
- 参考图标识：复刻主图参考${index + 1}
- 设计意图：完全基于参考图内容修改调整，保持参考图视觉效果、版式设计；若出图比例与参考图不一致，需要将参考图自适应调整为要求比例
- 画面描述：按参考图原版式写清海报/页面文案替换、参考图标识处理、商品本体替换和配色处理；画面描述不要主动改写或重新命名产品包装上的文字、logo和标签，产品包装本体按产品素材原样保留
- 画面比例：[${ratioInstruction}]
[SCHEME_END]`;

      const userPrompt = `产品信息及卖点：${config.description}
目标平台：${platform}
目标语言：${targetLang}
复刻主图参考（图片URL）：${safeReferenceUrls[index]}
产品素材公网URL（仅用于识别商品，不作为版式参考）：
${safeProductUrls.map((url, productIndex) => `- 产品素材图${productIndex + 1}：${url}`).join('\n')}
${safeLogoUrl ? `品牌logo公网URL：${safeLogoUrl}` : ''}
请先抽取复刻主图参考${index + 1}的真实版式，再把卖点替换到参考图原有海报/页面文案位。产品素材只决定替换进去的商品本体，商品区关系必须来自复刻主图参考${index + 1}；我方产品包装文字和标签按素材原样保留，不作为文案替换对象。`;

      const inputContent: any[] = [{ type: 'text', text: `${systemPrompt}\n\n${userPrompt}` }];
      inputContent.push({ type: 'text', text: `[复刻主图参考${index + 1}] 图片URL：${safeReferenceUrls[index]}。这是唯一版式、风格、信息层级参考，必须基于这张图做主图裂变。` });
      inputContent.push({ type: 'image_url', image_url: { url: safeReferenceUrls[index] } });
      safeProductUrls.forEach((url, productIndex) => {
        inputContent.push({ type: 'text', text: `[产品素材图${productIndex + 1}] 图片URL：${url}。仅用于识别商品本体外观、包装、配件和真实结构，不是版式参考。` });
        inputContent.push({ type: 'image_url', image_url: { url } });
      });
      if (safeLogoUrl) {
        inputContent.push({ type: 'text', text: `[品牌logo图] 图片URL：${safeLogoUrl}。仅用于识别和还原我方品牌标识，不是版式参考。` });
        inputContent.push({ type: 'image_url', image_url: { url: safeLogoUrl } });
      }

      const analysis = await requestAnalysisResponseDetailed(inputContent, apiConfig, signal, onJobCreated, {
        ...jobMetadata,
        shellReferenceUrl: safeReferenceUrls[index],
        shellReferenceIndex: index + 1,
      });
      const content = analysis.content;
      const tagMatch = content.match(/\[SCHEME_START\]([\s\S]*?)\[SCHEME_END\]/);
      const scheme = tagMatch?.[1]?.trim() || content.trim();
      if (!scheme) {
        throw new Error(`复刻主图参考${index + 1} 未返回有效方案。`);
      }
      return { referenceUrl: safeReferenceUrls[index], scheme, status: 'success' as const, creditsConsumed: analysis.creditsConsumed, taskId: analysis.taskId };
    }));

    const perReferenceResults = settledResults.map((result, index) => (
      result.status === 'fulfilled'
        ? result.value
        : {
            referenceUrl: safeReferenceUrls[index],
            scheme: '',
            status: 'error' as const,
            message: result.reason?.message || `复刻主图参考${index + 1} 策划失败`,
          }
    ));
    const schemes = perReferenceResults.filter((item) => item.status === 'success').map((item) => item.scheme);
    const hasSuccess = schemes.length > 0;
    const failureCount = perReferenceResults.filter((item) => item.status === 'error').length;
    const message = failureCount > 0 ? `共 ${validReferenceUrls.length} 张参考图，其中 ${failureCount} 张策划失败。` : undefined;
    const creditsConsumed = perReferenceResults.reduce((sum, item) => sum + (item.status === 'success' ? Number(item.creditsConsumed || 0) : 0), 0);

    logArkEvent('first_image_replication_plan', '首图裂变策划成功', 'success', '', {
      count: schemes.length,
      failedCount: failureCount,
      subMode: OneClickSubMode.FIRST_IMAGE,
      creditsConsumed,
    });
    const taskId = perReferenceResults
      .filter((item) => item.status === 'success')
      .map((item) => String(item.taskId || '').trim())
      .filter(Boolean)
      .join(', ');
    return { status: hasSuccess ? 'success' : 'error', schemes, perReferenceResults, message, creditsConsumed, taskId: taskId || undefined };
  } catch (error: any) {
    logArkEvent('first_image_replication_plan', '首图裂变策划失败', 'failed', error.message, {
      subMode: OneClickSubMode.FIRST_IMAGE,
    });
    return { status: 'error', schemes: [], message: error.message };
  }
};

/**
 * 策划 SKU 组合展示图方案
 */
export const generateSkuSchemes = async (
  productUrls: string[],
  giftUrls: string[],
  styleUrl: string | null,
  config: SkuConfig,
  apiConfig: GlobalApiConfig,
  signal?: AbortSignal,
  referenceAnalysisSummary?: string | null,
  onJobCreated?: AnalysisJobCreatedCallback,
  jobMetadata: Record<string, unknown> = {},
): Promise<ArkSchemeResult> => {
  try {
    const publicBaseUrl = await resolveRuntimePublicBaseUrl();
    logArkEvent('sku_plan', '开始策划SKU方案', 'started', '', {
      count: config.combinations.length,
    });

    const validCombos = config.combinations.filter(c => c.skuCopyText.trim());
    const ratioInstruction = `必须填入：${config.aspectRatio || '1:1'}`;
    const safeProductUrls = requireModelAssetUrls(productUrls, publicBaseUrl, '商品主体图');
    const safeGiftUrls = requireModelAssetUrls(giftUrls, publicBaseUrl, '赠品图');
    const safeStyleUrl = styleUrl ? requireModelAssetUrl(styleUrl, publicBaseUrl, 'SKU风格参考图') : '';

    const systemPrompt = `R Role 角色
你是 SKU 组合展示图策划视觉总监，专精高转化电商 SKU 组合展示图策划。

T Task 任务
基于商品主体图、赠品图、SKU 文案、产品信息与风格参考图，为每个 SKU 输出一套完整展示图方案。

C Constraint 约束
1. 每个 SKU 方案必须用 [SCHEME_START] 和 [SCHEME_END] 单独包裹。
2. 全套 SKU 视觉风格必须统一（色调、光影、构图逻辑一致），第一张 SKU 作为视觉基准，后续必须保持一致风格。
3. 严禁编造未提供的赠品、促销信息；传入的图片已标注角色（商品主体图/赠品图/风格参考图），策划时严格区分。
4. 画面描述中提及商品时必须同时标注身份和名称，格式：【主体商品】名称 或 【赠品】名称，禁止只写名称或只写身份。
5. 当产品规格与SKU数量存在换算关系时，必须正确理解换算，展示数量不得出错。
6. 不要机械罗列商品，以美观专业的电商展示图为目标。
7. ${RTCFE_COPY_LAYOUT_CONSTRAINTS}
8. 文案排版中的SKU文案必须完整书写，不得省略或缩写；文案内容排版必须优先使用【SKU 组合列表】里当前 SKU 对应的文案内容进行排版制作。
9. 禁止擅自新增未在【SKU 组合列表】或【产品信息】中出现的新文案；禁止把同一卖点换一种说法重复写多次，避免文案堆积和语义重复。
10. 除主标题可基于产品信息做精炼提炼外，其他文案都必须有明确依据；有产品信息时根据产品信息提炼主标题，无产品信息时直接使用SKU文案作为主标题。

F Format 格式
每个 SKU 方案必须严格按以下字段顺序输出：
[SCHEME_START]
- SKU标识：[如：SKU一 - 基础套装]
- 画面风格：xxx
- 画面描述：描述商品时必须同时标注身份和名称（如"画面中央放置【主体商品】XX面膜3盒，右下角点缀【赠品】化妆棉1包"），包含排列方式、构图逻辑、光影氛围。禁止使用“沿用SKU1的排版”“跟第一张SKU一样”“与上一张一致”这类引用式描述，必须直接写完整的画面描述、排版方式、字体风格、文字摆放和配色要求。商品必须采用正面、稳定、正常陈列的展示角度，禁止躺着放、斜着放、倾倒放置
-文案内容排版：
主标题（字体，字号字重，位置，颜色色值）：“xxx”
其他内容（字体，字号字重，位置，颜色色值）：“xxx”
...
- 画面比例：[${ratioInstruction}]
[SCHEME_END]

E Example 示例
${RTCFE_COPY_LAYOUT_EXAMPLE_BLOCK}`;

    const assetSummary = [
      `- 商品主体图: ${safeProductUrls.length}张`,
      safeGiftUrls.length > 0 ? `- 赠品图: ${safeGiftUrls.length}张` : null,
      safeStyleUrl ? `- 风格参考图: 1张` : null,
    ].filter(Boolean).join('\n');

    const comboList = validCombos.map((c, i) =>
      `SKU ${i + 1}: ${c.skuCopyText}`
    ).join('\n');

    const hasProductInfo = !!(config.productInfo && config.productInfo.trim());

    const userPrompt = `为以下 SKU 组合策划展示图方案。

【产品信息】
${hasProductInfo ? config.productInfo : '未填写（请直接使用SKU文案作为主标题）'}

【SKU 组合列表】
${comboList}

【素材清单】
${assetSummary}
${referenceAnalysisSummary ? `\n【参考分析结论】\n${referenceAnalysisSummary}` : safeStyleUrl ? `\n风格参考图：${safeStyleUrl}。除配色、光影、材质与氛围外，还要重点参考其排版、字体风格、文字摆放、版式层级，整套SKU策划都要向这张图的设计语言靠拢。` : ''}

单个 SKU 方案输出字段：
- SKU标识：[如：SKU一 - 基础套装]
- 画面风格：xxx
- 画面描述：描述商品时必须同时标注身份和名称（如"画面中央放置【主体商品】XX面膜3盒，右下角点缀【赠品】化妆棉1包"），包含排列方式、构图逻辑、光影氛围。禁止使用“沿用SKU1的排版”“跟第一张SKU一样”“与上一张一致”这类引用式描述，必须直接写完整的画面描述、排版方式、字体风格、文字摆放和配色要求。商品必须采用正面、稳定、正常陈列的展示角度，禁止躺着放、斜着放、倾倒放置
- 画面比例：[${ratioInstruction}]

要求：画面构图要有层次感，主次分明，合理推断每个 SKU 应展示的商品和赠品数量。赠品摆放不能喧宾夺主，主体商品必须最显眼、视觉占比最大。赠品可以按视觉美观适当缩小展示，不必严格还原真实大小。主体商品与赠品都必须正面、稳定、正常陈列。文案排版中的文案文字必须全部使用目标文案语言。文案排版必须优先使用【SKU 组合列表】里当前 SKU 对应的文案内容进行排版制作。禁止擅自新增未在【SKU 组合列表】或【产品信息】中出现的新文案。禁止把同一卖点换一种说法重复写多次，避免文案堆积和语义重复。除主标题可基于产品信息做精炼提炼外，其他文案都必须有明确依据。若提供了风格参考图，所有SKU方案都必须按照该参考图的排版、字体气质、文字摆放、色调与设计风格来策划。请开始策划。`;

    const inputContent: any[] = [];
    inputContent.push({ type: "text", text: `${systemPrompt}\n\n${userPrompt}` });
    safeProductUrls.forEach((url, i) => {
      inputContent.push({ type: "text", text: `[商品主体图${i + 1}] 图片URL：${url}` });
      inputContent.push({ type: "image_url", image_url: { url } });
    });
    safeGiftUrls.forEach((url, i) => {
      inputContent.push({ type: "text", text: `[赠品图${i + 1}] 图片URL：${url}` });
      inputContent.push({ type: "image_url", image_url: { url } });
    });
    if (safeStyleUrl) {
      inputContent.push({ type: "text", text: `[风格参考图 — 仅参考视觉风格，不要使用其中的商品] 图片URL：${safeStyleUrl}` });
      inputContent.push({ type: "image_url", image_url: { url: safeStyleUrl } });
    }

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), 60000);

    try {
      const analysis = await requestAnalysisResponseDetailed(inputContent, apiConfig, signal || timeoutController.signal, onJobCreated, jobMetadata);
      const content = analysis.content;
      let schemes: string[] = [];
      const tagRegex = /\[SCHEME_START\]([\s\S]*?)\[SCHEME_END\]/g;
      let match;
      while ((match = tagRegex.exec(content)) !== null) {
        if (match[1].trim()) schemes.push(match[1].trim());
      }

      if (schemes.length === 0) {
        const splitRegex = /(?=\n-?\s*(?:SKU\s*\d+|SKU[一二三四五六七八九十]|第\d+个))/i;
        const parts = content.split(splitRegex).filter(p => p.trim().length > 20);
        if (parts.length <= 1 && content.length > 100) {
          schemes = [content];
        } else {
          schemes = parts;
        }
      }

      if (schemes.length === 0) {
        throw new Error("AI 返回的内容格式不正确，无法解析为有效的SKU策划方案。");
      }

      logArkEvent('sku_plan', 'SKU方案策划成功', 'success', '', {
        count: schemes.length,
        creditsConsumed: analysis.creditsConsumed,
        taskId: analysis.taskId,
      });
      return { status: 'success', schemes: schemes.slice(0, validCombos.length), creditsConsumed: analysis.creditsConsumed, taskId: analysis.taskId };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error: any) {
    logArkEvent('sku_plan', 'SKU方案策划失败', 'failed', error.message, {
      count: config.combinations.length,
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
    const publicBaseUrl = await resolveRuntimePublicBaseUrl();
    logArkEvent('buyer_show_plan', '开始生成买家秀策划', 'started', '', {
      imageCount: state.imageCount,
      setIndex,
    });
    // 动态调整 System Prompt 逻辑
    const modelPrompt = state.includeModel
      ? `3. **Include Model Strategy**: The set must include human presence suitable for ${state.targetCountry}. The FIRST task MUST be a benchmark shot. Subsequent shots must maintain consistency. If hasFace=true, the person should look like a local user from ${state.targetCountry}.`
      : `3. **STILL LIFE Strategy**: **NO HUMAN FACES/BODIES.** Focus on product details and scenes. Hands are allowed if necessary for usage demonstration.`;

    const systemPrompt = `R Role 角色
You are an expert in generating authentic e-commerce Buyer Reviews (UGC) for ${state.targetCountry}.

T Task 任务
Create ${state.imageCount} realistic buyer-show photo concepts in JSON, plus one native-language review.

C Constraint 约束
1. Visual style must be authentic, aesthetic, clean daily life (iPhone style).
2. "Casual/Spontaneous" means natural and relaxed, not dirty, messy, chaotic, dark, or low-quality.
3. Environment must be clean, tidy, and visually pleasing; forbid trash, stained surfaces, and bad lighting.
4. The ${state.imageCount} images must form a coherent set covering context, detail, and usage/interaction.
5. ${modelPrompt}
6. If hasFace=true, the person should look like a local user from ${state.targetCountry}.

F Format 格式
Output JSON only:
{
  "tasks": [
    {
      "prompt": "Visual description in English for Image AI.",
      "style": "中文简短描述，必须使用中文。",
      "hasFace": true
    }
  ],
  "evaluation": "Native-language review"
}

E Example 示例
{
  "tasks": [
    {
      "prompt": "A clean iPhone-style product shot on a tidy desk with natural window light.",
      "style": "午后阳光下的整洁桌面",
      "hasFace": false
    }
  ],
  "evaluation": "..."
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
      ? `CRITICAL VISUAL ATMOSPHERE REFERENCE (严格参照):
A reference image is provided. You MUST strictly follow these 4 dimensions:
1. **Style**: Strictly match the overall visual style of the reference (e.g., ins风, 日系, 韩系, 欧美风). Do NOT deviate.
2. **Color Tone**: Strictly match the color temperature and color tendency (warm/cool/neutral, saturation level).
3. **Scene**: Create scenes that are SIMILAR in type but NOT identical (e.g., if reference is a café, use a different café or similar cozy space). Adapt to divergence theme: ${divergenceInstruction}
4. **Model Appearance**: If the reference contains a person, the model's temperament, style, and age range MUST closely match the reference. If hasFace=true, the person should look like a local user from ${state.targetCountry}.
PROHIBITION: Do NOT copy the exact composition of the reference. Maintain the same visual tone while creating fresh angles.`
      : `Creative Direction: ${divergenceInstruction}`;

    const userPrompt = `**MANDATORY PRODUCT CORE INFO (以下产品核心信息是策划的唯一依据，严禁编造或偏离):**
Product Name & Selling Points: ${productInfo}
All task prompts MUST revolve around these selling points and usage scenarios. Do NOT invent features or scenarios not mentioned above.

${refInstruction}

Requirement:
1. Scenarios must feel 100% authentic to local users in ${state.targetCountry}.
2. **Diversity & Logic**: The set of ${state.imageCount} images must tell a complete story.
${modelPrompt}
4. Generate exactly ${state.imageCount} tasks.

Generate the JSON response. Ensure valid JSON format.`;
    const safeProductUrls = requireModelAssetUrls(productUrls, publicBaseUrl, '产品主体图');
    const safeReferenceUrl = referenceUrl ? requireModelAssetUrl(referenceUrl, publicBaseUrl, '风格参考图') : '';

    const inputContent: any[] = [];
    inputContent.push({ type: "text", text: `${systemPrompt}\n\n${userPrompt}` });

    // 将产品图作为输入
    safeProductUrls.forEach((url, index) => {
      inputContent.push({ type: "text", text: `[产品主体图${index + 1}]` });
      inputContent.push({ type: "image_url", image_url: { url } });
    });
    // 将风格参考图作为输入
    if (safeReferenceUrl) {
      inputContent.push({ type: "text", text: `[风格参考图]` });
      inputContent.push({ type: "image_url", image_url: { url: safeReferenceUrl } });
    }

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), 60000);

    try {
      let content = await requestAnalysisResponse(inputContent, apiConfig, signal || timeoutController.signal);
      content = content.replace(/```json/g, '').replace(/```/g, '').trim();

      const firstBrace = content.indexOf('{');
      const lastBrace = content.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1) {
        content = content.substring(firstBrace, lastBrace + 1);
      }

      let result: any;
      try {
        result = JSON.parse(content);
      } catch {
        throw new Error('AI 返回内容格式异常，无法解析为 JSON');
      }

      return {
        tasks: Array.isArray(result.tasks) ? result.tasks : [],
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
    const systemPrompt = `R Role 角色
You are a local customer in ${state.targetCountry}.

T Task 任务
Write ${count} distinct, authentic product reviews for an e-commerce site.

C Constraint 约束
1. Reviews must sound natural and local.
2. Only use the provided product information.
3. Output JSON array of strings only.

F Format 格式
["Review 1...", "Review 2..."]

E Example 示例
["Great texture and easy to use.", "Looks even better in person."]`;

    const productInfo = state.productName
        ? `${state.productName}\nFeatures: ${state.productFeatures}`
        : state.productFeatures;

    const userPrompt = `Product Info: ${productInfo}
    Language: Native language of ${state.targetCountry}.

    Output Format: JSON array of strings.
    Example: ["Review 1...", "Review 2..."]`;

    const inputContent: any[] = [];
    inputContent.push({ type: "text", text: `${systemPrompt}\n\n${userPrompt}` });

    let content = await requestAnalysisResponse(inputContent, apiConfig, signal);
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
  const publicBaseUrl = await resolveRuntimePublicBaseUrl();
  const safeImageUrls = requireModelAssetUrls(imageUrls, publicBaseUrl, '参考图');
  const totalDuration = parseInt(config.duration);
  const segmentCount = Math.max(1, Math.floor(totalDuration / 8));

  const systemPrompt = `R Role 角色
你是一个拥有 10 年经验的短视频导演，擅长极简视觉和精准口播。

T Task 任务
基于参考图和卖点规划一套高一致性的视频剧本。

C Constraint 约束
1. 第一个 8 秒分镜（INITIAL）的视觉描述必须整合并包含所有提供的参考图中的核心主体元素。
2. 开场必须建立清晰的品牌/产品视觉锚点。
3. 你必须先选定一个全局唯一音色；所有分镜的 spokenContent 都必须以该音色标签开头，格式：(音色描述)：文案内容。
4. 严禁编造具体折扣、库存状态或价格，除非用户明确提供。
5. 每个分镜仅 8 秒。中文/日文每段文案严禁超过 35 字；英文/西语严禁超过 20 个单词。
6. 文案必须能在 7 秒内自然读完，预留 1 秒转场呼吸。

F Format 格式
必须返回符合目标语言的纯 JSON：
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
}

E Example 示例
{
  "voice_tag": "25岁活力女声",
  "segments": [
    {
      "title": "分镜1(0-8s) - 全主体呈现",
      "description": "镜头掠过产品全貌后停在核心细节，暖色高光勾勒质感。",
      "spokenContent": "(25岁活力女声)：开场一句就点出核心卖点。",
      "bgm": "轻快时尚电子"
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
[参考图列表 (首个分镜必须整合这些图片的主体)]: ${safeImageUrls.join('\n')}`;

  try {
    const inputContent: any[] = [];
    inputContent.push({ type: "text", text: `${systemPrompt}\n\n${userPrompt}` });

    safeImageUrls.forEach(url => {
      inputContent.push({ type: "image_url", image_url: { url } });
    });

    const rawText = await requestAnalysisResponse(inputContent, apiConfig, signal);
    if (rawText) {
        let rawContent = rawText.trim();
        if (rawContent.includes('```')) {
          rawContent = rawContent.replace(/```json/g, '').replace(/```/g, '').trim();
        }

        let parsed: any;
        try {
          parsed = JSON.parse(rawContent);
        } catch {
          throw new Error('AI 返回的视频脚本格式异常，无法解析');
        }
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
    const publicBaseUrl = await resolveRuntimePublicBaseUrl();
    logArkEvent('video_scene_plan', '开始生成视频分镜脚本', 'started', '', {
      imageCount: imageUrls.length,
      duration: config.duration,
    });
    const totalDuration = parseInt(config.duration);
    const sceneCount = Math.max(1, Math.floor(totalDuration / 5));
    const safeImageUrls = requireModelAssetUrls(imageUrls, publicBaseUrl, '参考图');
    const safeReferenceVideoUrl = referenceVideoUrl ? requireModelAssetUrl(referenceVideoUrl, publicBaseUrl, '参考视频') : '';

    const systemPrompt = `R Role 角色
你是一位世界顶级的电商视频导演和视觉策划专家。

T Task 任务
为一款产品策划一段时长为 ${totalDuration} 秒的短视频分镜脚本。

C Constraint 约束
1. 开场 3 秒必须抓住眼球。
2. 分镜必须围绕用户提供的产品卖点做视觉化呈现。
3. 分镜切换自然，符合商业大片节奏。
4. Scene 只写画面、镜头运动、光影氛围、产品动态，严禁提及文字或字幕。
5. 只输出 JSON，不要解释。

F Format 格式
{
  "scenes": [
    {
      "Scene": "详细的画面描述，包含镜头运动、光影氛围、产品动态。严禁提及文字/字幕。",
      "duration": 5
    }
  ]
}

E Example 示例
{
  "scenes": [
    {
      "Scene": "镜头从产品包装缓慢推进到核心细节，暖色光线扫过表面质感。",
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
    ${safeReferenceVideoUrl ? `参考视频风格：${safeReferenceVideoUrl}` : ""}

    请开始策划。`;

    const inputContent: any[] = [];
    inputContent.push({ type: "text", text: `${systemPrompt}\n\n${userPrompt}` });

    safeImageUrls.forEach(url => {
      inputContent.push({ type: "image_url", image_url: { url } });
    });

    let content = await requestAnalysisResponse(inputContent, apiConfig, signal);
    content = content.replace(/```json/g, '').replace(/```/g, '').trim();

    const firstBrace = content.indexOf('{');
    const lastBrace = content.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      content = content.substring(firstBrace, lastBrace + 1);
    }

    let result: any;
    try {
      result = JSON.parse(content);
    } catch {
      throw new Error('AI 返回的分镜脚本格式异常，无法解析');
    }
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
