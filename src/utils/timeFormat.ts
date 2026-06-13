// 完整日期时间(合并自 shell/modules/Account/AccountManagement、modules/Account/AccountManagement、
// modules/OneClick/ReferencePresetManager 三份相同实现)
export const formatTime = (value?: number | null): string => {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
};

// 紧凑月-日,等价旧 shellDataAdapter.toDateLabel 的展示部分,给项目/结果卡片用
export const formatMonthDay = (value?: number | null): string => {
  if (!value) return '';
  return new Date(value).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }).replace('/', '-');
};
