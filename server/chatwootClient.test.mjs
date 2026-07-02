import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assignChatwootConversation,
  createChatwootCannedResponse,
  createChatwootCampaign,
  createChatwootInternalNote,
  createChatwootContactNote,
  createChatwootMacro,
  createChatwootWebhook,
  deleteChatwootConversationMessage,
  executeChatwootMacro,
  listChatwootAssignableAgents,
  listChatwootAutomationRules,
  listChatwootCannedResponses,
  listChatwootContacts,
  listChatwootContactNotes,
  listChatwootContactConversations,
  listChatwootCampaigns,
  listChatwootInboxes,
  listChatwootLabels,
  listChatwootMacros,
  listChatwootReportsSummary,
  listChatwootTeams,
  listChatwootWebhooks,
  listChatwootConversationMessages,
  listChatwootConversations,
  normalizeChatwootConfig,
  retryChatwootConversationMessage,
  sendChatwootConversationMessage,
  sendChatwootConversationAttachment,
  testChatwootConnection,
  translateChatwootConversationMessage,
  updateChatwootContact,
  updateChatwootInbox,
  updateChatwootWebhook,
  updateChatwootConversationLabels,
  updateChatwootConversationStatus,
} from './chatwootClient.mjs';

test('normalizeChatwootConfig requires the fields needed for a real Chatwoot API call', () => {
  assert.throws(
    () => normalizeChatwootConfig({ baseUrl: 'https://chatwoot.example.com', accountId: '1', inboxId: '', apiToken: 'token' }),
    /Inbox ID/,
  );

  assert.deepEqual(
    normalizeChatwootConfig({
      baseUrl: 'https://chatwoot.example.com/',
      accountId: '1',
      inboxId: '7',
      apiToken: 'token',
    }),
    {
      baseUrl: 'https://chatwoot.example.com',
      accountId: '1',
      inboxId: '7',
      apiToken: 'token',
    },
  );
});

test('testChatwootConnection calls the inbox endpoint through the supplied fetch implementation', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return Response.json({ id: 7, name: '小红书客服' });
  };

  const result = await testChatwootConnection({
    baseUrl: 'https://chatwoot.example.com',
    accountId: '1',
    inboxId: '7',
    apiToken: 'token',
  }, { fetchImpl });

  assert.equal(calls[0].url, 'https://chatwoot.example.com/api/v1/accounts/1/inboxes/7');
  assert.equal(calls[0].init.headers.api_access_token, 'token');
  assert.deepEqual(result, { ok: true, inbox: { id: 7, name: '小红书客服' } });
});

test('listChatwootConversations normalizes Chatwoot conversation payloads for the AI customer service page', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return Response.json({
      data: {
        payload: [
          {
            id: 101,
            status: 'open',
            inbox_id: 7,
            meta: { sender: { name: '小红书用户', phone_number: '13800000000' } },
            messages: [
              { content: '什么时候发货？', created_at: 1782360000, message_type: 0, sender_type: 'Contact' },
              { content: 'Get notified by email', created_at: 1782360001, message_type: 3 },
            ],
            created_at: 1782359000,
            updated_at: 1782360000,
          },
        ],
      },
    });
  };

  const result = await listChatwootConversations({
    baseUrl: 'https://chatwoot.example.com',
    accountId: '1',
    inboxId: '7',
    apiToken: 'token',
  }, { fetchImpl });

  assert.equal(calls[0].url, 'https://chatwoot.example.com/api/v1/accounts/1/conversations?inbox_id=7');
  assert.deepEqual(result.conversations, [
    {
      id: '101',
      status: 'open',
      inboxId: '7',
      customerName: '小红书用户',
      customerPhone: '13800000000',
      lastMessage: '什么时候发货？',
      updatedAt: 1782360000000,
    },
  ]);
});

