export const createLocalChatRouteHarness = ({
  now = Date.now,
  runConversation,
}) => {
  const store = { chatMessages: [] };
  const isPendingAgentRun = (message) =>
    message?.role === 'assistant'
    && ['pending', 'thinking', 'analyzing'].includes(String(message?.status || ''))
    && String(message?.metadata?.progressStage || '') !== 'image_result_ready';

  return {
    seedMessages(messages) {
      store.chatMessages = (Array.isArray(messages) ? messages : []).map((item) => ({ ...item }));
    },
    messages() {
      return store.chatMessages.map((item) => ({ ...item }));
    },
    async postMessage(payload) {
      const existingUserMessage = store.chatMessages.find((item) =>
        item.sessionId === payload.sessionId
        && item.role === 'user'
        && item.clientRequestId === payload.clientRequestId
      );
      const existingAssistantMessage = store.chatMessages.find((item) =>
        item.sessionId === payload.sessionId
        && item.role === 'assistant'
        && item.clientRequestId === payload.clientRequestId
      );
      if (existingUserMessage && existingAssistantMessage) {
        return {
          status: 200,
          body: {
            userMessage: existingUserMessage,
            assistantMessage: existingAssistantMessage,
          },
        };
      }

      const activeSessionRun = store.chatMessages.find((item) =>
        item.sessionId === payload.sessionId && isPendingAgentRun(item)
      );
      if (activeSessionRun) {
        return {
          status: 409,
          body: {
            message: '当前会话已有回复正在生成，请稍后再试',
            code: 'agent_chat_run_active',
          },
        };
      }

      const userMessage = {
        id: `u-${now()}`,
        sessionId: payload.sessionId,
        role: 'user',
        clientRequestId: payload.clientRequestId,
        content: payload.content,
      };
      const assistantResult = await runConversation(payload);
      const assistantMessage = {
        id: `a-${now()}`,
        sessionId: payload.sessionId,
        role: 'assistant',
        clientRequestId: payload.clientRequestId,
        content: assistantResult.content,
        status: 'completed',
        metadata: assistantResult.metadata || {},
      };
      store.chatMessages.push(userMessage, assistantMessage);
      return {
        status: 200,
        body: {
          userMessage,
          assistantMessage,
        },
      };
    },
    markImageTaskSubmitted({ assistantMessageId, providerTaskId, imagePlan }) {
      const message = store.chatMessages.find((item) => item.id === assistantMessageId);
      if (!message) return false;
      message.status = 'pending';
      message.metadata = {
        ...(message.metadata || {}),
        providerTaskId,
        imagePlan,
        progressStage: 'image_task_submitted',
      };
      return true;
    },
    markImageResultReady({ assistantMessageId, imageResultUrls, providerTaskId }) {
      const message = store.chatMessages.find((item) => item.id === assistantMessageId);
      if (!message) return false;
      const urls = (Array.isArray(imageResultUrls) ? imageResultUrls : [])
        .map((url) => String(url || '').trim())
        .filter(Boolean);
      message.status = 'completed';
      message.metadata = {
        ...(message.metadata || {}),
        providerTaskId,
        imageResultUrls: urls,
        progressStage: 'image_result_ready',
      };
      message.attachments = urls.map((url) => ({ type: 'image', url }));
      return true;
    },
  };
};

export const createDbChatRouteHarness = (options) =>
  createLocalChatRouteHarness(options);
