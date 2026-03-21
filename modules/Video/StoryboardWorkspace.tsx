import React, { useEffect, useState } from 'react';
import { VideoStoryboardBoard, VideoStoryboardProject } from '../../types';
import { safeCreateObjectURL } from '../../utils/urlUtils';

interface Props {
  projects: VideoStoryboardProject[];
  downloadingProjectId: string | null;
  onDownloadAll: () => void;
  onClearAllProjects: () => void;
  onDownloadProject: (project: VideoStoryboardProject) => void;
  onDeleteProject: (projectId: string) => void;
  onRetryProject: (projectId: string) => void;
  onRetryFailedBoards: (projectId: string) => void;
  onCreateNewSchemes: (projectId: string, count: number, scenes: string[]) => void;
  onRegenerateBoard: (projectId: string, boardId: string) => void;
  onRefetchBoard: (projectId: string, boardId: string) => void;
  onUpdateBoard: (projectId: string, boardId: string, updates: Partial<VideoStoryboardBoard>) => void;
}

const statusMap: Record<VideoStoryboardProject['status'], { label: string; badge: string; icon: string }> = {
  pending: { label: '等待中', badge: 'bg-slate-100 text-slate-500', icon: 'fa-clock' },
  scripting: { label: '脚本生成中', badge: 'bg-indigo-50 text-indigo-600', icon: 'fa-pen-nib' },
  imaging: { label: '分镜板生成中', badge: 'bg-amber-50 text-amber-600', icon: 'fa-images' },
  completed: { label: '已完成', badge: 'bg-emerald-50 text-emerald-600', icon: 'fa-check-circle' },
  failed: { label: '有失败项', badge: 'bg-rose-50 text-rose-600', icon: 'fa-triangle-exclamation' },
};

const FilePreview: React.FC<{ file: File; alt: string }> = ({ file, alt }) => {
  const [src, setSrc] = useState('');

  useEffect(() => {
    const nextSrc = safeCreateObjectURL(file);
    setSrc(nextSrc);
    return () => URL.revokeObjectURL(nextSrc);
  }, [file]);

  return <img src={src} alt={alt} className="w-full h-full object-cover" />;
};

const BoardCard: React.FC<{
  board: VideoStoryboardBoard;
  onOpen: () => void;
  onRegenerate: () => void;
  onRefetch: () => void;
}> = ({ board, onOpen, onRegenerate, onRefetch }) => {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white overflow-hidden shadow-sm">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black text-slate-900">{board.title}</p>
          <p className="mt-1 text-[11px] font-bold text-slate-400">{board.shotIds.length} 个镜头</p>
        </div>
        <div className="flex items-center gap-2">
          {board.taskId && (
            <button type="button" onClick={onRefetch} className="w-10 h-10 rounded-2xl bg-slate-100 text-slate-600 hover:bg-slate-900 hover:text-white transition-colors" title="重新获取">
              <i className="fas fa-rotate"></i>
            </button>
          )}
          <button type="button" onClick={onRegenerate} className="w-10 h-10 rounded-2xl bg-slate-100 text-slate-600 hover:bg-slate-900 hover:text-white transition-colors" title="重新生成">
            <i className="fas fa-wand-magic-sparkles"></i>
          </button>
        </div>
      </div>

      <button type="button" onClick={onOpen} className="w-full bg-slate-50 min-h-[320px] flex items-center justify-center p-4">
        {board.imageUrl ? (
          <img src={board.imageUrl} alt={board.title} className="max-w-full max-h-[420px] rounded-[20px] shadow-lg" />
        ) : (
          <div className="text-center text-slate-400">
            <i className={`fas ${board.status === 'generating' ? 'fa-spinner fa-spin' : board.status === 'failed' ? 'fa-circle-exclamation' : 'fa-image'} text-3xl mb-3`}></i>
            <p className="text-sm font-black">
              {board.status === 'generating' ? '分镜板生成中...' : board.status === 'failed' ? '分镜板生成失败' : '等待生成'}
            </p>
          </div>
        )}
      </button>
    </div>
  );
};

