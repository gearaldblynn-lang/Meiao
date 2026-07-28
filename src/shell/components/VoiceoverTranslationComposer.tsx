import React, {
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Captions,
  ChevronDown,
  Languages,
  Loader2,
  Mic2,
  Pause,
  Play,
  Replace,
  Upload,
  Volume2,
  X,
} from 'lucide-react';

import type {
  SubtitleRemovalRegion,
  SubtitleRemovalSourceDraft,
} from '../../types';
import type {
  VoiceoverTranslationMode,
  VoiceoverTranslationSource,
} from '../../services/voiceoverTranslationClient';
import SubtitleRegionEditor from './SubtitleRegionEditor';
import {
  ComposerCapsuleButton,
  ComposerSelect,
  ComposerSubmitButton,
  ComposerSurface,
  ComposerToolbar,
  type ComposerSelectOption,
} from './layout/ComposerPrimitives';

export type PreparedVoiceoverSource = VoiceoverTranslationSource & {
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

type VoiceoverTranslationComposerProps = {
  inputRef: RefObject<HTMLInputElement | null>;
  source: PreparedVoiceoverSource | null;
  editorSource: SubtitleRemovalSourceDraft | null;
  canCreate: boolean;
  preparing: boolean;
  submitting: boolean;
  uploadProgress: number;
  errorMessage: string;
  creationBlockMessage: string;
  canOpenConfirmation: boolean;
  targetLanguage: string;
  languageOptions: ComposerSelectOption[];
  translationMode: VoiceoverTranslationMode;
  voiceSelection: string;
  voiceOptions: ComposerSelectOption[];
  voicePreviewingName: string;
  voicePlayingName: string;
  removeText: boolean;
  subtitleRegion: SubtitleRemovalRegion;
  onChooseFile: (file?: File | null) => void;
  onClearSource: () => void;
  onTargetLanguageChange: (value: string) => void;
  onTranslationModeChange: (value: VoiceoverTranslationMode) => void;
  onVoiceSelectionChange: (value: string) => void;
  onVoicePreview: (value: string) => void;
  onRemoveTextChange: (enabled: boolean) => void;
  onSubtitleRegionChange: (region: SubtitleRemovalRegion) => void;
  onOpenConfirmation: () => void;
};

const formatDuration = (durationSeconds: number) => {
  const totalSeconds = Math.max(0, Math.round(Number(durationSeconds || 0)));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const VoiceoverTranslationComposer: React.FC<VoiceoverTranslationComposerProps> = ({
  inputRef,
  source,
  editorSource,
  canCreate,
  preparing,
  submitting,
  uploadProgress,
  errorMessage,
  creationBlockMessage,
  canOpenConfirmation,
  targetLanguage,
  languageOptions,
  translationMode,
  voiceSelection,
  voiceOptions,
  voicePreviewingName,
  voicePlayingName,
  removeText,
  subtitleRegion,
  onChooseFile,
  onClearSource,
  onTargetLanguageChange,
  onTranslationModeChange,
  onVoiceSelectionChange,
  onVoicePreview,
  onRemoveTextChange,
  onSubtitleRegionChange,
  onOpenConfirmation,
}) => {
  const [removeTextPopoverOpen, setRemoveTextPopoverOpen] = useState(false);
  const removeTextPopoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (
        removeTextPopoverRef.current
        && !removeTextPopoverRef.current.contains(event.target as Node)
      ) {
        setRemoveTextPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const openFilePicker = () => {
    if (!canCreate || preparing || submitting) return;
    inputRef.current?.click();
  };

  return (
    <div className="px-4 pb-5 pt-4 sm:px-6">
      <ComposerSurface
        aria-label="口播翻译任务输入区"
        invalid={Boolean(errorMessage)}
        onDragOver={(event) => {
          event.preventDefault();
          if (canCreate && !preparing && !submitting) {
            event.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (!canCreate || preparing || submitting) return;
          onChooseFile(event.dataTransfer.files?.item(0));
        }}
      >
        {creationBlockMessage ? (
          <div
            className="mx-4 mt-4 rounded-2xl px-4 py-3 text-[12px] leading-5"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
          >
            {creationBlockMessage}
          </div>
        ) : null}

        <div className="min-h-[156px] px-5 pb-4 pt-5">
          {preparing ? (
            <div className="flex min-h-[132px] flex-col items-center justify-center text-center">
              <span
                className="flex h-11 w-11 items-center justify-center rounded-2xl"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                <Loader2 size={19} className="animate-spin" />
              </span>
              <p className="mt-3 text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                正在准备视频 {uploadProgress}%
              </p>
              <div
                className="mt-3 h-1.5 w-full max-w-[360px] overflow-hidden rounded-full"
                style={{ background: 'var(--bg-elevated)' }}
              >
                <div
                  className="h-full rounded-full transition-[width]"
                  style={{ width: `${uploadProgress}%`, background: 'var(--accent)' }}
                />
              </div>
              <p className="mt-2 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                正在上传并检查音轨，必要时转换为 H.264/AAC MP4
              </p>
            </div>
          ) : source ? (
            <div className="flex min-h-[132px] flex-col gap-4 sm:flex-row sm:items-center">
              <video
                src={source.sourceUrl}
                controls
                preload="metadata"
                className="aspect-video w-full shrink-0 rounded-2xl bg-black object-contain sm:w-[220px]"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {source.fileName}
                </p>
                <p className="mt-1 text-[11px] leading-5" style={{ color: 'var(--text-tertiary)' }}>
                  {formatDuration(source.durationSeconds)}
                  {' · '}
                  {source.width}×{source.height}
                  {source.transcoded ? ' · 已转换为兼容格式' : ' · 原视频格式已兼容'}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!canCreate || preparing || submitting}
                    onClick={openFilePicker}
                    className="inline-flex items-center gap-1.5 rounded-2xl px-3 py-2 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-45"
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                  >
                    <Replace size={13} />
                    替换视频
                  </button>
                  <button
                    type="button"
                    disabled={preparing || submitting}
                    onClick={onClearSource}
                    className="inline-flex items-center gap-1.5 rounded-2xl px-3 py-2 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-45"
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                  >
                    <X size={13} />
                    清除视频
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={!canCreate || preparing || submitting}
              onClick={openFilePicker}
              className="flex min-h-[132px] w-full flex-col items-center justify-center rounded-2xl border border-dashed px-5 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-45"
              style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
            >
              <span
                className="flex h-11 w-11 items-center justify-center rounded-2xl"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                <Upload size={19} />
              </span>
              <span className="mt-3 text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                点击或拖拽上传一个视频
              </span>
              <span className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                支持 MP4、MOV；一次只处理一个单人口播视频
              </span>
            </button>
          )}
        </div>

        {errorMessage ? (
          <p
            className="mx-4 mb-3 rounded-2xl px-4 py-3 text-[12px]"
            style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
          >
            {errorMessage}
          </p>
        ) : null}

        <div className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          <ComposerToolbar spacious>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <ComposerSelect
                value={targetLanguage}
                options={languageOptions}
                onChange={onTargetLanguageChange}
                icon={<Languages size={12} />}
                title="目标语言"
                disabled={!canCreate || languageOptions.length === 0}
              />
              <ComposerSelect
                value={translationMode}
                options={[
                  { value: 'natural', label: '自然口播' },
                  { value: 'literal', label: '忠实直译' },
                ]}
                onChange={(value) => onTranslationModeChange(value as VoiceoverTranslationMode)}
                icon={<Mic2 size={12} />}
                title="翻译方式"
                disabled={!canCreate}
              />
              <ComposerSelect
                value={voiceSelection}
                options={voiceOptions}
                onChange={onVoiceSelectionChange}
                icon={<Volume2 size={12} />}
                title="口播音色"
                description="首次生成后永久保存到当前账号，以后点击直接播放；首次生成可能产生少量 KIE 费用。"
                optionAction={{
                  isVisible: (value) => value !== '__auto__',
                  isDisabled: (value) => Boolean(
                    voicePreviewingName && voicePreviewingName !== value,
                  ),
                  ariaLabel: (value, label) => {
                    if (voicePreviewingName === value) return `正在加载 ${label} 试听`;
                    if (voicePlayingName === value) return `暂停 ${label} 试听`;
                    return `试听 ${label}`;
                  },
                  title: (value) => (
                    voicePreviewingName === value
                      ? '正在加载音色试听'
                      : voicePlayingName === value
                        ? '暂停试听'
                        : '试听真实音色'
                  ),
                  onAction: onVoicePreview,
                  renderIcon: (value) => (
                    voicePreviewingName === value
                      ? <Loader2 size={13} className="animate-spin" />
                      : voicePlayingName === value
                        ? <Pause size={13} fill="currentColor" />
                        : <Play size={13} fill="currentColor" />
                  ),
                }}
                disabled={!canCreate || voiceOptions.length === 0}
              />

              <div ref={removeTextPopoverRef} className="relative">
                <ComposerCapsuleButton
                  aria-label="去文案设置"
                  aria-haspopup="dialog"
                  aria-expanded={removeTextPopoverOpen}
                  active={removeTextPopoverOpen}
                  disabled={!canCreate}
                  onClick={() => setRemoveTextPopoverOpen((current) => !current)}
                  icon={<Captions size={12} />}
                  label={removeText ? '去文案：开启' : '去文案：关闭'}
                  trailingIcon={(
                    <ChevronDown
                      size={9}
                      className="transition-transform"
                      style={{ transform: removeTextPopoverOpen ? 'rotate(180deg)' : 'none' }}
                    />
                  )}
                />

                {removeTextPopoverOpen ? (
                  <div
                    role="dialog"
                    aria-label="去文案区域设置"
                    className="absolute bottom-full right-0 z-[220] mb-2 w-[620px] max-w-[calc(100vw-32px)] rounded-3xl border p-4"
                    style={{
                      background: 'var(--bg-base)',
                      borderColor: 'var(--border-subtle)',
                      boxShadow: 'var(--shadow-elevated)',
                    }}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                          同时去文案
                        </p>
                        <p className="mt-1 text-[11px] leading-5" style={{ color: 'var(--text-tertiary)' }}>
                          开启后会调用 Golden，默认处理画面底部 30%。
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setRemoveTextPopoverOpen(false)}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl"
                        style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}
                        aria-label="关闭去文案设置"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {[
                        { value: false, label: '关闭' },
                        { value: true, label: '开启' },
                      ].map((option) => {
                        const active = removeText === option.value;
                        return (
                          <button
                            key={String(option.value)}
                            type="button"
                            onClick={() => onRemoveTextChange(option.value)}
                            className="rounded-2xl border px-3 py-2 text-[12px] font-medium"
                            style={{
                              borderColor: active ? 'var(--accent)' : 'var(--border-subtle)',
                              background: active ? 'var(--accent-soft)' : 'var(--bg-surface)',
                              color: active ? 'var(--accent)' : 'var(--text-secondary)',
                            }}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>

                    {removeText ? (
                      editorSource ? (
                        <div className="mt-4">
                          <SubtitleRegionEditor
                            source={editorSource}
                            region={subtitleRegion}
                            onRegionChange={onSubtitleRegionChange}
                            disabled={submitting}
                          />
                        </div>
                      ) : (
                        <p
                          className="mt-4 rounded-2xl px-4 py-3 text-[11px]"
                          style={{ background: 'var(--bg-surface)', color: 'var(--text-tertiary)' }}
                        >
                          上传视频后可调整去文案区域。
                        </p>
                      )
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            <ComposerSubmitButton
              busy={submitting}
              icon={<Mic2 size={14} />}
              label="开始口播翻译"
              disabled={!canOpenConfirmation}
              onClick={onOpenConfirmation}
            />
          </ComposerToolbar>
        </div>
      </ComposerSurface>
    </div>
  );
};

export default VoiceoverTranslationComposer;
