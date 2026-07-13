import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "prepare-static-site.py"


def test_prepare_static_site_copies_frontend_files():
    tmp_root = tempfile.TemporaryDirectory()
    tmp_path = Path(tmp_root.name)
    output_dir = tmp_path / "dist"

    result = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--out-dir",
            str(output_dir),
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert (output_dir / "index.html").exists()
    assert (output_dir / "app.js").exists()
    assert (output_dir / "styles.css").exists()
    assert (output_dir / "filter-worker.js").exists()
    assert "风险前哨" in (output_dir / "index.html").read_text(encoding="utf-8")
    tmp_root.cleanup()


if __name__ == "__main__":
    test_prepare_static_site_copies_frontend_files()
