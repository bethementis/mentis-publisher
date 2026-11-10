"""
맨티스 릴스 만들기 — 업로드 툴의 '릴스 만들기' 작업 폴더(studio/이름/)를 처리한다.

  python publisher/reelmaker.py subs   studio/이름   # 자막 만들기: 받아쓰기(Whisper) + 번역(DeepL) → subs.json
  python publisher/reelmaker.py render studio/이름   # 릴스 완성: 9:16 + 로고 + 자막 + 크레딧 → reel.mp4 (95MB 이하)

작업 폴더:
  raw.mp4 (또는 raw.mov)  원본 영상. 권리가 있는 영상만 (직접 촬영, 스톡, 원작자 허락)
  voice.m4a/mp3 (선택)     따로 녹음한 목소리. job.json audio 가 "voice" 일 때 원본 소리 대신 깐다
  job.json                 업로드 툴이 쓰는 설정 (style, fit, lang, audio, music, hook, title, credit ...)
  subs.json                자막 (subs 가 만들고, 사용자가 업로드 툴에서 고친다)
  status.json              진행 상태 (업로드 툴이 읽음)
  reel.mp4                 완성본 (render 가 만듦). 예약하면 queue/ 로 옮겨지고 작업 폴더는 지워진다.

스타일(위치·크기·색)은 templates/reel-styles.json.
자막의 *별표로 감싼 말* 은 강조색(노랑)으로 그린다.
DEEPL_API_KEY 는 GitHub Secrets 에만 있다. 절대 출력하지 않는다.
"""
import datetime as dt
import json
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "assets" / "fonts"
MUSIC = ROOT / "assets" / "music"
CONF = json.loads((ROOT / "templates" / "reel-styles.json").read_text(encoding="utf-8"))
W, H, FPS = 1080, 1920, 30
KST = dt.timezone(dt.timedelta(hours=9))
FFMPEG = os.environ.get("FFMPEG", "ffmpeg")


def log(*a):
    print(*a, flush=True)


# ---------- 작업 폴더 ----------
def read_json(path, default=None):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def set_status(job_dir, step, state, **extra):
    write_json(job_dir / "status.json", {"step": step, "state": state,
                                         "at": dt.datetime.now(KST).isoformat(timespec="seconds"), **extra})


def find_file(job_dir, stem):
    for p in sorted(job_dir.glob(stem + ".*")):
        return p
    return None


def load_job(job_dir):
    job = read_json(job_dir / "job.json", {})
    style = CONF["styles"].get(job.get("style"), CONF["styles"]["shoot"])
    job.setdefault("style", "shoot")
    for k in ("lang", "audio", "music"):
        job.setdefault(k, style.get(k))
    job.setdefault("fit", "auto")
    return job, style


# ---------- 영상 정보 ----------
def probe(path):
    """ffmpeg -i 출력에서 길이·크기·소리 유무를 읽는다 (ffprobe 없는 곳에서도 되게)."""
    out = subprocess.run([FFMPEG, "-hide_banner", "-i", str(path)], capture_output=True, text=True,
                         encoding="utf-8", errors="replace").stderr
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", out)
    dur = int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3]) if m else 0.0
    v = re.search(r"Video: .*?(\d{2,5})x(\d{2,5})", out)
    w, h = (int(v[1]), int(v[2])) if v else (0, 0)
    rot = re.search(r"rotation of (-?[\d.]+)", out) or re.search(r"rotate\s*:\s*(-?\d+)", out)
    if rot and abs(round(float(rot[1]))) % 180 == 90:
        w, h = h, w      # 폰 세로 영상: ffmpeg 가 자동으로 돌려서 읽는다
    return {"duration": dur, "w": w, "h": h, "audio": "Audio:" in out}


def total_length(job_dir, job):
    raw = probe(find_file(job_dir, "raw"))
    voice = find_file(job_dir, "voice") if job.get("audio") == "voice" else None
    total = max(raw["duration"], probe(voice)["duration"] if voice else 0)
    return raw, voice, round(total, 2)