test('listChatwootConversations fetches conversation messages when list payload only includes widget form text', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/conversations?inbox_id=7')) {
      return Response.json({
        data: {
          payload: [
            {
              id: 101,
              status: 'open',
              inbox_id: 7,
              meta: { sender: { name: '小红书用户', phone_number: '13800000000' } },
              messages: [{ content: 'Get notified by email', created_at: 1782360001, message_type: 3 }],
              created_at: 1782359000,
              updated_at: 1782360001,
            },
          ],
        },
      });
    }
    return Response.json({
      payload: [
        { content: '这个套装敏感肌能用吗？', created_at: 1782360000, message_type: 0, sender: { type: 'contact' } },
        { content: 'Get notified by email', created_at: 1782360001, message_type: 3 },
      ],
    });
  };

  const result = await listChatwootConversations({
    baseUrl: 'https://chatwoot.example.com',
    accountId: '1',
    inboxId: '7',
    apiToken: 'token',
  }, { fetchImpl });

  assert.equal(calls[1].url, 'https://chatwoot.example.com/api/v1/accounts/1/conversations/101/messages');
  assert.equal(result.conversations[0].lastMessage, '这个套装敏感肌能用吗？');
});

test('listChatwootConversations uses the latest real customer or agent message in summaries', async () => {
  const fetchImpl = async () => Response.json({
    data: {
      payload: [
        {
          id: 101,
          status: 'open',
          inbox_id: 7,
          meta: { sender: { name: '小红书用户', phone_number: '13800000000' } },
          messages: [
            { content: '这个套装敏感肌能用吗？', created_at: 1782360000, message_type: 0, sender: { type: 'contact' } },
            { content: '可以，敏感肌建议先做局部测试。', created_at: 1782360060, message_type: 1, sender: { type: 'user' } },
          ],
          created_at: 1782359000,
          updated_at: 1782360060,
        },
      ],
    },
  });

  const result = await listChatwootConversations({
    baseUrl: 'https://chatwoot.example.com',
    accountId: '1',
    inboxId: '7',
    apiToken: 'token',
  }, { fetchImpl });

  assert.equal(result.conversations[0].lastMessage, '可以，敏感肌建议先做局部测试。');
});

test('listChatwootConversationMessages normalizes full message history for the customer service workbench', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return Response.json({
      payload: [
        { id: 1, content: '这个套装敏感肌能用吗？', created_at: 1782360000, message_type: 0, sender: { type: 'contact', name: '小红书用户' } },
        { id: 2, content: '可以，敏感肌建议先做局部测试。', created_at: 1782360060, message_type: 1, sender: { type: 'user', name: '客服' } },
      ],
    });
  };

  const result = await listChatwootConversationMessages({
    baseUrl: 'https://chatwoot.example.com',
    accountId: '1',
    inboxId: '7',
    apiToken: 'token',
  }, '101', { fetchImpl });

  assert.equal(calls[0].url, 'https://chatwoot.example.com/api/v1/accounts/1/conversations/101/messages');
  assert.deepEqual(result.messages, [
    {
      id: '1',
      role: 'customer',
      senderName: '小红书用户',
      content: '这个套装敏感肌能用吗？',
      createdAt: 1782360000000,
      private: false,
    },
    {
      id: '2',
      role: 'agent',
      senderName: '客服',
      content: '可以，敏感肌建议先做局部测试。',
      createdAt: 1782360060000,
      private: false,
    },
  ]);
});

test('listChatwootConversationMessages keeps attachment-only messages visible', async () => {
  const fetchImpl = async () => Response.json({
    payload: [
      {
        id: 12,
        content: '',
        created_at: 1782360080,
        message_type: 0,
        sender: { type: 'contact', name: '小红书用户' },
        attachments: [{ id: 33, file_type: 'image', data_url: 'http://chatwoot.example.com/image.png' }],
      },
    ],
  });

  const result = await listChatwootConversationMessages({
    baseUrl: 'https://chatwoot.example.com',
    accountId: '1',
    inboxId: '7',
    apiToken: 'token',
  }, '101', { fetchImpl });

  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].attachments[0].url, 'http://chatwoot.example.com/image.png');
});

