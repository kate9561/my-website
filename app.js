const form = document.querySelector("#generateForm");
const submitButton = document.querySelector("#submitButton");
const clearButton = document.querySelector("#clearButton");
const keyStatus = document.querySelector("#keyStatus");
const runStatus = document.querySelector("#runStatus");
const gallery = document.querySelector("#gallery");
const emptyState = document.querySelector("#emptyState");
const rawOutput = document.querySelector("#rawOutput");
const message = document.querySelector("#message");
const assetFiles = document.querySelector("#assetFiles");
const assetPreview = document.querySelector("#assetPreview");
const quickPrompts = document.querySelector(".quickPrompts");
const songForm = document.querySelector("#songForm");
const audioFile = document.querySelector("#audioFile");
const audioPreview = document.querySelector("#audioPreview");
const videoUrl = document.querySelector("#videoUrl");
const extractUrlButton = document.querySelector("#extractUrlButton");
const lyricsInput = document.querySelector("#lyricsInput");
const songTitle = document.querySelector("#songTitle");
const songTheme = document.querySelector("#songTheme");
const adaptLyricsButton = document.querySelector("#adaptLyricsButton");
const previewSongButton = document.querySelector("#previewSongButton");
const createSongButton = document.querySelector("#createSongButton");
const songStatus = document.querySelector("#songStatus");
const songMessage = document.querySelector("#songMessage");
const songOutput = document.querySelector("#songOutput");
const songRawOutput = document.querySelector("#songRawOutput");
const songProgressText = document.querySelector("#songProgressText");
const songTaskId = document.querySelector("#songTaskId");
const songProgressBar = document.querySelector("#songProgressBar");
const songOutputDir = document.querySelector("#songOutputDir");
const apiBase = window.location.protocol === "file:" || window.location.hostname.endsWith("github.io")
  ? "http://localhost:5173"
  : "";
const audioExts = [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".webm", ".wma"];
const videoExts = [".mp4", ".mov", ".mkv", ".avi", ".webm", ".flv", ".m4v"];
let uploadedAssets = [];
let referenceAudio = null;
const songTasks = new Map();
let songTaskSerial = 0;
let currentSongMode = "full";

document.addEventListener("submit", (event) => {
  if (event.target === songForm) {
    event.preventDefault();
    event.stopPropagation();
  }
}, true);

function setRunStatus(text, type = "") {
  runStatus.textContent = text;
  runStatus.className = `pill ${type}`.trim();
}

function setKeyStatus(hasKey) {
  keyStatus.textContent = hasKey ? "密钥已就绪" : "等待填写 API密钥.txt";
  keyStatus.className = `status ${hasKey ? "ready" : "missing"}`;
}

async function refreshKeyStatus() {
  try {
    const response = await fetch(`${apiBase}/api/key-status`);
    const data = await response.json();
    setKeyStatus(Boolean(data.hasKey));
  } catch {
    keyStatus.textContent = "本地服务未连接";
    keyStatus.className = "status missing";
  }
}

async function prewarmSongEngine() {
  try {
    const response = await fetch(`${apiBase}/api/prewarm-song-engine`, { method: "POST" });
    const data = await response.json();
    if (data.status === "prewarming") {
      setSongStatus("成曲引擎预热中", "ready");
      setSongProgress("正在后台预热成曲主模型", 18);
      showSongMessage("成曲引擎正在后台预热。你可以先上传参考音频和填写歌词，预热完成后生成会更快。");
    } else if (data.status === "engine-starting") {
      setSongStatus("成曲引擎启动中", "ready");
      setSongProgress("正在启动成曲引擎", 10);
    }
  } catch {
    // Prewarm is best-effort; normal generation can still start it.
  }
}

function showMessage(text, type = "") {
  message.textContent = text;
  message.className = `message ${type}`.trim();
}

function showSongMessage(text, type = "") {
  songMessage.textContent = text;
  songMessage.className = `message ${type}`.trim();
}

function getReferenceImages() {
  const urlReferences = document
    .querySelector("#references")
    .value.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);

  return [...uploadedAssets.map((asset) => asset.dataUrl), ...urlReferences].slice(0, 8);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`${file.name} 读取失败`));
    reader.readAsDataURL(file);
  });
}

function getFileExtension(name = "") {
  const cleanName = String(name).toLowerCase().split("?")[0];
  const index = cleanName.lastIndexOf(".");
  return index >= 0 ? cleanName.slice(index) : "";
}

function getMediaKind(file) {
  const type = file.type || "";
  const ext = getFileExtension(file.name);
  if (type.startsWith("audio/") || audioExts.includes(ext)) return "audio";
  if (type.startsWith("video/") || videoExts.includes(ext)) return "video";
  return "";
}

function setReferenceNotice(title, text, type = "pending") {
  audioPreview.innerHTML = "";
  const card = document.createElement("div");
  card.className = `referenceReady reference${type[0].toUpperCase()}${type.slice(1)}`;
  const heading = document.createElement("strong");
  heading.textContent = title;
  const body = document.createElement("p");
  body.textContent = text;
  card.append(heading, body);
  audioPreview.append(card);
}