# ---------- 자막 만들기 ----------
def spread(lines, total, start=0.0):
    """직접 쓴 줄들을 영상 길이에 맞춰 나눈다 (긴 줄은 오래 보이게)."""
    lines = [l.strip() for l in lines if l.strip()]
    if not lines or total <= start:
        return []
    weights = [len(l) + 6 for l in lines]
    t, out, span = start, [], total - start
    for l, w in zip(lines, weights):
        d = span * w / sum(weights)
        out.append({"start": round(t, 2), "end": round(t + d, 2), "text": l})
        t += d
    return out


def chunk_words(words, max_chars, max_sec=3.6):
    """Whisper 단어 단위 시간을 화면 한 장(최대 2줄)씩 묶는다. 문장 끝이면 끊는다."""
    chunks, cur = [], []
    for w in words:
        text = "".join(x.word for x in cur + [w]).strip()
        if cur and (len(text) > max_chars or w.end - cur[0].start > max_sec):
            chunks.append(cur); cur = []
        cur.append(w)
        if re.search(r"[.?!。？！]$", w.word.strip()):
            chunks.append(cur); cur = []
    if cur:
        chunks.append(cur)
    # "seconds." 처럼 한두 단어만 떨어진 조각은 앞 자막에 붙인다
    merged = []
    for c in chunks:
        if merged and len("".join(x.word for x in c).strip()) < 12 and not re.search(r"[.?!。？！]$", merged[-1][-1].word.strip()):
            merged[-1] = merged[-1] + c
        else:
            merged.append(c)
    chunks = merged
    return [{"start": round(c[0].start, 2), "end": round(c[-1].end, 2),
             "text": "".join(x.word for x in c).strip()} for c in chunks]


def transcribe(audio_src, lang):
    from faster_whisper import WhisperModel   # Actions 에서만 설치 (자막 만들기 단계)
    name = CONF.get("whisper_model", {}).get(lang, "small")
    log(f"받아쓰기: Whisper {name} ({lang})")
    import wave
    import numpy as np
    # ffmpeg 로 만든 16kHz 모노 wav 를 직접 읽어 넘긴다 (faster-whisper 의 PyAV 읽기는 버전에 따라 깨짐)
    with wave.open(str(audio_src)) as f:
        audio = np.frombuffer(f.readframes(f.getnframes()), np.int16).astype(np.float32) / 32768
    model = WhisperModel(name, device="cpu", compute_type="int8")
    segs, _ = model.transcribe(audio, language=lang, word_timestamps=True, vad_filter=True)
    words = [w for s in segs for w in (s.words or [])]
    out = chunk_words(words, 42 if lang == "en" else 28)
    # 화면이 너무 빨리 바뀌지 않게: 다음 자막 직전까지 이어서 보여준다 (최대 0.6초)
    for a, b in zip(out, out[1:]):
        a["end"] = round(min(b["start"], a["end"] + 0.6), 2)
    return out


def translate(texts, context):
    key = os.environ.get("DEEPL_API_KEY", "").strip()
    if not key:
        raise RuntimeError("DEEPL_API_KEY 가 GitHub Secrets 에 없어요")
    import requests
    # 무료 키(끝이 :fx)는 api-free, 그 밖은 api. 플랜 이름이 바뀌어도 되게 안 맞으면 다른 주소로 한 번 더
    hosts = ["api-free.deepl.com", "api.deepl.com"]
    if not key.endswith(":fx"):
        hosts.reverse()
    out = []
    for i in range(0, len(texts), 50):
        for host in hosts:
            r = requests.post(f"https://{host}/v2/translate", timeout=60,
                              headers={"Authorization": f"DeepL-Auth-Key {key}"},
                              json={"text": texts[i:i + 50], "source_lang": "EN", "target_lang": "KO",
                                    "context": context[:4000]})
            if r.status_code not in (401, 403):
                hosts = [host]
                break
        if r.status_code == 456:
            raise RuntimeError("DeepL 무료 글자 수를 다 썼어요")
        if r.status_code in (401, 403):
            raise RuntimeError("DeepL 키가 맞지 않아요. GitHub Secrets 의 DEEPL_API_KEY 를 확인해 주세요")
        r.raise_for_status()
        out += [t["text"] for t in r.json()["translations"]]
    return out


