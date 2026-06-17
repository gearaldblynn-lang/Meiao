export const APP_RELEASE_VERSION = 'V260617A';
export const RELEASE_NOTES_STORAGE_KEY = 'meiao_release_notes_seen_version';

export interface ReleaseNoteSection {
  title: string;
  items: string[];
}

export const CURRENT_RELEASE_NOTES: ReleaseNoteSection[] = [
  {
    title: '6 月 17 功能调整',
    items: [
      '智能体对话已修复，还原更接近原生 GPT 式智能对话的输入、输出与操作体验。',
      '支持连续对话中追问、改图、生图与重新生成，历史轮次会保留原模式、附件、联网和思考强度。',
      '生图结果、思考过程、复制与重新生成路径做了收敛，避免把内部链接、任务 ID 或无效技术细节带给用户。',
    ],
  },
  {
    title: '智能体能力链路',
    items: [
      'OpenAI Compatible 中转、Responses 多模态图文请求、知识库检索与工具调用链路完成修复和回归。',
      '输入框能力项简化为上传与配置入口，模型、联网、思考强度和生图模式统一在配置中调整。',
      '生成后的图片展示更简洁，结果层、过程层和操作按钮区分更清楚。',
    ],
  },
];
