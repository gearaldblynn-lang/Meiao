import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const arkServiceSource = readFileSync(new URL('./arkService.ts', import.meta.url), 'utf8');
const skuSubModuleSource = readFileSync(new URL('../modules/OneClick/SkuSubModule.tsx', import.meta.url), 'utf8');
const retouchModuleSource = readFileSync(new URL('../modules/Retouch/RetouchModule.tsx', import.meta.url), 'utf8');

test('analysis service no longer routes planning through ark or doubao', () => {
  assert.doesNotMatch(
    arkServiceSource,
    /taskType:\s*'ark_response'/,
    'planning analysis should no longer enqueue ark response jobs'
  );
  assert.doesNotMatch(
    arkServiceSource,
    /provider:\s*'ark'/,
    'planning analysis should no longer use ark provider'
  );
  assert.doesNotMatch(
    arkServiceSource,
    /doubao-seed-/,
    'planning analysis should no longer hardcode doubao models'
  );
  assert.match(
    arkServiceSource,
    /taskType:\s*'kie_chat'/,
    'planning analysis should route through kie chat jobs'
  );
  assert.match(
    arkServiceSource,
    /provider:\s*'kie'/,
    'planning analysis should use kie provider'
  );
});

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

test('sku planning prompt prioritizes combo copy and forbids inventing extra copy lines', () => {
  assert.match(
    arkServiceSource,
    /文案排版必须优先使用【SKU 组合列表】里当前 SKU 对应的文案内容进行排版制作/,
    'sku planning should anchor copy layout to the configured sku combo text'
  );
  assert.match(
    arkServiceSource,
    /禁止擅自新增未在【SKU 组合列表】或【产品信息】中出现的新文案/,
    'sku planning should forbid invented copy beyond provided sources'
  );
  assert.match(
    arkServiceSource,
    /禁止把同一卖点换一种说法重复写多次，避免文案堆积和语义重复/,
    'sku planning should explicitly prevent repetitive copy stacking'
  );
  assert.match(
    arkServiceSource,
    /除主标题可基于产品信息做精炼提炼外，其他文案都必须有明确依据/,
    'sku planning should only allow limited title refinement from product info'
  );
});

test('one click reference analysis prompt supports grouped dimensions and outputs reusable summary', () => {
  assert.match(
    arkServiceSource,
    /export const analyzeOneClickReferenceSet = async/,
    'one click flow should expose a dedicated grouped reference analysis step'
  );
  assert.match(
    arkServiceSource,
    /scene:\s*OneClickSubMode/,
    'reference analysis should accept the current one-click scene'
  );
  assert.match(
    arkServiceSource,
    /请只分析用户勾选的参考维度/,
    'reference analysis should only cover the selected dimensions'
  );
  assert.match(
    arkServiceSource,
    /若勾选了文案内容，只提炼可复用的宣传表达方向/,
    'reference analysis should treat copy content as reusable messaging guidance'
  );
  assert.match(
    arkServiceSource,
    /不要分析这是什么产品、卖什么功能、适合什么人群/,
    'reference analysis should stay on design language and avoid product identification'
  );
  assert.match(
    arkServiceSource,
    /主图模式：重点总结主图框内的主体摆放、文案区摆放、信息层级与首屏吸睛方式/,
    'main image reference analysis should focus on hero frame composition'
  );
  assert.match(
    arkServiceSource,
    /详情模式：重点总结整套详情的风格统一方式、版式节奏、模块排布与长图阅读层级/,
    'detail reference analysis should focus on detail-page rhythm and layout'
  );
  assert.match(
    arkServiceSource,
    /SKU模式：重点总结SKU排版结构、组合呈现方式、不同SKU之间如何保持统一又有区分/,
    'sku reference analysis should focus on sku structure and presentation'
  );
  assert.match(
    arkServiceSource,
    /只输出用户实际勾选的维度对应栏目，没勾选的维度不要输出/,
    'reference analysis should only output the selected dimension sections'
  );
  assert.match(
    arkServiceSource,
    /如果用户勾选了“视觉风格”，输出：- 视觉风格：xxx（主要描述视觉形式，设计风格，设计偏向）/,
    'reference analysis should conditionally output the visual-style section'
  );
  assert.match(
    arkServiceSource,
    /如果用户勾选了“字体”，输出：- 字体：主要描述不同的字体的选用，字体的大小，字重，字体间配色，营造的调性/,
    'reference analysis should conditionally output the typography section'
  );
  assert.match(
    arkServiceSource,
    /如果用户勾选了“色调”，输出：- 色调：主要描述整体的色调搭配，色彩倾向，背景，点缀，辅助色等等/,
    'reference analysis should conditionally output the color section'
  );
  assert.match(
    arkServiceSource,
    /如果用户勾选了“排版”，输出：- 排版：版式设计，构图设计内容，组合等等/,
    'reference analysis should conditionally output the layout section'
  );
  assert.match(
    arkServiceSource,
    /如果用户勾选了“文案内容”，输出：- 文案内容：摘选一些直接抄的文案卖点（一般只有跟产品是同样的产品的时候才会选择）/,
    'reference analysis should conditionally output the copy-content section'
  );
  assert.match(
    arkServiceSource,
    /如果同一维度在这组图中风格高度统一，要总结出更具体的共性特征/,
    'reference analysis should ask for concrete common traits when the references are consistent'
  );
  assert.match(
    arkServiceSource,
    /如果同一维度在这组图中差异较大，要提炼更抽象、更上位的大致共性/,
    'reference analysis should ask for abstract common traits when the references vary a lot'
  );
  assert.match(
    arkServiceSource,
    /例如统一时可写到字体类别、常见字重、字号区间、气质倾向/,
    'reference analysis should guide detailed output for highly consistent references'
  );
  assert.match(
    arkServiceSource,
    /例如差异较大时可写成现代无衬线、字重大、字号偏大、爆点醒目这类抽象共性/,
    'reference analysis should guide abstract output for varied references'
  );
  assert.match(
    arkServiceSource,
    /三个模块的策划输出内容需要参考以上的设计风格进行制作并输出结果/,
    'planning should explicitly treat the analysis result as the direct design reference'
  );
  assert.match(
    arkServiceSource,
    /【参考分析结论】/,
    'planning prompts should consume the structured reference analysis result'
  );
});

