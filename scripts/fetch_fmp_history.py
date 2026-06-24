#!/usr/bin/env python3
"""Fetch FMP historical data needed for point-in-time backtesting."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "data" / "fmp-history"
STOCKS_PATH = ROOT / "public" / "data" / "stocks.json"
BASE_URL = "https://financialmodelingprep.com/stable"
LEGACY_BASE_URL = "https://financialmodelingprep.com/api/v3"


def fetch_json(path: str, params: dict[str, str], base_url: str = BASE_URL) -> object | None:
    url = f"{base_url}/{path}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "KellyStockProject/1.0", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8", errors="replace"))
    except Exception as exc:
        print(f"warn: FMP fetch failed for {path} {params.get('symbol')}: {exc}", file=sys.stderr)
        return None


def rows_from_response(data: object | None) -> list[dict]:
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    if isinstance(data, dict):
        for key in ("historical", "data", "results", "result"):
            value = data.get(key)
            if isinstance(value, list):
                return [row for row in value if isinstance(row, dict)]
        if data and not any(key.lower().startswith("error") for key in data):
            return [data]
    return []


def fetch_price_rows(ticker: str, api_key: str, args: argparse.Namespace) -> tuple[list[dict], str]:
    params = {"symbol": ticker, "from": args.start, "to": args.end, "limit": str(args.limit), "apikey": api_key}
    candidates = [
        ("stable_dividend_adjusted", "historical-price-eod/dividend-adjusted", BASE_URL, params),
        ("stable_full", "historical-price-eod/full", BASE_URL, params),
        (
            "legacy_historical_price_full",
            f"historical-price-full/{urllib.parse.quote(ticker)}",
            LEGACY_BASE_URL,
            {"from": args.start, "to": args.end, "apikey": api_key},
        ),
    ]
    for label, path, base_url, query in candidates:
        rows = rows_from_response(fetch_json(path, query, base_url=base_url))
        if rows:
            return rows, label
    return [], "none"


def parse_tickers(value: str | None) -> list[str]:
    if not value:
        return []
    out = []
    seen = set()
    for token in value.replace("\n", ",").replace(" ", ",").split(","):
        ticker = token.strip().upper()
        if ticker and ticker not in seen:
            seen.add(ticker)
            out.append(ticker)
    return out


def market_cap_value(stock: dict) -> float:
    try:
        value = float(stock.get("marketCap") or 0)
    except (TypeError, ValueError):
        return 0.0
    return value if value > 0 else 0.0


def database_tickers(limit: int) -> list[str]:
    try:
        stocks = json.loads(STOCKS_PATH.read_text())
    except Exception:
        return []
    ranked = sorted(enumerate(stocks), key=lambda item: (-market_cap_value(item[1]), item[0]))
    tickers = [str(stock.get("ticker") or "").upper().strip() for _idx, stock in ranked if stock.get("ticker")]
    return [ticker for ticker in tickers if ticker][:limit]


def build_fetch_tickers(source_tickers: list[str], benchmark: str, max_tickers: int) -> list[str]:
    out = []
    seen = set()

    def add(ticker: str) -> None:
        ticker = ticker.upper().strip()
        if ticker and ticker not in seen:
            seen.add(ticker)
            out.append(ticker)

    # Fetch the benchmark first so free-account limits cannot starve it.
    if benchmark:
        add(benchmark)
    non_benchmark_count = 0
    for ticker in source_tickers:
        if ticker == benchmark:
            continue
        if non_benchmark_count >= max(1, max_tickers):
            break
        add(ticker)
        non_benchmark_count += 1
    return out


def fetch_ticker(ticker: str, api_key: str, args: argparse.Namespace) -> dict:
    common = {"symbol": ticker, "apikey": api_key}
    benchmark = args.benchmark.strip().upper()
    grades = [] if ticker == benchmark else rows_from_response(fetch_json("grades-historical", common))
    prices, price_endpoint = fetch_price_rows(ticker, api_key, args)
    market_caps = []
    if args.include_market_cap:
        market_cap_params = {**common, "from": args.start, "to": args.end, "limit": str(args.limit)}
        market_caps = rows_from_response(fetch_json("historical-market-capitalization", market_cap_params))
    return {
        "ticker": ticker,
        "fetchedAt": datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "provider": "Financial Modeling Prep",
        "dataRange": {"start": args.start, "end": args.end},
        "gradesHistorical": grades,
        "dividendAdjustedPrices": prices,
        "historicalMarketCap": market_caps,
        "sourceEndpoints": {
            "prices": price_endpoint,
            "grades": "skipped_for_benchmark" if ticker == benchmark else ("stable_grades_historical" if grades else "none"),
        },
        "rowCounts": {
            "gradesHistorical": len(grades),
            "dividendAdjustedPrices": len(prices),
            "historicalMarketCap": len(market_caps),
        },
    }


def write_index(out_dir: Path) -> None:
    entries = []
    for path in sorted(out_dir.glob("*.json")):
        if path.name == "index.json":
            continue
        try:
            data = json.loads(path.read_text())
        except Exception:
            continue
        entries.append(
            {
                "ticker": data.get("ticker"),
                "file": path.name,
                "fetchedAt": data.get("fetchedAt"),
                "rowCounts": data.get("rowCounts") or {},
            }
        )
    (out_dir / "index.json").write_text(json.dumps(entries, indent=2) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch FMP histories for backtesting.")
    parser.add_argument("--tickers", default="", help="Comma separated tickers. If blank, use database tickers.")
    parser.add_argument("--benchmark", default="SPY")
    parser.add_argument("--max-tickers", type=int, default=25)
    parser.add_argument("--start", default="2018-01-01")
    parser.add_argument("--end", default=datetime.now(UTC).date().isoformat())
    parser.add_argument("--limit", type=int, default=5000)
    parser.add_argument("--output-dir", type=Path, default=OUT_DIR)
    parser.add_argument("--api-key", default="", help="Optional API key. Prefer FMP_API_KEY env var.")
    parser.add_argument(
        "--include-market-cap",
        action="store_true",
        help="Also fetch historical market cap. Not needed for the current FMP backtest and costs extra API calls.",
    )
    args = parser.parse_args()

    api_key = args.api_key or os.environ.get("FMP_API_KEY")
    if not api_key:
        print("error: set FMP_API_KEY first, or pass --api-key locally.", file=sys.stderr)
        return 2

    benchmark = args.benchmark.strip().upper()
    source_tickers = parse_tickers(args.tickers) or database_tickers(args.max_tickers)
    tickers = build_fetch_tickers(source_tickers, benchmark, args.max_tickers)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    print(f"fetching FMP history for {len(tickers)} tickers: {', '.join(tickers)}")
    for ticker in tickers:
        data = fetch_ticker(ticker, api_key, args)
        path = args.output_dir / f"{ticker}.json"
        path.write_text(json.dumps(data, separators=(",", ":")) + "\n")
        print(
            f"{ticker}: grades={data['rowCounts']['gradesHistorical']} "
            f"prices={data['rowCounts']['dividendAdjustedPrices']} "
            f"marketCaps={data['rowCounts']['historicalMarketCap']} "
            f"priceEndpoint={data['sourceEndpoints']['prices']}"
        )
        time.sleep(0.35)

    write_index(args.output_dir)
    print(f"updated {args.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