async function saveReferenceAudio(dataUrl, name) {
  const response = await fetch(`${apiBase}/api/save-reference-audio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audio: dataUrl, name })
  });
  const data = await response.json();
  songRawOutput.textContent = JSON.stringify(data, null, 2);
  if (!response.ok) throw new Error(data.error || "参考音频保存失败");
  return data;
}

function saveReferenceAudioWithTimeout(dataUrl, name, timeoutMs = 20000) {
  return Promise.race([
    saveReferenceAudio(dataUrl, name),
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error("参考音频后台保存超时，但已保留在页面，可继续提交生成。")), timeoutMs);
    })
  ]);
}

function setSongStatus(text, type = "") {
  songStatus.textContent = text;
  songStatus.className = `status ${type}`.trim();
}

function setSongProgress(text, percent = 0, taskId = "") {
  songProgressText.textContent = text;
  songTaskId.textContent = taskId ? `任务：${taskId}` : "";
  songProgressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function getSongTaskTitle(preview) {
  return preview ? "试听小样" : "完整成曲";
}

function createSongTaskCard(preview, payload) {
  const localId = `song-task-${Date.now()}-${songTaskSerial += 1}`;
  if (!songOutput.classList.contains("songTaskList")) {
    songOutput.className = "songOutput songTaskList";
    songOutput.innerHTML = "";
  }

  const card = document.createElement("article");
  card.className = "songTask isRunning";
  card.dataset.localId = localId;

  const header = document.createElement("div");
  header.className = "songTaskHeader";

  const titleWrap = document.createElement("div");
  const eyebrow = document.createElement("span");
  eyebrow.className = "songTaskEyebrow";
  eyebrow.textContent = getSongTaskTitle(preview);
  const title = document.createElement("strong");
  title.textContent = payload.title?.trim() || `${getSongTaskTitle(preview)} ${songTaskSerial}`;
  titleWrap.append(eyebrow, title);

  const status = document.createElement("span");
  status.className = "songTaskStatus";
  status.textContent = "正在提交";

  header.append(titleWrap, status);

  const meta = document.createElement("div");
  meta.className = "songTaskMeta";
  const reference = document.createElement("span");
  reference.textContent = `参考音频：${payload.referenceAudioName || payload.referenceAudioFile || "已提交"}`;
  const lyricState = document.createElement("span");
  lyricState.textContent = payload.lyrics?.trim() ? "新歌词：已提交" : "新歌词：自动创作";
  const createdAt = document.createElement("span");
  createdAt.textContent = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  meta.append(reference, lyricState, createdAt);

  const progress = document.createElement("div");
  progress.className = "songTaskProgress";
  const progressMeta = document.createElement("div");
  progressMeta.className = "progressMeta";
  const progressText = document.createElement("span");
  progressText.textContent = "正在检查材料";
  const taskIdEl = document.createElement("span");
  progressMeta.append(progressText, taskIdEl);
  const track = document.createElement("div");
  track.className = "progressTrack";
  const bar = document.createElement("div");
  bar.className = "progressBar";
  track.append(bar);
  progress.append(progressMeta, track);

  const messageEl = document.createElement("p");
  messageEl.className = "songTaskMessage";
  messageEl.textContent = "任务已加入队列，完成后成品会显示在这张卡片下方。";

  const output = document.createElement("div");
  output.className = "songTaskOutput";

  card.append(header, meta, progress, messageEl, output);
  songOutput.prepend(card);

  const task = {
    localId,
    preview,
    payload,
    card,
    status,
    progressText,
    progressBar: bar,
    taskIdEl,
    messageEl,
    output,
    timer: null,
    retryTimer: null,
    autoRetryCount: 0,
    lastProgressKey: "",
    stalledCount: 0,
    attempts: 0,
    taskId: ""
  };
  songTasks.set(localId, task);
  return task;
}

function setTaskStatus(task, text, type = "running") {
  if (!task) return;
  task.status.textContent = text;
  task.card.classList.toggle("isRunning", type === "running");
  task.card.classList.toggle("isDone", type === "done");
  task.card.classList.toggle("isError", type === "error");
}

function setTaskProgress(task, text, percent = 0, taskId = "") {
  if (!task) return;
  const clamped = Math.max(0, Math.min(100, percent));
  task.progressText.textContent = text;
  task.taskIdEl.textContent = taskId ? `任务：${taskId}` : "";
  task.progressBar.style.width = `${clamped}%`;
  task.messageEl.textContent = text;
  if (songTasks.size <= 1 || task.card === songOutput.firstElementChild) {
    setSongProgress(text, clamped, taskId);
  }
}

function clearSongTaskTimers(task) {
  if (!task) return;
  if (task.timer) window.clearInterval(task.timer);
  if (task.retryTimer) window.clearTimeout(task.retryTimer);
  task.timer = null;
  task.retryTimer = null;
}

function renderInstantPreviewPlaceholder(task) {
  if (!task?.preview || !referenceAudio) return;
  const url = referenceAudio.saved?.url || referenceAudio.previewUrl || referenceAudio.dataUrl;
  if (!url) return;

  task.output.innerHTML = "";
  const heading = document.createElement("div");
  heading.className = "songOutputHeading";
  heading.textContent = "先播放参考音频确认；AI 小样正在后台生成";

  const wrap = document.createElement("div");
  wrap.className = "songCard songCardPending";
  const audio = document.createElement("audio");
  audio.controls = true;
  audio.preload = "metadata";
  audio.src = url;
  const meta = document.createElement("span");
  meta.textContent = referenceAudio.name || "参考音频";
  wrap.append(audio, meta);
  task.output.append(heading, wrap);
}

function waitForMusicEngineAndRetry(preview = currentSongMode === "preview", task = null) {
  let attempts = 0;
  const check = async () => {
    attempts += 1;
    try {
      const response = await fetch(`${apiBase}/api/music-engine-status`);
      const data = await response.json();
      if (data.ready) {
        setSongProgress("成曲引擎已就绪，正在自动提交", 12, task?.taskId || "");
        if (task) setTaskProgress(task, "成曲引擎已就绪，正在自动提交", 12, task.taskId);
        showSongMessage("本地成曲引擎已就绪，正在自动继续生成。", "success");
        if (task) task.retryTimer = null;
        submitSong(preview, true, task);
        return;
      }

      const percent = Math.min(35, 8 + attempts * 2);
      setSongProgress(data.progress?.text || "成曲引擎准备中，完成后自动继续", data.progress?.percent || percent);
      if (task) setTaskProgress(task, data.progress?.text || "成曲引擎准备中，完成后自动继续", data.progress?.percent || percent, task.taskId);
      setSongStatus("成曲引擎准备中", "ready");
      if (task) task.retryTimer = window.setTimeout(check, 15000);
    } catch {
      setSongProgress("正在等待成曲引擎连接", Math.min(30, 8 + attempts * 2));
      if (task) setTaskProgress(task, "正在等待成曲引擎连接", Math.min(30, 8 + attempts * 2), task.taskId);
      if (task) task.retryTimer = window.setTimeout(check, 15000);
    }
  };

  if (task) task.retryTimer = window.setTimeout(check, 15000);
  else window.setTimeout(check, 15000);
}

async function autoDiagnoseSongFailure(errorText, retryAction, task = null) {
  if (task) task.autoRetryCount += 1;
  const retryCount = task ? task.autoRetryCount : 1;
  if (retryCount > 3) {
    setSongStatus("自动处理已暂停", "missing");
    setSongProgress("已连续自检 3 次，请换一个更清晰的参考音频后再试", 100);
    if (task) {
      setTaskStatus(task, "需要处理", "error");
      setTaskProgress(task, "已连续自检 3 次，请换一个更清晰的参考音频后再试", 100, task.taskId);
    }
    showSongMessage("网站已自动尝试 3 次仍未完成。请换一段更短、更清晰的 MP3/WAV 参考音频，再重新生成。", "error");
    return true;
  }
  setSongStatus("保成曲模式运行中", "ready");
  setSongProgress("正在自检并尝试修复", 18);
  if (task) {
    setTaskStatus(task, "自动修复中", "running");
    setTaskProgress(task, `正在自检并尝试修复，第 ${retryCount} 次`, 18, task.taskId);
  }
  showSongMessage(`成曲遇到临时阻碍，网站正在自动检查并处理，第 ${retryCount} 次自动续跑。`);

  try {
    const response = await fetch(`${apiBase}/api/diagnose-song`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: errorText })
    });
    const data = await response.json();
    songRawOutput.textContent = JSON.stringify(data, null, 2);

    if (data.progress?.text) {
      setSongProgress(data.progress.text, data.progress.percent || 20);
      if (task) setTaskProgress(task, data.progress.text, data.progress.percent || 20, task.taskId);
    }
    showSongMessage(data.message || "已完成自检，网站会继续尝试完成成曲。");

    if (data.retryAfterMs) {
      if (task?.retryTimer) window.clearTimeout(task.retryTimer);
      setSongStatus("自动等待后继续", "ready");
      if (task) setTaskStatus(task, "等待自动续跑", "running");
      const retryTimer = window.setTimeout(() => {
        if (task) task.retryTimer = null;
        retryAction();
      }, data.retryAfterMs);
      if (task) task.retryTimer = retryTimer;
      return true;
    }

    if (data.canRetry === false) {
      setSongStatus("需要更换参考音频", "missing");
      if (task) setTaskStatus(task, "需要更换参考音频", "error");
      return true;
    }
  } catch {
    showSongMessage("自检请求暂时没有成功，网站会稍后继续自动尝试。");
    if (task?.retryTimer) window.clearTimeout(task.retryTimer);
    const retryTimer = window.setTimeout(() => {
      if (task) task.retryTimer = null;
      retryAction();
    }, 30000);
    if (task) task.retryTimer = retryTimer;
    return true;
  }

  return false;
}

function buildSongPayload(preview = false) {
  const lyrics = lyricsInput.value.trim();
  if (!referenceAudio) {
    throw new Error("请先上传参考音频。这个模式必须有参考音频，才能保持原曲效果。");
  }
  return {
    title: songTitle.value,
    lyrics,
    style: "严格按参考音频，只改歌词",
    theme: songTheme.value,
    referenceAudio: referenceAudio?.saved ? "" : referenceAudio?.dataUrl || "",
    referenceAudioId: referenceAudio?.saved?.id || "",
    referenceAudioFile: referenceAudio?.saved?.filename || "",
    referenceAudioName: referenceAudio?.name || "",
    preview
  };
}

function getMissingSongInputMessage() {
  const lyrics = lyricsInput.value.trim();
  if (!referenceAudio && !lyrics) return "请先提交参考音频。新歌词可不填，网站会自动创作。";
  if (!referenceAudio) return "请先提交参考音频。上传成功后，下面会显示播放器和文件名。";
  return "";
}

async function ensureLyricsBeforeSong() {
  if (lyricsInput.value.trim()) return true;
  setSongStatus("正在自动创作新歌词", "ready");
  setSongProgress("已收到参考音频，正在自动写新歌词", 4);
  showSongMessage("你没有填写新歌词，网站正在自动创作一份可唱歌词，然后继续成曲。");

  const response = await fetch(`${apiBase}/api/adapt-lyrics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lyrics: "",
      style: "严格按参考音频，只改歌词",
      theme: songTheme.value,
      referenceAudioName: referenceAudio?.name || ""
    })
  });
  const data = await response.json();
  songRawOutput.textContent = JSON.stringify(data, null, 2);
  if (!response.ok) throw new Error(data.error || "自动创作歌词失败");
  lyricsInput.value = data.adaptedLyrics || "";
  if (!lyricsInput.value.trim()) throw new Error("自动创作歌词没有返回内容，请稍后再试。");
  showSongMessage("新歌词已自动生成，正在继续提交成曲。", "success");
  return true;
}

