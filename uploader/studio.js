// 맨티스 릴스 만들기 탭
// 원본 영상을 studio/작업이름/ 에 커밋 → reel-studio.yml 이 자막(subs.json)·완성본(reel.mp4)을 만든다.
// 완성되면 '이 영상으로 예약'으로 새 게시물(릴스) 화면에 넘긴다.
(() => {
  const A = window.MENTIS_APP, CFG = window.MENTIS;
  const $ = (id) => document.getElementById(id);
  const esc = A.esc;
  const RAW_MAX_MB = 95;
  const STYLES = {
    overseas: { label: "해외 소스 · 세르칸", lang: "en", audio: "original", music: "none",
      hint: "허락받은 해외 영상. 위쪽에 훅 문구 고정 + 영어 대사를 한국어 자막으로 번역 + 원작자 크레딧." },
    format: { label: "B 포맷", lang: "none", audio: "mute", music: "random",
      hint: "랭킹·비포애프터·단계별 포맷. 위쪽 제목 띠 + 장면마다 바뀌는 #1 #2 #3 단계 문구 + 배경음." },
    shoot: { label: "C 촬영용", lang: "ko", audio: "original", music: "none",
      hint: "직접 찍은 영상. 로고 + 자막만 깔끔하게. 소리는 원본 / 소리 없이 자막만 / 따로 녹음한 음성 중에서 골라요." },
  };
  const STATE = {
    "subs:queued": "⏳ 자막 만드는 중… (보통 3~8분)", "subs:done": "✏️ 자막 확인 필요", "subs:error": "✗ 자막 만들기 실패",
    "render:queued": "⏳ 릴스 만드는 중… (보통 2~5분)", "render:done": "✓ 완성", "render:error": "✗ 릴스 완성 실패",
  };

  let style = "overseas", raw = null, voice = null;
  let job = null, jobData = null, subs = null, status = null;
  let poll = null;

  const now = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 19) + "+09:00";
  const ext = (f) => f.name.split(".").pop().toLowerCase();
  const stateOf = (s) => (s ? STATE[`${s.step}:${s.state}`] || s.state : "준비 중");

  // ---------- 목록 ----------
  async function refresh() {
    const jobs = A.jobs();
    const rows = await Promise.all(jobs.map(async (j) => {
      const [s, d] = await Promise.all([A.readJson(j, "status.json").catch(() => null), A.readJson(j, "job.json").catch(() => null)]);
      return { j, s, d };
    }));
    $("stJobs").innerHTML = rows.length ? rows.map(({ j, s, d }) => `
      <div class="item click" data-job="${esc(j.name)}">
        <span class="reelthumb">🎬</span>
        <div class="body"><div class="name">${esc(j.name)}</div>
          <div class="sub">${esc(STYLES[d?.style]?.label || "")} · ${esc(stateOf(s))}</div></div>
      </div>`).join("") : `<p class="hint">진행 중인 작업이 없어요. 아래에서 새로 만들어 보세요.</p>`;
    $("stJobs").querySelectorAll("[data-job]").forEach((el) => (el.onclick = () => openJob(el.dataset.job)));
    renderMusic();
    const running = rows.some(({ s }) => s?.state === "queued");
    clearTimeout(poll);
    if (running && !$("tab-studio").hidden) poll = setTimeout(() => A.loadRepo().catch(() => {}), 20000);
    if (job) {
      const fresh = jobs.find((j) => j.name === job.name);
      if (!fresh) closeJob();
      else if (JSON.stringify(fresh.files) !== JSON.stringify(job.files)) openJob(job.name, true);
    }
  }

  function renderMusic() {
    const sel = $("stMusic"), cur = sel.value || STYLES[style].music;
    sel.innerHTML = `<option value="none">없음</option><option value="random">맨티스 배경음 중 랜덤</option>` +
      A.musicTracks().map((t) => `<option value="${esc(t)}">${esc(t.replace(/\.mp3$/i, ""))}</option>`).join("");
    sel.value = [...sel.options].some((o) => o.value === cur) ? cur : "none";
  }

  // ---------- 새 작업 ----------
  function showFor(root, key) {
    root.querySelectorAll("[data-for]").forEach((el) => (el.hidden = !el.dataset.for.split(" ").includes(key)));
  }

  function setStyle(s) {
    style = s;
    document.querySelectorAll("#stStyle button").forEach((b) => b.classList.toggle("on", b.dataset.style === s));
    $("stStyleHint").textContent = STYLES[s].hint;
    $("stAudio").value = STYLES[s].audio; $("stLang").value = STYLES[s].lang; $("stMusic").value = STYLES[s].music;
    showFor($("stForm"), s);
    checkForm();
  }

  function checkForm() {
    const audio = $("stAudio").value, lang = $("stLang").value;
    $("stVoiceBox").hidden = audio !== "voice";
    const listen = (audio === "original" && lang !== "none") || (audio === "voice" && lang !== "none");
    $("stLinesBox").hidden = listen;
    const w = [];
    if (audio === "mute" && lang !== "none") w.push("소리 없이 만들면 받아쓸 말이 없어요. 자막은 직접 써 주세요.");
    if (raw?.w && raw.w / raw.h > 0.6 && $("stFit").value === "crop") w.push(`가로 영상(${raw.w}×${raw.h})을 꽉 채우면 양옆이 많이 잘려요.`);
    if (raw?.sec > 180) w.push(`영상이 ${Math.round(raw.sec)}초예요. 유튜브 쇼츠는 3분까지만 쇼츠로 올라가요.`);
    $("stWarn").textContent = w.join("\n");
  }

  function mediaBox(box, file, kind, onRemove) {
    if (!file) { box.innerHTML = ""; return; }
    const url = URL.createObjectURL(file);
    box.innerHTML = kind === "video"
      ? `<div class="reel"><video src="${url}" controls muted playsinline></video><div class="meta"><span class="dim"></span><br>${(file.size / 1048576).toFixed(1)}MB · ${esc(file.name)}<br><button class="btn ghost small">빼기</button></div></div>`
      : `<div class="reel"><audio src="${url}" controls></audio><div class="meta">${(file.size / 1048576).toFixed(1)}MB · ${esc(file.name)} <button class="btn ghost small">빼기</button></div></div>`;
    box.querySelector("button").onclick = onRemove;
    if (kind === "video") {
      const v = box.querySelector("video");
      v.onloadedmetadata = () => {
        raw.w = v.videoWidth; raw.h = v.videoHeight; raw.sec = v.duration;
        box.querySelector(".dim").textContent = `${raw.w}×${raw.h} · ${Math.round(raw.sec)}초`;
        checkForm();
      };
    }
  }

  function setRaw(f) {
    if (f && !/^(mp4|mov|m4v)$/.test(ext(f))) return A.toast("mp4·mov 영상만 넣을 수 있어요");
    if (f && f.size > RAW_MAX_MB * 1048576) return A.toast(`영상이 ${RAW_MAX_MB}MB 를 넘어요. 폰에서 '1080p'로 내보내거나 잘라서 줄여 주세요.`, 6000);
    raw = f ? { file: f } : null;
    $("stRawDrop").hidden = !!f;
    mediaBox($("stRawPreview"), f, "video", () => setRaw(null));
    checkForm();
  }

  function setVoice(f) {
    if (f && !/^(m4a|mp3|wav|aac)$/.test(ext(f))) return A.toast("m4a·mp3·wav 음성 파일만 넣을 수 있어요");
    voice = f || null;
    $("stVoiceDrop").hidden = !!f;
    mediaBox($("stVoicePreview"), f, "audio", () => setVoice(null));
  }

  function dropZone(zone, input, onFile) {
    input.onchange = () => { onFile(input.files[0]); input.value = ""; };
    zone.ondragover = (e) => { e.preventDefault(); zone.classList.add("over"); };
    zone.ondragleave = () => zone.classList.remove("over");
    zone.ondrop = (e) => { e.preventDefault(); zone.classList.remove("over"); onFile(e.dataTransfer.files[0]); };
  }

  function resetForm() {
    for (const id of ["stHandle", "stPermission", "stSlug", "stHook", "stTitle", "stSteps", "stLines"]) $(id).value = "";
    for (const id of ["stAllowed", "stOwn", "stBand"]) $(id).checked = false;
    $("stCorner").value = ""; $("stFit").value = "auto";
    setRaw(null); setVoice(null); setStyle("overseas");
    A.setMsg($("stMsg"), "");
  }

  async function dispatch(name, step) {
    await A.gh(`/repos/${CFG.repo}/actions/workflows/reel-studio.yml/dispatches`,
      { method: "POST", body: { ref: CFG.branch, inputs: { job: name, step } } });
  }

  async function start() {
    const err = (t) => A.setMsg($("stMsg"), t, "err");
    const name = A.slugify($("stSlug").value);
    const audio = $("stAudio").value, lang = $("stLang").value;
    const handle = $("stHandle").value.trim().replace(/^([^@])/, "@$1");
    if (!raw) return err("원본 영상을 넣어 주세요.");
    if (style === "overseas") {
      if (!$("stHandle").value.trim()) return err("원작자 계정(@아이디)을 적어 주세요. 크레딧에 들어가요.");
      if (!$("stPermission").value.trim()) return err("허락 메모를 적어 주세요 (언제·어디서 허락받았는지).");
      if (!$("stAllowed").checked) return err("원작자 허락을 받은 영상만 만들 수 있어요. 체크해 주세요.");
    } else if (!$("stOwn").checked) return err("직접 찍었거나 무료 스톡 영상인지 체크해 주세요. 남의 영상은 '해외 소스'로 허락받고 만들어요.");
    if (!name) return err("작업 이름을 적어 주세요.");
    if (A.jobs().some((j) => j.name === name)) return err("같은 이름의 작업이 이미 있어요. 이름을 바꿔 주세요.");
    if (audio === "voice" && !voice) return err("음성 파일을 넣어 주세요.");
    if (!$("stLinesBox").hidden && !$("stLines").value.trim() && !(style === "format" && $("stSteps").value.trim()))
      return err("자막을 직접 써 주세요 (한 줄 = 한 화면).");

    const data = {
      style, corner: $("stCorner").value, fit: $("stFit").value, audio, music: $("stMusic").value,
      lang: $("stLinesBox").hidden ? lang : "none", raw: `raw.${ext(raw.file)}`,
      lines: $("stLinesBox").hidden ? "" : $("stLines").value.trim(), created_at: now(),
    };
    if (style === "overseas") Object.assign(data, { hook: $("stHook").value.trim(), cover_band: $("stBand").checked,
      credit: { handle, permission: $("stPermission").value.trim() } });
    if (style === "format") Object.assign(data, { title: $("stTitle").value.trim(), step_lines: $("stSteps").value.trim() });
    if (voice) data.voice = `voice.${ext(voice)}`;

    const folder = `studio/${name}`;
    const changes = [
      { path: `${folder}/${data.raw}`, file: raw.file },
      { path: `${folder}/job.json`, text: JSON.stringify(data, null, 2) + "\n" },
      { path: `${folder}/status.json`, text: JSON.stringify({ step: "subs", state: "queued", at: now() }) + "\n" },
    ];
    if (voice) changes.splice(1, 0, { path: `${folder}/${data.voice}`, file: voice });
    const btn = $("stStart"); btn.disabled = true;
    try {
      await A.commit(`reel studio: 새 작업 ${name}`, changes, (t) => A.setMsg($("stMsg"), t));
      A.setMsg($("stMsg"), "자막 만들기 시작 중…");
      await dispatch(name, "subs");
      await A.loadRepo();
      resetForm();
      openJob(name);
      A.toast("자막을 만들고 있어요. 3~8분 뒤 이 화면에서 확인해요.", 5000);
    } catch (e) {
      if (e.message !== "401") err(`시작 실패: ${e.message}`);
    } finally { btn.disabled = false; }
  }

  // ---------- 작업 열기 ----------
  async function openJob(name, quiet) {
    const j = A.jobs().find((x) => x.name === name);
    if (!j) return;
    job = j;
    $("stForm").hidden = true; $("stJob").hidden = false;
    $("stJobTitle").textContent = name;
    if (!quiet) A.setMsg($("stJobMsg"), "");
    [status, jobData, subs] = await Promise.all(["status.json", "job.json", "subs.json"].map((f) => A.readJson(j, f).catch(() => null)));
    jobData ||= {};
    const s = status || {};
    const errText = s.state === "error" ? `\n${s.error || ""}` : "";
    const warn = (s.warnings || []).length ? `\n⚠ ${s.warnings.join("\n⚠ ")}` : "";
    A.setMsg($("stState"), `${stateOf(status)}${errText}${warn}`, s.state === "error" ? "err" : s.state === "done" ? "ok" : "");
    const running = s.state === "queued";
    const done = s.step === "render" && s.state === "done" && j.files["reel.mp4"];
    const wasHidden = $("stEdit").hidden;
    $("stDone").hidden = !done;
    $("stEdit").hidden = running || done || !subs;
    if (s.state === "error" && subs) $("stEdit").hidden = false;
    // 오류가 나거나 20분 넘게 그대로면 다시 시도
    const stale = running && Date.now() - new Date(s.at).getTime() > 20 * 60e3;
    $("stRetry").hidden = !(s.state === "error" || stale);
    if (done) {
      $("stReel").src = A.rawUrl(`${j.folder}/reel.mp4`);
      $("stReelMeta").innerHTML = `${s.seconds}초 · ${s.mb}MB${s.music ? `<br>배경음: ${esc(s.music)}` : ""}`;
    }
    if (!$("stEdit").hidden && (!quiet || wasHidden)) renderEditor();
    if (!quiet) $("stJob").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closeJob() {
    job = null; $("stJob").hidden = true; $("stForm").hidden = false;
  }

  // ---------- 자막 고치기 ----------
  const num = (v) => Math.round(Number(v) * 10) / 10;

  function rowsHtml(list, kind) {
    return list.map((s, i) => `<div class="subrow" data-kind="${kind}" data-i="${i}">
      <input type="number" step="0.1" min="0" value="${num(s.start)}" data-k="start" aria-label="시작(초)">
      <input type="number" step="0.1" min="0" value="${num(s.end)}" data-k="end" aria-label="끝(초)">
      <div class="txt"><textarea rows="2" data-k="text">${esc(s.text)}</textarea>${s.src ? `<small>${esc(s.src)}</small>` : ""}</div>
      <button class="btn ghost small" data-del title="빼기">×</button></div>`).join("") || `<p class="hint">없음</p>`;
  }

  function renderEditor() {
    showFor($("stEdit"), jobData.style || "shoot");
    $("edHook").value = subs.hook || ""; $("edTitle").value = subs.title || ""; $("edCredit").value = subs.credit || "";
    $("edSegs").innerHTML = rowsHtml(subs.segments || [], "segments");
    $("edSteps").innerHTML = rowsHtml(subs.steps || [], "steps");
    document.querySelectorAll("#stEdit .subrow").forEach((row) => {
      const list = subs[row.dataset.kind], i = +row.dataset.i;
      row.querySelectorAll("[data-k]").forEach((inp) => (inp.oninput = () => {
        list[i][inp.dataset.k] = inp.dataset.k === "text" ? inp.value : Number(inp.value);
        drawOverlay();
      }));
      row.querySelector("[data-del]").onclick = () => { list.splice(i, 1); renderEditor(); };
      row.querySelector("textarea").onfocus = () => { $("stVideo").currentTime = list[i].start + 0.05; };
    });
    const v = $("stVideo");
    const rawFile = Object.keys(job.files).find((f) => /^raw\./.test(f));
    const src = A.rawUrl(`${job.folder}/${rawFile}`);
    if (v.dataset.src !== src) { v.src = src; v.dataset.src = src; }
    v.style.objectFit = jobData.fit === "blur" ? "contain" : "cover";
    v.ontimeupdate = drawOverlay;
    drawOverlay();
  }

  const fmt = (t) => esc(t).replace(/\*([^*]+)\*/g, "<b>$1</b>").replace(/\n/g, "<br>");

  function drawOverlay() {
    if (!subs) return;
    const t = $("stVideo").currentTime || 0;
    const at = (list) => (list || []).find((s) => s.start <= t && t < s.end)?.text || "";
    const st = jobData.style;
    $("ovHook").innerHTML = st === "overseas" ? fmt($("edHook").value) : st === "format" ? fmt($("edTitle").value) : "";
    $("ovHook").classList.toggle("box", st === "format");
    $("ovSub").innerHTML = fmt(at(subs.segments));
    $("ovSub").classList.toggle("small", st === "format");
    $("ovStep").innerHTML = st === "format" ? fmt(at(subs.steps)) : "";
    $("ovCredit").textContent = st === "overseas" ? $("edCredit").value : "";
  }

  function addRow(kind) {
    const list = (subs[kind] ||= []);
    const t = num($("stVideo").currentTime || (list.at(-1)?.end ?? 0));
    list.push({ start: t, end: num(t + 2.5), text: "" });
    list.sort((a, b) => a.start - b.start);
    renderEditor();
  }

  async function saveAndRender() {
    const err = (t) => A.setMsg($("stJobMsg"), t, "err");
    subs.hook = $("edHook").value.trim(); subs.title = $("edTitle").value.trim(); subs.credit = $("edCredit").value.trim();
    for (const k of ["segments", "steps"]) {
      subs[k] = (subs[k] || []).filter((s) => String(s.text).trim()).sort((a, b) => a.start - b.start);
      if (subs[k].some((s) => !(s.end > s.start))) return err("끝 시간이 시작 시간보다 늦어야 해요.");
    }
    if (jobData.style === "overseas" && !subs.credit) return err("해외 소스 영상은 크레딧을 지울 수 없어요.");
    const btn = $("edRender"); btn.disabled = true;
    try {
      await A.commit(`reel studio: 자막 저장 ${job.name}`, [
        { path: `${job.folder}/subs.json`, text: JSON.stringify(subs, null, 2) + "\n" },
        { path: `${job.folder}/status.json`, text: JSON.stringify({ step: "render", state: "queued", at: now() }) + "\n" },
      ], (t) => A.setMsg($("stJobMsg"), t));
      await dispatch(job.name, "render");
      A.setMsg($("stJobMsg"), "릴스를 만들고 있어요. 2~5분 뒤 이 화면에서 완성본을 확인해요.", "ok");
      await A.loadRepo();
    } catch (e) {
      if (e.message !== "401") err(`실패: ${e.message}`);
    } finally { btn.disabled = false; }
  }

  function schedule() {
    const lines = [];
    if (jobData.style === "overseas" && jobData.credit?.handle) lines.push(`🎥 영상: ${jobData.credit.handle} (원작자 허락 받고 사용)`);
    A.scheduleFromStudio(job, { slug: job.name, caption: lines.length ? `\n\n${lines.join("\n")}` : "" });
    A.toast("날짜·캡션을 넣고 '예약하기'를 누르면 끝이에요. 예약하면 이 작업은 정리돼요.", 5000);
  }

  async function retry() {
    const step = status?.step || "subs";
    try {
      await A.commit(`reel studio: 다시 시도 ${job.name}`, [
        { path: `${job.folder}/status.json`, text: JSON.stringify({ step, state: "queued", at: now() }) + "\n" }]);
      await dispatch(job.name, step);
      A.setMsg($("stJobMsg"), "다시 시작했어요.", "ok");
      await A.loadRepo();
    } catch (e) { if (e.message !== "401") A.setMsg($("stJobMsg"), `실패: ${e.message}`, "err"); }
  }

  async function deleteJob() {
    if (!job || !confirm(`'${job.name}' 작업을 지울까요?\n(원본·자막·완성본이 모두 지워져요)`)) return;
    try {
      await A.commit(`reel studio: 삭제 ${job.name}`, Object.keys(job.files).map((f) => ({ path: `${job.folder}/${f}`, sha: null })));
      closeJob(); await A.loadRepo(); A.toast("지웠어요");
    } catch (e) { if (e.message !== "401") A.toast(`삭제 실패: ${e.message}`, 5000); }
  }

  // ---------- 연결 ----------
  document.querySelectorAll("#stStyle button").forEach((b) => (b.onclick = () => setStyle(b.dataset.style)));
  dropZone($("stRawDrop"), $("stRawInput"), setRaw);
  dropZone($("stVoiceDrop"), $("stVoiceInput"), setVoice);
  for (const id of ["stAudio", "stLang", "stFit"]) $(id).onchange = checkForm;
  $("stStart").onclick = start;
  $("stNew").onclick = () => { closeJob(); resetForm(); };
  $("edAddSeg").onclick = () => addRow("segments");
  $("edAddStep").onclick = () => addRow("steps");
  for (const id of ["edHook", "edTitle", "edCredit"]) $(id).oninput = drawOverlay;
  $("edRender").onclick = saveAndRender;
  $("stReedit").onclick = () => { $("stDone").hidden = true; $("stEdit").hidden = false; renderEditor(); };
  $("stSchedule").onclick = schedule;
  $("stDelete").onclick = deleteJob;
  $("stRetry").onclick = retry;

  window.MENTIS_STUDIO = { refresh };
  renderMusic(); setStyle("overseas");
})();
