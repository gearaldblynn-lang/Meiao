export const APP_RELEASE_VERSION = 'V260516A';
export const RELEASE_NOTES_STORAGE_KEY = 'meiao_release_notes_seen_version';

export interface ReleaseNoteSection {
  title: string;
  items: string[];
}

export const CURRENT_RELEASE_NOTES: ReleaseNoteSection[] = [
  {
    title: '新版前端工作台',
    items: [
      '3001 前端工作台同步到云端：一键主图、出海翻译、视频诊断、分镜生成等核心入口统一到新版任务卡片体验。',
      '任务卡增加任务 ID 与积分消耗展示，成功任务按 KIE 返回的真实积分记录，失败任务不计入扣费统计。',
      '生图模型按模型与分辨率展示预计积分，并在生成按钮上方汇总本次预计消耗。',
    ],
  },
  {
    title: '账号隔离与数据清理',
    items: [
      '本地持久化输入、预设与项目卡改为按账号读取，避免不同账号共用旧前端遗留状态。',
      '空诊断报告、无结果无状态的旧任务不会再生成项目卡，减少历史垃圾数据污染前端。',
      '系统统计支持个人账号只读查看基础信息与积分统计，管理员仍保留配置修改权限。',
    ],
  },
];
