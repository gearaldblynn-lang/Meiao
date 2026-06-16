const normalizeUrl = (value) => String(value || '').trim();

export const buildSessionImageCatalog = ({ attachments = [], priorMessages = [] } = {}) => {
  const seen = new Set();
  const items = [];

  const pushItem = ({ url, name, source, generatedFrom = [] }) => {
    const u = normalizeUrl(url);
    if (!u || seen.has(u)) return;
    seen.add(u);
    items.push({ url: u, name: String(name || '').trim() || '图片', source, generatedFrom });
  };

  (Array.isArray(attachments) ? attachments : [])
    .filter((attachment) => attachment?.kind === 'image')
    .forEach((attachment) => pushItem({ url: attachment.url, name: attachment.name, source: 'user_upload' }));

  const history = Array.isArray(priorMessages) ? priorMessages : [];
  const tempOrder = [];
  const tempSeen = new Set(seen);
  const collect = (url) => {
    const u = normalizeUrl(url);
    if (u && !tempSeen.has(u)) {
      tempSeen.add(u);
      tempOrder.push(u);
    }
  };

  history.forEach((message) => {
    (Array.isArray(message?.attachments) ? message.attachments : [])
      .filter((attachment) => attachment?.kind === 'image')
      .forEach((attachment) => collect(attachment.url));
    const genUrl = normalizeUrl(message?.metadata?.imageUrl);
    if (genUrl) collect(genUrl);
  });

  const indexOfUrl = new Map();
  items.forEach((item, i) => indexOfUrl.set(item.url, i + 1));
  let nextIndex = items.length + 1;
  tempOrder.forEach((url) => {
    if (!indexOfUrl.has(url)) indexOfUrl.set(url, nextIndex++);
  });

  history.forEach((message) => {
    (Array.isArray(message?.attachments) ? message.attachments : [])
      .filter((attachment) => attachment?.kind === 'image')
      .forEach((attachment) => pushItem({ url: attachment.url, name: attachment.name, source: 'user_upload' }));
    const genUrl = normalizeUrl(message?.metadata?.imageUrl);
    if (genUrl) {
      const inputs = Array.isArray(message?.metadata?.imagePlan?.inputImageUrls)
        ? message.metadata.imagePlan.inputImageUrls
        : [];
      const generatedFrom = inputs
        .map((url) => indexOfUrl.get(normalizeUrl(url)))
        .filter((index) => Number.isInteger(index));
      pushItem({ url: genUrl, name: 'AI 生成结果', source: 'ai_generated', generatedFrom });
    }
  });

  return items.map((item, i) => ({
    index: i + 1,
    label: `图${i + 1}`,
    url: item.url,
    name: item.name,
    source: item.source,
    generatedFrom: item.generatedFrom,
  }));
};

export const isUrlInCatalog = (catalog = [], url = '') => {
  const u = normalizeUrl(url);
  return (Array.isArray(catalog) ? catalog : []).some((item) => item.url === u);
};

export const formatCatalogForPrompt = (catalog = []) => {
  const items = Array.isArray(catalog) ? catalog : [];
  if (items.length === 0) {
    return '## 当前会话图片目录\n\n本会话暂无可引用的图片。';
  }
  const lines = items.map((item) => {
    const sourceLabel = item.source === 'ai_generated' ? 'AI生成' : '用户上传';
    const fromText = item.generatedFrom?.length
      ? `（基于图${item.generatedFrom.join('、图')}修改）`
      : '';
    return `${item.label}: [${sourceLabel}] ${item.name}${fromText} — ${item.url}`;
  });
  return [
    '## 当前会话图片目录',
    '',
    '你可以在调用 generate_image 时引用以下图片的 URL：',
    '',
    ...lines,
    '',
    '引用规则：',
    '- edit_image 时，input_image_urls 必须从本目录中选取',
    '- 用户说"原图""上一张""图1"等指代时，对照本目录理解',
  ].join('\n');
};
