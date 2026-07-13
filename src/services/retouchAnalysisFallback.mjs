const RETOUCH_ANALYSIS_FALLBACK_ERROR_CODES = new Set([
  'provider_submission_unknown',
  'provider_network_error',
  'provider_timeout',
  'provider_internal_error',
  'provider_bad_response',
  'provider_refusal',
  'provider_rate_limited',
  'provider_request_limit',
  'provider_auth_invalid',
  'provider_credit_insufficient',
]);

export const shouldUseRetouchAnalysisFallback = (error = {}) => {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || '').trim();
  if (message === 'INTERRUPTED') return false;
  return RETOUCH_ANALYSIS_FALLBACK_ERROR_CODES.has(code);
};

export const buildRetouchAnalysisFallback = ({
  mode = 'original',
  hasReference = false,
} = {}) => {
  const identityRules = [
    'Preserve the exact product identity, silhouette, proportions, camera angle, logo, label text, packaging graphics, colors, and all readable details.',
    'Correct exposure, white balance, contrast, reflections, perspective, minor defects, edge quality, and material texture with clean premium commercial lighting.',
    'Keep text and logos crisp and accurate without oversharpening, warped strokes, duplicated lettering, or invented marks.',
  ];
  const modeRules = mode === 'white_bg'
    ? [
        'Place the unchanged product on a clean pure white background with a natural, controlled contact shadow.',
        'Improve centering and scale only when needed so the product occupies about 80%-90% of the frame while remaining fully visible.',
        'Do not redesign, replace, deform, or add parts to the product.',
      ]
    : [
        'Retouch the existing image conservatively: preserve the existing background, scene, composition, product placement, camera angle, and main display relationship.',
        'Do not add, remove, replace, or redesign products, props, decorations, backgrounds, or other visual subjects.',
        'Limit changes to professional light, color, perspective, blemish, texture, and local-detail correction.',
      ];
  const referenceRule = hasReference
    ? ['Use the reference image only as a quality, lighting, and finishing guide; never copy or replace its product identity, text, logo, scene, or composition.']
    : [];

  return [...identityRules, ...modeRules, ...referenceRule]
    .map((rule, index) => `${index + 1}. ${rule}`)
    .join('\n');
};
