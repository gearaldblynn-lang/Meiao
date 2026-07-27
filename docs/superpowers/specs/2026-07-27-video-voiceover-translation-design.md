# 视频口播翻译设计

**日期：** 2026-07-27  
**状态：** 用户已确认，等待实施计划  
**目标环境：** 本地当前版本完成实现与验收；腾讯云发布另行确认

## 1. 目标

在「短视频」模块新增独立子功能「口播翻译」。用户上传一段单人口播视频，选择目标语言后，系统自动识别原语言和口播时间段，把原口播翻译为目标语言、使用 Gemini 3.1 Flash TTS 生成新口播，并在不重做画面和嘴型的前提下替换回原视频。

最终视频必须保留原背景音乐、环境音和音效。用户可选择同时调用现有 Golden 去字幕能力，先清除画面中的原字幕或文案，再输出目标语言口播视频。

## 2. 已确认的产品决策

- 功能名称固定为「口播翻译」，作为短视频模块的独立子功能。
- 首版一次只处理一个视频，只支持单个说话人。
- 系统自动识别原语言，用户只选择目标语言。
- 目标语言列表先显示常用语言，并通过「更多语言」展开当前 TTS 模型支持的完整列表。
- 翻译模式提供：
  - `natural`：自然口播，允许在保持原意和营销语气的前提下调整文案长度。
  - `literal`：忠实直译，优先保持原文含义和句子结构。
- 音色默认自动匹配原口播的音高、明亮度、能量、节奏和口音特征；高级设置允许用户手动选择 Gemini 预设音色。
- 不修改人物嘴型，不重新生成视频画面。
- 原口播通过腾讯云服务器本地 Demucs 分离；不接入 fal.ai，不产生 fal.ai 按次费用。
- 新口播由用户提供的 KIE `google/gemini-3-1-flash-tts` 接口生成。
- 可选「同时去文案」：
  - 默认关闭。
  - 开启后默认选择画面底部 30%。
  - 用户可拖动、缩放字幕区域。
  - 使用现有 Golden 去字幕任务链。
- 不人为设置 60 秒或 3 分钟的产品上限。有效上限由 TTS 输入合同、现有素材大小保护、处理超时，以及勾选去文案时 Golden 的 600 秒上限共同决定。
- 首轮只完成本地当前版本的实现与验证，不自动提交、推送或部署腾讯云。

## 3. 范围

### 3.1 本次包含

- 新增 `voiceover_translation` 视频子功能、独立工作区和项目卡。
- 本地视频上传，以及从已完成视频结果卡带入素材。
- 单视频媒体分析、必要转码和用户素材所有权校验。
- 可选 Golden 去字幕区域编辑与任务复用。
- 腾讯云本地 Demucs 人声/背景声两轨分离。
- 使用现有 Gemini 视频分析能力完成：
  - 源语言识别。
  - 单/多人检测。
  - 原文转写。
  - 时间段提取。
  - 音色特征分析。
  - 目标语言翻译。
- KIE Gemini 3.1 Flash TTS provider adapter、创建、查询、恢复和结果转存。
- 分段口播的安全变速、时间轴放置、背景声压低和最终混音。
- 中间素材、任务检查点、刷新恢复、服务重启恢复、取消和安全重试。
- 业务日志、管理员诊断信息、非敏感 readiness、环境配置和项目文档。
- 自动化测试、本地真实 provider canary 和真实浏览器验收。

### 3.2 本次不包含

- 人物嘴型同步或视频画面重生成。
- 原人物音色克隆；只使用 Gemini 预设音色和风格控制。
- 多人对话、多说话人音色分配或重叠语音处理。
- 批量视频上传与批量项目卡。
- 用户手动编辑识别稿或译文。
- 自动生成目标语言字幕。
- 把本地 Demucs 计算虚构成外部计费项目。
- 在未单独确认的情况下发布腾讯云。

## 4. 用户流程

### 4.1 直接上传

