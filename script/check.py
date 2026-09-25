"""Run the same required checks locally, in hooks, and in CI."""

import subprocess
import sys
from pathlib import Path


def main() -> None:
    """Stop at the first failing check and preserve its exit status."""
    root = Path(__file__).resolve().parents[1]
    commands = (
        ("-m", "ruff", "check", "."),
        ("-m", "ruff", "format", "--check", "."),
        ("-m", "mypy"),
        ("-m", "pytest", "--cov", "--cov-report=term-missing", "--cov-report=json"),
        ("script/check_coverage.py",),
    )
    for command in commands:
        result = subprocess.run([sys.executable, *command], cwd=root, check=False)
        if result.returncode:
            raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
