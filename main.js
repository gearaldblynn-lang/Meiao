const ENDPOINTS = {
  createTask: "https://api.kie.ai/api/v1/jobs/createTask",
  recordInfo: "https://api.kie.ai/api/v1/jobs/recordInfo",
  fileStreamUpload: "https://kieai.redpandaai.co/api/file-stream-upload",
};

const PRESET_HIGH_CONVERSION = `“吸引-建立信任-激发欲望-促成成交”的行为诱导逻辑，第一阶段：视觉钩子 (Hook)：1：强吸引：1.5秒内抓住注意力。通常采用动态递入或特写冲击，配合核心卖点的视觉化呈现/2：整体建立 (The Scene)交代空间背景。通过中景画面建立品牌调性。第二阶段：核心价值 (Value)：卖点展示：基础属性（展示产品的物理属性）/差异化（放大竞争对手没有的优势）/细节强化（显微镜视角。通过极微距展示，建立“高端、高品质”的心理暗示。）；第三阶段：体验沉浸 (Experience)：使用强化（预见使用场景）/互动强化（模拟用户自己的视角情感共鸣）；第四阶段：临门一脚 (Action)：信任总结（理性背书，消除用户最后的顾虑）/强收尾（产品最终全景展示，配合引导下单的口播，完成从流量到销量的闭环）`;

const app = {
  configPanel: document.getElementById("configPanel"),
  projectContainer: document.getElementById("projectContainer"),
  projectTemplate: document.getElementById("projectTemplate"),
  settingsDialog: document.getElementById("settingsDialog"),
  imagePreviewDialog: document.getElementById("imagePreviewDialog"),
  previewImage: document.getElementById("previewImage"),
};

const state = { previewList: [], previewIndex: 0, timedOutTaskIds: [] };

bootstrap();

function bootstrap() {
  const settingsBtn = document.getElementById("settingsBtn");
  const collapseBtn = document.getElementById("collapseBtn");
  const expandBtn = document.getElementById("expandBtn");
  const scriptPreset = document.getElementById("scriptPreset");
  const scriptLogic = document.getElementById("scriptLogic");

  document.getElementById("apiKey").value = localStorage.getItem("meiao_api_key") || "";
  scriptLogic.value = "请输入你的脚本逻辑。";

  settingsBtn.onclick = () => app.settingsDialog.showModal();
  collapseBtn.onclick = () => { app.configPanel.classList.add("collapsed"); expandBtn.classList.remove("hidden"); };
  expandBtn.onclick = () => { app.configPanel.classList.remove("collapsed"); expandBtn.classList.add("hidden"); };
  scriptPreset.onchange = () => { scriptLogic.value = scriptPreset.value === "high-conversion" ? PRESET_HIGH_CONVERSION : ""; };
  app.settingsDialog.addEventListener("close", () => localStorage.setItem("meiao_api_key", document.getElementById("apiKey").value.trim()));
  document.getElementById("previewClose").onclick = () => app.imagePreviewDialog.close();
  document.getElementById("previewPrev").onclick = () => stepPreview(-1);
  document.getElementById("previewNext").onclick = () => stepPreview(1);
  document.getElementById("configForm").addEventListener("submit", onGenerateProjects);
}

async function onGenerateProjects(e) {
  e.preventDefault();
  const files = [...document.getElementById("productImages").files];
  validateFiles(files);

  const baseConfig = {
    files,
    productInfo: document.getElementById("productInfo").value.trim(),
    scriptLogic: document.getElementById("scriptLogic").value.trim(),
    aspectRatio: document.getElementById("aspectRatio").value,
    duration: Number(document.getElementById("duration").value),
    actorType: document.getElementById("actorType").value,
    projectCount: Number(document.getElementById("projectCount").value),
    country: document.getElementById("country").value.trim() || "中国",
    language: document.getElementById("language").value.trim() || "中文",
    apiKey: document.getElementById("apiKey").value.trim(),
    llmModel: document.getElementById("llmModel").value.trim(),
    imageModel: document.getElementById("imageModel").value.trim(),
    enableImageApi: document.getElementById("enableImageApi").checked,
  };

  app.projectContainer.innerHTML = "";
  for (let i = 1; i <= baseConfig.projectCount; i += 1) {
    const node = app.projectTemplate.content.cloneNode(true);
    const card = node.querySelector(".project-card");
    card.querySelector(".project-title").textContent = `项目 #${i}`;
    app.projectContainer.appendChild(card);
    buildProject(card, { ...baseConfig, index: i }).catch((error) => {
      card.querySelector(".status-pill").textContent = "失败";
      card.querySelector(".script-output").textContent = `错误：${error.message}`;
    });
  }
}

