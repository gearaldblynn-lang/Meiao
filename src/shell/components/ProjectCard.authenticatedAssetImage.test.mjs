import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = () => readFileSync(new URL('./ProjectCard.tsx', import.meta.url), 'utf8');
const planEditorSource = () => readFileSync(new URL('./PlanEditor.tsx', import.meta.url), 'utf8');

test('ProjectCard loads generated managed images through the authenticated image boundary', () => {
  const projectCardSource = source();

  assert.match(
    projectCardSource,
    /import AuthenticatedAssetImage from '\.\.\/\.\.\/components\/AuthenticatedAssetImage'/,
  );
  assert.match(
    projectCardSource,
    /return <AuthenticatedAssetImage src=\{result\.imageUrl\} alt=\{result\.prompt\}/,
  );
  assert.match(
    projectCardSource,
    /<AuthenticatedAssetImage src=\{selectedVersion\.imageUrl\} alt="生成结果"/,
  );
  assert.match(
    projectCardSource,
    /<AuthenticatedAssetImage src=\{result\.imageUrl\} alt="生成结果"/,
  );
  assert.match(
    projectCardSource,
    /<AuthenticatedAssetImage src=\{selectedResult\.imageUrl\} alt="生成结果"/,
  );
  assert.doesNotMatch(projectCardSource, /<img src=\{(?:selectedVersion|selectedResult|result)\.imageUrl\}/);
});

test('PlanEditor uses the same authenticated image boundary for hydrated plan results', () => {
  const editorSource = planEditorSource();

  assert.match(
    editorSource,
    /import AuthenticatedAssetImage from '\.\.\/\.\.\/components\/AuthenticatedAssetImage'/,
  );
  assert.match(
    editorSource,
    /<AuthenticatedAssetImage src=\{result\.imageUrl\} alt=\{result\.prompt\}/,
  );
  assert.doesNotMatch(editorSource, /<img src=\{result\.imageUrl\}/);
});
