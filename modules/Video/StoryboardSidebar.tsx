import React from 'react';
import { AspectRatio, VideoStoryboardConfig } from '../../types';
import { safeCreateObjectURL } from '../../utils/urlUtils';
import { PopoverSelect, PrimaryActionButton, SidebarShell, UploadSurface } from '../../components/ui/workspacePrimitives';

interface Props {
  config: VideoStoryboardConfig;
  disabled: boolean;
  onChange: (updater: (prev: VideoStoryboardConfig) => VideoStoryboardConfig) => void;
  onGenerate: () => void;
}

const SCRIPT_PRESETS: Record<string, string> = {
  custom: '',
  ecommerce: `高转化电商短视频逻辑：先抓注意力，再建立信任，再放大卖点，最后促成行动。
1. 开场快速抛出视觉钩子。
2. 中段清楚展示卖点、使用感受与差异化细节。
3. 尾段做记忆点收束与转化引导。`,
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

const StoryboardSidebar: React.FC<Props> = ({ config, disabled, onChange, onGenerate }) => {
  const shotCountOptions: Array<{ value: VideoStoryboardConfig['shotCount']; label: string; disabled?: boolean }> = [
    { value: 3, label: '3 格' },
    { value: 4, label: '4 格' },
    { value: 6, label: '6 格' },
    { value: 8, label: '8 格' },
    { value: 9, label: '9 格' },
    { value: 12, label: '12 格', disabled: config.duration === '15s' },
  ];

  const handleFieldChange = (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = event.target;

    onChange((prev) => {
      if (name === 'duration') {
        const nextDuration = value as VideoStoryboardConfig['duration'];
        let nextShotCount = prev.shotCount;
        if (nextDuration === '15s' && prev.shotCount === 12) nextShotCount = 9;
        if (nextDuration === '30s') nextShotCount = 12;
        return {
          ...prev,
          duration: nextDuration,
          shotCount: nextShotCount,
        };
      }

      if (name === 'scriptPreset') {
        return {
          ...prev,
          scriptPreset: value as VideoStoryboardConfig['scriptPreset'],
          scriptLogic: value === 'ecommerce' ? SCRIPT_PRESETS.ecommerce : prev.scriptLogic,
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
      uploadedProductUrls: [],
    }));

    event.target.value = '';
  };

  const removeImage = (index: number) => {
    onChange((prev) => ({
      ...prev,
      productImages: prev.productImages.filter((_, currentIndex) => currentIndex !== index),
      uploadedProductUrls: [],
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
      subtitle="分镜板模式"
      footer={
        <PrimaryActionButton
          onClick={onGenerate}
          disabled={disabled || config.productImages.length === 0}
          icon={disabled ? 'fa-spinner fa-spin' : 'fa-play-circle'}
          label={disabled ? '生成中...' : '生成短视频分镜板'}
        />
      }
    >
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-black uppercase tracking-widest text-slate-400">产品素材</label>
            <span className="text-[10px] font-bold text-slate-400">{config.productImages.length}/8</span>
          </div>

          <div className="grid grid-cols-4 gap-3">
            {config.productImages.map((image, index) => (
              <div key={`${image.name}-${index}`} className="relative aspect-square rounded-2xl overflow-hidden border border-slate-200 bg-slate-50 group">
                <FilePreview file={image} alt={image.name} />
                <button
                  type="button"
                  onClick={() => removeImage(index)}
                  className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 text-white text-xs opacity-0 group-hover:opacity-100 transition-all"
                >
                  <i className="fas fa-times"></i>
                </button>
              </div>
            ))}

            {config.productImages.length < 8 && (
              <label className={`relative ${config.productImages.length === 0 ? 'col-span-4' : ''}`}>
                <input type="file" accept="image/png,image/jpeg,image/webp" multiple className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleImageUpload} disabled={disabled} />
                <UploadSurface
                  icon="fa-cloud-upload-alt"
                  accentTextClass="text-rose-500"
                  title={config.productImages.length === 0 ? '上传产品图片素材' : '继续添加产品图片'}
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
          </div>

          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-widest text-slate-400">分镜镜头数</label>
            <PopoverSelect
              value={String(config.shotCount)}
              onChange={(next) => handleSelectChange('shotCount', next)}
              disabled={disabled}
              options={shotCountOptions.filter((option) => !option.disabled).map((option) => ({
                value: String(option.value),
                label: option.label,
              }))}
              buttonClassName="h-10 rounded-2xl px-4 text-xs"
            />
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
