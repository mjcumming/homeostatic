"""Build a deterministic manual-install archive from a clean Git revision."""

import hashlib
import json
import subprocess
import sys
import tomllib
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


def git(root: Path, *args: str) -> bytes:
    """Read committed sources using the current worktree's Git environment."""
    return subprocess.check_output(["git", *args], cwd=root)


def main() -> None:
    """Package tracked integration assets, documentation and build identity."""
    root = Path(__file__).resolve().parents[1]
    if git(root, "status", "--porcelain").strip():
        raise SystemExit("Commit or isolate pending changes before building the pilot.")
    commit = git(root, "rev-parse", "HEAD").decode().strip()
    manifest = json.loads(
        git(root, "show", "HEAD:custom_components/homeostatic/manifest.json")
    )
    project = tomllib.loads(git(root, "show", "HEAD:pyproject.toml").decode())
    version = manifest["version"]
    if version != project["project"]["version"]:
        raise SystemExit("Project and integration versions must agree.")
    if manifest["requirements"] != project["project"]["dependencies"]:
        raise SystemExit("HA and development must install the same library release.")
    files = (
        git(
            root,
            "ls-tree",
            "-r",
            "--name-only",
            "HEAD",
            "custom_components/homeostatic",
            "blueprints/automation/homeostatic",
            "docs",
            "LICENSE",
            "README.md",
        )
        .decode()
        .splitlines()
    )
    contents = {name: git(root, "show", f"HEAD:{name}") for name in files}
    contents["INSTALL.md"] = (
        b"# Homeostatic pilot\n\nRead [the installation guide](docs/pilot.md) before installing.\n"
    )
    contents["BUILD_INFO.json"] = (
        json.dumps(
            {
                "version": version,
                "commit": commit,
                "requirements": manifest["requirements"],
                "tested_home_assistant": "2026.9.3",
                "files_sha256": {
                    name: hashlib.sha256(data).hexdigest()
                    for name, data in sorted(contents.items())
                },
            },
            indent=2,
            sort_keys=True,
        )
        + "\n"
    ).encode()
    output = root / "dist" / f"homeostatic-{version}-pilot.zip"
    output.parent.mkdir(exist_ok=True)
    with ZipFile(output, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(contents.items()):
            info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data, compresslevel=9)
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix(".zip.sha256").write_text(
        f"{digest}  {output.name}\n", encoding="utf-8"
    )
    sys.stdout.write(f"{output}\nSHA256 {digest}\nCommit {commit}\n")


if __name__ == "__main__":
    main()
