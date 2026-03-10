#!/usr/bin/env python3
"""
Higgsfield Social Cuts — 10-second + 3-second vertical videos with music & subtitles.

Generates both cuts simultaneously from the same character/scene:
  - 10-second: full spoken ad with voice, speech subtitles, background music (ducked)
  - 3-second:  visual hook, no voice, punchy title card text, music (louder)

Music genres rotate per run: dramatic, cinematic, trap, pop, hip-hop, electronic, lo-fi, indie
Music sources (in priority order):
  1. ~/Downloads/higgsfield-music/*.mp3  (your own tracks — drop any MP3 here)
  2. Pixabay API (PIXABAY_API_KEY in .env.local — free at pixabay.com/api/docs/)
  3. Pixabay web scrape (no key needed, automatic)
  4. No music (graceful fallback — video still renders correctly)

Usage:
  python3 higgsfield-social-cuts.py
  python3 higgsfield-social-cuts.py --fresh
  python3 higgsfield-social-cuts.py --skip-claude
  python3 higgsfield-social-cuts.py --skip-images
  python3 higgsfield-social-cuts.py --skip-video
  python3 higgsfield-social-cuts.py --genre=trap
  python3 higgsfield-social-cuts.py --no-music
"""

import json, time, sys, os, re, random, shutil, subprocess, threading
import urllib.request, urllib.error, urllib.parse
from pathlib import Path
import anthropic

# ── Config ────────────────────────────────────────────────────────────────────

ANTHROPIC_KEY  = os.environ.get("ANTHROPIC_API_KEY", "")
HIGGSFIELD_KEY = os.environ.get("HIGGSFIELD_API_KEY",    "968412fb-8e00-4169-8070-f5712259367b")
HIGGSFIELD_SEC = os.environ.get("HIGGSFIELD_API_SECRET", "fae2e6eee606c90c75f9405b32151f55c42c3916cd3d7f164a420b2f19f42d08")
PIXABAY_KEY    = os.environ.get("PIXABAY_API_KEY", "")
AUTH           = f"Key {HIGGSFIELD_KEY}:{HIGGSFIELD_SEC}"
BASE_URL       = "https://platform.higgsfield.ai"

WORK_DIR       = Path("/tmp/higgsfield-social")
MUSIC_CACHE    = Path("/tmp/higgsfield-music")
USER_MUSIC_DIR = Path.home() / "Downloads" / "higgsfield-music"

WORK_DIR.mkdir(parents=True, exist_ok=True)
MUSIC_CACHE.mkdir(parents=True, exist_ok=True)
USER_MUSIC_DIR.mkdir(parents=True, exist_ok=True)

TENANT_CONTEXT = {
    "business_name":    "Memelli",
    "industry":         "Credit Repair",
    "target_audience":  "Adults 25-45 struggling with bad credit — denied for loans, cards, apartments.",
    "value_proposition":"We dispute errors, negotiate with creditors, real results in 30-60 days.",
    "tone":             "Empowering, real, professional. Not salesy. Trusted friend energy.",
    "call_to_action":   "Book a free consultation. Link in bio.",
}

# Music genres — modern IG/TikTok energy only. No corporate, no ukulele, no elevator music.
# Format: voice_mix_vol (under voice), solo_vol (no voice)
MUSIC_GENRES = {
    "dramatic":   (0.25, 0.50),
    "hiphop":     (0.25, 0.50),
    "dark":       (0.25, 0.50),
    "pop":        (0.25, 0.50),
}

# Mixkit catalog — free, modern, pre-downloaded to ~/Downloads/higgsfield-music/
# Pipeline auto-downloads missing tracks on first run
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

# ── Shared Utilities ──────────────────────────────────────────────────────────

def log(msg):
    print(msg, flush=True)

def _headers():
    return {
        "Authorization": AUTH,
        "Content-Type":  "application/json",
        "Accept":        "application/json",
        "User-Agent":    "higgsfield-server-js/2.0",
    }

def api_post(path: str, body: dict) -> dict:
    url  = f"{BASE_URL}/{path.lstrip('/')}"
    data = json.dumps(body).encode()
    req  = urllib.request.Request(url, data=data, method="POST")
    for k, v in _headers().items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        log(f"  [API ERROR] {e.code}: {err[:400]}")
        return {"error": err, "status_code": e.code}

def api_get(path: str) -> dict:
    url = f"{BASE_URL}/{path.lstrip('/')}"
    req = urllib.request.Request(url)
    for k, v in _headers().items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        log(f"  [API ERROR] {e.code}: {err[:400]}")
        return {"error": err, "status_code": e.code}

def download_file(url: str, dest: Path, headers=None):
    h = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=60) as resp:
        dest.write_bytes(resp.read())
    log(f"  Saved: {dest}  ({dest.stat().st_size:,} bytes)")

def poll_platform(request_id: str, label: str, max_wait=600) -> dict:
    log(f"Polling {label}  [{request_id}]")
    start = time.time()
    waits = [5, 10, 15, 20, 30, 30, 60, 60, 90, 90]
    idx   = 0
    while time.time() - start < max_wait:
        time.sleep(waits[min(idx, len(waits)-1)])
        idx += 1
        elapsed = int(time.time() - start)
        result  = api_get(f"/requests/{request_id}/status")
        status  = result.get("status", "unknown")
        log(f"  [{elapsed}s] {label}: {status}")
        if status == "completed":
            return result
        if status in ("failed", "nsfw", "cancelled"):
            raise RuntimeError(f"{label} failed: {json.dumps(result)[:300]}")
    raise TimeoutError(f"{label} timed out after {max_wait}s")

def get_image_url(result: dict) -> str:
    images = result.get("images", [])
    if images and isinstance(images, list):
        return images[0].get("url")
    for key in ("url", "image_url", "output_url", "media_url"):
        if result.get(key):
            return result[key]
    output = result.get("output") or result.get("result") or result.get("data") or {}
    if isinstance(output, str):
        return output
    if isinstance(output, dict):
        for key in ("url", "image_url", "output_url"):
            if output.get(key):
                return output[key]
    if isinstance(output, list) and output:
        item = output[0]
        return item.get("url") or (item if isinstance(item, str) else None)
    return None

def get_video_url(result: dict) -> str:
    video = result.get("video", {})
    if isinstance(video, dict) and video.get("url"):
        return video["url"]
    for key in ("url", "video_url", "output_url", "media_url"):
        if result.get(key):
            return result[key]
    output = result.get("output") or result.get("result") or result.get("data") or {}
    if isinstance(output, str):
        return output
    if isinstance(output, dict):
        for key in ("url", "video_url", "output_url"):
            if output.get(key):
                return output[key]
    if isinstance(output, list) and output:
        item = output[0]
        return item.get("url") or (item if isinstance(item, str) else None)
    return None