async function ensureReferenceBeforeSong() {
  if (referenceAudio) return true;
  const pendingFile = audioFile.files?.[0];
  if (pendingFile) {
    setSongStatus("正在确认参考音频", "ready");
    setSongProgress("正在保存已选择的参考音频", 3);
    await acceptReferenceFile(pendingFile, "上传音频");
  }
  return Boolean(referenceAudio);
}

async function submitSong(preview = false, autoRetry = false, task = null) {
  currentSongMode = preview ? "preview" : "full";
  setSongStatus(preview ? "试听按钮已触发" : "成曲按钮已触发", "ready");
  setSongProgress("正在检查参考音频和歌词", 2);
  if (task) {
    clearSongTaskTimers(task);
    task.lastProgressKey = "";
    task.stalledCount = 0;
    task.attempts = 0;
    setTaskStatus(task, "重新提交中", "running");
    setTaskProgress(task, "正在重新提交任务", 5, task.taskId);
  }

  try {
    await ensureReferenceBeforeSong();
  } catch (error) {
    showSongMessage(error.message, "error");
    setSongStatus("参考音频未保存", "missing");
    setSongProgress("请重新选择参考音频", 0);
    return;
  }

  const missingInput = getMissingSongInputMessage();
  if (missingInput) {
    setSongStatus("等待材料补齐", "missing");
    setSongProgress("请先补齐参考音频和新歌词", 0);
    showSongMessage(missingInput, "error");
    return;
  }

  try {
    await ensureLyricsBeforeSong();
  } catch (error) {
    showSongMessage(error.message, "error");
    setSongStatus("自动写词需处理", "missing");
    setSongProgress("自动写词未完成", 0);
    return;
  }

  const payload = task?.payload || buildSongPayload(preview);
  if (!task) {
    task = createSongTaskCard(preview, payload);
  } else {
    task.preview = preview;
    task.payload = payload;
  }

  setSongStatus(preview ? "正在生成极速试听" : "保成曲模式生成中", "ready");
  setSongProgress(preview ? "正在提交极速试听任务" : "正在提交完整成曲任务", 5);
  setTaskStatus(task, "提交中", "running");
  setTaskProgress(task, preview ? "正在提交极速试听任务" : "正在提交完整成曲任务", 5, task.taskId);
  if (preview) renderInstantPreviewPlaceholder(task);
  showSongMessage(lyricsInput.value.trim()
    ? (preview ? "正在按当前新歌词提交试听小样，不会自动改写。" : "正在按当前新歌词提交完整成曲，不会自动改写。")
    : "未填写新歌词，正在自动创作歌词后继续成曲。");

  try {
    const response = await fetch(`${apiBase}/api/create-song`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    songRawOutput.textContent = JSON.stringify(data, null, 2);

    if (response.status === 202 || data.status === "engine-starting") {
      setSongStatus("成曲引擎启动中", "ready");
      setSongProgress(data.progress?.text || "正在启动本地成曲引擎", data.progress?.percent || 8);
      setTaskStatus(task, "等待引擎", "running");
      setTaskProgress(
        task,
        data.progress?.text
          ? `${data.progress.text}。本任务会在引擎就绪后自动继续。`
          : "成曲引擎准备好后，本任务会自动继续。",
        data.progress?.percent || 8,
        task.taskId
      );
      showSongMessage(data.message || "本地成曲引擎正在自动启动，请稍等。准备好后页面会自动继续。");
      waitForMusicEngineAndRetry(preview, task);
      return;
    }

    if (!response.ok) throw new Error(data.error || "歌曲生成失败");
    if (!data.taskId) throw new Error("成曲任务还没有拿到任务编号，请稍等后再试。");

    task.taskId = data.taskId;
    setSongProgress(preview ? "极速试听已优先提交，正在生成" : "任务已提交，正在排队/生成", 12, data.taskId);
    setTaskStatus(task, "生成中", "running");
    setTaskProgress(task, preview ? "极速试听已优先提交，正在生成" : "任务已提交，正在排队/生成", 12, data.taskId);
    showSongMessage(preview ? "极速试听正在生成。完成后会自动显示播放器。" : "任务已提交，正在生成。完成后会自动显示试听和下载。", "success");
    pollSongStatus(task);
  } catch (error) {
    const handled = await autoDiagnoseSongFailure(error.message, () => submitSong(preview, true, task), task);
    if (!handled) {
      showSongMessage("这次生成遇到阻碍，网站会继续保持可用。请检查参考音频和歌词是否完整。", "error");
      setSongStatus(preview ? "试听需处理" : "成曲需处理", "missing");
      setSongProgress("等待处理", 100);
      setTaskStatus(task, "需要处理", "error");
      setTaskProgress(task, "等待处理", 100, task.taskId);
    }
  }
}

window.submitSong = submitSong;
window.addEventListener("click", (event) => {
  const button = event.target.closest("#previewSongButton, #createSongButton");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  submitSong(button.id === "previewSongButton");
}, true);

function setReferenceAudio({ name, dataUrl, previewUrl = "", type = "audio/mpeg", sourceLabel = "参考音频", saved = null, saveState = "" }) {
  referenceAudio = { name, type, dataUrl, previewUrl, sourceLabel, saved };
  audioPreview.innerHTML = "";

  const card = document.createElement("div");
  card.className = "referenceReady";

  const top = document.createElement("div");
  top.className = "referenceReadyTop";

  const state = document.createElement("strong");
  state.textContent = saved ? "参考音频已保存，可用于成曲" : "参考音频已显示，可先确认";

  const source = document.createElement("span");
  source.textContent = sourceLabel;

  top.append(state, source);

  const audio = document.createElement("audio");
  audio.controls = true;
  audio.preload = "metadata";
  audio.src = saved?.url || previewUrl || dataUrl;

  const fileName = document.createElement("span");
  fileName.className = "referenceFileName";
  fileName.textContent = name;

  const note = document.createElement("p");
  note.textContent = saved
    ? "这段参考音频已保存到本地服务，试听小样和完整成曲都会按它作为参考。"
    : (saveState || "播放器已显示，后台保存完成后即可直接成曲。");

  card.append(top, audio, fileName, note);
  audioPreview.append(card);
  setSongStatus("参考音频已就绪", "ready");
}

function renderAssetPreview() {
  assetPreview.innerHTML = "";
  assetPreview.style.display = uploadedAssets.length ? "grid" : "none";

  uploadedAssets.forEach((asset, index) => {
    const item = document.createElement("div");
    item.className = "assetItem";

    const img = document.createElement("img");
    img.src = asset.dataUrl;
    img.alt = asset.name;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "移除";
    remove.addEventListener("click", () => {
      uploadedAssets = uploadedAssets.filter((_, assetIndex) => assetIndex !== index);
      renderAssetPreview();
      showMessage(uploadedAssets.length ? `已保留 ${uploadedAssets.length} 张参考素材。` : "");
    });

    item.append(img, remove);
    assetPreview.appendChild(item);
  });
}

function renderImages(images) {
  emptyState.style.display = images.length ? "none" : "grid";
  gallery.innerHTML = "";

  for (const image of images) {
    const card = document.createElement("article");
    card.className = "imageCard";

    const frame = document.createElement("div");
    frame.className = "imageFrame";

    const img = document.createElement("img");
    img.src = image.url;
    img.alt = "生成图片";
    img.loading = "lazy";
    frame.appendChild(img);

    const meta = document.createElement("div");
    meta.className = "imageMeta";

    const task = document.createElement("span");
    task.textContent = image.taskId || "completed";

    const link = document.createElement("a");
    link.href = image.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "打开";

    meta.append(task, link);
    card.append(frame, meta);
    gallery.appendChild(card);
  }
}

function collectPayload() {
  return {
    prompt: document.querySelector("#prompt").value,
    model: document.querySelector("#model").value,
    n: Number(document.querySelector("#count").value || 1),
    aspect_ratio: document.querySelector("#aspectRatio").value,
    size: document.querySelector("#size").value,
    quality: document.querySelector("#quality").value,
    reference_images: getReferenceImages()
  };
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  setRunStatus("生成中", "busy");
  showMessage("正在提交任务并等待图片完成，请不要关闭页面。");
  rawOutput.textContent = "{}";

  try {
    const response = await fetch(`${apiBase}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(collectPayload())
    });
    const data = await response.json();
    rawOutput.textContent = JSON.stringify(data, null, 2);

    if (!response.ok) throw new Error(data.error || "生成失败");

    renderImages(data.images || []);
    setRunStatus("已完成", "done");
    showMessage(`生成完成，共 ${data.images?.length || 0} 张。`, "success");
  } catch (error) {
    setRunStatus("出错了", "error");
    showMessage(error.message, "error");
    rawOutput.textContent = JSON.stringify({ error: error.message }, null, 2);
  } finally {
    submitButton.disabled = false;
    refreshKeyStatus();
  }
});

clearButton.addEventListener("click", () => {
  renderImages([]);
  rawOutput.textContent = "{}";
  setRunStatus("待生成");
  showMessage("");
});

assetFiles.addEventListener("change", async () => {
  const files = Array.from(assetFiles.files || []);
  const imageFiles = files.filter((file) => file.type.startsWith("image/"));
  const room = Math.max(0, 8 - uploadedAssets.length);
  const selected = imageFiles.slice(0, room);

  if (!selected.length) {
    showMessage("请选择图片素材，支持 JPG、PNG、WebP、GIF。", "error");
    assetFiles.value = "";
    return;
  }

  try {
    const assets = await Promise.all(
      selected.map(async (file) => ({
        name: file.name,
        dataUrl: await readFileAsDataUrl(file)
      }))
    );

    uploadedAssets = [...uploadedAssets, ...assets].slice(0, 8);
    renderAssetPreview();
    showMessage(`已加入 ${uploadedAssets.length} 张参考素材，生成时会结合提示词一起使用。`, "success");
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    assetFiles.value = "";
  }
});

quickPrompts.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-prompt]");
  if (!button) return;

  const prompt = document.querySelector("#prompt");
  const addition = button.dataset.prompt;
  prompt.value = prompt.value.trim() ? `${prompt.value.trim()}，${addition}` : addition;
  prompt.focus();
});

async function acceptReferenceFile(file, sourceLabel = "上传音频") {
  if (!file) return;
  const mediaKind = getMediaKind(file);

  setSongStatus("正在读取参考素材", "ready");
  showSongMessage(`正在读取：${file.name}`);
  setReferenceNotice("已选中参考音频", `文件名：${file.name}。播放器已显示，正在后台保存。`, "pending");

  if (!mediaKind) {
    setReferenceNotice("参考音频未接收", "请选择常见音频或视频文件，例如 MP3/WAV/M4A/MP4/MOV。", "error");
    showSongMessage("请选择常见音频或视频文件，例如 MP3/WAV/M4A/MP4/MOV。", "error");
    return;
  }

  if (file.size > 90 * 1024 * 1024) {
    setReferenceNotice("文件太大", "建议压缩到 90MB 以内，或使用视频链接提取。", "error");
    showSongMessage("文件偏大，建议压缩到 90MB 以内，或使用视频链接提取。", "error");
    return;
  }

  try {
    const instantUrl = URL.createObjectURL(file);
    if (mediaKind === "audio") {
      const dataUrl = await readFileAsDataUrl(file);
      setReferenceAudio({ name: file.name, type: file.type || "audio/mpeg", dataUrl, previewUrl: instantUrl, sourceLabel, saveState: "播放器已立即显示，正在后台保存。" });
      showSongMessage("参考音频已加入，播放器已显示，保存在后台进行。", "success");
      void saveReferenceAudioWithTimeout(dataUrl, file.name)
        .then((saved) => {
          setReferenceAudio({ name: file.name, type: file.type || saved.mimeType || "audio/mpeg", dataUrl, previewUrl: instantUrl, sourceLabel, saved });
        })
        .catch((error) => {
          setReferenceAudio({ name: file.name, type: file.type || "audio/mpeg", dataUrl, previewUrl: instantUrl, sourceLabel, saveState: "后台保存暂未完成，生成时会直接提交当前页面里的参考音频。" });
          showSongMessage(error.message, "error");
        });
    } else {
      setSongStatus("正在从视频提取音频", "ready");
      showSongMessage("正在从上传的视频文件中提取参考音频。");
      setReferenceNotice("正在从视频提取音频", `文件：${file.name}`, "pending");
      const dataUrl = await readFileAsDataUrl(file);
      const response = await fetch(`${apiBase}/api/extract-audio-from-upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, file: dataUrl })
      });
      const result = await response.json();
      songRawOutput.textContent = JSON.stringify(result, null, 2);
      if (!response.ok) throw new Error(result.error || "视频音频提取失败");
      setReferenceAudio({ name: result.name, type: "audio/mpeg", dataUrl: result.audio, sourceLabel: "视频文件提取", saveState: "播放器已显示，正在后台保存。" });
      showSongMessage("已从视频文件中提取出参考音频，播放器已显示，保存在后台进行。", "success");
      void saveReferenceAudioWithTimeout(result.audio, result.name)
        .then((saved) => {
          setReferenceAudio({ name: result.name, type: saved.mimeType || "audio/mpeg", dataUrl: result.audio, sourceLabel: "视频文件提取", saved });
        })
        .catch((error) => {
          setReferenceAudio({ name: result.name, type: "audio/mpeg", dataUrl: result.audio, sourceLabel: "视频文件提取", saveState: "后台保存暂未完成，生成时会直接提交当前页面里的参考音频。" });
          showSongMessage(error.message, "error");
        });
    }
  } catch (error) {
    setReferenceNotice("参考音频接收失败", error.message, "error");
    showSongMessage(error.message, "error");
  }
}

