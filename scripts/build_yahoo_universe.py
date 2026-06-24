#!/usr/bin/env python3
"""Build a larger Yahoo-backed stock universe for the Kelly model.

The script seeds from major index constituent lists first, then discovers
additional US-listed common stocks, ranks candidates with Yahoo quote data, and
appends a tracked batch to public/data/stocks.json. Stocks with incomplete Yahoo
model inputs are still kept so future refreshes can improve them.
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
INDEX_SOURCES = [
    {
        "id": "sp500",
        "label": "S&P 500",
        "url": "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies",
        "ticker_columns": ("Symbol", "Ticker"),
        "name_columns": ("Security", "Company"),
    },
    {
        "id": "nasdaq100",
        "label": "Nasdaq 100",
        "url": "https://en.wikipedia.org/wiki/Nasdaq-100",
        "ticker_columns": ("Ticker", "Symbol"),
        "name_columns": ("Company", "Security"),
    },
    {
        "id": "dow30",
        "label": "Dow 30",
        "url": "https://en.wikipedia.org/wiki/Dow_Jones_Industrial_Average",
        "ticker_columns": ("Symbol", "Ticker symbol", "Ticker"),
        "name_columns": ("Company", "Security"),
    },
]
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


def clean_column(value) -> str:
    if isinstance(value, tuple):
        value = " ".join(str(v) for v in value if str(v) != "nan")
    return re.sub(r"\s+", " ", str(value or "")).strip()


def yahoo_symbol(symbol: str) -> str | None:
    symbol = str(symbol or "").strip().upper()
    symbol = re.sub(r"\[[^\]]+\]", "", symbol).strip()
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


def merge_candidate(candidates: dict[str, dict], ticker: str, name: str, source: str, index_label: str | None = None) -> None:
    row = candidates.setdefault(ticker, {"ticker": ticker, "name": name or ticker, "source": source, "indexSources": []})
    if name and (not row.get("name") or row["name"] == ticker):
        row["name"] = name
    if source not in str(row.get("source") or ""):
        row["source"] = f"{row.get('source')},{source}" if row.get("source") else source
    if index_label and index_label not in row["indexSources"]:
        row["indexSources"].append(index_label)


def pick_column(columns: list[str], aliases: tuple[str, ...]) -> str | None:
    normalized = {re.sub(r"[^a-z0-9]", "", col.lower()): col for col in columns}
    for alias in aliases:
        key = re.sub(r"[^a-z0-9]", "", alias.lower())
        if key in normalized:
            return normalized[key]
    for alias in aliases:
        needle = alias.lower()
        for col in columns:
            if needle in col.lower():
                return col
    return None


def discover_index_stocks(enabled: bool = True) -> dict[str, dict]:
    if not enabled:
        return {}
    try:
        import pandas as pd
    except Exception as exc:
        print(f"warn: pandas unavailable; skipping index seeds ({exc})", file=sys.stderr)
        return {}

    candidates: dict[str, dict] = {}
    for source in INDEX_SOURCES:
        try:
            tables = pd.read_html(source["url"])
        except Exception as exc:
            print(f"warn: failed to fetch {source['label']} constituents: {exc}", file=sys.stderr)
            continue

        found = 0
        for table in tables:
            table = table.copy()
            table.columns = [clean_column(col) for col in table.columns]
            ticker_col = pick_column(list(table.columns), source["ticker_columns"])
            if not ticker_col:
                continue
            name_col = pick_column(list(table.columns), source["name_columns"])
            for _, row in table.iterrows():
                ticker = yahoo_symbol(row.get(ticker_col))
                if not ticker:
                    continue
                name = str(row.get(name_col) or ticker).strip() if name_col else ticker
                merge_candidate(candidates, ticker, name, f"index:{source['id']}", source["label"])
                found += 1
            if found:
                break
        print(f"{source['label']} seeds: {found}")
    return candidates


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
            merge_candidate(candidates, ticker, name, "nasdaq-listed")

    for row in parse_pipe_table(fetch_text(OTHER_LISTED_URL)):
        ticker = yahoo_symbol(row.get("ACT Symbol") or row.get("NASDAQ Symbol"))
        name = row.get("Security Name") or ""
        if ticker and looks_like_stock(name, row.get("ETF"), row.get("Test Issue")):
            merge_candidate(candidates, ticker, name, "other-listed")

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
        index_sources = candidate.get("indexSources") or []
        index_priority = 1 if index_sources else 0
        score = math.log10(max(market_cap, 1)) * 10 + math.log10(max(volume or 1, 1)) + index_priority * 1_000
        ranked.append({
            **candidate,
            "quote": quote,
            "marketCap": market_cap,
            "volume": volume or 0,
            "universeScore": score,
            "indexPriority": index_priority,
        })

    ranked.sort(key=lambda row: (row["indexPriority"], row["universeScore"], row["marketCap"]), reverse=True)
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
    parser.add_argument("--no-index-seeds", action="store_true", help="Skip S&P 500, Nasdaq 100, and Dow 30 seed lists.")
    args = parser.parse_args()

    stocks = load_database()
    existing = {str(s.get("ticker", "")).upper().strip() for s in stocks if s.get("ticker")}
    needed = max(0, args.target_size - len(existing))
    if needed <= 0:
        print(f"database already has {len(existing)} stocks; target is {args.target_size}")
        return 0

    batch_size = min(max(1, args.batch_size), needed)
    candidates = discover_index_stocks(enabled=not args.no_index_seeds)
    listed = discover_listed_stocks()
    for ticker, row in listed.items():
        existing_row = candidates.get(ticker)
        if existing_row:
            merge_candidate(candidates, ticker, row.get("name") or ticker, row.get("source") or "listed")
        else:
            candidates[ticker] = row
    ranked = rank_candidates(candidates, args.candidate_limit, args.min_market_cap)
    to_add = [row for row in ranked if row["ticker"] not in existing][:batch_size]
    if not to_add:
        print("no new candidates found before enrichment")
        return 0

    print(f"adding up to {len(to_add)} stocks toward target {args.target_size}")
    added = []
    incomplete = []
    skipped = []
    for row in to_add:
        ticker = row["ticker"]
        print(f"enriching {ticker}")
        try:
            stock = seed_stock(ticker, row.get("quote"), len(stocks) + len(added))
            stock = update_stock(stock, row.get("quote"))
            issues = model_data_issues(stock)
            if issues:
                incomplete.append((ticker, issues))
                print(f"warn: added tracked ticker {ticker}; Yahoo data incomplete: {', '.join(issues)}", file=sys.stderr)
            stock["universeSource"] = row["source"]
            if row.get("indexSources"):
                stock["indexMembership"] = row["indexSources"]
            stock["universeMarketCap"] = row["marketCap"]
            stock["universeVolume"] = row["volume"]
            stock["universeRank"] = len(existing) + len(added) + 1
            added.append(stock)
        except Exception as exc:
            skipped.append((ticker, [str(exc)]))
            print(f"warn: failed to enrich {ticker}: {exc}", file=sys.stderr)
        time.sleep(0.5)

    stocks.extend(added)
    stocks.sort(key=lambda s: str(s.get("ticker") or ""))
    DATA_PATH.write_text(json.dumps(stocks, indent=2) + "\n")
    print(f"added {len(added)} stocks; database now has {len(stocks)}")
    if incomplete:
        print("tracked incomplete: " + ", ".join(f"{ticker} ({', '.join(issues)})" for ticker, issues in incomplete), file=sys.stderr)
    if skipped:
        print("skipped due to fetch errors: " + ", ".join(f"{ticker} ({', '.join(issues)})" for ticker, issues in skipped), file=sys.stderr)
    print(f"updated {DATA_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
