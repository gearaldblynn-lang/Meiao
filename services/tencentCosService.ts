
import { GlobalApiConfig } from "../types";
import { fileToBase64 } from "../utils/imageUtils";

/**
 * 辅助函数：递归从 API 响应中查找 URL
 * 解决不同 API 端点返回结构不一致的问题 (data.fileUrl, data.url, data string, etc.)
 */
const extractUrlFromResponse = (result: any): string | null => {
  if (!result) return null;

  // 1. 优先检查标准路径
  if (result.data) {
    if (typeof result.data === 'string' && result.data.startsWith('http')) return result.data;
    if (typeof result.data === 'object') {
      if (result.data.fileUrl && typeof result.data.fileUrl === 'string') return result.data.fileUrl;
      if (result.data.url && typeof result.data.url === 'string') return result.data.url;
      if (result.data.downloadUrl && typeof result.data.downloadUrl === 'string') return result.data.downloadUrl;
    }
  }
  if (result.fileUrl && typeof result.fileUrl === 'string') return result.fileUrl;
  if (result.url && typeof result.url === 'string') return result.url;

  // 2. 深度递归搜索任何看起来像 URL 的字符串 (作为最后手段)
  const findUrlRecursively = (obj: any, depth = 0): string | null => {
    if (!obj || depth > 3) return null;
    
    // 如果直接是字符串且像 URL
    if (typeof obj === 'string') {
      if (obj.startsWith('http://') || obj.startsWith('https://')) return obj;
      return null;
    }

    if (typeof obj === 'object') {
      for (const key in obj) {
        // 忽略可能包含非图片 URL 的无关字段
        if (key === 'msg' || key === 'message' || key === 'error') continue;
        
        const val = obj[key];
        const found = findUrlRecursively(val, depth + 1);
        if (found) return found;
      }
    }
    return null;
  };

  return findUrlRecursively(result);
};

/**
 * 上传文件到 Kie.ai 临时存储
 * (保留函数名 uploadToCos 以兼容现有调用逻辑，实际上使用 Kie API)
 */
export const uploadToCos = async (file: File, apiConfig: GlobalApiConfig): Promise<string> => {
  if (!file) {
    throw new Error("文件对象为空");
  }
  if (!apiConfig.kieApiKey) {
    throw new Error("Kie API Key 未配置，请在设置中检查");
  }

  // 1. 尝试文件流上传 (Stream Upload) - 优先使用，效率高
  try {
    const formData = new FormData();
    formData.append('file', file);
    if (file.name) {
      formData.append('fileName', file.name);
    }
    formData.append('uploadPath', 'mayo-storage'); 

    const response = await fetch('https://kieai.redpandaai.co/api/file-stream-upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiConfig.kieApiKey}`
      },
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn('Kie Stream Upload Failed:', response.status, errorText);
      throw new Error(`Stream upload failed (${response.status}): ${response.statusText}`);
    }

    const result = await response.json();
    const fileUrl = extractUrlFromResponse(result);
    
    if ((result.success || result.code === 200) && fileUrl) {
      return fileUrl;
    } else {
      throw new Error(result.msg || 'Stream upload API response invalid');
    }
  } catch (streamError: any) {
    console.warn("Stream upload encountered error, attempting Base64 fallback...", streamError.message);

    // 2. 失败回退：Base64 上传 (仅当文件小于 10MB)
    if (file.size < 10 * 1024 * 1024) {
      try {
        const rawBase64 = await fileToBase64(file);
        const mimeType = file.type || "application/octet-stream";
        const dataUri = `data:${mimeType};base64,${rawBase64}`;

        const response = await fetch('https://kieai.redpandaai.co/api/file-base64-upload', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiConfig.kieApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            base64Data: dataUri,
            uploadPath: 'mayo-storage',
            fileName: file.name
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Base64 upload failed (${response.status}): ${errorText}`);
        }

        const result = await response.json();
        const fileUrl = extractUrlFromResponse(result);
        
        if (fileUrl) {
          return fileUrl;
        } else {
          // 记录完整的响应对象以便调试
          console.error("Base64 upload response missing URL. Full response:", result);
          
          // 如果消息说是成功的，但没找到 URL，我们需要给出一个明确的错误，而不是直接抛出 "Success"
          const apiMsg = result.msg || result.message || 'Unknown error';
          if (apiMsg.toLowerCase().includes('success')) {
             throw new Error("Upload API reported success but returned no image URL.");
          }
          throw new Error(apiMsg);
        }
      } catch (base64Error: any) {
        console.error("Base64 fallback also failed:", base64Error);
        throw new Error(`图床上传失败: ${base64Error.message}`);
      }
    } else {
      throw new Error(`图床上传失败 (流式上传错误): ${streamError.message}`);
    }
  }
};
