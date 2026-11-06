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
    for (const id of ["stHandle", "stPermission", "stSlug", "stHook", "stSteps", "stLines"]) $(id).value = "";
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
    data.hook = $("stHook").value.trim();
    if (style === "overseas") Object.assign(data, { cover_band: $("stBand").checked,
      credit: { handle, permission: $("stPermission").value.trim() } });
    if (style === "format") data.step_lines = $("stSteps").value.trim();
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
    if (job?.name !== name) { undoStack = []; redoStack = []; }   // 다른 작업을 열면 되돌리기 기록 새로
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
    if (!running && subs) window.MENTIS_THUMB?.open(j, jobData, subs);
    if (!quiet) $("stJob").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closeJob() {
    job = null; $("stJob").hidden = true; $("stForm").hidden = false;
    window.MENTIS_THUMB?.close();
  }

  // ---------- 자막 고치기 ----------
  const num = (v) => Math.round(Number(v) * 10) / 10;
  const W = 1080, H = 1920;
  let conf = null, presets = {}, element = "hook";
  const logoRatio = {}, logoImg = {};   // 로고 버전별 가로/세로 비율, 이미지
  const LABEL = { hook: "위쪽 문구", subtitle: "자막", step: "단계 문구", credit: "출처", logo: "로고" };

  // 스타일 기본값(reel-styles.json)·저장된 기본(reel-presets.json)을 저장소에서 읽는다
  async function loadConf() {
    const get = (p) => fetch(A.rawUrl(p), { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    [conf, presets] = await Promise.all([get("templates/reel-styles.json"), get("templates/reel-presets.json")]);
    presets ||= {};
    $("sFont").innerHTML = Object.entries(conf.fonts).map(([k, f]) =>
      `<option value="${k}" style="font-family:'${f.css}';font-weight:${f.weight}">${esc(f.label)}</option>`).join("");
    for (const [v, info] of Object.entries(conf.common.logo.variants)) {
      const img = new Image();
      img.onload = () => { logoRatio[v] = img.naturalWidth / img.naturalHeight; logoImg[v] = img; drawOverlay(); };
      img.src = info.url = A.rawUrl(info.file);
    }
    $("lVariant").innerHTML = Object.entries(conf.common.logo.variants).map(([v, info]) => `<button data-v="${v}">${esc(info.label)}</button>`).join("");
    $("lVariant").querySelectorAll("button").forEach((b) => (b.onclick = () => {
      // 버전을 바꾸면 그 버전에 맞는 기본 크기로
      checkpoint();
      (ov().logo ||= {}).variant = b.dataset.v; ov().logo.width = conf.common.logo.variants[b.dataset.v].width;
      renderEls(); drawOverlay();
    }));
  }

  const key = () => jobData.style || "shoot";
  const ov = () => (subs.styles ||= {});
  function textStyle(el) {
    return { ...conf.text_defaults, ...(conf.styles[key()]?.text?.[el] || {}), ...(presets[key()]?.[el] || {}), ...(ov()[el] || {}),
      one_line: conf.elements[el]?.lines === "one" };
  }
  function logoStyle() {
    return { show: true, color: "#FFFFFF", ...conf.common.logo, ...(presets[key()]?.logo || {}), ...(ov().logo || {}) };
  }
  function elements() {
    return ["hook", "subtitle", ...(key() === "format" ? ["step"] : []), ...(subs.credit ? ["credit"] : []), "logo"];
  }
  function setOv(el, k, v) { track(); (ov()[el] ||= {})[k] = v; drawOverlay(); }

  // ---------- 되돌리기 (Ctrl+Z) / 다시 하기 (Ctrl+Y) ----------
  let undoStack = [], redoStack = [], lastTrack = 0;
  const snap = () => JSON.stringify({ segments: subs.segments, steps: subs.steps, hook: subs.hook, credit: subs.credit,
    credit_on: subs.credit_on, styles: subs.styles });
  // 버튼 한 번 = 되돌리기 한 칸
  function checkpoint() {
    undoStack.push(snap()); redoStack = [];
    if (undoStack.length > 100) undoStack.shift();
    lastTrack = Date.now();
  }
  // 글자 입력·슬라이더처럼 계속 바뀌는 건 잠깐(0.8초) 멈출 때마다 한 칸
  function track() { if (Date.now() - lastTrack > 800) checkpoint(); lastTrack = Date.now(); }
  function restore(state) {
    Object.assign(subs, JSON.parse(state));
    renderEditor();
  }
  function undo() { if (!undoStack.length) return A.toast("더 되돌릴 게 없어요"); redoStack.push(snap()); restore(undoStack.pop()); lastTrack = 0; }
  function redo() { if (!redoStack.length) return; undoStack.push(snap()); restore(redoStack.pop()); lastTrack = 0; }

  function rowsHtml(list, kind) {
    const one = kind === "segments";
    return list.map((s, i) => `<div class="subrow" data-kind="${kind}" data-i="${i}">
      <input type="number" step="0.1" min="0" value="${num(s.start)}" data-k="start" aria-label="시작(초)">
      <input type="number" step="0.1" min="0" value="${num(s.end)}" data-k="end" aria-label="끝(초)">
      <div class="txt">${one ? `<input type="text" data-k="text" value="${esc(s.text)}">` : `<textarea rows="2" data-k="text">${esc(s.text)}</textarea>`}
        ${s.src ? `<small>${esc(s.src)}</small>` : ""}<small class="long" hidden>길어서 글자가 작아져요 → ✂ 로 나누기</small></div>
      <span class="acts">${one ? `<button class="btn ghost small" data-split title="나누기 (글자 칸에서 클릭한 곳, 없으면 가운데)">✂</button>` : ""}${i < list.length - 1 ? `<button class="btn ghost small" data-merge title="다음 자막과 합치기">⤵</button>` : ""}<button class="btn ghost small" data-del title="빼기">×</button></span></div>`).join("") || `<p class="hint">없음</p>`;
  }

  async function renderEditor() {
    if (!conf) await loadConf();
    // 예전 작업(제목 따로)은 위쪽 문구로 합친다
    if (!subs.hook && subs.title) subs.hook = subs.title;
    subs.credit_on ??= true;
    showFor($("stEdit"), key());
    $("edHook").value = subs.hook || ""; $("edCredit").value = subs.credit || ""; $("edCreditOn").checked = subs.credit_on;
    $("edCreditBox").hidden = !subs.credit;
    $("edSegs").innerHTML = rowsHtml(subs.segments || [], "segments");
    $("edSteps").innerHTML = rowsHtml(subs.steps || [], "steps");
    document.querySelectorAll("#stEdit .subrow").forEach((row) => {
      const list = subs[row.dataset.kind], i = +row.dataset.i;
      row.querySelectorAll("[data-k]").forEach((inp) => (inp.oninput = () => {
        track();
        list[i][inp.dataset.k] = inp.dataset.k === "text" ? inp.value : Number(inp.value);
        drawOverlay();
      }));
      row.querySelector("[data-del]").onclick = () => { checkpoint(); list.splice(i, 1); renderEditor(); };
      const split = row.querySelector("[data-split]"), field = row.querySelector("[data-k=text]");
      // 버튼을 누르면 글자 칸 커서가 사라지니, 마지막으로 클릭·입력한 위치를 기억해 둔다
      const remember = () => { field.dataset.caret = field.selectionStart; };
      for (const ev of ["click", "keyup", "select"]) field.addEventListener(ev, remember);
      if (split) split.onclick = () => { checkpoint(); splitRow(list, i, field.dataset.caret ? Number(field.dataset.caret) : null); renderEditor(); };
      const merge = row.querySelector("[data-merge]");
      if (merge) merge.onclick = () => { checkpoint(); mergeRow(list, i); renderEditor(); };
      row.querySelector("[data-k=text]").onfocus = () => { $("stVideo").currentTime = list[i].start + 0.05; };
    });
    if (!elements().includes(element)) element = "hook";
    renderEls();
    const v = $("stVideo");
    const rawFile = Object.keys(job.files).find((f) => /^raw\./.test(f));
    const src = A.rawUrl(`${job.folder}/${rawFile}`);
    if (v.dataset.src !== src) { v.src = src; v.dataset.src = src; }
    v.style.objectFit = jobData.fit === "blur" ? "contain" : "cover";
    v.ontimeupdate = drawOverlay;
    document.fonts.ready.then(drawOverlay);
    drawOverlay();
  }

  // 자막 한 줄을 둘로 (자를 곳을 고르지 않았으면 가운데 띄어쓰기). 시간은 글자 수 비율
  function splitRow(list, i, caret = null) {
    const s = list[i], text = s.text.replace(/\s+/g, " ");
    const spaces = [...text].map((c, k) => (c === " " ? k : -1)).filter((k) => k > 0);
    const mid = text.length / 2;
    const at = caret > 0 && caret < text.length ? caret
      : spaces.length ? spaces.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a)) : Math.floor(mid);
    const a = text.slice(0, at).trim(), b = text.slice(at).trim();
    if (!a || !b) return;
    const t = num(s.start + (s.end - s.start) * a.length / (a.length + b.length));
    list.splice(i, 1, { ...s, text: a, end: t }, { ...s, text: b, start: t });
  }

  // 다음 자막과 하나로 (시간은 앞 자막 시작 ~ 뒤 자막 끝)
  function mergeRow(list, i) {
    const a = list[i], b = list[i + 1];
    if (!b) return;
    list.splice(i, 2, { ...a, text: `${a.text.trim()} ${b.text.trim()}`.trim(), end: b.end,
      ...(a.src || b.src ? { src: [a.src, b.src].filter((x, k, arr) => x && arr.indexOf(x) === k).join(" ") } : {}) });
  }

  // ---------- 글자 스타일 ----------
  function renderEls() {
    $("edEls").innerHTML = elements().map((e) => `<button data-el="${e}" class="${e === element ? "on" : ""}">${LABEL[e]}</button>`).join("");
    $("edEls").querySelectorAll("button").forEach((b) => (b.onclick = () => { element = b.dataset.el; renderEls(); }));
    const isLogo = element === "logo";
    $("edStyler").querySelector("[data-ctl=text]").hidden = isLogo;
    $("edStyler").querySelector("[data-ctl=logo]").hidden = !isLogo;
    if (isLogo) {
      const l = logoStyle();
      $("lShow").checked = l.show !== false; $("lColor").value = l.color.slice(0, 7);
      $("lVariant").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === l.variant));
      $("lWidth").value = l.width; $("lY").value = l.y; $("lOp").value = l.opacity; $("lBold").value = l.bold ?? 0;
    } else {
      const t = textStyle(element);
      $("sFont").value = t.font; $("sSize").value = t.size; $("sY").value = t.y;
      $("sColor").value = t.color.slice(0, 7); $("sHl").value = t.highlight.slice(0, 7);
      $("sStrokeColor").value = t.stroke_color.slice(0, 7); $("sStroke").value = t.stroke;
      $("sBoxOn").checked = !!t.box; $("sBox").value = (t.box || "#000000").slice(0, 7); $("sBoxOp").value = t.box_opacity;
    }
    $("sPresetHint").textContent = `'기본으로 저장'하면 다음 ${STYLES[key()].label} 작업부터 이 글꼴·색·크기·위치로 시작해요.`;
    showVals();
  }

  function showVals() {
    $("sSizeV").textContent = `${$("sSize").value}px`; $("sYV").textContent = $("sY").value;
    $("sStrokeV").textContent = `${$("sStroke").value}px`; $("sBoxOpV").textContent = `${Math.round($("sBoxOp").value * 100)}%`;
    $("lWidthV").textContent = `${$("lWidth").value}px`; $("lYV").textContent = $("lY").value;
    $("lOpV").textContent = `${Math.round($("lOp").value * 100)}%`; $("lBoldV").textContent = $("lBold").value;
  }

  function bindStyler() {
    const text = { sFont: ["font", String], sSize: ["size", Number], sY: ["y", Number], sColor: ["color", String],
      sHl: ["highlight", String], sStrokeColor: ["stroke_color", String], sStroke: ["stroke", Number], sBoxOp: ["box_opacity", Number] };
    for (const [id, [k, cast]] of Object.entries(text)) $(id).oninput = () => { setOv(element, k, cast($(id).value)); showVals(); };
    const box = () => setOv(element, "box", $("sBoxOn").checked ? $("sBox").value : "");
    $("sBoxOn").onchange = box; $("sBox").oninput = box;
    $("lShow").onchange = () => setOv("logo", "show", $("lShow").checked);
    $("lColor").oninput = () => setOv("logo", "color", $("lColor").value);
    $("lWidth").oninput = () => { setOv("logo", "width", Number($("lWidth").value)); showVals(); };
    $("lY").oninput = () => { setOv("logo", "y", Number($("lY").value)); showVals(); };
    $("lOp").oninput = () => { setOv("logo", "opacity", Number($("lOp").value)); showVals(); };
    $("lBold").oninput = () => { setOv("logo", "bold", Number($("lBold").value)); showVals(); };
    $("sReset").onclick = () => { checkpoint(); delete ov()[element]; renderEls(); drawOverlay(); };
    $("sSavePreset").onclick = savePreset;
  }

  async function savePreset() {
    const k = key();
    const next = { ...presets, [k]: { ...(presets[k] || {}) } };
    for (const [el, v] of Object.entries(ov())) next[k][el] = { ...(next[k][el] || {}), ...v };
    try {
      await A.commit(`reel studio: ${STYLES[k].label} 기본 글자 스타일 저장`,
        [{ path: "templates/reel-presets.json", text: JSON.stringify(next, null, 2) + "\n" }]);
      presets = next;
      A.toast("기본 스타일로 저장했어요. 다음 작업부터 적용돼요.");
    } catch (e) { if (e.message !== "401") A.toast(`저장 실패: ${e.message}`, 5000); }
  }

  // ---------- 미리보기 (영상과 같은 계산: 1080×1920 기준 px → 화면 비율) ----------
  const cq = (px) => `${(px / W) * 100}cqw`;
  const top = (y) => `${(y / H) * 100}%`;
  const plainText = (t) => t.replace(/\*([^*]+)\*/g, "$1");
  const hexA = (hex, a) => { const n = parseInt(hex.slice(1, 7), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  const measure = document.createElement("canvas").getContext("2d");

  // 가장 긴 줄이 화면 폭에 들어가도록 글자를 줄인다 (영상 렌더와 같은 규칙, 최소 절반)
  function fitSize(lines, st) {
    const f = conf.fonts[st.font] || conf.fonts.pretendard;
    const maxW = conf.common.max_width - (st.box ? 2 * st.pad : 0);
    let size = st.size;
    while (size > st.size * 0.5) {
      measure.font = `${f.weight} ${size}px "${f.css}"`;
      if (Math.max(...lines.map((l) => measure.measureText(plainText(l)).width)) <= maxW) break;
      size -= 2;
    }
    return size;
  }

  function paintText(el, text, st) {
    const box = $(`ov-${el}`);
    if (!text || !text.trim()) { box.innerHTML = ""; return; }
    const lines = st.one_line ? [text.replace(/\s+/g, " ").trim()] : text.split("\n").map((l) => l.trim()).filter(Boolean);
    const size = fitSize(lines, st), f = conf.fonts[st.font] || conf.fonts.pretendard;
    const html = lines.map((l) => esc(l).replace(/\*([^*]+)\*/g, `<b style="color:${st.highlight}">$1</b>`)).join("<br>");
    box.style.top = top(st.y);
    box.innerHTML = `<span style="font-family:'${f.css}';font-weight:${f.weight};font-size:${cq(size)};color:${st.color};` +
      `-webkit-text-stroke:${cq(st.stroke * 2)} ${st.stroke_color};background:${st.box ? hexA(st.box, st.box_opacity) : "transparent"};` +
      `padding:${st.box ? `${cq(st.pad * 0.6)} ${cq(st.pad)}` : 0}">${html}</span>`;
  }

  function drawOverlay() {
    if (!subs || !conf) return;
    const t = $("stVideo").currentTime || 0;
    const at = (list) => (list || []).find((s) => s.start <= t && t < s.end)?.text || "";
    subs.hook = $("edHook").value; subs.credit = $("edCredit").value; subs.credit_on = $("edCreditOn").checked;
    paintText("hook", subs.hook, textStyle("hook"));
    paintText("subtitle", at(subs.segments), textStyle("subtitle"));
    paintText("step", key() === "format" ? at(subs.steps) : "", textStyle("step"));
    paintText("credit", subs.credit_on ? subs.credit : "", textStyle("credit"));
    const l = logoStyle(), logo = $("ovLogo"), show = l.show !== false;
    const variant = conf.common.logo.variants[l.variant] ? l.variant : "both";
    const ratio = logoRatio[variant] || 1.3;
    logo.hidden = !show;
    paintLogo(logo, variant, l);
    Object.assign(logo.style, { width: cq(l.width), top: top(l.y), opacity: l.opacity });
    const corner = $("ovCorner");
    corner.textContent = show ? jobData.corner || "" : "";
    Object.assign(corner.style, { top: top(l.y + l.width / ratio / 2 + (l.bold || 0) + 30), fontSize: cq(conf.common.corner.size), color: l.color });
    const band = $("ovBand"), b = conf.styles[key()]?.band;
    band.hidden = !(jobData.cover_band && b);
    if (!band.hidden) Object.assign(band.style, { top: top(textStyle("subtitle").y - b.height / 2), height: top(b.height) });
    // 한 줄에 안 들어가 글자가 작아지는 자막 표시
    const st = textStyle("subtitle");
    document.querySelectorAll("#edSegs .subrow").forEach((row) => {
      const s = subs.segments[+row.dataset.i];
      row.querySelector(".long").hidden = !s?.text || fitSize([s.text], st) >= st.size;
    });
  }

  // 로고를 영상 렌더와 같은 크기(1080 기준)로 그린 뒤 화면에 줄여 보여준다 → 굵기가 미리보기에도 그대로 보임
  function paintLogo(canvas, variant, l) {
    const img = logoImg[variant];
    const k = `${variant}|${l.width}|${l.bold}|${l.color}`;
    if (!img || canvas.dataset.key === k) return;
    canvas.dataset.key = k;
    const s = 2, w = Math.round(l.width * s), h = Math.round(w / logoRatio[variant]);
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    const r = Math.round((l.bold || 0) * s);   // 굵기 1 = 1px(1080 기준)씩 두껍게, 영상 렌더와 같음
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      if (dx * dx + dy * dy <= r * r) ctx.drawImage(img, dx, dy, w, h);
    }
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = l.color; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
  }

  function addRow(kind) {
    checkpoint();
    const list = (subs[kind] ||= []);
    const t = num($("stVideo").currentTime || (list.at(-1)?.end ?? 0));
    list.push({ start: t, end: num(t + 2.5), text: "" });
    list.sort((a, b) => a.start - b.start);
    renderEditor();
  }

  async function saveAndRender() {
    const err = (t) => A.setMsg($("stJobMsg"), t, "err");
    subs.hook = $("edHook").value.trim(); subs.credit = $("edCredit").value.trim(); subs.credit_on = $("edCreditOn").checked;
    delete subs.title;
    for (const k of ["segments", "steps"]) {
      subs[k] = (subs[k] || []).filter((s) => String(s.text).trim()).sort((a, b) => a.start - b.start);
      if (subs[k].some((s) => !(s.end > s.start))) return err("끝 시간이 시작 시간보다 늦어야 해요.");
    }
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
  // 한 줄에 안 들어가는 자막을 모두 반씩 나눈다 (들어갈 때까지)
  $("edSplitAll").onclick = () => {
    checkpoint();
    const st = textStyle("subtitle");
    for (let i = 0; i < (subs.segments || []).length; i++) {
      while (subs.segments[i].text.trim().includes(" ") && fitSize([subs.segments[i].text], st) < st.size) splitRow(subs.segments, i);
    }
    renderEditor();
  };
  $("edAddStep").onclick = () => addRow("steps");
  for (const id of ["edHook", "edCredit"]) $(id).oninput = () => { track(); drawOverlay(); };
  $("edCreditOn").onchange = () => { checkpoint(); drawOverlay(); };
  $("edUndo").onclick = undo;
  $("edRedo").onclick = redo;
  document.addEventListener("keydown", (e) => {
    if ($("tab-studio").hidden || $("stEdit").hidden || !(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
  });
  bindStyler();
  $("edRender").onclick = saveAndRender;
  $("stReedit").onclick = () => { $("stDone").hidden = true; $("stEdit").hidden = false; renderEditor(); };
  $("stSchedule").onclick = schedule;
  $("stDelete").onclick = deleteJob;
  $("stRetry").onclick = retry;

  window.MENTIS_STUDIO = { refresh };
  renderMusic(); setStyle("overseas");
})();
