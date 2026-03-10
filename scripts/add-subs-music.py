#!/usr/bin/env python3
"""
Add word-by-word subtitles + music to any video.

Usage:
  python3 add-subs-music.py video.mp4 "Your script text here word by word"
  python3 add-subs-music.py video.mp4 "Script here" --genre=trap
  python3 add-subs-music.py video.mp4 "Script here" --no-music
  python3 add-subs-music.py video.mp4 "Script here" --music=~/Downloads/mytrack.mp3

Outputs to ~/Downloads/higgsfield-latest/ with timestamp name.
"""

import sys, os, time, random, shutil, subprocess, json
import urllib.request, urllib.error
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────

WORK_DIR = Path("/tmp/higgsfield-postprocess")
WORK_DIR.mkdir(parents=True, exist_ok=True)

MUSIC_DIR = Path.home() / "Downloads" / "higgsfield-music"
MUSIC_DIR.mkdir(parents=True, exist_ok=True)

MIXKIT_CATALOG = {
    "dramatic": [
        ("dramatic_01", "https://assets.mixkit.co/music/676/676.mp3"),
        ("dramatic_02", "https://assets.mixkit.co/music/871/871.mp3"),
        ("dramatic_03", "https://assets.mixkit.co/music/846/846.mp3"),
        ("dramatic_04", "https://assets.mixkit.co/music/614/614.mp3"),
        ("dramatic_05", "https://assets.mixkit.co/music/671/671.mp3"),
        ("dramatic_06", "https://assets.mixkit.co/music/677/677.mp3"),
        ("dramatic_07", "https://assets.mixkit.co/music/892/892.mp3"),
    ],
    "hiphop": [
        ("hiphop_01", "https://assets.mixkit.co/music/738/738.mp3"),
        ("hiphop_02", "https://assets.mixkit.co/music/400/400.mp3"),
        ("hiphop_03", "https://assets.mixkit.co/music/1123/1123.mp3"),
        ("hiphop_04", "https://assets.mixkit.co/music/262/262.mp3"),
        ("hiphop_05", "https://assets.mixkit.co/music/281/281.mp3"),
        ("hiphop_06", "https://assets.mixkit.co/music/403/403.mp3"),
        ("hiphop_07", "https://assets.mixkit.co/music/282/282.mp3"),
        ("hiphop_08", "https://assets.mixkit.co/music/267/267.mp3"),
        ("hiphop_09", "https://assets.mixkit.co/music/369/369.mp3"),
        ("hiphop_10", "https://assets.mixkit.co/music/305/305.mp3"),
        ("hiphop_11", "https://assets.mixkit.co/music/445/445.mp3"),
        ("hiphop_12", "https://assets.mixkit.co/music/375/375.mp3"),
    ],
    "dark": [
        ("dark_01", "https://assets.mixkit.co/music/140/140.mp3"),
        ("dark_02", "https://assets.mixkit.co/music/349/349.mp3"),
        ("dark_03", "https://assets.mixkit.co/music/699/699.mp3"),
        ("dark_04", "https://assets.mixkit.co/music/318/318.mp3"),
        ("dark_05", "https://assets.mixkit.co/music/260/260.mp3"),
    ],
    "pop": [
        ("pop_01", "https://assets.mixkit.co/music/250/250.mp3"),
        ("pop_02", "https://assets.mixkit.co/music/288/288.mp3"),
        ("pop_03", "https://assets.mixkit.co/music/453/453.mp3"),
        ("pop_04", "https://assets.mixkit.co/music/364/364.mp3"),
        ("pop_05", "https://assets.mixkit.co/music/224/224.mp3"),
        ("pop_06", "https://assets.mixkit.co/music/460/460.mp3"),
        ("pop_07", "https://assets.mixkit.co/music/407/407.mp3"),
    ],
}

MUSIC_GENRES = list(MIXKIT_CATALOG.keys())

def log(msg):
    print(msg, flush=True)

# ── Subtitle Generation ──────────────────────────────────────────────────────

