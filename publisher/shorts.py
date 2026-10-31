"""피드 카드 → 쇼츠/틱톡용 9:16 영상 만들기.

카드를 순서대로 컷으로 붙이고(표지 2.5초, 나머지 3.5초), 마지막에 Mentis 로고 + 인스타 아이디 카드를 붙인다.
assets/music/ 에 mp3가 있으면 하나를 골라 깐다.
"""
import random
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "assets" / "fonts"
MUSIC = ROOT / "assets" / "music"
W, H, FPS = 1080, 1920, 30
CARD_W, CARD_H, CARD_Y = 1080, 1350, 140   # 카드를 위로 올려 아래 캡션 영역에 글이 가리지 않게
BG = (10, 10, 12)
BLUE = (70, 82, 201)
HANDLE = "@bethementis"


def _frame(card, out):
    canvas = Image.new("RGB", (W, H), BG)
    im = Image.open(card).convert("RGB")
    s = min(CARD_W / im.width, CARD_H / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    canvas.paste(im, ((W - im.width) // 2, CARD_Y + (CARD_H - im.height) // 2))
    canvas.save(out, quality=95)


def _end_card(out):
    canvas = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(canvas)
    logo = ImageFont.truetype(str(FONTS / "Playfair-BoldItalic.ttf"), 150)
    sub = ImageFont.truetype(str(FONTS / "Pretendard-SemiBold.otf"), 44)
    d.text(((W - d.textlength("Mentis", font=logo)) / 2, 720), "Mentis", font=logo, fill=BLUE)
    t = f"Instagram  {HANDLE}"
    d.text(((W - d.textlength(t, font=sub)) / 2, 940), t, font=sub, fill=(225, 225, 225))
    canvas.save(out, quality=95)


def build_short(cards, out_path, sec=3.5, cover_sec=2.5, end_sec=1.5, music=None):
    tmp = Path(tempfile.mkdtemp())
    seq, total = [], 0.0
    for i, c in enumerate(cards):
        p = tmp / f"f{i:02d}.jpg"; _frame(c, p)
        d = cover_sec if i == 0 else sec
        seq.append((p, d)); total += d
    e = tmp / "end.jpg"; _end_card(e)
    seq.append((e, end_sec)); total += end_sec

    lst = tmp / "list.txt"
    with open(lst, "w") as f:
        for p, d in seq:
            f.write(f"file '{p}'\nduration {d}\n")
        f.write(f"file '{seq[-1][0]}'\n")

    if music is None:
        tracks = sorted(MUSIC.glob("*.mp3")) if MUSIC.exists() else []
        music = random.choice(tracks) if tracks else None

    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst)]
    if music:
        cmd += ["-stream_loop", "-1", "-i", str(music)]
        af = f"volume=0.6,afade=t=in:d=0.5,afade=t=out:st={max(0, total - 1.2):.2f}:d=1.2"
    else:
        cmd += ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"]
        af = "anull"
    cmd += ["-vf", f"fps={FPS},format=yuv420p", "-af", af, "-map", "0:v", "-map", "1:a",
            "-t", f"{total:.2f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-tune", "stillimage", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(out_path)]
    subprocess.run(cmd, check=True)
    return {"seconds": round(total, 1), "music": Path(music).name if music else None}