test('marketing prompts identify brand logo assets and forbid competitor logos from leaking into results', () => {
  assert.match(
    arkServiceSource,
    /品牌logo图：\$\{logoUrl\}。该图仅用于识别和还原我方品牌logo，不得把产品素材图或设计参考图中的其他品牌logo带入最终画面/,
    'marketing prompts should identify the brand logo asset and ban competitor logos'
  );
  assert.match(
    arkServiceSource,
    /\[品牌logo图\]/,
    'marketing inputs should label the logo asset explicitly'
  );
  assert.match(
    arkServiceSource,
    /若产品素材中出现竞品logo或他牌标识，最终生成图必须去除或替换为品牌logo图对应的我方logo/,
    'marketing prompts should explicitly override competitor logos in source images'
  );
});

test('sku planning prompt includes an explicit visual style field', () => {
  assert.match(
    arkServiceSource,
    /- 画面风格：xxx/,
    'sku planning should output an explicit visual style line'
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

test('sku generation keeps style references out of direct image inputs while still assembling the full asset set', () => {
  assert.match(
    skuSubModuleSource,
    /const\s+\{\s*generationImageUrls\s*\}\s*=\s*buildSkuGenerationAssets\(/,
    'sku generation should derive a dedicated generation input list'
  );
  assert.match(
    skuSubModuleSource,
    /processWithKieAi\(\s*generationImageUrls,\s*apiConfig,/,
    'sku generation should pass only product and gift images into kie'
  );
  assert.doesNotMatch(
    skuSubModuleSource,
    /processWithKieAi\(\s*imageUrls,\s*apiConfig,/,
    'sku generation should not pass style reference images into kie as direct inputs'
  );
});

test('original retouch analysis must preserve the original scene instead of repainting a new composition', () => {
  assert.match(
    arkServiceSource,
    /【目标：原图精修模式】/,
    'retouch analysis should keep a dedicated original-image retouch mode'
  );
  assert.match(
    arkServiceSource,
    /必须以原图现有画面为基础做精修优化，不得脱离原图重新设计一张新画面/,
    'original retouch mode should explicitly forbid repainting a disconnected new scene'
  );
  assert.match(
    arkServiceSource,
    /禁止随意替换原图的主体、场景、拍摄角度、构图关系和主要陈列方式/,
    'original retouch mode should preserve the original subject and composition'
  );
  assert.match(
    arkServiceSource,
    /若无明确要求，不得新增不存在的背景、道具、装饰元素或额外产品/,
    'original retouch mode should not hallucinate extra props or backgrounds'
  );
});

test('retouch generation prompt keeps original-mode outputs tied to the uploaded source image', () => {
  assert.match(
    retouchModuleSource,
    /mode === 'original'/,
    'retouch module should branch original-mode strict rules explicitly'
  );
  assert.match(
    retouchModuleSource,
    /原图精修必须严格基于待精修图当前画面做优化/,
    'retouch generation should restate that original mode is an optimization pass over the uploaded source'
  );
  assert.match(
    retouchModuleSource,
    /禁止把原图精修做成重新换背景、换场景、换产品摆法、换镜头角度的大幅重绘/,
    'retouch generation should forbid large repaint-style deviations in original mode'
  );
});