def get_video_duration(path: Path) -> float:
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            capture_output=True, text=True, check=True
        )
        return float(result.stdout.strip())
    except Exception:
        return 10.0

# ── Music Manager ─────────────────────────────────────────────────────────────


def _ensure_mixkit_track(name: str, url: str) -> Path:
    """Download a Mixkit track if not already cached."""
    dest = USER_MUSIC_DIR / f"mixkit_{name}.mp3"
    if dest.exists() and dest.stat().st_size > 50_000:
        return dest
    try:
        urllib.request.urlretrieve(url, str(dest))
        if dest.stat().st_size > 50_000:
            return dest
        dest.unlink(missing_ok=True)
    except Exception:
        pass
    return None


def fetch_music(genre: str) -> str | None:
    """Pick a random track from the Mixkit catalog for the given genre.
    Auto-downloads if not cached. Returns path string or None."""
    genre = genre if genre in MIXKIT_CATALOG else random.choice(list(MIXKIT_CATALOG.keys()))
    tracks = MIXKIT_CATALOG[genre]
    random.shuffle(tracks)

    for name, url in tracks:
        # Check if already downloaded
        local = USER_MUSIC_DIR / f"mixkit_{name}.mp3"
        if local.exists() and local.stat().st_size > 50_000:
            log(f"  [Music] {genre}: {name}")
            return str(local)
        # Try downloading
        path = _ensure_mixkit_track(name, url)
        if path:
            log(f"  [Music] Downloaded {genre}: {name}")
            return str(path)

    log(f"  [Music] No tracks available for {genre}")
    return None


def _old_scrape_pixabay_music(query: str) -> list:
    """Scrape Pixabay music search page for CDN audio URLs — no API key needed."""
    try:
        url = f"https://pixabay.com/music/search/?q={urllib.parse.quote(query)}&order=popular"
        req = urllib.request.Request(url, headers={
            "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            "Accept-Encoding": "identity",
        })
        html = urllib.request.urlopen(req, timeout=15).read().decode("utf-8", errors="ignore")
        urls = set()
        # Multiple patterns — Pixabay changes their HTML structure periodically
        patterns = [
            r'https://cdn\.pixabay\.com/audio/[^\s"\'\\>]+\.mp3',
            r'"audio"\s*:\s*"(https://[^"]+\.mp3)"',
            r'"audioUrl"\s*:\s*"(https://[^"]+\.mp3)"',
            r'data-audio-url="(https://[^"]+\.mp3)"',
            r"'https://cdn\.pixabay\.com/audio/[^']+\.mp3'",
        ]
        for pat in patterns:
            for m in re.finditer(pat, html):
                u = m.group(1) if m.lastindex else m.group(0).strip("'\"")
                if "cdn.pixabay.com/audio" in u:
                    urls.add(u)
        log(f"  [Music] Pixabay scrape found {len(urls)} tracks for '{query}'")
        return list(urls)
    except Exception as e:
        log(f"  [Music] Pixabay scrape failed: {e}")
        return []


def _fetch_pixabay_api(query: str) -> list:
    """Fetch music URLs via Pixabay API (requires PIXABAY_KEY in .env.local)."""
    if not PIXABAY_KEY:
        return []
    try:
        url = (f"https://pixabay.com/api/music/?key={PIXABAY_KEY}"
               f"&q={urllib.parse.quote(query)}&per_page=20&min_duration=5&max_duration=180")
        resp = json.loads(urllib.request.urlopen(url, timeout=15).read())
        tracks = [h["audio"] for h in resp.get("hits", []) if h.get("audio")]
        log(f"  [Music] Pixabay API found {len(tracks)} tracks")
        return tracks
    except Exception as e:
        log(f"  [Music] Pixabay API failed: {e}")
        return []


def _fetch_ccmixter(genre: str) -> list:
    """Fetch CC-licensed tracks from ccMixter public API — no key needed."""
    tag_map = {
        "dramatic":   "orchestral",
        "cinematic":  "cinematic",
        "trap":       "hip_hop",
        "pop":        "pop",
        "hip-hop":    "hip_hop",
        "electronic": "electronic",
        "lo-fi":      "ambient",
        "indie":      "indie",
    }
    tag = tag_map.get(genre, genre)
    try:
        url = (f"http://ccmixter.org/api/query?tags={tag}"
               f"&lic=pd,by&format=json&limit=20&type=audiofile")
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        data = json.loads(urllib.request.urlopen(req, timeout=15).read())
        urls = [item.get("download_url") for item in data if item.get("download_url")]
        urls = [u for u in urls if u and (u.endswith(".mp3") or u.endswith(".ogg") or "download" in u)]
        log(f"  [Music] ccMixter found {len(urls)} tracks for '{tag}'")
        return urls
    except Exception as e:
        log(f"  [Music] ccMixter failed: {e}")
        return []


def _try_freepd(genre: str) -> str | None:
    """Scrape freepd.com track listing then download a matching public-domain MP3."""
    # Check local cache first
    cached = [p for p in MUSIC_CACHE.glob("freepd_*.mp3") if p.stat().st_size > 50_000]
    if cached:
        chosen = random.choice(cached)
        log(f"  [Music] Using cached freepd: {chosen.name}")
        return str(chosen)
    try:
        # Scrape freepd.com to get actual current track listing
        req = urllib.request.Request(
            "https://freepd.com/",
            headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}
        )
        html = urllib.request.urlopen(req, timeout=15).read().decode("utf-8", errors="ignore")
        mp3_paths = re.findall(r'href="(/music/[^"]+\.mp3)"', html)
        if not mp3_paths:
            # Try alternate pattern
            mp3_paths = re.findall(r'"(/music/[^"]+\.mp3)"', html)
        if not mp3_paths:
            log("  [Music] freepd: no tracks found in page")
            return None
        log(f"  [Music] freepd: found {len(mp3_paths)} tracks")
        random.shuffle(mp3_paths)
        for path in mp3_paths[:6]:
            url  = f"https://freepd.com{path}"
            name = urllib.parse.unquote(path.split("/")[-1])
            dest = MUSIC_CACHE / f"freepd_{abs(hash(url)) % 100000}_{name}"
            try:
                log(f"  [Music] freepd downloading: {name}")
                download_file(url, dest)
                if dest.stat().st_size > 50_000:
                    return str(dest)
                dest.unlink(missing_ok=True)
            except Exception as e:
                log(f"  [Music] freepd {name} failed: {e}")
                if dest.exists():
                    dest.unlink(missing_ok=True)
    except Exception as e:
        log(f"  [Music] freepd scrape failed: {e}")
    return None