1. 用户进入「短视频 → 口播翻译」。
2. 上传一个视频。
3. 系统读取时长、分辨率、容器、编码和音轨。
4. 用户选择目标语言、翻译模式和音色模式。
5. 用户可开启「同时去文案」并调整默认底部 30% 区域。
6. 用户点击「开始口播翻译」。
7. 确认层显示视频时长、目标语言、翻译模式、音色、是否去文案，以及会调用的计费模型。
8. 确认后创建一张耐久项目卡；用户可以离开页面。

### 4.2 从已有视频进入

1. 已完成、当前用户可访问且存在托管 `videoUrl` 的视频结果显示「口播翻译」。
2. 点击后切换到口播翻译工作区并带入原项目、原结果和源视频身份。
3. 系统读取权威媒体信息后进入与直接上传相同的配置和提交流程。
4. 新任务创建独立项目卡，不覆盖原视频项目。

### 4.3 进度与结果

项目卡按真实阶段显示：

```text
准备视频
  -> 可选去文案
  -> 提取音频
  -> 分离原口播
  -> 识别原文
  -> 翻译
  -> 生成新口播
  -> 对齐混音
  -> 保存结果
  -> 完成
```

完成后结果卡提供：

- 原视频与译制视频切换播放。
- 检测到的原语言和目标语言。
- 最终使用的 Gemini 音色。
- 原文和译文展开查看。
- 下载译制视频。
- 失败项的安全重试。
- 未进入不可取消上游阶段时的取消入口。

## 5. 前端设计

### 5.1 子功能与工作区

- `MODULE_SUB_FEATURES[AppModuleObj.VIDEO]` 顺序调整为：
  - `generation`：短视频生成
  - `storyboard`：分镜生成
  - `voiceover_translation`：口播翻译
  - `subtitle_removal`：去字幕
  - `diagnosis`：视频诊断
- `VideoModule` 在 `voiceover_translation` 下渲染独立 `VoiceoverTranslationWorkspace`。
- 工作区挂载到新的共享底部槽位 `voiceover-translation-composer-slot`，不显示普通视频 prompt 输入器。
- 页面遵守项目既有自然滚动规则，不使用会裁掉内容的固定高度内部滚动区。
- 首版只允许一个活动草稿和一个视频；选择第二个视频时要求先替换当前视频。

### 5.2 配置项

- `targetLanguage`：必填目标语言。
- `translationMode`：`natural | literal`，默认 `natural`。
- `voiceMode`：`auto | preset`，默认 `auto`。
- `voiceName`：`voiceMode=preset` 时必填，并且必须来自服务端公布的当前 Gemini 音色目录。
- `removeText`：布尔值，默认 `false`。
- `subtitleRegionNormalized`：`removeText=true` 时必填，默认 `{ x: 0, y: 0.70, width: 1, height: 0.30 }`。

常用语言直接显示；「更多语言」展开同一版本化目录中的其余语言。前端不得自行添加 provider 未支持的语言代码。

音色高级设置显示预设音色名称和简短特点，不宣称克隆原声。自动音色的实际选择在分析完成后写入项目卡。

### 5.3 输入准备

- 复用现有媒体 session、FFprobe、FFmpeg 和托管素材上传能力。
- 新增 `voiceover_translation` 媒体 profile：
  - 必须存在视频轨和音轨。
  - 输出兼容 H.264、`yuv420p`、AAC、MP4、`faststart`。
  - 保持原始画幅，不裁切、不补黑边。
  - 已兼容素材不重复转码。
  - 输入字节数继续由现有媒体上传上限保护。
  - 处理时间由环境超时保护，不把固定秒数冒充 TTS 模型上限。
- 若开启去文案，视频还必须满足现有 Golden `subtitle_removal` profile 的 600 秒合同。

### 5.4 项目卡

