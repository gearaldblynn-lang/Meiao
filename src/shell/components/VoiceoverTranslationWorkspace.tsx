import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  Languages,
  Loader2,
  Mic2,
  Replace,
  Upload,
  X,
} from 'lucide-react';

import type {
  SubtitleRemovalRegion,
  SubtitleRemovalSourceDraft,
  SystemPublicConfig,
} from '../../types';
import {
  type VoiceoverTranslationDraft,
  type VoiceoverTranslationMode,
  type VoiceoverTranslationSource,
  type VoiceoverVoiceMode,
} from '../../services/voiceoverTranslationClient';
import {
  cancelMediaTranscodeSession,
  convertMediaTranscodeSession,
  createMediaTranscodeSession,
} from '../../services/mediaTranscodeClient';
import {
  DEFAULT_SUBTITLE_REGION,
  subtitleRegionToPixels,
} from '../../utils/subtitleRemovalRegion.mjs';
import ConfirmDialog from './ConfirmDialog';
import SubtitleRegionEditor from './SubtitleRegionEditor';

export type VoiceoverTranslationWorkspaceProps = {
  active: boolean;
  composerSlotId: string;
  initialSource?: VoiceoverTranslationSource | null;
  publicConfig: SystemPublicConfig['voiceoverTranslation'];
  creationDisabledReason?: string;
  onSubmit: (draft: VoiceoverTranslationDraft) => Promise<void>;
  onClearInitialSource: () => void;
};

type PreparedSource = VoiceoverTranslationSource & {
  fileName: string;
  mimeType: string;
  durationSeconds: number;
  sizeBytes: number;
  width: number;
  height: number;
  videoCodec?: string | null;
  transcoded?: boolean;
  draftNonce: string;
};

const EMPTY_VOICEOVER_LANGUAGES: NonNullable<
  SystemPublicConfig['voiceoverTranslation']
>['languages'] = [];
const EMPTY_VOICEOVER_VOICES: NonNullable<
  SystemPublicConfig['voiceoverTranslation']
>['voices'] = [];