def make_subs(job_dir):
    job, style = load_job(job_dir)
    raw, voice, total = total_length(job_dir, job)
    warnings, segments = [], []
    lang = job.get("lang") or "none"
    src = voice if job.get("audio") == "voice" else (find_file(job_dir, "raw") if raw["audio"] and job.get("audio") != "mute" else None)

    if lang in ("en", "ko") and src:
        wav = Path(tempfile.mkdtemp()) / "a.wav"
        subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", str(src), "-vn", "-ac", "1", "-ar", "16000", str(wav)], check=True)
        segments = transcribe(wav, lang)
        # 음악만 있는 영상에서 Whisper 가 "you", "Thank you." 같은 말을 지어낼 때가 있어 걸러낸다.
        fake = {"", "you", "thank you", "thanks for watching", "bye", "감사합니다", "시청해주셔서 감사합니다"}
        if len(segments) <= 2 and all(s["text"].strip(" .!?,").lower() in fake for s in segments):
            segments = []
        if not segments:
            warnings.append("말소리를 찾지 못했어요. 자막을 직접 써 주세요.")
        if lang == "en" and segments:
            for s in segments:
                s["src"] = s["text"]
            try:
                ko = translate([s["src"] for s in segments], " ".join(s["src"] for s in segments))
                for s, t in zip(segments, ko):
                    s["text"] = t
            except Exception as e:  # 번역이 안 돼도 영어 자막은 남겨서 사용자가 고칠 수 있게
                warnings.append(f"번역 실패: {e}. 영어 원문을 그대로 넣었어요.")
    elif lang in ("en", "ko"):
        warnings.append("소리가 없어서 받아쓰기를 못 했어요. 자막을 직접 써 주세요.")

    if not segments and job.get("lines"):
        segments = spread(job["lines"].splitlines(), total)
    segments = split_long(segments, text_style(job.get("style"), "subtitle"))
    steps = spread((job.get("step_lines") or "").splitlines(), total) if job.get("style") == "format" else []

    credit = ""
    if job.get("credit", {}).get("handle"):
        c = {"prefix": "영상: ", "suffix": "", **CONF["common"].get("credit", {})}
        credit = f"{c['prefix']}{job['credit']['handle'].strip()}{c['suffix']}"
    write_json(job_dir / "subs.json", {"duration": total, "segments": segments, "steps": steps,
                                       "hook": job.get("hook") or job.get("title", ""), "credit": credit,
                                       "credit_on": job.get("credit_on", True), "styles": {}})
    return {"segments": len(segments), "warnings": warnings}


# ---------- 그리기 ----------
PRESETS_FILE = ROOT / "templates" / "reel-presets.json"


def text_style(style_key, element, overrides=None):
    """글자 스타일 = 기본값 ← 스타일별 기본 ← 저장된 기본(reel-presets.json) ← 이 작업에서 고친 값."""
    presets = read_json(PRESETS_FILE, {})
    st = {**CONF["text_defaults"],
          **CONF["styles"].get(style_key, {}).get("text", {}).get(element, {}),
          **presets.get(style_key, {}).get(element, {}),
          **(overrides or {}).get(element, {})}
    st["one_line"] = CONF["elements"].get(element, {}).get("lines") == "one"
    return st


def rgba(hexstr, opacity=None):
    h = hexstr.lstrip("#")
    a = int(h[6:8], 16) if len(h) == 8 else 255
    if opacity is not None:
        a = round(255 * float(opacity))
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (a,)


def font(size, family="pretendard"):
    if family == "logo":
        return ImageFont.truetype(str(FONTS / "Playfair-BoldItalic.ttf"), size)
    f = CONF["fonts"].get(family, CONF["fonts"]["pretendard"])["file"]
    return ImageFont.truetype(str(FONTS / f), size)


def runs_of(line):
    """'*강조*' → [(글자, 강조?)]"""
    parts = re.split(r"(\*[^*]+\*)", line)
    return [(p[1:-1], True) if p.startswith("*") and p.endswith("*") and len(p) > 2 else (p, False) for p in parts if p]


def plain(line):
    return "".join(t for t, _ in runs_of(line))


def text_lines(text, st):
    """자동 줄바꿈은 하지 않는다. 자막·출처는 늘 한 줄, 위쪽 문구·단계는 직접 넣은 줄바꿈만."""
    if st.get("one_line"):
        return [" ".join(text.split())]
    return [l.strip() for l in text.splitlines() if l.strip()] or [""]