def fetch_music(genre: str) -> str | None:
    """
    Get a local music file path for the genre.
    Priority:
      1. ~/Downloads/higgsfield-music/  (your own licensed tracks — drop MP3s here)
      2. Local cache (previously downloaded)
      3. Pixabay API (PIXABAY_KEY in .env.local — free signup at pixabay.com/api/docs/)
      4. Pixabay HTML scrape (automatic, no key)
      5. ccMixter CC-licensed tracks (no key)
      6. freepd.com public domain tracks (no key, hardcoded)
      7. None (video renders without music — still works fine)
    """
    # 1. User's own files
    user_files = (list(USER_MUSIC_DIR.glob("*.mp3")) +
                  list(USER_MUSIC_DIR.glob("*.m4a")) +
                  list(USER_MUSIC_DIR.glob("*.wav")))
    if user_files:
        chosen = random.choice(user_files)
        log(f"  [Music] Using your track: {chosen.name}")
        return str(chosen)

    # 2. Local cache
    cached = [p for p in MUSIC_CACHE.glob(f"{genre}_*.mp3") if p.stat().st_size > 50_000]
    if cached:
        chosen = random.choice(cached)
        log(f"  [Music] Using cached: {chosen.name}")
        return str(chosen)

    query = MUSIC_GENRES[genre][0]
    log(f"\n  [Music] Fetching {genre!r} track — query: {query!r}")

    # 3. Pixabay API
    urls = _fetch_pixabay_api(query)

    # 4. Pixabay scrape
    if not urls:
        urls = _scrape_pixabay_music(query)

    # Try downloading from Pixabay URLs
    if urls:
        random.shuffle(urls)
        for audio_url in urls[:5]:
            dest = MUSIC_CACHE / f"{genre}_{abs(hash(audio_url)) % 100000}.mp3"
            try:
                log(f"  [Music] Downloading: {audio_url[:80]}...")
                download_file(audio_url, dest)
                if dest.stat().st_size > 50_000:
                    return str(dest)
                dest.unlink(missing_ok=True)
            except Exception as e:
                log(f"  [Music] Download failed: {e}")
                if dest.exists():
                    dest.unlink(missing_ok=True)

    # 5. ccMixter
    cc_urls = _fetch_ccmixter(genre)
    if cc_urls:
        random.shuffle(cc_urls)
        for audio_url in cc_urls[:5]:
            dest = MUSIC_CACHE / f"{genre}_cc_{abs(hash(audio_url)) % 100000}.mp3"
            try:
                log(f"  [Music] ccMixter download: {audio_url[:80]}...")
                download_file(audio_url, dest)
                if dest.stat().st_size > 50_000:
                    return str(dest)
                dest.unlink(missing_ok=True)
            except Exception as e:
                log(f"  [Music] ccMixter download failed: {e}")
                if dest.exists():
                    dest.unlink(missing_ok=True)

    # 6. freepd.com public domain
    freepd_path = _try_freepd(genre)
    if freepd_path:
        return freepd_path

    # 7. Bensound (free with attribution at bensound.com)
    candidates = BENSOUND_TRACKS.get(genre, BENSOUND_TRACKS["pop"])
    random.shuffle(candidates)
    for track in candidates:
        url  = f"{BENSOUND_BASE}{track}.mp3"
        dest = MUSIC_CACHE / f"bensound_{genre}_{track}.mp3"
        if dest.exists() and dest.stat().st_size > 100_000:
            log(f"  [Music] Using cached bensound: {track}")
            return str(dest)
        try:
            log(f"  [Music] Bensound: {track}")
            download_file(url, dest, headers={"Referer": "https://www.bensound.com/"})
            if dest.stat().st_size > 100_000:
                return str(dest)
            dest.unlink(missing_ok=True)
        except Exception as e:
            log(f"  [Music] Bensound {track} failed: {e}")
            if dest.exists():
                dest.unlink(missing_ok=True)

    log(f"  [Music] All sources exhausted — continuing without music")
    return None

def _has_audio_stream(video_path: Path) -> bool:
    """Check if video file has an audio track."""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "a",
             "-show_entries", "stream=codec_type",
             "-of", "csv=p=0", str(video_path)],
            capture_output=True, text=True
        )
        return "audio" in result.stdout
    except Exception:
        return False


def mix_audio(video_path: Path, music_path: str | None, output_path: Path,
              has_voice: bool = True, genre: str = "dramatic"):
    """Mix video with background music. Handles videos with or without audio tracks."""
    if not music_path or not Path(music_path).exists():
        log(f"  [Mix] No music — copying video as-is")
        shutil.copy2(video_path, output_path)
        return

    voice_vol, solo_vol = MUSIC_GENRES.get(genre, (0.25, 0.50))
    duration  = get_video_duration(video_path)
    fade_out  = max(0.0, duration - 1.5)
    video_has_audio = _has_audio_stream(video_path)

    if has_voice and video_has_audio:
        # Video has audio — duck music under voice
        music_vol = voice_vol
        log(f"  [Mix] {genre} music @ {int(music_vol*100)}% vol (under voice) | fade out @ {fade_out:.1f}s")
        filter_complex = (
            f"[1:a]volume={music_vol},"
            f"afade=t=out:st={fade_out}:d=1.5,"
            f"apad[music];"
            f"[0:a][music]amix=inputs=2:duration=first[aout]"
        )
    else:
        # No audio in video OR visual-only clip — music is the sole audio
        music_vol = solo_vol
        log(f"  [Mix] {genre} music @ {int(music_vol*100)}% vol (solo) | fade out @ {fade_out:.1f}s")
        filter_complex = (
            f"[1:a]volume={music_vol},"
            f"afade=t=out:st={fade_out}:d=1.0,"
            f"atrim=duration={duration}[aout]"
        )

    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(video_path), "-i", music_path,
             "-filter_complex", filter_complex,
             "-map", "0:v", "-map", "[aout]",
             "-c:v", "copy", "-c:a", "aac",
             str(output_path)],
            check=True, capture_output=True, text=True
        )
        log(f"  [Mix] Done → {output_path}")
    except subprocess.CalledProcessError as e:
        log(f"  [Mix] ffmpeg mix failed: {e.stderr[-300:] if e.stderr else ''}")
        log(f"  [Mix] Falling back to video without music")
        shutil.copy2(video_path, output_path)

