#!/usr/bin/env python3
"""Refresh the Kelly stock database from Yahoo Finance.

This updater uses Yahoo's public finance endpoints on a best-effort basis.
It writes normalized model inputs back to public/data/stocks.json so the static
GitHub Pages app can consume updated data without storing API keys in the
browser.
"""

from __future__ import annotations

import json
import math
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "public" / "data" / "stocks.json"
UA = "Mozilla/5.0 (compatible; KellyStockProject/1.0; +https://github.com/willsidney/Kelly-Stock-Project)"


def fetch_json(url: str) -> dict | None:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=25) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        print(f"warn: fetch failed: {url} ({exc})", file=sys.stderr)
        return None


def raw(value, default=None):
    if isinstance(value, dict) and "raw" in value:
        return value["raw"]
    return default


def clamp(value, lo, hi):
    return max(lo, min(hi, value))


def normalize_rating_mix(trend: dict | None) -> dict | None:
    if not trend:
        return None
    total = sum(float(trend.get(k, 0) or 0) for k in ("strongBuy", "buy", "hold", "sell"))
    if total <= 0:
        return None
    return {
        "strongBuy": round((float(trend.get("strongBuy", 0) or 0) / total) * 100),
        "buy": round((float(trend.get("buy", 0) or 0) / total) * 100),
        "hold": round((float(trend.get("hold", 0) or 0) / total) * 100),
        "sell": round((float(trend.get("sell", 0) or 0) / total) * 100),
        "analystCount": int(total),
    }


def chart_stats(ticker: str) -> dict:
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(ticker)}?range=1y&interval=1d"
    data = fetch_json(url)
    result = (((data or {}).get("chart") or {}).get("result") or [None])[0]
    if not result:
        return {}
    quote = (((result.get("indicators") or {}).get("quote") or [None])[0] or {})
    closes = [c for c in quote.get("close", []) if isinstance(c, (int, float)) and c > 0]
    if len(closes) < 2:
        return {}
    current = closes[-1]
    ytd = None
    timestamps = result.get("timestamp") or []
    now = datetime.now(timezone.utc)
    year_start = datetime(now.year, 1, 1, tzinfo=timezone.utc).timestamp()
    ytd_candidates = [i for i, ts in enumerate(timestamps) if ts >= year_start and i < len(closes)]
    if ytd_candidates:
      first = closes[ytd_candidates[0]]
      if first:
          ytd = (current / first) - 1
    peak = closes[0]
    max_drawdown = 0.0
    for price in closes:
        peak = max(peak, price)
        if peak:
            max_drawdown = max(max_drawdown, (peak - price) / peak)
    return {"currentPrice": current, "ytd": ytd, "drawdown": max_drawdown}


def quote_summary(ticker: str) -> dict:
    modules = "financialData,recommendationTrend,defaultKeyStatistics,calendarEvents,price"
    url = f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{urllib.parse.quote(ticker)}?modules={modules}"
    data = fetch_json(url)
    result = (((data or {}).get("quoteSummary") or {}).get("result") or [None])[0]
    return result or {}


def quote_batch(tickers: list[str]) -> dict[str, dict]:
    out = {}
    for i in range(0, len(tickers), 40):
        batch = tickers[i : i + 40]
        symbols = urllib.parse.quote(",".join(batch))
        url = f"https://query1.finance.yahoo.com/v7/finance/quote?symbols={symbols}"
        data = fetch_json(url)
        for row in (((data or {}).get("quoteResponse") or {}).get("result") or []):
            symbol = row.get("symbol")
            if symbol:
                out[symbol.upper()] = row
        time.sleep(0.5)
    return out


def update_stock(stock: dict, quote: dict | None) -> dict:
    ticker = str(stock.get("ticker", "")).upper().strip()
    updated = dict(stock)
    updated["ticker"] = ticker
    updated["dataProvider"] = "Yahoo Finance"
    updated["sourceUrl"] = f"https://finance.yahoo.com/quote/{ticker}"

    if quote:
        if quote.get("regularMarketPrice") is not None:
            updated["currentPrice"] = quote["regularMarketPrice"]
        if quote.get("currency"):
            updated["priceCurrency"] = quote["currency"]
        if quote.get("shortName") and not updated.get("name"):
            updated["name"] = quote["shortName"]

    summary = quote_summary(ticker)
    financial = summary.get("financialData") or {}
    key_stats = summary.get("defaultKeyStatistics") or {}
    price = summary.get("price") or {}

    target_mean = raw(financial.get("targetMeanPrice"))
    current_price = updated.get("currentPrice") or raw(price.get("regularMarketPrice"))
    if target_mean and current_price:
        updated["upside"] = clamp((float(target_mean) / float(current_price)) - 1, 0, 3)

    beta = raw(key_stats.get("beta"))
    if beta:
        updated["beta"] = clamp(float(beta), 0.1, 6)

    short_float = raw(key_stats.get("shortPercentOfFloat"))
    if short_float is not None:
        updated["shortInt"] = clamp(float(short_float), 0, 1)

    trends = (((summary.get("recommendationTrend") or {}).get("trend")) or [])
    current_trend = next((t for t in trends if t.get("period") == "0m"), trends[0] if trends else None)
    mix = normalize_rating_mix(current_trend)
    if mix:
        updated.update(mix)

    earnings_dates = (((summary.get("calendarEvents") or {}).get("earnings") or {}).get("earningsDate") or [])
    if earnings_dates:
        ts = raw(earnings_dates[0])
        if ts:
            days = math.ceil((datetime.fromtimestamp(ts, timezone.utc) - datetime.now(timezone.utc)).total_seconds() / 86400)
            updated["earningsDays"] = max(0, days)

    stats = chart_stats(ticker)
    if stats.get("currentPrice") and not updated.get("currentPrice"):
        updated["currentPrice"] = stats["currentPrice"]
    if stats.get("ytd") is not None:
        updated["ytd"] = clamp(float(stats["ytd"]), -0.95, 5)
    if stats.get("drawdown"):
        updated["drawdown"] = clamp(float(stats["drawdown"]), 0.01, 0.95)

    updated["analystSrc"] = "Yahoo Finance"
    updated["lastUpdated"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    return updated


def main() -> int:
    stocks = json.loads(DATA_PATH.read_text())
    tickers = [str(s.get("ticker", "")).upper().strip() for s in stocks if s.get("ticker")]
    quotes = quote_batch(tickers)
    refreshed = []
    for stock in stocks:
        ticker = str(stock.get("ticker", "")).upper().strip()
        print(f"refreshing {ticker}")
        refreshed.append(update_stock(stock, quotes.get(ticker)))
        time.sleep(0.5)
    DATA_PATH.write_text(json.dumps(refreshed, indent=2) + "\n")
    print(f"updated {DATA_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