- 项目使用 `module='video'`、`subFeature='voiceover_translation'`。
- 结果保存源视频、最终视频、源/目标语言、翻译模式、音色、原文、译文、可选字幕区域、来源项目身份和后台任务身份。
- 卡片阶段来自后台 durable job，不以浏览器本地计时猜测。
- 历史项目在功能关闭后仍可查看和下载；功能开关只禁止新提交。

## 6. 后端任务合同

### 6.1 父任务

- 新任务类型：`voiceover_translate_video`。
- 父任务由内部复合 runner 执行，不把整条流水线伪装成单一 KIE provider。
- 父任务 payload 至少包含：

```ts
type VoiceoverTranslationPayload = {
  taskType: 'voiceover_translate_video';
  taskPurpose: 'voiceover_translation';
  userId: string;
  sourceAssetId?: string;
  sourceUrl: string;
  sourceProjectId?: string;
  sourceResultId?: string;
  shellProjectId: string;
  shellProjectName: string;
  shellResultId: string;
  clientSubmissionKey: string;
  targetLanguage: string;
  translationMode: 'natural' | 'literal';
  voiceMode: 'auto' | 'preset';
  voiceName?: string;
  removeText: boolean;
  subtitleRegionNormalized?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};
```

- `clientSubmissionKey` 由用户、源素材稳定身份、目标语言、翻译模式、音色模式、去文案设置和区域组成。重复点击只复用活动父任务。
- 父任务继承现有 `videoGeneration` 权限、账号隔离、并发和预算保护。

### 6.2 版本化检查点

运行中的检查点写入 `internal_jobs.result_json` 的受限 `voiceoverCheckpoint` 对象；本地 JSON 与 MySQL handler 必须使用同一归一化函数。终态结果保留同一对象的必要审计字段。

```ts
type VoiceoverCheckpointV1 = {
  version: 1;
  stage:
    | 'input_prepared'
    | 'subtitle_removal'
    | 'audio_extracted'
    | 'voice_separated'
    | 'speech_analysis_submitting'
    | 'speech_analyzed'
    | 'translated'
    | 'tts_generating'
    | 'audio_aligned'
    | 'result_persisted';
  baseVideoAssetId: string;
  originalAudioAssetId?: string;
  vocalAssetId?: string;
  backgroundAssetId?: string;
  subtitleRemoval?: {
    childJobId: string;
    providerTaskId?: string;
    resultAssetId?: string;
  };
  analysis?: {
    sourceLanguage: string;
    speakerCount: number;
    voiceProfile: VoiceoverVoiceProfile;
    segments: VoiceoverTranscriptSegment[];
  };
  translation?: {
    targetLanguage: string;
    mode: 'natural' | 'literal';
    segments: VoiceoverTranslationSegment[];
    selectedVoiceName: string;
  };
  ttsGroups?: Array<{
    index: number;
    childJobId: string;
    providerTaskId?: string;
    assetId?: string;
    status: 'queued' | 'submitted' | 'succeeded' | 'failed';
  }>;
  finalAssetId?: string;
};
```

- 检查点 schema 拒绝未知大字段和超限文本，不能成为另一个无限增长的 app state。
- 原文和译文按 provider 文本上限裁定；不得把音频二进制、签名 URL、密钥、授权头或本地临时路径写入检查点。
- 每个阶段只有在其托管中间素材或结构化结果已经耐久保存后才能推进。

### 6.3 子任务与付费幂等

- 可选去文案使用现有 `subtitle_remove_video` 子任务。
- 每个 TTS 口播组使用新 `kie_tts` 子任务，独立保存自己的 `providerTaskId`。
- 子任务使用由父任务 ID 和组序号推导的稳定提交键；父任务恢复时按稳定键查找或复用子任务。
- 已有 `providerTaskId` 的 KIE TTS 子任务只能查询，不得再次 POST 创建。
- 创建请求连接中断且无法确认上游是否接单时，子任务进入 `provider_submission_unknown`，父任务停止，不自动重提。
- Gemini 同步分析调用在请求前写 `stage='speech_analysis_submitting'` 检查点，成功后写 `stage='speech_analyzed'` 和完整分析结果。进程若在两者之间丢失，进入 `voiceover_analysis_submission_unknown`，由用户明确重试，避免静默产生第二次计费调用。
- 本地 Demucs 不产生外部费用；如果进程在输出耐久保存前中断，可以安全重新计算。

