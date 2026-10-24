"""Exercise release proof and component replacement in disposable directories."""

import hashlib
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from zipfile import ZipFile

import pytest

from script import release

ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True, slots=True, kw_only=True)
class Candidate:
    """A synthetic committed repository and its actual builder output."""

    repository: Path
    archive: Path
    commit: str


@pytest.fixture
def candidate(tmp_path: Path) -> Candidate:
    """Build a different version and dependency without changing this checkout."""
    repository = tmp_path / "candidate"
    files = {
        ".gitignore": "dist/\n__pycache__/\n",
        "pyproject.toml": '[project]\nversion = "9.8.7"\ndependencies = ["health-tree==0.0.7"]\n[dependency-groups]\ndev = ["homeassistant==2099.1.0"]\n',
        f"{release.COMPONENT}manifest.json": json.dumps(
            {"version": "9.8.7", "requirements": ["health-tree==0.0.7"]}
        ),
        f"{release.COMPONENT}__init__.py": '"""Synthetic component."""\n',
        f"{release.COMPONENT}frontend/app.js": 'export const example = "candidate";\n',
        "docs/install.md": "Synthetic installation guide.\n",
        "blueprints/automation/homeostatic/example.yaml": "blueprint: {}\n",
        "README.md": "Synthetic release\n",
        "CHANGELOG.md": "## [9.8.7]\n",
        "LICENSE": "Synthetic fixture\n",
    }
    for name in ("release.py", "build_release.py"):
        files[f"script/{name}"] = (ROOT / "script" / name).read_text()
    for name, content in files.items():
        path = repository / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    for args in (
        ("init", "--quiet"),
        ("add", "."),
        (
            "-c",
            "user.name=Release test",
            "-c",
            "user.email=release@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "Synthetic candidate",
        ),
    ):
        subprocess.run(["git", *args], cwd=repository, check=True, capture_output=True)
    commit = release.git(repository, "rev-parse", "HEAD").decode().strip()
    subprocess.run(
        [sys.executable, "script/build_release.py"],
        cwd=repository,
        check=True,
        capture_output=True,
    )
    return Candidate(
        repository=repository,
        archive=repository / "dist/homeostatic-9.8.7.zip",
        commit=commit,
    )


def members(candidate: Candidate) -> dict[str, bytes]:
    """Read a fixture for deliberate archive corruption."""
    with ZipFile(candidate.archive) as archive:
        return {name: archive.read(name) for name in archive.namelist()}


def sidecar(candidate: Candidate) -> None:
    """Update only the outer checksum after deliberately changing an archive."""
    candidate.archive.with_suffix(".zip.sha256").write_text(
        hashlib.sha256(candidate.archive.read_bytes()).hexdigest()
    )


def repack(
    candidate: Candidate, files: dict[str, bytes], *, rehash: bool = False
) -> None:
    """Make tampered archives optionally self-consistent before verification."""
    if rehash:
        info = json.loads(files["BUILD_INFO.json"])
        info["files_sha256"] = {
            name: hashlib.sha256(content).hexdigest()
            for name, content in files.items()
            if name != "BUILD_INFO.json"
        }
        files["BUILD_INFO.json"] = json.dumps(info).encode()
    with ZipFile(candidate.archive, "w") as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    sidecar(candidate)


def verified(candidate: Candidate) -> release.Release:
    """Verify the archive against its independently selected test candidate."""
    return release.verify_archive(
        candidate.archive, candidate.commit, candidate.repository
    )


def configuration(tmp_path: Path) -> Path:
    """Include saved state and another integration that must survive copying."""
    config = tmp_path / "ha"
    for name in (
        "configuration.yaml",
        ".storage/core.config_entries",
        ".storage/homeostatic",
        "custom_components/other/keep.py",
        "custom_components/homeostatic/obsolete.py",
    ):
        path = config / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("Keep this exact content")
    return config


