export const shouldUseToolCallingConversation = (version) =>
  Boolean(String(version?.modelPolicy?.toolCallingProvider || '').trim());
