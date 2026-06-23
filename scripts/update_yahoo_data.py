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
import argparse
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "public" / "data" / "stocks.json"
UA = "Mozilla/5.0 (compatible; KellyStockProject/1.0; +https://github.com/willsidney/Kelly-Stock-Project)"
SECTOR_MAP = {
    "technology": "ai",
    "communication services": "software",
    "consumer cyclical": "consumer",
    "consumer defensive": "consumer",
    "healthcare": "healthcare",
    "financial services": "financial",
    "industrials": "industrial",
    "energy": "energy",
}


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


def as_number(value):
    if isinstance(value, dict) and "raw" in value:
        value = value["raw"]
    if isinstance(value, (int, float)) and math.isfinite(value):
        return float(value)
    return None


def clamp(value, lo, hi):
    return max(lo, min(hi, value))


def valid_price(value) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(value) and value > 0


def quote_current_price(quote: dict | None) -> tuple[float | None, str | None, int | None]:
    """Prefer Yahoo's active quote fields over previous-close style fallbacks."""
    if not quote:
        return None, None, None
    state = str(quote.get("marketState") or "").upper()
    candidates = []
    if state == "REGULAR":
        candidates.append(("regularMarketPrice", "Yahoo regular market"))
    elif state == "POST":
        candidates.append(("postMarketPrice", "Yahoo post-market"))
        candidates.append(("regularMarketPrice", "Yahoo regular market"))
    elif state == "PRE":
        candidates.append(("preMarketPrice", "Yahoo pre-market"))
        candidates.append(("regularMarketPrice", "Yahoo regular market"))
    else:
        candidates.append(("regularMarketPrice", "Yahoo quote"))
        candidates.append(("postMarketPrice", "Yahoo post-market"))
        candidates.append(("preMarketPrice", "Yahoo pre-market"))

    for key, source in candidates:
        price = quote.get(key)
        if valid_price(price):
            time_key = {
                "regularMarketPrice": "regularMarketTime",
                "postMarketPrice": "postMarketTime",
                "preMarketPrice": "preMarketTime",
            }.get(key, "regularMarketTime")
            return float(price), source, quote.get(time_key) or quote.get("regularMarketTime")
    return None, None, None


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


def intraday_price(ticker: str) -> tuple[float | None, str | None, int | None]:
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(ticker)}?range=1d&interval=1m"
    data = fetch_json(url)
    result = (((data or {}).get("chart") or {}).get("result") or [None])[0]
    if not result:
        return None, None, None
    meta = result.get("meta") or {}
    for key, source in (
        ("regularMarketPrice", "Yahoo intraday chart"),
        ("postMarketPrice", "Yahoo post-market chart"),
        ("preMarketPrice", "Yahoo pre-market chart"),
    ):
        price = meta.get(key)
        if valid_price(price):
            return float(price), source, meta.get("regularMarketTime")
    quote = (((result.get("indicators") or {}).get("quote") or [None])[0] or {})
    closes = [c for c in quote.get("close", []) if valid_price(c)]
    timestamps = result.get("timestamp") or []
    if closes:
        return float(closes[-1]), "Yahoo intraday close", timestamps[-1] if timestamps else None
    return None, None, None


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
    return {"ytd": ytd, "drawdown": max_drawdown}


def quote_summary(ticker: str) -> dict:
    modules = "financialData,recommendationTrend,defaultKeyStatistics,summaryDetail,calendarEvents,price,assetProfile"
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


def parse_tickers(value: str | None) -> list[str]:
    if not value:
        return []
    seen = set()
    out = []
    for token in value.replace("\n", ",").replace(" ", ",").split(","):
        ticker = token.strip().upper()
        if ticker and ticker not in seen:
            seen.add(ticker)
            out.append(ticker)
    return out


def yahoo_sector_to_model(value: str | None) -> str:
    if not value:
        return "other"
    return SECTOR_MAP.get(value.strip().lower(), "other")


