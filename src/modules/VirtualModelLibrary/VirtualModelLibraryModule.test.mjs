import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const source = () => readFileSync(join(root, 'src/modules/VirtualModelLibrary/VirtualModelLibraryModule.tsx'), 'utf8');

const extractBraceBlock = (content, openingBrace) => {
  assert.equal(content[openingBrace], '{', 'expected an opening brace');
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = openingBrace; index < content.length; index += 1) {
    const character = content[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') { quote = character; continue; }
    if (character === '{') depth += 1;
    if (character === '}' && --depth === 0) return content.slice(openingBrace, index + 1);
  }
  assert.fail('unterminated brace block');
};

const extractElementContaining = (content, tag, marker) => {
  const markerIndex = content.indexOf(marker);
  assert.notEqual(markerIndex, -1, `missing element marker: ${marker}`);
  const openingTags = [...content.slice(0, markerIndex + marker.length).matchAll(new RegExp(`<${tag}(?=[\\s>])`, 'g'))];
  const start = openingTags.at(-1)?.index ?? -1;
  const end = content.indexOf(`</${tag}>`, markerIndex);
  assert.notEqual(start, -1, `missing <${tag}> for marker: ${marker}`);
  assert.notEqual(end, -1, `missing </${tag}> for marker: ${marker}`);
  return content.slice(start, end + tag.length + 3);
};

test('virtual model library uses the admin lifecycle and exactly eight fixed image slots', () => {
  const content = source();
  assert.match(content, /<DialogContent\b/);
  assert.doesNotMatch(content, /window\.prompt\(/);
  assert.match(content, /const ASSET_SLOTS = \[/);
  assert.match(content, /\['profile_close', '左侧面近景'\]/);
  assert.match(content, /\['three_quarter_half', '右侧面近景'\]/);
  assert.match(content, /\['three_quarter_full', '四分之三全身'\]/);
  assert.doesNotMatch(content, /三分之四/);
  assert.match(content, /return <><div className="mx-auto flex h-full max-w-\[1500px\] gap-5 p-5" style=\{\{ color: 'var\(--text-primary\)' \}\}>/);
  assert.match(content, /front|left|right|back|half_left|half_right|full_body|close_up/);
  assert.match(content, /ASSET_SLOTS\.map/);
  assert.match(content, /uploadInternalAssetStream/);
  assert.match(content, /module: 'virtual_model'/);
  assert.match(content, /createVirtualModel/);
  assert.match(content, /createVirtualModelVersion/);
  assert.match(content, /replaceVirtualModelVersionAssets/);
  assert.match(content, /updateVirtualModel/);
  assert.match(content, /身份特征描述/);
  assert.match(content, /const identityProfile = \{ \.\.\.\(selected\.version\?\.identityProfile \|\| \{\}\), description: editorProfile\.trim\(\) \}/);
  assert.doesNotMatch(content, /JSON\.parse\(editorProfile\)/);
  assert.match(content, /publishVirtualModel/);
  assert.match(content, /unpublishVirtualModel/);
});

test('virtual model library list contains only the operational fields in scope', () => {
  const content = source();
  assert.match(content, /updatedAt/);
  assert.match(content, /素材完整度/);
  assert.doesNotMatch(content, /创建人/);
  assert.doesNotMatch(content, /LoRA/);
  assert.doesNotMatch(content, /质量检测/);
});

test('published models stay immutable and the UI directs changes to a new model instead of a new version', () => {
  const content = source();
  assert.match(content, /const managementStatus = \(model: AdminVirtualModel\) => model\.version\?\.status === 'draft' \? 'draft' : model\.status/);
  assert.match(content, /managementStatus\(model\) === 'published'/);
  assert.doesNotMatch(content, /const createNextVersion = async \(\) =>/);
  assert.doesNotMatch(content, />新建版本<\/button>/);
  assert.match(content, /已发布模特的固定参考素材不可修改，请在左侧新建模特/);
  assert.match(content, /已发布模特的身份特征不可修改，请在左侧新建模特/);
  assert.match(content, /if \(profileChanged && managementStatus\(selected\) !== 'draft'\)/);
  assert.match(content, /if \(managementStatus\(selected\) !== 'draft'\) \{ setNotice\('已发布模特的固定参考素材不可修改，请在左侧新建模特'\); return; \}/);
  assert.match(content, /updateVirtualModelVersion/);
  assert.match(content, /else if \(editorProfile\.trim\(\)\) await createVirtualModelVersion/);
  assert.match(content, /disabled=\{pending \|\| \(selected \? managementStatus\(selected\) !== 'draft' : true\)\}/);
  assert.match(content, /selected\.version\?\.status === 'draft'[\s\S]*publishVirtualModel/);
});

test('virtual model library has one left-side creation entry and resumes unfinished draft generation', () => {
  const content = source();
  assert.match(content, /import VirtualModelCreateDialog from '\.\/VirtualModelCreateDialog'/);
  assert.match(content, /import \{ shouldResumeVirtualModelBatch \} from '\.\/virtualModelGenerationState\.mjs'/);
  assert.match(content, /const \[createDialogOpen, setCreateDialogOpen\] = useState\(false\)/);
  assert.match(content, /const \[resumeBatch, setResumeBatch\] = useState<VirtualModelGenerationBatch \| null>\(null\)/);
  assert.match(content, /findVirtualModelGenerationBatch/);
  assert.match(content, /requestId !== selectionRequestRef\.current/);
  assert.match(content, /shouldResumeVirtualModelBatch\(result\.batch\)/);
  assert.match(content, /<VirtualModelCreateDialog/);
  assert.match(content, /resumeBatch=\{resumeBatch\}/);
  assert.match(content, /onManualCreated=\{handleManualDraftCreated\}/);
  assert.match(content, /onCompleted=\{handleGeneratedDraftCompleted\}/);
  assert.equal((content.match(/>新建<\/button>/g) || []).length, 1);
  assert.doesNotMatch(content, /新建版本/);
});

test('draft counts and filters use managementStatus instead of the parent model status', () => {
  const content = source();
  assert.match(content, /const managementStatus = \(model: AdminVirtualModel\) => model\.version\?\.status === 'draft' \? 'draft' : model\.status/);
  assert.match(content, /models\.filter\(\(model\) => managementStatus\(model\) === 'draft'\)/);
  assert.match(content, /models\.filter\(\(model\) => managementStatus\(model\) === 'published'\)/);
});

test('new model creation suggests the next numeric code from complete history', () => {
  const content = source();
  assert.match(content, /import \{ suggestNextVirtualModelCode \} from '\.\/virtualModelCodeSuggestion\.mjs'/);
  assert.match(content, /const \[suggestedModelCode, setSuggestedModelCode\] = useState\(''\)/);
  assert.match(content, /const result = await fetchAdminVirtualModels\('all'\)/);
  assert.match(content, /setSuggestedModelCode\(suggestNextVirtualModelCode\(result\.models\)\)/);
  assert.match(content, /initialModelCode=\{suggestedModelCode\}/);
});

test('saved draft materials support preview and individual download without unlocking published uploads', () => {
  const content = source();
  assert.match(content, /import \{[^}]*Download[^}]*Upload[^}]*\} from 'lucide-react'/);
  assert.match(content, /import \{ downloadRemoteFile \} from '\.\.\/\.\.\/utils\/imageUtils'/);
  assert.match(content, /const \[previewSlot, setPreviewSlot\] = useState\(''\)/);
  assert.match(content, /const sourceUrl = asset\.publicUrl \|\| asset\.url/);
  assert.match(content, /aria-label=\{`查看大图 \$\{label\}`\}/);
  assert.match(content, /aria-label=\{`下载 \$\{label\}`\}/);
  assert.match(content, /<Dialog open=\{Boolean\(previewAsset && previewUrl\)\}/);
  assert.match(content, /max-h-\[72vh\] w-full object-contain/);
  assert.match(content, /const assetEditingDisabled = pending \|\| deletePending \|\| managementStatus\(selected\) !== 'draft'/);
});

