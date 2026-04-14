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
  viral: `爆款短视频带货逻辑：核心公式：强停留 → 强展示 → 强转化。

一阶段：开头强钩子，要么视觉炸，要么情绪炸。
暴力吸睛型：极限测试、夸张演示（紧身衣拎水桶、手机从三楼摔下）。
悬念型：制造事故感、反常识（"我手机刚从三楼掉下去了……"）。
争议开场型：打破刻板印象（"有人说这就是智商税……"）。
好奇留口型：引发疑问（"99%的人都忽略了这个"）。
关系调侃型：情感触发（"你对象看到这条会转你吗？"）。

二阶段：场景锚定核心价值。
立刻交代清楚：这是什么产品，在什么场景用。内容里要埋"轻微冒犯感"或"带情绪的判断"——调侃行为，调侃场景，调侃"旧方法"，调侃"嘴硬不信的人"。

三阶段：加"社交传播理由"或者"评论入口"的收尾。
评论入口：争议/战队/关系/情绪，让用户忍不住评论转发。`,
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

const FilePreview: React.FC<{ file: File; alt: string }> = ({ file, alt }) => {
  const [src, setSrc] = React.useState('');

  React.useEffect(() => {
    const nextSrc = safeCreateObjectURL(file);
    setSrc(nextSrc);
    return () => URL.revokeObjectURL(nextSrc);
  }, [file]);

  return <img src={src} alt={alt} className="w-full h-full object-cover" />;
};

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
  const maxShots = getSingleImageMaxShots(config.duration);
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

      return { ...prev, [name]: ['projectCount'].includes(name) ? Number(value) : value };
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

  const removeImage = (index: number) => {
    onChange((prev) => ({
      ...prev,
      productImages: prev.productImages.filter((_, i) => i !== index),
      uploadedProductUrls: prev.uploadedProductUrls.filter((_, i) => i !== index),
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
      title="短视频分镜配置"
      subtitle="脚本分镜模式"
      titleClassName="text-sm font-bold tracking-[0.02em] text-slate-500"
      subtitleClassName="text-[11px] font-black tracking-[0.18em] text-slate-900"
      headerContent={
        <SegmentedTabs
          items={[
            { value: VideoSubMode.STORYBOARD, label: '脚本分镜', icon: 'fa-clapperboard' },
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
          disabled={disabled || (config.productImages.length === 0 && config.uploadedProductUrls.length === 0)}
          icon={disabled ? 'fa-spinner fa-spin' : 'fa-play-circle'}
          label={disabled ? '生成中...' : '生成短视频分镜板'}
        />
      }
    >
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-black uppercase tracking-widest text-slate-400">产品素材</label>
            <span className="text-[10px] font-bold text-slate-400">{Math.max(config.productImages.length, config.uploadedProductUrls.length)}/8</span>
          </div>

          <div className="grid grid-cols-4 gap-3">
            {Array.from({ length: Math.max(config.productImages.length, config.uploadedProductUrls.length) }).map((_, index) => {
              const file = config.productImages[index];
              const url = config.uploadedProductUrls[index];
              return (
                <div key={`img-${index}`} className="relative aspect-square rounded-2xl overflow-hidden border border-slate-200 bg-slate-50 group">
                  {file
                    ? <FilePreview file={file} alt={file.name} />
                    : url
                      ? <img src={url} alt={`产品图${index + 1}`} className="w-full h-full object-cover" />
                      : <div className="w-full h-full bg-slate-100" />
                  }
                  <button
                    type="button"
                    onClick={() => removeImage(index)}
                    className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 text-white text-xs opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <i className="fas fa-times"></i>
                  </button>
                </div>
              );
            })}

            {Math.max(config.productImages.length, config.uploadedProductUrls.length) < 8 && (
              <label className="relative col-span-4">
                <input type="file" accept="image/png,image/jpeg,image/webp" multiple className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleImageUpload} disabled={disabled} />
                <UploadSurface
                  icon="fa-image"
                  accentTextClass="text-rose-500"
                  title={Math.max(config.productImages.length, config.uploadedProductUrls.length) === 0 ? '上传产品图片素材' : '继续添加产品图片'}
                  hint="支持 JPG / PNG / WEBP，最多 8 张。"
                />
              </label>
            )}
          </div>
        </section>

        <section className="space-y-2">
          <label className="text-xs font-black uppercase tracking-widest text-slate-400">产品信息</label>
          <textarea
            name="productInfo"
            value={config.productInfo}
            onChange={handleFieldChange}
            disabled={disabled}
            rows={4}
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-rose-300 outline-none text-sm font-bold text-slate-700 resize-none"
            placeholder="填写产品参数、核心卖点、受众、价格带等"
          />
        </section>

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
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-rose-300 outline-none text-sm font-bold text-slate-700 resize-none"
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
              className={`relative px-4 py-4 rounded-2xl border-2 transition-all text-left ${
                config.generationMode === 'single_image'
                  ? 'border-rose-500 bg-rose-50'
                  : 'border-slate-200 bg-slate-50 hover:border-slate-300'
              }`}
            >
              <div className="flex items-start gap-2 mb-2">
                <i className={`fas fa-image text-lg ${config.generationMode === 'single_image' ? 'text-rose-500' : 'text-slate-400'}`}></i>
                <div className="flex-1">
                  <p className="text-sm font-black text-slate-800">一图直出</p>
                  <p className="text-[10px] font-bold text-slate-500 mt-1">更省钱，多分镜间一致性更佳</p>
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => handleSelectChange('generationMode', 'multi_image')}
              disabled={disabled}
              className={`relative px-4 py-4 rounded-2xl border-2 transition-all text-left ${
                config.generationMode === 'multi_image'
                  ? 'border-rose-500 bg-rose-50'
                  : 'border-slate-200 bg-slate-50 hover:border-slate-300'
              }`}
            >
              <div className="flex items-start gap-2 mb-2">
                <i className={`fas fa-images text-lg ${config.generationMode === 'multi_image' ? 'text-rose-500' : 'text-slate-400'}`}></i>
                <div className="flex-1">
                  <p className="text-sm font-black text-slate-800">多张拼合</p>
                  <p className="text-[10px] font-bold text-slate-500 mt-1">贵一些，但单个分镜不满意可再编辑</p>
                </div>
              </div>
            </button>
          </div>
        </section>

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
            {config.generationMode === 'multi_image' && (
              <p className="text-[10px] font-bold text-slate-400 mt-1">多张拼合模式下，时长与镜头数联动</p>
            )}
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
            {config.generationMode === 'multi_image' && (
              <p className="text-[10px] font-bold text-slate-400 mt-1">多张拼合模式下，镜头数由时长决定</p>
            )}
            {config.generationMode === 'single_image' && (config.duration === '5s' || config.duration === '10s') && (
              <p className="text-[10px] font-bold text-slate-400 mt-1">{config.duration === '5s' ? '5秒最多3格' : '10秒最多6格'}</p>
            )}
          </div>

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
        </section>

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
                  className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-rose-300 outline-none text-sm font-bold text-slate-700"
                  placeholder="例如：厨房台面演示、办公室通勤、居家收纳场景"
                />
              </div>
            ))}
          </div>
        </section>

        <label className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 cursor-pointer">
          <input
            type="checkbox"
            checked={config.generateWhiteBg}
            onChange={(event) => onChange((prev) => ({ ...prev, generateWhiteBg: event.target.checked }))}
            disabled={disabled}
            className="w-4 h-4 accent-rose-500"
          />
          <div>
            <p className="text-sm font-black text-slate-800">同步生成白底图</p>
            <p className="text-[11px] font-bold text-slate-400">仅首个方案生成一张白底产品图</p>
          </div>
        </label>
    </SidebarShell>
  );
};

export default StoryboardSidebar;
