.PHONY: quick check
quick:
	uv run python script/check.py --quick

check:
	uv run python script/check.py
