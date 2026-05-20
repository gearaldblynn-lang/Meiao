import { resolvePublicAssetUrl } from '../../utils/modelAssetUrl.mjs';

export const buildSkuGenerationAssets = ({ currentImages, firstSkuResultUrl, isFirst, publicBaseUrl = '' }) => {
  const normalize = (value) => resolvePublicAssetUrl(value, publicBaseUrl) || '';
  const productUrls = currentImages
    .filter((item) => item.role === 'product' && item.uploadedUrl)
    .map((item) => normalize(item.uploadedUrl))
    .filter(Boolean);

  const giftUrls = currentImages
    .filter((item) => item.role === 'gift' && item.uploadedUrl)
    .sort((a, b) => (a.giftIndex || 0) - (b.giftIndex || 0))
    .map((item) => normalize(item.uploadedUrl))
    .filter(Boolean);

  const uploadedStyleRefUrl = currentImages.find((item) => item.role === 'style_ref' && item.uploadedUrl)?.uploadedUrl || null;
  const styleRefUrl = !isFirst && firstSkuResultUrl ? normalize(firstSkuResultUrl) : normalize(uploadedStyleRefUrl);
  const imageUrls = [...productUrls, ...giftUrls, ...(styleRefUrl ? [styleRefUrl] : [])];
  const generationImageUrls = imageUrls;

  return {
    productUrls,
    giftUrls,
    styleRefUrl,
    imageUrls,
    generationImageUrls,
  };
};
