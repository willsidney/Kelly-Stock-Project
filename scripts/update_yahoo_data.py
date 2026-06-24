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
from functools import lru_cache
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


def as_rating(value):
    if isinstance(value, dict) and "raw" in value:
        value = value["raw"]
    if isinstance(value, (int, float)) and math.isfinite(value):
        return float(value)
    if isinstance(value, str):
        for token in value.replace("-", " ").split():
            try:
                rating = float(token)
            except ValueError:
                continue
            if math.isfinite(rating):
                return rating
    return None


def first_number(*values):
    for value in values:
        number = as_number(value)
        if number is not None:
            return number
    return None


def clamp(value, lo, hi):
    return max(lo, min(hi, value))


def valid_price(value) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(value) and value > 0


def model_data_issues(stock: dict) -> list[str]:
    issues = []
    ticker = str(stock.get("ticker") or "").strip()
    if not ticker:
        issues.append("ticker")
    if stock.get("dataProvider") != "Yahoo Finance":
        issues.append("Yahoo source")
    if not valid_price(stock.get("currentPrice")):
        issues.append("price")
    beta = stock.get("beta")
    if not isinstance(beta, (int, float)) or not math.isfinite(beta) or beta <= 0:
        issues.append("beta")
    analyst_count = stock.get("analystCount")
    if not isinstance(analyst_count, (int, float)) or analyst_count <= 0:
        issues.append("analyst count")
    rating_total = sum(
        float(stock.get(key) or 0)
        for key in ("strongBuy", "buy", "hold", "sell")
        if isinstance(stock.get(key), (int, float))
    )
    if rating_total <= 0:
        issues.append("analyst rating mix")
    if not stock.get("lastUpdated"):
        issues.append("update timestamp")
    return issues


def is_model_ready(stock: dict) -> bool:
    return not model_data_issues(stock)


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
    sell_total = float(trend.get("sell", 0) or 0) + float(trend.get("strongSell", 0) or 0)
    total = sum(float(trend.get(k, 0) or 0) for k in ("strongBuy", "buy", "hold")) + sell_total
    if total <= 0:
        return None
    return {
        "strongBuy": round((float(trend.get("strongBuy", 0) or 0) / total) * 100),
        "buy": round((float(trend.get("buy", 0) or 0) / total) * 100),
        "hold": round((float(trend.get("hold", 0) or 0) / total) * 100),
        "sell": round((sell_total / total) * 100),
        "analystCount": int(total),
    }


def rating_to_mix(rating: float | None, analyst_count: float | None = None) -> dict | None:
    """Fallback when Yahoo only exposes an average analyst rating."""
    if rating is None or not math.isfinite(rating):
        return None
    if rating <= 1.5:
        mix = {"strongBuy": 60, "buy": 30, "hold": 10, "sell": 0}
    elif rating <= 2.2:
        mix = {"strongBuy": 30, "buy": 50, "hold": 20, "sell": 0}
    elif rating <= 2.8:
        mix = {"strongBuy": 10, "buy": 30, "hold": 50, "sell": 10}
    elif rating <= 3.5:
        mix = {"strongBuy": 0, "buy": 10, "hold": 65, "sell": 25}
    else:
        mix = {"strongBuy": 0, "buy": 0, "hold": 35, "sell": 65}
    if analyst_count and analyst_count > 0:
        mix["analystCount"] = int(analyst_count)
    return mix