def seed_stock(ticker: str, quote: dict | None, idx: int) -> dict:
    name = ticker
    currency = "USD"
    current_price, price_source, price_time = quote_current_price(quote)
    if quote:
        name = quote.get("shortName") or quote.get("longName") or ticker
        currency = quote.get("currency") or currency
    if current_price is None:
        current_price, price_source, price_time = intraday_price(ticker)
    return {
        "name": name,
        "ticker": ticker,
        "sector": "other",
        "emoji": "◆",
        "color": ["#3b82f6", "#84cc16", "#94a3b8", "#38bdf8", "#f87171", "#fb923c", "#e879f9", "#22d3ee", "#34d399", "#818cf8"][idx % 10],
        "strongBuy": 0,
        "buy": 0,
        "hold": 100,
        "sell": 0,
        "upside": 0.15,
        "drawdown": 0.30,
        "shortInt": 0.02,
        "beta": 1.0,
        "currentPrice": current_price,
        "priceCurrency": currency,
        "fxExposed": currency == "USD",
        "earningsDays": 90,
        "ytd": 0,
        "analystCount": 0,
        "analystSrc": "Yahoo Finance",
        "dataProvider": "Yahoo Finance",
        "lastUpdated": None,
        "priceSource": price_source,
        "priceTime": datetime.fromtimestamp(price_time, timezone.utc).replace(microsecond=0).isoformat() if price_time else None,
        "sourceUrl": f"https://finance.yahoo.com/quote/{ticker}",
    }


