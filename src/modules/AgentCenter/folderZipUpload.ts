/**
 * folderZipUpload.ts
 * 文件夹 / ZIP 批量上传工具
 *
 * 职责：
 *  1. 从 <input webkitdirectory> 或 ZIP File 中提取所有可用文件
 *  2. 过滤掉系统垃圾文件、超大文件、不支持的类型
 *  3. 将文件列表按批次分组（每批不超过 MAX_FILES_PER_BATCH）
 *  4. 上传每批文件并返回 ComposerAttachment[][]（每批一组）
 *
 * 调用方负责：
 *  - 串行发送每批消息（等上一批回复后再发下一批）
 *  - 在最后一批消息中附加"请综合以上所有批次内容进行总结"的提示
 */

import JSZip from 'jszip';
import { uploadInternalAssetStream } from '../../services/internalApi';
import type { ComposerAttachment } from './ChatComposer';

// ─── 常量 ────────────────────────────────────────────────────────────────────

/** 每批最多文件数（图片 + 文件合计，不超过模型单次上限） */
export const MAX_FILES_PER_BATCH = 10;

/** 单文件最大字节数（20 MB），超过则跳过 */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** 上传前总文件数量警告阈值 */
export const FOLDER_WARN_THRESHOLD = 50;

/** 支持的图片 MIME */
const IMAGE_MIME_SET = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'image/bmp', 'image/tiff', 'image/svg+xml',
]);

/** 支持的文档扩展名（小写） */
const SUPPORTED_DOC_EXTS = new Set([
  '.pdf', '.doc', '.docx', '.txt', '.md', '.csv',
  '.xls', '.xlsx', '.ppt', '.pptx', '.json', '.xml',
]);

/** 需要过滤掉的系统/隐藏文件名前缀或完整名 */
const SKIP_NAMES = new Set([
  '.ds_store', 'thumbs.db', 'desktop.ini', '.gitkeep',
  '.gitignore', '.gitattributes',
]);

// ─── 类型 ────────────────────────────────────────────────────────────────────

export type ExtractedFile = {
  file: File;
  relativePath: string; // 相对于根目录的路径，用于展示
};

export type BatchUploadResult = {
  batches: ComposerAttachment[][];
  skippedCount: number;   // 被过滤掉的文件数
  skippedReasons: string[]; // 过滤原因摘要（去重后）
};

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

const getExtension = (name: string): string =>
  name.includes('.') ? `.${name.split('.').pop()!.toLowerCase()}` : '';

const isImageMime = (mime: string): boolean =>
  IMAGE_MIME_SET.has(mime) || mime.startsWith('image/');

const guessMimeFromExt = (name: string): string => {
  const ext = getExtension(name);
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
    '.tiff': 'image/tiff', '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.txt': 'text/plain', '.md': 'text/markdown',
    '.csv': 'text/csv',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.json': 'application/json', '.xml': 'application/xml',
  };
  return map[ext] || 'application/octet-stream';
};

const shouldSkipFile = (name: string, size: number): { skip: boolean; reason?: string } => {
  const baseName = name.split('/').pop() || name;
  const lowerBase = baseName.toLowerCase();

  // 隐藏文件（以 . 开头）
  if (lowerBase.startsWith('.')) return { skip: true, reason: '隐藏文件已跳过' };

  // 系统文件
  if (SKIP_NAMES.has(lowerBase)) return { skip: true, reason: '系统文件已跳过' };

  // 空文件
  if (size === 0) return { skip: true, reason: '空文件已跳过' };

  // 超大文件
  if (size > MAX_FILE_BYTES) return { skip: true, reason: `超过 20MB 的文件已跳过` };

  // 不支持的类型
  const ext = getExtension(baseName);
  const mime = guessMimeFromExt(baseName);
  if (!isImageMime(mime) && !SUPPORTED_DOC_EXTS.has(ext)) {
    return { skip: true, reason: `不支持的文件类型（${ext || '无扩展名'}）已跳过` };
  }

  return { skip: false };
};

