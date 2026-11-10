"""AI assets for the pilot, through the team's deployed Modal app `assetgen` (as Sinking Ball does):
Qwen paints images from each brief's `sheet` prompt, Pixal3D turns a chosen image into a textured mesh.

    python tools/assetgen.py images [asset ...] [--seed 21]     -> assets/pilot/<asset>/img_<seed>_<i>.png, sheet_<seed>.png
    python tools/assetgen.py mesh asset=img_21_2.png ...        -> assets/pilot/<asset>/raw_<image>.glb

Needs: pip install modal pillow, and `modal token new` (the sharpe workspace). Tag: jan/arachnophobia.
"""
import argparse
import io
import json
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "assets" / "pilot"
TAG = "jan/arachnophobia"


def brief(asset):
    return json.loads((ROOT / asset / "asset.json").read_text())


def images(asset, seed):
    import modal
    from PIL import Image
    folder = ROOT / asset
    r = modal.Cls.from_name("assetgen", "Qwen")().generate.remote(prompt=brief(asset)["sheet"], n=4, aspect="1:1", seed=seed, tag=TAG)
    tiles = []
    for i, (name, data) in enumerate(sorted(r["files"].items())):
        if not name.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
            continue
        im = Image.open(io.BytesIO(data)).convert("RGB")
        im.save(folder / f"img_{seed}_{i}.png")
        tiles.append(im)
    sheet = Image.new("RGB", (1024, 1024), (40, 40, 40))
    for i, t in enumerate(tiles[:4]):
        t = t.copy(); t.thumbnail((512, 512))
        sheet.paste(t, ((i % 2) * 512 + (512 - t.width) // 2, (i // 2) * 512 + (512 - t.height) // 2))
    sheet.save(folder / f"sheet_{seed}.png")
    print("IMAGES", asset, len(tiles), flush=True)


def mesh(asset, chosen):
    import modal
    folder = ROOT / asset
    data = (folder / chosen).read_bytes()
    for attempt in range(4):
        try:
            r = modal.Cls.from_name("assetgen", "Mesh")().run.remote(image=data, n=1, resolution=1024, tag=TAG)
            break
        except Exception as e:  # a cold GPU or a busy queue: wait and retry
            print("MESH_RETRY", asset, attempt, str(e)[:160].replace("\n", " "), flush=True)
            if attempt == 3:
                raise
            time.sleep(60)
    glbs = {k: v for k, v in r["files"].items() if k.endswith(".glb")}
    (folder / f"raw_{Path(chosen).stem}.glb").write_bytes(sorted(glbs.items())[0][1])
    print("MESHED", asset, flush=True)


if __name__ == "__main__":
    a = argparse.ArgumentParser()
    a.add_argument("cmd", choices=["images", "mesh"])
    a.add_argument("args", nargs="*")
    a.add_argument("--seed", type=int, default=21)
    p = a.parse_args()
    if p.cmd == "images":
        names = p.args or sorted(d.name for d in ROOT.iterdir() if (d / "asset.json").exists())
        with ThreadPoolExecutor(6) as ex:
            list(ex.map(lambda n: images(n, p.seed), names))
    else:
        pairs = [s.split("=") for s in p.args]
        with ThreadPoolExecutor(6) as ex:
            list(ex.map(lambda q: mesh(q[0], q[1]), pairs))
