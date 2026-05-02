import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const arkServiceSource = readFileSync(new URL('./arkService.ts', import.meta.url), 'utf8');
const skuSubModuleSource = readFileSync(new URL('../modules/OneClick/SkuSubModule.tsx', import.meta.url), 'utf8');
const promptUtilsSource = readFileSync(new URL('../modules/OneClick/generationPromptUtils.ts', import.meta.url), 'utf8');
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

test('marketing scheme prompt uses RTCFE structure and the new copy layout format', () => {
  assert.match(
    arkServiceSource,
    /R Role 角色/,
    'marketing planning prompt should declare the RTCFE role section'
  );
  assert.match(
    arkServiceSource,
    /T Task 任务/,
    'marketing planning prompt should declare the RTCFE task section'
  );
  assert.match(
    arkServiceSource,
    /C Constraint 约束/,
    'marketing planning prompt should declare the RTCFE constraint section'
  );
  assert.match(
    arkServiceSource,
    /F Format 格式/,
    'marketing planning prompt should declare the RTCFE format section'
  );
  assert.match(
    arkServiceSource,
    /E Example 示例/,
    'marketing planning prompt should declare the RTCFE example section'
  );
  assert.match(
    arkServiceSource,
    /主标题（字体，字号字重，位置，颜色色值）：“xxx”/,
    'marketing prompt should define the new main-title copy row format'
  );
  assert.match(
    arkServiceSource,
    /其他内容（字体，字号字重，位置，颜色色值）：“xxx”/,
    'marketing prompt should define the new generic copy row format'
  );
  assert.match(
    arkServiceSource,
    /主标题（宋体，28pt Bold，画面顶部居中，#3d3d3d）：“全屋持久留香”/,
    'marketing prompt should embed the canonical copy layout example'
  );
  assert.match(
    arkServiceSource,
    /圆括号内必须依次填写字体、字号字重、位置、颜色色值/,
    'marketing prompt should explain the exact meaning of the parenthesized requirements'
  );
  assert.match(
    arkServiceSource,
    /字段名、冒号、说明文字、示例标签都不得出现在最终画面中/,
    'marketing prompt should forbid rendering labels or explanatory text into the final image'
  );
  assert.match(
    arkServiceSource,
    /不得输出旧格式或自由格式/,
    'marketing prompt should explicitly ban legacy and freeform copy layouts'
  );
  assert.match(
    arkServiceSource,
    /文案内容排版必须严格按输出规范和示例输出/,
    'marketing prompt should force the returned copy layout to follow the exact format and example'
  );
  assert.match(
    arkServiceSource,
    /首图模式下只允许输出 1 个首图方案；即使你想到多个方向，也只能保留当前最优方案输出/,
    'first-image planning should explicitly forbid expanding into a full multi-image set'
  );
  assert.match(
    arkServiceSource,
    /你是顶级电商视觉总监，负责为【\$\{platform\}】输出高转化的\$\{planningSeriesLabel\}。/,
    'marketing planning should distinguish first-image planning from full main-image planning'
  );
  assert.match(
    arkServiceSource,
    /isFirstImage \? '\[如：首图-核心视觉\]' : '\[如：主图1-核心卖点展示\]'/,
    'first-image planning should use a dedicated first-image screen label in the output format'
  );
});