function validateFiles(files) {
  if (!files.length) throw new Error("请至少上传1张产品图");
  if (files.length > 10) throw new Error("最多上传10张产品图");
  for (const file of files) {
    if (file.size > 30 * 1024 * 1024) throw new Error(`${file.name} 超过30MB`);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error(`${file.name} 格式不支持`);
  }
}

async function buildProject(card, config) {
  const status = card.querySelector(".status-pill");
  status.textContent = "生成方案中";

  const uploadUrls = await Promise.all(config.files.map((f, idx) => uploadFileStream(f, config.apiKey, idx)));
  const whiteBg = await createWhiteBgProductShot(config.files[0]);
  card.querySelector(".product-shot").src = whiteBg;

  const plan = await generateStoryboardPlan(config, uploadUrls);
  renderPrompts(card, plan);
  card.querySelector(".script-output").textContent = plan.fullScript;

  const runtime = { plan, uploadUrls, frames: [], done: 0, card, config, taskMap: [] };
  bindProjectActions(runtime);
  status.textContent = "待生图";
}

function bindProjectActions(runtime) {
  const { card } = runtime;
  const genBtn = card.querySelector(".gen-btn");
  const retryBtn = card.querySelector(".retry-btn");
  const dlBtn = card.querySelector(".download-btn");

  genBtn.onclick = async () => {
    runtime.done = 0;
    runtime.frames = [];
    runtime.taskMap = [];
    await generateStoryboardImages(runtime, false);
    dlBtn.disabled = false;
  };

  retryBtn.onclick = async () => {
    await generateStoryboardImages(runtime, true);
    if (runtime.done === runtime.plan.shots.length) dlBtn.disabled = false;
  };

  dlBtn.onclick = () => downloadZip(runtime);
}

async function generateStoryboardImages(runtime, onlyRetry) {
  const { card, config, plan, uploadUrls } = runtime;
  const progressText = card.querySelector(".progress-text");
  const status = card.querySelector(".status-pill");
  status.textContent = "生图中";

  for (let i = 0; i < plan.shots.length; i += 1) {
    if (onlyRetry && !runtime.taskMap[i]?.taskId) continue;
    if (!onlyRetry && runtime.frames[i]) continue;

    let imageUrl = "";
    try {
      if (!config.enableImageApi) {
        imageUrl = createPlaceholder(plan.shots[i].prompt);
      } else if (onlyRetry) {
        imageUrl = await repollImage(runtime.taskMap[i].taskId, config.apiKey);
      } else {
        const taskId = await createTask(config.apiKey, {
          model: config.imageModel,
          input: {
            prompt: plan.shots[i].prompt + (config.actorType === "不出现真实人脸" ? "，不出现真实人物脸部" : ""),
            image_input: [uploadUrls[0]],
            aspect_ratio: config.aspectRatio,
            google_search: false,
            resolution: "1K",
            output_format: "jpg",
          },
        });
        runtime.taskMap[i] = { taskId };
        imageUrl = await pollImage(taskId, config.apiKey);
      }
    } catch {
      continue;
    }

    runtime.frames[i] = imageUrl;
    runtime.done += 1;
    progressText.textContent = `${runtime.done}/${plan.shots.length}`;
    const promptNode = card.querySelector(`[data-shot='${i + 1}'] .shot-state`);
    if (promptNode) promptNode.textContent = "已完成";
  }

  if (runtime.frames.filter(Boolean).length === plan.shots.length) {
    const collage = await buildCollage(runtime.frames, config.duration);
    const board = card.querySelector(".board-collage");
    board.src = collage;
    board.onclick = () => openPreview([collage], 0);
    bindPreview(card, runtime.frames);
    status.textContent = "已完成";
  } else {
    status.textContent = "部分完成，可重试";
  }
}

function bindPreview(card, frames) {
  const imgs = [card.querySelector(".product-shot"), card.querySelector(".board-collage")];
  imgs.forEach((img) => img.onclick = () => openPreview(imgs.map((n) => n.src), imgs.indexOf(img)));
  card.querySelectorAll(".shot-thumb").forEach((img, idx) => img.onclick = () => openPreview(frames, idx));
}

