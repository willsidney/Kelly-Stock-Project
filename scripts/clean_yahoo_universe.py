#!/usr/bin/env python3
"""Clean bad auto-expanded Yahoo universe rows.

This removes only stocks that were added by the universe expansion workflow,
are not major-index seeds, and do not have market-cap proof above the configured
threshold. Manual/original stocks are left alone.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "public" / "data" / "stocks.json"


def number(value):
    if isinstance(value, (int, float)) and math.isfinite(value):
        return float(value)
    return None


def should_remove(stock: dict, min_market_cap: int, remove_unverified: bool) -> bool:
    source = str(stock.get("universeSource") or "")
    if not source:
        return False

    index_membership = stock.get("indexMembership")
    is_index_seed = bool(index_membership) or "index:" in source
    if is_index_seed:
        return False

    market_cap = number(stock.get("marketCap")) or number(stock.get("universeMarketCap"))
    if market_cap is None:
        return remove_unverified
    return market_cap < min_market_cap


def main() -> int:
    parser = argparse.ArgumentParser(description="Clean invalid Yahoo universe rows.")
    parser.add_argument("--min-market-cap", type=int, default=1_000_000_000)
    parser.add_argument("--keep-unverified", action="store_true", help="Keep non-index universe stocks with no market-cap value.")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    stocks = json.loads(DATA_PATH.read_text())
    kept = []
    removed = []
    for stock in stocks:
        if should_remove(stock, args.min_market_cap, remove_unverified=not args.keep_unverified):
            removed.append(stock)
        else:
            kept.append(stock)

    print(f"Database before cleanup: {len(stocks)} stocks")
    print(f"Removed candidates: {len(removed)}")
    if removed:
        print("Removed tickers: " + ", ".join(str(s.get("ticker") or s.get("name") or "?") for s in removed))
    print(f"Database after cleanup: {len(kept)} stocks")

    if not args.dry_run and removed:
        DATA_PATH.write_text(json.dumps(kept, indent=2) + "\n")
        print(f"updated {DATA_PATH}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
