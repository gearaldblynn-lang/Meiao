import { safeCreateInternalLog, getActiveModuleContext } from './internalApi';

export const MODULE_LABELS: Record<string, string> = {
  one_click: '一键主详',
  translation: '出海翻译',
  buyer_show: '买家秀',
  retouch: '产品精修',
  video: '短视频',
  settings: '设置',
  account: '账号管理',
  system: '系统',
};

export const STATUS_LABELS: Record<string, string> = {
  started: '进行中',
  success: '成功',
  failed: '失败',
  interrupted: '已中断',
};

export const ACTION_LABELS: Record<string, string> = {
  login_success: '登录成功',
  login_failed: '登录失败',
  logout: '退出登录',
  logout_click: '点击退出登录',
  user_created: '创建账号',
  user_enabled: '启用账号',
  user_disabled: '禁用账号',
  password_reset: '重置密码',
  user_deleted: '删除账号',
  update_setting: '修改设置',
  restricted_setting_access: '尝试修改受限设置',
  upload_asset: '上传素材',
  upload_asset_fallback: '上传回退',
  job_created: '创建内部任务',
  provider_submitted: '提交外部任务',
  job_completed: '内部任务完成',
  job_failed: '内部任务失败',
  job_retry_waiting: '内部任务等待重试',
  job_cancel_requested: '请求取消任务',
  job_retry_requested: '请求重试任务',

  import_files: '导入图片',
  import_folder: '导入文件夹',
  clear_files: '清空文件',
  batch_start: '启动批量任务',
  process_single: '处理单张文件',
  recover_single: '找回单张结果',
  recover_single_click: '点击找回结果',
  retry_single: '重新生成单张',
  interrupt_single: '中断单张任务',
  interrupt_all: '全部暂停',
  download_single: '导出单张结果',
  download_batch: '批量导出',
  detail_ratio_matched: '匹配详情比例',

  sync_from_detail: '同步主图配置到详情',
  sync_from_main: '同步详情配置到主图',
  clear_main_config: '清空主图配置',
  clear_detail_config: '清空详情配置',
  select_all_main: '全选主图方案',
  deselect_all_main: '取消全选主图方案',
  select_single_main: '选择主图方案',
  deselect_single_main: '取消选择主图方案',
  select_all_detail: '全选详情方案',
  deselect_all_detail: '取消全选详情方案',
  select_single_detail: '选择详情方案',
  deselect_single_detail: '取消选择详情方案',
  plan_main_start: '主图策划',
  plan_detail_start: '详情策划',
  generate_main_batch: '批量生成主图',
  generate_detail_batch: '批量生成详情',
  generate_main_scheme: '生成主图方案',
  generate_detail_scheme: '生成详情方案',
  redo_main_scheme: '重做主图方案',
  redo_detail_scheme: '重做详情方案',
  recover_main_click: '点击找回主图结果',
  recover_detail_click: '点击找回详情结果',
  recover_main_scheme: '找回主图结果',
  recover_detail_scheme: '找回详情结果',
  interrupt_main_scheme: '中断主图生成',
  interrupt_detail_scheme: '中断详情生成',
  delete_main_scheme: '删除主图方案',
  delete_detail_scheme: '删除详情方案',
  clear_main_project: '清空主图项目',
  clear_detail_project: '清空详情项目',
  download_main_batch: '批量导出主图',
  download_detail_batch: '批量导出详情',

  plan_start: '开始策划',
  plan_success: '策划成功',
  plan_failed: '策划失败',
  plan_interrupt: '策划中断',
  set_generation_failed: '方案生成失败',
  interrupt_workflow: '中断整套流程',
  interrupt_set: '中断单套方案',
  delete_set: '删除方案',
  generate_remaining: '生成后续套图',
  copy_text: '复制文案',

  add_files: '添加文件',
  generate_single: '生成单张结果',
  copy_result_link: '复制结果链接',
  clear_pending: '清空待处理队列',
  clear_records: '清空记录',

  plan_script: '脚本策划',
  start_video_task: '启动视频任务',
  recover_video_task: '找回视频结果',
  clear_video_records: '清空视频记录',
  delete_video_record: '删除视频记录',
  download_video: '下载视频结果',

  generate_storyboard_batch: '批量生成分镜项目',
  generate_storyboard_project: '生成分镜项目',
  generate_storyboard_script: '生成分镜脚本',
  generate_board: '生成分镜板',
  generate_white_bg: '生成白底图',
  retry_project: '重试整个项目',
  retry_failed_boards: '重试失败分镜板',
  regenerate_board: '重生成分镜板',
  refetch_board: '找回分镜板结果',
  create_new_schemes: '创建新方案',
  download_project: '下载单个项目',
  download_all_projects: '下载全部项目',
  delete_project: '删除项目',
  clear_all_projects: '清空全部项目',
};

type LogStatus = 'success' | 'failed' | 'started' | 'interrupted';
type LogLevel = 'info' | 'error';

interface LogActionPayload {
  module?: string;
  action: string;
  message: string;
  detail?: string;
  status: LogStatus;
  level?: LogLevel;
  meta?: Record<string, unknown>;
}

export const logInternalAction = async ({
  module,
  action,
  message,
  detail,
  status,
  level,
  meta,
}: LogActionPayload) => {
  const finalModule = module || getActiveModuleContext() || 'system';
  return safeCreateInternalLog({
    level: level || (status === 'failed' ? 'error' : 'info'),
    module: finalModule,
    action,
    message,
    detail,
    status,
    meta,
  });
};

export const logActionStart = (payload: Omit<LogActionPayload, 'status' | 'level'>) => {
  return logInternalAction({ ...payload, status: 'started', level: 'info' });
};

export const logActionSuccess = (payload: Omit<LogActionPayload, 'status' | 'level' | 'detail'> & { detail?: string }) => {
  return logInternalAction({ ...payload, status: 'success', level: 'info' });
};

export const logActionFailure = (payload: Omit<LogActionPayload, 'status' | 'level'>) => {
  return logInternalAction({ ...payload, status: 'failed', level: 'error' });
};

export const logActionInterrupted = (payload: Omit<LogActionPayload, 'status' | 'level' | 'detail'> & { detail?: string }) => {
  return logInternalAction({ ...payload, status: 'interrupted', level: 'info' });
};