function renderPrompts(card, plan) {
  const list = card.querySelector(".prompt-list");
  list.innerHTML = "";
  for (const shot of plan.shots) {
    const div = document.createElement("div");
    div.className = "prompt-item";
    div.dataset.shot = shot.index;
    div.innerHTML = `<b>分镜${shot.index}（${shot.timeRange}）</b> <span class='shot-state'>待生成</span><div>${shot.prompt}</div><img class='shot-thumb' alt='分镜${shot.index}'/>`;
    list.appendChild(div);
  }
}

async function generateStoryboardPlan(config, uploadUrls) {
  const shotCount = shotCountFromDuration(config.duration);
  const prompt = [
    `你是资深分镜导演，请输出严格JSON：{fullScript:string, shots:[{index:number,timeRange:string,prompt:string,action:string,voiceover:string}]}`,
    `视频时长：${config.duration}秒，总镜头：${shotCount}。时长累加必须精确等于${config.duration}秒。`,
    "分镜脚本规范：禁止出现任何字幕；格式为分镜N（xxs - xxs）+画面+动作+口播。",
    `国家：${config.country}；语言：${config.language}；口播必须使用该语言。`,
    `演员类型：${config.actorType}。`,
    `脚本逻辑：${config.scriptLogic}。`,
    "生图prompt规则：空间设定一致；动作逻辑遵循[起始状态]->[运动轨迹]->[结束状态]；动量衔接、轴线保护、预备-发力-收势。",
    `产品图URL：${uploadUrls.join(",")}`,
    `产品信息：${config.productInfo}`,
  ].join("\n");

  try {
    const taskId = await createTask(config.apiKey, { model: config.llmModel, input: { prompt } });
    const resultJson = await pollTask(taskId, config.apiKey);
    const parsed = JSON.parse(resultJson || "{}");
    const text = parsed.resultObject?.text || parsed.result || "";
    const json = safeJson(text);
    if (json?.shots?.length) return normalizePlan(json, config.duration, config.language);
  } catch {}

  return localPlan(config, shotCount);
}

function normalizePlan(json, duration, language) {
  const shots = json.shots.slice(0, shotCountFromDuration(duration)).map((s, i) => ({
    index: i + 1,
    timeRange: s.timeRange || `${i}s-${i + 1}s`,
    prompt: String(s.prompt || "极简产品镜头"),
    action: String(s.action || "产品动作展示"),
    voiceover: String(s.voiceover || `(${language})口播`),
  }));
  const lines = shots.map((s) => `分镜${s.index}（${s.timeRange}）\n画面：${s.prompt}\n动作：${s.action}\n口播：${s.voiceover}`).join("\n\n");
  return { shots, fullScript: `固定：禁止出现任何字幕！\n${lines}` };
}

function localPlan(config, count) {
  const sec = (config.duration / count).toFixed(2);
  let t = 0;
  const shots = Array.from({ length: count }, (_, i) => {
    const start = Number(t.toFixed(2));
    t += Number(sec);
    const end = i === count - 1 ? config.duration : Number(t.toFixed(2));
    return {
      index: i + 1,
      timeRange: `${start}s - ${end}s`,
      prompt: `场景固定在${config.country}风格空间，光影同侧，分镜${i + 1}，起始状态->运动轨迹->结束状态，产品卖点可视化，${config.actorType}`,
      action: "预备-发力-收势，镜头动量连续",
      voiceover: `(${config.language})围绕卖点与下单引导口播`,
    };
  });
  const fullScript = `固定：禁止出现任何字幕！\n${shots.map((s) => `分镜${s.index}（${s.timeRange}）\n画面：${s.prompt}\n动作：${s.action}\n口播：${s.voiceover}`).join("\n\n")}`;
  return { shots, fullScript };
}

function shotCountFromDuration(duration) { return duration === 5 ? 3 : duration === 10 ? 6 : duration === 15 ? 9 : 12; }

async function uploadFileStream(file, apiKey, idx) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("uploadPath", "images/meiao");
  fd.append("fileName", `${Date.now()}-${idx}-${file.name}`);
  const res = await fetch(ENDPOINTS.fileStreamUpload, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: fd });
  const data = await res.json();
  if (!data.success || !data.data?.fileUrl) throw new Error("产品图上传失败");
  return data.data.fileUrl;
}