def test_builder_and_verifier_derive_identity_and_inventory(
    candidate: Candidate,
) -> None:
    """Versions, requirements, HA metadata and file counts come from the candidate."""
    result = verified(candidate)
    assert result.version == "9.8.7"
    assert result.requirements == ("health-tree==0.0.7",)
    assert result.commit == candidate.commit
    assert result.packaged_files == len(members(candidate))
    assert set(result.component_files) == {
        "manifest.json",
        "__init__.py",
        "frontend/app.js",
    }
    assert (
        json.loads(members(candidate)["BUILD_INFO.json"])["tested_home_assistant"]
        == "2099.1.0"
    )
    (candidate.repository / f"{release.COMPONENT}__init__.py").write_text(
        "An unrelated working-tree edit"
    )
    assert verified(candidate) == result


@pytest.mark.parametrize(
    "part",
    [
        "sidecar",
        "commit",
        "version",
        "requirements",
        "tested_home_assistant",
        "files_sha256",
    ],
)
def test_wrong_proof_is_rejected(candidate: Candidate, part: str) -> None:
    """Neither a valid ZIP nor a matching version substitutes for exact proof."""
    if part == "sidecar":
        candidate.archive.with_suffix(".zip.sha256").write_text("0" * 64)
    else:
        files = members(candidate)
        info = json.loads(files["BUILD_INFO.json"])
        info[part] = {} if part == "files_sha256" else "wrong"
        files["BUILD_INFO.json"] = json.dumps(info).encode()
        repack(candidate, files)
    with pytest.raises(ValueError):
        verified(candidate)


@pytest.mark.parametrize("rehash", [False, True])
def test_source_tampering_is_rejected(candidate: Candidate, rehash: bool) -> None:
    """Recomputed archive and embedded hashes still cannot change committed bytes."""
    files = members(candidate)
    files[f"{release.COMPONENT}__init__.py"] = b"Altered source"
    repack(candidate, files, rehash=rehash)
    with pytest.raises(ValueError, match=r"Packaged (hash mismatch|source differs)"):
        verified(candidate)


@pytest.mark.parametrize(
    "name",
    [
        "../outside.py",
        "/absolute.py",
        "C:/outside.py",
        "custom_components\\homeostatic\\escape.py",
        "extra.py",
    ],
)
def test_unexpected_archive_paths_are_rejected(candidate: Candidate, name: str) -> None:
    """A complete hash list cannot approve unsafe or untracked archive members."""
    files = members(candidate)
    files[name] = b"Unexpected file"
    repack(candidate, files, rehash=True)
    with pytest.raises(ValueError, match=r"Unsafe|inventory"):
        verified(candidate)


def test_duplicate_and_missing_members_are_rejected(candidate: Candidate) -> None:
    """Archive enumeration must agree exactly with the committed package scope."""
    with (
        ZipFile(candidate.archive, "a") as archive,
        pytest.warns(UserWarning, match="Duplicate"),
    ):
        archive.writestr("README.md", "Duplicate")
    sidecar(candidate)
    with pytest.raises(ValueError, match="Duplicate"):
        verified(candidate)
    files = members(candidate)
    del files["README.md"]
    repack(candidate, files, rehash=True)
    with pytest.raises(ValueError, match="inventory"):
        verified(candidate)


def test_install_replaces_only_component_and_repeats_safely(
    candidate: Candidate, tmp_path: Path
) -> None:
    """Stale code disappears while saved choices and unrelated files stay exact."""
    result, config = verified(candidate), configuration(tmp_path)
    candidate.archive.write_bytes(b"Replaced after verification")
    keep = {
        path: path.read_bytes()
        for path in config.rglob("*")
        if path.is_file() and "homeostatic/obsolete.py" not in path.as_posix()
    }
    for _ in range(2):
        target = release.install(result, config)
        release.verify_installed(result, target)
        assert not (target / "obsolete.py").exists()
        assert all(path.read_bytes() == content for path, content in keep.items())
        assert not list(config.glob(".homeostatic-stage-*"))