test('sendChatwootConversationMessage posts an outgoing customer service reply', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return Response.json({
      id: 9,
      content: '今天下单预计 48 小时内发货。',
      created_at: 1782360100,
      message_type: 1,
      sender: { type: 'user', name: '客服' },
    });
  };

  const result = await sendChatwootConversationMessage({
    baseUrl: 'https://chatwoot.example.com',
    accountId: '1',
    inboxId: '7',
    apiToken: 'token',
  }, '101', '今天下单预计 48 小时内发货。', { fetchImpl });

  assert.equal(calls[0].url, 'https://chatwoot.example.com/api/v1/accounts/1/conversations/101/messages');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    content: '今天下单预计 48 小时内发货。',
    message_type: 'outgoing',
    private: false,
  });
  assert.equal(result.message.role, 'agent');
  assert.equal(result.message.content, '今天下单预计 48 小时内发货。');
});

test('sendChatwootConversationAttachment posts multipart attachments to Chatwoot messages', async () => {
  const calls = [];
  const uploadFile = new File(['attachment-bytes'], 'proof.png', { type: 'image/png' });
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    assert.ok(init.body instanceof FormData);
    assert.equal(init.body.get('content'), '这是客户要看的凭证');
    assert.equal(init.body.get('message_type'), 'outgoing');
    assert.equal(init.body.get('private'), 'false');
    assert.equal(init.body.get('attachments[]').name, 'proof.png');
    return Response.json({
      id: 10,
      content: '这是客户要看的凭证',
      created_at: 1782360150,
      message_type: 1,
      sender: { type: 'user', name: '客服' },
      attachments: [
        { id: 99, file_type: 'image', data_url: 'http://chatwoot.example.com/rails/active_storage/blobs/proof.png' },
      ],
    });
  };

  const result = await sendChatwootConversationAttachment({
    baseUrl: 'https://chatwoot.example.com',
    accountId: '1',
    inboxId: '7',
    apiToken: 'token',
  }, '101', {
    content: '这是客户要看的凭证',
    file: uploadFile,
    fileName: 'proof.png',
  }, { fetchImpl });

  assert.equal(calls[0].url, 'https://chatwoot.example.com/api/v1/accounts/1/conversations/101/messages');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['Content-Type'], undefined);
  assert.equal(result.message.attachments[0].url, 'http://chatwoot.example.com/rails/active_storage/blobs/proof.png');
});

test('updateChatwootConversationStatus posts Chatwoot toggle_status for open, pending or resolved workflows', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return Response.json({ id: 101, status: 'resolved' });
  };

  const result = await updateChatwootConversationStatus({
    baseUrl: 'https://chatwoot.example.com',
    accountId: '1',
    inboxId: '7',
    apiToken: 'token',
  }, '101', 'resolved', { fetchImpl });

  assert.equal(calls[0].url, 'https://chatwoot.example.com/api/v1/accounts/1/conversations/101/toggle_status');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { status: 'resolved' });
  assert.deepEqual(result.conversation, { id: '101', status: 'resolved' });
});

test('createChatwootInternalNote posts a private outgoing message', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return Response.json({
      id: 11,
      content: '客户要求补寄赠品，处理前先核对订单。',
      created_at: 1782360200,
      message_type: 1,
      private: true,
      sender: { type: 'user', name: '客服主管' },
    });
  };

  const result = await createChatwootInternalNote({
    baseUrl: 'https://chatwoot.example.com',
    accountId: '1',
    inboxId: '7',
    apiToken: 'token',
  }, '101', '客户要求补寄赠品，处理前先核对订单。', { fetchImpl });

  assert.equal(calls[0].url, 'https://chatwoot.example.com/api/v1/accounts/1/conversations/101/messages');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    content: '客户要求补寄赠品，处理前先核对订单。',
    message_type: 'outgoing',
    private: true,
  });
  assert.equal(result.message.private, true);
  assert.equal(result.message.content, '客户要求补寄赠品，处理前先核对订单。');
});

