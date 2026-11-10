// 세딸 자동 제작 (릴스 만들기 탭 위쪽)
// 영상함에 넣기 → studio/작업/ 에 job.json(auto: true) + 원본 커밋 → 자막 만들기 실행
// → Claude 예약 작업(docs/reel-auto-routine.md)이 자막 다듬기·훅·썸네일·캡션·채점 → auto.json 커밋
// → reel-auto.yml 이 완성본을 만든다 → 여기 '후보'에 점수 순으로 뜬다 → '올리기'로 예약 화면에.
(() => {
  const A = window.MENTIS_APP;
  const $ = (id) => document.getElementById(id);
  const esc = A.esc;
  const RAW_MAX_MB = 95;
  const now = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 19) + "+09:00";
  const ext = (f) => f.name.split(".").pop().toLowerCase();
  let inbox = [];   // [{ file, name, handle, permission }]

  // ---------- 후보 ----------
  function stage({ j, s, auto }) {
    if (s?.state === "error") return { label: `✗ ${s.step === "render" ? "릴스 만들기" : "자막 만들기"} 실패: ${s.error || ""}`, cls: "err" };
    if (!auto) return { label: s?.step === "subs" && s?.state === "done" ? "🤖 Claude 제작 기다리는 중 (1시간 안에)" : "⏳ 자막 만드는 중…" };
    if (s?.step === "render" && s?.state === "done" && j.files["reel.mp4"]) return { ready: true };
    return { label: "⏳ 릴스 만드는 중…" };
  }

  function render(rows) {
    const list = rows.filter(({ d }) => d?.auto).map((r) => ({ ...r, st: stage(r) }));
    const score = (r) => (r.st.ready ? r.auto?.score?.total ?? 0 : -1);
    list.sort((a, b) => score(b) - score(a));
    $("stCands").innerHTML = list.length ? list.map(({ j, auto, st }) => {
      if (!st.ready) return `<div class="item"><span class="reelthumb">🎬</span><div class="body">
        <div class="name">${esc(j.name)}</div><div class="sub ${st.cls || ""}">${esc(st.label)}</div></div>
        <button class="btn ghost small" data-del="${esc(j.name)}">빼기</button></div>`;
      const sc = auto.score || {};
      return `<div class="cand">
        <video src="${A.rawUrl(`${j.folder}/reel.mp4`)}" preload="metadata" muted playsinline controls></video>
        <div class="body">
          <div class="row between"><b class="name">${esc((auto.hook || j.name).replace(/\*/g, ""))}</b><span class="score">${sc.total ?? "?"}<small>점</small></span></div>
          <div class="sub">조회 ${sc.views ?? "?"}/40 · 공유 ${sc.share ?? "?"}/30 · 저장 ${sc.save ?? "?"}/30${sc.minus ? ` · 감점 −${sc.minus}` : ""}</div>
          ${auto.reason ? `<p class="why">👍 ${esc(auto.reason)}</p>` : ""}
          ${auto.improve ? `<p class="why">💡 ${esc(auto.improve)}</p>` : ""}
          <div class="row end">
            <button class="btn ghost small" data-del="${esc(j.name)}">빼기</button>
            <button class="btn small" data-open="${esc(j.name)}">열어서 고치기</button>
            <button class="btn primary small" data-go="${esc(j.name)}">올리기</button>
          </div>
        </div></div>`;
    }).join("") : `<p class="hint">아직 후보가 없어요. 아래 영상함에 영상을 넣어 보세요.</p>`;
    const byName = (n) => list.find((r) => r.j.name === n);
    $("stCands").querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => go(byName(b.dataset.go), b)));
    $("stCands").querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => window.MENTIS_STUDIO.openJob(b.dataset.open)));
    $("stCands").querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => drop(byName(b.dataset.del))));
  }

  // 올리기: 저장된 썸네일 설정으로 cover.jpg 를 만들고 → 캡션이 채워진 예약 화면으로 (날짜 고르고 '예약하기')
  async function go(r, btn) {
    btn.disabled = true; btn.textContent = "썸네일 만드는 중…";
    try {
      await window.MENTIS_STUDIO.openJob(r.j.name, true);
      if (!r.j.files["cover.jpg"]) {
        await window.MENTIS_THUMB.saveCover(r.j);
        await A.loadRepo();
      }
      const fresh = A.jobs().find((x) => x.name === r.j.name) || r.j;
      A.scheduleFromStudio(fresh, { slug: r.j.name, caption: r.auto.caption || "" });
      A.toast("날짜를 고르고 '예약하기'를 누르면 끝이에요. 세딸로 예약돼요.", 5000);
    } catch (e) {
      if (e.message !== "401") A.toast(`올리기 실패: ${e.message}`, 6000);
    } finally { btn.disabled = false; btn.textContent = "올리기"; }
  }

  async function drop(r) {
    if (!r || !confirm(`'${r.j.name}' 을(를) 뺄까요?\n(원본·자막·완성본이 모두 지워져요)`)) return;
    try {
      await A.commit(`reel auto: 빼기 ${r.j.name}`, Object.keys(r.j.files).map((f) => ({ path: `${r.j.folder}/${f}`, sha: null })));
      await A.loadRepo(); A.toast("뺐어요");
    } catch (e) { if (e.message !== "401") A.toast(`실패: ${e.message}`, 5000); }
  }

  // ---------- 영상함 ----------
  function addFiles(files) {
    for (const f of files) {
      if (!/^(mp4|mov|m4v)$/.test(ext(f))) { A.toast(`${f.name}: mp4·mov 영상만 넣을 수 있어요`); continue; }
      if (f.size > RAW_MAX_MB * 1048576) { A.toast(`${f.name}: ${RAW_MAX_MB}MB 를 넘어요`, 5000); continue; }
      inbox.push({ file: f, name: A.slugify(f.name.replace(/\.[^.]+$/, "")) || "영상", handle: "", permission: "" });
    }
    renderInbox();
  }

  function renderInbox() {
    $("stInboxFoot").hidden = !inbox.length;
    $("stInboxRows").innerHTML = inbox.map((v, i) => `<div class="inrow" data-i="${i}">
      <div class="name">🎬 ${esc(v.file.name)} <small>${(v.file.size / 1048576).toFixed(1)}MB</small>
        <button class="btn ghost small" data-x="${i}">빼기</button></div>
      <div class="grid3">
        <label>작업 이름<input type="text" data-k="name" value="${esc(v.name)}"></label>
        <label>원작자 계정 <small>캡션에만</small><input type="text" data-k="handle" value="${esc(v.handle)}" placeholder="@drrodpt"></label>
        <label>허락 메모<input type="text" data-k="permission" value="${esc(v.permission)}" placeholder="11/10 인스타 DM 허락"></label>
      </div></div>`).join("");
    $("stInboxRows").querySelectorAll(".inrow input").forEach((el) => (el.oninput = () => { inbox[+el.closest(".inrow").dataset.i][el.dataset.k] = el.value; }));
    $("stInboxRows").querySelectorAll("[data-x]").forEach((b) => (b.onclick = () => { inbox.splice(+b.dataset.x, 1); renderInbox(); }));
  }

  async function start() {
    const err = (t) => A.setMsg($("stInboxMsg"), t, "err");
    const taken = new Set(A.jobs().map((j) => j.name));
    for (const v of inbox) {
      v.name = A.slugify(v.name);
      if (!v.name) return err(`${v.file.name}: 작업 이름을 적어 주세요.`);
      if (taken.has(v.name)) return err(`'${v.name}' 이름이 겹쳐요. 바꿔 주세요.`);
      taken.add(v.name);
      if (!v.handle.trim()) return err(`${v.file.name}: 원작자 계정을 적어 주세요 (캡션 출처 줄에 들어가요).`);
      if (!v.permission.trim()) return err(`${v.file.name}: 허락 메모를 적어 주세요.`);
    }
    if (!$("stInboxAllowed").checked) return err("원작자 허락을 받은 영상만 넣을 수 있어요. 체크해 주세요.");
    const btn = $("stInboxStart"); btn.disabled = true;
    try {
      for (const [i, v] of [...inbox.entries()]) {
        const tag = `(${i + 1}/${inbox.length}) ${v.name}`;
        const data = {
          style: "overseas", auto: true, corner: "", fit: "auto", audio: "original", music: "none", lang: "en",
          raw: `raw.${ext(v.file)}`, lines: "", hook: "", created_at: now(), credit_on: false,
          credit: { handle: v.handle.trim().replace(/^([^@])/, "@$1"), permission: v.permission.trim() },
        };
        const folder = `studio/${v.name}`;
        await A.commit(`reel auto: 영상함 ${v.name}`, [
          { path: `${folder}/${data.raw}`, file: v.file },
          { path: `${folder}/job.json`, text: JSON.stringify(data, null, 2) + "\n" },
          { path: `${folder}/status.json`, text: JSON.stringify({ step: "subs", state: "queued", at: now() }) + "\n" },
        ], (t) => A.setMsg($("stInboxMsg"), `${tag}: ${t}`));
        await window.MENTIS_STUDIO.dispatch(v.name, "subs");
      }
      A.setMsg($("stInboxMsg"), `✓ ${inbox.length}개를 넣었어요. 자막 → Claude 제작·채점 → 완성까지 보통 1~2시간 안에 후보로 떠요.`, "ok");
      inbox = []; renderInbox(); $("stInboxAllowed").checked = false;
      await A.loadRepo();
    } catch (e) {
      if (e.message !== "401") err(`넣기 실패: ${e.message} (앞에 넣은 영상은 그대로 있어요)`);
      await A.loadRepo().catch(() => {});
    } finally { btn.disabled = false; }
  }

  // ---------- 연결 ----------
  const zone = $("stInboxDrop"), input = $("stInboxInput");
  input.onchange = () => { addFiles(input.files); input.value = ""; };
  zone.ondragover = (e) => { e.preventDefault(); zone.classList.add("over"); };
  zone.ondragleave = () => zone.classList.remove("over");
  zone.ondrop = (e) => { e.preventDefault(); zone.classList.remove("over"); addFiles(e.dataTransfer.files); };
  $("stInboxStart").onclick = start;

  window.MENTIS_AUTO = { render };
})();
