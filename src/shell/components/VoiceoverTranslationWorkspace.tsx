import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

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
  requestVoiceoverPreview,
  waitForVoiceoverPreview,
} from '../../services/voiceoverPreviewClient';
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
import VoiceoverTranslationComposer, {
  type PreparedVoiceoverSource,
} from './VoiceoverTranslationComposer';

export type VoiceoverTranslationWorkspaceProps = {
  active: boolean;
  composerSlotId: string;
  initialSource?: VoiceoverTranslationSource | null;
  publicConfig: SystemPublicConfig['voiceoverTranslation'];
  creationDisabledReason?: string;
  onSubmit: (draft: VoiceoverTranslationDraft) => Promise<void>;
  onClearInitialSource: () => void;
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
  const cancelledSessionIdsRef = useRef(new Set<string>());
  const consumedInitialSourceRef = useRef('');
  const submitLockRef = useRef(false);
  const mountedRef = useRef(true);
  const previewControllerRef = useRef<AbortController | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewUrlsRef = useRef(new Map<string, string>());

  const [composerTarget, setComposerTarget] = useState<HTMLElement | null>(null);
  const [source, setSource] = useState<PreparedVoiceoverSource | null>(null);
  const [pendingReplacementFile, setPendingReplacementFile] = useState<File | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [targetLanguage, setTargetLanguage] = useState('');
  const [translationMode, setTranslationMode] = useState<VoiceoverTranslationMode>('natural');
  const [voiceMode, setVoiceMode] = useState<VoiceoverVoiceMode>('auto');
  const [voiceName, setVoiceName] = useState('');
  const [voicePreviewingName, setVoicePreviewingName] = useState('');
  const [voicePlayingName, setVoicePlayingName] = useState('');
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
  const languageOptions = useMemo(
    () => [
      ...commonLanguages.map((language) => ({
        value: language.code,
        label: language.chineseName,
      })),
      ...moreLanguages.map((language) => ({
        value: language.code,
        label: language.chineseName,
      })),
    ],
    [commonLanguages, moreLanguages],
  );
  const voiceOptions = useMemo(
    () => [
      { value: '__auto__', label: '自动匹配' },
      ...voices.map((voice) => ({
        value: voice.name,
        label: `${voice.name} · ${voice.trait}`,
      })),
    ],
    [voices],
  );
  const featureAvailable = Boolean(publicConfig?.enabled && publicConfig?.ready);
  const canCreate = featureAvailable && !creationDisabledReason;
  const creationBlockMessage = creationDisabledReason || (
    featureAvailable
      ? ''
      : '口播翻译当前未就绪，暂时不能创建新任务；历史项目仍可查看和下载。'
  );
  const cancelMediaSessionOnce = useCallback(async (sessionId: string) => {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId || cancelledSessionIdsRef.current.has(normalizedSessionId)) return;
    cancelledSessionIdsRef.current.add(normalizedSessionId);
    await cancelMediaTranscodeSession({ sessionId: normalizedSessionId }).catch(() => undefined);
  }, []);

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
    const audio = new Audio();
    audio.preload = 'none';
    audio.onended = () => {
      if (mountedRef.current) setVoicePlayingName('');
    };
    previewAudioRef.current = audio;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      previewControllerRef.current?.abort();
      audio.pause();
      audio.removeAttribute('src');
      previewAudioRef.current = null;
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = '';
      if (sessionId) {
        void cancelMediaSessionOnce(sessionId);
      }
    };
  }, [cancelMediaSessionOnce]);

  useEffect(() => {
    previewControllerRef.current?.abort();
    previewControllerRef.current = null;
    previewAudioRef.current?.pause();
    setVoicePreviewingName('');
    setVoicePlayingName('');
  }, [targetLanguage]);

  const prepareFile = useCallback(async (
    file: File,
    origin?: VoiceoverTranslationSource,
    lifecycleSignal?: AbortSignal,
  ) => {
    if (lifecycleSignal?.aborted) return;
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
    sessionIdRef.current = '';
    if (previousSessionId) {
      void cancelMediaSessionOnce(previousSessionId);
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    const abortForLifecycle = () => controller.abort();
    lifecycleSignal?.addEventListener('abort', abortForLifecycle, { once: true });
    const ownsPreparation = () => (
      mountedRef.current
      && controllerRef.current === controller
      && !controller.signal.aborted
    );
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
          if (!ownsPreparation()) return;
          setUploadProgress(Math.round(progress.ratio * 100));
        },
      });
      if (!probe.sessionId) throw new Error('服务端未返回媒体处理会话');
      createdSessionId = probe.sessionId;
      if (!ownsPreparation()) return;
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
      const prepared: PreparedVoiceoverSource = {
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
      if (!ownsPreparation()) return;
      conversionCompleted = true;
      if (sessionIdRef.current === createdSessionId) sessionIdRef.current = '';
      setSource(prepared);
      setUploadProgress(100);
      if (origin) onClearInitialSource();
    } catch (error) {
      if (!ownsPreparation()) return;
      setErrorMessage(error instanceof Error ? error.message : '视频处理失败，请重试');
    } finally {
      lifecycleSignal?.removeEventListener('abort', abortForLifecycle);
      if (createdSessionId && !conversionCompleted) {
        if (sessionIdRef.current === createdSessionId) sessionIdRef.current = '';
        await cancelMediaSessionOnce(createdSessionId);
      }
      const ownsFinalMutation = controllerRef.current === controller;
      if (ownsFinalMutation) {
        controllerRef.current = null;
      }
      if (mountedRef.current && ownsFinalMutation) setPreparing(false);
    }
  }, [canCreate, cancelMediaSessionOnce, creationBlockMessage, onClearInitialSource]);

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
        await prepareFile(file, initialSource!, controller.signal);
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
      void cancelMediaSessionOnce(sessionId);
    }
    setSource(null);
    setErrorMessage('');
    setUploadProgress(0);
    onClearInitialSource();
  }, [cancelMediaSessionOnce, onClearInitialSource]);

  const handleVoiceSelectionChange = useCallback((value: string) => {
    if (value === '__auto__') {
      setVoiceMode('auto');
      return;
    }
    if (!voices.some((voice) => voice.name === value)) return;
    setVoiceMode('preset');
    setVoiceName(value);
  }, [voices]);

  const handleVoicePreview = useCallback(async (requestedVoiceName: string) => {
    if (!canCreate || !voices.some((voice) => voice.name === requestedVoiceName)) return;
    const audio = previewAudioRef.current;
    if (!audio) return;
    if (voicePlayingName === requestedVoiceName && !audio.paused) {
      audio.pause();
      setVoicePlayingName('');
      return;
    }
    if (voicePreviewingName) return;
    const cacheKey = `${targetLanguage}:${requestedVoiceName}`;
    const play = async (audioUrl: string) => {
      audio.pause();
      audio.src = audioUrl;
      audio.load();
      try {
        await audio.play();
        if (mountedRef.current) setVoicePlayingName(requestedVoiceName);
      } catch {
        if (mountedRef.current) setVoicePlayingName('');
      }
    };
    const cachedUrl = previewUrlsRef.current.get(cacheKey);
    if (cachedUrl) {
      await play(cachedUrl);
      return;
    }

    previewControllerRef.current?.abort();
    const controller = new AbortController();
    previewControllerRef.current = controller;
    setVoicePreviewingName(requestedVoiceName);
    setVoicePlayingName('');
    setErrorMessage('');
    try {
      const requested = await requestVoiceoverPreview({
        targetLanguage,
        voiceName: requestedVoiceName,
      }, { signal: controller.signal });
      const ready = requested.status === 'ready'
        ? requested
        : await waitForVoiceoverPreview(requested.previewId, { signal: controller.signal });
      if (!ready.audioUrl) throw new Error('试听音频地址缺失');
      previewUrlsRef.current.set(cacheKey, ready.audioUrl);
      if (!controller.signal.aborted && mountedRef.current) {
        await play(ready.audioUrl);
      }
    } catch (error) {
      if (!controller.signal.aborted && mountedRef.current) {
        setErrorMessage(error instanceof Error ? error.message : '音色试听生成失败');
      }
    } finally {
      if (previewControllerRef.current === controller) {
        previewControllerRef.current = null;
      }
      if (mountedRef.current) setVoicePreviewingName('');
    }
  }, [
    canCreate,
    targetLanguage,
    voicePlayingName,
    voicePreviewingName,
    voices,
  ]);

  const handleRemoveTextChange = useCallback((enabled: boolean) => {
    setRemoveText(enabled);
    if (enabled) setSubtitleRegion({ ...DEFAULT_SUBTITLE_REGION });
  }, []);

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
    <>
      {composerTarget
        ? createPortal(
            <VoiceoverTranslationComposer
              inputRef={inputRef}
              source={source}
              editorSource={editorSource}
              canCreate={canCreate}
              preparing={preparing}
              submitting={submitting}
              uploadProgress={uploadProgress}
              errorMessage={errorMessage}
              creationBlockMessage={creationBlockMessage}
              canOpenConfirmation={canOpenConfirmation}
              targetLanguage={targetLanguage}
              languageOptions={languageOptions}
              translationMode={translationMode}
              voiceSelection={voiceMode === 'auto' ? '__auto__' : voiceName}
              voiceOptions={voiceOptions}
              voicePreviewingName={voicePreviewingName}
              voicePlayingName={voicePlayingName}
              removeText={removeText}
              subtitleRegion={subtitleRegion}
              onChooseFile={chooseFile}
              onClearSource={clearSource}
              onTargetLanguageChange={setTargetLanguage}
              onTranslationModeChange={setTranslationMode}
              onVoiceSelectionChange={handleVoiceSelectionChange}
              onVoicePreview={(value) => void handleVoicePreview(value)}
              onRemoveTextChange={handleRemoveTextChange}
              onSubtitleRegionChange={setSubtitleRegion}
              onOpenConfirmation={() => setConfirmOpen(true)}
            />,
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
    </>
  );
};

export default VoiceoverTranslationWorkspace;
