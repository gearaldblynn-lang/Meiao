import React from 'react';
import { AspectRatio, VideoStoryboardConfig, VideoSubMode } from '../../types';
import { safeCreateObjectURL } from '../../utils/urlUtils';
import { PopoverSelect, PrimaryActionButton, SegmentedTabs, SidebarShell, UploadSurface } from '../../components/ui/workspacePrimitives';

interface Props {
  config: VideoStoryboardConfig;
  disabled: boolean;
  subMode: VideoSubMode;
  onSubModeChange: (next: VideoSubMode) => void;
  onChange: (updater: (prev: VideoStoryboardConfig) => VideoStoryboardConfig) => void;
  onGenerate: () => void;
}

const SCRIPT_PRESETS: Record<string, string> = {
  custom: '',
  ecommerce: `高转化电商短视频逻辑："吸引-建立信任-激发欲望-促成成交"的行为诱导逻辑。

第一阶段：视觉钩子 (Hook)
强吸引：1.5秒内抓住注意力。采用动态递入或特写冲击，配合核心卖点的视觉化呈现。
整体建立 (The Scene)：交代空间背景，通过中景画面建立品牌调性。

第二阶段：核心价值 (Value)
卖点展示：基础属性（展示产品的物理属性）/ 差异化（放大竞争对手没有的优势）/ 细节强化（显微镜视角，通过极微距展示建立"高端、高品质"的心理暗示）。

第三阶段：体验沉浸 (Experience)
使用强化（预见使用场景）/ 互动强化（模拟用户自己的视角情感共鸣）。

第四阶段：临门一脚 (Action)
信任总结（理性背书，消除用户最后的顾虑）/ 强收尾（产品最终全景展示，配合引导下单的口播，完成从流量到销量的闭环）。`,
  viral: `爆款短视频带货逻辑：核心公式：强停留 -> 强展示 -> 强转化。

一阶段：开头强钩子，要么视觉炸，要么情绪炸。
二阶段：场景锚定核心价值。
三阶段：用强对比或评论入口收尾，拉高传播动机。`,
};

const COUNTRY_PRESETS = [
  '中国/中文',
  '美国/英文',
  '日本/日文',
  '韩国/韩文',
  '法国/法文',
  '德国/德文',
  '俄罗斯/俄文',
  '西班牙/西班牙文',
  '葡萄牙/葡萄牙文',
  '墨西哥/西班牙文',
  '泰国/泰文',
  '越南/越南文',
  '印尼/印尼文',
  '阿拉伯/阿拉伯文',
];

const MULTI_IMAGE_SHOT_MAP: Record<string, VideoStoryboardConfig['shotCount']> = {
  '5s': 3,
  '10s': 6,
  '15s': 9,
  '30s': 12,
};

const getSingleImageMaxShots = (duration: string): number => {
  switch (duration) {
    case '5s': return 3;
    case '10s': return 6;
    default: return 12;
  }
};

