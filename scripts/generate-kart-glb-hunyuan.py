#!/usr/bin/env python3
"""
Zario Kart — Local Hunyuan3D-2 GLB Asset Generator (`scripts/generate-kart-glb-hunyuan.py`).

Uses your local `C:\\Users\\User\\Hunyuan3D-2` installation (`hy3dgen.shapegen` and
`hy3dgen.texgen`) to convert reference images into game-ready, decimated `.glb`
meshes in `public/models/` for Zario Kart's `ModelLoader.js`.

Usage:
  python scripts/generate-kart-glb-hunyuan.py --input path/to/kart_concept.png --output public/models/karts/kart-standard.glb --max-faces 3000
"""
import argparse
import os
import sys
from pathlib import Path

DEFAULT_HUNYUAN_PATH = Path(r"C:\Users\User\Hunyuan3D-2")


def main():
    parser = argparse.ArgumentParser(description="Generate Zario Kart GLB models using local Hunyuan3D-2")
    parser.add_argument("--hunyuan-dir", type=str, default=str(DEFAULT_HUNYUAN_PATH), help="Path to local Hunyuan3D-2 repo")
    parser.add_argument("--input", type=str, required=True, help="Input concept PNG/JPG image (with transparent or clean background)")
    parser.add_argument("--output", type=str, default="public/models/karts/kart-standard.glb", help="Output .glb path")
    parser.add_argument("--model-id", type=str, default="Tencent/Hunyuan3D-2mini", help="HuggingFace model ID")
    parser.add_argument("--subfolder", type=str, default="hunyuan3d-dit-v2-mini-turbo", help="Model subfolder")
    parser.add_argument("--max-faces", type=int, default=3000, help="Target triangle count for WebGL performance")
    parser.add_argument("--texture", action="store_true", help="Also run Hunyuan3D-Paint texture synthesis")
    args = parser.parse_args()

    hunyuan_dir = Path(args.hunyuan_dir)
    if hunyuan_dir.exists():
        sys.path.insert(0, str(hunyuan_dir))
    else:
        print(f"[WARN] Hunyuan3D-2 directory not found at {hunyuan_dir}; checking Python environment...")

    try:
        import torch
        from PIL import Image
        from hy3dgen.rembg import BackgroundRemover
        from hy3dgen.shapegen import (
            Hunyuan3DDiTFlowMatchingPipeline,
            FaceReducer,
            FloaterRemover,
            DegenerateFaceRemover,
        )
    except ImportError as exc:
        print(f"[ERROR] Missing Hunyuan3D-2 dependencies: {exc}")
        print("Activate your Hunyuan3D-2 conda/venv environment first, then re-run this script.")
        sys.exit(1)

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"[ERROR] Input image not found: {input_path}")
        sys.exit(1)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"[1/4] Loading reference image: {input_path}")
    image = Image.open(input_path).convert("RGBA")
    if image.mode == "RGB":
        rembg = BackgroundRemover()
        image = rembg(image)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[2/4] Initializing Hunyuan3D-2 Shape Pipeline ({args.model_id}) on {device}...")
    pipeline = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
        args.model_id,
        subfolder=args.subfolder,
        use_safetensors=True,
        device=device,
    )

    print("[3/4] Generating 3D mesh...")
    mesh = pipeline(
        image=image,
        num_inference_steps=20,
        octree_resolution=256,
        num_chunks=8000,
        generator=torch.manual_seed(42),
        output_type="trimesh",
    )[0]

    print(f"[4/4] Cleaning & decimating mesh to <= {args.max_faces} faces for WebGL/Three.js...")
    mesh = FloaterRemover()(mesh)
    mesh = DegenerateFaceRemover()(mesh)
    mesh = FaceReducer()(mesh, max_facenum=args.max_faces)

    if args.texture:
        from hy3dgen.texgen import Hunyuan3DPaintPipeline
        print("[Optional] Synthesizing UV texture map via Hunyuan3DPaintPipeline...")
        tex_pipe = Hunyuan3DPaintPipeline.from_pretrained("Tencent/Hunyuan3D-2")
        mesh = tex_pipe(mesh, image=image)

    mesh.export(str(output_path))
    print(f"[SUCCESS] Saved WebGL-ready GLB model to: {output_path}")


if __name__ == "__main__":
    main()
