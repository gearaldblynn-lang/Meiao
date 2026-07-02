import { getCurrentUserContext, hasStoredSessionToken } from '../../services/internalApi.ts';

export const SMART_FACTORY_PREVIEW_MODE_MESSAGE = '当前为预览模式，真实模型、知识库和工具数据需要登录后读取。';

export const hasSmartFactoryPreviewFlag = (search?: string) => {
  const source = search ?? (typeof window !== 'undefined' ? window.location.search : '');
  return new URLSearchParams(source).has('meiaoLocalPreview');
};

export const hasSmartFactoryAuthenticatedSession = () => (
  hasStoredSessionToken() || Boolean(getCurrentUserContext())
);

export const shouldShowSmartFactoryPreviewFallback = (options?: {
  search?: string;
  authenticated?: boolean;
}) => {
  const authenticated = options?.authenticated ?? hasSmartFactoryAuthenticatedSession();
  return hasSmartFactoryPreviewFlag(options?.search) && !authenticated;
};

export const resolveSmartFactoryConfigLoadErrorMessage = (
  error: unknown,
  options?: {
    search?: string;
    authenticated?: boolean;
  },
) => {
  if (shouldShowSmartFactoryPreviewFallback(options)) return SMART_FACTORY_PREVIEW_MODE_MESSAGE;
  return error instanceof Error ? error.message : '智能工厂配置读取失败。';
};
