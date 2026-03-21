import React from 'react';
import { AspectRatio, VideoStoryboardConfig } from '../../types';
import { safeCreateObjectURL } from '../../utils/urlUtils';

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

  return (
    <aside className="w-[390px] bg-white border-r border-slate-100 shrink-0 h-full overflow-y-auto">
      <div className="px-6 py-5 border-b border-slate-100 sticky top-0 bg-white z-10">
        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-rose-500">Video Storyboard</p>
        <h2 className="mt-2 text-lg font-black text-slate-900">短视频分镜配置</h2>
        <p className="mt-1 text-xs font-bold text-slate-400">先出分镜脚本，再一次性生成整张分镜板。</p>
      </div>

      <div className="p-6 space-y-6">
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
              <label className={`relative border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50 hover:border-rose-300 hover:bg-rose-50 transition-colors cursor-pointer flex flex-col items-center justify-center text-center ${config.productImages.length === 0 ? 'col-span-4 aspect-[2.6/1]' : 'aspect-square'}`}>
                <input type="file" accept="image/png,image/jpeg,image/webp" multiple className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleImageUpload} disabled={disabled} />
                <i className={`fas fa-cloud-upload-alt text-slate-400 ${config.productImages.length === 0 ? 'text-2xl mb-2' : 'text-lg mb-1'}`}></i>
                <span className="text-xs font-black text-slate-500">{config.productImages.length === 0 ? '上传产品图片素材' : '继续添加'}</span>
                {config.productImages.length === 0 && (
                  <span className="mt-2 text-[10px] font-bold text-slate-400">支持 JPG / PNG / WEBP，最多 8 张</span>
                )}
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
          <select
            name="scriptPreset"
            value={config.scriptPreset}
            onChange={handleFieldChange}
            disabled={disabled}
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 outline-none text-sm font-bold text-slate-700"
          >
            <option value="custom">自定义逻辑</option>
            <option value="ecommerce">高转化电商逻辑</option>
          </select>
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
            <select
              name="countryLanguage"
              value={config.countryLanguage}
              onChange={handleFieldChange}
              disabled={disabled}
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 outline-none text-sm font-bold text-slate-700"
            >
              {COUNTRY_PRESETS.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-widest text-slate-400">演员类型</label>
            <select
              name="actorType"
              value={config.actorType}
              onChange={handleFieldChange}
              disabled={disabled}
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 outline-none text-sm font-bold text-slate-700"
            >
              <option value="no_real_face">不出现真实人脸</option>
              <option value="real_person">真实人物</option>
              <option value="3d_digital_human">3D 数字人</option>
              <option value="cartoon_character">卡通角色</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-widest text-slate-400">视频比例</label>
            <select
              name="aspectRatio"
              value={config.aspectRatio}
              onChange={handleFieldChange}
              disabled={disabled}
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 outline-none text-sm font-bold text-slate-700"
            >
              <option value={AspectRatio.P_9_16}>9:16 竖屏</option>
              <option value={AspectRatio.L_16_9}>16:9 横屏</option>
              <option value={AspectRatio.P_3_4}>3:4 竖屏</option>
              <option value={AspectRatio.L_4_3}>4:3 横屏</option>
              <option value={AspectRatio.SQUARE}>1:1 方图</option>
              <option value={AspectRatio.P_4_5}>4:5 纵向</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-widest text-slate-400">视频时长</label>
            <select
              name="duration"
              value={config.duration}
              onChange={handleFieldChange}
              disabled={disabled}
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 outline-none text-sm font-bold text-slate-700"
            >
              <option value="5s">5 秒</option>
              <option value="10s">10 秒</option>
              <option value="15s">15 秒</option>
              <option value="30s">30 秒</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-widest text-slate-400">分镜镜头数</label>
            <select
              name="shotCount"
              value={config.shotCount}
              onChange={handleFieldChange}
              disabled={disabled}
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 outline-none text-sm font-bold text-slate-700"
            >
              {shotCountOptions.map((option) => (
                <option key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}{option.disabled ? '（15秒不可选）' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-widest text-slate-400">生成数量</label>
            <select
              name="projectCount"
              value={config.projectCount}
              onChange={handleFieldChange}
              disabled={disabled}
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 outline-none text-sm font-bold text-slate-700"
            >
              <option value="1">1 个方案</option>
              <option value="2">2 个方案</option>
              <option value="3">3 个方案</option>
              <option value="4">4 个方案</option>
              <option value="5">5 个方案</option>
            </select>
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
      </div>

      <div className="p-6 border-t border-slate-100 sticky bottom-0 bg-white">
        <button
          type="button"
          onClick={onGenerate}
          disabled={disabled || config.productImages.length === 0}
          className="w-full px-5 py-4 rounded-2xl bg-slate-900 text-white text-sm font-black hover:bg-slate-800 disabled:opacity-50 transition-all flex items-center justify-center gap-3"
        >
          <i className={`fas ${disabled ? 'fa-spinner fa-spin' : 'fa-play-circle'} text-base`}></i>
          {disabled ? '生成中...' : '生成短视频分镜板'}
        </button>
      </div>
    </aside>
  );
};

export default StoryboardSidebar;
