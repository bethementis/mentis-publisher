// 맨티스 릴스 썸네일 (릴스 만들기 탭 아래)
// 영상에서 장면 3개 추천 → 멘트 3개 추천(직접 수정) → 디자인 4가지 중 고르기 → cover.jpg 로 저장.
// 브라우저 캔버스로 그려서 미리보기 = 저장되는 그림. 예약하면 cover.jpg 가 같이 옮겨져 인스타 릴스 커버가 된다.
(() => {
  const A = window.MENTIS_APP;
  const $ = (id) => document.getElementById(id);
  const esc = A.esc;
  const W = 1080, H = 1920;
  const DESIGNS = {
    magazine: "매거진", bold: "볼드", box: "박스", minimal: "미니멀",
  };
  // 디자인별 기본 글자 (글꼴 키는 templates/reel-styles.json 의 fonts). 사용자가 바꾼 값(opt.text)이 위에 덮인다
  const TEXT_DEF = {
    magazine: { font: "myeongjo", color: "#FFFFFF", hl: "#E9C46A", stroke: 0, strokeColor: "#000000" },
    bold: { font: "blackhansans", color: "#FFFFFF", hl: "#FFD24A", stroke: 18, strokeColor: "#000000" },
    box: { font: "pretendard-xb", color: "#111111", hl: "#2B3A8C", stroke: 0, strokeColor: "#000000" },
    minimal: { font: "pretendard-xb", color: "#FFFFFF", hl: "#FFD24A", stroke: 0, strokeColor: "#000000" },
  };
  // 로고 버전별 크기 비율 (MENTIS 글자 기준). 심볼이 들어가면 세로가 길어서 작게
  const LOGO_SCALE = { text: 1, both: 0.55, symbol: 0.3, row: 0.85 };
  const OPT_DEF = { size: 100, offset: 0, dim: 25, logo: "auto", text: {}, logoVariant: "text", logoColor: "#FFFFFF", logoSize: 100, logoX: 0, logoY: 0 };

  let job = null, jobData = null, subs = null;
  let frameT = 0, picks = [], lines = [], design = "magazine";
  let opt = structuredClone(OPT_DEF);
  let conf = null, presets = {};
  const logoImgs = {};
  const frame = document.createElement("canvas"); frame.width = W; frame.height = H;   // 고른 장면 (9:16)

  // ---------- 열기 ----------
  async function open(j, data, s) {
    const same = job?.name === j.name;
    job = j; jobData = data || {}; subs = s || {};
    const box = $("stThumb");
    const rawFile = Object.keys(j.files).find((f) => /^raw\./.test(f));
    box.hidden = !rawFile;
    if (!rawFile) return;
    if (same) return;
    const saved = j.files["thumb.json"] ? await A.readJson(j, "thumb.json").catch(() => null) : null;
    if (!conf) {
      const get = (p) => fetch(A.rawUrl(p), { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      [conf, presets] = await Promise.all([get("templates/reel-styles.json"), get("templates/reel-presets.json")]);
      presets ||= {};
      $("thFont").innerHTML = `<option value="">디자인 기본</option>` + Object.entries(conf.fonts).map(([k, f]) =>
        `<option value="${k}" style="font-family:'${f.css}';font-weight:${f.weight}">${esc(f.label)}</option>`).join("");
      $("thLogoV").innerHTML = Object.entries(conf.common.logo.variants).map(([k, v]) => `<button data-v="${k}">${esc(v.label)}</button>`).join("");
      $("thLogoV").querySelectorAll("button").forEach((b) => (b.onclick = () => { opt.logoVariant = b.dataset.v; syncControls(); }));
    }
    // 이 작업에서 저장한 썸네일 설정 → 없으면 '기본값으로 저장'한 설정 → 없으면 처음 기본
    const preset = presets[jobData.style || "shoot"]?.thumb;
    design = saved?.design || preset?.design || "magazine";
    opt = { ...structuredClone(OPT_DEF), ...structuredClone(preset?.opt || {}), ...(saved?.opt || {}) };
    lines = suggest();
    $("thText").value = saved?.text ?? lines[0]?.text ?? "";
    renderSuggest();
    $("thSaved").textContent = j.files["cover.jpg"] ? "✓ 저장된 썸네일이 있어요. 예약하면 인스타 릴스 커버로 같이 올라가요." : "";
    // 캔버스는 화면에 안 쓰인 글꼴을 모르니 미리 불러 둔다
    await Promise.all(Object.values(conf.fonts).map((f) => document.fonts.load(`${f.weight} 100px "${f.css}"`).catch(() => null)));
    for (const [k, v] of Object.entries(conf.common.logo.variants)) {
      if (logoImgs[k]) continue;
      const img = new Image(); img.crossOrigin = "anonymous";
      img.onload = draw; img.src = A.rawUrl(v.file); logoImgs[k] = img;
    }
    const v = $("thVideo");
    v.crossOrigin = "anonymous"; v.muted = true; v.preload = "auto";
    v.src = A.rawUrl(`${j.folder}/${rawFile}`);
    $("thPicks").innerHTML = `<p class="hint">장면 고르는 중…</p>`;
    await new Promise((ok) => { v.onloadeddata = ok; v.onerror = ok; });
    $("thTime").max = Math.max(0.1, v.duration - 0.05);
    picks = await findScenes(v);
    renderPicks();
    await useTime(saved?.t ?? picks[0]?.t ?? 0);
    syncControls();
  }

  // ---------- 장면 추천: 선명하고(윤곽이 많고) 너무 어둡거나 밝지 않은 장면, 서로 떨어진 3곳 ----------
  const seek = (v, t) => new Promise((ok) => { v.onseeked = () => ok(); v.currentTime = t; });

  async function findScenes(v) {
    const d = v.duration || 0;
    if (!d) return [];
    const c = document.createElement("canvas"); c.width = 72; c.height = 128;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    const n = Math.min(16, Math.max(6, Math.round(d / 1.5)));
    const scores = [];
    for (let i = 0; i < n; i++) {
      const t = d * (0.06 + 0.88 * i / (n - 1));
      await seek(v, t);
      coverDraw(ctx, v, 72, 128);
      let px;
      try { px = ctx.getImageData(0, 0, 72, 128).data; } catch { return []; }   // 영상이 다른 사이트면 읽을 수 없음
      const L = new Float32Array(72 * 128);
      let sum = 0;
      for (let k = 0; k < L.length; k++) { L[k] = (px[k * 4] * 0.299 + px[k * 4 + 1] * 0.587 + px[k * 4 + 2] * 0.114) / 255; sum += L[k]; }
      let edge = 0;
      for (let y = 1; y < 127; y++) for (let x = 1; x < 71; x++) {
        const k = y * 72 + x;
        edge += Math.abs(4 * L[k] - L[k - 1] - L[k + 1] - L[k - 72] - L[k + 72]);
      }
      const mean = sum / L.length;
      scores.push({ t, score: edge * (1 - Math.min(1, Math.abs(mean - 0.5) * 1.6)), thumb: c.toDataURL("image/jpeg", 0.7) });
    }
    const out = [];
    for (const s of scores.sort((a, b) => b.score - a.score)) {
      if (out.every((o) => Math.abs(o.t - s.t) > d / 6)) out.push(s);
      if (out.length === 3) break;
    }
    return out.sort((a, b) => a.t - b.t);
  }

  function coverDraw(ctx, v, w, h) {
    const s = Math.max(w / v.videoWidth, h / v.videoHeight);
    const dw = v.videoWidth * s, dh = v.videoHeight * s;
    ctx.drawImage(v, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  // 고른 시간의 장면을 1080×1920 으로 (흐린 배경 작업이면 흐린 배경 + 가운데 원본)
  async function useTime(t) {
    const v = $("thVideo");
    frameT = Math.max(0, Math.min(t, (v.duration || 0) - 0.05));
    await seek(v, frameT);
    const ctx = frame.getContext("2d");
    const wide = v.videoWidth / v.videoHeight > 0.6;
    if (jobData.fit === "blur" || (jobData.fit === "auto" && wide)) {
      ctx.filter = "blur(40px) brightness(0.9)"; coverDraw(ctx, v, W, H); ctx.filter = "none";
      const s = Math.min(W / v.videoWidth, H / v.videoHeight);
      ctx.drawImage(v, (W - v.videoWidth * s) / 2, (H - v.videoHeight * s) / 2, v.videoWidth * s, v.videoHeight * s);
    } else coverDraw(ctx, v, W, H);
    $("thTime").value = frameT; $("thTimeV").textContent = `${frameT.toFixed(1)}초`;
    document.querySelectorAll("#thPicks .pick").forEach((p) => p.classList.toggle("on", Math.abs(+p.dataset.t - frameT) < 0.05));
    draw();
  }

  function renderPicks() {
    $("thPicks").innerHTML = picks.length ? picks.map((p, i) => `<button class="pick" data-t="${p.t}" title="${p.t.toFixed(1)}초">
      <img src="${p.thumb}" alt=""><span>추천 ${i + 1} · ${p.t.toFixed(1)}초</span></button>`).join("")
      : `<p class="hint">장면을 자동으로 고르지 못했어요. 아래 막대로 직접 골라 주세요.</p>`;
    $("thPicks").querySelectorAll(".pick").forEach((b) => (b.onclick = () => useTime(+b.dataset.t)));
  }

  // ---------- 멘트 추천 (규칙 기반: 위쪽 문구·자막에서 주제와 숫자를 뽑아 세 가지 말투로) ----------
  // 마지막 글자에 받침이 있는지 (12초 → 면, 1분 → 이면)
  const batchim = (w) => { const c = w.charCodeAt(w.length - 1); return c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 !== 0 : true; };

  // 영상 주제와 맞는 게 먼저: 훅·자막에서 주제·숫자를 뽑아 3가지 (회의의 대상 좁히기는 억지로 끼우지 않는다)
  function suggest() {
    const clean = (s) => String(s || "").replace(/\*/g, "").replace(/\s+/g, " ").trim();
    const hook = clean(subs.hook);
    const allText = [subs.hook, ...(subs.segments || []).map((s) => s.text)].join(" ");
    const topic = clean(hook.split(/[,，.!?…]/)[0]) || clean(jobData.corner) || "자기관리";
    const num = (allText.match(/\d+\s?(초|분|일|주|번|가지|개|%|kg|cm)/) || [])[0]?.replace(/\s/g, "");
    const first = clean((subs.segments || [])[0]?.text).replace(/[,.]$/, "");
    const out = [
      hook ? String(subs.hook).replace(/\s*,\s*/, ",\n") : first || topic,
      num ? `${topic},\n*${num}*${batchim(num) ? "이면" : "면"} 충분해요` : `${topic},\n*이렇게* 바꾸세요`,
      `아직도 ${topic}?\n*이것* 하나면 끝`,
    ];
    return [...new Set(out.filter(Boolean))].map((text) => ({ text, why: "" }));
  }

  function renderSuggest() {
    $("thSuggest").innerHTML = lines.map((l, i) =>
      `<button class="chip-btn" data-i="${i}">${l.why ? `<b class="why">${esc(l.why)}</b> ` : ""}${esc(l.text.replace(/\*/g, "")).replace(/\n/g, " / ")}</button>`).join("");
    $("thSuggest").querySelectorAll("button").forEach((b) => (b.onclick = () => { $("thText").value = lines[+b.dataset.i].text; draw(); }));
  }

  // ---------- 그리기 ----------
  // 글자 스타일 = 디자인 기본 ← 사용자가 바꾼 값
  function textOf(which) {
    const t = { ...TEXT_DEF[which] };
    for (const [k, v] of Object.entries(opt.text || {})) if (v !== "" && v != null) t[k] = v;
    const f = conf?.fonts[t.font] || { css: "Pretendard", weight: 800 };
    return { ...t, css: f.css, weight: f.weight };
  }

  function fitFont(ctx, txtLines, st, size, maxW) {
    const plain = (l) => l.replace(/\*/g, "");
    while (size > 30) {
      ctx.font = `${st.weight} ${size}px "${st.css}"`;
      if (Math.max(...txtLines.map((l) => ctx.measureText(plain(l)).width)) <= maxW) break;
      size -= 2;
    }
    return size;
  }

  // 한 줄을 *강조* 구간별로 나눠 그린다. align: "center" | "left"
  function drawLine(ctx, line, x, y, color, hl, stroke, align, strokeColor = "#000000") {
    const parts = line.split(/(\*[^*]+\*)/).filter(Boolean).map((p) => (/^\*.+\*$/.test(p) ? [p.slice(1, -1), true] : [p, false]));
    const total = parts.reduce((w, [t]) => w + ctx.measureText(t).width, 0);
    let cx = align === "center" ? x - total / 2 : x;
    ctx.textAlign = "left";
    for (const [t, strong] of parts) {
      if (stroke) { ctx.lineWidth = stroke; ctx.strokeStyle = strokeColor; ctx.lineJoin = "round"; ctx.strokeText(t, cx, y); }
      ctx.fillStyle = strong ? hl : color; ctx.fillText(t, cx, y);
      cx += ctx.measureText(t).width;
    }
    return total;
  }

  // 디자인마다 정해진 로고 자리. '위'·'아래'를 고르면 그 자리로, '없음'이면 안 그림
  let logoBox = null;   // 큰 미리보기에 마지막으로 그린 로고 자리 (끌어서 옮기기용)
  function drawLogo(ctx, cx, cy, w) {
    const logoImg = logoImgs[opt.logoVariant] || logoImgs.text;
    if (opt.logo === "none" || !logoImg?.complete || !logoImg.naturalWidth) return;
    if (opt.logo === "top") cy = 300;
    if (opt.logo === "bottom") cy = 1640;
    cx += opt.logoX || 0; cy += opt.logoY || 0;   // 사용자가 옮긴 만큼
    const color = opt.logoColor || "#FFFFFF";
    w = Math.round(w * (LOGO_SCALE[opt.logoVariant] ?? 1) * (opt.logoSize || 100) / 100);
    const h = w * logoImg.naturalHeight / logoImg.naturalWidth;
    const tmp = document.createElement("canvas"); tmp.width = w + 4; tmp.height = h + 4;
    const t = tmp.getContext("2d");
    for (let dx = 0; dx <= 4; dx++) for (let dy = 0; dy <= 4; dy++) {   // 반지름 2px 만큼 굵게 (영상 위에서도 잘 보이게)
      if ((dx - 2) ** 2 + (dy - 2) ** 2 <= 4) t.drawImage(logoImg, dx, dy, w, h);
    }
    t.globalCompositeOperation = "source-in"; t.fillStyle = color; t.fillRect(0, 0, tmp.width, tmp.height);
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 6;
    ctx.drawImage(tmp, cx - tmp.width / 2, cy - tmp.height / 2); ctx.restore();
    logoBox = { x: cx - tmp.width / 2, y: cy - tmp.height / 2, w: tmp.width, h: tmp.height };
  }

  function render(ctx, which) {
    const text = $("thText").value.trim();
    const tl = text ? text.split("\n").map((l) => l.trim()).filter(Boolean) : [];
    const k = opt.size / 100, off = opt.offset, st = textOf(which);
    const font = (size) => `${st.weight} ${size}px "${st.css}"`;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(frame, 0, 0);
    ctx.fillStyle = `rgba(0,0,0,${opt.dim / 100})`; ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = "alphabetic";
    const corner = jobData.corner || "";
    if (which === "magazine") {
      const g = ctx.createLinearGradient(0, H * 0.45, 0, H * 0.9);
      g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.82)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      drawLogo(ctx, W / 2, 300, 260);
      const size = fitFont(ctx, tl, st, 104 * k, W - 160), lh = size * 1.22;
      const yEnd = 1560 + off, y0 = yEnd - lh * (tl.length - 1);
      ctx.fillStyle = st.hl; ctx.fillRect(80, y0 - size - 54, 70, 5);
      if (corner) { ctx.font = `600 34px "Pretendard"`; ctx.fillStyle = st.color; ctx.fillText(corner.toUpperCase(), 170, y0 - size - 38); }
      ctx.font = font(size);
      tl.forEach((l, i) => drawLine(ctx, l, 80, y0 + i * lh, st.color, st.hl, st.stroke * size / 104, "left", st.strokeColor));
    } else if (which === "bold") {
      drawLogo(ctx, W / 2, 300, 240);
      const size = fitFont(ctx, tl, st, 150 * k, W - 120), lh = size * 1.12;
      const y0 = 980 + off - (lh * (tl.length - 1)) / 2 + size * 0.35;
      ctx.font = font(size);
      tl.forEach((l, i) => drawLine(ctx, l, W / 2, y0 + i * lh, st.color, st.hl, st.stroke * size / 150, "center", st.strokeColor));
    } else if (which === "box") {
      const size = fitFont(ctx, tl, st, 82 * k, W - 260), lh = size * 1.3;
      ctx.font = font(size);
      const bw = Math.max(...tl.map((l) => ctx.measureText(l.replace(/\*/g, "")).width), 200) + 120;
      const bh = lh * tl.length + 70, by = 1320 + off - bh / 2;
      ctx.fillStyle = "rgba(255,255,255,.96)";
      ctx.beginPath(); ctx.roundRect((W - bw) / 2, by, bw, bh, 22); ctx.fill();
      drawLogo(ctx, W / 2, by - 70, 230);
      ctx.font = font(size);
      tl.forEach((l, i) => drawLine(ctx, l, W / 2, by + 35 + size * 0.95 + i * lh, st.color, st.hl, st.stroke * size / 82, "center", st.strokeColor));
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, H * 0.5);
      g.addColorStop(0, "rgba(0,0,0,.75)"); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const size = fitFont(ctx, tl, st, 96 * k, W - 160), lh = size * 1.25;
      ctx.font = font(size);
      tl.forEach((l, i) => drawLine(ctx, l, 80, 420 + off + i * lh, st.color, st.hl, st.stroke * size / 96, "left", st.strokeColor));
      drawLogo(ctx, W / 2, 1600, 230);
    }
  }

  // 화면용 캔버스는 작게 그리되 1080×1920 기준 좌표 그대로 (저장할 때만 원래 크기)
  function paint(c, which) {
    const ctx = c.getContext("2d");
    ctx.setTransform(c.width / W, 0, 0, c.height / H, 0, 0);
    render(ctx, which);
  }
  function draw() {
    if (!job) return;
    document.querySelectorAll("#thDesigns canvas").forEach((c) => paint(c, c.dataset.d));
    logoBox = null;
    paint($("thCanvas"), design);
  }

  function syncControls() {
    $("thDesigns").innerHTML = Object.entries(DESIGNS).map(([k, label]) =>
      `<button class="design ${k === design ? "on" : ""}" data-d="${k}"><canvas width="216" height="384" data-d="${k}"></canvas><span>${label}</span></button>`).join("");
    $("thDesigns").querySelectorAll("button").forEach((b) => (b.onclick = () => { design = b.dataset.d; syncControls(); }));
    $("thSize").value = opt.size; $("thOffset").value = opt.offset; $("thDim").value = opt.dim; $("thLogo").value = opt.logo;
    $("thSizeV").textContent = `${opt.size}%`; $("thOffsetV").textContent = opt.offset; $("thDimV").textContent = `${opt.dim}%`;
    const st = textOf(design);
    $("thFont").value = opt.text?.font || ""; $("thColor").value = st.color; $("thHl").value = st.hl;
    $("thStroke").value = st.stroke; $("thStrokeV").textContent = `${st.stroke}px`; $("thStrokeColor").value = st.strokeColor;
    $("thLogoColor").value = opt.logoColor; $("thLogoSize").value = opt.logoSize; $("thLogoSizeV").textContent = `${opt.logoSize}%`;
    $("thLogoV").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === opt.logoVariant));
    $("thLogoX").value = opt.logoX || 0; $("thLogoXV").textContent = opt.logoX || 0;
    $("thLogoY").value = opt.logoY || 0; $("thLogoYV").textContent = opt.logoY || 0;
    document.fonts.ready.then(draw);
    draw();
  }

  // ---------- 저장 / 내려받기 ----------
  const toBlob = () => new Promise((ok) => {
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    render(c.getContext("2d"), design);
    c.toBlob(ok, "image/jpeg", 0.92);
  });

  async function save() {
    const btn = $("thSave"); btn.disabled = true;
    try {
      const blob = await toBlob();
      const settings = { design, text: $("thText").value, t: frameT, opt };
      await A.commit(`reel studio: 썸네일 ${job.name}`, [
        { path: `${job.folder}/cover.jpg`, file: blob },
        { path: `${job.folder}/thumb.json`, text: JSON.stringify(settings, null, 2) + "\n" },
      ], (t) => A.setMsg($("thMsg"), t));
      A.setMsg($("thMsg"), "✓ 썸네일을 저장했어요. 예약하면 인스타 릴스 커버로 같이 올라가요.", "ok");
      await A.loadRepo();
    } catch (e) {
      if (e.message !== "401") A.setMsg($("thMsg"), `저장 실패: ${e.message}`, "err");
    } finally { btn.disabled = false; }
  }

  async function download() {
    const blob = await toBlob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${job.name}-썸네일.jpg`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---------- 연결 ----------
  $("thText").oninput = draw;
  $("thTime").oninput = () => { $("thTimeV").textContent = `${(+$("thTime").value).toFixed(1)}초`; };
  $("thTime").onchange = () => useTime(+$("thTime").value);
  for (const [id, k] of [["thSize", "size"], ["thOffset", "offset"], ["thDim", "dim"]]) {
    $(id).oninput = () => { opt[k] = Number($(id).value); syncControls(); };
  }
  $("thLogo").onchange = () => { opt.logo = $("thLogo").value; opt.logoX = 0; opt.logoY = 0; syncControls(); };
  // 멘트 글자: 바꾼 값만 opt.text 에 (디자인을 바꿔도 내가 고른 글꼴·색은 유지)
  const setText = (k, v) => { (opt.text ||= {})[k] = v; syncControls(); };
  $("thFont").onchange = () => setText("font", $("thFont").value);
  $("thColor").oninput = () => setText("color", $("thColor").value);
  $("thHl").oninput = () => setText("hl", $("thHl").value);
  $("thStroke").oninput = () => setText("stroke", Number($("thStroke").value));
  $("thStrokeColor").oninput = () => setText("strokeColor", $("thStrokeColor").value);
  $("thTextReset").onclick = () => { opt.text = {}; syncControls(); };
  $("thLogoColor").oninput = () => { opt.logoColor = $("thLogoColor").value; syncControls(); };
  $("thLogoSize").oninput = () => { opt.logoSize = Number($("thLogoSize").value); syncControls(); };
  $("thLogoX").oninput = () => { opt.logoX = Number($("thLogoX").value); syncControls(); };
  $("thLogoY").oninput = () => { opt.logoY = Number($("thLogoY").value); syncControls(); };
  $("thLogoMoveReset").onclick = () => { opt.logoX = 0; opt.logoY = 0; syncControls(); };
  // 큰 미리보기에서 로고를 잡고 끌면 그만큼 옮긴다
  const cv = $("thCanvas");
  let drag = null;
  const pt = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; };
  cv.onpointerdown = (e) => {
    const p = pt(e), b = logoBox;
    if (!b || p.x < b.x - 20 || p.x > b.x + b.w + 20 || p.y < b.y - 20 || p.y > b.y + b.h + 20) return;
    drag = { p, x: opt.logoX || 0, y: opt.logoY || 0 }; cv.setPointerCapture(e.pointerId); cv.style.cursor = "grabbing";
  };
  cv.onpointermove = (e) => {
    if (!drag) return;
    const p = pt(e), clamp = (v, m) => Math.max(-m, Math.min(m, Math.round(v / 5) * 5));
    opt.logoX = clamp(drag.x + p.x - drag.p.x, 460); opt.logoY = clamp(drag.y + p.y - drag.p.y, 1700);
    $("thLogoX").value = opt.logoX; $("thLogoXV").textContent = opt.logoX;
    $("thLogoY").value = opt.logoY; $("thLogoYV").textContent = opt.logoY;
    draw();
  };
  cv.onpointerup = cv.onpointercancel = () => { drag = null; cv.style.cursor = ""; };
  $("thPreset").onclick = () => window.MENTIS_STUDIO?.savePreset();
  $("thResuggest").onclick = () => { lines = suggest(); renderSuggest(); };
  $("thSave").onclick = save;
  $("thDownload").onclick = download;

  window.MENTIS_THUMB = {
    open, close: () => { job = null; $("stThumb").hidden = true; },
    current: () => (job ? { design, opt: structuredClone(opt) } : null),   // '기본값으로 저장'에 같이 들어감
    setPresets: (p) => { presets = p; },
  };
})();
