import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./SubtitleRemovalWorkspace.tsx', import.meta.url), 'utf8');
const reminderSource = readFileSync(new URL('./SubtitleRegionReminderDialog.tsx', import.meta.url), 'utf8');
const projectListSource = readFileSync(new URL('./ProjectListView.tsx', import.meta.url), 'utf8');
const videoModuleSource = readFileSync(new URL('../modules/Video/VideoModule.tsx', import.meta.url), 'utf8');
const shellSource = readFileSync(new URL('../../ShellMigratedApp.tsx', import.meta.url), 'utf8');

test('workspace accepts videos and starts the subtitle media profile immediately', () => {
  assert.match(source, /accept="video\/\*"/);
  assert.match(source, /multiple/);
  assert.match(source, /file\.type\.startsWith\('video\/'\)/);
  assert.match(source, /createMediaTranscodeSession\(\{/);
  assert.match(source, /kind: 'video'/);
  assert.match(source, /profile: 'subtitle_removal'/);
  assert.match(source, /onUploadProgress/);
  assert.match(source, /progress\.ratio/);
});

test('workspace converts the full authoritative source duration and explains the path', () => {
  assert.match(source, /startSeconds: 0/);
  assert.match(source, /endSeconds: probe\.durationSeconds/);
  assert.match(source, /probe\.durationSeconds > 600/);
  assert.match(source, /单个视频最长 600 秒，不受短视频生成 15 秒限制/);
  assert.match(source, /result\.transcoded/);
  assert.match(source, /原视频已是兼容格式/);
  assert.match(source, /正在保留原画幅转换为 H\.264 MP4/);
});

test('workspace gives every queued video its own default region and cancellable session', () => {
  assert.match(source, /DEFAULT_SUBTITLE_REGION/);
  assert.match(source, /regionMode: 'default'/);
  assert.match(source, /clientItemId/);
  assert.match(source, /AbortController/);
  assert.match(source, /cancelMediaTranscodeSession/);
  assert.match(source, /return \(\) => \{/);
  assert.match(source, /sessionIdsRef\.current/);
});

test('workspace renders a list-first batch flow and separate region editor', () => {
  assert.match(source, /去字幕批量任务/);
  assert.match(source, /批量任务/);
  assert.match(source, /默认区域/);
  assert.match(source, /已调整/);
  assert.match(source, /调整区域/);
  assert.match(source, /SubtitleRemovalRegionDialog/);
  assert.doesNotMatch(source, /event\.target\.files\?\.\[0\]/);
});

test('workspace synchronously blocks duplicate batch submission', () => {
  assert.match(source, /submitLockRef\.current/);
  assert.match(source, /submitLockRef\.current = true/);
  assert.match(source, /批量开始去字幕/);
  assert.match(source, /本次将创建/);
  assert.match(source, /await onSubmit/);
  assert.match(source, /await onSubmit\(submitInputs\)/);
  assert.match(source, /outcomes/);
  assert.doesNotMatch(source, /mapWithSubtitleConcurrency\(\s*submitItems/);
  assert.match(source, /submitLockRef\.current = false/);
});

test('workspace only submits selected ready sources with valid pixel regions', () => {
  assert.match(source, /subtitleRegionToPixels/);
  assert.match(source, /readySelectedCount/);
  assert.match(source, /item\.selected/);
  assert.match(source, /item\.phase === 'ready'/);
  assert.match(source, /批量开始去字幕/);
});

test('workspace supports drag and drop and enforces the published batch limit', () => {
  assert.match(source, /onDragOver/);
  assert.match(source, /onDrop/);
  assert.match(source, /batchMaxItems/);
  assert.match(source, /一次最多上传/);
});

test('workspace reminds users to confirm the subtitle region after a new upload group is ready', () => {
  assert.match(source, /regionReminderCandidateIdsRef/);
  assert.match(source, /resolveSubtitleRegionReminder/);
  assert.match(source, /SubtitleRegionReminderDialog/);
  assert.match(reminderSource, /请确认去字幕区域/);
  assert.match(reminderSource, /使用默认区域/);
  assert.match(reminderSource, /去调整区域/);
  assert.match(source, /setEditingItemId\(regionReminderItemId\)/);
});

test('video module keeps the batch workspace mounted while users inspect result tabs', () => {
  assert.match(videoModuleSource, /hidden=\{activeSubFeature !== 'subtitle_removal'\}/);
  assert.match(videoModuleSource, /subtitleRemovalBatchLimits/);
  assert.doesNotMatch(videoModuleSource, /activeSubFeature === 'subtitle_removal' \? \(\s*<SubtitleRemovalWorkspace/);
});

test('subtitle removal keeps project results above the batch upload workspace', () => {
  assert.match(videoModuleSource, /afterProjects=\{subtitleRemovalWorkspace\}/);
  assert.doesNotMatch(videoModuleSource, /beforeProjects=\{subtitleRemovalWorkspace\}/);
  assert.match(projectListSource, /afterProjects\?: React\.ReactNode/);

  const projectsIndex = projectListSource.indexOf('{orderedProjects.length > 0 ?');
  const uploaderIndex = projectListSource.indexOf('{afterProjects}');
  assert.ok(projectsIndex >= 0, 'project result grid should exist');
  assert.ok(uploaderIndex > projectsIndex, 'batch upload workspace should render after project results');
});

test('subtitle removal mounts its composer in the shared shell bottom slot', () => {
  assert.match(shellSource, /id="subtitle-removal-composer-slot"/);
  assert.match(videoModuleSource, /active=\{activeSubFeature === 'subtitle_removal'\}/);
  assert.match(videoModuleSource, /composerSlotId="subtitle-removal-composer-slot"/);
  assert.match(source, /createPortal/);
  assert.match(source, /document\.getElementById\(composerSlotId\)/);
  assert.match(source, /className="px-6 pt-4 pb-5"/);
  assert.match(source, /max-w-\[896px\]/);
  assert.doesNotMatch(projectListSource, /afterProjectsAtBottom/);
  assert.doesNotMatch(source, /pb-10/);
});

test('subtitle removal uses the shared bottom-composer visual language', () => {
  assert.match(source, /aria-label="去字幕任务输入区"/);
  assert.match(source, /rounded-3xl border transition-all/);
  assert.match(source, /background: 'var\(--bg-surface\)'/);
  assert.match(source, /background: 'var\(--accent\)'/);
  assert.doesNotMatch(source, /border-dashed/);
  assert.doesNotMatch(source, /sticky bottom-4/);
});