## 7. 本地人声分离

### 7.1 模型与运行方式

- 使用官方 Demucs v4.0.1 非量化 `mdx` 模型和 `--two-stems=vocals`；避免原 `mdx_q`/diffq 的 CC-BY-NC 与 CPython 3.11 native-build 风险。
- 使用独立 Python 虚拟环境运行，不把 PyTorch 加入 Node 主进程。
- Node 通过参数数组调用 `python -m demucs.separate`，禁止拼接 shell 字符串。
- 输入为服务端生成的 WAV，输出为 `vocals.wav` 和 `no_vocals.wav`。
- 分离任务默认全局单并发；子进程使用较低 CPU 优先级，超时或用户取消时终止整个进程组。
- 每个任务使用独立 `mkdtemp` 目录；成功保存托管素材或失败后均清理临时目录。

### 7.2 安装与 readiness

- 仓库跟踪精确锁定的 Python 依赖清单、安装脚本、模型清单、下载地址和 SHA-256。
- Python 虚拟环境、PyTorch 包和模型权重不提交 Git。
- 模型在部署准备阶段下载到发布目录之外的持久模型目录并校验哈希。
- 应用运行时禁止自动下载模型；模型缺失或哈希不符时 readiness 为 false，新提交在任何计费调用前拒绝。
- 健康接口只公开：
  - 功能是否启用。
  - Python 是否可执行。
  - 模型是否就绪。
  - 当前本地分离并发限制。
- 健康接口不公开本地绝对路径、下载地址、环境变量值或密钥。

### 7.3 资源配置

新增环境变量：

- `MEIAO_VOICEOVER_TRANSLATION_ENABLED`：默认关闭。
- `MEIAO_VOICEOVER_SEPARATION_PYTHON`：独立虚拟环境 Python 路径。
- `MEIAO_VOICEOVER_DEMUCS_MODEL`：默认 `mdx`，仅允许服务端白名单。
- `MEIAO_VOICEOVER_DEMUCS_MODEL_DIR`：持久模型目录。
- `MEIAO_VOICEOVER_SEPARATION_CONCURRENCY`：默认 `1`，限制 `1..2`。
- `MEIAO_VOICEOVER_SEPARATION_TIMEOUT_MS`：默认 `3600000`，限制 `300000..7200000`。
- `MEIAO_VOICEOVER_MIN_ATEMPO`：默认 `0.75`，限制 `0.5..1`。
- `MEIAO_VOICEOVER_MAX_ATEMPO`：默认 `1.35`，限制 `1..2`。
- `MEIAO_VOICEOVER_TTS_MAX_INPUT_TOKENS`：默认 `8192`，只允许降低当前模型目录声明的上限。
- `MEIAO_VOICEOVER_GROUP_GAP_MS`：默认 `800`，限制 `0..3000`。
- `MEIAO_VOICEOVER_TIMESTAMP_OVERLAP_TOLERANCE_MS`：默认 `150`，限制 `0..1000`。
- `MEIAO_VOICEOVER_DUCKING_DB`：默认 `4`，限制 `0..12`。
- `MEIAO_VOICEOVER_FADE_MS`：默认 `40`，限制 `0..200`。
- `MEIAO_VOICEOVER_DURATION_TOLERANCE_MS`：默认 `100`，限制 `20..500`。
- `MEIAO_VOICEOVER_INTERMEDIATE_TTL_MS`：默认 `259200000`（72 小时），限制 `3600000..2592000000`。
- `MEIAO_KIE_TTS_BASE_URL`：默认 `https://api.kie.ai`，只由服务端读取。
- `MEIAO_KIE_TTS_MODEL`：默认 `google/gemini-3-1-flash-tts`，只允许服务端白名单。