def fit_size(lines, st):
    """가장 긴 줄이 화면 폭에 들어가도록 글자를 줄인다 (최소 절반)."""
    box = bool(st.get("box"))
    max_w = CONF["common"]["max_width"] - (2 * st.get("pad", 0) if box else 0)
    size = int(st["size"])
    while size > st["size"] * 0.5:
        fnt = font(size, st.get("font"))
        if max(fnt.getlength(plain(l)) for l in lines) <= max_w:
            break
        size -= 2
    return font(size, st.get("font"))


def draw_text(img, text, st):
    if not text or not text.strip():
        return
    d = ImageDraw.Draw(img)
    lines = text_lines(text, st)
    fnt = fit_size(lines, st)
    lh = round(fnt.size * 1.3)
    y0 = st["y"] - lh * len(lines) / 2
    pad = st.get("pad", 0)
    if st.get("box"):
        bw = max(fnt.getlength(plain(l)) for l in lines) + 2 * pad
        d.rounded_rectangle([(W - bw) / 2, y0 - pad * 0.7, (W + bw) / 2, y0 + lh * len(lines) + pad * 0.5],
                            radius=14, fill=rgba(st["box"], st.get("box_opacity", 0.85)))
    hl, color = rgba(st.get("highlight", "#FFD24A")), rgba(st["color"])
    stroke, stroke_fill = int(st.get("stroke", 0)), rgba(st.get("stroke_color", "#000000"))
    for i, line in enumerate(lines):
        x = (W - fnt.getlength(plain(line))) / 2
        for t, strong in runs_of(line):
            d.text((x, y0 + i * lh), t, font=fnt, fill=hl if strong else color,
                   stroke_width=stroke, stroke_fill=stroke_fill)
            x += fnt.getlength(t)


def split_long(segments, st):
    """한 줄에 안 들어가는 자막은 띄어쓰기 기준으로 반씩 나눠 여러 화면으로 (시간은 글자 수 비율)."""
    max_w = CONF["common"]["max_width"]
    fnt = font(int(st["size"]), st.get("font"))
    out = []

    def cut(seg):
        text = " ".join(seg["text"].split())
        if fnt.getlength(plain(text)) <= max_w or len(text) < 6:
            out.append({**seg, "text": text}); return
        spaces = [i for i, c in enumerate(text) if c == " "]
        mid = len(text) / 2
        i = min(spaces, key=lambda k: abs(k - mid)) if spaces else int(mid)
        a, b = text[:i].strip(), text[i:].strip()
        t = seg["start"] + (seg["end"] - seg["start"]) * len(a) / max(len(a) + len(b), 1)
        extra = {"src": seg["src"]} if seg.get("src") else {}
        cut({"start": seg["start"], "end": round(t, 2), "text": a, **extra})
        cut({"start": round(t, 2), "end": seg["end"], "text": b, **extra})

    for s in segments:
        cut(s)
    return out


def logo_style(style_key, overrides=None):
    presets = read_json(PRESETS_FILE, {})
    return {"show": True, "color": "#FFFFFF", **CONF["common"]["logo"],
            **presets.get(style_key, {}).get("logo", {}), **(overrides or {}).get("logo", {})}