test('listChatwootLabels normalizes account labels for store workbench filters', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return Response.json({
      payload: [
        { id: 1, title: '催发货', color: '#f59e0b', description: '催发货咨询' },
        { id: 2, title: '高风险售后', color: '#ef4444' },
      ],
    });
  };

  const result = await listChatwootLabels({
    baseUrl: 'https://chatwoot.example.com',
    accountId: '1',
    inboxId: '7',
    apiToken: 'token',
  }, { fetchImpl });

  assert.equal(calls[0].url, 'https://chatwoot.example.com/api/v1/accounts/1/labels');
  assert.deepEqual(result.labels, [
    { id: '1', title: '催发货', color: '#f59e0b', description: '催发货咨询' },
    { id: '2', title: '高风险售后', color: '#ef4444', description: '' },
  ]);
});

test('updateChatwootConversationLabels posts the complete label list to Chatwoot', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return Response.json({ payload: ['催发货', '高风险售后'] });
  };

  const result = await updateChatwootConversationLabels({
    baseUrl: 'https://chatwoot.example.com',
    accountId: '1',
    inboxId: '7',
    apiToken: 'token',
  }, '101', ['催发货', '高风险售后'], { fetchImpl });

  assert.equal(calls[0].url, 'https://chatwoot.example.com/api/v1/accounts/1/conversations/101/labels');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { labels: ['催发货', '高风险售后'] });
  assert.deepEqual(result.labels, ['催发货', '高风险售后']);
});

test('listChatwootAssignableAgents and teams expose Chatwoot routing targets', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/assignable_agents')) {
      return Response.json({
        payload: [{ id: 1, name: 'Meiao Admin', email: 'admin@meiao.local', availability_status: 'online' }],
      });
    }
    return Response.json([{ id: 3, name: '售后组', description: '售后团队' }]);
  };
  const config = {
    baseUrl: 'https://chatwoot.example.com',
    accountId: '1',
    inboxId: '7',
    apiToken: 'token',
  };

  const agents = await listChatwootAssignableAgents(config, { fetchImpl });
  const teams = await listChatwootTeams(config, { fetchImpl });

  assert.equal(calls[0].url, 'https://chatwoot.example.com/api/v1/accounts/1/inboxes/7/assignable_agents');
  assert.equal(calls[1].url, 'https://chatwoot.example.com/api/v1/accounts/1/teams');
  assert.deepEqual(agents.agents, [{ id: '1', name: 'Meiao Admin', email: 'admin@meiao.local', availability: 'online' }]);
  assert.deepEqual(teams.teams, [{ id: '3', name: '售后组', description: '售后团队' }]);
});

test('assignChatwootConversation posts agent or team assignment', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return Response.json({ id: 1, name: 'Meiao Admin', email: 'admin@meiao.local' });
  };

  const result = await assignChatwootConversation({
    baseUrl: 'https://chatwoot.example.com',
    accountId: '1',
    inboxId: '7',
    apiToken: 'token',
  }, '101', { assigneeId: '1' }, { fetchImpl });

  assert.equal(calls[0].url, 'https://chatwoot.example.com/api/v1/accounts/1/conversations/101/assignments');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { assignee_id: '1' });
  assert.deepEqual(result.assignment, { id: '1', name: 'Meiao Admin', email: 'admin@meiao.local' });
});

