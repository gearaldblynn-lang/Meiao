import React, { useState } from 'react';
import { AppModule } from '../types';
import { MODULE_META } from './layout/moduleMeta';

interface Props {
  onClose: () => void;
}

const GUIDE_MODULES = [
  AppModule.ONE_CLICK,
  AppModule.TRANSLATION,
  AppModule.BUYER_SHOW,
  AppModule.RETOUCH,
  AppModule.PHOTOGRAPHY,
  AppModule.VIDEO,
];

interface GuideEntry {
  summary: string;
  steps: string[];
  tips: string[];
}

const HELP_CONTENT: Record<string, GuideEntry> = {
  [AppModule.ONE_CLICK]: {
    summary:
      '一键主详是核心生产模块，上传产品图片后，AI 自动生成电商主图和详情页设计。支持主图和详情页两种子模式，可分别配置风格、平台、语言等参数，也可一键同步配置。',
    steps: [
      '在左侧上传产品图片（支持多张），可选上传风格参考图',
      '填写产品描述，选择目标平台（淘宝、京东、拼多多等）和语言',
      '配置画质、风格强度、分辨率模式等高级参数',
      '点击「生成」按钮，等待 AI 生成方案',
      '在右侧预览生成的方案，支持下载单张或批量下载',
      '如需生成详情页，切换到「详情页」子模式，可同步主图配置',
    ],
    tips: [
      '产品图片越清晰，生成效果越好',
      '风格参考图可以帮助 AI 理解你想要的视觉风格',
      '主图和详情页的公共配置可以一键同步，避免重复设置',
      '生成过程中可以随时取消',
    ],
  },
  [AppModule.TRANSLATION]: {
    summary:
      '出海翻译模块用于电商图片的多语言本地化。支持三种子模式：主图翻译、详情页翻译、文字去除。AI 会识别图片中的文字并翻译为目标语言，同时保持原始设计风格。',
    steps: [
      '选择子模式：主图翻译、详情页翻译或文字去除',
      '上传需要翻译的电商图片（支持批量上传）',
      '选择目标语言（英语、日语、韩语、泰语等），或输入自定义语言',
      '设置输出图片的宽高比',
      '点击「开始处理」，AI 自动识别并翻译图中文字',
      '处理完成后可逐张对比原图和译图，确认效果后下载',
    ],
    tips: [
      '图片中的文字越清晰，翻译识别越准确',
      '「文字去除」模式会清除图中所有文字，适合需要重新排版的场景',
      '支持对比查看原图和处理后的效果',
      '批量处理时，失败的文件可以单独重试',
    ],
  },
  [AppModule.BUYER_SHOW]: {
    summary:
      '买家秀模块可以将产品图片生成逼真的买家实拍效果图。AI 会模拟真实使用场景，生成具有真人质感的展示图片，适用于电商评价区、社交媒体种草等场景。',
    steps: [
      '上传产品图片',
      '可选上传模特参考图（支持人脸检测）',
      '填写产品特征描述，帮助 AI 理解产品',
      '设置生成数量和输出比例',
      '点击「生成」，AI 创建买家秀图片集',
      '在生成的图片集中预览、下载单张或批量打包下载',
    ],
    tips: [
      '提供模特参考图可以让生成的人物更贴合品牌调性',
      '产品描述越详细，场景还原越真实',
      '每个任务会生成一组图片，可以从中挑选最满意的',
      '失败的任务支持重新生成或恢复',
    ],
  },
  [AppModule.RETOUCH]: {
    summary:
      '产品精修模块用于提升产品图片的画质到商业级水准。支持原背景精修和白底图精修两种模式，AI 会优化光影、色彩、细节，让产品图更具质感。',
    steps: [
      '上传需要精修的产品图片（支持批量）',
      '选择精修模式：保留原背景或生成白底图',
      '可选上传参考图，指定期望的精修风格',
      '设置输出分辨率',
      '点击「开始精修」，等待 AI 处理',
      '处理完成后预览对比效果，满意后下载',
    ],
    tips: [
      '白底图模式适合电商平台的标准产品展示',
      '原背景模式会保留场景，仅提升画质',
      '支持批量处理，可同时精修多张图片',
      '精修后的图片支持单张下载或批量打包',
    ],
  },
  [AppModule.PHOTOGRAPHY]: {
    summary:
      '产品摄影图模块可以通过 AI 为产品生成专业的场景摄影效果图。无需实际拍摄，即可获得高质量的产品场景图。',
    steps: [
      '该功能即将上线，敬请期待',
    ],
    tips: [
      '上线后将支持多种场景风格选择',
      '可自定义场景描述，AI 生成对应的摄影效果',
    ],
  },
  [AppModule.VIDEO]: {
    summary:
      '短视频分镜模块帮助你从产品信息快速生成短视频脚本和分镜画面。AI 会根据产品描述自动编写脚本、拆分镜头，并为每个分镜生成对应的视觉画面。',
    steps: [
      '上传产品图片，填写产品描述和场景说明',
      '配置视频时长、画面比例等参数',
      '可选添加白底产品图作为素材',
      '点击「生成」，AI 自动编写脚本并拆分分镜',
      '脚本生成后，为每个分镜生成对应的画面',
      '预览完整的分镜方案，可单独重新生成某个分镜',
    ],
    tips: [
      '产品描述越详细，脚本质量越高',
      '场景说明可以指定视频的整体风格和调性',
      '每个分镜画面可以单独重新生成，直到满意为止',
      '支持多个项目同时管理',
    ],
  },
};