def get_video_info(video_path: Path) -> dict:
    """Get video resolution and duration."""
    info = {"width": 720, "height": 1280, "duration": 10.0}
    try:
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries",
             "stream=width,height", "-show_entries", "format=duration",
             "-of", "json", str(video_path)],
            capture_output=True, text=True
        )
        data = json.loads(probe.stdout)
        for stream in data.get("streams", []):
            if stream.get("width"):
                info["width"] = stream["width"]
                info["height"] = stream["height"]
                break
        if data.get("format", {}).get("duration"):
            info["duration"] = float(data["format"]["duration"])
    except Exception:
        pass
    return info


def create_word_by_word_ass(script_text: str, ass_path: Path,
                            width: int, height: int, duration: float):
    """Generate word-by-word ASS subtitles — big bold, one word at a time, bottom-center."""
    words = script_text.strip().split()
    if not words:
        return

    # Timing: start 0.3s in, end 0.5s before video ends
    start_sec = 0.3
    end_sec = duration - 0.5
    time_per_word = (end_sec - start_sec) / len(words)

    # Font size ~12% of width for big bold words
    fontsize = max(int(width * 0.12), 60)
    margin_v = max(int(height * 0.08), 80)

    def sec_to_ass(s: float) -> str:
        h = int(s // 3600)
        m = int((s % 3600) // 60)
        sec = int(s % 60)
        cs = int((s % 1) * 100)
        return f"{h}:{m:02d}:{sec:02d}.{cs:02d}"

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 1

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial Black,{fontsize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,5,2,2,20,20,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events = ""
    for i, word in enumerate(words):
        w_start = start_sec + i * time_per_word
        w_end = start_sec + (i + 1) * time_per_word
        events += f"Dialogue: 0,{sec_to_ass(w_start)},{sec_to_ass(w_end)},Default,,0,0,0,,{word.upper()}\n"

    ass_path.write_text(header + events, encoding="utf-8")
    log(f"  [Subs] {len(words)} words, {time_per_word:.2f}s each, font={fontsize}, {width}x{height}")


# ── Music ─────────────────────────────────────────────────────────────────────

def fetch_music(genre: str) -> Path:
    """Pick a random Mixkit track for the genre. Auto-downloads if missing."""
    genre = genre if genre in MIXKIT_CATALOG else random.choice(MUSIC_GENRES)
    tracks = list(MIXKIT_CATALOG[genre])
    random.shuffle(tracks)

    for name, url in tracks:
        local = MUSIC_DIR / f"mixkit_{name}.mp3"
        if local.exists() and local.stat().st_size > 50_000:
            log(f"  [Music] {genre}: {name}")
            return local
        try:
            urllib.request.urlretrieve(url, str(local))
            if local.stat().st_size > 50_000:
                log(f"  [Music] Downloaded {genre}: {name}")
                return local
            local.unlink(missing_ok=True)
        except Exception as e:
            log(f"  [Music] {name} failed: {e}")

    return None


def has_audio_stream(video_path: Path) -> bool:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a",
         "-show_entries", "stream=codec_type", "-of", "csv=p=0", str(video_path)],
        capture_output=True, text=True
    )
    return "audio" in result.stdout


def mix_audio(video_path: Path, music_path: Path, output_path: Path,
              genre: str = "dramatic", music_vol: float = 0.15):
    """Mix background music into video."""
    if not music_path or not music_path.exists():
        log("  [Mix] No music — copying video as-is")
        shutil.copy2(video_path, output_path)
        return

    # Get video duration for fade
    info = get_video_info(video_path)
    dur = info["duration"]
    fade_start = max(dur - 1.5, 0)

    has_audio = has_audio_stream(video_path)

    try:
        if has_audio:
            # Mix video audio + music
            cmd = [
                "ffmpeg", "-y", "-i", str(video_path), "-i", str(music_path),
                "-filter_complex",
                f"[1:a]volume={music_vol},afade=t=in:d=0.5,afade=t=out:st={fade_start}:d=1.5[m];"
                f"[0:a][m]amix=inputs=2:duration=first:dropout_transition=2[a]",
                "-map", "0:v", "-map", "[a]",
                "-c:v", "copy", "-shortest", str(output_path)
            ]
        else:
            # Music only (no audio in video)
            cmd = [
                "ffmpeg", "-y", "-i", str(video_path), "-i", str(music_path),
                "-filter_complex",
                f"[1:a]volume={music_vol},afade=t=in:d=0.5,afade=t=out:st={fade_start}:d=1.5[m]",
                "-map", "0:v", "-map", "[m]",
                "-c:v", "copy", "-shortest", str(output_path)
            ]

        subprocess.run(cmd, check=True, capture_output=True, text=True)
        log(f"  [Mix] Done → {output_path.name}")
    except subprocess.CalledProcessError as e:
        log(f"  [Mix] Failed: {e.stderr[-200:] if e.stderr else ''}")
        shutil.copy2(video_path, output_path)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    video_input = Path(sys.argv[1]).expanduser().resolve()
    script_text = sys.argv[2]

    if not video_input.exists():
        print(f"Error: Video not found: {video_input}")
        sys.exit(1)

    # Parse flags
    genre = None
    no_music = False
    custom_music = None
    music_vol = None

    for arg in sys.argv[3:]:
        if arg.startswith("--genre="):
            genre = arg.split("=", 1)[1]
        elif arg == "--no-music":
            no_music = True
        elif arg.startswith("--music="):
            custom_music = Path(arg.split("=", 1)[1]).expanduser().resolve()
        elif arg.startswith("--vol="):
            music_vol = float(arg.split("=", 1)[1])

    if not genre:
        genre = random.choice(MUSIC_GENRES)

    log("=" * 60)
    log("ADD SUBTITLES + MUSIC")
    log("=" * 60)
    log(f"  Video  : {video_input}")
    log(f"  Script : {script_text}")
    log(f"  Genre  : {genre if not no_music else 'none'}")

    # Get video info
    info = get_video_info(video_input)
    log(f"  Size   : {info['width']}x{info['height']}")
    log(f"  Length : {info['duration']:.1f}s")

    # Step 1: Burn subtitles
    log(f"\nStep 1 — Word-by-word subtitles")
    ass_path = WORK_DIR / "subs.ass"
    create_word_by_word_ass(script_text, ass_path,
                            info["width"], info["height"], info["duration"])

    subbed = WORK_DIR / "subbed.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(video_input),
         "-vf", f"ass={str(ass_path)}",
         "-c:a", "copy", str(subbed)],
        check=True, capture_output=True, text=True
    )
    log(f"  Subtitles burned → subbed.mp4")

    # Step 2: Add music
    if no_music:
        final = subbed
        log(f"\nStep 2 — No music (skipped)")
    else:
        log(f"\nStep 2 — Adding {genre} music")
        if custom_music and custom_music.exists():
            music_path = custom_music
            log(f"  [Music] Using custom: {custom_music.name}")
        else:
            music_path = fetch_music(genre)

        vol = music_vol if music_vol else (0.15 if has_audio_stream(video_input) else 0.40)
        final = WORK_DIR / "final.mp4"
        mix_audio(subbed, music_path, final, genre=genre, music_vol=vol)

    # Step 3: Copy to Downloads
    dl_dir = Path.home() / "Downloads" / "higgsfield-latest"
    dl_dir.mkdir(parents=True, exist_ok=True)

    ts = time.strftime("%H%M%S")
    out_name = f"final_{ts}.mp4"
    shutil.copy2(final, dl_dir / out_name)

    subprocess.Popen(["open", str(dl_dir)])

    log(f"\n{'=' * 60}")
    log("DONE")
    log("=" * 60)
    log(f"  Output : ~/Downloads/higgsfield-latest/{out_name}")
    log(f"  Script : {script_text}")


if __name__ == "__main__":
    main()