test('list and create canned responses use Chatwoot canned_response payload shape', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (init.method === 'POST') {
      return Response.json({ id: 8, short_code: 'ship48', content: '您好，订单会在 48 小时内发货。' });
    }
    return Response.json([{ id: 7, short_code: 'refund', content: '您好，售后规则以订单页为准。' }]);
  };
  const config = {
    baseUrl: 'https://chatwoot.example.com',
    accountId: '1',
    inboxId: '7',
    apiToken: 'token',
  };

  const listResult = await listChatwootCannedResponses(config, { fetchImpl });
  const createResult = await createChatwootCannedResponse(config, {
    shortCode: 'ship48',
    content: '您好，订单会在 48 小时内发货。',
  }, { fetchImpl });

  assert.equal(calls[0].url, 'https://chatwoot.example.com/api/v1/accounts/1/canned_responses');
  assert.equal(calls[1].url, 'https://chatwoot.example.com/api/v1/accounts/1/canned_responses');
  assert.equal(calls[1].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    canned_response: {
      short_code: 'ship48',
      content: '您好，订单会在 48 小时内发货。',
    },
  });
  assert.deepEqual(listResult.cannedResponses, [{ id: '7', shortCode: 'refund', content: '您好，售后规则以订单页为准。' }]);
  assert.deepEqual(createResult.cannedResponse, { id: '8', shortCode: 'ship48', content: '您好，订单会在 48 小时内发货。' });
});

test('listChatwootAutomationRules and reports summary call the account admin APIs', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/automation_rules')) {
      return Response.json({ payload: [{ id: 5, name: '催发货打标', event_name: 'conversation_created', active: true }] });
    }
    return Response.json({
      conversations_count: { value: 12, previous: 8 },
      avg_first_response_time: { value: 180, previous: 240 },
    });
  };
  const config = {
    baseUrl: 'https://chatwoot.example.com',
    accountId: '1',
    inboxId: '7',
    apiToken: 'token',
  };

  const rules = await listChatwootAutomationRules(config, { fetchImpl });
  const reports = await listChatwootReportsSummary(config, {
    since: 1781760000,
    until: 1782364800,
  }, { fetchImpl });

  assert.equal(calls[0].url, 'https://chatwoot.example.com/api/v1/accounts/1/automation_rules');
  assert.equal(calls[1].url, 'https://chatwoot.example.com/api/v2/accounts/1/reports/summary?type=inbox&id=7&since=1781760000&until=1782364800');
  assert.deepEqual(rules.automationRules, [{ id: '5', name: '催发货打标', eventName: 'conversation_created', active: true }]);
  assert.deepEqual(reports.summary.conversations_count, { value: 12, previous: 8 });
});

test('listChatwootContacts normalizes customer records for the store customer tab', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return Response.json({
      payload: [
        { id: 15, name: '小红书用户', email: 'buyer@example.com', phone_number: '13800000000', last_activity_at: 1782360800 },
      ],
    });
  };

  const result = await listChatwootContacts({
    baseUrl: 'https://chatwoot.example.com',
    accountId: '1',
    inboxId: '7',
    apiToken: 'token',
  }, { fetchImpl });

  assert.equal(calls[0].url, 'https://chatwoot.example.com/api/v1/accounts/1/contacts?include_contact_inboxes=true');
  assert.deepEqual(result.contacts, [
    {
      id: '15',
      name: '小红书用户',
      email: 'buyer@example.com',
      phone: '13800000000',
      lastActivityAt: 1782360800000,
    },
  ]);
});

test('contact notes and contact update use Chatwoot contact APIs', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/notes') && init.method === 'POST') {
      return Response.json({ id: 22, content: '客户偏好晚间回复', created_at: 1782360900, user: { name: '客服' } });
    }
    if (url.endsWith('/notes')) {
      return Response.json({ payload: [{ id: 21, content: '老客', created_at: 1782360800, user: { name: '客服' } }] });
    }
    return Response.json({ payload: { id: 15, name: '小红书用户', email: 'buyer@example.com', phone_number: '13900000000', custom_attributes: { vip: 'true' } } });
  };
  const config = { baseUrl: 'https://chatwoot.example.com', accountId: '1', inboxId: '7', apiToken: 'token' };

  const notes = await listChatwootContactNotes(config, '15', { fetchImpl });
  const created = await createChatwootContactNote(config, '15', '客户偏好晚间回复', { fetchImpl });
  const updated = await updateChatwootContact(config, '15', {
    name: '小红书用户',
    phone: '13900000000',
    customAttributes: { vip: 'true' },
  }, { fetchImpl });

  assert.equal(calls[0].url, 'https://chatwoot.example.com/api/v1/accounts/1/contacts/15/notes');
  assert.equal(calls[1].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].init.body), { note: { content: '客户偏好晚间回复' } });
  assert.equal(calls[2].url, 'https://chatwoot.example.com/api/v1/accounts/1/contacts/15');
  assert.equal(calls[2].init.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[2].init.body), {
    name: '小红书用户',
    phone_number: '13900000000',
    custom_attributes: { vip: 'true' },
  });
  assert.deepEqual(notes.notes[0], { id: '21', content: '老客', authorName: '客服', createdAt: 1782360800000 });
  assert.equal(created.note.id, '22');
  assert.equal(updated.contact.phone, '13900000000');
});

