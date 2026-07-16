import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const envExample = readFileSync(new URL('../.env.server.example', import.meta.url), 'utf8');
const projectOverview = readFileSync(new URL('../docs/project-overview.md', import.meta.url), 'utf8');
const deployDoc = readFileSync(new URL('../docs/tencent-cloud-deploy.md', import.meta.url), 'utf8');

test('第4期多工具 env 旋钮同步到模板、项目总览和部署文档', () => {
  assert.match(envExample, /AGENT_TOOL_MAX_ROUNDS/);
  assert.match(envExample, /OPENAI_COMPATIBLE_RESPONSES_PATH/);
  assert.match(envExample, /\/v1\/responses/);
  assert.match(envExample, /MEIAO_KIE_ASSET_UPLOAD_TIMEOUT_MS/);
  assert.match(envExample, /AGENT_IMAGE_TOOL_CONCURRENCY/);

  assert.match(projectOverview, /AGENT_TOOL_MAX_ROUNDS/);
  assert.match(projectOverview, /OPENAI_COMPATIBLE_RESPONSES_PATH/);
  assert.match(projectOverview, /MEIAO_KIE_ASSET_UPLOAD_TIMEOUT_MS/);
  assert.match(projectOverview, /AGENT_IMAGE_TOOL_CONCURRENCY/);

  assert.match(deployDoc, /AGENT_TOOL_MAX_ROUNDS/);
  assert.match(deployDoc, /OPENAI_COMPATIBLE_RESPONSES_PATH/);
  assert.match(deployDoc, /MEIAO_KIE_ASSET_UPLOAD_TIMEOUT_MS/);
  assert.match(deployDoc, /AGENT_IMAGE_TOOL_CONCURRENCY/);
});

test('托管素材直连与 KIE 回退旋钮同步到模板、总览和云上部署文档', () => {
  const requiredKeys = [
    'MEIAO_KIE_MANAGED_ASSET_MODE',
    'MEIAO_KIE_ASSET_UPLOAD_CONCURRENCY',
    'MEIAO_KIE_ASSET_UPLOAD_RETRIES',
    'MEIAO_KIE_ASSET_UPLOAD_RETRY_BASE_MS',
    'MEIAO_KIE_ASSET_UPLOAD_CACHE_TTL_MS',
    'MEIAO_KIE_ASSET_UPLOAD_CACHE_MAX_ENTRIES',
  ];

  for (const key of requiredKeys) {
    assert.match(envExample, new RegExp(key));
    assert.match(projectOverview, new RegExp(key));
    assert.match(deployDoc, new RegExp(key));
  }
  assert.match(deployDoc, /MEIAO_PUBLIC_BASE_URL=https:\/\/meiaoyuntai\.com/);
  assert.match(deployDoc, /kie-only/);
});

test('Gemini 视频 COS 直连配置同步到模板、总览和云上部署文档', () => {
  const requiredKeys = [
    'MEIAO_COS_SECRET_ID',
    'MEIAO_COS_SECRET_KEY',
    'MEIAO_COS_BUCKET',
    'MEIAO_COS_REGION',
    'MEIAO_COS_SIGNED_URL_TTL_SECONDS',
  ];

  for (const key of requiredKeys) {
    assert.match(envExample, new RegExp(key));
    assert.match(projectOverview, new RegExp(key));
    assert.match(deployDoc, new RegExp(key));
  }
  assert.match(deployDoc, /无需 CDN/);
  assert.match(deployDoc, /禁止把视频转存到 KIE/);
});

