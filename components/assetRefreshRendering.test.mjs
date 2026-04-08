import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const buyerShowSidebar = readFileSync(new URL('../modules/BuyerShow/BuyerShowSidebar.tsx', import.meta.url), 'utf8');
const retouchSidebar = readFileSync(new URL('../modules/Retouch/RetouchSidebar.tsx', import.meta.url), 'utf8');
const appStateSource = readFileSync(new URL('../utils/appState.ts', import.meta.url), 'utf8');
const oneClickConfigSidebar = readFileSync(new URL('../modules/OneClick/ConfigSidebar.tsx', import.meta.url), 'utf8');

test('buyer show sidebar keeps product preview visible after refresh from uploaded urls', () => {
  assert.match(buyerShowSidebar, /\{\s*\(productImages\.length > 0 \|\| uploadedProductUrls\.length > 0\) && \(/);
  assert.match(buyerShowSidebar, /\(productImages\.length > 0 \? productImages : uploadedProductUrls\)/);
});

test('retouch sidebar keeps pending preview visible after refresh from remote task assets', () => {
  assert.match(retouchSidebar, /uploaded source preview/i);
  assert.match(retouchSidebar, /task\.sourceUrl/);
});

test('persisted app state normalization keeps remote asset urls for refresh recovery', () => {
  assert.match(appStateSource, /uploadedProductUrls: normalizeStringArray\(saved\.oneClickMemory\.mainImage\?\.uploadedProductUrls\)/);
  assert.match(appStateSource, /lastStyleUrl: typeof saved\.oneClickMemory\.mainImage\?\.lastStyleUrl === 'string'/);
  assert.match(appStateSource, /uploadedProductUrls: normalizeStringArray\(saved\.oneClickMemory\.detailPage\?\.uploadedProductUrls\)/);
  assert.match(appStateSource, /lastStyleUrl: typeof saved\.oneClickMemory\.detailPage\?\.lastStyleUrl === 'string'/);
  assert.match(appStateSource, /uploadedProductUrls: normalizeStringArray\(saved\.buyerShowMemory\.uploadedProductUrls\)/);
  assert.match(appStateSource, /uploadedReferenceUrl: typeof saved\.buyerShowMemory\.uploadedReferenceUrl === 'string'/);
  assert.match(appStateSource, /uploadedProductUrls: normalizeStringArray\(saved\.videoMemory\.storyboard\.config\?\.uploadedProductUrls\)/);
});

test('one click config sidebar keeps product asset count and start availability after refresh from uploaded urls', () => {
  assert.match(oneClickConfigSidebar, /hasAvailableAssetSources\(productImages, uploadedProductUrls\)/);
  assert.match(oneClickConfigSidebar, /产品素材 \(\{productImages\.length \|\| uploadedProductUrls\.length\}\)/);
});
