#!/usr/bin/env python3
"""Build a larger Yahoo-backed stock universe for the Kelly model.

The script discovers US-listed common stocks, ranks candidates with Yahoo quote
data, and appends a model-ready batch to public/data/stocks.json. It is designed
to be run repeatedly until the database reaches the target size.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
import urllib.request
from pathlib import Path

from update_yahoo_data import DATA_PATH, UA, model_data_issues, quote_batch, seed_stock, update_stock


NASDAQ_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt"
OTHER_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt"
TICKER_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")
SKIP_NAME_TERMS = (
    " ETF",
    " ETN",
    " FUND",
    " WARRANT",
    " RIGHT",
    " UNIT",
    " UNITS",
    " PREFERRED",
    " PREFERENCE",
    " DEPOSITARY",
    " NOTE ",
    " NOTES ",
    " BOND",
    " DEBENTURE",
)


def fetch_text(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/plain,*/*"})
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.read().decode("utf-8", errors="replace")


def yahoo_symbol(symbol: str) -> str | None:
    symbol = str(symbol or "").strip().upper()
    if not symbol or symbol.startswith("File Creation Time"):
        return None
    symbol = symbol.replace(".", "-")
    if not TICKER_RE.match(symbol):
        return None
    return symbol


def looks_like_stock(name: str, etf: str | None, test_issue: str | None) -> bool:
    if str(test_issue or "").upper() == "Y":
        return False
    if str(etf or "").upper() == "Y":
        return False
    label = f" {str(name or '').upper()} "
    return not any(term in label for term in SKIP_NAME_TERMS)


def parse_pipe_table(text: str) -> list[dict]:
    lines = [line for line in text.splitlines() if "|" in line]
    if not lines:
        return []
    headers = [h.strip() for h in lines[0].split("|")]
    rows = []
    for line in lines[1:]:
        if line.startswith("File Creation Time"):
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) != len(headers):
            continue
        rows.append(dict(zip(headers, parts)))
    return rows


def discover_listed_stocks() -> dict[str, dict]:
    candidates: dict[str, dict] = {}

    for row in parse_pipe_table(fetch_text(NASDAQ_LISTED_URL)):
        ticker = yahoo_symbol(row.get("Symbol"))
        name = row.get("Security Name") or ""
        if ticker and looks_like_stock(name, row.get("ETF"), row.get("Test Issue")):
            candidates[ticker] = {"ticker": ticker, "name": name, "source": "nasdaq-listed"}

    for row in parse_pipe_table(fetch_text(OTHER_LISTED_URL)):
        ticker = yahoo_symbol(row.get("ACT Symbol") or row.get("NASDAQ Symbol"))
        name = row.get("Security Name") or ""
        if ticker and looks_like_stock(name, row.get("ETF"), row.get("Test Issue")):
            candidates.setdefault(ticker, {"ticker": ticker, "name": name, "source": "other-listed"})

    return candidates


def quote_number(row: dict, *keys: str) -> float | None:
    for key in keys:
        value = row.get(key)
        if isinstance(value, (int, float)) and math.isfinite(value):
            return float(value)
    return None


def rank_candidates(candidates: dict[str, dict], limit: int, min_market_cap: int) -> list[dict]:
    tickers = list(candidates.keys())
    print(f"quoting {len(tickers)} listed symbols")
    quotes = quote_batch(tickers)
    ranked = []
    for ticker, candidate in candidates.items():
        quote = quotes.get(ticker) or {}
        quote_type = str(quote.get("quoteType") or "EQUITY").upper()
        if quote_type and quote_type != "EQUITY":
            continue
        price = quote_number(quote, "regularMarketPrice", "postMarketPrice", "preMarketPrice")
        market_cap = quote_number(quote, "marketCap")
        volume = quote_number(quote, "averageDailyVolume3Month", "averageDailyVolume10Day", "regularMarketVolume")
        if price is None or price <= 1:
            continue
        if market_cap is None or market_cap < min_market_cap:
            continue
        score = math.log10(max(market_cap, 1)) * 10 + math.log10(max(volume or 1, 1))
        ranked.append({**candidate, "quote": quote, "marketCap": market_cap, "volume": volume or 0, "universeScore": score})

    ranked.sort(key=lambda row: (row["universeScore"], row["marketCap"]), reverse=True)
    return ranked[:limit]


def load_database() -> list[dict]:
    if not DATA_PATH.exists():
        return []
    return json.loads(DATA_PATH.read_text())


def main() -> int:
    parser = argparse.ArgumentParser(description="Expand the Kelly Yahoo stock database.")
    parser.add_argument("--target-size", type=int, default=1000, help="Desired database size.")
    parser.add_argument("--batch-size", type=int, default=100, help="Maximum new stocks to fully enrich this run.")
    parser.add_argument("--candidate-limit", type=int, default=1600, help="How many liquid candidates to consider.")
    parser.add_argument("--min-market-cap", type=int, default=1_000_000_000)
    args = parser.parse_args()

    stocks = load_database()
    existing = {str(s.get("ticker", "")).upper().strip() for s in stocks if s.get("ticker")}
    needed = max(0, args.target_size - len(existing))
    if needed <= 0:
        print(f"database already has {len(existing)} stocks; target is {args.target_size}")
        return 0

    batch_size = min(max(1, args.batch_size), needed)
    candidates = discover_listed_stocks()
    ranked = rank_candidates(candidates, args.candidate_limit, args.min_market_cap)
    to_add = [row for row in ranked if row["ticker"] not in existing][:batch_size]
    if not to_add:
        print("no new model-ready candidates found before enrichment")
        return 0

    print(f"adding up to {len(to_add)} stocks toward target {args.target_size}")
    added = []
    skipped = []
    for row in to_add:
        ticker = row["ticker"]
        print(f"enriching {ticker}")
        try:
            stock = seed_stock(ticker, row.get("quote"), len(stocks) + len(added))
            stock = update_stock(stock, row.get("quote"))
            issues = model_data_issues(stock)
            if issues:
                skipped.append((ticker, issues))
                print(f"warn: skipped {ticker}; Yahoo data incomplete: {', '.join(issues)}", file=sys.stderr)
                continue
            stock["universeSource"] = row["source"]
            stock["universeMarketCap"] = row["marketCap"]
            stock["universeVolume"] = row["volume"]
            stock["universeRank"] = len(existing) + len(added) + 1
            added.append(stock)
        except Exception as exc:
            skipped.append((ticker, [str(exc)]))
            print(f"warn: failed to enrich {ticker}: {exc}", file=sys.stderr)
        time.sleep(0.5)

    if not added:
        print("error: no candidates had enough Yahoo data to add.", file=sys.stderr)
        return 2

    stocks.extend(added)
    stocks.sort(key=lambda s: str(s.get("ticker") or ""))
    DATA_PATH.write_text(json.dumps(stocks, indent=2) + "\n")
    print(f"added {len(added)} stocks; database now has {len(stocks)}")
    if skipped:
        print("skipped: " + ", ".join(f"{ticker} ({', '.join(issues)})" for ticker, issues in skipped), file=sys.stderr)
    print(f"updated {DATA_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
