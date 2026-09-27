"""Run quick local checks or the full release checks."""

import argparse
import subprocess
import sys
from pathlib import Path


def main() -> None:
    """Stop at the first failing check and preserve its exit status."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--quick", action="store_true", help="Run lint, format, and frontend checks"
    )
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    commands: tuple[tuple[str, ...], ...] = (
        ("-m", "ruff", "check", "."),
        ("-m", "ruff", "format", "--check", "."),
    )
    if not args.quick:
        commands += (
            ("-m", "mypy"),
            ("-m", "pytest", "--cov", "--cov-report=term-missing", "--cov-report=json"),
            ("script/check_coverage.py",),
        )
    for command in commands:
        result = subprocess.run([sys.executable, *command], cwd=root, check=False)
        if result.returncode:
            raise SystemExit(result.returncode)

    for command in (
        ("node", "--check", "custom_components/homeostatic/frontend/homeostatic.js"),
        ("node", "--test", "tests/frontend/model.test.mjs"),
    ):
        result = subprocess.run(command, cwd=root, check=False)
        if result.returncode:
            raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