test('first image replication planning analyzes product selling points against each uploaded reference and outputs one scheme per reference', () => {
  const firstImageReplicationBlockMatch = arkServiceSource.match(
    /export const generateFirstImageReplicationSchemes = async[\s\S]*?return \{ status: hasSuccess \? 'success' : 'error', schemes, perReferenceResults, message \};/,
  );
  const firstImageReplicationBlock = firstImageReplicationBlockMatch?.[0] || '';

  assert.match(
    arkServiceSource,
    /export const generateFirstImageReplicationSchemes = async/,
    'first image should use a dedicated replication-planning function'
  );
  assert.match(
    firstImageReplicationBlock,
    /复刻主图参考（图片URL）：\$\{referenceUrl\}/,
    'replication planning should explicitly label each uploaded reference url'
  );
  assert.match(
    firstImageReplicationBlock,
    /【图片角色】/,
    'replication planning should group image-role instructions clearly'
  );
  assert.match(
    firstImageReplicationBlock,
    /【策划优先级】/,
    'replication planning should group priority instructions clearly'
  );
  assert.match(
    firstImageReplicationBlock,
    /复刻主图参考图是唯一版式、风格、信息层级参考/,
    'replication planning should tell the planner which image is the reference'
  );
  assert.match(
    firstImageReplicationBlock,
    /先逐项识别参考图真实画面中的主色、背景、顶部区域、标题区、卖点区、商品区、底部区域/,
    'replication planning should force factual reference layout extraction before rewriting copy and products'
  );
  assert.match(
    firstImageReplicationBlock,
    /不得根据产品类目或卖点自行新增参考图中不存在的横幅、卡片、角标、促销条、排名牌或颜色体系/,
    'replication planning should forbid hallucinating unrelated layout modules or color systems'
  );
  assert.match(
    firstImageReplicationBlock,
    /count: validReferenceUrls\.length/,
    'replication workflow should be driven by uploaded reference-image count rather than manual count input'
  );
  assert.match(
    firstImageReplicationBlock,
    /const settledResults = await Promise\.allSettled\(validReferenceUrls\.map/,
    'first-image replication planning should isolate each reference task instead of failing the whole batch on one rejection'
  );
  assert.match(
    firstImageReplicationBlock,
    /perReferenceResults/,
    'first-image replication planning should return per-reference results for partial success handling'
  );
  assert.match(
    firstImageReplicationBlock,
    /status: hasSuccess \? 'success' : 'error'/,
    'first-image replication planning should allow partial success when at least one reference succeeds'
  );
  assert.match(
    firstImageReplicationBlock,
    /必须去除参考图中的所有 logo、品牌名、店铺名、平台标识和原文案/,
    'replication planning should explicitly remove all reference-logo, brand, platform, and original-copy traces'
  );
  assert.match(
    firstImageReplicationBlock,
    /商品替换必须严格基于上传商品素材/,
    'replication planning should keep all product substitution grounded in uploaded product assets'
  );
  assert.match(
    firstImageReplicationBlock,
    /商品替换必须严格基于上传商品素材，禁止虚构不存在的商品形态、结构、包装、配件或展示角度/,
    'first-image replication planning should explicitly ban inventing nonexistent product forms, accessories, or display angles and require product consistency'
  );
  assert.match(
    firstImageReplicationBlock,
    /- 设计意图：xxx（完全基于参考图内容修改调整，保持参考图视觉效果、版式设计；若出图比例与参考图不一致，需要将参考图自适应调整为要求比例）/,
    'first-image replication planning should lock the design-intent field to direct reference editing'
  );
  assert.match(
    firstImageReplicationBlock,
    /文案替换时必须逐一对照参考图原有每个文案位的内容长度与信息密度，替换后的文案字数必须尽量接近原位字数承载能力/,
    'first-image replication planning should enforce per-slot copy replacement against the original reference copy length'
  );
  assert.match(
    firstImageReplicationBlock,
    /必要时做等义压缩和短句化处理/,
    'first-image replication planning should allow concise optimization of copy to fit the replicated layout'
  );
  assert.match(
    firstImageReplicationBlock,
    /禁止某一文案位明显超字数/,
    'first-image replication planning should explicitly ban oversized copy that would hurt layout quality'
  );
  assert.match(
    firstImageReplicationBlock,
    /去除后原位置不得留空，必须优先替换为我方品牌 logo、店铺名或与版式匹配的通用信息/,
    'first-image replication planning should refill removed-brand areas with our logo, store name, or generic fallback text without inventing unrelated content'
  );
  assert.match(
    firstImageReplicationBlock,
    /不得凭空编造新品牌logo，也不得把素材图logo直接提取成我方独立品牌元素/,
    'first-image replication planning should forbid using source or reference logos as our brand identity when no logo asset is uploaded'
  );
  assert.match(
    firstImageReplicationBlock,
    /去除后原位置不得留空，必须优先替换为我方品牌 logo、店铺名或与版式匹配的通用信息/,
    'first-image replication planning should refill removed brand areas with our logo, store name, or generic fallback text'
  );
  assert.match(
    firstImageReplicationBlock,
    /产品与包装展示以素材图实际内容为准，画面描述只写商品或配件内容及摆放关系，不细写包装细节形态/,
    'first-image replication planning should keep packaging driven by source assets and avoid over-describing packaging details in the scene description'
  );
  assert.match(
    firstImageReplicationBlock,
    /设计意图只写“完全基于参考图内容修改调整，保持参考图视觉效果、版式设计；若出图比例与参考图不一致，则自适应调整为要求比例”/,
    'first-image replication planning should keep design intent concise and locked to reference-edit scope'
  );
  assert.match(
    firstImageReplicationBlock,
    /- 画面描述：xxx（只写文案更改与字数适配、logo等去除后的调整、商品适应替换、摆放内容与关系、配色保持参考图基准或根据商品自适应；不要细写包装细节形态；文案替换必须体现与原文案位近似字数；若为商品自适应，必须写明商品更适合的配色判断，以及参考图配色如何随之调整）/,
    'first-image replication planning should narrow the scene-description field to direct reference-edit actions'
  );
  assert.match(
    firstImageReplicationBlock,
    /必须先判断上传商品本身更适合的配色方向，并以商品属性配色方案为主，对参考图原有配色做适配性修改；配色调整后的主色、辅助色、背景色或材质色变化必须明确写进画面描述/,
    'first-image replication planning should require explicit product-driven color judgment in adaptive color mode'
  );
  assert.doesNotMatch(
    firstImageReplicationBlock,
    /首图裂变1-复刻主图参考1[\s\S]*文案内容排版/,
    'first-image replication planning should no longer output a copy-layout block'
  );
  assert.doesNotMatch(
    firstImageReplicationBlock,
    /- 卖点映射：按“参考图主信息位 -> 我方主卖点；参考图次信息位 -> 我方次卖点；参考图辅助信息位 -> 我方补充信息”的形式直接写清楚/,
    'first-image replication planning should no longer output a separate selling-point mapping field'
  );
  assert.match(
    firstImageReplicationBlock,
    /const settledResults = await Promise\.allSettled\(validReferenceUrls\.map\(async \(referenceUrl, index\) =>/,
    'first-image replication planning should analyze multiple references in parallel instead of serially waiting one-by-one'
  );
  assert.doesNotMatch(
    firstImageReplicationBlock,
    /const schemes: string\[\] = \[\];[\s\S]*for \(let index = 0; index < validReferenceUrls\.length; index \+= 1\)/,
    'first-image replication planning should no longer use a serial for-loop over references'
  );
});

test('sku planning prompt uses RTCFE structure and the new copy layout format', () => {
  assert.match(
    arkServiceSource,
    /R Role 角色[\s\S]*SKU 组合展示图策划视觉总监/,
    'sku planning prompt should declare the RTCFE role section'
  );
  assert.match(
    arkServiceSource,
    /F Format 格式[\s\S]*主标题（字体，字号字重，位置，颜色色值）：“xxx”/,
    'sku planning prompt should encode the new copy layout format in its format section'
  );
  assert.match(
    arkServiceSource,
    /点缀（潇洒手写体，16pt Medium，右上角,?#ff6600.*）：“love potion”/,
    'sku planning prompt should carry the canonical copy layout example'
  );
  assert.match(
    arkServiceSource,
    /文案内容排版必须严格按输出规范和示例输出/,
    'sku planning prompt should require the returned copy layout to follow the exact format and example'
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

test('sku reference images are direct style inputs instead of reference-analysis summaries', () => {
  assert.doesNotMatch(
    skuSubModuleSource,
    /analyzeOneClickReferenceSet/,
    'sku flow should not analyze uploaded reference images before planning'
  );
  assert.doesNotMatch(
    skuSubModuleSource,
    /referenceAnalysis\.summary/,
    'sku flow should not depend on a stored reference-analysis summary'
  );
  assert.match(
    skuSubModuleSource,
    /generateSkuSchemes\(productUrls,\s*giftUrls,\s*styleUrl,\s*config,\s*apiConfig,\s*globalAbortRef\.current\.signal\)/,
    'sku planning should pass the uploaded style reference image directly to scheme planning'
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
    /appendOneClickCopyGuardrails\(prompt, config\.language \|\| '中文'\)/,
    'sku generation prompt should explicitly require generated text to use the target copy language'
  );
  assert.match(
    promptUtilsSource,
    /画面文案语言：\$\{targetLanguage\}，逐字渲染当前方案中的文案内容，禁止翻译或替换语言/,
    'sku generation prompt should keep the non-target-language ban in the shared copy guardrail layer'
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
    /SKU风格基准图（图片URL）/,
    'follow-up sku generations should treat the first generated image as the style baseline'
  );
  assert.match(
    skuSubModuleSource,
    /后续 SKU 必须按这张图一致的排版、字体风格、文字摆放、色调和整体设计风格制作/,
    'follow-up sku generations should strongly enforce matching layout and design style'
  );
});

test('sku generation sends the selected style reference or first generated sku as a direct image input', () => {
  assert.match(
    skuSubModuleSource,
    /const\s+\{\s*generationImageUrls\s*\}\s*=\s*buildSkuGenerationAssets\(/,
    'sku generation should derive a dedicated generation input list'
  );
  assert.match(
    skuSubModuleSource,
    /processWithKieAi\(\s*generationImageUrls,\s*apiConfig,/,
    'sku generation should pass the dedicated generation image list into kie'
  );
  assert.doesNotMatch(
    skuSubModuleSource,
    /processWithKieAi\(\s*imageUrls,\s*apiConfig,/,
    'sku generation should not bypass the dedicated generation image list'
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
