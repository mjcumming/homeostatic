"""Verify release artifacts or explicitly install their component files."""

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import tomllib
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path, PurePosixPath
from zipfile import BadZipFile, ZipFile

PACKAGE_PATHS = (
    "custom_components/homeostatic",
    "blueprints/automation/homeostatic",
    "docs",
    "LICENSE",
    "README.md",
    "CHANGELOG.md",
)
COMPONENT = "custom_components/homeostatic/"
INSTALL_GUIDE = b"# Homeostatic installation\n\nRead [the installation guide](docs/install.md) before installing.\n"


def git(root: Path, *args: str) -> bytes:
    """Read committed sources without consulting the working tree."""
    return subprocess.check_output(["git", *args], cwd=root)


@dataclass(frozen=True, slots=True, kw_only=True)
class Release:
    """Verified identity and component bytes from one immutable archive read."""

    version: str
    commit: str
    requirements: tuple[str, ...]
    archive_sha256: str
    packaged_files: int
    component_files: dict[str, bytes]

    def receipt(self) -> dict[str, object]:
        """Describe file verification without implying CI or runtime acceptance."""
        return {
            "version": self.version,
            "commit": self.commit,
            "requirements": self.requirements,
            "archive_sha256": self.archive_sha256,
            "verified_packaged_files": self.packaged_files,
            "verified_component_files": len(self.component_files),
            "sources_match_commit": True,
        }


def verify_archive(archive_path: Path, commit: str, repository: Path) -> Release:
    """Check the sidecar, complete inventory and bytes against a Git candidate.

    Args:
        archive_path: Release ZIP accompanied by its .zip.sha256 sidecar.
        commit: Independently selected Git candidate, resolved to a full commit.
        repository: Repository containing that candidate's committed sources.

    Returns:
        Verified metadata and the component bytes available for installation.

    Raises:
        ValueError: The archive or its identity differs from the candidate.
    """
    commit = (
        git(
            repository,
            "rev-parse",
            "--verify",
            "--end-of-options",
            f"{commit}^{{commit}}",
        )
        .decode()
        .strip()
    )
    data = archive_path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    sidecar = archive_path.with_suffix(".zip.sha256").read_text().split()
    if not sidecar or sidecar[0] != digest:
        raise ValueError("Archive checksum differs from its sidecar.")
    manifest = json.loads(git(repository, "show", f"{commit}:{COMPONENT}manifest.json"))
    project = tomllib.loads(
        git(repository, "show", f"{commit}:pyproject.toml").decode()
    )
    if (
        manifest["version"] != project["project"]["version"]
        or manifest["requirements"] != project["project"]["dependencies"]
    ):
        raise ValueError("Candidate project and integration metadata disagree.")
    tracked = set(
        git(repository, "ls-tree", "-rz", "--name-only", commit, *PACKAGE_PATHS)
        .decode()
        .split("\0")
    ) - {""}
    with ZipFile(BytesIO(data)) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("Duplicate archive members.")
        if any(
            PurePosixPath(name).is_absolute()
            or ".." in PurePosixPath(name).parts
            or "\\" in name
            or ":" in name
            for name in names
        ):
            raise ValueError("Unsafe archive member path.")
        if set(names) != tracked | {"BUILD_INFO.json", "INSTALL.md"}:
            raise ValueError("Archive inventory differs from the candidate.")
        info = json.loads(archive.read("BUILD_INFO.json"))
        tested_ha = next(
            dependency.removeprefix("homeassistant==")
            for dependency in project["dependency-groups"]["dev"]
            if dependency.startswith("homeassistant==")
        )
        if (
            not isinstance(info, dict)
            or info.get("commit") != commit
            or info.get("version") != manifest["version"]
            or info.get("requirements") != manifest["requirements"]
            or info.get("tested_home_assistant") != tested_ha
        ):
            raise ValueError("Archive build identity differs from the candidate.")
        hashes = info.get("files_sha256")
        if not isinstance(hashes, dict) or set(hashes) != tracked | {"INSTALL.md"}:
            raise ValueError("Embedded hash inventory is incomplete or unexpected.")
        files = {}
        for name, expected_hash in hashes.items():
            content = archive.read(name)
            if hashlib.sha256(content).hexdigest() != expected_hash:
                raise ValueError(f"Packaged hash mismatch: {name}")
            expected = (
                git(repository, "show", f"{commit}:{name}")
                if name in tracked
                else INSTALL_GUIDE
            )
            if content != expected:
                raise ValueError(f"Packaged source differs from the candidate: {name}")
            if name.startswith(COMPONENT):
                files[name.removeprefix(COMPONENT)] = content
    return Release(
        version=manifest["version"],
        commit=commit,
        requirements=tuple(manifest["requirements"]),
        archive_sha256=digest,
        packaged_files=len(names),
        component_files=files,
    )