def test_installed_verification_ignores_caches_but_rejects_stale_code(
    candidate: Candidate, tmp_path: Path
) -> None:
    """A component with matching source bytes must have no leftover module files."""
    result = verified(candidate)
    target = release.install(result, configuration(tmp_path))
    cache = target / "__pycache__/old.cpython-314.pyc"
    cache.parent.mkdir()
    cache.write_bytes(b"Generated cache")
    release.verify_installed(result, target)
    extra = target / "stale.py"
    extra.write_text("Left behind")
    with pytest.raises(ValueError, match="inventory"):
        release.verify_installed(result, target)
    extra.unlink()
    (target / "__init__.py").write_text("Changed after installation")
    with pytest.raises(ValueError, match="Installed file mismatch"):
        release.verify_installed(result, target)


def test_failed_promotion_restores_the_original_component(
    candidate: Candidate, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Failure between the two directory moves cannot discard installed files."""
    result, config = verified(candidate), configuration(tmp_path)
    rename = Path.rename

    def fail_new_component(source: Path, target: Path) -> Path:
        if source.name == "component":
            raise OSError("Simulated promotion failure")
        return rename(source, target)

    monkeypatch.setattr(Path, "rename", fail_new_component)
    with pytest.raises(OSError, match="promotion failure"):
        release.install(result, config)
    assert (
        config / "custom_components/homeostatic/obsolete.py"
    ).read_text() == "Keep this exact content"
    assert not list(config.glob(".homeostatic-stage-*"))


def test_failed_recovery_retains_the_original_directory(
    candidate: Candidate, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Even a second move failure must leave original bytes available for recovery."""
    result, config = verified(candidate), configuration(tmp_path)
    rename = Path.rename

    def fail_promotion_and_recovery(source: Path, target: Path) -> Path:
        if source.name in {"component", "previous"}:
            raise OSError("Simulated unavailable destination")
        return rename(source, target)

    monkeypatch.setattr(Path, "rename", fail_promotion_and_recovery)
    with pytest.raises(OSError, match="retained files"):
        release.install(result, config)
    staging = next(config.glob(".homeostatic-stage-*"))
    assert (staging / "previous/obsolete.py").read_text() == "Keep this exact content"


def test_symlink_target_is_rejected(candidate: Candidate, tmp_path: Path) -> None:
    """The installer cannot move or erase a component outside the selected config."""
    config = configuration(tmp_path)
    target = config / "custom_components/homeostatic"
    target.rename(tmp_path / "outside")
    target.symlink_to(tmp_path / "outside", target_is_directory=True)
    with pytest.raises(ValueError, match="target must stay"):
        release.install(verified(candidate), config)
    assert (tmp_path / "outside/obsolete.py").read_text() == "Keep this exact content"


def test_verify_cli_is_read_only_and_installation_is_explicit(
    candidate: Candidate, tmp_path: Path
) -> None:
    """Verification never installs, while an explicit install verifies its result."""
    config = configuration(tmp_path)
    command = [sys.executable, str(ROOT / "script/release.py")]
    common = [
        str(candidate.archive),
        "--commit",
        candidate.commit,
        "--repository",
        str(candidate.repository),
    ]
    result = subprocess.run(
        [*command, "verify", *common], check=True, capture_output=True, text=True
    )
    assert "installed_component" not in json.loads(result.stdout)
    assert (config / "custom_components/homeostatic/obsolete.py").exists()
    installed = subprocess.run(
        [*command, "install", *common, "--config", str(config)],
        check=True,
        capture_output=True,
        text=True,
    )
    assert json.loads(installed.stdout)["core_restart_required"] is True
    compared = subprocess.run(
        [
            *command,
            "verify",
            *common,
            "--installed",
            str(config / "custom_components/homeostatic"),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    assert json.loads(compared.stdout)["installed_component"] == str(
        config / "custom_components/homeostatic"
    )
