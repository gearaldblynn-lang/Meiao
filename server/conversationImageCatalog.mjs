const normalizeUrl = (value) => String(value || '').trim();

export const buildSessionImageCatalog = ({ attachments = [], priorMessages = [] } = {}) => {
  const seen = new Set();
  const items = [];
  const byUrl = new Map();

  const pushItem = ({ url, name, source, generatedFrom = [], isCurrentFocus = false }) => {
    const u = normalizeUrl(url);
    if (!u) return null;
    if (seen.has(u)) {
      const existing = byUrl.get(u);
      if (existing && isCurrentFocus) existing.isCurrentFocus = true;
      return existing || null;
    }
    seen.add(u);
    const item = { url: u, name: String(name || '').trim() || '图片', source, generatedFrom, isCurrentFocus: Boolean(isCurrentFocus) };
    items.push(item);
    byUrl.set(u, item);
    return item;
  };

  (Array.isArray(attachments) ? attachments : [])
    .filter((attachment) => attachment?.kind === 'image')
    .forEach((attachment) => pushItem({ url: attachment.url, name: attachment.name, source: 'user_upload', isCurrentFocus: true }));

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
    (Array.isArray(message?.metadata?.imageResultUrls) ? message.metadata.imageResultUrls : [])
      .forEach((url) => collect(url));
  });

  const indexOfUrl = new Map();
  items.forEach((item, i) => indexOfUrl.set(item.url, i + 1));
  let nextIndex = items.length + 1;
  tempOrder.forEach((url) => {
    if (!indexOfUrl.has(url)) indexOfUrl.set(url, nextIndex++);
  });

  let latestGenerated = null;
  history.forEach((message) => {
    (Array.isArray(message?.attachments) ? message.attachments : [])
      .filter((attachment) => attachment?.kind === 'image')
      .forEach((attachment) => {
        const source = message?.role === 'assistant' ? 'ai_generated' : 'user_upload';
        const item = pushItem({ url: attachment.url, name: attachment.name, source });
        if (source === 'ai_generated' && item) latestGenerated = item;
      });
    const genUrl = normalizeUrl(message?.metadata?.imageUrl);
    if (genUrl) {
      const inputs = Array.isArray(message?.metadata?.imagePlan?.inputImageUrls)
        ? message.metadata.imagePlan.inputImageUrls
        : [];
      const generatedFrom = inputs
        .map((url) => indexOfUrl.get(normalizeUrl(url)))
        .filter((index) => Number.isInteger(index));
      const item = pushItem({ url: genUrl, name: 'AI 生成结果', source: 'ai_generated', generatedFrom });
      if (item) latestGenerated = item;
    }
    (Array.isArray(message?.metadata?.imageResultUrls) ? message.metadata.imageResultUrls : [])
      .forEach((url, index) => {
        const inputs = Array.isArray(message?.metadata?.imagePlan?.inputImageUrls)
          ? message.metadata.imagePlan.inputImageUrls
          : [];
        const generatedFrom = inputs
          .map((inputUrl) => indexOfUrl.get(normalizeUrl(inputUrl)))
          .filter((inputIndex) => Number.isInteger(inputIndex));
        const item = pushItem({ url, name: `AI 生成结果 ${index + 1}`, source: 'ai_generated', generatedFrom });
        if (item) latestGenerated = item;
      });
  });

  if (!items.some((item) => item.isCurrentFocus) && latestGenerated) {
    latestGenerated.isCurrentFocus = true;
  }

  return items.map((item, i) => ({
    index: i + 1,
    label: `图${i + 1}`,
    url: item.url,
    name: item.name,
    source: item.source,
    generatedFrom: item.generatedFrom,
    isCurrentFocus: Boolean(item.isCurrentFocus),
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
  const currentFocus = items.find((item) => item.isCurrentFocus);
  const lines = items.map((item) => {
    const sourceLabel = item.source === 'ai_generated' ? 'AI生成' : '用户上传';
    const fromText = item.generatedFrom?.length
      ? `（基于图${item.generatedFrom.join('、图')}修改）`
      : '';
    const focusText = item.isCurrentFocus ? '（当前默认编辑图）' : '';
    return `${item.label}: [${sourceLabel}] ${item.name}${fromText}${focusText} — ${item.url}`;
  });
  return [
    '## 当前会话图片目录',
    '',
    '你可以在调用 generate_image 时引用以下图片的 URL：',
    '',
    ...lines,
    currentFocus ? `\n当前默认编辑图：${currentFocus.label}。当用户说"这张/上一张/刚才那张/继续修改/再改一下"且没有新上传图片或明确指定其它图时，默认指向这张图。` : '',
    '',
    '引用规则：',
    '- edit_image 时，input_image_urls 必须从本目录中选取',
    '- 用户说"原图""上一张""图1"等指代时，对照本目录理解',
  ].join('\n');
};