async function createTask(apiKey, payload) {
  const res = await fetch(ENDPOINTS.createTask, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (data.code !== 200 || !data.data?.taskId) throw new Error(data.msg || "createTask失败");
  return data.data.taskId;
}

async function pollTask(taskId, apiKey) {
  for (let i = 0; i < 45; i += 1) {
    await sleep(1400);
    const res = await fetch(`${ENDPOINTS.recordInfo}?taskId=${encodeURIComponent(taskId)}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    const data = await res.json();
    if (data.data?.state === "success") return data.data.resultJson;
    if (data.data?.state === "fail") throw new Error(data.data.failMsg || "任务失败");
  }
  throw new Error("任务超时");
}

async function pollImage(taskId, apiKey) {
  const r = await pollTask(taskId, apiKey);
  const parsed = JSON.parse(r || "{}");
  return parsed.resultUrls?.[0];
}

async function repollImage(taskId, apiKey) { return pollImage(taskId, apiKey); }

async function createWhiteBgProductShot(file) {
  const src = await fileToDataUrl(file);
  const img = await loadImage(src);
  const c = document.createElement("canvas"); c.width = 1024; c.height = 1024;
  const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, 1024, 1024);
  const r = Math.min(760 / img.width, 760 / img.height); const w = img.width * r; const h = img.height * r;
  x.drawImage(img, (1024 - w) / 2, (1024 - h) / 2, w, h);
  return c.toDataURL("image/jpeg", 0.92);
}

async function buildCollage(urls, duration) {
  if (duration === 30) return stackVertical([await drawGrid(urls.slice(0, 6), 3, 2), await drawGrid(urls.slice(6, 12), 3, 2)]);
  if (duration === 15) return drawGrid(urls, 3, 3);
  if (duration === 10) return drawGrid(urls, 3, 2);
  return drawGrid(urls, 3, 1);
}
async function drawGrid(urls, cols, rows) {
  const cell = 360; const c = document.createElement("canvas"); c.width = cols * cell; c.height = rows * cell; const x = c.getContext("2d");
  x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < urls.length; i += 1) { const img = await loadImage(urls[i]); const xx = (i % cols) * cell; const yy = Math.floor(i / cols) * cell; x.drawImage(img, xx + 6, yy + 6, cell - 12, cell - 12); }
  return c.toDataURL("image/jpeg", 0.9);
}
async function stackVertical(urls) { const imgs = await Promise.all(urls.map(loadImage)); const c = document.createElement("canvas"); c.width = imgs[0].width; c.height = imgs.reduce((s, i) => s + i.height, 0); const x = c.getContext("2d"); let y = 0; for (const i of imgs) { x.drawImage(i, 0, y); y += i.height; } return c.toDataURL("image/jpeg", 0.9); }

async function downloadZip(runtime) {
  if (!window.JSZip) return;
  const zip = new window.JSZip();
  zip.file("script.txt", runtime.plan.fullScript);
  zip.file("collage.jpg", dataUrlToBlob(runtime.card.querySelector(".board-collage").src));
  runtime.frames.forEach((u, idx) => zip.file(`frames/frame-${idx + 1}.jpg`, dataUrlToBlob(u), { binary: true }));
  const blob = await zip.generateAsync({ type: "blob" });
  triggerDownload(URL.createObjectURL(blob), `meiao-project-${Date.now()}.zip`);
}

function openPreview(list, idx) { state.previewList = list; state.previewIndex = idx; app.previewImage.src = list[idx]; app.imagePreviewDialog.showModal(); }
function stepPreview(step) { if (!state.previewList.length) return; state.previewIndex = (state.previewIndex + step + state.previewList.length) % state.previewList.length; app.previewImage.src = state.previewList[state.previewIndex]; }
function safeJson(text) { try { return JSON.parse(text); } catch { const m = text.match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]); } catch { return null; } } }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fileToDataUrl(file) { return new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(file); }); }
function loadImage(src) { return new Promise((resolve, reject) => { const img = new Image(); img.crossOrigin = "anonymous"; img.onload = () => resolve(img); img.onerror = reject; img.src = src; }); }
function createPlaceholder(text) { const c = document.createElement("canvas"); c.width = 720; c.height = 720; const x = c.getContext("2d"); x.fillStyle = "#eef2ff"; x.fillRect(0, 0, 720, 720); x.fillStyle = "#333"; x.font = "24px sans-serif"; x.fillText("Storyboard Placeholder", 26, 70); x.font = "18px sans-serif"; x.fillText(text.slice(0, 40), 26, 120); return c.toDataURL("image/jpeg", .88); }
function dataUrlToBlob(dataUrl) { if (dataUrl.startsWith("http")) return fetch(dataUrl).then((r) => r.blob()); const [h, b] = dataUrl.split(","); const mime = h.match(/:(.*?);/)[1]; const bin = atob(b); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); return new Blob([arr], { type: mime }); }
function triggerDownload(url, name) { const a = document.createElement("a"); a.href = url; a.download = name; a.click(); }