非法值回到保守默认。所有变量同步写入 `.env.server.example`、部署文档和项目概览。

## 8. 识别、翻译与音色选择

### 8.1 Gemini 分析合同

- 复用系统当前有效视频分析模型和现有私有 COS 签名读取链路。
- 分析输入使用原视频和本地分离出的 vocal 托管素材；provider 不支持独立音频输入时，以保持原画面的受控 vocal-only 视频作为等价输入，不回退到不受控公网图床。
- Prompt 必须遵守 RTCFE，并要求严格 JSON：

```ts
type VoiceoverAnalysis = {
  sourceLanguage: string;
  speakerCount: number;
  voiceProfile: {
    pitch: 'low' | 'medium' | 'high';
    brightness: 'dark' | 'balanced' | 'bright';
    energy: 'calm' | 'balanced' | 'energetic';
    pace: 'slow' | 'natural' | 'fast';
    accentDescription: string;
  };
  segments: Array<{
    id: string;
    startMs: number;
    endMs: number;
    sourceText: string;
    targetText: string;
  }>;
};
```

- `speakerCount !== 1` 时在 KIE TTS 前失败。
- 片段必须按时间升序、位于视频范围内、`endMs > startMs`，并且不能存在超出容差的重叠。
- `natural` 模式要求译文适配原时间预算；`literal` 模式优先保持原意，但仍不得生成无法安全对齐的异常长度。
- 解析失败、语言不支持、空口播或时间轴非法都不能进入 TTS。

### 8.2 语言目录

- 语言目录为服务端版本化常量，来源于当前 Gemini 3.1 Flash TTS 官方支持列表。
- 每项包含稳定语言代码、中文名称、英文名称和 `common` 标记。
- KIE wrapper 未提供实时能力查询，因此前端不伪装为动态探测；升级模型或支持列表时通过代码和契约测试更新目录。
- 当前模型目录声明 `maxInputTokens=8192`。TTS adapter 把序列化后的 `speakers`、`dialogue_turns`、场景和上下文纳入同一预算；没有可用的精确 Gemini tokenizer 时，以 UTF-8 字节数作为保守上界估算并提前分组，不把估算值伪装成精确 token 数。
- 没有独立视频秒数上限。TTS adapter 在提交前按上述当前模型输入合同验证每个口播组。
- 开启去文案时额外应用 Golden 600 秒上限；关闭时只受媒体字节、处理超时和实际 TTS 输入合同限制。

### 8.3 音色目录与自动匹配

- 音色目录使用 Gemini 3.1 Flash TTS 当前 30 个预设音色及其官方特点。
- 自动匹配只使用音高、明亮度、能量、节奏和口音描述，不推断或持久化用户的敏感人口属性。
- 映射为确定性纯函数；同一 `voiceProfile` 得到同一 `voiceName`。
- 手动预设音色覆盖自动选择，但不改变翻译和时间轴。
- 同一父任务所有 TTS 组使用同一音色、场景和 sample context，保持一致性。

## 9. KIE Gemini TTS 适配

- 新建独立 `server/providerKieTts.mjs`，不把 TTS 分支继续塞入已经集中过多 provider 的通用 gateway。
- 创建接口：
  - `POST https://api.kie.ai/api/v1/jobs/createTask`
  - `model='google/gemini-3-1-flash-tts'`
  - `input.speakers` 和 `input.dialogue_turns` 按文档要求序列化为 JSON 字符串。
- 查询接口：
  - `GET https://api.kie.ai/api/v1/jobs/recordInfo?taskId=...`
- 适配器负责：
  - 输入和音色白名单校验。
  - 创建、查询和状态归一化。
  - `waiting | success | fail` 映射。
  - `resultJson` 二次 JSON 解析和音频 URL 提取。
  - 401、402、429、5xx、网络、超时和无效响应分类。
  - provider task ID 即时 checkpoint。
  - 临时结果音频转存为用户隔离的梅奥托管素材。
