#!/usr/bin/env python3
"""
Generate narration audio for 'How to write effective AI prompts' using Edge TTS.

Voices:
  - English (en): en-US-ChristopherNeural
  - Thai (th):    th-TH-PremwadeeNeural

Outputs:
  assets/audio/<lang>/scene_01.mp3
  assets/audio/<lang>/scene_02.mp3
  assets/audio/<lang>/scene_03.mp3
  assets/audio/<lang>/scene_04.mp3
  assets/audio/<lang>/duration.json
"""

import asyncio
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
LOCALES_PATH = BASE_DIR / "locales.json"
AUDIO_DIR = BASE_DIR / "assets" / "audio"

VOICES = {
    "en": "en-US-ChristopherNeural",
    "th": "th-TH-PremwadeeNeural",
}

RATE_SETTINGS = {
    "en": "+10%",
    "th": "+8%",
}

SCENE_KEYS = ["01_hook", "02_intern", "03_formula", "04_cta"]


def get_audio_duration(file_path: Path) -> float:
    """Measure duration of an audio file using ffprobe."""
    try:
        cmd = [
            "ffprobe",
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(file_path),
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return round(float(res.stdout.strip()), 3)
    except Exception as e:
        print(f"Warning: ffprobe failed for {file_path}: {e}")
        return 0.0


async def synthesize_speech(text: str, voice: str, rate: str, output_path: Path):
    """Synthesize speech using edge-tts."""
    import edge_tts

    communicate = edge_tts.Communicate(text, voice, rate=rate)
    await communicate.save(str(output_path))


def process_language(lang: str, locales: dict):
    if lang not in VOICES:
        print(f"Error: Unknown language '{lang}'. Available: {list(VOICES.keys())}")
        return False

    if lang not in locales:
        print(f"Error: '{lang}' not found in locales.json")
        return False

    lang_dir = AUDIO_DIR / lang
    lang_dir.mkdir(parents=True, exist_ok=True)
    cache_file = lang_dir / ".cache.json"

    cache = {}
    if cache_file.exists():
        try:
            cache = json.loads(cache_file.read_text(encoding="utf-8"))
        except Exception:
            cache = {}

    voice = VOICES[lang]
    rate = RATE_SETTINGS.get(lang, "+0%")
    print(f"\n🎙️  Processing language: [{lang.upper()}] with voice: {voice}")

    durations = []
    updated = False

    for idx, scene_key in enumerate(SCENE_KEYS, start=1):
        scene_data = locales[lang].get(scene_key, {})
        narration = scene_data.get("narration", "")
        if not narration:
            print(f"  ⚠️  Scene {scene_key} has empty narration!")
            continue

        out_mp3 = lang_dir / f"scene_0{idx}.mp3"
        h = hashlib.sha256(f"{voice}|{rate}|{narration}".encode("utf-8")).hexdigest()

        if out_mp3.exists() and cache.get(str(idx), {}).get("hash") == h:
            dur = get_audio_duration(out_mp3)
            print(f"  ✓ Scene {idx} ({scene_key}): cached ({dur:.2f}s)")
        else:
            print(f"  ⚡ Scene {idx} ({scene_key}): synthesizing...")
            asyncio.run(synthesize_speech(narration, voice, rate, out_mp3))
            dur = get_audio_duration(out_mp3)
            print(f"  ✓ Scene {idx} ({scene_key}): saved -> {dur:.2f}s")
            cache[str(idx)] = {"hash": h, "text": narration, "duration": dur}
            updated = True

        durations.append(dur)

    if updated:
        cache_file.write_text(json.dumps(cache, indent=2, ensure_ascii=False), encoding="utf-8")

    meta = {
        "lang": lang,
        "voice": voice,
        "rate": rate,
        "scene_keys": SCENE_KEYS,
        "durations": durations,
        "total_duration": round(sum(durations), 3),
    }
    dur_file = lang_dir / "duration.json"
    dur_file.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"  📁 Wrote duration metadata: {dur_file} (Total voiceover: {meta['total_duration']:.2f}s)")
    return True


def main():
    if not LOCALES_PATH.exists():
        print(f"Error: locales.json not found at {LOCALES_PATH}")
        sys.exit(1)

    try:
        import edge_tts  # noqa: F401
    except ImportError:
        # Check if /tmp/tts-venv exists and re-exec
        venv_py = Path("/tmp/tts-venv/bin/python")
        if venv_py.exists():
            print(f"Re-running script using {venv_py}...")
            os.execv(str(venv_py), [str(venv_py)] + sys.argv)
        else:
            print("Error: edge-tts is not installed. Install with: pip install edge-tts")
            sys.exit(1)

    with open(LOCALES_PATH, "r", encoding="utf-8") as f:
        locales = json.load(f)

    target_langs = sys.argv[1:]
    if not target_langs or "all" in target_langs:
        target_langs = list(VOICES.keys())

    for lang in target_langs:
        process_language(lang, locales)

    print("\n✅ All voice generation completed successfully!")


if __name__ == "__main__":
    main()
