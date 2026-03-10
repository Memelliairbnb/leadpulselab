#!/usr/bin/env python3
"""
Video processing script for LeadPulseLab.

Usage:
    python3 process-video.py <input_video> <output_video> <music_genre>

Steps:
    1. Transcribe with faster-whisper (word-level timestamps)
    2. Group words into 2-3 word natural phrases
    3. Create ASS subtitle file (auto-detect resolution, bold white, black outline)
    4. Burn subtitles with ffmpeg
    5. Pick random Mixkit track and mix at 25% volume (no fade-in, fade-out at end)
    6. Output final.mp4 and print JSON result
"""

import sys
import os
import json
import glob
import random
import subprocess
import tempfile
import re
from pathlib import Path


# ─── Word corrections ────────────────────────────────────────────────────────

WORD_CORRECTIONS = {
    "the mellie": "Memelli",
    "The Mellie": "Memelli",
    "the melli": "Memelli",
    "The Melli": "Memelli",
    "memeli": "Memelli",
    "Memeli": "Memelli",
    "memellie": "Memelli",
    "Memellie": "Memelli",
}


def apply_corrections(text: str) -> str:
    """Fix common transcription errors."""
    for wrong, right in WORD_CORRECTIONS.items():
        text = text.replace(wrong, right)
    return text


# ─── Transcription ────────────────────────────────────────────────────────────

def transcribe(input_path: str):
    """Transcribe video with faster-whisper, returning word-level timestamps."""
    from faster_whisper import WhisperModel

    model = WhisperModel("base", device="cpu", compute_type="int8")
    segments, info = model.transcribe(input_path, word_timestamps=True)

    words = []
    full_text_parts = []

    for segment in segments:
        if segment.words:
            for w in segment.words:
                words.append({
                    "word": w.word.strip(),
                    "start": w.start,
                    "end": w.end,
                })
                full_text_parts.append(w.word.strip())

    full_text = " ".join(full_text_parts)
    full_text = apply_corrections(full_text)

    return words, full_text, info.duration


# ─── Phrase grouping ──────────────────────────────────────────────────────────

def group_words_into_phrases(words, group_size=2):
    """
    Group words into 2-3 word natural phrases for subtitle display.
    Uses 2 words by default, extends to 3 if the third word is short.
    """
    phrases = []
    i = 0
    while i < len(words):
        # Take 2 words minimum
        end = min(i + group_size, len(words))

        # Extend to 3 if third word is short (<=4 chars) and exists
        if end < len(words) and len(words[end]["word"]) <= 4:
            end += 1

        phrase_words = words[i:end]
        text = " ".join(w["word"] for w in phrase_words)
        text = apply_corrections(text)

        phrases.append({
            "text": text,
            "start": phrase_words[0]["start"],
            "end": phrase_words[-1]["end"],
        })

        i = end

    return phrases


# ─── ASS subtitle generation ─────────────────────────────────────────────────

def get_video_resolution(input_path: str):
    """Get video width and height using ffprobe."""
    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "json",
        input_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    data = json.loads(result.stdout)
    stream = data["streams"][0]
    return int(stream["width"]), int(stream["height"])


def seconds_to_ass_time(seconds: float) -> str:
    """Convert seconds to ASS timestamp format: H:MM:SS.cc"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int((seconds % 1) * 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def create_ass_subtitles(phrases, width: int, height: int, output_path: str):
    """
    Create ASS subtitle file with:
    - Font size = 9% of video width
    - Bold white text
    - Black outline (3px)
    - Centered at bottom
    """
    font_size = int(width * 0.09)
    outline_size = 3
    margin_bottom = int(height * 0.08)

    header = f"""[Script Info]
Title: Video Subtitles
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,{font_size},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,{outline_size},0,2,10,10,{margin_bottom},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    events = []
    for phrase in phrases:
        start = seconds_to_ass_time(phrase["start"])
        end = seconds_to_ass_time(phrase["end"])
        text = phrase["text"].replace("\n", "\\N")
        events.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{text}")

    content = header + "\n".join(events) + "\n"

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(content)

    return output_path


# ─── Music mixing ────────────────────────────────────────────────────────────

def find_music_track(genre: str) -> str:
    """
    Pick a random Mixkit track from ~/Downloads/higgsfield-music/.
    Looks for files matching: mixkit_{genre}_*.mp3
    Falls back to any .mp3 if no genre match found.
    """
    music_dir = os.path.expanduser("~/Downloads/higgsfield-music")

    if not os.path.isdir(music_dir):
        raise FileNotFoundError(f"Music directory not found: {music_dir}")

    # Try genre-specific pattern first
    pattern = os.path.join(music_dir, f"mixkit_{genre}_*.mp3")
    tracks = glob.glob(pattern)

    # Fallback: try case-insensitive match
    if not tracks:
        pattern = os.path.join(music_dir, f"mixkit*{genre}*.mp3")
        tracks = glob.glob(pattern)

    # Fallback: any mp3
    if not tracks:
        tracks = glob.glob(os.path.join(music_dir, "*.mp3"))

    if not tracks:
        raise FileNotFoundError(f"No music tracks found in {music_dir}")

    selected = random.choice(tracks)
    print(f"[music] Selected track: {os.path.basename(selected)}", file=sys.stderr)
    return selected


