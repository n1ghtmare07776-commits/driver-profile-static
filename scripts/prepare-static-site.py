#!/usr/bin/env python3
import argparse
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FRONTEND = ROOT / "reference" / "current-cdn-frontend"


def parse_args():
    parser = argparse.ArgumentParser(description="准备 CDN 静态站点前端文件。")
    parser.add_argument("--frontend-dir", default=str(DEFAULT_FRONTEND), help="前端源码目录")
    parser.add_argument("--out-dir", default="dist", help="输出目录，默认 dist")
    return parser.parse_args()


def main():
    args = parse_args()
    frontend_dir = Path(args.frontend_dir)
    out_dir = Path(args.out_dir)
    if not frontend_dir.exists():
        raise SystemExit(f"前端目录不存在：{frontend_dir}")
    out_dir.mkdir(parents=True, exist_ok=True)

    for name in ["index.html", "app.js", "styles.css"]:
        source = frontend_dir / name
        if not source.exists():
            raise SystemExit(f"缺少前端文件：{source}")
        shutil.copy2(source, out_dir / name)

    build_id = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    app_file = out_dir / f"app.{build_id}.js"
    styles_file = out_dir / f"styles.{build_id}.css"
    shutil.copy2(out_dir / "app.js", app_file)
    shutil.copy2(out_dir / "styles.css", styles_file)

    index_file = out_dir / "index.html"
    html = index_file.read_text(encoding="utf-8")
    html = re.sub(r'href="styles(?:\.[0-9]+)?\.css"', f'href="{styles_file.name}"', html)
    html = re.sub(r'src="app(?:\.[0-9]+)?\.js"', f'src="{app_file.name}"', html)
    index_file.write_text(html, encoding="utf-8")

    for old_file in out_dir.glob("app.*.js"):
        if old_file != app_file:
            old_file.unlink()
    for old_file in out_dir.glob("styles.*.css"):
        if old_file != styles_file:
            old_file.unlink()

    inline_file = out_dir / "index-inline.html"
    if inline_file.exists():
        inline_file.unlink()

    print(f"已准备静态站点前端：{out_dir}")
    print("下一步：运行 scripts/import-driver-data.py 生成 dist/data。")


if __name__ == "__main__":
    main()
