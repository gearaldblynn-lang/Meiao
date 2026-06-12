// 根因 #5 护栏:判断一个错误是否属于「前端资源/chunk 加载失败」。
// 这类错误(部署后浏览器旧入口请求旧 hash chunk 导致 404)绝不能被当成业务任务失败,
// 否则会把好端端的项目污染成 status:'error'。前后端只此一份判据。

const FRONTEND_RESOURCE_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
];

export const isFrontendResourceError = (error) => {
  const message = error instanceof Error ? error.message : String(error || '');
  if (!message) return false;
  return FRONTEND_RESOURCE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
};