const StoryboardSidebar: React.FC<Props> = ({ config, disabled, subMode, onSubModeChange, onChange, onGenerate }) => {
  const videoInputRef = React.useRef<HTMLInputElement>(null);
  const maxShots = getSingleImageMaxShots(config.duration);
  const isViralMode = config.videoGenerationMode === 'viral_split';
  const hasProductAssets = Math.max(config.productImages.length, config.uploadedProductUrls.length) > 0;
  const hasReferenceVideo = Boolean(config.referenceVideoFile || config.uploadedReferenceVideoUrl);
  const canGenerate = hasProductAssets && (!isViralMode || hasReferenceVideo);
  const allShotOptions: Array<{ value: VideoStoryboardConfig['shotCount']; label: string }> = [
    { value: 1, label: '1 格' },
    { value: 3, label: '3 格' },
    { value: 4, label: '4 格' },
    { value: 6, label: '6 格' },
    { value: 8, label: '8 格' },
    { value: 9, label: '9 格' },
    { value: 12, label: '12 格' },
  ];
  const shotCountOptions = config.generationMode === 'single_image'
    ? allShotOptions.filter((o) => o.value <= maxShots)
    : allShotOptions;

  const handleFieldChange = (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = event.target;

    onChange((prev) => {
      if (name === 'duration') {
        const nextDuration = value as VideoStoryboardConfig['duration'];
        let nextShotCount = prev.shotCount;
        if (prev.generationMode === 'multi_image') {
          nextShotCount = MULTI_IMAGE_SHOT_MAP[nextDuration] ?? prev.shotCount;
        } else {
          const max = getSingleImageMaxShots(nextDuration);
          if (prev.shotCount > max) nextShotCount = max as VideoStoryboardConfig['shotCount'];
        }
        return { ...prev, duration: nextDuration, shotCount: nextShotCount };
      }

      if (name === 'generationMode') {
        const nextMode = value as VideoStoryboardConfig['generationMode'];
        let nextShotCount = prev.shotCount;
        if (nextMode === 'multi_image') {
          nextShotCount = MULTI_IMAGE_SHOT_MAP[prev.duration] ?? prev.shotCount;
        } else {
          const max = getSingleImageMaxShots(prev.duration);
          if (prev.shotCount > max) nextShotCount = max as VideoStoryboardConfig['shotCount'];
        }
        return { ...prev, generationMode: nextMode, shotCount: nextShotCount };
      }

      if (name === 'videoGenerationMode') {
        const nextMode = value as VideoStoryboardConfig['videoGenerationMode'];
        return {
          ...prev,
          videoGenerationMode: nextMode,
          generationMode: 'single_image',
          referenceVideoFile: nextMode === 'viral_split' ? prev.referenceVideoFile : null,
          uploadedReferenceVideoUrl: nextMode === 'viral_split' ? prev.uploadedReferenceVideoUrl : '',
        };
      }

      if (name === 'scriptPreset') {
        const preset = value as VideoStoryboardConfig['scriptPreset'];
        return {
          ...prev,
          scriptPreset: preset,
          scriptLogic: preset !== 'custom' ? SCRIPT_PRESETS[preset] : prev.scriptLogic,
        };
      }

      if (name === 'projectCount') {
        const nextCount = Number(value);
        const nextScenes = [...prev.scenes];
        if (nextCount > nextScenes.length) {
          while (nextScenes.length < nextCount) nextScenes.push('');
        } else {
          nextScenes.length = nextCount;
        }
        return { ...prev, projectCount: nextCount, scenes: nextScenes };
      }

      if (name === 'viralVariationCount') {
        return { ...prev, viralVariationCount: Math.max(1, Number(value) || 1) };
      }

      return { ...prev, [name]: value };
    });
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []) as File[];
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    onChange((prev) => ({
      ...prev,
      productImages: [...prev.productImages, ...imageFiles].slice(0, 8),
      uploadedProductUrls: [...prev.uploadedProductUrls].slice(0, prev.productImages.length + imageFiles.length).slice(0, 8),
    }));

    event.target.value = '';
  };

  const handleReferenceVideoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    onChange((prev) => ({
      ...prev,
      referenceVideoFile: file,
      uploadedReferenceVideoUrl: '',
    }));
    event.target.value = '';
  };

  const removeImage = (index: number) => {
    onChange((prev) => ({
      ...prev,
      productImages: prev.productImages.filter((_, i) => i !== index),
      uploadedProductUrls: prev.uploadedProductUrls.filter((_, i) => i !== index),
    }));
  };

  const removeReferenceVideo = () => {
    onChange((prev) => ({
      ...prev,
      referenceVideoFile: null,
      uploadedReferenceVideoUrl: '',
    }));
  };

  const updateScene = (index: number, value: string) => {
    onChange((prev) => {
      const nextScenes = [...prev.scenes];
      nextScenes[index] = value;
      return { ...prev, scenes: nextScenes };
    });
  };

  const handleSelectChange = (name: string, value: string) => {
    handleFieldChange({
      target: { name, value },
    } as React.ChangeEvent<HTMLSelectElement>);
  };

  return (
    <SidebarShell
      widthClassName="w-[390px]"
      accentClass="bg-rose-500"
      title="短视频生成配置"
      subtitle={isViralMode ? '爆款裂变模式' : '原创生成模式'}
      titleClassName="text-sm font-bold tracking-[0.02em] text-slate-500"
      subtitleClassName="text-[11px] font-black tracking-[0.18em] text-slate-900"
      headerContent={
        <SegmentedTabs
          items={[
            { value: VideoSubMode.STORYBOARD, label: '视频生成', icon: 'fa-clapperboard' },
            { value: VideoSubMode.DIAGNOSIS, label: '视频诊断', icon: 'fa-magnifying-glass' },
          ]}
          value={subMode}
          onChange={onSubModeChange}
          accentClass="bg-slate-950 text-white"
        />
      }
      footer={
        <PrimaryActionButton
          onClick={onGenerate}
          disabled={disabled || !canGenerate}
          icon={disabled ? 'fa-spinner fa-spin' : 'fa-play-circle'}
          label={
            disabled
              ? '生成中...'
              : !hasProductAssets
                ? '请先上传商品素材'
                : isViralMode && !hasReferenceVideo
                  ? '请先上传参考爆款视频'
                  : '生成视频方案'
          }
        />
      }
    >
      <section className="space-y-3">
        <label className="text-xs font-black uppercase tracking-widest text-slate-400">生成模式</label>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => handleSelectChange('videoGenerationMode', 'original')}
            disabled={disabled}
            className={`rounded-2xl border-2 px-4 py-4 text-left transition-all ${
              !isViralMode ? 'border-rose-500 bg-rose-50' : 'border-slate-200 bg-slate-50 hover:border-slate-300'
            }`}
          >
            <p className="text-sm font-black text-slate-800">原创生成</p>
            <p className="mt-1 text-[10px] font-bold text-slate-500">沿用当前脚本分镜工作流</p>
          </button>
          <button
            type="button"
            onClick={() => handleSelectChange('videoGenerationMode', 'viral_split')}
            disabled={disabled}
            className={`rounded-2xl border-2 px-4 py-4 text-left transition-all ${
              isViralMode ? 'border-rose-500 bg-rose-50' : 'border-slate-200 bg-slate-50 hover:border-slate-300'
            }`}
          >
            <p className="text-sm font-black text-slate-800">爆款裂变</p>
            <p className="mt-1 text-[10px] font-bold text-slate-500">参考爆款视频生成裂变方案</p>
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-black uppercase tracking-widest text-slate-400">商品素材</label>
          <span className="text-[10px] font-bold text-slate-400">{Math.max(config.productImages.length, config.uploadedProductUrls.length)}/8</span>
        </div>

        {Math.max(config.productImages.length, config.uploadedProductUrls.length) < 8 && (
          <label className="relative block">
            <input type="file" accept="image/png,image/jpeg,image/webp" multiple className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleImageUpload} disabled={disabled} />
            <UploadSurface
              icon="fa-image"
              accentTextClass="text-rose-500"
              title={Math.max(config.productImages.length, config.uploadedProductUrls.length) === 0 ? '上传商品图片素材' : '继续添加商品图片'}
              hint="支持 JPG / PNG / WEBP，最多 8 张。"
            />
          </label>
        )}

        {Math.max(config.productImages.length, config.uploadedProductUrls.length) > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: Math.max(config.productImages.length, config.uploadedProductUrls.length) }).map((_, index) => {
              const file = config.productImages[index];
              const url = config.uploadedProductUrls[index];
              return (
                <div key={`img-${index}`} className="relative aspect-square rounded-lg overflow-hidden border border-slate-100 bg-slate-50 group">
                  {file
                    ? <img src={safeCreateObjectURL(file)} alt={file.name} className="h-full w-full object-cover" />
                    : url
                      ? <img src={url} alt={`产品图${index + 1}`} className="h-full w-full object-cover" />
                      : <div className="h-full w-full bg-slate-100" />
                  }
                  <button
                    type="button"
                    onClick={() => removeImage(index)}
                    className="absolute top-0 right-0 flex h-5 w-5 items-center justify-center rounded-bl-lg bg-rose-500 text-white opacity-0 transition-all group-hover:opacity-100"
                  >
                    <i className="fas fa-times text-[10px]"></i>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {isViralMode && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-black uppercase tracking-widest text-slate-400">参考爆款视频</label>
            <span className="text-[10px] font-bold text-amber-600">必填</span>
          </div>
          <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={handleReferenceVideoUpload} />
          {hasReferenceVideo ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                  <i className="fas fa-video"></i>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black text-slate-800">{config.referenceVideoFile?.name || '已保存参考爆款视频'}</p>
                  <p className="mt-1 text-[10px] font-bold text-slate-500">第一版仅做上传占位和引用字段预留</p>
                </div>
                <button type="button" onClick={() => videoInputRef.current?.click()} className="text-xs font-black text-slate-600 hover:text-slate-900">
                  更换
                </button>
                <button type="button" onClick={removeReferenceVideo} className="text-xs font-black text-rose-600 hover:text-rose-700">
                  删除
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => videoInputRef.current?.click()} className="w-full text-left">
              <UploadSurface
                icon="fa-clapperboard"
                accentTextClass="text-amber-600"
                title="上传参考爆款视频"
                hint="第一版仅做上传、展示和必填校验，后续再接视频分析。"
              />
            </button>
          )}
        </section>
      )}

      <section className="space-y-2">
        <label className="text-xs font-black uppercase tracking-widest text-slate-400">产品信息</label>
        <textarea
          name="productInfo"
          value={config.productInfo}
          onChange={handleFieldChange}
          disabled={disabled}
          rows={4}
          className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:border-rose-300 focus:bg-white"
          placeholder="填写产品参数、核心卖点、受众、价格带等"
        />
      </section>

      {!isViralMode && (
        <>
          <section className="space-y-2">
            <label className="text-xs font-black uppercase tracking-widest text-slate-400">脚本逻辑</label>
            <PopoverSelect
              value={config.scriptPreset}
              onChange={(next) => handleSelectChange('scriptPreset', next)}
              disabled={disabled}
              options={[
                { value: 'custom', label: '自定义逻辑' },
                { value: 'ecommerce', label: '高转化电商逻辑' },
                { value: 'viral', label: '爆款短视频带货逻辑' },
              ]}
              buttonClassName="h-10 rounded-2xl px-4 text-xs"
            />
            <textarea
              name="scriptLogic"
              value={config.scriptLogic}
              onChange={handleFieldChange}
              disabled={disabled}
              rows={6}
              className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:border-rose-300 focus:bg-white"
              placeholder="描述这条视频的节奏、镜头方向、卖点结构和整体调性。"
            />
          </section>

          <section className="space-y-3">
            <label className="text-xs font-black uppercase tracking-widest text-slate-400">生成模式</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleSelectChange('generationMode', 'single_image')}
                disabled={disabled}
                className={`rounded-2xl border-2 px-4 py-4 text-left transition-all ${
                  config.generationMode === 'single_image' ? 'border-rose-500 bg-rose-50' : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                }`}
              >
                <p className="text-sm font-black text-slate-800">一图直出</p>
                <p className="mt-1 text-[10px] font-bold text-slate-500">更省钱，多分镜间一致性更佳</p>
              </button>
              <button
                type="button"
                onClick={() => handleSelectChange('generationMode', 'multi_image')}
                disabled={disabled}
                className={`rounded-2xl border-2 px-4 py-4 text-left transition-all ${
                  config.generationMode === 'multi_image' ? 'border-rose-500 bg-rose-50' : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                }`}
              >
                <p className="text-sm font-black text-slate-800">多张拼合</p>
                <p className="mt-1 text-[10px] font-bold text-slate-500">贵一些，但单个分镜不满意可再编辑</p>
              </button>
            </div>
          </section>
        </>
      )}

      <section className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <label className="text-xs font-black uppercase tracking-widest text-slate-400">目标国家/语言</label>
          <PopoverSelect
            value={config.countryLanguage}
            onChange={(next) => handleSelectChange('countryLanguage', next)}
            disabled={disabled}
            options={COUNTRY_PRESETS.map((item) => ({ value: item, label: item }))}
            buttonClassName="h-10 rounded-2xl px-4 text-xs"
          />
        </div>

        {!isViralMode && (
          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-widest text-slate-400">演员类型</label>
            <PopoverSelect
              value={config.actorType}
              onChange={(next) => handleSelectChange('actorType', next)}
              disabled={disabled}
              options={[
                { value: 'no_real_face', label: '不出现真实人脸' },
                { value: 'real_person', label: '真实人物' },
                { value: '3d_digital_human', label: '3D 数字人' },
                { value: 'cartoon_character', label: '卡通角色' },
              ]}
              buttonClassName="h-10 rounded-2xl px-4 text-xs"
            />
          </div>
        )}

        <div className="space-y-2">
          <label className="text-xs font-black uppercase tracking-widest text-slate-400">视频比例</label>
          <PopoverSelect
            value={config.aspectRatio}
            onChange={(next) => handleSelectChange('aspectRatio', next)}
            disabled={disabled}
            options={[
              { value: AspectRatio.P_9_16, label: '9:16 竖屏' },
              { value: AspectRatio.L_16_9, label: '16:9 横屏' },
              { value: AspectRatio.P_3_4, label: '3:4 竖屏' },
              { value: AspectRatio.L_4_3, label: '4:3 横屏' },
              { value: AspectRatio.SQUARE, label: '1:1 方图' },
              { value: AspectRatio.P_4_5, label: '4:5 纵向' },
            ]}
            buttonClassName="h-10 rounded-2xl px-4 text-xs"
          />
        </div>

        {!isViralMode && (
          <>
            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-widest text-slate-400">视频时长</label>
              <PopoverSelect
                value={config.duration}
                onChange={(next) => handleSelectChange('duration', next)}
                disabled={disabled}
                options={[
                  { value: '5s', label: '5 秒' },
                  { value: '10s', label: '10 秒' },
                  { value: '15s', label: '15 秒' },
                  { value: '30s', label: '30 秒' },
                ]}
                buttonClassName="h-10 rounded-2xl px-4 text-xs"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-widest text-slate-400">分镜镜头数</label>
              <PopoverSelect
                value={String(config.shotCount)}
                onChange={(next) => handleSelectChange('shotCount', next)}
                disabled={disabled || config.generationMode === 'multi_image'}
                options={shotCountOptions.map((option) => ({
                  value: String(option.value),
                  label: option.label,
                }))}
                buttonClassName="h-10 rounded-2xl px-4 text-xs"
              />
            </div>
          </>
        )}

        {isViralMode ? (
          <>
            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-widest text-slate-400">裂变数量</label>
              <PopoverSelect
                value={String(config.viralVariationCount)}
                onChange={(next) => handleSelectChange('viralVariationCount', next)}
                disabled={disabled}
                options={[
                  { value: '1', label: '1 个裂变方案' },
                  { value: '2', label: '2 个裂变方案' },
                  { value: '3', label: '3 个裂变方案' },
                  { value: '4', label: '4 个裂变方案' },
                  { value: '5', label: '5 个裂变方案' },
                ]}
                buttonClassName="h-10 rounded-2xl px-4 text-xs"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-widest text-slate-400">裂变修改幅度</label>
              <PopoverSelect
                value={config.viralVariationStrength}
                onChange={(next) => handleSelectChange('viralVariationStrength', next)}
                disabled={disabled}
                options={[
                  { value: '5', label: '5%' },
                  { value: '10', label: '10%' },
                  { value: '20', label: '20%' },
                  { value: 'custom', label: '自定义' },
                ]}
                buttonClassName="h-10 rounded-2xl px-4 text-xs"
              />
              {config.viralVariationStrength === 'custom' && (
                <input
                  name="viralCustomVariationStrength"
                  value={config.viralCustomVariationStrength}
                  onChange={handleFieldChange}
                  disabled={disabled}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:border-rose-300 focus:bg-white"
                  placeholder="输入自定义幅度，例如 15%"
                />
              )}
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-widest text-slate-400">生成数量</label>
            <PopoverSelect
              value={String(config.projectCount)}
              onChange={(next) => handleSelectChange('projectCount', next)}
              disabled={disabled}
              options={[
                { value: '1', label: '1 个方案' },
                { value: '2', label: '2 个方案' },
                { value: '3', label: '3 个方案' },
                { value: '4', label: '4 个方案' },
                { value: '5', label: '5 个方案' },
              ]}
              buttonClassName="h-10 rounded-2xl px-4 text-xs"
            />
          </div>
        )}
      </section>

      {!isViralMode && (
        <>
          <section className="space-y-3">
            <label className="text-xs font-black uppercase tracking-widest text-slate-400">每个方案的场景描述</label>
            <div className="space-y-3">
              {config.scenes.map((scene, index) => (
                <div key={index} className="space-y-2">
                  <label className="text-[11px] font-black text-slate-500">方案 {index + 1}</label>
                  <input
                    value={scene}
                    onChange={(event) => updateScene(index, event.target.value)}
                    disabled={disabled}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:border-rose-300 focus:bg-white"
                    placeholder="例如：厨房台面演示、办公室通勤、居家收纳场景"
                  />
                </div>
              ))}
            </div>
          </section>

          <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <input
              type="checkbox"
              checked={config.generateWhiteBg}
              onChange={(event) => onChange((prev) => ({ ...prev, generateWhiteBg: event.target.checked }))}
              disabled={disabled}
              className="h-4 w-4 accent-rose-500"
            />
            <div>
              <p className="text-sm font-black text-slate-800">同步生成白底图</p>
              <p className="text-[11px] font-bold text-slate-400">仅首个方案生成一张白底产品图</p>
            </div>
          </label>
        </>
      )}
    </SidebarShell>
  );
};

export default StoryboardSidebar;