- KIE key 只从服务端既有环境配置读取，不进入前端、payload、检查点或日志。
- TTS 组按相邻口播片段和模型输入上限合并，不能每句话无条件创建一次任务，也不能把超限全文塞入一次请求。

## 10. 音频对齐与最终混音

### 10.1 口播组

- 相邻间隔不超过 `MEIAO_VOICEOVER_GROUP_GAP_MS` 且总输入未超模型限制的片段合并为一个 TTS 组。
- 每组保存目标起止时间、译文、预计语速、实际音频时长和安全变速比。
- TTS 提交前根据目标时间预算选择 `pace`。
- TTS 完成后使用 FFmpeg `atempo` 做无变调时间适配。
- 适配比必须位于 `MEIAO_VOICEOVER_MIN_ATEMPO..MEIAO_VOICEOVER_MAX_ATEMPO`。
- 超出安全范围时返回 `voiceover_timing_out_of_range`；不得静默创建第二个收费 TTS 任务。

### 10.2 混音

- vocal 统一为 48 kHz 单声道工作轨。
- `no_vocals` 保持双声道并统一为 48 kHz。
- 每个新口播组按原始 `startMs` 放置，首尾按 `MEIAO_VOICEOVER_FADE_MS` 淡入淡出，避免拼接爆音。
- 口播存在时按 `MEIAO_VOICEOVER_DUCKING_DB` 对背景轨做轻度 sidechain ducking；FFmpeg readiness 必须验证所用 filter，不能上线后才发现构建不支持。
- 混合轨做峰值保护，禁止削波。
- 最终画面使用：
  - `removeText=false`：规范化原视频。
  - `removeText=true`：Golden 去字幕托管结果。
- 视频轨在合同兼容时直接复制，不重新编码画面；音频编码为 AAC。
- 音轨不足时补静音，超出时按权威视频时长裁切；最终视频总时长与底片误差不超过 `MEIAO_VOICEOVER_DURATION_TOLERANCE_MS`。
- 最终 MP4 使用 `faststart`，转存后验证 `video/mp4`、H.264、AAC、`ftyp`、时长和 HTTP Range。

## 11. 中间素材生命周期

- 原始提取音频、vocals、no-vocals 和每个 TTS 组音频都存为用户隔离的私有托管素材。
- 中间素材带父 job、stage、用户和内容哈希，不暴露为公开素材库条目。
- 活动任务和可恢复失败任务保留中间素材。
- 成功任务或不可恢复失败任务经过 `MEIAO_VOICEOVER_INTERMEDIATE_TTL_MS` 后由清理 worker 删除中间素材。
- 最终视频和用户需要查看的原视频不受中间素材清理影响。
- 删除项目时按引用关系清理，不删除仍被源项目引用的视频。

## 12. 取消、失败与重试

- 本地准备、Demucs、分析前等待、混音和结果保存阶段可取消。
- 已创建的 Golden 或 KIE 任务若上游没有取消接口，不向用户展示虚假的“已取消上游”；本地取消只停止后续阶段并保留 task ID 供管理员核对。
- 错误代码至少覆盖：
  - `voiceover_unavailable`
  - `voiceover_source_has_no_audio`
  - `voiceover_no_speech_detected`
  - `voiceover_multiple_speakers`
  - `voiceover_language_unsupported`
  - `voiceover_analysis_invalid`
  - `voiceover_analysis_submission_unknown`
  - `voiceover_separation_unavailable`
  - `voiceover_separation_timeout`
  - `voiceover_tts_input_too_large`
  - `voiceover_timing_out_of_range`
  - `provider_submission_unknown`
  - `provider_balance_insufficient`
  - `provider_rate_limited`
  - `provider_timeout`
  - `voiceover_mix_failed`
  - `voiceover_result_persist_failed`