def _srt_to_ass(srt_path: Path, ass_path: Path, alignment: int = 2,
                fontsize: int = 20, margin_v: int = 120):
    """Convert SRT to ASS with explicit positioning. alignment: 2=bottom-center, 5=middle-center."""
    srt_text = srt_path.read_text(encoding="utf-8")
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 1

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,{fontsize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,{alignment},40,40,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    def srt_time_to_ass(t: str) -> str:
        t = t.strip()
        h, m, rest = t.split(":")
        s, ms = rest.replace(",", ".").split(".")
        cs = int(ms[:2]) if len(ms) >= 2 else int(ms) * 10
        return f"{int(h)}:{int(m):02d}:{int(s):02d}.{cs:02d}"

    lines = header
    for block in srt_text.strip().split("\n\n"):
        parts = block.strip().split("\n")
        if len(parts) >= 3:
            times = parts[1]
            text  = " ".join(parts[2:]).replace("\n", "\\N")
            start, end = [srt_time_to_ass(x) for x in times.split(" --> ")]
            lines += f"Dialogue: 0,{start},{end},Default,,0,0,0,,{text}\n"

    ass_path.write_text(lines, encoding="utf-8")


def _word_by_word_ass(script_text: str, ass_path: Path, video_path: Path = None,
                      start_sec: float = 0.4, end_sec: float = 9.5):
    """Generate word-by-word ASS subtitles — one word at a time, large bold, bottom-center.
    Matches reel-style-B.mp4 reference: big white text, black outline, word-by-word pop.
    Auto-detects video resolution so font scales correctly."""
    words = script_text.strip().split()
    if not words:
        return
    duration = end_sec - start_sec
    time_per_word = duration / len(words)

    # Auto-detect video resolution for correct ASS scaling
    res_x, res_y = 720, 1280  # default
    if video_path and video_path.exists():
        try:
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "stream=width,height",
                 "-of", "csv=p=0:s=x", str(video_path)],
                capture_output=True, text=True
            )
            for line in probe.stdout.strip().split("\n"):
                if "x" in line:
                    parts = line.strip().split("x")
                    res_x, res_y = int(parts[0]), int(parts[1])
                    break
        except Exception:
            pass

    # Font size relative to video width — ~10% of width for big bold words
    fontsize = max(int(res_x * 0.12), 60)
    margin_v = max(int(res_y * 0.08), 80)

    def sec_to_ass(s: float) -> str:
        h = int(s // 3600)
        m = int((s % 3600) // 60)
        sec = int(s % 60)
        cs = int((s % 1) * 100)
        return f"{h}:{m:02d}:{sec:02d}.{cs:02d}"

    # Bold white, thick black outline (5px), shadow, bottom-center
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {res_x}
PlayResY: {res_y}
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
        w_end   = start_sec + (i + 1) * time_per_word
        clean_word = word.upper()
        events += f"Dialogue: 0,{sec_to_ass(w_start)},{sec_to_ass(w_end)},Default,,0,0,0,,{clean_word}\n"

    ass_path.write_text(header + events, encoding="utf-8")
    log(f"  [Subs] Word-by-word ASS: {len(words)} words, {time_per_word:.2f}s each, font={fontsize}, res={res_x}x{res_y}")


def burn_subtitles(video_path: Path, srt_path: Path, output_path: Path,
                   script_text: str = ""):
    """Burn word-by-word subtitles bottom-center — large bold, one word at a time."""
    ass_path = srt_path.with_suffix(".ass")
    if script_text:
        # Word-by-word mode: big bold text, one word at a time
        _word_by_word_ass(script_text, ass_path, video_path=video_path)
    else:
        # Fallback to old SRT conversion
        _srt_to_ass(srt_path, ass_path, alignment=2, fontsize=48, margin_v=160)
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(video_path),
         "-vf", f"ass={str(ass_path)}",
         "-c:a", "copy", str(output_path)],
        check=True, capture_output=True, text=True
    )

def burn_title_card(video_path: Path, text: str, output_path: Path):
    """Burn large centered title card on the 3-second cut using ASS overlay."""
    srt_path = video_path.parent / "title_card.srt"
    ass_path = video_path.parent / "title_card.ass"
    srt_path.write_text(
        f"1\n00:00:00,100 --> 00:00:02,900\n{text}\n",
        encoding="utf-8"
    )
    # Middle-center (alignment=5), larger font for hook card impact
    _srt_to_ass(srt_path, ass_path, alignment=5, fontsize=36, margin_v=0)
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(video_path),
         "-vf", f"ass={str(ass_path)}",
         "-c:a", "copy", str(output_path)],
        check=True, capture_output=True, text=True
    )
# ── Claude Agents ─────────────────────────────────────────────────────────────

def run_character_agent() -> dict:
    log("\n" + "="*60)
    log("AGENT 1: Character Agent (Claude) — casting for social media")
    log("="*60)

    client = anthropic.Anthropic(api_key=ANTHROPIC_KEY)

    system_prompt = """You are a top Hollywood casting director and social media creative director.
Cast a character for a vertical social media ad — photogenic, scroll-stopping, real.

CRITICAL RULES FOR IMAGE GENERATION QUALITY:
- VARY every call: rotate ethnicity (Black American, Latina, South Asian, East Asian, Middle Eastern, White, Mixed),
  gender, age 24-40. Never default to the same type.
- Genuinely beautiful or handsome — but NATURAL. No over-described fantasy features.
- The PROMPT field is what goes directly to the AI image generator. Keep it under 100 words.
- Focus the prompt on: face, skin, expression, hair, outfit, lighting, camera angle. That's it.
- Do NOT overload with tiny details the AI can't render (specific jewelry pieces, fabric weave patterns, exact nail color).
- Describe 1 outfit look clearly. 1 hairstyle clearly. 1 expression clearly. That's enough.
- Simple clean backgrounds work best: solid color, blurred city, studio backdrop.
- End prompt with camera/lens specs for photorealism.

Output ONLY valid JSON. No markdown. No explanation."""

    user_prompt = f"""Cast a character for a credit repair social media ad (Instagram/TikTok, 9:16).
Business: {TENANT_CONTEXT["business_name"]} — {TENANT_CONTEXT["industry"]}
Audience: {TENANT_CONTEXT["target_audience"]}

Return JSON with EXACTLY these fields:
{{
  "gender": "woman or man",
  "age": 24-40,
  "ethnicity": "specific, precise ethnicity",
  "skin_tone": "e.g. deep ebony, warm golden brown, fair porcelain",
  "face_features": {{
    "cheekbones": "description",
    "eyes": "full description including color, shape, lashes",
    "lips": "color, fullness, natural pigment",
    "brows": "shape, thickness, style"
  }},
  "hair": {{
    "style": "specific style",
    "color": "specific color with undertones/highlights",
    "length": "exact length",
    "texture": "fine/thick/coily/wavy etc"
  }},
  "makeup": {{
    "foundation": "finish, coverage, shade note",
    "eyes": "specific eye look",
    "lips": "specific lip color and finish",
    "glow": "highlight placement, skin finish"
  }},
  "outfit": {{
    "top": "specific piece",
    "bottom": "specific piece",
    "shoes": "specific or not visible",
    "accessories": "jewelry, bag, etc",
    "jewelry": "specific pieces"
  }},
  "expression": "specific expression — what does it say emotionally",
  "body_position": "e.g. half-body sitting leaning forward, or standing arms relaxed, or walking",
  "camera_angle": "e.g. eye-level medium shot 85mm",
  "prompt": "Under 100 words. Photorealistic portrait prompt. Start: [gender], [age]-year-old [ethnicity], [skin_tone] skin... Focus on face, expression, hair, outfit, lighting. Keep it clean and focused — fewer details = better AI rendering. End: Shot on 85mm f/1.8, 9:16 vertical, photorealistic, sharp focus on eyes, 8K."
}}

Return ONLY the JSON object."""

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        messages=[{"role": "user", "content": user_prompt}],
        system=system_prompt,
    )
    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        lines = raw.split("\n")
        raw = "\n".join(lines[1:-1]) if lines[-1].strip() == "```" else "\n".join(lines[1:])
    character = json.loads(raw)
    log(f"  Cast: {character['age']}yo {character['ethnicity']} {character['gender']}")
    log(f"  Hair: {character['hair']['style']}, {character['hair']['color']}")
    log(f"  Outfit: {character['outfit']['top']}")
    return character


