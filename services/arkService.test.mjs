import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const arkServiceSource = readFileSync(new URL('./arkService.ts', import.meta.url), 'utf8');
const skuSubModuleSource = readFileSync(new URL('../modules/OneClick/SkuSubModule.tsx', import.meta.url), 'utf8');

test('marketing scheme copy layout template only treats title as required and allows flexible extra copy lines', () => {
  assert.match(
    arkServiceSource,
    /主标题\(字体大小,\s*字体以及字重,\s*位置,\s*颜色色号\):"xxx"/,
    'marketing prompt should define the generic required title line'
  );
  assert.match(
    arkServiceSource,
    /其他文案\(字体大小,\s*字体以及字重,\s*位置,\s*颜色色号\):"xxx"/,
    'marketing prompt should define a reusable optional copy line'
  );
  assert.doesNotMatch(
    arkServiceSource,
    /必须严格按“主标题 \/ 副标题 \/ 场景文案”三行结构输出/,
    'marketing prompt should no longer force subtitle and scene copy lines'
  );
  assert.doesNotMatch(
    arkServiceSource,
    /若某屏不需要其中某项，也要明确写“无”/,
    'marketing prompt should no longer require placeholder 无 lines'
  );
});

test('sku planning prompt keeps main title required but leaves other copy lines optional', () => {
  assert.match(
    arkServiceSource,
    /主标题\(32pt,\s*黑体bold,\s*顶部居中,\s*颜色色号\):"xxx"/,
    'sku prompt should include the sample title line format'
  );
  assert.match(
    arkServiceSource,
    /其他文案\(字体大小,\s*字体以及字重,\s*位置,\s*颜色色号\):"xxx"/,
    'sku prompt should allow optional extra copy lines in the same format'
  );
  assert.match(
    arkServiceSource,
    /以上仅为格式示例，具体字体大小、字重、位置和颜色要按该SKU的实际设计来填写，不要机械固定照抄/,
    'sku prompt should clarify that the copy layout is a format spec rather than fixed values'
  );
  assert.doesNotMatch(
    arkServiceSource,
    /副标题\(字体大小,\s*字体字重,\s*位置,\s*字体颜色\):"文案内容"/,
    'sku prompt should not hardcode subtitle as a mandatory row'
  );
  assert.doesNotMatch(
    arkServiceSource,
    /促销文案\(字体大小,\s*字体字重,\s*位置,\s*字体颜色\):"文案内容"/,
    'sku prompt should not hardcode promo copy as a mandatory row'
  );
});

test('sku planning prompt removes design intent output and requires complete visual descriptions', () => {
  assert.doesNotMatch(
    arkServiceSource,
    /- 设计意图：一句话说明该 SKU 的视觉策略/,
    'sku planning prompt should no longer ask for a design intent field'
  );
  assert.match(
    arkServiceSource,
    /禁止使用“沿用SKU1.*跟第一张SKU一样.*与上一张一致”这类引用式描述/,
    'sku planning prompt should explicitly ban lazy cross-reference descriptions'
  );
  assert.match(
    arkServiceSource,
    /必须直接写完整的画面描述、排版方式、字体风格、文字摆放和配色要求/,
    'sku planning prompt should require the full visual description to be written out'
  );
  assert.match(
    arkServiceSource,
    /商品必须采用正面、稳定、正常陈列的展示角度，禁止躺着放、斜着放、倾倒放置/,
    'sku planning prompt should ban odd product placement angles'
  );
  assert.match(
    arkServiceSource,
    /赠品摆放不能喧宾夺主，主体商品必须最显眼、视觉占比最大/,
    'sku planning prompt should keep the main product visually dominant'
  );
  assert.match(
    arkServiceSource,
    /赠品可以按视觉美观适当缩小展示，不必严格还原真实大小/,
    'sku planning prompt should allow gifts to render smaller than real-world scale'
  );
  assert.match(
    arkServiceSource,
    /主体商品与赠品都必须正面、稳定、正常陈列/,
    'sku planning prompt should require both product and gifts to face forward'
  );
  assert.match(
    arkServiceSource,
    /文案排版中的文案文字必须全部使用目标文案语言/,
    'sku planning prompt should require the planned copy itself to use the target language'
  );
});

test('sku planning prompt uses style reference for layout typography and placement strategy', () => {
  assert.match(
    arkServiceSource,
    /风格参考图：\$\{styleUrl\}。除配色、光影、材质与氛围外，还要重点参考其排版、字体风格、文字摆放、版式层级/,
    'sku planning prompt should treat uploaded style refs as layout and typography guidance too'
  );
});

test('sku image prompt appends the target copy language hard constraint', () => {
  assert.match(
    skuSubModuleSource,
    /文案文字必须为[“”"]\$\{config\.language \|\| '中文'\}[“”"]/,
    'sku generation prompt should explicitly require generated text to use the target copy language'
  );
  assert.match(
    skuSubModuleSource,
    /禁止生成英文或其他非目标文案语言的文案文字/,
    'sku generation prompt should explicitly ban non-target-language text'
  );
  assert.match(
    skuSubModuleSource,
    /主体商品必须最显眼，赠品只能作为辅助点缀，不能喧宾夺主/,
    'sku generation prompt should keep the hero product visually dominant'
  );
  assert.match(
    skuSubModuleSource,
    /赠品可以比真实比例更小，但必须保持正面陈列/,
    'sku generation prompt should allow smaller gift scale while keeping gifts front-facing'
  );
  assert.match(
    skuSubModuleSource,
    /主体商品和赠品都必须正面、稳定、正常陈列，禁止躺放、斜放、倾倒/,
    'sku generation prompt should enforce upright placement for all items'
  );
  assert.doesNotMatch(
    skuSubModuleSource,
    /STRICT PRODUCT CONSISTENCY|Style Reference:|QUALITY:/,
    'sku generation prompt should not contain english guidance that can pollute generated copy'
  );
});

test('sku image prompt switches to first generated sku as strict style reference after the first image', () => {
  assert.match(
    skuSubModuleSource,
    /SKU风格基准（第一张生成结果，后续必须严格保持一致风格）/,
    'follow-up sku generations should treat the first generated image as the style baseline'
  );
  assert.match(
    skuSubModuleSource,
    /严格按照该风格参考图一致的排版、字体风格、文字摆放、色调和整体设计风格制作/,
    'follow-up sku generations should strongly enforce matching layout and design style'
  );
});

test('sku generation sends the complete asset url set into kie image tasks instead of product images only', () => {
  assert.match(
    skuSubModuleSource,
    /const\s+\{\s*imageUrls\s*\}\s*=\s*buildSkuGenerationAssets\(/,
    'sku generation should assemble all uploaded asset urls before calling kie'
  );
  assert.match(
    skuSubModuleSource,
    /processWithKieAi\(\s*imageUrls,\s*apiConfig,/,
    'sku generation should pass the complete image url set into kie'
  );
});