window.acceptReferenceFile = acceptReferenceFile;

audioPreview.addEventListener("click", (event) => {
  if (event.target.closest("audio, button, a, input")) return;
  audioFile.click();
});

audioPreview.addEventListener("dragover", (event) => {
  event.preventDefault();
  audioPreview.classList.add("isDragging");
  setReferenceNotice("松开即可提交参考音频", "支持音频文件，也支持视频自动提取音频。", "pending");
});

audioPreview.addEventListener("dragleave", () => {
  audioPreview.classList.remove("isDragging");
});

audioPreview.addEventListener("drop", async (event) => {
  event.preventDefault();
  audioPreview.classList.remove("isDragging");
  await acceptReferenceFile(event.dataTransfer?.files?.[0], "拖入文件");
});

document.addEventListener("paste", async (event) => {
  const file = Array.from(event.clipboardData?.files || []).find((item) => getMediaKind(item));
  if (!file) return;
  event.preventDefault();
  await acceptReferenceFile(file, "粘贴文件");
});

extractUrlButton.addEventListener("click", async () => {
  const url = videoUrl.value.trim();
  if (!url) {
    showSongMessage("请先粘贴视频链接。", "error");
    return;
  }

  extractUrlButton.disabled = true;
  setSongStatus("正在解析视频链接", "ready");
  showSongMessage("正在尝试从视频链接提取音频。公开视频通常更容易成功。");

  try {
    const response = await fetch(`${apiBase}/api/extract-audio-from-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });
    const result = await response.json();
    songRawOutput.textContent = JSON.stringify(result, null, 2);
    if (!response.ok) throw new Error(result.error || "链接音频提取失败");
    setReferenceNotice("正在保存提取出的参考音频", `文件：${result.name}`, "pending");
    const saved = await saveReferenceAudio(result.audio, result.name);
    setReferenceAudio({ name: result.name, type: saved.mimeType || "audio/mpeg", dataUrl: result.audio, sourceLabel: "视频链接提取", saved });
    showSongMessage("已从视频链接提取参考音频。", "success");
  } catch (error) {
    showSongMessage(error.message, "error");
  } finally {
    extractUrlButton.disabled = false;
  }
});

adaptLyricsButton.addEventListener("click", async () => {
  adaptLyricsButton.disabled = true;
  setSongStatus("正在改编歌词", "ready");
  showSongMessage("正在按你的要求润色歌词。这个功能是可选的，不会自动触发。");

  try {
    const response = await fetch(`${apiBase}/api/adapt-lyrics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lyrics: lyricsInput.value,
        style: "严格按参考音频，只改歌词",
        theme: songTheme.value,
        referenceAudioName: referenceAudio?.name || ""
      })
    });
    const data = await response.json();
    songRawOutput.textContent = JSON.stringify(data, null, 2);

    if (!response.ok) throw new Error(data.error || "歌词改编失败");

    lyricsInput.value = data.adaptedLyrics || lyricsInput.value;
    showSongMessage("歌词已改写，并已放回新歌词框。现在可以直接试听或生成完整新曲。", "success");
    setSongStatus("歌词已改编", "ready");
  } catch (error) {
    showSongMessage(error.message, "error");
    setSongStatus("改编失败", "missing");
  } finally {
    adaptLyricsButton.disabled = false;
  }
});

songForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  event.stopPropagation();
  submitSong(false);
}, true);

async function pollSongStatus(task) {
  const taskId = task.taskId;
  const preview = task.preview;
  const scheduleNext = () => {
    if (!task.timer) {
      task.timer = window.setTimeout(tick, 5000);
    }
  };
  const tick = async () => {
    task.timer = null;
    task.attempts += 1;
    const softProgress = Math.min(92, 12 + task.attempts * 4);

    try {
      const response = await fetch(`${apiBase}/api/song-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId })
      });
      const data = await response.json();
      songRawOutput.textContent = JSON.stringify(data, null, 2);

      if (!response.ok) throw new Error(data.error || "查询成曲进度失败");

      if (data.status === "completed") {
        clearSongTaskTimers(task);
        renderSongs(data, preview, task);
        setSongProgress(preview ? "试听小样完成" : "成曲完成", 100, taskId);
        setTaskProgress(task, preview ? "试听小样完成" : "成曲完成", 100, taskId);
        setSongStatus(preview ? "试听完成" : "成曲完成", "ready");
        setTaskStatus(task, preview ? "试听完成" : "成曲完成", "done");
        showSongMessage(preview ? "试听小样完成，满意后可以生成完整新曲。" : "歌曲生成完成，可以试听或下载。", "success");
        return false;
      }

      if (data.status === "failed") {
        clearSongTaskTimers(task);
        const handled = await autoDiagnoseSongFailure(data.error || "成曲遇到阻碍", () => submitSong(preview, true, task), task);
        if (handled) return false;
        throw new Error(data.error || "成曲遇到阻碍");
      }

      const stageText = data.stage || data.progressText || "";
      const progressText = data.queuePosition
        ? `排队中，第 ${data.queuePosition} 位`
        : (stageText ? `正在生成成曲：${stageText}` : "正在生成成曲");
      setSongProgress(progressText, data.progress ?? softProgress, taskId);
      setTaskStatus(task, data.queuePosition ? "排队中" : "生成中", "running");
      setTaskProgress(task, progressText, data.progress ?? softProgress, taskId);
      setSongStatus("正在生成", "ready");

      const normalizedStage = String(data.stage || data.progressText || "").toLowerCase();
      const canTreatAsStalled = !data.queuePosition
        && (data.progress ?? softProgress) >= 20
        && !/等待|启动|准备|排队|提交|queued|starting|loading|preparing/.test(normalizedStage);
      const progressKey = `${data.progress ?? ""}|${data.stage || ""}|${data.queuePosition ?? ""}`;
      if (canTreatAsStalled && progressKey === task.lastProgressKey) {
        task.stalledCount += 1;
      } else {
        task.lastProgressKey = progressKey;
        task.stalledCount = 0;
      }

      const stallLimit = preview ? 120 : 180;
      if (task.stalledCount >= stallLimit) {
        clearSongTaskTimers(task);
        const handled = await autoDiagnoseSongFailure(
          `成曲进度长时间停在：${progressText}`,
          () => submitSong(preview, true, task),
          task
        );
        return !handled;
      }
      scheduleNext();
      return true;
    } catch (error) {
      clearSongTaskTimers(task);
      const handled = await autoDiagnoseSongFailure(error.message, () => submitSong(preview, true, task), task);
      if (!handled) {
        showSongMessage("这次生成遇到阻碍，网站会继续保持可用。请检查参考音频和歌词是否完整。", "error");
        setSongStatus(preview ? "试听需处理" : "成曲需处理", "missing");
        setSongProgress("等待处理", 100, taskId);
        setTaskStatus(task, "需要处理", "error");
        setTaskProgress(task, "等待处理", 100, taskId);
      }
      return false;
    }
  };

  const shouldKeepPolling = await tick();
  if (shouldKeepPolling && !task.timer) {
    scheduleNext();
  }
}

function renderSongs(data, preview = false, task = null) {
  const songs = data.saved?.length ? data.saved : (data.songs || []).map((url, index) => ({ url, filename: `song-${index + 1}.mp3` }));
  const target = task?.output || songOutput;
  target.innerHTML = "";
  songOutputDir.textContent = data.outputDir ? `本地保存文件夹：${data.outputDir}` : "";

  if (!songs.length) {
    target.textContent = "成曲已完成，但没有识别到音频文件，请查看接口返回。";
    return;
  }

  const heading = document.createElement("div");
  heading.className = "songOutputHeading";
  heading.textContent = preview ? "试听小样已生成，可直接播放确认" : "完整新曲已生成，可直接播放或下载";
  target.appendChild(heading);

  songs.forEach((song) => {
    const url = song.url;
    const wrap = document.createElement("div");
    wrap.className = "songCard";
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.src = url;
    const meta = document.createElement("span");
    meta.textContent = song.path || song.filename || "生成歌曲";
    const download = document.createElement("a");
    download.href = url;
    download.download = song.filename || "song.mp3";
    download.textContent = "下载";
    wrap.append(audio, meta, download);
    target.appendChild(wrap);
  });
}

refreshKeyStatus();
prewarmSongEngine();
setInterval(refreshKeyStatus, 5000);