def run_scene_agent(character: dict) -> dict:
    log("\n" + "="*60)
    log("AGENT 2: Scene Agent (Claude) — 2026 location design")
    log("="*60)

    client = anthropic.Anthropic(api_key=ANTHROPIC_KEY)

    system_prompt = """You are a cinematic location scout and photographer for premium social media ads.
Design a specific, real-feeling scene — aspirational but authentic.

CRITICAL RULES FOR IMAGE GENERATION QUALITY:
- Keep the prompt FOCUSED. Max 3 objects in frame. Flux AI renders fewer details better.
- Do NOT name specific products (no "iPhone 16 Pro", no "MacBook M4"). Say "modern smartphone" or "sleek laptop".
- Do NOT name specific venues or restaurants. Describe the look instead.
- Do NOT describe text on screens — AI cannot render readable text.
- Focus 70% of the prompt on the PERSON (face, expression, body language, outfit) and 30% on environment.
- Lighting and mood matter more than props. One great light source > five props.
- The prompt MUST start: 'The same [gender] from the reference image — same face, same [outfit] —'
- The scene shows someone who just got great financial news — relief, quiet joy, disbelief turning to smile.
- Vary locations: modern apartment, rooftop, café, beach, city street, park, car interior, co-working space.

Output ONLY valid JSON. No markdown."""

    user_prompt = f"""Design a scene for:
Character: {character['age']}yo {character['ethnicity']} {character['gender']}
Wearing: {character['outfit']['top']}, {character['outfit'].get('bottom','')}
Hair: {character['hair']['style']}, {character['hair']['color']}

Business: {TENANT_CONTEXT["business_name"]} — {TENANT_CONTEXT["industry"]}
Emotional arc: stressed about credit → just found out score went up → relief + joy
Format: 9:16 vertical Instagram/TikTok

Return JSON:
{{
  "location_name": "general location type + vibe",
  "time_of_day": "specific time",
  "lighting": "direction, quality, warmth — this is the most important visual element",
  "background_details": "2-3 key background elements, softly blurred behind subject",
  "mood": "one phrase",
  "color_palette": "2-3 dominant warm tones",
  "modern_props": ["MAX 2 items — e.g. smartphone, coffee cup. No brand names."],
  "what_character_is_doing": "exact action, expression, and body language — keep it simple and emotional. This drives the video.",
  "hook_card_suggestion": "5-7 word punchy hook for the 3-second cut",
  "prompt": "Cinematic prompt under 120 words. Start: 'The same [gender] from the reference image — same face, same [outfit] —'. Focus on face/expression/lighting. Minimal props. End: 'Photorealistic, cinematic, shallow depth of field, 9:16 vertical, 85mm f/1.8, 8K.'"
}}

Return ONLY the JSON object."""

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        messages=[{"role": "user", "content": user_prompt}],
        system=system_prompt,
    )
    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        lines = raw.split("\n")
        raw = "\n".join(lines[1:-1]) if lines[-1].strip() == "```" else "\n".join(lines[1:])
    scene = json.loads(raw)
    log(f"  Location: {scene['location_name']}")
    log(f"  Action: {scene['what_character_is_doing']}")
    log(f"  Hook card: {scene.get('hook_card_suggestion','')}")
    return scene


def run_script_agent(character: dict, scene: dict) -> dict:
    """Generate a 10-second spoken script + hook card text for the 3-second cut."""
    log("\n" + "="*60)
    log("AGENT 3: Script Agent (Claude) — 10-sec script + 3-sec hook")
    log("="*60)

    client = anthropic.Anthropic(api_key=ANTHROPIC_KEY)

    system_prompt = """You are an expert social media video copywriter.
Write scripts that feel like real advice from a trusted friend — never salesy, never corporate.

For the 10-second script:
- Exactly 15-18 words MAX. Short punchy sentences. Must fit 10 seconds displayed word-by-word.
- First person, direct to camera
- Authentic — not a pitch

For the 3-second hook card:
- 4-7 words max. Punchy, scroll-stopping text overlay.
- No periods. Can use ? or !
- Think: the thumbnail text that makes someone tap

Output ONLY valid JSON. No markdown."""

    # Pick a random tone category from a diverse set
    tone_options = [
        ("calm and reassuring",    "empathetic",  "speaks softly, slight forward lean, warm eye contact"),
        ("urgent and direct",       "fired up",    "leans in, speaks clearly and fast, eyes intense"),
        ("warm and conversational", "relatable",   "natural hand gesture, casual energy, genuine smile"),
        ("authoritative expert",    "confident",   "measured pace, sits back slightly, calm authority"),
        ("vulnerable and honest",   "raw",         "looks down then up, voice slightly hushed, real"),
        ("excited breakthrough",    "joyful",      "eyes wide, slight head tilt, can't help smiling"),
    ]
    tone, emotion, tone_dir = random.choice(tone_options)

    user_prompt = f"""Write a social media script for a credit repair ad.

Character: {character['age']}yo {character['ethnicity']} {character['gender']}
Scene: {scene['location_name']}, {scene['time_of_day']}
Action: {scene['what_character_is_doing']}

Business: {TENANT_CONTEXT["business_name"]}
Value prop: {TENANT_CONTEXT["value_proposition"]}
CTA: {TENANT_CONTEXT["call_to_action"]}
Tone for this variation: {tone} / {emotion}
Delivery note: {tone_dir}

Return JSON:
{{
  "tone": "{tone}",
  "emotion": "{emotion}",
  "tone_direction": "{tone_dir}",
  "script_10s": "15-18 words MAX. Short punchy sentences. Ends with CTA. Must fit 10 seconds word-by-word.",
  "say_prompt": "Say: [exact same words as script_10s]",
  "hook_card_3s": "4-7 word scroll-stopping hook text for 3-second visual cut. No period.",
  "motion_prompt_3s": "2-sentence visual motion description for the 3-second cut. No dialogue. Just what the character does physically — a micro-moment of emotion or action."
}}

Return ONLY the JSON object."""

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{"role": "user", "content": user_prompt}],
        system=system_prompt,
    )
    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        lines = raw.split("\n")
        raw = "\n".join(lines[1:-1]) if lines[-1].strip() == "```" else "\n".join(lines[1:])
    script = json.loads(raw)
    log(f"  10s script [{script['tone']}]: {script['script_10s']}")
    log(f"  Hook card: {script['hook_card_3s']}")
    log(f"  3s motion: {script['motion_prompt_3s']}")
    return script