@lru_cache(maxsize=256)
def yfinance_snapshot(ticker: str) -> dict:
    try:
        import yfinance as yf
    except Exception:
        return {}

    stock = None
    try:
        stock = yf.Ticker(ticker)
        info = stock.get_info() or {}
    except Exception as exc:
        print(f"warn: yfinance info failed for {ticker}: {exc}", file=sys.stderr)
        info = {}

    trend = None
    if stock is not None:
        try:
            recs = stock.get_recommendations_summary()
            if recs is not None and not getattr(recs, "empty", True):
                records = recs.reset_index().to_dict("records")
                trend = next((r for r in records if r.get("period") == "0m"), records[0])
        except Exception as exc:
            print(f"warn: yfinance recommendations failed for {ticker}: {exc}", file=sys.stderr)

    price_targets = {}
    if stock is not None:
        try:
            targets = stock.get_analyst_price_targets()
            if isinstance(targets, dict):
                price_targets = targets
            elif hasattr(targets, "to_dict"):
                price_targets = targets.to_dict()
        except Exception as exc:
            print(f"warn: yfinance targets failed for {ticker}: {exc}", file=sys.stderr)

    return {"info": info, "trend": trend, "priceTargets": price_targets}


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

    summary = quote_summary(ticker)
    financial = summary.get("financialData") or {}
    key_stats = summary.get("defaultKeyStatistics") or {}
    summary_detail = summary.get("summaryDetail") or {}
    price = summary.get("price") or {}
    asset_profile = summary.get("assetProfile") or {}
    yf_data = yfinance_snapshot(ticker)
    yf_info = yf_data.get("info") or {}
    yf_trend = yf_data.get("trend")
    yf_targets = yf_data.get("priceTargets") or {}

    quote_price, price_source, price_time = quote_current_price(quote)
    if quote:
        if quote.get("currency"):
            updated["priceCurrency"] = quote["currency"]

    yahoo_name = (
        (quote or {}).get("shortName")
        or (quote or {}).get("longName")
        or yf_info.get("shortName")
        or yf_info.get("longName")
    )
    current_name = str(updated.get("name") or "").strip().upper()
    if yahoo_name and (not current_name or current_name == ticker):
        updated["name"] = yahoo_name

    sector_value = asset_profile.get("sector") or yf_info.get("sector")
    if sector_value:
        updated["sector"] = yahoo_sector_to_model(sector_value)

    currency = (
        (quote or {}).get("currency")
        or yf_info.get("currency")
        or yf_info.get("financialCurrency")
        or price.get("currency")
    )
    if currency:
        updated["priceCurrency"] = currency

    if quote_price is None:
        quote_price, price_source, price_time = intraday_price(ticker)
    if quote_price is None:
        summary_price = first_number(
            price.get("regularMarketPrice"),
            yf_info.get("currentPrice"),
            yf_info.get("regularMarketPrice"),
            yf_info.get("postMarketPrice"),
            yf_info.get("preMarketPrice"),
        )
        if valid_price(summary_price):
            quote_price, price_source = float(summary_price), "Yahoo quote summary"
    if quote_price is not None:
        updated["currentPrice"] = quote_price
        updated["priceSource"] = price_source
        if price_time:
            updated["priceTime"] = datetime.fromtimestamp(price_time, timezone.utc).replace(microsecond=0).isoformat()

    target_mean = first_number(
        financial.get("targetMeanPrice"),
        yf_info.get("targetMeanPrice"),
        yf_targets.get("mean"),
        yf_targets.get("targetMeanPrice"),
    )
    current_price = updated.get("currentPrice")
    if target_mean and current_price:
        updated["targetMeanPrice"] = float(target_mean)
        updated["upside"] = clamp((float(target_mean) / float(current_price)) - 1, 0, 3)

    beta = first_number(key_stats.get("beta"), yf_info.get("beta"))
    if beta:
        updated["beta"] = clamp(float(beta), 0.1, 6)

    market_cap = (
        (quote or {}).get("marketCap")
        or as_number(price.get("marketCap"))
        or as_number(summary_detail.get("marketCap"))
        or as_number(yf_info.get("marketCap"))
    )
    if market_cap:
        updated["marketCap"] = market_cap

    fundamental_fields = {
        "forwardPE": [
            as_number((quote or {}).get("forwardPE")),
            as_number(summary_detail.get("forwardPE")),
            as_number(key_stats.get("forwardPE")),
            as_number(yf_info.get("forwardPE")),
        ],
        "trailingPE": [
            as_number((quote or {}).get("trailingPE")),
            as_number(summary_detail.get("trailingPE")),
            as_number(key_stats.get("trailingPE")),
            as_number(yf_info.get("trailingPE")),
        ],
        "pegRatio": [
            as_number(key_stats.get("pegRatio")),
            as_number(yf_info.get("pegRatio")),
        ],
        "priceToSales": [
            as_number(summary_detail.get("priceToSalesTrailing12Months")),
            as_number(key_stats.get("priceToSalesTrailing12Months")),
            as_number(yf_info.get("priceToSalesTrailing12Months")),
        ],
        "priceToBook": [
            as_number(key_stats.get("priceToBook")),
            as_number(yf_info.get("priceToBook")),
        ],
        "enterpriseToEbitda": [
            as_number(key_stats.get("enterpriseToEbitda")),
            as_number(yf_info.get("enterpriseToEbitda")),
        ],
        "revenueGrowth": [as_number(financial.get("revenueGrowth")), as_number(yf_info.get("revenueGrowth"))],
        "earningsGrowth": [as_number(financial.get("earningsGrowth")), as_number(yf_info.get("earningsGrowth"))],
        "grossMargins": [as_number(financial.get("grossMargins")), as_number(yf_info.get("grossMargins"))],
        "operatingMargins": [as_number(financial.get("operatingMargins")), as_number(yf_info.get("operatingMargins"))],
        "profitMargins": [as_number(financial.get("profitMargins")), as_number(yf_info.get("profitMargins"))],
        "returnOnEquity": [as_number(financial.get("returnOnEquity")), as_number(yf_info.get("returnOnEquity"))],
        "returnOnAssets": [as_number(financial.get("returnOnAssets")), as_number(yf_info.get("returnOnAssets"))],
        "freeCashflow": [as_number(financial.get("freeCashflow")), as_number(yf_info.get("freeCashflow"))],
        "operatingCashflow": [as_number(financial.get("operatingCashflow")), as_number(yf_info.get("operatingCashflow"))],
        "totalDebt": [as_number(financial.get("totalDebt")), as_number(yf_info.get("totalDebt"))],
        "totalCash": [as_number(financial.get("totalCash")), as_number(yf_info.get("totalCash"))],
        "debtToEquity": [as_number(financial.get("debtToEquity")), as_number(yf_info.get("debtToEquity"))],
        "currentRatio": [as_number(financial.get("currentRatio")), as_number(yf_info.get("currentRatio"))],
        "quickRatio": [as_number(financial.get("quickRatio")), as_number(yf_info.get("quickRatio"))],
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

    short_float = first_number(key_stats.get("shortPercentOfFloat"), yf_info.get("shortPercentOfFloat"))
    if short_float is not None:
        updated["shortInt"] = clamp(float(short_float), 0, 1)

    trends = (((summary.get("recommendationTrend") or {}).get("trend")) or [])
    current_trend = next((t for t in trends if t.get("period") == "0m"), trends[0] if trends else None)
    mix = normalize_rating_mix(current_trend)
    analyst_source = "Yahoo Finance"
    if not mix:
        mix = normalize_rating_mix(yf_trend)
    if not mix:
        analyst_count = first_number(
            yf_info.get("numberOfAnalystOpinions"),
            (quote or {}).get("numberOfAnalystOpinions"),
            financial.get("numberOfAnalystOpinions"),
        )
        mix = rating_to_mix(
            as_rating(yf_info.get("recommendationMean"))
            or as_rating((quote or {}).get("averageAnalystRating"))
            or as_rating(yf_info.get("averageAnalystRating")),
            analyst_count,
        )
        if mix:
            analyst_source = "Yahoo Finance average rating (estimated mix)"
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

    updated["analystSrc"] = analyst_source
    updated["lastUpdated"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    updated["lastFullUpdated"] = updated["lastUpdated"]
    return updated


def refresh_price_only(stock: dict, quote: dict | None) -> dict:
    ticker = str(stock.get("ticker", "")).upper().strip()
    updated = dict(stock)
    updated["ticker"] = ticker
    updated["dataProvider"] = "Yahoo Finance"
    updated["sourceUrl"] = f"https://finance.yahoo.com/quote/{ticker}"
    if quote and quote.get("currency"):
        updated["priceCurrency"] = quote["currency"]

    quote_price, price_source, price_time = quote_current_price(quote)
    if quote_price is None:
        quote_price, price_source, price_time = intraday_price(ticker)
    if quote_price is not None:
        updated["currentPrice"] = quote_price
        updated["priceSource"] = price_source
        if price_time:
            updated["priceTime"] = datetime.fromtimestamp(price_time, timezone.utc).replace(microsecond=0).isoformat()

    target_mean = updated.get("targetMeanPrice")
    current_price = updated.get("currentPrice")
    if isinstance(target_mean, (int, float)) and target_mean > 0 and valid_price(current_price):
        updated["upside"] = clamp((float(target_mean) / float(current_price)) - 1, 0, 3)

    updated["lastUpdated"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    return updated


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh Kelly stock database from Yahoo Finance.")
    parser.add_argument("--tickers", default="", help="Comma or space separated ticker codes to add before refresh.")
    parser.add_argument("--mode", choices=["full", "prices"], default="full", help="Use full for fundamentals/analysts or prices for a fast quote refresh.")
    parser.add_argument("--max-full", type=int, default=0, help="Maximum stocks to deep-refresh in full mode. Remaining stocks receive a price refresh.")
    args = parser.parse_args()

    stocks = json.loads(DATA_PATH.read_text())
    requested = parse_tickers(args.tickers)
    if requested:
        print(f"requested tickers: {', '.join(requested)}")
    else:
        print("requested tickers: none")
    existing = {str(s.get("ticker", "")).upper().strip() for s in stocks if s.get("ticker")}
    missing = [ticker for ticker in requested if ticker not in existing]
    new_tickers = set(missing)
    if missing:
        if args.mode == "prices":
            print("new tickers require a full Yahoo refresh; switching to full mode")
            args.mode = "full"
        print(f"adding tickers: {', '.join(missing)}")
        missing_quotes = quote_batch(missing)
        for ticker in missing:
            stocks.append(seed_stock(ticker, missing_quotes.get(ticker), len(stocks)))
    elif requested:
        print("all requested tickers are already in the database")

    tickers = [str(s.get("ticker", "")).upper().strip() for s in stocks if s.get("ticker")]
    quotes = quote_batch(tickers)
    full_refresh = set(tickers)
    if args.mode == "full" and args.max_full > 0 and len(tickers) > args.max_full:
        oldest = sorted(
            stocks,
            key=lambda s: (
                str(s.get("lastFullUpdated") or s.get("lastUpdated") or ""),
                str(s.get("ticker") or ""),
            ),
        )
        full_refresh = {
            str(s.get("ticker", "")).upper().strip()
            for s in oldest[: args.max_full]
            if s.get("ticker")
        } | new_tickers
        print(f"full-refresh limit: {len(full_refresh)} of {len(tickers)} stocks")
    refreshed = []
    skipped_new = []
    print(f"update mode: {args.mode}")
    for stock in stocks:
        ticker = str(stock.get("ticker", "")).upper().strip()
        print(f"refreshing {ticker}")
        if args.mode == "prices" or ticker not in full_refresh:
            refreshed_stock = refresh_price_only(stock, quotes.get(ticker))
        else:
            refreshed_stock = update_stock(stock, quotes.get(ticker))
        if ticker in new_tickers:
            issues = model_data_issues(refreshed_stock)
            if issues:
                skipped_new.append((ticker, issues))
                print(
                    f"warn: skipped new ticker {ticker}; Yahoo did not return model-ready data: {', '.join(issues)}",
                    file=sys.stderr,
                )
                time.sleep(0.5)
                continue
        refreshed.append(refreshed_stock)
        time.sleep(0.5)
    DATA_PATH.write_text(json.dumps(refreshed, indent=2) + "\n")
    print("database tickers: " + ", ".join(s["ticker"] for s in refreshed))
    if skipped_new:
        print(
            "skipped new tickers: "
            + ", ".join(f"{ticker} ({', '.join(issues)})" for ticker, issues in skipped_new),
            file=sys.stderr,
        )
        if len(skipped_new) == len(new_tickers):
            print("error: no requested new tickers had enough Yahoo data to add.", file=sys.stderr)
            return 2
    print(f"updated {DATA_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
