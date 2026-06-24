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


def fetch_json(path: str, params: dict[str, str]) -> object | None:
    url = f"{BASE_URL}/{path}?{urllib.parse.urlencode(params)}"
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


def database_tickers(limit: int) -> list[str]:
    try:
        stocks = json.loads(STOCKS_PATH.read_text())
    except Exception:
        return []
    tickers = [str(stock.get("ticker") or "").upper().strip() for stock in stocks if stock.get("ticker")]
    return [ticker for ticker in tickers if ticker][:limit]


def fetch_ticker(ticker: str, api_key: str, args: argparse.Namespace) -> dict:
    common = {"symbol": ticker, "apikey": api_key}
    price_params = {**common, "from": args.start, "to": args.end, "limit": str(args.limit)}
    market_cap_params = {**common, "from": args.start, "to": args.end, "limit": str(args.limit)}
    grades = rows_from_response(fetch_json("grades-historical", common))
    prices = rows_from_response(fetch_json("historical-price-eod/dividend-adjusted", price_params))
    market_caps = rows_from_response(fetch_json("historical-market-capitalization", market_cap_params))
    return {
        "ticker": ticker,
        "fetchedAt": datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "provider": "Financial Modeling Prep",
        "dataRange": {"start": args.start, "end": args.end},
        "gradesHistorical": grades,
        "dividendAdjustedPrices": prices,
        "historicalMarketCap": market_caps,
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
    args = parser.parse_args()

    api_key = args.api_key or os.environ.get("FMP_API_KEY")
    if not api_key:
        print("error: set FMP_API_KEY first, or pass --api-key locally.", file=sys.stderr)
        return 2

    tickers = parse_tickers(args.tickers) or database_tickers(args.max_tickers)
    benchmark = args.benchmark.strip().upper()
    if benchmark and benchmark not in tickers:
        tickers.append(benchmark)
    tickers = tickers[: max(1, args.max_tickers) + (1 if benchmark else 0)]
    args.output_dir.mkdir(parents=True, exist_ok=True)

    print(f"fetching FMP history for {len(tickers)} tickers: {', '.join(tickers)}")
    for ticker in tickers:
        data = fetch_ticker(ticker, api_key, args)
        path = args.output_dir / f"{ticker}.json"
        path.write_text(json.dumps(data, separators=(",", ":")) + "\n")
        print(
            f"{ticker}: grades={data['rowCounts']['gradesHistorical']} "
            f"prices={data['rowCounts']['dividendAdjustedPrices']} "
            f"marketCaps={data['rowCounts']['historicalMarketCap']}"
        )
        time.sleep(0.35)

    write_index(args.output_dir)
    print(f"updated {args.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