- 若 Golden 失败，停止人声分离和 TTS。
- 若本地分离、分析、多人检查或语言检查失败，停止 TTS。
- 若某个 TTS 组失败，保留已完成组及其 task ID；重试只处理失败或未创建的组。
- 只有用户明确触发且界面提示可能新增计费时，才允许为已经明确失败的 provider 任务创建新尝试。

## 13. 权限、安全与日志

- 输入只能是当前用户拥有的梅奥托管视频；服务端不接受任意外部 URL 绕过素材权限。
- 分析、Golden、TTS 和结果访问都沿用当前用户身份、shell project 和 job owner。
- 子进程参数使用数组，文件名不进入 shell，临时目录不可由客户端指定。
- Python 路径、模型目录和模型名均由服务端配置与白名单控制。
- 日志记录父 job、子 job、阶段、耗时、模型名、脱敏 provider task ID、结果和结构化错误。
- 日志不记录 KIE key、完整签名 URL、授权头、音频内容、完整 provider 请求体或其他用户素材。
- 业务日志补充开始、成功、失败、取消、重试和下载；管理员可以按「口播翻译」筛选。
- 系统公开配置只返回 feature、readiness、语言/音色目录和非敏感限制。

## 14. 计费边界

- Demucs 本地分离不产生第三方按次费用，只消耗腾讯云资源。
- Gemini 视频分析、KIE TTS 和可选 Golden 去字幕仍可能产生费用。
- 确认层只说明会调用哪些计费阶段；provider 没有可靠预报价时不展示虚假金额。
- 父任务继承现有账号预算和提交门禁；任何前置校验失败都必须发生在对应付费 POST 之前。
- 真实验收只提交完成闭环所需的最小任务；已有 task ID 时只恢复查询。

## 15. 测试策略

### 15.1 前端与纯逻辑

- 口播翻译子功能路由、共享底部槽位和普通 BottomInputBar 排除。
- 单视频上传、替换、已有项目带入和临时草稿清理。
- 常用语言、更多语言、非法语言和目录升级。
- 自动音色、手动音色、非法音色和确定性自动映射。
- 自然口播/忠实直译参数。
- 去文案开关、默认底部 30%、拖动、缩放和像素换算。
- 确认摘要、提交锁、重复点击和项目卡阶段。
- 原文/译文展开、原片/结果切换、下载、失败重试和取消。
- 默认视口与 820px 窄屏，不裁切内容。

### 15.2 本地分离 runner

- Python、模型、哈希和 FFmpeg readiness。
- `mdx`、CPU、two-stems 参数精确且不经过 shell。
- 文件名含空格和特殊字符时不注入命令。
- 单并发、排队、超时、取消、进程组退出和临时目录清理。
- vocals/no-vocals 缺失、空文件、时长漂移和无效 WAV 失败。
- 分离完成后中间素材耐久保存，恢复不重复计算。

### 15.3 分析与翻译

- RTCFE prompt 保留严格 JSON 字段和解析锚点。
- 单人、多人、无人声、空文本、未知语言和不支持语言。
- 时间段越界、倒序、超过 `MEIAO_VOICEOVER_TIMESTAMP_OVERLAP_TOLERANCE_MS` 的重叠和超长译文。
- 两种翻译模式的长度预算和语义约束。
- 分析提交状态未知时不自动重提。

### 15.4 KIE TTS provider

- 创建 body 精确匹配 `speakers`、`dialogue_turns`、`temperature`、`scene` 和 `sample_context`。
- 30 个音色白名单和语言目录合同。
- waiting/success/fail、无 task ID、无效 `resultJson`、无音频 URL。
- 401、402、429、5xx、网络错误和超时。
- task ID 在轮询前 checkpoint。
- 已有 task ID 只查询。
- 成功音频在子任务 succeeded 前转存为梅奥托管素材。
- 结果转存失败只重抓旧 provider 结果，不重新创建 TTS。

### 15.5 父任务与恢复