const HelpGuideModal: React.FC<Props> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<AppModule>(AppModule.ONE_CLICK);
  const meta = MODULE_META[activeTab];
  const content = HELP_CONTENT[activeTab];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/90 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-5xl h-[85vh] rounded-3xl overflow-hidden flex shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left sidebar */}
        <div className="w-[220px] shrink-0 border-r border-slate-100 bg-slate-50/80 flex flex-col">
          <div className="px-6 py-5 border-b border-slate-100">
            <h2 className="text-lg font-black text-slate-900">使用说明</h2>
            <p className="text-[11px] text-slate-400 font-bold mt-1">功能模块指南</p>
          </div>
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1">
            {GUIDE_MODULES.map((mod) => {
              const m = MODULE_META[mod];
              const active = activeTab === mod;
              return (
                <button
                  key={mod}
                  type="button"
                  onClick={() => setActiveTab(mod)}
                  className={`flex items-center gap-3 w-full px-4 py-3 rounded-2xl text-left transition-all ${
                    active
                      ? `${m.accentSoftClass} ${m.accentTextClass}`
                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                  }`}
                >
                  <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${
                    active ? `${m.accentClass} text-white` : 'bg-slate-200/60 text-slate-400'
                  }`}>
                    <i className={`fas ${m.icon} text-xs`}></i>
                  </div>
                  <span className="text-sm font-bold">{m.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right content */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-8 py-5 border-b border-slate-100 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-4">
              <div className={`w-10 h-10 ${meta.accentSoftClass} rounded-xl flex items-center justify-center`}>
                <i className={`fas ${meta.icon} ${meta.accentTextClass}`}></i>
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-800">{meta.title}</h3>
                <p className="text-[11px] text-slate-400 font-bold">{meta.subtitle}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-all"
            >
              <i className="fas fa-times text-xl"></i>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-8 py-6">
            {content ? (
              <div className="flex flex-col gap-6">
                {/* 功能简介 */}
                <div>
                  <h4 className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500 mb-3">
                    <i className="fas fa-info-circle mr-2"></i>功能简介
                  </h4>
                  <p className="text-sm text-slate-600 leading-7">{content.summary}</p>
                </div>

                {/* 使用步骤 */}
                <div>
                  <h4 className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500 mb-3">
                    <i className="fas fa-list-ol mr-2"></i>使用步骤
                  </h4>
                  <div className="flex flex-col gap-2">
                    {content.steps.map((step, i) => (
                      <div key={i} className="flex items-start gap-3 rounded-xl bg-slate-50 px-4 py-3">
                        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${meta.accentClass} text-white text-[11px] font-black`}>
                          {i + 1}
                        </span>
                        <span className="text-sm text-slate-700 leading-6">{step}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 注意事项 */}
                <div>
                  <h4 className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500 mb-3">
                    <i className="fas fa-lightbulb mr-2"></i>注意事项
                  </h4>
                  <div className="flex flex-col gap-2">
                    {content.tips.map((tip, i) => (
                      <div key={i} className="flex items-start gap-3 px-4 py-2">
                        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${meta.accentClass}`}></span>
                        <span className="text-sm text-slate-600 leading-6">{tip}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400">暂无内容</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default HelpGuideModal;