test('contact conversations normalize linked history for CRM context', async () => {
  const fetchImpl = async (url) => {
    assert.equal(url, 'https://chatwoot.example.com/api/v1/accounts/1/contacts/15/conversations');
    return Response.json({ payload: [{ id: 101, status: 'open', inbox_id: 7, meta: { sender: { name: '小红书用户' } }, messages: [{ content: '历史问题', message_type: 0, created_at: 1782360800 }] }] });
  };

  const result = await listChatwootContactConversations({
    baseUrl: 'https://chatwoot.example.com',
    accountId: '1',
    inboxId: '7',
    apiToken: 'token',
  }, '15', { fetchImpl });

  assert.equal(result.conversations[0].lastMessage, '历史问题');
});

test('message delete retry and translate call Chatwoot message action APIs', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/translate')) return Response.json({ content: 'Translated text' });
    return Response.json({ ok: true });
  };
  const config = { baseUrl: 'https://chatwoot.example.com', accountId: '1', inboxId: '7', apiToken: 'token' };

  await deleteChatwootConversationMessage(config, '101', '9', { fetchImpl });
  await retryChatwootConversationMessage(config, '101', '9', { fetchImpl });
  const translated = await translateChatwootConversationMessage(config, '101', '9', 'zh_CN', { fetchImpl });

  assert.equal(calls[0].url, 'https://chatwoot.example.com/api/v1/accounts/1/conversations/101/messages/9');
  assert.equal(calls[0].init.method, 'DELETE');
  assert.equal(calls[1].url, 'https://chatwoot.example.com/api/v1/accounts/1/conversations/101/messages/9/retry');
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(calls[2].url, 'https://chatwoot.example.com/api/v1/accounts/1/conversations/101/messages/9/translate');
  assert.deepEqual(JSON.parse(calls[2].init.body), { target_language: 'zh_CN' });
  assert.deepEqual(translated.translation, { content: 'Translated text' });
});

test('macros list create and execute use Chatwoot macros APIs', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/execute')) return Response.json({});
    if (init.method === 'POST') return Response.json({ id: 6, name: '催发货回复', visibility: 'global', actions: [{ action_name: 'send_message', action_params: ['您好，我们会尽快核对发货。'] }] });
    return Response.json({ payload: [{ id: 5, name: '转人工', visibility: 'global', actions: [{ action_name: 'assign_team', action_params: ['1'] }] }] });
  };
  const config = { baseUrl: 'https://chatwoot.example.com', accountId: '1', inboxId: '7', apiToken: 'token' };

  const list = await listChatwootMacros(config, { fetchImpl });
  const created = await createChatwootMacro(config, { name: '催发货回复', actions: [{ actionName: 'send_message', actionParams: ['您好，我们会尽快核对发货。'] }] }, { fetchImpl });
  const executed = await executeChatwootMacro(config, '5', ['101'], { fetchImpl });

  assert.equal(calls[0].url, 'https://chatwoot.example.com/api/v1/accounts/1/macros');
  assert.equal(calls[1].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    name: '催发货回复',
    visibility: 'global',
    actions: [{ action_name: 'send_message', action_params: ['您好，我们会尽快核对发货。'] }],
  });
  assert.equal(calls[2].url, 'https://chatwoot.example.com/api/v1/accounts/1/macros/5/execute');
  assert.deepEqual(JSON.parse(calls[2].init.body), { conversation_ids: ['101'] });
  assert.equal(list.macros[0].name, '转人工');
  assert.equal(created.macro.id, '6');
  assert.equal(executed.ok, true);
});