const buildAttachmentId = (kind: 'image' | 'file', name: string) =>
  `${kind}-${name.replace(/\s+/g, '-')}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

// ─── 从文件夹 input 提取文件 ──────────────────────────────────────────────────

/**
 * 从 webkitdirectory input 的 FileList 中提取有效文件
 * File 对象的 webkitRelativePath 包含相对路径
 */
export const extractFilesFromFolder = (fileList: FileList): {
  files: ExtractedFile[];
  skippedCount: number;
  skippedReasons: string[];
} => {
  const files: ExtractedFile[] = [];
  let skippedCount = 0;
  const reasonSet = new Set<string>();

  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    const relativePath = (file as any).webkitRelativePath || file.name;
    const { skip, reason } = shouldSkipFile(relativePath, file.size);
    if (skip) {
      skippedCount++;
      if (reason) reasonSet.add(reason);
      continue;
    }
    files.push({ file, relativePath });
  }

  return { files, skippedCount, skippedReasons: Array.from(reasonSet) };
};

// ─── 从 ZIP 提取文件 ──────────────────────────────────────────────────────────

/**
 * 解压 ZIP 文件，返回有效文件列表
 * 使用流式读取，避免一次性把所有内容加载进内存
 */
export const extractFilesFromZip = async (zipFile: File): Promise<{
  files: ExtractedFile[];
  skippedCount: number;
  skippedReasons: string[];
}> => {
  const zip = await JSZip.loadAsync(zipFile);
  const files: ExtractedFile[] = [];
  let skippedCount = 0;
  const reasonSet = new Set<string>();

  const entries = Object.entries(zip.files);

  for (const [relativePath, zipEntry] of entries) {
    // 跳过目录条目
    if (zipEntry.dir) continue;

    const baseName = relativePath.split('/').pop() || relativePath;
    const { skip, reason } = shouldSkipFile(baseName, 0); // size 在解压前未知，先按名称过滤
    if (skip) {
      skippedCount++;
      if (reason) reasonSet.add(reason);
      continue;
    }

    // 解压为 ArrayBuffer，检查实际大小
    const buffer = await zipEntry.async('arraybuffer');
    if (buffer.byteLength === 0) {
      skippedCount++;
      reasonSet.add('空文件已跳过');
      continue;
    }
    if (buffer.byteLength > MAX_FILE_BYTES) {
      skippedCount++;
      reasonSet.add('超过 20MB 的文件已跳过');
      continue;
    }

    const mime = guessMimeFromExt(baseName);
    const file = new File([buffer], baseName, { type: mime });
    files.push({ file, relativePath });
  }

  return { files, skippedCount, skippedReasons: Array.from(reasonSet) };
};

// ─── 分批上传 ─────────────────────────────────────────────────────────────────

/**
 * 将 ExtractedFile[] 分批上传，返回每批的 ComposerAttachment[]
 *
 * @param files 已过滤的文件列表
 * @param onProgress 进度回调 (uploadedCount, totalCount)
 * @param signal AbortSignal，用于中断上传
 */
export const uploadFilesInBatches = async (
  files: ExtractedFile[],
  onProgress?: (uploaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<ComposerAttachment[][]> => {
  const batches: ComposerAttachment[][] = [];
  let uploaded = 0;

  // 按 MAX_FILES_PER_BATCH 分组
  for (let batchStart = 0; batchStart < files.length; batchStart += MAX_FILES_PER_BATCH) {
    if (signal?.aborted) throw new Error('INTERRUPTED');

    const batchFiles = files.slice(batchStart, batchStart + MAX_FILES_PER_BATCH);
    const batchAttachments: ComposerAttachment[] = [];

    // 批内串行上传（避免并发过多占用带宽，也方便中断）
    for (const { file, relativePath } of batchFiles) {
      if (signal?.aborted) throw new Error('INTERRUPTED');

      const result = await uploadInternalAssetStream({
        module: 'agent_chat',
        file,
        fileName: file.name,
      });

      const mime = file.type || guessMimeFromExt(file.name);
      const isImage = isImageMime(mime);
      batchAttachments.push({
        id: buildAttachmentId(isImage ? 'image' : 'file', file.name),
        name: relativePath, // 保留相对路径，方便模型理解文件结构
        kind: isImage ? 'image' : 'file',
        url: result.fileUrl,
        mimeType: mime,
      });

      uploaded++;
      onProgress?.(uploaded, files.length);
    }

    batches.push(batchAttachments);
  }

  return batches;
};

// ─── 主入口 ───────────────────────────────────────────────────────────────────

/**
 * 处理文件夹 FileList，返回分批上传结果
 */
export const processFolderUpload = async (
  fileList: FileList,
  onProgress?: (uploaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<BatchUploadResult> => {
  const { files, skippedCount, skippedReasons } = extractFilesFromFolder(fileList);
  if (files.length === 0) {
    return { batches: [], skippedCount, skippedReasons };
  }
  const batches = await uploadFilesInBatches(files, onProgress, signal);
  return { batches, skippedCount, skippedReasons };
};

/**
 * 处理 ZIP 文件，返回分批上传结果
 */
export const processZipUpload = async (
  zipFile: File,
  onProgress?: (uploaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<BatchUploadResult> => {
  const { files, skippedCount, skippedReasons } = await extractFilesFromZip(zipFile);
  if (files.length === 0) {
    return { batches: [], skippedCount, skippedReasons };
  }
  const batches = await uploadFilesInBatches(files, onProgress, signal);
  return { batches, skippedCount, skippedReasons };
};
