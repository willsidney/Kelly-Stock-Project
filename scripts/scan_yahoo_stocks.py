#!/usr/bin/env python3
"""Scan Yahoo Finance candidates and rank them with the Kelly model.

The website is static, so broad market scanning is done here and committed to
public/data/scan-results.json for the app to display.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

from update_yahoo_data import (
    ROOT,
    DATA_PATH,
    fetch_json,
    model_data_issues,
    quote_batch,
    seed_stock,
    update_stock,
)


OUT_PATH = ROOT / "public" / "data" / "scan-results.json"
MODEL_V13 = "v13"
MODEL_V14 = "v14"
MODEL_FORMULA_VERSIONS = {
    MODEL_V13: "v13.0.0",
    MODEL_V14: "v14.0.0",
}
MARKET_VOL = 0.18
W_ANALYST = 0.40
W_MOMENTUM = 0.20
W_RR = 0.20
W_SI = 0.10
W_EP = 0.10
DEFAULT_SCREENERS = [
    "most_actives",
    "day_gainers",
    "undervalued_growth_stocks",
    "growth_technology_stocks",
    "aggressive_small_caps",
]
DEFAULT_FLAGS = {
    "blendedP": True,
    "beta": True,
    "drawdown": True,
    "shortInt": True,
    "sector": True,
    "fx": True,
    "earnings": True,
}
TICKER_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")


def model_formula_version(model: str) -> str:
    """Return the immutable formula ID stored with forward-test evidence."""
    return MODEL_FORMULA_VERSIONS.get(model, f"{model}.unversioned")


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def clamp01(value: float) -> float:
    return clamp(value, 0.0, 1.0)


def is_num(value) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(value)


def score_higher(value, weak: float, strong: float):
    if not is_num(value):
        return None
    return clamp01((float(value) - weak) / (strong - weak))


def score_lower(value, strong: float, weak: float):
    if not is_num(value) or float(value) <= 0:
        return None
    return clamp01((weak - float(value)) / (weak - strong))


def avg_score(values) -> float | None:
    clean = [float(v) for v in values if is_num(v)]
    if not clean:
        return None
    return sum(clean) / len(clean)


def debt_ratio(value):
    if not is_num(value):
        return None
    value = float(value)
    return value / 100 if value > 10 else value


def p_analyst(stock: dict) -> float:
    sb = float(stock.get("strongBuy") or 0)
    buy = float(stock.get("buy") or 0)
    hold = float(stock.get("hold") or 0)
    sell = float(stock.get("sell") or 0)
    return (sb * 1.0 + buy * 0.75 + hold * 0.5 + sell * 0.15) / 100


def p_momentum(ytd: float) -> float:
    return 0.55 - 0.34 * math.tanh(float(ytd or 0) * 2.5)


def p_reward_risk(upside: float, drawdown: float) -> float:
    ratio = float(upside or 0) / max(float(drawdown or 0), 0.01)
    return 0.35 + 0.45 * (1 - math.exp(-ratio * 0.8))


def p_short_int(short_int: float) -> float:
    return 0.65 - 0.50 * min(float(short_int or 0), 0.30) / 0.30


def p_earnings(days: float) -> float:
    days = float(days or 90)
    if days <= 7:
        return 0.50
    if days <= 30:
        return 0.51
    if days <= 60:
        return 0.53
    if days <= 90:
        return 0.54
    return 0.55


def blended_p(stock: dict) -> dict:
    pa = p_analyst(stock)
    pm = p_momentum(stock.get("ytd") or 0)
    prr = p_reward_risk(stock.get("upside") or 0, stock.get("drawdown") or 0.30)
    psi = p_short_int(stock.get("shortInt") or 0)
    pep = p_earnings(stock.get("earningsDays") or 90)
    blend = W_ANALYST * pa + W_MOMENTUM * pm + W_RR * prr + W_SI * psi + W_EP * pep
    return {"pa": pa, "pm": pm, "prr": prr, "psi": psi, "pep": pep, "blend": blend}


def fundamental_scores(stock: dict) -> dict:
    quality_parts = [
        score_higher(stock.get("grossMargins"), 0.25, 0.70),
        score_higher(stock.get("operatingMargins"), 0.08, 0.35),
        score_higher(stock.get("profitMargins"), 0.04, 0.25),
        score_higher(stock.get("returnOnEquity"), 0.08, 0.35),
        score_higher(stock.get("returnOnAssets"), 0.03, 0.15),
        score_higher(stock.get("revenueGrowth"), 0.00, 0.30),
        score_higher(stock.get("earningsGrowth"), 0.00, 0.40),
        score_higher(stock.get("freeCashflowYield"), 0.00, 0.08),
        score_lower(debt_ratio(stock.get("debtToEquity")), 0.25, 2.50),
        score_higher(stock.get("currentRatio"), 1.00, 2.50),
        score_higher(stock.get("cashDebtRatio"), 0.25, 2.00),
    ]
    valuation_parts = [
        score_lower(stock.get("forwardPE"), 12, 45),
        score_lower(stock.get("trailingPE"), 12, 55),
        score_lower(stock.get("enterpriseToEbitda"), 8, 35),
        score_lower(stock.get("priceToSales"), 2, 18),
        score_lower(stock.get("priceToBook"), 1.5, 12),
        score_lower(stock.get("pegRatio"), 0.8, 3.0),
        score_higher(stock.get("freeCashflowYield"), 0.00, 0.08),
    ]
    if is_num(stock.get("revenueGrowth")) and is_num(stock.get("priceToSales")) and stock["priceToSales"] > 0:
        valuation_parts.append(score_higher(max(0, stock["revenueGrowth"]) / stock["priceToSales"], 0.01, 0.08))
    quality = avg_score(quality_parts)
    valuation = avg_score(valuation_parts)
    return {
        "quality": None if quality is None else quality * 100,
        "valuation": None if valuation is None else valuation * 100,
        "qualityCount": len([v for v in quality_parts if v is not None]),
        "valuationCount": len([v for v in valuation_parts if v is not None]),
    }


def optimized_profile(stock: dict, flags: dict, eur_now: float, eur_forecast: float, bp: dict) -> dict:
    fs = fundamental_scores(stock)

    def pct(value, fallback=0.50):
        return fallback if value is None else clamp01(float(value) / 100)

    quality = pct(fs["quality"])
    valuation = pct(fs["valuation"])
    growth = avg_score(
        [
            score_higher(stock.get("revenueGrowth"), -0.05, 0.35),
            score_higher(stock.get("earningsGrowth"), -0.10, 0.45),
            score_higher(stock.get("operatingMargins"), 0.05, 0.30),
            score_higher(stock.get("freeCashflowYield"), -0.02, 0.08),
        ]
    )
    if growth is None:
        growth = 0.50
    balance = avg_score(
        [
            score_lower(debt_ratio(stock.get("debtToEquity")), 0.25, 2.50),
            score_higher(stock.get("currentRatio"), 0.80, 2.20),
            score_higher(stock.get("cashDebtRatio"), 0.20, 1.50),
        ]
    )
    if balance is None:
        balance = 0.50
    analyst_coverage = clamp01(float(stock.get("analystCount") or 0) / 25)
    fundamental_coverage = clamp01((fs["qualityCount"] + fs["valuationCount"]) / 14)
    data_confidence = clamp(0.35 + analyst_coverage * 0.35 + fundamental_coverage * 0.30, 0.25, 1)
    beta_risk = clamp01((float(stock.get("beta") or 1) - 0.80) / 2.70) if flags["beta"] else 0.35
    drawdown_risk = clamp01((float(stock.get("drawdown") or 0.30) - 0.15) / 0.55) if flags["drawdown"] else 0.35
    short_risk = clamp01(float(stock.get("shortInt") or 0) / 0.20) if flags["shortInt"] else 0.25
    risk_score = avg_score([beta_risk, drawdown_risk, short_risk, 1 - balance])
    if risk_score is None:
        risk_score = 0.40
    fx_adj = (eur_forecast - eur_now) / eur_now if flags["fx"] and stock.get("fxExposed") else 0
    fx_adj_upside = max(0, float(stock.get("upside") or 0) * (1 + fx_adj))
    upside_score = clamp01(fx_adj_upside / 0.60)
    optimized_p = clamp(
        0.38
        + bp["pa"] * 0.18
        + quality * 0.16
        + valuation * 0.13
        + growth * 0.12
        + bp["prr"] * 0.11
        + balance * 0.07
        + upside_score * 0.07
        - risk_score * 0.14
        - (1 - data_confidence) * 0.08,
        0.05,
        0.90,
    )
    return_tilt = clamp(0.72 + quality * 0.22 + valuation * 0.16 + growth * 0.16 + balance * 0.12 - risk_score * 0.18, 0.40, 1.45)
    expected_return = clamp(fx_adj_upside * return_tilt * (0.75 + data_confidence * 0.25), 0.005, 2.50)
    expected_loss = clamp(float(stock.get("drawdown") or 0.30) * (0.70 + risk_score * 0.55), 0.01, 0.95)
    return {
        "fs": fs,
        "quality": quality,
        "valuation": valuation,
        "growth": growth,
        "balance": balance,
        "dataConfidence": data_confidence,
        "riskScore": risk_score,
        "optimizedP": optimized_p,
        "expectedReturn": expected_return,
        "expectedLoss": expected_loss,
        "fxAdjUpside": fx_adj_upside,
    }


def earnings_mult(days: float) -> float:
    days = float(days or 90)
    if days <= 30:
        return 0.85
    if days <= 60:
        return 0.92
    if days <= 90:
        return 0.96
    return 1.0


def run_model(stocks: list[dict], model: str, budget: float = 100.0, kelly_mult: float = 0.5) -> list[dict]:
    if not stocks:
        return []
    flags = DEFAULT_FLAGS
    hard_min = 1 / (2 * len(stocks))
    mean_inv_beta = sum(1 / max(0.1, float(s.get("beta") or 1)) for s in stocks) / len(stocks)
    mean_inv_root_beta = sum(1 / math.sqrt(max(0.1, float(s.get("beta") or 1))) for s in stocks) / len(stocks)
    sector_counts: dict[str, int] = {}
    for stock in stocks:
        sector = stock.get("sector") or "other"
        sector_counts[sector] = sector_counts.get(sector, 0) + 1

    computed = []
    for stock in stocks:
        bp = blended_p(stock)
        sector = stock.get("sector") or "other"
        if model == MODEL_V14:
            opt = optimized_profile(stock, flags, 1.1733, 1.175, bp)
            p_composite = opt["optimizedP"] if flags["blendedP"] else bp["pa"]
            si_p = min(0.12, float(stock.get("shortInt") or 0) * 0.45) if flags["shortInt"] else 0
            p_adj = clamp(p_composite * (1 - si_p), 0.01, 0.95)
            b = opt["expectedReturn"]
            d = opt["expectedLoss"] if flags["drawdown"] else 0.001
            beta_mult = clamp(1 / math.sqrt(max(0.1, float(stock.get("beta") or 1))), 0.55, 1.25) if flags["beta"] else 1
            sector_mult = max(0.70, 1 - (sector_counts[sector] - 1) * 0.06) if flags["sector"] and sector_counts[sector] > 1 else 1
            floor = max(hard_min, hard_min * (beta_mult / mean_inv_root_beta)) if flags["beta"] else hard_min
            confidence_mult = 0.75 + opt["dataConfidence"] * 0.25
        else:
            opt = None
            p_composite = bp["blend"] if flags["blendedP"] else bp["pa"]
            si_p = min(0.15, float(stock.get("shortInt") or 0) * 0.5) if flags["shortInt"] else 0
            p_adj = p_composite * (1 - si_p)
            b = float(stock.get("upside") or 0)
            d = float(stock.get("drawdown") or 0.30) if flags["drawdown"] else 0.001
            beta_mult = 1 / max(0.1, float(stock.get("beta") or 1)) if flags["beta"] else 1
            sector_mult = max(0.60, 1 - (sector_counts[sector] - 1) * 0.08) if flags["sector"] and sector_counts[sector] > 1 else 1
            floor = max(hard_min, hard_min * ((1 / max(0.1, float(stock.get("beta") or 1))) / mean_inv_beta)) if flags["beta"] else hard_min
            confidence_mult = 1

        q = 1 - p_adj
        raw_k = (p_adj * b - q * d) / (b + d) if flags["drawdown"] else (p_adj * b - q) / b
        adj = max(0, raw_k * kelly_mult * beta_mult * sector_mult * earnings_mult(stock.get("earningsDays") or 90) * confidence_mult)
        computed.append(
            {
                **stock,
                "bp": bp,
                "opt": opt,
                "pAdj": p_adj,
                "rawK": raw_k,
                "adj": adj,
                "floor": floor,
                "fxAdjUpside": opt["fxAdjUpside"] if opt else b,
                "betaMult": beta_mult,
                "secMult": sector_mult,
                "epMult": earnings_mult(stock.get("earningsDays") or 90),
                "isFloorOnly": adj == 0,
                "modelVersion": model,
            }
        )

    total_floor = sum(s["floor"] for s in computed)
    remaining = max(0, 1 - total_floor)
    raw_sum = sum(s["adj"] for s in computed)
    for stock in computed:
        stock["weight"] = stock["floor"] + ((stock["adj"] / raw_sum) * remaining if raw_sum > 0 else 0)
    excess = 0.0
    for stock in computed:
        if stock["weight"] > 0.20:
            excess += stock["weight"] - 0.20
            stock["weight"] = 0.20
    if excess > 0:
        uncapped = [s for s in computed if s["weight"] < 0.20]
        uncapped_sum = sum(s["weight"] for s in uncapped)
        if uncapped_sum > 0:
            for stock in uncapped:
                stock["weight"] += excess * (stock["weight"] / uncapped_sum)
    total_weight = sum(s["weight"] for s in computed) or 1
    for stock in computed:
        stock["weight"] = stock["weight"] / total_weight
        stock["euros"] = stock["weight"] * budget
        stock["score"] = max(0, stock["adj"]) * 100
        stock["qualityScore"] = (stock.get("opt") or {}).get("fs", {}).get("quality")
        stock["valuationScore"] = (stock.get("opt") or {}).get("fs", {}).get("valuation")
        stock["dataConfidence"] = (stock.get("opt") or {}).get("dataConfidence")
        stock["riskScore"] = (stock.get("opt") or {}).get("riskScore")
        stock["expectedReturn"] = (stock.get("opt") or {}).get("expectedReturn")
        stock["expectedLoss"] = (stock.get("opt") or {}).get("expectedLoss")
    return sorted(computed, key=lambda s: s["euros"], reverse=True)


def parse_tickers(value: str | None) -> list[str]:
    if not value:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for token in re.split(r"[\s,]+", value.upper()):
        ticker = token.strip()
        if TICKER_RE.match(ticker) and ticker not in seen:
            seen.add(ticker)
            out.append(ticker)
    return out


def fetch_screener(scr_id: str, count: int) -> list[dict]:
    url = (
        "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved"
        f"?scrIds={urllib.parse.quote(scr_id)}&count={int(count)}&start=0"
    )
    data = fetch_json(url)
    result = (((data or {}).get("finance") or {}).get("result") or [None])[0]
    return (result or {}).get("quotes") or []


def valid_candidate(row: dict, min_market_cap: int) -> bool:
    symbol = str(row.get("symbol") or "").upper().strip()
    if not TICKER_RE.match(symbol):
        return False
    quote_type = str(row.get("quoteType") or "EQUITY").upper()
    if quote_type and quote_type != "EQUITY":
        return False
    price = row.get("regularMarketPrice") or row.get("postMarketPrice") or row.get("preMarketPrice")
    if is_num(price) and price <= 1:
        return False
    market_cap = row.get("marketCap")
    if min_market_cap and is_num(market_cap) and market_cap < min_market_cap:
        return False
    return True


def discover_candidates(screeners: list[str], count: int, min_market_cap: int) -> dict[str, dict]:
    candidates: dict[str, dict] = {}
    per_screener = max(20, math.ceil(count / max(1, len(screeners))) + 20)
    for scr_id in screeners:
        print(f"fetching Yahoo screener: {scr_id}")
        rows = fetch_screener(scr_id, per_screener)
        for row in rows:
            symbol = str(row.get("symbol") or "").upper().strip()
            if not valid_candidate(row, min_market_cap):
                continue
            candidate = candidates.setdefault(symbol, {"ticker": symbol, "screeners": [], "quote": row})
            candidate["screeners"].append(scr_id)
            candidate["quote"] = {**candidate.get("quote", {}), **row}
        time.sleep(0.5)
    return dict(list(candidates.items())[:count])


def existing_database_tickers() -> list[str]:
    try:
        stocks = json.loads(DATA_PATH.read_text())
    except Exception:
        return []
    return [str(s.get("ticker", "")).upper().strip() for s in stocks if s.get("ticker")]


def trim_for_output(stock: dict) -> dict:
    keep = [
        "name",
        "ticker",
        "sector",
        "emoji",
        "color",
        "strongBuy",
        "buy",
        "hold",
        "sell",
        "upside",
        "drawdown",
        "shortInt",
        "beta",
        "currentPrice",
        "priceCurrency",
        "fxExposed",
        "earningsDays",
        "ytd",
        "analystCount",
        "analystSrc",
        "dataProvider",
        "lastUpdated",
        "priceSource",
        "priceTime",
        "marketCap",
        "forwardPE",
        "trailingPE",
        "pegRatio",
        "priceToSales",
        "priceToBook",
        "enterpriseToEbitda",
        "revenueGrowth",
        "earningsGrowth",
        "grossMargins",
        "operatingMargins",
        "profitMargins",
        "returnOnEquity",
        "returnOnAssets",
        "freeCashflow",
        "operatingCashflow",
        "totalDebt",
        "totalCash",
        "debtToEquity",
        "currentRatio",
        "quickRatio",
        "freeCashflowYield",
        "operatingCashflowYield",
        "cashDebtRatio",
        "sourceUrl",
        "score",
        "pAdj",
        "rawK",
        "weight",
        "euros",
        "floor",
        "fxAdjUpside",
        "qualityScore",
        "valuationScore",
        "dataConfidence",
        "riskScore",
        "expectedReturn",
        "expectedLoss",
        "modelVersion",
        "modelReady",
        "dataStatus",
        "dataIssues",
        "scanSource",
    ]
    out = {key: stock.get(key) for key in keep if key in stock and stock.get(key) is not None}
    out["isFloorOnly"] = bool(stock.get("isFloorOnly"))
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Scan Yahoo Finance stocks and rank by Kelly model.")
    parser.add_argument("--tickers", default="", help="Optional comma/space separated tickers to include.")
    parser.add_argument("--screeners", default=",".join(DEFAULT_SCREENERS), help="Yahoo predefined screeners to scan.")
    parser.add_argument("--count", type=int, default=120, help="Maximum candidate tickers to scan.")
    parser.add_argument("--top", type=int, default=50, help="Number of ranked results to publish.")
    parser.add_argument("--model", choices=[MODEL_V13, MODEL_V14], default=MODEL_V14)
    parser.add_argument("--min-market-cap", type=int, default=1_000_000_000)
    args = parser.parse_args()

    screeners = [s.strip() for s in args.screeners.split(",") if s.strip()]
    candidates = discover_candidates(screeners, args.count, args.min_market_cap)
    requested_tickers = parse_tickers(args.tickers)
    database_tickers = existing_database_tickers()
    for ticker in database_tickers + requested_tickers:
        candidates.setdefault(ticker, {"ticker": ticker, "screeners": ["database/requested"], "quote": {}})

    discovered_tickers = list(candidates.keys())[: max(1, args.count)]
    tickers = list(dict.fromkeys(discovered_tickers + requested_tickers + database_tickers))
    print(f"scanning {len(tickers)} candidates")
    quotes = quote_batch(tickers)
    stocks: list[dict] = []
    for idx, ticker in enumerate(tickers):
        quote = quotes.get(ticker) or candidates[ticker].get("quote") or {}
        print(f"refreshing {ticker}")
        try:
            stock = seed_stock(ticker, quote, idx)
            stock = update_stock(stock, quote)
            issues = model_data_issues(stock)
            if issues:
                print(f"warn: scanning tracked-incomplete ticker {ticker}: {', '.join(issues)}", file=sys.stderr)
            stock["scanSource"] = ", ".join(candidates[ticker].get("screeners") or [])
            stocks.append(stock)
        except Exception as exc:
            print(f"warn: failed to scan {ticker}: {exc}", file=sys.stderr)
        time.sleep(0.4)

    ranked = run_model(stocks, args.model)
    top = [trim_for_output(stock) for stock in ranked[: args.top]]
    for i, stock in enumerate(top, start=1):
        stock["rank"] = i

    payload = {
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "modelVersion": args.model,
        "candidateCount": len(candidates),
        "scannedCount": len(stocks),
        "publishedCount": len(top),
        "screeners": screeners,
        "minMarketCap": args.min_market_cap,
        "results": top,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"published {len(top)} scan results to {OUT_PATH}")
    if top:
        print("top results: " + ", ".join(f"{s['ticker']} ({s.get('score', 0):.1f})" for s in top[:10]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
