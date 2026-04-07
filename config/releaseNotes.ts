export const APP_RELEASE_VERSION = 'V260407A';
export const RELEASE_NOTES_STORAGE_KEY = 'meiao_release_notes_seen_version';

export interface ReleaseNoteSection {
  title: string;
  items: string[];
}

export const CURRENT_RELEASE_NOTES: ReleaseNoteSection[] = [
  {
    title: '智能体中心',
    items: [
      '智能体工厂和智能体广场的结构重新梳理，入口更清晰，页面切换和返回逻辑更稳定。',
      '聊天工作区优化为更符合使用习惯的布局，智能体选择、会话列表和聊天区的职责更明确。',
      '头像、会话删除、版本管理等关键交互补了可见入口和二次确认，减少误操作。',
    ],
  },
  {
    title: '一键主图 / 详情 / SKU',
    items: [
      '设计参考与产品素材拆分，设计参考改成自动分析流程，不再需要单独触发。',
      '主图、详情、SKU 的参考分析要求分开收敛，只输出勾选的参考维度，减少无效内容。',
      'SKU 策划补充画面风格字段，并继续保留从第二张开始参考第一张生成图风格的逻辑。',
    ],
  },
  {
    title: '图像与下载',
    items: [
      '单图下载改为按真实图片格式下载，避免下载后还要手动补后缀名。',
      '原图精修逻辑改成严格基于原图优化，禁止偏离原图画面重新生成。',
    ],
  },
  {
    title: '本次细节收口',
    items: [
      '右上角加入版本号入口，通知中心也可以直接查看本次更新内容。',
      '首次打开当前版本时会自动弹出更新日志，后续可随时从版本号或通知中心再次查看。',
    ],
  },
];