def paste_logo(img, ls):
    """로고를 고른 색으로 칠해서 붙인다. 붙인 로고의 아래쪽 y 를 돌려준다 (코너 이름 위치용)."""
    variants = ls.get("variants", {})
    logo_file = ROOT / variants.get(ls.get("variant", "both"), variants.get("both", {})).get("file", "assets/logo.png")
    if not logo_file.exists():   # 로고 파일이 없으면 글자 로고
        draw_text(img, ls["fallback_text"], {**CONF["text_defaults"], "y": ls["y"], "font": "logo",
                                             "size": ls["fallback_size"], "color": ls["color"], "stroke": 2})
        return ls["y"] + ls["fallback_size"] / 2
    src = Image.open(logo_file).convert("RGBA")
    w = int(ls["width"])
    size = (w, round(src.height * w / src.width))
    alpha = src.getchannel("A")
    if int(ls.get("bold", 0)):   # 굵기: 4배 크기에서 선을 굵게 한 뒤 줄여서 매끄럽게 (단계마다 약 1px)
        big = alpha.resize((size[0] * 4, size[1] * 4), Image.LANCZOS).point(lambda a: 255 if a > 30 else 0)
        for _ in range(int(ls["bold"])):
            big = big.filter(ImageFilter.MaxFilter(9))
        alpha = big.filter(ImageFilter.GaussianBlur(1.5))
    alpha = alpha.resize(size, Image.LANCZOS)
    alpha = alpha.point(lambda a: round(a * float(ls["opacity"])))
    lg = Image.new("RGBA", alpha.size, rgba(ls["color"])); lg.putalpha(alpha)
    pos = ((W - lg.width) // 2, round(ls["y"] - lg.height / 2))
    # 영상 색과 겹쳐도 가는 선이 보이게 옅은 그림자 (어두운 로고면 밝은 그림자)
    r, g, b, _ = rgba(ls["color"])
    glow = (255, 255, 255) if r * 0.299 + g * 0.587 + b * 0.114 < 110 else (0, 0, 0)
    shadow = Image.new("RGBA", lg.size, glow + (0,))
    shadow.putalpha(alpha.point(lambda a: round(a * 0.6)).filter(ImageFilter.GaussianBlur(3)))
    img.alpha_composite(shadow, pos)
    img.alpha_composite(lg, pos)
    return pos[1] + lg.height


def static_layer(job, style, subs):
    """영상 내내 같은 것: 로고, 위쪽 문구, 출처.
    원본 영어 자막은 가리지 않는다(한국어 자막을 그 밑에). 코너 이름(스킨케어 노트 등)은 썸네일에만 넣는다."""
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    c, key, ov = CONF["common"], job.get("style"), subs.get("styles") or {}
    ls = logo_style(key, ov)
    if ls.get("show", True):
        paste_logo(img, ls)
    draw_text(img, subs.get("hook", ""), text_style(key, "hook", ov))
    if subs.get("credit") and subs.get("credit_on", True):
        draw_text(img, subs["credit"], text_style(key, "credit", ov))
    return img


def overlay_track(job, style, subs, total, tmp):
    """시간에 따라 바뀌는 글자(자막·단계)를 구간별 PNG 로 그려 concat 목록을 만든다."""
    base = static_layer(job, style, subs)
    items = [("subtitle", s) for s in subs.get("segments", [])] + [("step", s) for s in subs.get("steps", [])]
    cuts = sorted({0.0, total, *[min(max(float(x), 0), total) for _, s in items for x in (s["start"], s["end"])]})
    frames, cache = [], {}
    for a, b in zip(cuts, cuts[1:]):
        if b - a < 0.01:
            continue
        mid = (a + b) / 2
        active = tuple((k, s["text"]) for k, s in items if float(s["start"]) <= mid < float(s["end"]))
        if active not in cache:
            img = base.copy()
            for k, text in active:
                draw_text(img, text, text_style(job.get("style"), k, subs.get("styles")))
            cache[active] = tmp / f"ov{len(cache):03d}.png"
            img.save(cache[active])
        frames.append((cache[active], b - a))
    lst = tmp / "overlay.txt"
    with open(lst, "w", encoding="utf-8") as f:
        for p, d in frames:
            f.write(f"file '{p.as_posix()}'\nduration {d:.3f}\n")
        f.write(f"file '{frames[-1][0].as_posix()}'\n")
    return lst


# ---------- 릴스 완성 ----------
def pick_music(choice):
    tracks = sorted(MUSIC.glob("*.mp3")) if MUSIC.exists() else []
    if not choice or choice == "none" or not tracks:
        return None
    named = MUSIC / choice
    return named if named.exists() else random.choice(tracks)


def render(job_dir):
    job, style = load_job(job_dir)
    subs = read_json(job_dir / "subs.json")
    if subs is None:
        make_subs(job_dir)
        subs = read_json(job_dir / "subs.json")
    raw_path = find_file(job_dir, "raw")
    raw, voice, total = total_length(job_dir, job)
    if style.get("credit_required") and not job.get("credit", {}).get("handle"):
        raise RuntimeError("해외 소스 영상은 원작자 크레딧이 있어야 만들 수 있어요")
    tmp = Path(tempfile.mkdtemp())
    ov = overlay_track(job, style, subs, total, tmp)

    fit = job.get("fit", "auto")
    if fit == "auto":
        fit = "crop" if raw["h"] and abs(raw["w"] / raw["h"] - 9 / 16) < 0.12 else "blur"
    cover = f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}"
    if fit == "blur":
        vf = (f"[0:v]split[a][b];[a]{cover},boxblur=40:2,eq=brightness=-0.08[bg];"
              f"[b]scale={W}:{H}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2")
    else:
        vf = f"[0:v]{cover}"
    extend = total - raw["duration"]
    vf += f",setsar=1,fps={FPS}" + (f",tpad=stop_mode=clone:stop_duration={extend + 0.5:.2f}" if extend > 0.05 else "") + "[base];"
    vf += "[1:v]format=rgba[ov];[base][ov]overlay=0:0:eof_action=repeat,format=yuv420p[v]"

    cmd = [FFMPEG, "-y", "-loglevel", "error", "-i", str(raw_path), "-f", "concat", "-safe", "0", "-i", str(ov)]
    audio, n = [], 2
    vol = CONF["music_volume"]
    use_original = job.get("audio") == "original" and raw["audio"]
    if use_original:
        audio.append("[0:a]aresample=44100,volume=1.0[a0]")
    if voice:
        cmd += ["-i", str(voice)]
        audio.append(f"[{n}:a]aresample=44100,volume=1.0[a1]"); n += 1
    music = pick_music(job.get("music"))
    if music:
        cmd += ["-stream_loop", "-1", "-i", str(music)]
        mv = vol["under_voice"] if (use_original or voice) else vol["alone"]
        audio.append(f"[{n}:a]aresample=44100,volume={mv},afade=t=in:d=0.5,afade=t=out:st={max(0, total - 1.2):.2f}:d=1.2[a2]"); n += 1
    if not audio:
        cmd += ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"]
        audio.append(f"[{n}:a]anull[a0]")
    labels = "".join(re.findall(r"\[a\d\]$", a)[0] for a in audio)
    mix = f"{labels}amix=inputs={len(audio)}:duration=longest:normalize=0[aout]" if len(audio) > 1 else f"{labels}anull[aout]"
    graph = vf + ";" + ";".join(audio) + ";" + mix

    max_mb = CONF["common"]["max_mb"]
    out = job_dir / "reel.mp4"
    kbps = min(10000, int(max_mb * 0.9 * 8 * 1024 / max(total, 1)) - 192)
    for attempt in range(3):
        log(f"렌더링: {total:.1f}초, {fit}, 영상 최대 {kbps}kbps")
        subprocess.run(cmd + ["-filter_complex", graph, "-map", "[v]", "-map", "[aout]", "-t", f"{total:.2f}",
                              "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-maxrate", f"{kbps}k",
                              "-bufsize", f"{kbps * 2}k", "-profile:v", "high", "-pix_fmt", "yuv420p",
                              "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-movflags", "+faststart", str(out)], check=True)
        mb = out.stat().st_size / 1048576
        if mb <= max_mb:
            break
        kbps = int(kbps * max_mb / mb * 0.85)
    else:
        raise RuntimeError(f"영상이 {mb:.0f}MB 라서 {max_mb}MB 아래로 줄이지 못했어요. 더 짧게 잘라 주세요")
    shutil.rmtree(tmp, ignore_errors=True)
    warnings = []
    if total > 180:
        warnings.append(f"{total:.0f}초예요. 유튜브 쇼츠는 3분까지만 쇼츠로 올라가요.")
    return {"seconds": round(total, 1), "mb": round(mb, 1), "fit": fit,
            "music": music.name if music else None, "warnings": warnings}


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in ("subs", "render"):
        sys.exit(__doc__)
    step, job_dir = sys.argv[1], (ROOT / sys.argv[2]).resolve()
    if job_dir.parent != (ROOT / "studio").resolve() or not job_dir.is_dir():
        sys.exit(f"작업 폴더가 없어요: {sys.argv[2]}")
    if not find_file(job_dir, "raw"):
        set_status(job_dir, step, "error", error="원본 영상(raw.mp4)이 없어요")
        sys.exit(1)
    try:
        info = make_subs(job_dir) if step == "subs" else render(job_dir)
        set_status(job_dir, step, "done", **info)
        log("완료:", json.dumps(info, ensure_ascii=False))
    except Exception as e:
        set_status(job_dir, step, "error", error=str(e)[:400])
        log("실패:", e)
        sys.exit(1)


if __name__ == "__main__":
    main()