# ── Upscale ───────────────────────────────────────────────────────────────────

def upscale_topaz(image_url: str, label: str, model: str = "High Fidelity V2") -> str:
    """Upscale an image via Higgsfield's Topaz endpoint. Returns new URL."""
    log(f"\n  [Topaz Upscale] {label} — model={model}")
    resp = api_post("/topaz/upscale/image", {
        "image_url": image_url,
        "model":     model,
    })
    request_id = resp.get("request_id") or resp.get("id")
    if not request_id:
        log(f"  [Topaz] No request_id: {resp}")
        return image_url  # fallback to original
    done = poll_platform(request_id, f"Topaz ({label})", max_wait=300)
    up_url = get_image_url(done)
    if not up_url:
        log(f"  [Topaz] Could not extract URL, using original")
        return image_url
    log(f"  [Topaz] Upscaled: {up_url[:80]}...")
    return up_url


REALESRGAN_BIN = Path("/tmp/realesrgan-bin/realesrgan-ncnn-vulkan")
REALESRGAN_MODELS = Path("/tmp/realesrgan-bin/models")

def upscale_realesrgan(image_path: Path, output_path: Path, scale: int = 4) -> Path:
    """Upscale a local image with Real-ESRGAN ncnn binary. Returns output path."""
    log(f"\n  [Real-ESRGAN] Upscaling {image_path.name} @ {scale}x...")
    if not REALESRGAN_BIN.exists():
        log(f"  [Real-ESRGAN] Binary not found at {REALESRGAN_BIN}")
        return image_path
    try:
        result = subprocess.run(
            [str(REALESRGAN_BIN),
             "-i", str(image_path),
             "-o", str(output_path),
             "-s", str(scale),
             "-n", "realesrgan-x4plus",
             "-m", str(REALESRGAN_MODELS)],
            capture_output=True, text=True, timeout=120
        )
        if output_path.exists() and output_path.stat().st_size > 0:
            log(f"  [Real-ESRGAN] Done → {output_path} ({output_path.stat().st_size:,} bytes)")
            return output_path
        else:
            log(f"  [Real-ESRGAN] Failed: {result.stderr[:300]}")
            return image_path
    except Exception as e:
        log(f"  [Real-ESRGAN] Error: {e}")
        return image_path


# ── Image Stages ──────────────────────────────────────────────────────────────

def stage1_character_image(character_prompt: str) -> tuple:
    char_path     = WORK_DIR / "character.png"
    char_url_file = WORK_DIR / "character_url.txt"

    if char_path.exists() and char_url_file.exists():
        log(f"\nStage 1 — character image already exists, skipping")
        return char_url_file.read_text().strip(), char_path

    log(f"\n{'='*60}")
    log("STAGE 1: Character image (flux-pro/kontext/max/text-to-image)")
    log("="*60)

    resp = api_post("/flux-pro/kontext/max/text-to-image", {
        "prompt":           character_prompt,
        "aspect_ratio":     "9:16",
        "safety_tolerance": 2,
        "seed":             random.randint(0, 1_000_000),
    })
    request_id = resp.get("request_id") or resp.get("id")
    if not request_id:
        raise RuntimeError(f"No request_id in Stage 1: {resp}")

    done     = poll_platform(request_id, "Stage 1 (character)", max_wait=600)
    char_url = get_image_url(done)
    if not char_url:
        raise RuntimeError("Could not extract image URL from Stage 1")

    log(f"\n  Character URL: {char_url}")
    download_file(char_url, char_path)
    char_url_file.write_text(char_url)
    return char_url, char_path


def stage2_scene_image(scene_prompt: str, char_url: str) -> tuple:
    scene_path     = WORK_DIR / "scene.png"
    scene_url_file = WORK_DIR / "scene_url.txt"

    if scene_path.exists() and scene_url_file.exists():
        log(f"\nStage 2 — scene image already exists, skipping")
        return scene_url_file.read_text().strip(), scene_path

    log(f"\n{'='*60}")
    log("STAGE 2: Scene image (Flux Kontext edit — character ref)")
    log("="*60)

    resp = api_post("/flux-pro/kontext/max/text-to-image", {
        "prompt":           scene_prompt,
        "image_url":        char_url,
        "aspect_ratio":     "9:16",
        "safety_tolerance": 2,
        "seed":             random.randint(0, 1_000_000),
    })
    request_id = resp.get("request_id") or resp.get("id")
    if not request_id:
        raise RuntimeError(f"No request_id in Stage 2: {resp}")

    done      = poll_platform(request_id, "Stage 2 (scene)", max_wait=600)
    scene_url = get_image_url(done)
    if not scene_url:
        raise RuntimeError("Could not extract image URL from Stage 2")

    log(f"\n  Scene URL: {scene_url}")
    download_file(scene_url, scene_path)
    scene_url_file.write_text(scene_url)
    return scene_url, scene_path
# ── Video Generation (Parallel) ───────────────────────────────────────────────