def update_stock(stock: dict, quote: dict | None) -> dict:
    ticker = str(stock.get("ticker", "")).upper().strip()
    updated = dict(stock)
    updated["ticker"] = ticker
    updated["dataProvider"] = "Yahoo Finance"
    updated["sourceUrl"] = f"https://finance.yahoo.com/quote/{ticker}"

    quote_price, price_source, price_time = quote_current_price(quote)
    if quote:
        if quote.get("currency"):
            updated["priceCurrency"] = quote["currency"]
        if quote.get("shortName") and not updated.get("name"):
            updated["name"] = quote["shortName"]

    summary = quote_summary(ticker)
    financial = summary.get("financialData") or {}
    key_stats = summary.get("defaultKeyStatistics") or {}
    summary_detail = summary.get("summaryDetail") or {}
    price = summary.get("price") or {}
    asset_profile = summary.get("assetProfile") or {}

    if asset_profile.get("sector"):
        updated["sector"] = yahoo_sector_to_model(asset_profile.get("sector"))

    if quote_price is None:
        quote_price, price_source, price_time = intraday_price(ticker)
    if quote_price is None:
        summary_price = raw(price.get("regularMarketPrice"))
        if valid_price(summary_price):
            quote_price, price_source = float(summary_price), "Yahoo quote summary"
    if quote_price is not None:
        updated["currentPrice"] = quote_price
        updated["priceSource"] = price_source
        if price_time:
            updated["priceTime"] = datetime.fromtimestamp(price_time, timezone.utc).replace(microsecond=0).isoformat()

    target_mean = raw(financial.get("targetMeanPrice"))
    current_price = updated.get("currentPrice")
    if target_mean and current_price:
        updated["upside"] = clamp((float(target_mean) / float(current_price)) - 1, 0, 3)

    beta = raw(key_stats.get("beta"))
    if beta:
        updated["beta"] = clamp(float(beta), 0.1, 6)

    market_cap = (
        (quote or {}).get("marketCap")
        or as_number(price.get("marketCap"))
        or as_number(summary_detail.get("marketCap"))
    )
    if market_cap:
        updated["marketCap"] = market_cap

    fundamental_fields = {
        "forwardPE": [
            as_number((quote or {}).get("forwardPE")),
            as_number(summary_detail.get("forwardPE")),
            as_number(key_stats.get("forwardPE")),
        ],
        "trailingPE": [
            as_number((quote or {}).get("trailingPE")),
            as_number(summary_detail.get("trailingPE")),
            as_number(key_stats.get("trailingPE")),
        ],
        "pegRatio": [as_number(key_stats.get("pegRatio"))],
        "priceToSales": [
            as_number(summary_detail.get("priceToSalesTrailing12Months")),
            as_number(key_stats.get("priceToSalesTrailing12Months")),
        ],
        "priceToBook": [as_number(key_stats.get("priceToBook"))],
        "enterpriseToEbitda": [as_number(key_stats.get("enterpriseToEbitda"))],
        "revenueGrowth": [as_number(financial.get("revenueGrowth"))],
        "earningsGrowth": [as_number(financial.get("earningsGrowth"))],
        "grossMargins": [as_number(financial.get("grossMargins"))],
        "operatingMargins": [as_number(financial.get("operatingMargins"))],
        "profitMargins": [as_number(financial.get("profitMargins"))],
        "returnOnEquity": [as_number(financial.get("returnOnEquity"))],
        "returnOnAssets": [as_number(financial.get("returnOnAssets"))],
        "freeCashflow": [as_number(financial.get("freeCashflow"))],
        "operatingCashflow": [as_number(financial.get("operatingCashflow"))],
        "totalDebt": [as_number(financial.get("totalDebt"))],
        "totalCash": [as_number(financial.get("totalCash"))],
        "debtToEquity": [as_number(financial.get("debtToEquity"))],
        "currentRatio": [as_number(financial.get("currentRatio"))],
        "quickRatio": [as_number(financial.get("quickRatio"))],
    }
    for key, candidates in fundamental_fields.items():
        value = next((x for x in candidates if isinstance(x, (int, float)) and math.isfinite(x)), None)
        if value is not None:
            updated[key] = value

    if market_cap:
        free_cashflow = updated.get("freeCashflow")
        operating_cashflow = updated.get("operatingCashflow")
        if isinstance(free_cashflow, (int, float)) and math.isfinite(free_cashflow):
            updated["freeCashflowYield"] = free_cashflow / market_cap
        if isinstance(operating_cashflow, (int, float)) and math.isfinite(operating_cashflow):
            updated["operatingCashflowYield"] = operating_cashflow / market_cap
    total_debt = updated.get("totalDebt")
    total_cash = updated.get("totalCash")
    if isinstance(total_debt, (int, float)) and total_debt > 0 and isinstance(total_cash, (int, float)):
        updated["cashDebtRatio"] = total_cash / total_debt

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
    if stats.get("ytd") is not None:
        updated["ytd"] = clamp(float(stats["ytd"]), -0.95, 5)
    if stats.get("drawdown"):
        updated["drawdown"] = clamp(float(stats["drawdown"]), 0.01, 0.95)

    updated["analystSrc"] = "Yahoo Finance"
    updated["lastUpdated"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    return updated


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh Kelly stock database from Yahoo Finance.")
    parser.add_argument("--tickers", default="", help="Comma or space separated ticker codes to add before refresh.")
    args = parser.parse_args()

    stocks = json.loads(DATA_PATH.read_text())
    requested = parse_tickers(args.tickers)
    if requested:
        print(f"requested tickers: {', '.join(requested)}")
    else:
        print("requested tickers: none")
    existing = {str(s.get("ticker", "")).upper().strip() for s in stocks if s.get("ticker")}
    missing = [ticker for ticker in requested if ticker not in existing]
    if missing:
        print(f"adding tickers: {', '.join(missing)}")
        missing_quotes = quote_batch(missing)
        for ticker in missing:
            stocks.append(seed_stock(ticker, missing_quotes.get(ticker), len(stocks)))
    elif requested:
        print("all requested tickers are already in the database")

    tickers = [str(s.get("ticker", "")).upper().strip() for s in stocks if s.get("ticker")]
    quotes = quote_batch(tickers)
    refreshed = []
    for stock in stocks:
        ticker = str(stock.get("ticker", "")).upper().strip()
        print(f"refreshing {ticker}")
        refreshed.append(update_stock(stock, quotes.get(ticker)))
        time.sleep(0.5)
    DATA_PATH.write_text(json.dumps(refreshed, indent=2) + "\n")
    print("database tickers: " + ", ".join(s["ticker"] for s in refreshed))
    print(f"updated {DATA_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
