#!/usr/bin/env python3
"""Deploy an entire dist/ directory to SmartWork CDN as a static site.

Uses the internal CDN upload service (100.69.238.36:8000) that the SmartWork
server uses, uploading each file via multipart POST so all relative paths
work correctly on the deployed site.

Usage:
    python3 scripts/cdn-dir-deploy.py --dir dist --deploy-id <id>
    python3 scripts/cdn-dir-deploy.py --dir dist  # auto-generate deploy-id
"""
import argparse, os, pathlib, sys, time, mimetypes, urllib.parse, uuid

try:
    import requests
except ImportError:
    sys.exit("需要 requests: pip3 install requests")

CDN_UPLOAD_HOST = os.environ.get("CDN_UPLOAD_HOST", "http://100.69.238.36:8000")
CDN_UPLOAD_ROOT = os.environ.get("CDN_UPLOAD_ROOT", "ep_static")
CDN_PUBLIC_HOST = os.environ.get("CDN_PUBLIC_HOST", "https://img-hxy021.didistatic.com")
CDN_PUBLIC_ROOT = os.environ.get("CDN_PUBLIC_ROOT", "static")
CDN_PRODUCT     = os.environ.get("CDN_PRODUCT", "smartgen")
SMARTWORK_APP_HOST = os.environ.get("SMARTWORK_APP_HOST", "http://smartwork.intra.xiaojukeji.com")


def upload_file(local_path: pathlib.Path, remote_key: str) -> dict:
    """Upload a single file to CDN via the internal upload service."""
    upload_url = f"{CDN_UPLOAD_HOST}/resource/{CDN_UPLOAD_ROOT}/{remote_key}"
    with open(local_path, "rb") as f:
        resp = requests.post(upload_url, files={"filecontent": (local_path.name, f)}, timeout=120)
    if resp.status_code != 200:
        return {"ok": False, "status": resp.status_code, "error": resp.text[:200]}
    data = resp.json()
    return {"ok": True, "download_url": data.get("download_url_https", data.get("download_url")), "file_size": data.get("file_size")}


def main():
    parser = argparse.ArgumentParser(description="Deploy dist/ directory to CDN")
    parser.add_argument("--dir", required=True, help="Local directory to deploy (e.g. dist)")
    parser.add_argument("--deploy-id", default=None, help="Deploy ID (auto-generated if omitted)")
    parser.add_argument("--prefix", default=None, help="CDN path prefix (default: smartgen/deploy/{deploy-id})")
    parser.add_argument("--dry-run", action="store_true", help="List files without uploading")
    args = parser.parse_args()

    dist_dir = pathlib.Path(args.dir).resolve()
    if not dist_dir.is_dir():
        sys.exit(f"Directory not found: {dist_dir}")

    deploy_id = args.deploy_id or f"site-{uuid.uuid4().hex[:12]}"
    prefix = args.prefix or f"{CDN_PRODUCT}/deploy/{deploy_id}"

    # Collect all files
    files = sorted(f for f in dist_dir.rglob("*") if f.is_file())
    print(f"Deploy ID: {deploy_id}")
    print(f"CDN prefix: {prefix}")
    print(f"Files to upload: {len(files)}")
    total_size = sum(f.stat().st_size for f in files)
    print(f"Total size: {total_size / 1024 / 1024:.1f} MB")
    print()

    if args.dry_run:
        for f in files:
            rel = f.relative_to(dist_dir)
            print(f"  {rel}")
        return

    # Upload each file
    ok_count = 0
    err_count = 0
    skip_count = 0
    start = time.time()
    for i, f in enumerate(files, 1):
        rel = f.relative_to(dist_dir)
        if not f.exists():
            skip_count += 1
            continue
        remote_key = f"{prefix}/{rel}"
        try:
            result = upload_file(f, remote_key)
        except Exception as e:
            result = {"ok": False, "error": str(e)[:200]}
        if result["ok"]:
            ok_count += 1
        else:
            err_count += 1
            print(f"  [{i}/{len(files)}] ERR {rel} — {result.get('error', '')}")
        # Progress every 200 files or for errors
        if i % 200 == 0 or not result["ok"]:
            elapsed = time.time() - start
            rate = i / elapsed if elapsed > 0 else 0
            eta = (len(files) - i) / rate if rate > 0 else 0
            print(f"  [{i}/{len(files)}] {ok_count} ok, {err_count} err, {skip_count} skip, {elapsed:.0f}s elapsed, ~{eta:.0f}s remaining")

    elapsed = time.time() - start
    print()
    print(f"Upload complete: {ok_count} ok, {err_count} err, {skip_count} skip in {elapsed:.1f}s")

    # Report URLs
    base_cdn = f"{CDN_PUBLIC_HOST}/{CDN_PUBLIC_ROOT}/{prefix}"
    app_url = f"{SMARTWORK_APP_HOST}/app/{deploy_id}"
    print()
    print(f"CDN base URL: {base_cdn}/")
    print(f"  index.html:  {base_cdn}/index.html")
    print(f"  styles.css:  {base_cdn}/styles.css")
    print(f"  app.js:      {base_cdn}/app.js")
    print(f"  data/:       {base_cdn}/data/")
    print()
    print(f"SmartWork app URL: {app_url}")
    print()
    print("Note: The SmartWork app URL wraps widget.json and won't serve multi-file sites.")
    print(f"Use the CDN base URL directly: {base_cdn}/index.html")


if __name__ == "__main__":
    main()