def _gen_clip(scene_url: str, prompt: str, duration: int,
              label: str, results: dict, errors: dict, key: str,
              endpoint: str = "/wan-25-preview/image-to-video"):
    """Thread worker — submits a video request, polls to completion."""
    try:
        log(f"\n  [{label}] Submitting to {endpoint}... duration={duration}s")
        resp = api_post(endpoint, {
            "image_url": scene_url,
            "prompt":    prompt,
            "duration":  duration,
        })
        log(f"  [{label}] Submitted: {json.dumps(resp)[:150]}")

        request_id = resp.get("request_id") or resp.get("id")
        if not request_id:
            raise RuntimeError(f"No request_id: {resp}")

        done = poll_platform(request_id, label, max_wait=700)
        video_url = get_video_url(done)
        if not video_url:
            raise RuntimeError(f"No video URL in response")

        results[key] = video_url
        log(f"  [{label}] Done: {video_url[:80]}...")
    except Exception as e:
        errors[key] = str(e)
        log(f"  [{label}] ERROR: {e}")


def stage3_generate_both_clips(scene_url: str, scene: dict, script: dict) -> dict:
    """
    Submit the 10-second clip and 3-second clip SIMULTANEOUSLY.
    Returns {"clip_10s": url, "clip_3s": url}
    """
    url_10s_file = WORK_DIR / "clip_10s_url.txt"
    url_3s_file  = WORK_DIR / "clip_3s_url.txt"

    if url_10s_file.exists() and url_3s_file.exists():
        log(f"\nStage 3 — both clips already generated, skipping")
        return {
            "clip_10s": url_10s_file.read_text().strip(),
            "clip_3s":  url_3s_file.read_text().strip(),
        }

    log(f"\n{'='*60}")
    log("STAGE 3: Generating 10-second + 3-second clips SIMULTANEOUSLY")
    log("="*60)

    # 10-second prompt: scene context + tone + spoken script
    scene_action = scene.get("what_character_is_doing", "")[:200]
    tone_dir     = script.get("tone_direction", "")
    say_prompt   = script.get("say_prompt", "")
    prompt_10s   = (f"{scene_action} {tone_dir}. {say_prompt} "
                    "She finishes speaking and pauses with a calm, knowing look. "
                    "Subtle natural movement only — breathing, slight smile. No more talking.")

    # 3-second prompt: visual motion only — no dialogue
    motion_3s  = script.get("motion_prompt_3s", scene_action[:150])
    prompt_3s  = f"{motion_3s} Cinematic, natural motion, no dialogue."

    results, errors = {}, {}

    # 10-second: WAN 2.5
    t10 = threading.Thread(
        target=_gen_clip,
        args=(scene_url, prompt_10s, 10, "10-sec clip (WAN 2.5)", results, errors, "clip_10s"),
        daemon=True
    )
    # 3-second: WAN 2.5
    t3 = threading.Thread(
        target=_gen_clip,
        args=(scene_url, prompt_3s, 5, "3-sec clip (WAN 2.5)", results, errors, "clip_3s"),
        daemon=True
    )

    t10.start()
    t3.start()
    t10.join()
    t3.join()

    if errors:
        raise RuntimeError(f"Video generation failed: {errors}")
    if "clip_10s" not in results or "clip_3s" not in results:
        raise RuntimeError(f"Missing clip results. Got: {list(results.keys())}")

    url_10s_file.write_text(results["clip_10s"])
    url_3s_file.write_text(results["clip_3s"])
    return results


# ── Final Assembly ────────────────────────────────────────────────────────────

def assemble_clips(clip_urls: dict, script: dict, genre: str):
    """
    Download, process, and mix both clips:
    - 10-second: speech subtitles + music (ducked)
    - 3-second: trimmed to 3s + title card + music (loud)
    """
    log(f"\n{'='*60}")
    log(f"ASSEMBLE: Downloading + processing both clips (music genre: {genre})")
    log("="*60)

    raw_10s = WORK_DIR / "raw_10s.mp4"
    raw_3s  = WORK_DIR / "raw_3s_5sec.mp4"
    trim_3s = WORK_DIR / "raw_3s_trimmed.mp4"

    # Download both clips in parallel
    results, errors = {}, {}
    def dl(url, dest, key):
        try:
            download_file(url, dest)
            results[key] = str(dest)
        except Exception as e:
            errors[key] = str(e)

    t1 = threading.Thread(target=dl, args=(clip_urls["clip_10s"], raw_10s, "10s"), daemon=True)
    t2 = threading.Thread(target=dl, args=(clip_urls["clip_3s"],  raw_3s,  "3s"),  daemon=True)
    t1.start(); t2.start(); t1.join(); t2.join()

    if errors:
        raise RuntimeError(f"Download failed: {errors}")

    # Trim 5-second clip to 3 seconds
    log("  Trimming 3-second cut to exactly 3.0s...")
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(raw_3s), "-t", "3", "-c", "copy", str(trim_3s)],
        check=True, capture_output=True
    )

    # Fetch music
    music_path = fetch_music(genre)

    # ── 10-second: subtitles + music ─────────────────────────────────────────
    log("\n  Processing 10-second cut...")

    # Word-by-word subtitles
    srt_10s = WORK_DIR / "subs_10s.srt"
    script_text = script.get("script_10s", "")
    # SRT still written as fallback reference
    srt_10s.write_text(
        f"1\n00:00:00,500 --> 00:00:09,500\n{script_text}\n",
        encoding="utf-8"
    )

    subbed_10s = WORK_DIR / "subbed_10s.mp4"
    burn_subtitles(raw_10s, srt_10s, subbed_10s, script_text=script_text)

    final_10s = WORK_DIR / "final_10s.mp4"
    mix_audio(subbed_10s, music_path, final_10s, has_voice=True, genre=genre)

    # ── 3-second: title card + music ─────────────────────────────────────────
    log("\n  Processing 3-second cut...")
    hook_text  = script.get("hook_card_3s", scene_suggestion(script))
    card_3s    = WORK_DIR / "card_3s.mp4"
    burn_title_card(trim_3s, hook_text, card_3s)

    final_3s = WORK_DIR / "final_3s.mp4"
    mix_audio(card_3s, music_path, final_3s, has_voice=False, genre=genre)

    return final_10s, final_3s


def scene_suggestion(script: dict) -> str:
    """Fallback hook card if not in script."""
    return script.get("hook_card_3s", "Your credit story isn't over")


def copy_to_downloads(final_10s: Path, final_3s: Path, script: dict):
    dl_dir = Path.home() / "Downloads" / "higgsfield-latest"
    dl_dir.mkdir(parents=True, exist_ok=True)

    # Also copy character + scene images if present
    for name in ("character.png", "scene.png"):
        src = WORK_DIR / name
        if src.exists():
            shutil.copy2(src, dl_dir / name)

    ts = time.strftime("%H%M%S")
    name_10 = f"10sec_{ts}.mp4"
    name_3  = f"3sec_{ts}.mp4"
    shutil.copy2(final_10s, dl_dir / name_10)
    shutil.copy2(final_3s,  dl_dir / name_3)

    subprocess.Popen(["open", str(dl_dir)])

    log(f"\n{'='*60}")
    log("DONE — Files in ~/Downloads/higgsfield-latest/")
    log("="*60)
    log(f"  10-second cut : {name_10}")
    log(f"  3-second  cut : {name_3}")
    log(f"  Character     : character.png")
    log(f"  Scene         : scene.png")
    log(f"  Script        : {script.get('script_10s','')}")
    log(f"  Hook card     : {script.get('hook_card_3s','')}")


