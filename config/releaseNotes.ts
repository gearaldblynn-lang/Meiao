export const APP_RELEASE_VERSION = 'V260430A';
export const RELEASE_NOTES_STORAGE_KEY = 'meiao_release_notes_seen_version';

export interface ReleaseNoteSection {
  title: string;
  items: string[];
}

export const CURRENT_RELEASE_NOTES: ReleaseNoteSection[] = [
  {
    title: '首图裂变',
    items: [
      '首图改为严格参考图改稿链路：参考图会作为真实输入图传给云端生图任务，不再只写在 prompt 文本里。',
      '新增首图配色模式：可选“参考图基准”或“商品自适应”，商品自适应会以商品属性配色为主，要求策划写清参考图颜色如何调整。',
      '品牌与包装约束加强：未单独上传 logo 图时，禁止把素材图 logo 或参考图 logo 当作我方品牌识别；包装细节与标签信息一律以上传素材图为准。',
    ],
  },
  {
    title: '工作台与预设',
    items: [
      '一键主图 / 详情 / SKU / 首图 已统一为多项目工作台，不再覆盖旧任务；项目删除增加二次确认。',
      '参考预设库支持图片化保存与长期引用保留，服务端清理任务不会回收已进入预设库的参考图资产。',
    ],
  },
];