test('用户上传图片 COS 和持久清理配置同步到模板、总览和云上部署文档', () => {
  const requiredKeys = [
    'MEIAO_MANAGED_IMAGE_UPLOAD_MODE',
    'MEIAO_MANAGED_IMAGE_MAX_BYTES',
    'MEIAO_MANAGED_ASSET_ACCESS_SECRET',
    'MEIAO_MANAGED_ASSET_ACCESS_PREVIOUS_SECRET',
    'MEIAO_IMAGE_COS_SECRET_ID',
    'MEIAO_IMAGE_COS_SECRET_KEY',
    'MEIAO_IMAGE_COS_BUCKET',
    'MEIAO_IMAGE_COS_REGION',
    'MEIAO_IMAGE_COS_BROWSER_URL_TTL_SECONDS',
    'MEIAO_IMAGE_COS_PROVIDER_URL_TTL_SECONDS',
    'MEIAO_IMAGE_COS_UPLOAD_MAX_ATTEMPTS',
    'MEIAO_IMAGE_COS_UPLOAD_TIMEOUT_MS',
    'MEIAO_IMAGE_COS_UPLOAD_RETRY_BASE_MS',
    'MEIAO_IMAGE_COS_OPERATION_TIMEOUT_MS',
    'MEIAO_MANAGED_IMAGE_PROBE_INTERVAL_MS',
    'MEIAO_MANAGED_IMAGE_PROBE_MAX_AGE_MS',
    'MEIAO_MANAGED_IMAGE_PROBE_STATUS_FILE',
    'MEIAO_ASSET_CLEANUP_INTERVAL_MS',
    'MEIAO_TOMBSTONED_JOB_RECONCILE_INTERVAL_MS',
    'MEIAO_TOMBSTONED_JOB_PENDING_ALERT_MS',
    'MEIAO_ASSET_CLEANUP_BATCH_SIZE',
    'MEIAO_ASSET_CLEANUP_RETRY_BASE_MS',
    'MEIAO_ASSET_CLEANUP_MANUAL_REVIEW_ATTEMPTS',
    'MEIAO_ASSET_CLEANUP_MANUAL_RETRY_MS',
    'MEIAO_ASSET_CLEANUP_LEASE_MS',
    'MEIAO_ASSET_CLEANUP_ALERT_BACKLOG',
    'MEIAO_ASSET_CLEANUP_ALERT_OLDEST_MS',
    'MEIAO_ASSET_UPLOAD_STALE_MS',
    'MEIAO_ASSET_COS_RECONCILE_INTERVAL_MS',
    'MEIAO_ASSET_DELETE_GRACE_MS',
    'MEIAO_ASSET_USER_LOCK_TIMEOUT_SECONDS',
    'MEIAO_ASSET_LOCK_CONNECTION_LIMIT',
    'MEIAO_ASSET_AGENT_BUSY_LEASE_MS',
    'MEIAO_ASSET_CLEANUP_AUDIT_RETENTION_MS',
  ];

  for (const key of requiredKeys) {
    assert.match(envExample, new RegExp(key));
    assert.match(projectOverview, new RegExp(key));
    assert.match(deployDoc, new RegExp(key));
  }
  assert.match(deployDoc, /meiao-managed-images-1406860462/);
  assert.match(deployDoc, /managed-images\/\*/);
  assert.match(deployDoc, /版本控制关闭/);
  assert.match(deployDoc, /未完成的分块上传/);
  assert.match(deployDoc, /probe:managed-image-cos/);
  assert.match(projectOverview, /managedImageUpload/);
  assert.match(deployDoc, /managedImageUpload/);
});

test('结果素材下载重试旋钮同步到模板、总览和云上部署文档', () => {
  const requiredKeys = [
    'MEIAO_RESULT_ASSET_DOWNLOAD_TIMEOUT_MS',
    'MEIAO_RESULT_ASSET_DOWNLOAD_RETRIES',
    'MEIAO_RESULT_ASSET_DOWNLOAD_RETRY_BASE_MS',
  ];

  for (const key of requiredKeys) {
    assert.match(envExample, new RegExp(key));
    assert.match(projectOverview, new RegExp(key));
    assert.match(deployDoc, new RegExp(key));
  }
});

test('音视频裁剪转码配置同步到模板、总览和云上部署文档', () => {
  const requiredKeys = [
    'MEIAO_MEDIA_TRANSCODE_ENABLED',
    'MEIAO_FFMPEG_PATH',
    'MEIAO_FFPROBE_PATH',
    'MEIAO_MEDIA_TRANSCODE_INPUT_MAX_BYTES',
    'MEIAO_MEDIA_TRANSCODE_CONCURRENCY',
    'MEIAO_MEDIA_TRANSCODE_TIMEOUT_MS',
    'MEIAO_MEDIA_PROBE_TIMEOUT_MS',
    'MEIAO_MEDIA_TRANSCODE_SESSION_TTL_MS',
    'MEIAO_MEDIA_TRANSCODE_MAX_SESSIONS',
  ];

  for (const key of requiredKeys) {
    assert.match(envExample, new RegExp(key));
    assert.match(projectOverview, new RegExp(key));
    assert.match(deployDoc, new RegExp(key));
  }
});

test('视频去字幕服务端配置同步到模板、总览和云上部署文档', () => {
  const requiredKeys = [
    'GOLDEN_SUBTITLE_API_TOKEN',
    'MEIAO_SUBTITLE_REMOVAL_ENABLED',
    'MEIAO_SUBTITLE_REMOVAL_BASE_URL',
    'MEIAO_SUBTITLE_REMOVAL_POLL_INTERVAL_MS',
    'MEIAO_SUBTITLE_REMOVAL_TIMEOUT_MS',
    'MEIAO_SUBTITLE_REMOVAL_PROBE_INSPECTION_MS',
  ];

  for (const key of requiredKeys) {
    assert.match(envExample, new RegExp(key));
    assert.match(projectOverview, new RegExp(key));
    assert.match(deployDoc, new RegExp(key));
  }
  assert.match(envExample, /^GOLDEN_SUBTITLE_API_TOKEN=\s*$/m);
  assert.match(deployDoc, /默认关闭/);
  assert.match(deployDoc, /仅写入服务端/);
  assert.match(deployDoc, /单次付费探针/);
});