test('protected model materials render through the authenticated asset image component', () => {
  const content = source();
  assert.match(content, /import AuthenticatedAssetImage from '\.\.\/\.\.\/components\/AuthenticatedAssetImage'/);
  assert.match(content, /<AuthenticatedAssetImage src=\{assetUrl\} alt=\{label\}/);
  assert.match(content, /<AuthenticatedAssetImage src=\{previewUrl\} alt=\{previewEntry\[1\]\}/);
  assert.doesNotMatch(content, /<img src=\{assetUrl\}/);
  assert.doesNotMatch(content, /<img src=\{previewUrl\}/);
});

test('virtual model deletion requires an explicit guarded confirmation and preserves history wording', () => {
  const content = source();
  assert.match(content, /import \{[^}]*Trash2[^}]*\} from 'lucide-react'/);
  assert.match(content, /import \{[^}]*deleteVirtualModel[^}]*\} from '\.\.\/\.\.\/services\/internalApi'/);
  assert.match(content, /import \{ submitVirtualModelDelete \} from '\.\/virtualModelDeleteSubmission\.mjs'/);
  assert.doesNotMatch(content, /window\.confirm\(/);
  assert.match(content, /const \[deleteTarget, setDeleteTarget\] = useState<AdminVirtualModel \| null>\(null\)/);
  assert.match(content, /const \[deleteError, setDeleteError\] = useState\(''\)/);
  assert.match(content, /const \[deletePending, setDeletePending\] = useState\(false\)/);
  assert.match(content, /const deletePendingRef = useRef\(false\)/);
  assert.match(content, /setDeleteError\(''\); setDeleteTarget\(selected\)/);

  const declaration = 'const confirmDelete = async () => ';
  const declarationIndex = content.indexOf(declaration);
  assert.notEqual(declarationIndex, -1);
  const confirmDelete = extractBraceBlock(content, declarationIndex + declaration.length);
  assert.match(confirmDelete, /await submitVirtualModelDelete\(\{/);
  assert.match(confirmDelete, /target: deleteTarget/);
  assert.match(confirmDelete, /pendingRef: deletePendingRef/);
  assert.match(confirmDelete, /setPending: setDeletePending/);
  assert.match(confirmDelete, /deleteModel: deleteVirtualModel/);
  assert.match(confirmDelete, /close: \(\) => setDeleteTarget\(null\)/);
  assert.match(confirmDelete, /reload: load/);
  assert.doesNotMatch(confirmDelete, /setModels\(/);

  const trashButton = extractElementContaining(content, 'button', '<Trash2 size={14} />');
  assert.match(trashButton, /className="[^"]*\bh-8\b[^"]*\bw-8\b[^"]*"/);
  assert.match(trashButton, /disabled=\{pending \|\| deletePending\}/);
  assert.match(trashButton, /style=\{\{ borderColor: 'var\(--danger\)', color: 'var\(--danger\)' \}\}/);
  assert.match(trashButton, /title="删除模特"/);
  assert.match(trashButton, /aria-label="删除模特"/);
  assert.match(trashButton, /<Trash2 size=\{14\} \/>/);
  assert.doesNotMatch(trashButton, />\s*删除模特\s*</);

  const deleteDialog = extractElementContaining(content, 'Dialog', '删除后，该模特将从模特库移除');
  assert.match(deleteDialog, /open=\{deleteTarget !== null\}/);
  assert.match(deleteDialog, /showCloseButton=\{!deletePending\}/);
  assert.match(deleteDialog, /if \(!open && !deletePending\) \{ setDeleteTarget\(null\); setDeleteError\(''\); \}/);
  assert.match(deleteDialog, /onPointerDownOutside=\{\(event\) => \{ if \(deletePending\) event\.preventDefault\(\); \}\}/);
  assert.match(deleteDialog, /onEscapeKeyDown=\{\(event\) => \{ if \(deletePending\) event\.preventDefault\(\); \}\}/);
  assert.match(deleteDialog, /<DialogTitle>删除模特“\{deleteTarget\?\.name\}”？<\/DialogTitle>/);
  assert.match(deleteDialog, /删除后，该模特将从模特库移除，不能再用于新任务。历史任务和已上传素材仍会保留。此操作当前无法撤销。/);
  assert.match(deleteDialog, /deleteError && <p role="alert"/);

  const footer = extractElementContaining(deleteDialog, 'DialogFooter', '<DialogFooter>');
  const footerButtons = [...footer.matchAll(/<button\b[\s\S]*?<\/button>/g)].map((match) => match[0]);
  assert.equal(footerButtons.length, 2);
  const [cancelButton, confirmButton] = footerButtons;
  assert.match(cancelButton, /disabled=\{deletePending\}/);
  assert.match(cancelButton, />取消<\/button>/);
  assert.match(cancelButton, /setDeleteTarget\(null\); setDeleteError\(''\);/);
  assert.match(confirmButton, /disabled=\{deletePending\}/);
  assert.match(confirmButton, /onClick=\{\(\) => void confirmDelete\(\)\}/);
  assert.match(confirmButton, /style=\{\{ background: 'var\(--danger\)' \}\}/);
  assert.match(confirmButton, /\{deletePending \? '删除中\.\.\.' : '删除模特'\}/);

  assert.match(content, /<div className="mb-5 flex items-start justify-between gap-3"><div className="min-w-0 flex-1"><h2 className="truncate text-base font-semibold">/);
  assert.match(content, /<p className="truncate text-xs" style=\{\{ color: 'var\(--text-tertiary\)' \}\}>\{selected\.code\}/);
  assert.match(content, /<div className="flex shrink-0 gap-2"><button type="button" disabled=\{pending \|\| deletePending\}/);
  assert.match(content, /disabled=\{pending \|\| deletePending\} onClick=\{\(\) => void openNewGeneration\(\)\}/);
  assert.match(content, /key=\{value\} type="button" disabled=\{deletePending\} onClick=\{\(\) => setFilter\(value\)\}/);
  assert.match(content, /key=\{model\.id\} type="button" disabled=\{deletePending\} onClick=\{\(\) => void selectModel\(model\)\}/);
});
