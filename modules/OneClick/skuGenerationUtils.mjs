export const buildSkuGenerationAssets = ({ currentImages, firstSkuResultUrl, isFirst }) => {
  const productUrls = currentImages
    .filter((item) => item.role === 'product' && item.uploadedUrl)
    .map((item) => item.uploadedUrl);

  const giftUrls = currentImages
    .filter((item) => item.role === 'gift' && item.uploadedUrl)
    .sort((a, b) => (a.giftIndex || 0) - (b.giftIndex || 0))
    .map((item) => item.uploadedUrl);

  const uploadedStyleRefUrl = currentImages.find((item) => item.role === 'style_ref' && item.uploadedUrl)?.uploadedUrl || null;
  const styleRefUrl = !isFirst && firstSkuResultUrl ? firstSkuResultUrl : uploadedStyleRefUrl;
  const imageUrls = [...productUrls, ...giftUrls, ...(styleRefUrl ? [styleRefUrl] : [])];
  const generationImageUrls = [...productUrls, ...giftUrls];

  return {
    productUrls,
    giftUrls,
    styleRefUrl,
    imageUrls,
    generationImageUrls,
  };
};
