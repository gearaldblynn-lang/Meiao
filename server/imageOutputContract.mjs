const toSafeDiagnosticCode = (error) => String(error?.code || error?.name || 'quarantine_persist_failed')
  .replace(/[^a-zA-Z0-9_.-]+/g, '_')
  .slice(0, 80);

export const createProviderCompletedImageOutputRejectedError = ({
  job,
  output,
  result,
  sourceUrl = '',
  persisted,
  transformed,
  quarantineError,
}) => {
  const {
    imageUrl: _discardedImageUrl,
    imageUrlAssetId: _discardedImageAssetId,
    imageOutputTransform: _discardedImageOutputTransform,
    ...safeResult
  } = result || {};
  const providerTaskId = String(output?.providerTaskId || job?.providerTaskId || '').trim();
  const imageOutputContract = {
    status: 'rejected',
    reason: 'aspect_ratio_mismatch',
    sourceWidth: Number(transformed?.sourceWidth || transformed?.width || 0),
    sourceHeight: Number(transformed?.sourceHeight || transformed?.height || 0),
    targetWidth: Number(transformed?.targetWidth || 0),
    targetHeight: Number(transformed?.targetHeight || 0),
    provider: String(job?.provider || ''),
    providerTaskId,
    ...(quarantineError
      ? {
          quarantinePersistence: {
            status: 'failed',
            code: toSafeDiagnosticCode(quarantineError),
          },
        }
      : { quarantinePersistence: { status: 'succeeded' } }),
  };
  const rejectedResult = {
    ...safeResult,
    ...(String(persisted?.publicUrl || '').trim()
      ? { quarantinedImageUrl: String(persisted.publicUrl).trim() }
      : {}),
    ...(String(persisted?.id || '').trim()
      ? { quarantinedImageAssetId: String(persisted.id).trim() }
      : {}),
    ...(/^https?:\/\//i.test(String(sourceUrl || '').trim())
      ? { providerImageUrl: String(sourceUrl).trim() }
      : {}),
    imageOutputContract,
  };
  const error = new Error(
    `模型返回图片比例与原图不一致：${imageOutputContract.sourceWidth}x${imageOutputContract.sourceHeight} -> ${imageOutputContract.targetWidth}x${imageOutputContract.targetHeight}，系统已阻止拉伸。`,
  );
  error.code = 'image_output_aspect_ratio_mismatch';
  error.providerStage = 'output_transform';
  error.providerStatus = 'completed_output_rejected';
  error.providerCompleted = true;
  error.quarantinePersistenceErrorCode = quarantineError ? toSafeDiagnosticCode(quarantineError) : '';
  error.providerTaskId = providerTaskId;
  error.rejectedOutput = {
    ...output,
    providerTaskId,
    result: rejectedResult,
  };
  return error;
};
