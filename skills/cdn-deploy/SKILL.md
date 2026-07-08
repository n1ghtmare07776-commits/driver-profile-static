---
name: cdn-deploy
description: Deploy the prepared multi-file driver-profile static site directory to CDN, or prepare exact manual upload steps when the current agent environment has no CDN uploader.
---

# CDN Deploy

Use this skill when the user asks to upload, publish, deploy, or refresh the generated `dist/` static site for the driver profile website.

## Important Entry Rule

This package does not use `index-inline.html`.

The static site entry file is:

```text
dist/index.html
```

Do not require, search for, or rebuild `index-inline.html`. Do not upload only `index.html` or any single widget/HTML artifact. This project intentionally uses a stable multi-file static site: `index.html` + `app.js` + `styles.css` + JSON data under `dist/data/`. The primary index file is `dist/data/drivers.json`; each day's queryable driver dataset is stored independently under `dist/data/daily/drivers-YYYY-MM-DD.json`.

## Before Upload

Generate or refresh the site first:

```bash
python3 scripts/prepare-static-site.py --out-dir dist
python3 scripts/import-driver-data.py <xlsx-or-csv> --upload-date YYYY-MM-DD --out-dir dist/data
```

Then check:

1. `dist/index.html` exists.
2. `dist/app.js` exists.
3. `dist/styles.css` exists.
4. `dist/data/manifest.json` exists.
5. `dist/data/drivers.json` exists.
6. `dist/data/daily/drivers-YYYY-MM-DD.json` exists for every retained data date.
7. `dist/data/strategy-thresholds.json` exists.
8. `manifest.generated_at`, `window_start`, `window_end`, and `row_count` are reported to the user.
9. The data window is upload-date inclusive rolling latest 7 calendar days.
10. The upload package is under 800MB.
11. `drivers.json` is a lightweight date index only; it must not contain multi-day driver details.
12. Each `daily/drivers-YYYY-MM-DD.json` contains only that natural day's driver details and does not include other dates or page-unneeded raw fields.

## What To Upload

First deployment:

```text
dist/
```

Daily data refresh when frontend code did not change:

```text
dist/data/
```

Daily refresh means replacing the old CDN `dist/data/` with the newly generated latest-7-day data window. It is not appending unlimited history and it is not keeping only the latest single day.

## Multi-File Upload Requirement

This project requires recursive multi-file upload with relative paths preserved.

Do not deploy this project through any flow that only accepts or publishes one HTML file, `index-inline.html`, `widget.json`, or another single-file artifact. If the current CDN tool only supports single-file HTML/widget upload, it is incompatible with this project. Stop, report that directory upload is required, and do not pretend the deployment succeeded.

For first deployment, upload every file and folder under `dist/` so the CDN can serve at least:

```text
/index.html
/app.js
/styles.css
/app.<build-id>.js
/styles.<build-id>.css
/data/manifest.json
/data/drivers.json
/data/daily/drivers-YYYY-MM-DD.json
/data/filter-options.json
/data/strategy-thresholds.json
```

For daily data refresh, recursively upload or replace every file and folder under `dist/data/`, including `drivers.json`, `manifest.json`, `filter-options.json`, `strategy-thresholds.json`, and the `daily/` directory. Preserve the `data/` path under the existing CDN site root so existing frontend relative URLs keep working.

## Upload Method

Use the CDN upload method available in the current agent environment:

- If a company CDN command-line tool is available, use it.
- If the agent has a built-in CDN deployment action, use it.
- If only manual upload is available, prepare the correct folder and tell the user exactly which folder to upload.

Before uploading, confirm the selected method can recursively upload a directory and preserve nested relative paths. If it cannot, do not use it for this project.

Do not invent credentials, bucket names, domains, or tokens. If required CDN credentials or destination information are missing, ask the user for the missing deployment target.

## Final Report

After upload or preparation, report:

- uploaded path: `dist/` or `dist/data/`
- upload mode: recursive multi-file directory upload
- generated time
- data window
- row count
- package size
- whether the original CDN link should continue to work
- verification paths checked, including `/index.html`, `/data/manifest.json`, `/data/drivers.json`, `/data/daily/drivers-YYYY-MM-DD.json`, and `/data/filter-options.json`
- any manual action still required