# ── Main ──────────────────────────────────────────────────────────────────────

def run(fresh=False, skip_claude=False, skip_images=False, skip_video=False,
        genre=None, no_music=False):

    log("="*60)
    log("HIGGSFIELD SOCIAL CUTS")
    log("  10-second: voice + subtitles + background music")
    log("  3-second:  visual hook + title card + music")
    log("="*60)

    if fresh:
        log("\nFresh run — clearing cache...")
        for f in WORK_DIR.iterdir():
            f.unlink()

    # Pick music genre
    if no_music:
        chosen_genre = None
    else:
        chosen_genre = genre or random.choice(list(MUSIC_GENRES.keys()))
        log(f"\nMusic genre: {chosen_genre}")

    # ── Claude agents ─────────────────────────────────────────────────────────
    char_file   = WORK_DIR / "character_agent.json"
    scene_file  = WORK_DIR / "scene_agent.json"
    script_file = WORK_DIR / "script_agent.json"

    if skip_claude and char_file.exists() and scene_file.exists() and script_file.exists():
        log("\nStep 0 — reusing cached Claude outputs")
        character = json.loads(char_file.read_text())
        scene     = json.loads(scene_file.read_text())
        script    = json.loads(script_file.read_text())
    else:
        character = run_character_agent()
        char_file.write_text(json.dumps(character, indent=2))

        scene = run_scene_agent(character)
        scene_file.write_text(json.dumps(scene, indent=2))

        script = run_script_agent(character, scene)
        script_file.write_text(json.dumps(script, indent=2))

    # ── Image stages ─────────────────────────────────────────────────────────
    char_url_file  = WORK_DIR / "character_url.txt"
    scene_url_file = WORK_DIR / "scene_url.txt"

    if skip_images and char_url_file.exists() and scene_url_file.exists():
        log("\nSkipping image stages — using cached URLs")
        char_url  = char_url_file.read_text().strip()
        scene_url = scene_url_file.read_text().strip()
    else:
        char_url, _  = stage1_character_image(character["prompt"])
        scene_url, _ = stage2_scene_image(scene["prompt"], char_url)

    # ── Upscale comparison ────────────────────────────────────────────────────
    upscale_mode = None
    for arg in sys.argv[1:]:
        if arg.startswith("--upscale="):
            upscale_mode = arg.split("=", 1)[1].strip()
        elif arg == "--upscale":
            upscale_mode = "both"

    if upscale_mode:
        log(f"\n{'='*60}")
        log(f"UPSCALE COMPARISON — mode: {upscale_mode}")
        log("="*60)

        scene_path = WORK_DIR / "scene.png"

        if upscale_mode in ("topaz", "both"):
            topaz_url = upscale_topaz(scene_url, "scene image")
            topaz_path = WORK_DIR / "scene_topaz.png"
            download_file(topaz_url, topaz_path)
            # Use Topaz URL for video generation
            if upscale_mode == "topaz":
                scene_url = topaz_url
                scene_url_file.write_text(scene_url)

        if upscale_mode in ("realesrgan", "both"):
            esrgan_path = WORK_DIR / "scene_realesrgan.png"
            upscale_realesrgan(scene_path, esrgan_path, scale=4)

        if upscale_mode == "both":
            # Copy both to Downloads for comparison
            dl_dir = Path.home() / "Downloads" / "higgsfield-latest"
            dl_dir.mkdir(parents=True, exist_ok=True)
            for name in ("scene.png", "scene_topaz.png", "scene_realesrgan.png"):
                src = WORK_DIR / name
                if src.exists():
                    shutil.copy2(src, dl_dir / name)
            log("\n  Comparison images copied to ~/Downloads/higgsfield-latest/")
            log("  Open all 3 and compare: scene.png vs scene_topaz.png vs scene_realesrgan.png")

    # ── Video generation ──────────────────────────────────────────────────────
    if skip_video and (WORK_DIR / "clip_10s_url.txt").exists() and (WORK_DIR / "clip_3s_url.txt").exists():
        log("\nSkipping video generation — using cached URLs")
        clip_urls = {
            "clip_10s": (WORK_DIR / "clip_10s_url.txt").read_text().strip(),
            "clip_3s":  (WORK_DIR / "clip_3s_url.txt").read_text().strip(),
        }
    else:
        clip_urls = stage3_generate_both_clips(scene_url, scene, script)

    # ── Assemble ─────────────────────────────────────────────────────────────
    final_10s, final_3s = assemble_clips(clip_urls, script, chosen_genre or "dramatic")

    # ── Output ────────────────────────────────────────────────────────────────
    copy_to_downloads(final_10s, final_3s, script)


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    fresh       = "--fresh"       in sys.argv
    skip_claude = "--skip-claude" in sys.argv
    skip_images = "--skip-images" in sys.argv
    skip_video  = "--skip-video"  in sys.argv
    no_music    = "--no-music"    in sys.argv

    genre = None
    for arg in sys.argv[1:]:
        if arg.startswith("--genre="):
            genre = arg.split("=", 1)[1].strip()
            if genre not in MUSIC_GENRES:
                print(f"Unknown genre '{genre}'. Options: {', '.join(MUSIC_GENRES)}")
                sys.exit(1)

    # Load .env.local
    env_file = Path(__file__).parent.parent / ".env.local"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip())

    ANTHROPIC_KEY  = os.environ.get("ANTHROPIC_API_KEY", ANTHROPIC_KEY)
    HIGGSFIELD_KEY = os.environ.get("HIGGSFIELD_API_KEY", HIGGSFIELD_KEY)
    HIGGSFIELD_SEC = os.environ.get("HIGGSFIELD_API_SECRET", HIGGSFIELD_SEC)
    PIXABAY_KEY    = os.environ.get("PIXABAY_API_KEY", PIXABAY_KEY)
    AUTH           = f"Key {HIGGSFIELD_KEY}:{HIGGSFIELD_SEC}"

    if not ANTHROPIC_KEY:
        print("ERROR: ANTHROPIC_API_KEY not set. Check .env.local")
        sys.exit(1)

    run(fresh=fresh, skip_claude=skip_claude, skip_images=skip_images,
        skip_video=skip_video, genre=genre, no_music=no_music)
