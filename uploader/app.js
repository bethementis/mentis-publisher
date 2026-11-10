// 맨티스 업로드 툴
// 화면에서 만든 게시물을 GitHub 저장소의 queue/YYYY-MM-DD_주제/ 폴더로 커밋한다.
// 발행은 기존 publish.yml(매일 19시 무렵)이 그대로 한다.
(() => {
  const CFG = window.MENTIS;
  const API = "https://api.github.com";
  const PLATFORMS = [
    ["instagram", "인스타"], ["threads", "쓰레드"], ["youtube", "유튜브"],
    ["tiktok", "틱톡"], ["naver", "네이버 클립"], ["xhs", "샤오홍슈"],
  ];
  const IMG_EXT = ["png", "jpg", "jpeg", "webp"];
  const $ = (id) => document.getElementById(id);

  let token = null;
  let headSha = null;     // 지금 보고 있는 main 브랜치 커밋
  let posts = [];         // 저장소의 게시물 폴더들
  let editing = null;     // 수정 중인 게시물 (없으면 새 게시물)
  let cards = [], zhCards = [];
  let format = "carousel";   // "carousel" = 카드, "reel" = 릴스 영상
  let reel = null;           // { src, file?, sha?, w, h, sec, size }
  const REEL = "reel.mp4";
  const REEL_MAX_MB = 95;    // GitHub 파일 한도 100MB
  let month = new Date(); month.setDate(1);
  let jobs = [];             // 릴스 만들기 작업 폴더들 (studio/이름/)
  let musicTracks = [];      // assets/music/*.mp3
  let fromStudio = null;     // 릴스 만들기에서 넘어온 작업 (예약하면 작업 폴더를 지움)

  // ---------- 공통 ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayKST = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");
  const rawUrl = (path) => `https://raw.githubusercontent.com/${CFG.repo}/${headSha}/${encPath(path)}`;
  const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true });

  function toast(text, ms = 3000) {
    const t = $("toast"); t.textContent = text; t.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => (t.hidden = true), ms);
  }
  function setMsg(el, text, kind = "") { el.textContent = text; el.className = `msg ${kind}`; }

  async function gh(path, opts = {}) {
    const res = await fetch(API + path, {
      // GitHub 은 응답을 60초 동안 브라우저에 저장해 두게 해서, 저장 직후 목록이 옛날 것으로 보일 수 있다
      cache: "no-store",
      ...opts,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: `Bearer ${token}`,
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
        ...opts.headers,
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401) { logout("로그인이 만료됐어요. 다시 로그인해 주세요."); throw new Error("401"); }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const err = new Error(data.message || `GitHub 오류 ${res.status}`);
      err.status = res.status; throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  // ---------- 로그인 ----------
  function readHash() {
    if (!location.hash.includes("=")) return;
    const p = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, "", location.pathname + location.search);
    if (p.get("token")) localStorage.setItem("mentis_token", p.get("token"));
    if (p.get("error")) setMsg($("loginMsg"), p.get("error"), "err");
  }

  function logout(msg) {
    localStorage.removeItem("mentis_token"); token = null;
    $("app").hidden = true; $("login").hidden = false; $("who").innerHTML = "";
    if (msg) setMsg($("loginMsg"), msg, "err");
  }

  async function start() {
    readHash();
    $("loginBtn").href = `${CFG.authUrl}/login`;
    if (CFG.authUrl.includes("여기에")) setMsg($("loginMsg"), "아직 로그인 설정 전이에요. (config.js 의 authUrl)", "err");
    token = localStorage.getItem("mentis_token");
    if (!token) { $("login").hidden = false; return; }
    try {
      const [me, repo] = await Promise.all([gh("/user"), gh(`/repos/${CFG.repo}`)]);
      if (!repo.permissions?.push) {
        logout(`@${me.login} 계정은 아직 저장소 쓰기 권한이 없어요. 초대 메일을 수락했는지 확인해 주세요.`);
        return;
      }
      $("who").innerHTML = `<img src="${esc(me.avatar_url)}" alt=""> @${esc(me.login)} <button class="btn ghost small" id="logout">로그아웃</button>`;
      $("logout").onclick = () => logout();
      $("login").hidden = true; $("app").hidden = false;
      await loadRepo();
      resetEditor();
    } catch (e) {
      if (e.message !== "401") logout(`불러오기 실패: ${e.message}`);
    }
  }

  // ---------- 저장소 읽기 ----------
  async function loadRepo() {
    const ref = await gh(`/repos/${CFG.repo}/git/ref/heads/${CFG.branch}`);
    headSha = ref.object.sha;
    const tree = await gh(`/repos/${CFG.repo}/git/trees/${headSha}?recursive=1`);
    const byFolder = new Map(), byJob = new Map();
    musicTracks = [];
    for (const e of tree.tree) {
      if (e.type !== "blob") continue;
      const mm = e.path.match(/^assets\/music\/([^/]+\.mp3)$/i);
      if (mm) musicTracks.push(mm[1]);
      const sj = e.path.match(/^studio\/([^/]+)\/([^/]+)$/);
      if (sj) {
        if (!byJob.has(sj[1])) byJob.set(sj[1], { folder: `studio/${sj[1]}`, name: sj[1], files: {} });
        byJob.get(sj[1]).files[sj[2]] = e.sha;
        continue;
      }
      const m = e.path.match(/^(queue|published)\/([^/]+)\/(.+)$/);
      if (!m) continue;
      const key = `${m[1]}/${m[2]}`;
      if (!byFolder.has(key)) {
        const d = m[2].match(/^(\d{4}-\d{2}-\d{2})_?(.*)$/);
        byFolder.set(key, { folder: key, area: m[1], name: m[2], date: d ? d[1] : null, slug: d ? d[2] : m[2], files: {} });
      }
      byFolder.get(key).files[m[3]] = e.sha;
    }
    posts = [...byFolder.values()];
    jobs = [...byJob.values()].sort((a, b) => natural(a.name, b.name));
    renderSchedule();
    renderResults();
    window.MENTIS_STUDIO?.refresh();
  }

  function cardFiles(post, sub = "") {
    return Object.keys(post.files)
      .filter((f) => {
        const rest = sub ? f.startsWith(sub + "/") && f.slice(sub.length + 1) : f;
        return rest && !rest.includes("/") && IMG_EXT.includes(rest.split(".").pop().toLowerCase());
      })
      .sort((a, b) => (/cover/i.test(b) - /cover/i.test(a)) || natural(a, b));
  }
  const coverUrl = (post) => { const f = cardFiles(post)[0]; return f ? rawUrl(`${post.folder}/${f}`) : ""; };
  const isReel = (post) => !!post.files[REEL];
  // 목록·달력 썸네일: 릴스는 영상 표시, 카드는 표지 이미지
  const thumb = (post) => isReel(post) ? `<span class="reelthumb">🎬</span>`
    : `<img src="${esc(coverUrl(post))}" alt="" loading="lazy">`;

  const blobCache = new Map();
  async function readJson(post, file) {
    const sha = post.files[file];
    if (!sha) return null;
    if (!blobCache.has(sha)) {
      blobCache.set(sha, gh(`/repos/${CFG.repo}/git/blobs/${sha}`).then((b) => {
        const bytes = Uint8Array.from(atob(b.content.replace(/\n/g, "")), (c) => c.charCodeAt(0));
        return JSON.parse(new TextDecoder().decode(bytes));
      }));
    }
    return blobCache.get(sha);
  }

  // ---------- 저장소 쓰기 (여러 파일을 커밋 하나로) ----------
  const fileB64 = (f) => new Promise((ok, no) => {
    const r = new FileReader(); r.onload = () => ok(r.result.split(",")[1]); r.onerror = no; r.readAsDataURL(f);
  });

  // changes: [{ path, sha }] (기존 파일 유지/이동), { path, file } (새 이미지), { path, text }, { path, sha: null } (삭제)
  async function commit(message, changes, progress) {
    const entries = [];
    let n = 0;
    for (const c of changes) {
      let sha = c.sha;
      if (c.file) {
        progress?.(`파일 올리는 중 ${++n}/${changes.filter((x) => x.file).length}${c.file.size > 5e6 ? " (영상은 1~2분 걸릴 수 있어요)" : ""}`);
        sha = (await gh(`/repos/${CFG.repo}/git/blobs`, { method: "POST", body: { content: await fileB64(c.file), encoding: "base64" } })).sha;
      } else if (c.text != null) {
        sha = (await gh(`/repos/${CFG.repo}/git/blobs`, { method: "POST", body: { content: c.text, encoding: "utf-8" } })).sha;
      }
      entries.push({ path: c.path, mode: "100644", type: "blob", sha });
    }
    progress?.("저장 중…");
    // 그사이 자동 발행 봇이 커밋했으면 최신 위에 다시 쌓는다
    for (let attempt = 0; attempt < 3; attempt++) {
      const ref = await gh(`/repos/${CFG.repo}/git/ref/heads/${CFG.branch}`);
      const base = await gh(`/repos/${CFG.repo}/git/commits/${ref.object.sha}`);
      const tree = await gh(`/repos/${CFG.repo}/git/trees`, { method: "POST", body: { base_tree: base.tree.sha, tree: entries } });
      const c = await gh(`/repos/${CFG.repo}/git/commits`, { method: "POST", body: { message, tree: tree.sha, parents: [ref.object.sha] } });
      try {
        await gh(`/repos/${CFG.repo}/git/refs/heads/${CFG.branch}`, { method: "PATCH", body: { sha: c.sha } });
        return;
      } catch (e) {
        if (e.status !== 422 || attempt === 2) throw e;
      }
    }
  }

  // ---------- 편집기 ----------
  function slugify(s) {
    return s.trim().replace(/\s+/g, "-").replace(/[\\/:*?"<>|#%&{}^~[\]`'.,]/g, "").replace(/^-+|-+$/g, "").slice(0, 40);
  }

  function makeCard(src, { file = null, sha = null, ext }) {
    const c = { id: Math.random().toString(36).slice(2), src, file, sha, ext, w: 0, h: 0 };
    const img = new Image();
    img.onload = () => { c.w = img.naturalWidth; c.h = img.naturalHeight; renderCards(); };
    img.src = src;
    return c;
  }

  function addFiles(list, target, max) {
    const files = [...list].filter((f) => IMG_EXT.includes(f.name.split(".").pop().toLowerCase()))
      .sort((a, b) => natural(a.name, b.name));
    for (const f of files) {
      if (target.length >= max) { toast(`최대 ${max}장까지예요`); break; }
      target.push(makeCard(URL.createObjectURL(f), { file: f, ext: f.name.split(".").pop().toLowerCase() }));
    }
    renderCards();
  }

  function renderCardList(el, list, isMain) {
    el.innerHTML = list.map((c, i) => {
      const bad = c.w && (Math.abs(c.w / c.h - 0.8) > 0.01 || c.w < 1080);
      const tag = isMain ? (i === 0 ? "표지" : i) : i + 1;
      return `<div class="card ${bad ? "bad" : ""} ${isMain && i === 0 ? "cover" : ""}" data-id="${c.id}">
        <img src="${esc(c.src)}" alt=""><span class="tag">${tag}</span>
        <button class="x" title="빼기" data-x="${c.id}">×</button>
        <span class="size">${c.w ? `${c.w}×${c.h}` : "…"}</span></div>`;
    }).join("");
    el.querySelectorAll("[data-x]").forEach((b) => (b.onclick = () => {
      const i = list.findIndex((c) => c.id === b.dataset.x); list.splice(i, 1); renderCards();
    }));
  }

  function setReel(src, extra) {
    reel = { src, w: 0, h: 0, sec: 0, ...extra };
    const v = document.createElement("video");
    v.preload = "metadata"; v.muted = true; v.src = src;
    v.onloadedmetadata = () => { reel.w = v.videoWidth; reel.h = v.videoHeight; reel.sec = v.duration; renderReel(); };
    renderReel();
  }

  function renderReel() {
    const box = $("reelPreview");
    if (!reel) { box.innerHTML = ""; $("reelDrop").hidden = false; checkMedia(); return; }
    const mb = reel.size ? `${(reel.size / 1048576).toFixed(1)}MB · ` : "";
    box.innerHTML = `<div class="reel"><video src="${esc(reel.src)}" controls muted playsinline></video>
      <div class="meta">${reel.w ? `${reel.w}×${reel.h} · ${Math.round(reel.sec)}초` : "불러오는 중…"}<br>${mb}reel.mp4<br>
      <button class="btn ghost small" id="reelRemove">영상 빼기</button></div></div>`;
    $("reelRemove").onclick = () => { reel = null; renderReel(); };
    $("reelDrop").hidden = true;
    checkMedia();
  }

  function addReel(list) {
    const f = [...list].find((x) => /\.mp4$/i.test(x.name) || x.type === "video/mp4");
    if (!f) return toast("mp4 영상만 올릴 수 있어요");
    if (f.size > REEL_MAX_MB * 1048576) return toast(`영상이 ${REEL_MAX_MB}MB 를 넘어요. 용량을 줄여 주세요.`, 5000);
    setReel(URL.createObjectURL(f), { file: f, size: f.size });
  }

  function setStyle(s) {
    document.querySelectorAll("input[name=style]").forEach((i) => (i.checked = i.value === (s || "세딸")));
  }

  function setFormat(f) {
    format = f;
    document.querySelectorAll("#format button").forEach((b) => b.classList.toggle("on", b.dataset.format === f));
    $("carouselBox").hidden = f !== "carousel";
    $("reelBox").hidden = f !== "reel";
    $("threadsBox").hidden = f === "reel";
    $("zhBox").hidden = f === "reel";
    $("styleBox").hidden = f !== "reel";
    $("formatHint").textContent = f === "reel"
      ? "인스타 릴스 + 유튜브 쇼츠·틱톡·네이버 클립·샤오홍슈(영상 노트)에 같은 영상이 올라가요. 쓰레드는 제외."
      : "인스타 캐러셀 + 쓰레드 글 + 카드로 만든 영상(유튜브·틱톡·네이버) + 샤오홍슈 이미지 노트.";
    renderPlatforms(selectedPlatforms().length ? selectedPlatforms() : PLATFORMS.map(([k]) => k));
    checkMedia();
  }

  function checkMedia() {
    if (format === "reel") {
      const w = [];
      if (reel?.w && Math.abs(reel.w / reel.h - 9 / 16) > 0.02) w.push(`영상이 ${reel.w}×${reel.h} 이에요. 세로 9:16(1080×1920)이 아니면 릴스·쇼츠에서 잘리거나 여백이 생겨요.`);
      if (reel?.sec > 180) w.push(`영상이 ${Math.round(reel.sec)}초예요. 유튜브 쇼츠는 3분까지만 쇼츠로 올라가요.`);
      $("cardWarn").textContent = w.join("\n");
    } else {
      const warns = cards.filter((c) => c.w && (Math.abs(c.w / c.h - 0.8) > 0.01 || c.w < 1080))
        .map((c) => `카드 ${cards.indexOf(c) === 0 ? "표지" : cards.indexOf(c)}: ${c.w}×${c.h} → 4:5(1080×1350)가 아니라 인스타·쇼츠에서 잘리거나 여백이 생길 수 있어요`);
      $("cardWarn").textContent = warns.join("\n");
    }
    checkPlatforms();
  }

  function renderCards() {
    renderCardList($("cards"), cards, true);
    renderCardList($("zhCards"), zhCards, false);
    checkMedia();
  }

  function sortableFor(el, list) {
    if (!window.Sortable) return;
    Sortable.create(el, {
      animation: 150, filter: ".x",
      onEnd: () => {
        const order = [...el.children].map((n) => n.dataset.id);
        list.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
        renderCards();
      },
    });
  }

  function setupDrop(zone, input, getList, max) {
    input.onchange = () => { addFiles(input.files, getList(), max); input.value = ""; };
    zone.ondragover = (e) => { e.preventDefault(); zone.classList.add("over"); };
    zone.ondragleave = () => zone.classList.remove("over");
    zone.ondrop = (e) => { e.preventDefault(); zone.classList.remove("over"); addFiles(e.dataTransfer.files, getList(), max); };
  }

  function renderPlatforms(selected) {
    $("platforms").innerHTML = PLATFORMS.filter(([k]) => !(format === "reel" && k === "threads")).map(([k, label]) =>
      `<label><input type="checkbox" value="${k}" ${selected.includes(k) ? "checked" : ""}> ${label}</label>`).join("");
    $("platforms").querySelectorAll("input").forEach((i) => (i.onchange = checkPlatforms));
  }
  const selectedPlatforms = () => [...$("platforms").querySelectorAll("input:checked")].map((i) => i.value);

  function checkPlatforms() {
    const p = selectedPlatforms(), w = [];
    const zhOk = format === "reel" || zhCards.length;
    if (p.includes("xhs") && (!zhOk || !$("xhsTitle").value.trim() || !$("xhsBody").value.trim())) {
      w.push(format === "reel" ? "샤오홍슈: 중국어 제목·본문이 있어야 올라가요. 없으면 그 날은 건너뛰어요."
        : "샤오홍슈: 중국어 카드·제목·본문이 모두 있어야 올라가요. 없으면 그 날은 건너뛰어요.");
    }
    if (p.includes("threads") && !$("threads").value.trim()) w.push("쓰레드: 글이 비어 있어서 건너뛰어요.");
    $("platWarn").textContent = w.join("\n");
  }

  function checkDate() {
    const d = $("date").value, w = [];
    if (d && d < todayKST()) w.push("지난 날짜예요. 다음 자동 발행 때 바로 올라가요.");
    const same = posts.filter((p) => p.area === "queue" && p.date === d && p.folder !== editing?.folder);
    if (d && same.length) w.push(`같은 날 예약이 이미 있어요 (${same.map((p) => p.slug).join(", ")}). 하루에 1개씩 올라가서 하나는 다음 날로 밀려요.`);
    $("dateWarn").textContent = w.join("\n");
  }

  function resetEditor(date) {
    editing = null; cards = []; zhCards = []; reel = null; fromStudio = null;
    $("editTitle").textContent = "새 게시물";
    $("cancelEdit").hidden = true; $("deletePost").hidden = true;
    $("save").textContent = "예약하기";
    for (const id of ["slug", "caption", "threads", "ytTitle", "nvTitle", "xhsTitle", "xhsBody", "xhsTags"]) $(id).value = "";
    $("threadsCover").checked = false;
    $("date").value = date || nextFreeDate();
    $("xhsBox").open = false;
    format = "carousel";
    setStyle("세딸");
    renderPlatforms(PLATFORMS.map(([k]) => k));
    setFormat("carousel");
    setMsg($("saveMsg"), "");
    renderCards(); renderReel(); checkDate(); updateXhsCount();
  }

  function nextFreeDate() {
    const taken = new Set(posts.filter((p) => p.area === "queue").map((p) => p.date));
    const d = new Date(todayKST() + "T00:00:00");
    while (taken.has(ymd(d))) d.setDate(d.getDate() + 1);
    return ymd(d);
  }

  async function openPost(post) {
    showTab("new");
    setMsg($("saveMsg"), "불러오는 중…");
    const data = (await readJson(post, "post.json")) || {};
    editing = post;
    $("editTitle").textContent = `수정: ${post.name}`;
    $("cancelEdit").hidden = false; $("deletePost").hidden = false;
    $("save").textContent = "수정 저장";
    $("date").value = post.date || ""; $("slug").value = post.slug;
    $("caption").value = data.caption || "";
    const th = Array.isArray(data.threads) ? data.threads : data.threads ? [data.threads] : [];
    $("threads").value = th.join("\n---\n");
    $("threadsCover").checked = !!data.threads_with_cover;
    $("ytTitle").value = data.youtube?.title || "";
    $("nvTitle").value = data.naver?.title || "";
    $("xhsTitle").value = data.xhs?.title || "";
    $("xhsBody").value = data.xhs?.body || "";
    $("xhsTags").value = (data.xhs?.tags || []).join(", ");
    format = isReel(post) ? "reel" : "carousel";
    setStyle(data.style);
    renderPlatforms(data.platforms || PLATFORMS.map(([k]) => k));
    setFormat(format);
    reel = null;
    if (isReel(post)) setReel(rawUrl(`${post.folder}/${REEL}`), { sha: post.files[REEL] });
    else renderReel();
    const load = (f) => makeCard(rawUrl(`${post.folder}/${f}`), { sha: post.files[f], ext: f.split(".").pop().toLowerCase() });
    cards = cardFiles(post).map(load);
    zhCards = cardFiles(post, "zh").map(load);
    $("xhsBox").open = zhCards.length > 0 || !!data.xhs?.title;
    setMsg($("saveMsg"), "");
    renderCards(); checkDate(); updateXhsCount();
    window.scrollTo(0, 0);
  }

  function updateXhsCount() {
    const n = [...$("xhsTitle").value].length;
    $("xhsCount").textContent = `${n}/20`;
    $("xhsCount").style.color = n > 20 ? "var(--danger)" : "";
  }

  function buildPostJson() {
    const post = { platforms: selectedPlatforms(), caption: $("caption").value.trim() };
    if (format === "reel") {
      post.type = "reel";
      // 리포트가 포맷별(세딸·직촬·캐러셀) 저장·공유율을 비교하는 데 쓴다
      post.style = document.querySelector("input[name=style]:checked")?.value || "세딸";
    } else {
      const threads = $("threads").value.split(/^\s*---\s*$/m).map((s) => s.trim()).filter(Boolean);
      if (threads.length) post.threads = threads;
      post.threads_with_cover = $("threadsCover").checked;
    }
    if ($("ytTitle").value.trim()) post.youtube = { title: $("ytTitle").value.trim() };
    if ($("nvTitle").value.trim()) post.naver = { title: $("nvTitle").value.trim() };
    const tags = $("xhsTags").value.split(/[,，\n]/).map((t) => t.trim().replace(/^#/, "")).filter(Boolean);
    if ($("xhsTitle").value.trim() || $("xhsBody").value.trim() || tags.length) {
      post.xhs = { title: $("xhsTitle").value.trim(), body: $("xhsBody").value.trim(), tags };
    }
    return post;
  }

  async function save() {
    const date = $("date").value, slug = slugify($("slug").value);
    const err = (t) => setMsg($("saveMsg"), t, "err");
    if (format === "reel" && !reel) return err("릴스 영상(mp4)을 넣어 주세요.");
    if (format === "carousel" && !cards.length) return err("카드를 1장 이상 넣어 주세요.");
    if (!date) return err("발행 날짜를 골라 주세요.");
    if (!slug) return err("주제(폴더 이름)를 적어 주세요.");
    if (!selectedPlatforms().length) return err("올릴 곳을 하나 이상 골라 주세요.");
    if (selectedPlatforms().includes("instagram") && !$("caption").value.trim()) return err("인스타 캡션이 비어 있어요.");
    if ([...$("xhsTitle").value.trim()].length > 20) return err("샤오홍슈 제목은 20자 이내여야 해요.");

    const folder = `queue/${date}_${slug}`;
    if (folder !== editing?.folder && posts.some((p) => p.folder === folder)) return err("같은 날짜·주제의 게시물이 이미 있어요. 주제 이름을 바꿔 주세요.");

    const want = new Map(); // path → change
    const put = (path, c) => want.set(path, { path, ...c });
    if (format === "reel") {
      put(`${folder}/${REEL}`, reel.file ? { file: reel.file } : { sha: reel.sha });
      // 릴스 만들기에서 만든 썸네일(인스타 릴스 커버)도 같이
      const cover = fromStudio?.files["cover.jpg"] || editing?.files["cover.jpg"];
      if (cover) put(`${folder}/cover.jpg`, { sha: cover });
      // 만든 설정(자막·스타일·썸네일·Claude 초안)도 reel-make/ 에 같이 남긴다 → 세딸 자동 제작이 다음에 참고하는 예시가 된다
      for (const f of ["job.json", "subs.json", "thumb.json", "auto.json", "draft.json"]) {
        const sha = fromStudio?.files[f] || editing?.files[`reel-make/${f}`];
        if (sha) put(`${folder}/reel-make/${f}`, { sha });
      }
    } else {
      cards.forEach((c, i) => put(`${folder}/${i === 0 ? "00_cover" : pad(i)}.${c.ext}`, c.file ? { file: c.file } : { sha: c.sha }));
      zhCards.forEach((c, i) => put(`${folder}/zh/${i === 0 ? "00_cover" : pad(i)}.${c.ext}`, c.file ? { file: c.file } : { sha: c.sha }));
    }
    put(`${folder}/post.json`, { text: JSON.stringify(buildPostJson(), null, 2) + "\n" });
    // 일부 플랫폼만 성공한 게시물이면 기록(result.json)을 같이 옮겨서 성공한 곳에 두 번 올라가지 않게 한다
    if (editing?.files["result.json"]) put(`${folder}/result.json`, { sha: editing.files["result.json"] });

    const changes = [...want.values()];
    // 릴스 만들기 작업은 예약하면 원본째 지운다 (완성본은 위에서 queue/ 로 옮김)
    if (fromStudio) for (const f of Object.keys(fromStudio.files)) changes.push({ path: `${fromStudio.folder}/${f}`, sha: null });
    // 기존 폴더에서 이제 필요 없는 파일 지우기 (_jpg 변환본도 순서가 바뀌었을 수 있어서 지움)
    if (editing) {
      for (const f of Object.keys(editing.files)) {
        const p = `${editing.folder}/${f}`;
        if (!want.has(p)) changes.push({ path: p, sha: null });
      }
    }

    const btn = $("save"); btn.disabled = true;
    try {
      const verb = editing ? "수정" : "예약";
      await commit(`upload tool: ${verb} ${date}_${slug}`, changes, (t) => setMsg($("saveMsg"), t));
      await loadRepo();
      toast(`${date} 에 ${verb}됐어요`);
      resetEditor();
      setMsg($("saveMsg"), `✓ ${folder} 에 ${verb}됐어요.`, "ok");
    } catch (e) {
      if (e.message !== "401") err(`저장 실패: ${e.message}`);
    } finally {
      btn.disabled = false;
    }
  }

  async function deletePost(post) {
    if (!confirm(`'${post.name}' 예약을 삭제할까요?\n(GitHub 기록에는 남아서 나중에 되살릴 수 있어요)`)) return;
    try {
      await commit(`upload tool: 삭제 ${post.name}`, Object.keys(post.files).map((f) => ({ path: `${post.folder}/${f}`, sha: null })));
      await loadRepo(); resetEditor(); toast("삭제했어요");
    } catch (e) { if (e.message !== "401") toast(`삭제 실패: ${e.message}`, 5000); }
  }

  async function movePost(post, date) {
    const folder = `queue/${date}_${post.slug}`;
    if (folder === post.folder) return;
    if (posts.some((p) => p.folder === folder)) return toast("그 날짜에 같은 주제가 이미 있어요");
    const changes = [];
    for (const [f, sha] of Object.entries(post.files)) {
      changes.push({ path: `${post.folder}/${f}`, sha: null });
      if (!f.startsWith("_jpg/")) changes.push({ path: `${folder}/${f}`, sha });
    }
    toast("날짜 바꾸는 중…");
    try {
      await commit(`upload tool: ${post.name} → ${date}`, changes);
      await loadRepo(); toast(`${date} 로 옮겼어요`);
    } catch (e) { if (e.message !== "401") toast(`옮기기 실패: ${e.message}`, 5000); }
  }

  // ---------- 예약 목록 ----------
  function renderSchedule() {
    const y = month.getFullYear(), m = month.getMonth();
    $("monthLabel").textContent = `${y}년 ${m + 1}월`;
    const first = new Date(y, m, 1), startDay = new Date(first); startDay.setDate(1 - first.getDay());
    const today = todayKST();
    const byDate = {};
    for (const p of posts) if (p.date) (byDate[p.date] ||= []).push(p);

    let html = "일월화수목금토".split("").map((d) => `<div class="dow">${d}</div>`).join("");
    for (let i = 0; i < 42; i++) {
      const d = new Date(startDay); d.setDate(startDay.getDate() + i);
      const key = ymd(d), list = byDate[key] || [];
      const queued = list.filter((p) => p.area === "queue");
      html += `<div class="day ${d.getMonth() !== m ? "other" : ""} ${key === today ? "today" : ""}" data-date="${key}">
        <div class="num">${d.getDate()}</div>
        ${list.map((p) => `<span class="post ${p.area === "published" ? "done" : ""} ${p.area === "queue" && queued.length > 1 ? "dup" : ""}"
          data-folder="${esc(p.folder)}" draggable="${p.area === "queue"}" title="${esc(p.name)}">
          ${thumb(p)}</span>`).join("")}
      </div>`;
    }
    $("calendar").innerHTML = html;

    $("calendar").querySelectorAll(".day").forEach((day) => {
      day.onclick = (e) => {
        const el = e.target.closest(".post");
        const post = el && posts.find((p) => p.folder === el.dataset.folder);
        if (post?.area === "queue") openPost(post);
        else if (post) showTab("results");
        else if (day.dataset.date >= today) { resetEditor(day.dataset.date); showTab("new"); }
      };
      day.ondragover = (e) => { e.preventDefault(); day.classList.add("over"); };
      day.ondragleave = () => day.classList.remove("over");
      day.ondrop = (e) => {
        e.preventDefault(); day.classList.remove("over");
        const post = posts.find((p) => p.folder === e.dataTransfer.getData("text/plain"));
        if (post) movePost(post, day.dataset.date);
      };
    });
    $("calendar").querySelectorAll(".post[draggable=true]").forEach((el) => {
      el.ondragstart = (e) => e.dataTransfer.setData("text/plain", el.dataset.folder);
    });

    const queue = posts.filter((p) => p.area === "queue").sort((a, b) => natural(a.name, b.name));
    $("queueList").innerHTML = queue.length ? queue.map((p) => `
      <div class="item click" data-folder="${esc(p.folder)}">
        ${thumb(p)}
        <div class="body"><div class="name">${esc(p.slug)}</div>
          <div class="sub">${p.date || "날짜 없음 (이름 순서대로 발행)"} · ${isReel(p) ? "릴스" : `카드 ${cardFiles(p).length}장`}${p.files["result.json"] ? " · 일부 실패, 재시도 대기" : ""}</div></div>
      </div>`).join("") : `<p class="hint">예약된 게시물이 없어요.</p>`;
    $("queueList").querySelectorAll(".item").forEach((el) => (el.onclick = () => openPost(posts.find((p) => p.folder === el.dataset.folder))));
  }

  // ---------- 발행 결과 ----------
  const RESULT_LABEL = { instagram: "인스타", threads: "쓰레드", youtube: "유튜브", tiktok: "틱톡", outbox: "네이버·샤오홍슈 파일" };

  async function renderResults() {
    const done = posts.filter((p) => p.files["result.json"]).sort((a, b) => natural(b.name, a.name)).slice(0, 30);
    if (!done.length) { $("resultList").innerHTML = `<p class="hint">아직 발행 기록이 없어요.</p>`; return; }
    const rows = await Promise.all(done.map(async (p) => {
      const r = await readJson(p, "result.json").catch(() => null) || {};
      const plats = Object.entries(RESULT_LABEL).filter(([k]) => r[k]).map(([k, label]) => {
        const v = r[k];
        if (!v.ok) return `<span class="plat fail" title="${esc(v.error)}">✗ ${label}</span>`;
        const link = v.permalink || v.url;
        const extra = k === "tiktok" ? " (임시저장함)" : k === "outbox" ? ` (${(v.platforms || []).join(", ") || "없음"})` : "";
        return link ? `<a class="plat ok" href="${esc(link)}" target="_blank" rel="noopener">✓ ${label}</a>`
                    : `<span class="plat ok">✓ ${label}${esc(extra)}</span>`;
      }).join("");
      const errors = Object.entries(RESULT_LABEL).filter(([k]) => r[k] && !r[k].ok)
        .map(([k, label]) => `${label}: ${String(r[k].error).slice(0, 160)}`).join("<br>");
      return `<div class="item">
        ${thumb(p)}
        <div class="body"><div class="name">${esc(p.name)}</div>
          <div class="sub">${p.area === "queue" ? "일부 실패 · 다음 자동 발행 때 재시도" : "완료"}${r.updated_at ? " · " + esc(r.updated_at.replace("T", " ").slice(0, 16)) : ""}</div>
          <div class="plats">${plats}</div>
          ${errors ? `<div class="sub" style="color:var(--danger)">${errors}</div>` : ""}</div>
      </div>`;
    }));
    $("resultList").innerHTML = rows.join("");
  }

  // ---------- 도구 ----------
  async function runWorkflow(mode) {
    if (mode === "publish" && !confirm("지금 바로 다음 게시물 1개를 실제로 발행할까요?")) return;
    setMsg($("runMsg"), "실행 요청 중…");
    try {
      await gh(`/repos/${CFG.repo}/actions/workflows/publish.yml/dispatches`, { method: "POST", body: { ref: CFG.branch, inputs: { mode } } });
      setMsg($("runMsg"), "실행을 시작했어요. 1~3분 뒤 아래 목록에서 결과 확인 (로그는 GitHub에서).", "ok");
      setTimeout(loadRuns, 4000);
    } catch (e) { if (e.message !== "401") setMsg($("runMsg"), `실행 실패: ${e.message}`, "err"); }
  }

  async function loadRuns() {
    try {
      const data = await gh(`/repos/${CFG.repo}/actions/workflows/publish.yml/runs?per_page=8`);
      const state = (r) => r.status !== "completed" ? "⏳ 실행 중" : r.conclusion === "success" ? "✓ 성공" : `✗ ${r.conclusion}`;
      $("runs").innerHTML = data.workflow_runs.map((r) => `
        <a class="item" href="${esc(r.html_url)}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">
          <div class="body"><div class="name">${state(r)}</div>
          <div class="sub">${r.event === "schedule" ? "자동 발행" : "수동 실행"} · ${new Date(r.created_at).toLocaleString("ko-KR")}</div></div>
        </a>`).join("") || `<p class="hint">실행 기록이 없어요.</p>`;
    } catch (e) { if (e.message !== "401") $("runs").textContent = `불러오기 실패: ${e.message}`; }
  }

  // ---------- 탭 ----------
  function showTab(name) {
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
    document.querySelectorAll(".tab").forEach((t) => (t.hidden = t.id !== `tab-${name}`));
    if (name === "tools") loadRuns();
    if (name === "studio") window.MENTIS_STUDIO?.refresh();
  }

  // 릴스 만들기 → 완성본을 새 게시물(릴스) 화면에 채워서 예약으로 넘긴다
  function scheduleFromStudio(job, { slug, caption }) {
    resetEditor();
    setFormat("reel");
    setReel(rawUrl(`${job.folder}/${REEL}`), { sha: job.files[REEL] });
    $("slug").value = slug; $("caption").value = caption;
    fromStudio = job;
    $("editTitle").textContent = `새 게시물 (릴스 만들기: ${job.name})`;
    $("cancelEdit").hidden = false;
    showTab("new");
    window.scrollTo(0, 0);
  }

  // studio.js(릴스 만들기 탭)가 쓰는 공통 기능
  window.MENTIS_APP = {
    gh, commit, readJson, rawUrl, esc, toast, setMsg, slugify, showTab, loadRepo, scheduleFromStudio,
    jobs: () => jobs, musicTracks: () => musicTracks,
  };

  // ---------- 연결 ----------
  document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  setupDrop($("drop"), $("fileInput"), () => cards, 20);
  setupDrop($("zhDrop"), $("zhInput"), () => zhCards, 18);
  $("reelInput").onchange = () => { addReel($("reelInput").files); $("reelInput").value = ""; };
  $("reelDrop").ondragover = (e) => { e.preventDefault(); $("reelDrop").classList.add("over"); };
  $("reelDrop").ondragleave = () => $("reelDrop").classList.remove("over");
  $("reelDrop").ondrop = (e) => { e.preventDefault(); $("reelDrop").classList.remove("over"); addReel(e.dataTransfer.files); };
  document.querySelectorAll("#format button").forEach((b) => (b.onclick = () => setFormat(b.dataset.format)));
  sortableFor($("cards"), { sort: (f) => cards.sort(f) });
  sortableFor($("zhCards"), { sort: (f) => zhCards.sort(f) });
  $("save").onclick = save;
  $("cancelEdit").onclick = () => resetEditor();
  $("deletePost").onclick = () => editing && deletePost(editing);
  $("date").onchange = checkDate;
  $("xhsTitle").oninput = () => { updateXhsCount(); checkPlatforms(); };
  $("xhsBody").oninput = checkPlatforms;
  $("threads").oninput = checkPlatforms;
  $("prevMonth").onclick = () => { month.setMonth(month.getMonth() - 1); renderSchedule(); };
  $("nextMonth").onclick = () => { month.setMonth(month.getMonth() + 1); renderSchedule(); };
  document.querySelectorAll("[data-run]").forEach((b) => (b.onclick = () => runWorkflow(b.dataset.run)));
  $("refreshRuns").onclick = loadRuns;
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  start();
})();