def get_duration(file_path: str) -> float:
    """Get media duration in seconds using ffprobe."""
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "json",
        file_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    data = json.loads(result.stdout)
    return float(data["format"]["duration"])


# ─── FFmpeg processing ────────────────────────────────────────────────────────

def burn_subtitles_and_mix_music(
    video_path: str,
    ass_path: str,
    music_path: str,
    output_path: str,
    music_volume: float = 0.25,
    fade_out_duration: float = 3.0,
):
    """
    Single ffmpeg pass:
    - Burn ASS subtitles onto video
    - Mix music at specified volume (no fade-in)
    - Fade out music at end
    - Output final video
    """
    video_duration = get_duration(video_path)

    # Calculate fade-out start time
    fade_out_start = max(0, video_duration - fade_out_duration)

    # Escape the ASS path for ffmpeg (handle colons and backslashes)
    escaped_ass = ass_path.replace("\\", "\\\\").replace(":", "\\:")

    # Build the complex filter:
    # - [0:v] = input video → burn subtitles
    # - [0:a] = original audio
    # - [1:a] = music → volume + fade-out → mix with original
    filter_complex = (
        f"[0:v]ass='{escaped_ass}'[v];"
        f"[1:a]volume={music_volume},afade=t=out:st={fade_out_start:.2f}:d={fade_out_duration:.2f}[music];"
        f"[0:a][music]amix=inputs=2:duration=first:dropout_transition=0[a]"
    )

    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-i", music_path,
        "-filter_complex", filter_complex,
        "-map", "[v]",
        "-map", "[a]",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        output_path,
    ]

    print(f"[ffmpeg] Running subtitle burn + music mix...", file=sys.stderr)
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=300,
    )

    if result.returncode != 0:
        print(f"[ffmpeg] stderr: {result.stderr}", file=sys.stderr)
        raise RuntimeError(f"ffmpeg failed with exit code {result.returncode}: {result.stderr[-500:]}")

    if not os.path.exists(output_path):
        raise RuntimeError(f"ffmpeg did not produce output: {output_path}")

    print(f"[ffmpeg] Output saved: {output_path}", file=sys.stderr)


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 4:
        print(f"Usage: {sys.argv[0]} <input_video> <output_video> <music_genre>", file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]
    music_genre = sys.argv[3]

    if not os.path.exists(input_path):
        print(f"Error: Input video not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    # Create output directory if needed
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    # Working directory for intermediate files
    work_dir = os.path.dirname(output_path) or tempfile.gettempdir()

    print(f"[process] Input: {input_path}", file=sys.stderr)
    print(f"[process] Output: {output_path}", file=sys.stderr)
    print(f"[process] Genre: {music_genre}", file=sys.stderr)

    # Step 1: Transcribe
    print("[process] Step 1: Transcribing with faster-whisper...", file=sys.stderr)
    words, transcript, duration = transcribe(input_path)
    print(f"[process] Transcription: {len(words)} words, {duration:.1f}s", file=sys.stderr)

    # Step 2: Group into phrases
    print("[process] Step 2: Grouping words into phrases...", file=sys.stderr)
    phrases = group_words_into_phrases(words)
    print(f"[process] Created {len(phrases)} subtitle phrases", file=sys.stderr)

    # Step 3: Get resolution and create ASS subtitles
    print("[process] Step 3: Creating ASS subtitles...", file=sys.stderr)
    width, height = get_video_resolution(input_path)
    ass_path = os.path.join(work_dir, "subtitles.ass")
    create_ass_subtitles(phrases, width, height, ass_path)
    print(f"[process] ASS subtitles: {ass_path} ({width}x{height})", file=sys.stderr)

    # Step 4: Find music track
    print(f"[process] Step 4: Finding {music_genre} music track...", file=sys.stderr)
    music_path = find_music_track(music_genre)

    # Step 5: Burn subtitles + mix music
    print("[process] Step 5: Burning subtitles and mixing music...", file=sys.stderr)
    burn_subtitles_and_mix_music(
        video_path=input_path,
        ass_path=ass_path,
        music_path=music_path,
        output_path=output_path,
        music_volume=0.25,
        fade_out_duration=3.0,
    )

    # Get final duration
    final_duration = get_duration(output_path)

    # Print JSON result to stdout (only this line — everything else goes to stderr)
    result = {
        "transcript": transcript,
        "duration": final_duration,
        "output": output_path,
    }
    print(json.dumps(result))


if __name__ == "__main__":
    main()