- 稳定 `clientSubmissionKey` 复用活动父任务。
- MySQL 与本地 JSON 的 checkpoint 读写和归一化一致。
- 可选 Golden 子任务复用现有安全恢复合同。
- 多个 TTS 组各自恢复，不重复完成组。
- 本地阶段重算与付费阶段不重提的边界。
- 刷新、Node 重启和 worker 恢复后的项目卡一致。
- 删除写墓碑，不复活、不跨用户。

### 15.6 FFmpeg 与资产

- 口播组放置、静音填充、atempo 上下界、淡入淡出和 sidechain filter。
- 背景声存在，旧 vocal 不进入最终混合输入。
- 视频轨 copy、AAC 输出、总时长误差不超过 `MEIAO_VOICEOVER_DURATION_TOLERANCE_MS`。
- 最终 `video/mp4`、H.264、AAC、`ftyp`、Range 206。
- 中间素材保留和到期清理不影响最终结果。

## 16. 本地验收

### 16.1 工程门禁

- Hermes Harness 按实际改动文件运行。
- 定向前后端测试。
- `npm run lint`
- `npm run build`
- `npm run doctor`
- `npm run verify`
- `git diff --check`
- Python 依赖锁、Demucs 模型哈希和 readiness 探针。

### 16.2 真实功能 canary

使用一段短小、拥有使用权、包含单人口播和背景音乐的测试视频：

1. `removeText=false` 完成一条真实任务。
2. 验证旧口播不可辨识，背景音乐和环境音仍存在。
3. 验证新口播语言、音色、分段时间和总时长。
4. 在同一测试素材上验证手动音色配置；优先复用已完成分析和分离结果，不重复创建无必要的付费任务。
5. `removeText=true` 时只提交一次最短 Golden canary，验证画面去文案和口播替换的组合结果。
6. 刷新页面和重启本地服务，确认已有 Golden/KIE task ID 只查询、不重建。

### 16.3 浏览器验收

- 默认视口和 820px 窄屏。
- 上传、已有项目带入、配置、区域编辑和确认层。
- 所有处理阶段的真实进度。
- 原片/结果播放、原文/译文、下载、取消和失败提示。
- 技术验证和实际听感、画面观察分别记录；provider 成功、文件探针或自动测试不能替代人工观看与试听。

## 17. 文档与发布边界

- 新增 API、任务类型、环境变量、模型安装和运行手册同步更新：
  - `.env.server.example`
  - `docs/project-overview.md`
  - `docs/tencent-cloud-deploy.md`
  - `项目交接上下文.md`
  - `docs/release-and-handoff.md`
- 新增 prompt 同步更新 RTCFE migration map 和回归测试。
- 本轮完成本地当前版本实现、验证和提交。
- 未经用户后续明确确认，不执行 GitHub 推送、腾讯云模型安装、生产配置变更或部署。
- 云上发布前必须单独检查服务器 CPU、内存、磁盘余量和 Demucs canary 耗时，再决定是否启用入口。

## 18. 成功标准

- 用户可以上传一个单人口播视频或从已有结果带入视频。
- 系统自动识别源语言，用户可以选择目标语言、翻译模式和自动/手动音色。
- 可选去文案使用现有 Golden 区域合同，默认底部 30% 且可调整。
- 原视频画面和总时长保持不变，不做嘴型同步。
- 旧口播不可辨识，背景音乐、环境音和音效仍可听见。
- 新口播使用目标语言，并与原讲话时间段基本对齐。
- 本地 Demucs 默认单并发，不拖垮 Node 服务；缺模型时在计费调用前失败。
- 任一 Golden 或 KIE 任务最多创建一次；刷新、重启和恢复不重复扣费。
- 最终结果为用户隔离的梅奥托管 H.264/AAC MP4，可播放、下载并支持 Range。
- 自动化门禁、真实 provider canary、浏览器页面和实际试听均通过后，才可称为本地功能完成。