const ProjectCard: React.FC<{
  project: VideoStoryboardProject;
  isDownloading: boolean;
  onDownloadProject: (project: VideoStoryboardProject) => void;
  onDeleteProject: (projectId: string) => void;
  onRetryProject: (projectId: string) => void;
  onRetryFailedBoards: (projectId: string) => void;
  onCreateNewSchemes: (projectId: string, count: number, scenes: string[]) => void;
  onRegenerateBoard: (projectId: string, boardId: string) => void;
  onRefetchBoard: (projectId: string, boardId: string) => void;
  onUpdateBoard: (projectId: string, boardId: string, updates: Partial<VideoStoryboardBoard>) => void;
}> = ({
  project,
  isDownloading,
  onDownloadProject,
  onDeleteProject,
  onRetryProject,
  onRetryFailedBoards,
  onCreateNewSchemes,
  onRegenerateBoard,
  onRefetchBoard,
  onUpdateBoard,
}) => {
  const [expanded, setExpanded] = useState(true);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  const [editingPrompt, setEditingPrompt] = useState('');
  const [showNewScheme, setShowNewScheme] = useState(false);
  const [schemeCount, setSchemeCount] = useState(1);
  const [schemeScenes, setSchemeScenes] = useState<string[]>(['']);

  const activeBoard = project.boards.find((item) => item.id === activeBoardId) || null;
  const failedCount = project.boards.filter((board) => board.status === 'failed').length;

  useEffect(() => {
    if (activeBoard) setEditingPrompt(activeBoard.prompt);
  }, [activeBoard?.id]);

  const submitNewSchemes = () => {
    onCreateNewSchemes(project.id, schemeCount, schemeScenes);
    setShowNewScheme(false);
    setSchemeCount(1);
    setSchemeScenes(['']);
  };

  return (
    <>
      <div className="bg-white rounded-[28px] border border-slate-200 overflow-hidden shadow-sm">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between gap-6">
          <div className="flex items-center gap-4 text-left min-w-0">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${statusMap[project.status].badge}`}>
              <i className={`fas ${statusMap[project.status].icon}`}></i>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h3 className="text-base font-black text-slate-900">{project.name}</h3>
                <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${statusMap[project.status].badge}`}>
                  {statusMap[project.status].label}
                </span>
              </div>
              <p className="mt-1 text-xs font-bold text-slate-400">
                {project.config.duration} / {project.config.shotCount} 镜头 / {project.config.aspectRatio} / {project.sceneDescription || '未指定场景'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="w-11 h-11 rounded-2xl bg-slate-100 text-slate-600 hover:bg-slate-900 hover:text-white transition-colors"
              title={expanded ? '收起项目' : '展开项目'}
            >
              <i className={`fas ${expanded ? 'fa-chevron-up' : 'fa-chevron-down'}`}></i>
            </button>
            <button
              type="button"
              onClick={() => onDeleteProject(project.id)}
              className="w-11 h-11 rounded-2xl bg-rose-50 text-rose-600 hover:bg-rose-600 hover:text-white transition-colors"
              title="删除项目"
            >
              <i className="fas fa-trash"></i>
            </button>
            {failedCount > 0 && (
              <button type="button" onClick={() => onRetryFailedBoards(project.id)} className="px-4 py-2 rounded-xl bg-amber-50 text-amber-700 text-xs font-black hover:bg-amber-100 transition-colors">
                重试失败分镜板
              </button>
            )}
            {project.status === 'failed' && (
              <button type="button" onClick={() => onRetryProject(project.id)} className="px-4 py-2 rounded-xl bg-rose-50 text-rose-600 text-xs font-black hover:bg-rose-100 transition-colors">
                重新运行
              </button>
            )}
            {project.status === 'completed' && (
              <>
                <button type="button" onClick={() => setShowNewScheme(true)} className="w-11 h-11 rounded-2xl bg-slate-100 text-slate-700 hover:bg-slate-900 hover:text-white transition-colors" title="生成新方案">
                  <i className="fas fa-plus"></i>
                </button>
                <button type="button" onClick={() => onDownloadProject(project)} className="px-4 h-11 rounded-2xl bg-slate-900 text-white text-xs font-black hover:bg-slate-800 transition-colors">
                  {isDownloading ? '打包中...' : '打包下载'}
                </button>
              </>
            )}
          </div>
        </div>

        {expanded && (
          <div className="p-6 grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)] gap-6">
            <div className="space-y-5">
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <i className="fas fa-scroll text-rose-500"></i>
                  <h4 className="text-sm font-black text-slate-900">分镜脚本</h4>
                </div>
                <div className="space-y-3">
                  {project.boards.length > 0 ? project.boards.map((board) => (
                    <div key={board.id} className="rounded-2xl border border-slate-200 bg-slate-50 overflow-hidden">
                      <div className="px-4 py-3 border-b border-slate-200 bg-white">
                        <p className="text-xs font-black text-slate-800">{board.title}</p>
                      </div>
                      <div className="p-4 max-h-[260px] overflow-y-auto whitespace-pre-wrap text-[12px] leading-6 font-bold text-slate-600">
                        {board.scriptText || '正在生成脚本...'}
                      </div>
                    </div>
                  )) : (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 max-h-[440px] overflow-y-auto whitespace-pre-wrap text-[12px] leading-6 font-bold text-slate-600">
                      {project.script || '正在生成脚本...'}
                    </div>
                  )}
                </div>
              </section>

              <section>
                <div className="flex items-center gap-2 mb-3">
                  <i className="fas fa-image text-rose-500"></i>
                  <h4 className="text-sm font-black text-slate-900">产品参考图</h4>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {project.config.productImages.map((image, index) => (
                    <div key={`${image.name}-${index}`} className="aspect-square rounded-2xl overflow-hidden border border-slate-200 bg-slate-50">
                      <FilePreview file={image} alt={image.name} />
                    </div>
                  ))}
                </div>
              </section>

              {project.config.generateWhiteBg && (
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <i className="fas fa-box-open text-rose-500"></i>
                    <h4 className="text-sm font-black text-slate-900">白底图</h4>
                  </div>
                  <div className="w-28 aspect-square rounded-2xl overflow-hidden border border-slate-200 bg-slate-50 flex items-center justify-center">
                    {project.whiteBgImageUrl ? (
                      <img src={project.whiteBgImageUrl} alt="white-bg" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-[11px] font-black text-slate-400">
                        {project.whiteBgStatus === 'failed' ? '生成失败' : project.whiteBgStatus === 'generating' ? '生成中' : '未生成'}
                      </span>
                    )}
                  </div>
                </section>
              )}
            </div>

            <section>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h4 className="text-sm font-black text-slate-900">分镜板结果</h4>
                </div>
                <span className="text-xs font-black text-slate-400">{project.boards.length} 张</span>
              </div>

              {project.boards.length > 0 ? (
                <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
                  {project.boards.map((board) => (
                    <BoardCard
                      key={board.id}
                      board={board}
                      onOpen={() => setActiveBoardId(board.id)}
                      onRegenerate={() => onRegenerateBoard(project.id, board.id)}
                      onRefetch={() => onRefetchBoard(project.id, board.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-[28px] border border-dashed border-slate-200 bg-slate-50 h-[320px] flex flex-col items-center justify-center text-slate-400">
                  <i className="fas fa-film text-2xl mb-3"></i>
                  <p className="text-sm font-black">等待分镜板生成</p>
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      {activeBoard && (
        <div className="fixed inset-0 z-[120] bg-slate-950/65 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="w-full max-w-7xl bg-white rounded-[32px] overflow-hidden shadow-2xl grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_460px]">
            <div className="bg-slate-100 min-h-[640px] flex items-center justify-center p-6">
              {activeBoard.imageUrl ? (
                <img src={activeBoard.imageUrl} alt="active-board" className="max-w-full max-h-[640px] rounded-[28px] shadow-xl" />
              ) : (
                <div className="text-center text-slate-400">
                  <i className={`fas ${activeBoard.status === 'generating' ? 'fa-spinner fa-spin' : 'fa-image'} text-3xl mb-3`}></i>
                  <p className="text-sm font-black">{activeBoard.status === 'generating' ? '分镜板生成中...' : '暂无图片'}</p>
                </div>
              )}
            </div>
            <div className="p-6 border-l border-slate-100 overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-rose-500">Board Editor</p>
                  <h4 className="mt-1 text-lg font-black text-slate-900">{activeBoard.title}</h4>
                </div>
                <button type="button" onClick={() => setActiveBoardId(null)} className="w-10 h-10 rounded-2xl bg-slate-100 text-slate-600 hover:bg-slate-900 hover:text-white transition-colors">
                  <i className="fas fa-times"></i>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">包含镜头</p>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-[12px] leading-6 font-bold text-slate-600">
                    {activeBoard.shotIds.map((id, index) => <div key={id}>分镜 {index + 1}</div>)}
                  </div>
                </div>

                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">分镜板提示词</p>
                  <textarea
                    value={editingPrompt}
                    onChange={(event) => setEditingPrompt(event.target.value)}
                    rows={14}
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-rose-300 outline-none text-sm font-bold text-slate-700 resize-none"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      onUpdateBoard(project.id, activeBoard.id, { prompt: editingPrompt });
                      onRegenerateBoard(project.id, activeBoard.id);
                    }}
                    className="flex-1 px-4 py-3 rounded-2xl bg-slate-900 text-white text-sm font-black hover:bg-slate-800 transition-colors"
                  >
                    保存并重生
                  </button>
                  {activeBoard.taskId && (
                    <button
                      type="button"
                      onClick={() => onRefetchBoard(project.id, activeBoard.id)}
                      className="px-4 py-3 rounded-2xl bg-slate-100 text-slate-700 text-sm font-black hover:bg-slate-200 transition-colors"
                    >
                      重新获取
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showNewScheme && (
        <div className="fixed inset-0 z-[110] bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="w-full max-w-xl bg-white rounded-[28px] shadow-2xl p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-rose-500">New Schemes</p>
                <h4 className="mt-1 text-lg font-black text-slate-900">基于当前配置生成新方案</h4>
              </div>
              <button type="button" onClick={() => setShowNewScheme(false)} className="w-10 h-10 rounded-2xl bg-slate-100 text-slate-600 hover:bg-slate-900 hover:text-white transition-colors">
                <i className="fas fa-times"></i>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">方案数量</label>
                <select
                  value={schemeCount}
                  onChange={(event) => {
                    const nextCount = Number(event.target.value);
                    setSchemeCount(nextCount);
                    setSchemeScenes((prev) => {
                      const next = [...prev];
                      if (nextCount > next.length) while (next.length < nextCount) next.push('');
                      else next.length = nextCount;
                      return next;
                    });
                  }}
                  className="w-full mt-2 px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 outline-none text-sm font-bold text-slate-700"
                >
                  <option value="1">1 个方案</option>
                  <option value="2">2 个方案</option>
                  <option value="3">3 个方案</option>
                  <option value="4">4 个方案</option>
                  <option value="5">5 个方案</option>
                </select>
              </div>

              {schemeScenes.map((scene, index) => (
                <div key={index}>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">方案 {index + 1} 场景</label>
                  <input
                    value={scene}
                    onChange={(event) => {
                      const next = [...schemeScenes];
                      next[index] = event.target.value;
                      setSchemeScenes(next);
                    }}
                    className="w-full mt-2 px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-rose-300 outline-none text-sm font-bold text-slate-700"
                    placeholder="例如：露营开箱、办公室桌面、居家浴室场景"
                  />
                </div>
              ))}

              <button type="button" onClick={submitNewSchemes} className="w-full px-4 py-3 rounded-2xl bg-slate-900 text-white text-sm font-black hover:bg-slate-800 transition-colors">
                生成新方案
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const StoryboardWorkspace: React.FC<Props> = ({
  projects,
  downloadingProjectId,
  onDownloadAll,
  onClearAllProjects,
  onDownloadProject,
  onDeleteProject,
  onRetryProject,
  onRetryFailedBoards,
  onCreateNewSchemes,
  onRegenerateBoard,
  onRefetchBoard,
  onUpdateBoard,
}) => {
  return (
    <section className="flex-1 h-full overflow-y-auto bg-slate-50">
      <div className="px-8 py-6 max-w-[1680px] mx-auto">
        <div className="flex items-center justify-between gap-6 mb-6">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-400">Workspace</p>
            <h2 className="mt-2 text-2xl font-black text-slate-900">短视频分镜工作区</h2>
            <p className="mt-1 text-sm font-bold text-slate-400">每个方案会先出脚本，再生成 1 张或 2 张整板分镜图。</p>
          </div>
          {projects.length > 0 && (
            <div className="flex items-center gap-3">
              <button type="button" onClick={onClearAllProjects} className="px-5 py-3 rounded-2xl bg-rose-50 border border-rose-100 text-rose-600 text-sm font-black hover:bg-rose-600 hover:text-white transition-colors">
                <i className="fas fa-trash-alt mr-2"></i>
                清空项目
              </button>
              <button type="button" onClick={onDownloadAll} className="px-5 py-3 rounded-2xl bg-white border border-slate-200 text-slate-700 text-sm font-black hover:bg-slate-900 hover:text-white transition-colors">
                <i className="fas fa-file-zipper mr-2"></i>
                打包下载全部方案
              </button>
            </div>
          )}
        </div>

        {projects.length === 0 ? (
          <div className="h-[560px] rounded-[36px] border-2 border-dashed border-slate-200 bg-white flex flex-col items-center justify-center text-center">
            <div className="w-20 h-20 rounded-[28px] bg-rose-50 flex items-center justify-center text-rose-500 mb-6">
              <i className="fas fa-clapperboard text-3xl"></i>
            </div>
            <h3 className="text-xl font-black text-slate-900">还没有短视频分镜项目</h3>
            <p className="mt-2 text-sm font-bold text-slate-400 max-w-xl">
              左侧上传产品图并填写逻辑后，系统会先生成分镜脚本，再一次性输出整张分镜板。
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                isDownloading={downloadingProjectId === project.id}
                onDownloadProject={onDownloadProject}
                onDeleteProject={onDeleteProject}
                onRetryProject={onRetryProject}
                onRetryFailedBoards={onRetryFailedBoards}
                onCreateNewSchemes={onCreateNewSchemes}
                onRegenerateBoard={onRegenerateBoard}
                onRefetchBoard={onRefetchBoard}
                onUpdateBoard={onUpdateBoard}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export default StoryboardWorkspace;
