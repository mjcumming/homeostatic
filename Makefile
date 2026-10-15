.PHONY: quick check
quick:
	uv run --no-sync python script/check.py --quick

check:
	uv run --no-sync python script/check.py