test('campaigns webhooks and inbox settings use Chatwoot store operation APIs', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/campaigns') && init.method === 'POST') {
      return Response.json({ payload: { id: 3, display_id: 3, title: '催付提醒', message: '您好，活动即将结束。', enabled: true } });
    }
    if (url.endsWith('/campaigns')) {
      return Response.json({ payload: [{ id: 2, display_id: 2, title: '欢迎语', message: '您好', enabled: true }] });
    }
    if (url.endsWith('/webhooks') && init.method === 'POST') {
      return Response.json({ payload: { webhook: { id: 4, name: '订单同步', url: 'https://example.com/hook', subscriptions: ['conversation_created'] } } });
    }
    if (url.includes('/webhooks/4')) {
      return Response.json({ payload: { webhook: { id: 4, name: '订单同步2', url: 'https://example.com/hook2', subscriptions: ['message_created'] } } });
    }
    if (url.endsWith('/webhooks')) {
      return Response.json({ payload: { webhooks: [{ id: 1, name: '测试回调', url: 'https://example.com/hook', subscriptions: ['message_created'] }] } });
    }
    if (url.endsWith('/inboxes/7') && init.method === 'PATCH') {
      return Response.json({ id: 7, name: '小红书客服更新', enable_auto_assignment: true });
    }
    return Response.json({ payload: [{ id: 7, name: '小红书客服', channel_type: 'Channel::WebWidget' }] });
  };
  const config = { baseUrl: 'https://chatwoot.example.com', accountId: '1', inboxId: '7', apiToken: 'token' };

  const campaigns = await listChatwootCampaigns(config, { fetchImpl });
  const campaign = await createChatwootCampaign(config, { title: '催付提醒', message: '您好，活动即将结束。', inboxId: '7' }, { fetchImpl });
  const webhooks = await listChatwootWebhooks(config, { fetchImpl });
  const webhook = await createChatwootWebhook(config, { name: '订单同步', url: 'https://example.com/hook', subscriptions: ['conversation_created'] }, { fetchImpl });
  const updatedWebhook = await updateChatwootWebhook(config, '4', { name: '订单同步2', url: 'https://example.com/hook2', subscriptions: ['message_created'] }, { fetchImpl });
  const inboxes = await listChatwootInboxes(config, { fetchImpl });
  const updatedInbox = await updateChatwootInbox(config, '7', { name: '小红书客服更新', enableAutoAssignment: true }, { fetchImpl });

  assert.deepEqual(JSON.parse(calls[1].init.body), {
    campaign: {
      title: '催付提醒',
      message: '您好，活动即将结束。',
      inbox_id: '7',
      enabled: true,
      trigger_only_during_business_hours: false,
      audience: [{ type: 'all' }],
      trigger_rules: {},
    },
  });
  assert.deepEqual(JSON.parse(calls[3].init.body), {
    webhook: { name: '订单同步', url: 'https://example.com/hook', subscriptions: ['conversation_created'] },
  });
  assert.deepEqual(JSON.parse(calls[4].init.body), {
    webhook: { name: '订单同步2', url: 'https://example.com/hook2', subscriptions: ['message_created'] },
  });
  assert.deepEqual(JSON.parse(calls[6].init.body), { name: '小红书客服更新', enable_auto_assignment: true });
  assert.equal(campaigns.campaigns[0].title, '欢迎语');
  assert.equal(campaign.campaign.id, '3');
  assert.equal(webhooks.webhooks[0].name, '测试回调');
  assert.equal(webhook.webhook.id, '4');
  assert.equal(updatedWebhook.webhook.name, '订单同步2');
  assert.equal(inboxes.inboxes[0].name, '小红书客服');
  assert.equal(updatedInbox.inbox.name, '小红书客服更新');
});
