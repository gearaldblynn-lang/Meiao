const IMAGE_PROVIDER_URL_PATTERN = /https?:\/\/(?:tempfile\.)?aiquickdraw\.com\/images\/[^\s<>)]+/gi;
const IMAGE_PROVIDER_MARKDOWN_PATTERN = /!?\[[^\]]*\]\(https?:\/\/(?:tempfile\.)?aiquickdraw\.com\/images\/[^\s)]+\)/gi;
const HANDOFF_BLOCK_PATTERN = /```meiao-handoff[\s\S]*?```/gi;

export const stripConversationProtocolMarkers = (content = '') =>
  String(content)
    .replace(HANDOFF_BLOCK_PATTERN, '')
    .replace(/(^|\n)\s*final_answer\s*(?=\n|$)/gi, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export const stripImageResultUrls = (content = '') =>
  String(content)
    .replace(IMAGE_PROVIDER_MARKDOWN_PATTERN, '')
    .replace(IMAGE_PROVIDER_URL_PATTERN, '')
    .replace(/[：:]\s*(?=\n|$)/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export const getVisibleMessageText = (message = {}) => {
  const metadata = message?.metadata || {};
  const withoutProtocol = stripConversationProtocolMarkers(message?.content || '');

  if (metadata.requestMode === 'image_generation') {
    return stripImageResultUrls(withoutProtocol);
  }

  return withoutProtocol;
};

export const resolveRegenerateRequest = ({ assistantMessage, previousUserMessage }) => {
  const metadata = assistantMessage?.metadata || {};
  const requestMode = metadata.requestMode === 'image_generation' ? 'image_generation' : 'chat';

  return {
    content: previousUserMessage?.content || '',
    sourceAttachments: Array.isArray(previousUserMessage?.attachments) ? previousUserMessage.attachments : [],
    requestMode,
    selectedModel: metadata.selectedModel || '',
    reasoningLevel: metadata.reasoningLevel || null,
    webSearchEnabled: Boolean(metadata.webSearchEnabled),
  };
};
