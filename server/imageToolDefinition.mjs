const VALID_ASPECT_RATIOS = ['auto', '1:1', '4:3', '3:4', '16:9', '9:16'];

export const GENERATE_IMAGE_TOOL = {
  type: 'function',
  function: {
    name: 'generate_image',
    description: '生成或编辑图片。当用户需要创建新图片、修改已有图片、换背景、局部重绘等任何图片操作时调用。',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: '完整的生图提示词，包含主体、场景、风格、色调等描述',
        },
        task_type: {
          type: 'string',
          enum: ['new_image', 'edit_image'],
          description: 'new_image=从零生成新图，edit_image=基于已有图片修改',
        },
        input_image_urls: {
          type: 'array',
          items: { type: 'string' },
          description: 'edit_image 时必填，要编辑/参考的图片 URL，从会话图片目录中选取',
        },
        aspect_ratio: {
          type: 'string',
          enum: VALID_ASPECT_RATIOS,
          description: '图片比例，默认 auto，仅在用户明确指定比例时修改',
        },
      },
      required: ['prompt', 'task_type'],
    },
  },
};

export const normalizeGenerateImageArgs = (rawArgs = {}) => {
  const prompt = String(rawArgs?.prompt || '').trim();
  if (!prompt) {
    const error = new Error('generate_image 缺少 prompt');
    error.code = 'invalid_tool_args';
    throw error;
  }
  const inputImageUrls = Array.from(new Set(
    (Array.isArray(rawArgs?.input_image_urls) ? rawArgs.input_image_urls : [])
      .map((u) => String(u || '').trim())
      .filter(Boolean)
  ));
  const rawTaskType = String(rawArgs?.task_type || '').trim();
  const taskType = rawTaskType === 'edit_image' || rawTaskType === 'new_image'
    ? rawTaskType
    : (inputImageUrls.length > 0 ? 'edit_image' : 'new_image');
  const rawAspect = String(rawArgs?.aspect_ratio || '').trim();
  const aspectRatio = VALID_ASPECT_RATIOS.includes(rawAspect) ? rawAspect : 'auto';
  return { prompt, taskType, inputImageUrls, aspectRatio };
};