const createDraftNonce = () => `voiceover-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const formatDuration = (durationSeconds: number) => {
  const totalSeconds = Math.max(0, Math.round(Number(durationSeconds || 0)));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const isSupportedVideo = (file: File) => {
  const mimeType = String(file.type || '').toLowerCase();
  const fileName = String(file.name || '').toLowerCase();
  return mimeType === 'video/mp4'
    || mimeType === 'video/quicktime'
    || fileName.endsWith('.mp4')
    || fileName.endsWith('.mov');
};

const sourceIdentity = (source?: VoiceoverTranslationSource | null) => (
  String(source?.sourceAssetId || source?.sourceUrl || '').trim()
);

const fileNameFromSource = (sourceUrl: string) => {
  try {
    const pathname = new URL(sourceUrl, window.location.origin).pathname;
    return decodeURIComponent(pathname.split('/').filter(Boolean).at(-1) || 'source.mp4');
  } catch {
    return 'source.mp4';
  }
};

const VoiceoverTranslationWorkspace: React.FC<VoiceoverTranslationWorkspaceProps> = ({
  active,
  composerSlotId,
  initialSource = null,
  publicConfig,
  creationDisabledReason = '',
  onSubmit,
  onClearInitialSource,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef('');
  const consumedInitialSourceRef = useRef('');
  const submitLockRef = useRef(false);
  const mountedRef = useRef(true);

  const [composerTarget, setComposerTarget] = useState<HTMLElement | null>(null);
  const [source, setSource] = useState<PreparedSource | null>(null);
  const [pendingReplacementFile, setPendingReplacementFile] = useState<File | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [showMoreLanguages, setShowMoreLanguages] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState('');
  const [translationMode, setTranslationMode] = useState<VoiceoverTranslationMode>('natural');
  const [voiceMode, setVoiceMode] = useState<VoiceoverVoiceMode>('auto');
  const [voiceName, setVoiceName] = useState('');
  const [removeText, setRemoveText] = useState(false);
  const [subtitleRegion, setSubtitleRegion] = useState<SubtitleRemovalRegion>({
    ...DEFAULT_SUBTITLE_REGION,
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const languages = publicConfig ? publicConfig.languages : EMPTY_VOICEOVER_LANGUAGES;
  const commonLanguages = useMemo(
    () => languages.filter((language) => language.common),
    [languages],
  );
  const moreLanguages = useMemo(
    () => languages.filter((language) => !language.common),
    [languages],
  );
  const voices = publicConfig ? publicConfig.voices : EMPTY_VOICEOVER_VOICES;
  const featureAvailable = Boolean(publicConfig?.enabled && publicConfig?.ready);
  const canCreate = featureAvailable && !creationDisabledReason;
  const creationBlockMessage = creationDisabledReason || (
    featureAvailable
      ? ''
      : '口播翻译当前未就绪，暂时不能创建新任务；历史项目仍可查看和下载。'
  );

  useLayoutEffect(() => {
    const nextTarget = active && typeof document !== 'undefined'
      ? document.getElementById(composerSlotId)
      : null;
    setComposerTarget((current) => current === nextTarget ? current : nextTarget);
  }, [active, composerSlotId]);

  useEffect(() => {
    if (languages.some((language) => language.code === targetLanguage)) return;
    setTargetLanguage(commonLanguages[0]?.code || languages[0]?.code || '');
  }, [commonLanguages, languages, targetLanguage]);

  useEffect(() => {
    if (voices.some((voice) => voice.name === voiceName)) return;
    setVoiceName(voices[0]?.name || '');
  }, [voiceName, voices]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = '';
      if (sessionId) {
        void cancelMediaTranscodeSession({ sessionId }).catch(() => undefined);
      }
    };
  }, []);

  const prepareFile = useCallback(async (
    file: File,
    origin?: VoiceoverTranslationSource,
  ) => {
    if (!canCreate) {
      setErrorMessage(creationBlockMessage);
      return;
    }
    if (!isSupportedVideo(file)) {
      setErrorMessage('仅支持 MP4 或 MOV 视频');
      return;
    }
    controllerRef.current?.abort();
    const previousSessionId = sessionIdRef.current;
    if (previousSessionId) {
      void cancelMediaTranscodeSession({ sessionId: previousSessionId }).catch(() => undefined);
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    sessionIdRef.current = '';
    setPreparing(true);
    setUploadProgress(0);
    setErrorMessage('');
    let createdSessionId = '';
    let conversionCompleted = false;
    try {
      const probe = await createMediaTranscodeSession({
        file,
        kind: 'video',
        profile: 'voiceover_translation',
        signal: controller.signal,
        onUploadProgress: (progress) => {
          if (!mountedRef.current || controller.signal.aborted) return;
          setUploadProgress(Math.round(progress.ratio * 100));
        },
      });
      if (!probe.sessionId) throw new Error('服务端未返回媒体处理会话');
      createdSessionId = probe.sessionId;
      sessionIdRef.current = createdSessionId;
      if (probe.hasAudio !== true) throw new Error('视频没有可用音轨，无法进行口播翻译');
      const result = await convertMediaTranscodeSession({
        sessionId: createdSessionId,
        startSeconds: 0,
        endSeconds: probe.durationSeconds,
        module: 'video',
        signal: controller.signal,
      });
      if (!result.fileUrl || !result.assetId) {
        throw new Error('视频已处理，但未返回可用的托管素材身份');
      }
      const prepared: PreparedSource = {
        sourceAssetId: result.assetId,
        sourceUrl: result.fileUrl,
        sourceProjectId: origin?.sourceProjectId,
        sourceResultId: origin?.sourceResultId,
        fileName: result.fileName || file.name,
        mimeType: result.mimeType || 'video/mp4',
        durationSeconds: result.durationSeconds,
        sizeBytes: result.sizeBytes,
        width: Number(result.width || probe.width || 0),
        height: Number(result.height || probe.height || 0),
        videoCodec: result.videoCodec || probe.videoCodec,
        transcoded: result.transcoded,
        draftNonce: createDraftNonce(),
      };
      if (!prepared.durationSeconds || !prepared.width || !prepared.height) {
        throw new Error('无法读取处理后视频的权威时长或分辨率');
      }
      if (!mountedRef.current || controller.signal.aborted) return;
      conversionCompleted = true;
      if (sessionIdRef.current === createdSessionId) sessionIdRef.current = '';
      setSource(prepared);
      setUploadProgress(100);
      if (origin) onClearInitialSource();
    } catch (error) {
      if (!mountedRef.current || controller.signal.aborted) return;
      setErrorMessage(error instanceof Error ? error.message : '视频处理失败，请重试');
    } finally {
      if (
        createdSessionId
        && !conversionCompleted
        && sessionIdRef.current === createdSessionId
      ) {
        sessionIdRef.current = '';
        await cancelMediaTranscodeSession({ sessionId: createdSessionId }).catch(() => undefined);
      }
      if (controllerRef.current === controller) controllerRef.current = null;
      if (mountedRef.current) setPreparing(false);
    }
  }, [canCreate, creationBlockMessage, onClearInitialSource]);

  useEffect(() => {
    if (!canCreate) return undefined;
    const identity = sourceIdentity(initialSource);
    if (!identity || consumedInitialSourceRef.current === identity) return;
    consumedInitialSourceRef.current = identity;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(initialSource!.sourceUrl, {
          signal: controller.signal,
          credentials: 'same-origin',
        });
        if (!response.ok) throw new Error('无法读取带入的视频');
        const blob = await response.blob();
        const file = new File(
          [blob],
          fileNameFromSource(initialSource!.sourceUrl),
          { type: blob.type || 'video/mp4' },
        );
        await prepareFile(file, initialSource!);
      } catch (error) {
        if (!controller.signal.aborted) {
          setErrorMessage(error instanceof Error ? error.message : '带入视频处理失败');
        }
      }
    })();
    return () => controller.abort();
  }, [canCreate, initialSource, prepareFile]);

  const chooseFile = useCallback((file?: File | null) => {
    if (!file) return;
    if (!canCreate) {
      setErrorMessage(creationBlockMessage);
      return;
    }
    if (!isSupportedVideo(file)) {
      setErrorMessage('仅支持 MP4 或 MOV 视频');
      return;
    }
    if (source) {
      setPendingReplacementFile(file);
      return;
    }
    void prepareFile(file);
  }, [canCreate, creationBlockMessage, prepareFile, source]);

  const clearSource = useCallback(() => {
    controllerRef.current?.abort();
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = '';
    if (sessionId) {
      void cancelMediaTranscodeSession({ sessionId }).catch(() => undefined);
    }
    setSource(null);
    setErrorMessage('');
    setUploadProgress(0);
    onClearInitialSource();
  }, [onClearInitialSource]);

  const selectedLanguage = languages.find((language) => language.code === targetLanguage);
  const selectedVoice = voices.find((voice) => voice.name === voiceName);
  const editorSource: SubtitleRemovalSourceDraft | null = source ? {
    sourceUrl: source.sourceUrl,
    assetId: source.sourceAssetId,
    fileName: source.fileName,
    mimeType: source.mimeType,
    durationSeconds: source.durationSeconds,
    sizeBytes: source.sizeBytes,
    width: source.width,
    height: source.height,
    videoCodec: source.videoCodec,
    transcoded: source.transcoded,
    draftNonce: source.draftNonce,
    sourceProjectId: source.sourceProjectId,
    sourceResultId: source.sourceResultId,
  } : null;

  const buildDraft = useCallback((): VoiceoverTranslationDraft => {
    if (!source) throw new Error('请先选择一个视频');
    if (!targetLanguage) throw new Error('请选择目标语言');
    if (voiceMode === 'preset' && !voiceName) throw new Error('请选择预设音色');
    if (removeText) subtitleRegionToPixels(subtitleRegion, source.width, source.height);
    return {
      sourceAssetId: source.sourceAssetId,
      sourceUrl: source.sourceUrl,
      sourceProjectId: source.sourceProjectId,
      sourceResultId: source.sourceResultId,
      fileName: source.fileName,
      mimeType: source.mimeType,
      durationSeconds: source.durationSeconds,
      sizeBytes: source.sizeBytes,
      width: source.width,
      height: source.height,
      targetLanguage,
      translationMode,
      voiceMode,
      ...(voiceMode === 'preset' ? { voiceName } : {}),
      removeText,
      ...(removeText ? { subtitleRegionNormalized: subtitleRegion } : {}),
    };
  }, [
    removeText,
    source,
    subtitleRegion,
    targetLanguage,
    translationMode,
    voiceMode,
    voiceName,
  ]);

  const handleSubmit = useCallback(async () => {
    if (submitLockRef.current || !canCreate) return;
    submitLockRef.current = true;
    setSubmitting(true);
    setConfirmOpen(false);
    setErrorMessage('');
    try {
      const draft = buildDraft();
      await onSubmit(draft);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '口播翻译任务提交失败');
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  }, [buildDraft, canCreate, onSubmit]);

  const canOpenConfirmation = canCreate
    && Boolean(source)
    && Boolean(targetLanguage)
    && (voiceMode === 'auto' || Boolean(voiceName))
    && !preparing
    && !submitting;

  const confirmationMessage = source
    ? [
      `视频时长：${formatDuration(source.durationSeconds)}`,
      `目标语言：${selectedLanguage?.chineseName || targetLanguage}`,
      `翻译模式：${translationMode === 'natural' ? '自然口播' : '忠实直译'}`,
      `音色：${voiceMode === 'auto' ? '自动匹配（分析后确定）' : `${selectedVoice?.name || voiceName}（${selectedVoice?.trait || '预设音色'}）`}`,
      `Golden 去文案：${removeText ? '是' : '否'}`,
      '可能产生费用的阶段：Gemini 视频分析、KIE Gemini 3.1 Flash TTS'
        + (removeText ? '、Golden 去文案' : ''),
    ].join('；')
    : '';

  return (
    <section
      aria-label="口播翻译工作区"
      className="mx-auto w-full max-w-[1180px] px-5 py-6 sm:px-8 sm:py-8"
    >
      {creationBlockMessage ? (
        <div
          className="mb-5 rounded-3xl border px-5 py-4 text-[13px] leading-6"
          style={{
            background: 'var(--bg-surface)',
            borderColor: 'var(--border-subtle)',
            color: 'var(--text-secondary)',
          }}
        >
          {creationBlockMessage}
          {creationDisabledReason ? '；历史项目仍可查看和下载。' : ''}
        </div>
      ) : null}

      {source ? (
        <div
          className="rounded-[28px] border p-4 sm:p-5"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <video
              src={source.sourceUrl}
              controls
              preload="metadata"
              className="aspect-video w-full rounded-2xl bg-black object-contain sm:w-[320px]"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Check size={16} style={{ color: 'var(--success)' }} />
                <h3 className="truncate text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {source.fileName}
                </h3>
              </div>
              <p className="mt-2 text-[12px] leading-6" style={{ color: 'var(--text-secondary)' }}>
                权威时长 {formatDuration(source.durationSeconds)} · {source.width}×{source.height}
                {source.transcoded ? ' · 已转换为兼容的 H.264 MP4' : ' · 原视频格式已兼容'}
              </p>
              <button
                type="button"
                onClick={clearSource}
                className="mt-3 inline-flex items-center gap-1.5 rounded-2xl px-3 py-2 text-[12px]"
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
              >
                <X size={13} />
                清除视频
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div
          className="rounded-[28px] border px-5 py-10 text-center"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
        >
          <Languages className="mx-auto" size={28} style={{ color: 'var(--accent)' }} />
          <h3 className="mt-3 text-[16px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            把原视频口播转换为另一种语言
          </h3>
          <p className="mx-auto mt-2 max-w-[52ch] text-[13px] leading-6" style={{ color: 'var(--text-secondary)' }}>
            保留原画面、背景音乐、环境音和音效，不做嘴型重生成。
          </p>
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div
          className="rounded-[28px] border p-5"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
        >
          <h3 className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>目标语言</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {commonLanguages.map((language) => (
              <button
                type="button"
                key={language.code}
                onClick={() => setTargetLanguage(language.code)}
                className="rounded-2xl px-3 py-2 text-[12px] transition-colors"
                style={{
                  background: targetLanguage === language.code ? 'var(--accent)' : 'var(--bg-elevated)',
                  color: targetLanguage === language.code ? 'white' : 'var(--text-secondary)',
                }}
              >
                {language.chineseName}
              </button>
            ))}
          </div>
          {moreLanguages.length > 0 ? (
            <>
              <button
                type="button"
                onClick={() => setShowMoreLanguages((current) => !current)}
                className="mt-3 text-[12px] font-medium"
                style={{ color: 'var(--accent)' }}
              >
                {showMoreLanguages ? '收起更多语言' : '更多语言'}
              </button>
              {showMoreLanguages ? (
                <select
                  value={moreLanguages.some((language) => language.code === targetLanguage) ? targetLanguage : ''}
                  onChange={(event) => setTargetLanguage(event.target.value)}
                  className="mt-3 min-h-11 w-full rounded-2xl border px-3 text-[13px]"
                  style={{
                    background: 'var(--bg-elevated)',
                    borderColor: 'var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }}
                >
                  <option value="">选择更多语言</option>
                  {moreLanguages.map((language) => (
                    <option key={language.code} value={language.code}>
                      {language.chineseName} · {language.englishName}
                    </option>
                  ))}
                </select>
              ) : null}
            </>
          ) : null}

          <h3 className="mt-6 text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>翻译方式</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="rounded-2xl border p-3" style={{ borderColor: translationMode === 'natural' ? 'var(--accent)' : 'var(--border-subtle)' }}>
              <input
                type="radio"
                name="voiceover-translation-mode"
                value="natural"
                checked={translationMode === 'natural'}
                onChange={() => setTranslationMode('natural')}
              />
              <span className="ml-2 text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>自然口播</span>
              <p className="mt-1 text-[11px] leading-5" style={{ color: 'var(--text-tertiary)' }}>适配原时间和营销语气</p>
            </label>
            <label className="rounded-2xl border p-3" style={{ borderColor: translationMode === 'literal' ? 'var(--accent)' : 'var(--border-subtle)' }}>
              <input
                type="radio"
                name="voiceover-translation-mode"
                value="literal"
                checked={translationMode === 'literal'}
                onChange={() => setTranslationMode('literal')}
              />
              <span className="ml-2 text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>忠实直译</span>
              <p className="mt-1 text-[11px] leading-5" style={{ color: 'var(--text-tertiary)' }}>优先保留原意和句式</p>
            </label>
          </div>
        </div>

        <div
          className="rounded-[28px] border p-5"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
        >
          <h3 className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>口播音色</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="rounded-2xl border p-3" style={{ borderColor: voiceMode === 'auto' ? 'var(--accent)' : 'var(--border-subtle)' }}>
              <input type="radio" name="voiceover-voice-mode" value="auto" checked={voiceMode === 'auto'} onChange={() => setVoiceMode('auto')} />
              <span className="ml-2 text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>自动匹配</span>
              <p className="mt-1 text-[11px] leading-5" style={{ color: 'var(--text-tertiary)' }}>按原口播特征匹配预设音色</p>
            </label>
            <label className="rounded-2xl border p-3" style={{ borderColor: voiceMode === 'preset' ? 'var(--accent)' : 'var(--border-subtle)' }}>
              <input type="radio" name="voiceover-voice-mode" value="preset" checked={voiceMode === 'preset'} onChange={() => setVoiceMode('preset')} />
              <span className="ml-2 text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>选择预设</span>
              <p className="mt-1 text-[11px] leading-5" style={{ color: 'var(--text-tertiary)' }}>使用 Gemini 官方预设音色</p>
            </label>
          </div>
          {voiceMode === 'preset' ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {publicConfig?.voices.map((voice) => (
                <button
                  type="button"
                  key={voice.name}
                  onClick={() => setVoiceName(voice.name)}
                  className="rounded-2xl border px-3 py-2 text-left"
                  style={{
                    borderColor: voiceName === voice.name ? 'var(--accent)' : 'var(--border-subtle)',
                    background: voiceName === voice.name ? 'var(--accent-soft)' : 'var(--bg-elevated)',
                  }}
                >
                  <span className="block text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>{voice.name}</span>
                  <span className="mt-0.5 block text-[10px] leading-5" style={{ color: 'var(--text-tertiary)' }}>{voice.trait}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div
        className="mt-5 rounded-[28px] border p-5"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
      >
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={removeText}
            onChange={(event) => {
              const checked = event.target.checked;
              setRemoveText(checked);
              if (checked) setSubtitleRegion({ ...DEFAULT_SUBTITLE_REGION });
            }}
          />
          <span>
            <span className="block text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>同时去文案</span>
            <span className="mt-1 block text-[12px] leading-5" style={{ color: 'var(--text-secondary)' }}>
              默认处理画面底部 30%，可拖动或缩放区域；启用后会调用 Golden。
            </span>
          </span>
        </label>
        {removeText && editorSource ? (
          <div className="mt-4">
            <SubtitleRegionEditor
              source={editorSource}
              region={subtitleRegion}
              onRegionChange={setSubtitleRegion}
              disabled={submitting}
            />
          </div>
        ) : null}
      </div>

      {errorMessage ? (
        <p className="mt-4 rounded-2xl px-4 py-3 text-[12px]" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
          {errorMessage}
        </p>
      ) : null}

      {composerTarget
        ? createPortal(
            <div className="px-6 pb-5 pt-4">
              <div
                aria-label="口播翻译任务输入区"
                className="mx-auto w-full max-w-[896px] rounded-3xl border transition-all"
                style={{ background: 'var(--bg-surface)', borderColor: errorMessage ? 'var(--danger)' : 'var(--border-subtle)' }}
              >
                <button
                  type="button"
                  disabled={!canCreate || preparing || submitting}
                  onClick={() => inputRef.current?.click()}
                  className="flex min-h-[78px] w-full items-center gap-3 px-5 text-left disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                    {preparing ? <Loader2 size={18} className="animate-spin" /> : source ? <Replace size={18} /> : <Upload size={18} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium" style={{ color: 'var(--text-primary)' }}>
                      {preparing ? `正在准备视频 ${uploadProgress}%` : source ? '替换当前视频' : '上传一个 MP4 或 MOV 视频'}
                    </span>
                    <span className="mt-1 block text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                      一次只处理一个单人口播视频；需要时自动转换为 H.264/AAC MP4。
                    </span>
                  </span>
                </button>
                <div className="flex items-center justify-between gap-3 border-t px-4 py-3" style={{ borderColor: 'var(--border-subtle)' }}>
                  <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                    {source ? `${formatDuration(source.durationSeconds)} · ${selectedLanguage?.chineseName || '请选择语言'}` : '等待视频'}
                  </span>
                  <button
                    type="button"
                    disabled={!canOpenConfirmation}
                    onClick={() => setConfirmOpen(true)}
                    className="inline-flex items-center gap-2 rounded-3xl px-5 py-2.5 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-30"
                    style={{ background: 'var(--accent)' }}
                  >
                    {submitting ? <Loader2 size={14} className="animate-spin" /> : <Mic2 size={14} />}
                    开始口播翻译
                  </button>
                </div>
              </div>
            </div>,
            composerTarget,
          )
        : null}

      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/quicktime"
        className="hidden"
        onChange={(event) => {
          chooseFile(event.target.files?.item(0));
          event.target.value = '';
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingReplacementFile)}
        title="确认替换当前视频"
        message="新视频准备成功后会替换当前草稿，目标语言、翻译方式和音色设置会保留。"
        confirmText="确认替换"
        onConfirm={() => {
          const file = pendingReplacementFile;
          setPendingReplacementFile(null);
          if (file) void prepareFile(file);
        }}
        onCancel={() => setPendingReplacementFile(null)}
      />

      <ConfirmDialog
        open={confirmOpen}
        title="确认开始口播翻译"
        message={confirmationMessage}
        confirmText="确认提交"
        onConfirm={() => void handleSubmit()}
        onCancel={() => setConfirmOpen(false)}
      />
    </section>
  );
};

export default VoiceoverTranslationWorkspace;