def verify_installed(release: Release, component: Path) -> None:
    """Check every installed source byte and reject stale files, excluding caches."""
    paths = list(component.rglob("*"))
    if (
        component.is_symlink()
        or component.is_junction()
        or any(path.is_symlink() or path.is_junction() for path in paths)
    ):
        raise ValueError("Installed component contains a symbolic link or junction.")
    files = {
        path.relative_to(component).as_posix(): path
        for path in paths
        if path.is_file()
        and "__pycache__" not in path.relative_to(component).parts
        and path.suffix != ".pyc"
    }
    if set(files) != set(release.component_files):
        raise ValueError("Installed component inventory differs from the archive.")
    for name, content in release.component_files.items():
        if files[name].read_bytes() != content:
            raise ValueError(f"Installed file mismatch: {name}")


def install(release: Release, config: Path) -> Path:
    """Stage verified bytes and replace only the explicitly selected component.

    The caller authorizes installation by selecting this operation. No Home
    Assistant action, restart, notification or saved-state write is performed.
    """
    config = config.resolve(strict=True)
    if not (config / "configuration.yaml").is_file():
        raise ValueError("Choose a Home Assistant configuration directory.")
    components = config / "custom_components"
    target = components / "homeostatic"
    if components.is_symlink() or target.is_symlink() or target.resolve() != target:
        raise ValueError(
            "The component target must stay inside the selected configuration directory."
        )
    staging = Path(tempfile.mkdtemp(prefix=".homeostatic-stage-", dir=config))
    staged, previous = staging / "component", staging / "previous"
    preserve = False
    try:
        for name, content in release.component_files.items():
            path = staged / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        verify_installed(release, staged)
        components.mkdir(exist_ok=True)
        if target.exists():
            target.rename(previous)
        try:
            staged.rename(target)
            verify_installed(release, target)
        except OSError, ValueError:
            try:
                if target.exists():
                    shutil.rmtree(target)
                if previous.exists():
                    previous.rename(target)
            except OSError as error:
                preserve = True
                raise OSError(
                    f"Installation recovery needs attention; retained files are in {staging}"
                ) from error
            raise
    finally:
        if not preserve:
            shutil.rmtree(staging)
    return target


def main() -> None:
    """Keep read-only verification and explicitly requested installation separate."""
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for command in ("verify", "install"):
        child = commands.add_parser(command)
        child.add_argument("archive", type=Path)
        child.add_argument("--commit", required=True)
        child.add_argument(
            "--repository", type=Path, default=Path(__file__).resolve().parents[1]
        )
        if command == "verify":
            child.add_argument(
                "--installed",
                type=Path,
                help="Read-only comparison with an installed component directory",
            )
        else:
            child.add_argument(
                "--config",
                type=Path,
                required=True,
                help="Explicit Home Assistant configuration directory to modify",
            )
    args = parser.parse_args()
    try:
        release = verify_archive(args.archive, args.commit, args.repository)
        receipt = release.receipt()
        if args.command == "install":
            receipt["installed_component"] = str(install(release, args.config))
            receipt["core_restart_required"] = True
        elif args.installed is not None:
            verify_installed(release, args.installed)
            receipt["installed_component"] = str(args.installed.resolve())
        sys.stdout.write(json.dumps(receipt, indent=2) + "\n")
    except (
        OSError,
        ValueError,
        KeyError,
        IndexError,
        BadZipFile,
        subprocess.CalledProcessError,
    ) as error:
        parser.exit(1, f"Release {args.command} failed: {error}\n")


if __name__ == "__main__":
    main()
