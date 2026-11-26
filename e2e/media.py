"""E2E helper (run with the backend virtualenv's Python).

  media.py fixtures DIR   -> writes clip.mp4, photo.png, tone.wav into DIR
  media.py inspect FILE   -> prints JSON describing a rendered video/audio/image file
  media.py frame FILE SEC -> prints JSON with the mean saturation of the video frame at SEC
"""
import json
import subprocess
import sys
from pathlib import Path


def ffmpeg() -> str:
    from app.services.render.ffmpeg import ffmpeg_exe
    return ffmpeg_exe()


def fixtures(directory: Path) -> None:
    from PIL import Image, ImageDraw
    directory.mkdir(parents=True, exist_ok=True)
    subprocess.run([ffmpeg(), "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=30", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
                    "-t", "4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(directory / "clip.mp4")], check=True)
    subprocess.run([ffmpeg(), "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=44100", "-t", "3", str(directory / "tone.wav")], check=True)
    image = Image.new("RGB", (800, 600), (30, 120, 200))
    ImageDraw.Draw(image).ellipse([250, 150, 550, 450], fill=(250, 200, 40))
    image.save(directory / "photo.png")


def inspect(path: Path) -> dict:
    from app.services.render.ffmpeg import probe
    if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}:
        from PIL import Image
        with Image.open(path) as image:
            image.load()
            rgb = image.convert("RGB")
            return {"kind": "image", "format": image.format, "width": image.width, "height": image.height,
                    "center": list(rgb.getpixel((image.width // 2, image.height // 2)))}
    info = probe(path).as_dict()
    if info.get("has_audio"):
        result = subprocess.run([ffmpeg(), "-hide_banner", "-i", str(path), "-vn", "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True)
        for line in result.stderr.splitlines():
            if "mean_volume" in line:
                info["mean_volume_db"] = float(line.split("mean_volume:")[1].split("dB")[0])
    return {"kind": "media", **info}


def frame(path: Path, seconds: float) -> dict:
    from PIL import Image, ImageStat
    import io
    data = subprocess.run([ffmpeg(), "-v", "error", "-ss", str(seconds), "-i", str(path), "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"], capture_output=True, check=True).stdout
    image = Image.open(io.BytesIO(data)).convert("HSV")
    return {"saturation": ImageStat.Stat(image).mean[1], "width": image.width, "height": image.height}


if __name__ == "__main__":
    command, target = sys.argv[1], Path(sys.argv[2])
    if command == "frame":
        print(json.dumps(frame(target, float(sys.argv[3]))))
    elif command == "fixtures":
        fixtures(target)
    else:
        print(json.dumps(inspect(target)))
