#!/usr/bin/env python3
"""Genuine historical backtest using cached FMP grades and price histories.

This tests a historically honest variant of the model. It deliberately excludes
undated current target-price consensus and fundamentals, because those would
create look-ahead bias.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
from bisect import bisect_right
from datetime import date, timedelta
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HISTORY_DIR = ROOT / "public" / "data" / "fmp-history"
OUT_PATH = ROOT / "public" / "data" / "fmp-backtest-results.json"


GRADE_ALIASES = {
    "strongBuy": ("strongBuy", "strong_buy", "strongbuy", "analystRatingsStrongBuy", "analystRatingsstrongBuy"),
    "buy": ("buy", "analystRatingsBuy"),
    "hold": ("hold", "analystRatingsHold"),
    "sell": ("sell", "analystRatingsSell"),
    "strongSell": ("strongSell", "strong_sell", "strongsell", "analystRatingsStrongSell"),
}
PRICE_ALIASES = ("adjClose", "adjclose", "adjClosePrice", "close", "price")
DATE_ALIASES = ("date", "publishedDate", "calendarDate")
FACTOR_SPECS = (
    ("score", "Combined score"),
    ("analystScore", "Analyst consensus"),
    ("momentum6m", "6m momentum"),
    ("momentum12m", "12m momentum"),
    ("lowDrawdownScore", "Low drawdown"),
    ("lowVolatilityScore", "Low volatility"),
    ("lowRiskScore", "Low risk composite"),
)
MODEL_CONFIGS = {
    "analyst_price": {
        "label": "Historical analyst grades + price momentum/risk",
        "description": "Historical analyst grades + price momentum/risk. Excludes undated target prices and fundamentals.",
        "requiresGrades": True,
    },
    "price_only": {
        "label": "Historical price momentum/risk only",
        "description": "Historical price momentum/risk only. Uses Yahoo/FMP prices and excludes analyst grades, targets, and fundamentals.",
        "requiresGrades": False,
    },
}


def is_num(value) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(value)


def parse_date(value) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except Exception:
        return None


def first_number(row: dict, aliases: tuple[str, ...]) -> float | None:
    lowered = {str(key).lower(): value for key, value in row.items()}
    for alias in aliases:
        value = row.get(alias)
        if value is None:
            value = lowered.get(alias.lower())
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if math.isfinite(number):
            return number
    return None


def row_date(row: dict) -> date | None:
    for alias in DATE_ALIASES:
        parsed = parse_date(row.get(alias))
        if parsed:
            return parsed
    for key, value in row.items():
        parsed = parse_date(value)
        if parsed and "date" in str(key).lower():
            return parsed
    return None


def grade_score_from_text(value: str | None) -> float | None:
    if not value:
        return None
    text = value.lower()
    if any(term in text for term in ("strong buy", "conviction buy")):
        return 1.0
    if any(term in text for term in ("buy", "outperform", "overweight", "positive")):
        return 0.75
    if any(term in text for term in ("hold", "neutral", "market perform", "equal-weight", "sector perform")):
        return 0.50
    if any(term in text for term in ("sell", "underperform", "underweight", "negative")):
        return 0.15
    return None


def grade_score(row: dict) -> float | None:
    counts = {key: first_number(row, aliases) for key, aliases in GRADE_ALIASES.items()}
    if any(value is not None for value in counts.values()):
        sb = counts.get("strongBuy") or 0
        buy = counts.get("buy") or 0
        hold = counts.get("hold") or 0
        sell = counts.get("sell") or 0
        strong_sell = counts.get("strongSell") or 0
        total = sb + buy + hold + sell + strong_sell
        if total > 0:
            return (sb * 1.0 + buy * 0.75 + hold * 0.5 + sell * 0.15) / total
    for key in ("newGrade", "grade", "rating", "consensus", "toGrade"):
        score = grade_score_from_text(str(row.get(key) or ""))
        if score is not None:
            return score
    return None


def price_from_row(row: dict) -> float | None:
    value = first_number(row, PRICE_ALIASES)
    return value if value and value > 0 else None


def load_ticker(path: Path) -> dict | None:
    try:
        raw = json.loads(path.read_text())
    except Exception:
        return None
    ticker = str(raw.get("ticker") or path.stem).upper()
    prices = []
    for row in raw.get("dividendAdjustedPrices") or []:
        d = row_date(row)
        p = price_from_row(row)
        if d and p:
            prices.append((d, p))
    prices.sort()
    grades = []
    for row in raw.get("gradesHistorical") or []:
        d = row_date(row)
        score = grade_score(row)
        if d and score is not None:
            grades.append((d, score))
    grades.sort()
    if len(prices) < 30:
        return None
    return {"ticker": ticker, "prices": prices, "grades": grades, "rowCounts": raw.get("rowCounts") or {}}


def load_universe(history_dir: Path) -> dict[str, dict]:
    out = {}
    for path in sorted(history_dir.glob("*.json")):
        if path.name == "index.json":
            continue
        item = load_ticker(path)
        if item:
            out[item["ticker"]] = item
    return out


def price_on(series: list[tuple[date, float]], d: date) -> float | None:
    dates = [row[0] for row in series]
    idx = bisect_right(dates, d) - 1
    return series[idx][1] if idx >= 0 else None


def prices_between(series: list[tuple[date, float]], start: date, end: date) -> list[float]:
    return [price for d, price in series if start <= d <= end]


def latest_grade(grades: list[tuple[date, float]], d: date) -> float | None:
    dates = [row[0] for row in grades]
    idx = bisect_right(dates, d) - 1
    return grades[idx][1] if idx >= 0 else None


def daily_returns(prices: list[float]) -> list[float]:
    return [(prices[i] / prices[i - 1]) - 1 for i in range(1, len(prices)) if prices[i - 1] > 0]


def clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, value))


def stock_features(item: dict, d: date, model_variant: str) -> dict | None:
    p_now = price_on(item["prices"], d)
    p_6m = price_on(item["prices"], d - timedelta(days=183))
    p_12m = price_on(item["prices"], d - timedelta(days=365))
    analyst = latest_grade(item["grades"], d)
    if not p_now:
        return None
    if MODEL_CONFIGS[model_variant]["requiresGrades"] and analyst is None:
        return None
    momentum_6m = (p_now / p_6m) - 1 if p_6m else 0.0
    momentum_12m = (p_now / p_12m) - 1 if p_12m else momentum_6m
    trailing = prices_between(item["prices"], d - timedelta(days=365), d)
    if len(trailing) < 30:
        return None
    peak = max(trailing)
    drawdown = (peak - p_now) / peak if peak > 0 else 0.0
    returns = daily_returns(trailing[-126:])
    vol = statistics.stdev(returns) * math.sqrt(252) if len(returns) > 2 else 0.25
    momentum_score = clamp((momentum_6m + 0.30) / 0.80)
    trend_score = clamp((momentum_12m + 0.40) / 1.20)
    risk_score = 0.60 * clamp(drawdown / 0.60) + 0.40 * clamp(vol / 0.80)
    low_drawdown_score = 1 - clamp(drawdown / 0.60)
    low_volatility_score = 1 - clamp(vol / 0.80)
    if model_variant == "analyst_price":
        score = clamp(0.55 * analyst + 0.20 * momentum_score + 0.10 * trend_score + 0.15 * (1 - risk_score))
    else:
        score = clamp(0.60 * momentum_score + 0.25 * trend_score + 0.15 * (1 - risk_score))
    return {
        "ticker": item["ticker"],
        "score": score,
        "analystScore": analyst,
        "momentum6m": momentum_6m,
        "momentum12m": momentum_12m,
        "drawdown1y": drawdown,
        "volatility": vol,
        "riskScore": risk_score,
        "lowDrawdownScore": low_drawdown_score,
        "lowVolatilityScore": low_volatility_score,
        "lowRiskScore": 1 - risk_score,
    }


def month_starts(start: date, end: date) -> list[date]:
    dates = []
    cursor = date(start.year, start.month, 1)
    while cursor <= end:
        dates.append(cursor)
        if cursor.month == 12:
            cursor = date(cursor.year + 1, 1, 1)
        else:
            cursor = date(cursor.year, cursor.month + 1, 1)
    return dates


def forward_return(item: dict, start: date, end: date) -> float | None:
    p0 = price_on(item["prices"], start)
    p1 = price_on(item["prices"], end)
    if not p0 or not p1:
        return None
    return (p1 / p0) - 1


def rank(values: list[float]) -> list[float]:
    ordered = sorted((value, idx) for idx, value in enumerate(values))
    out = [0.0] * len(values)
    i = 0
    while i < len(ordered):
        j = i
        while j + 1 < len(ordered) and ordered[j + 1][0] == ordered[i][0]:
            j += 1
        avg = (i + j) / 2 + 1
        for k in range(i, j + 1):
            out[ordered[k][1]] = avg
        i = j + 1
    return out


def pearson(xs: list[float], ys: list[float]) -> float | None:
    if len(xs) < 3:
        return None
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    vx = sum((x - mx) ** 2 for x in xs)
    vy = sum((y - my) ** 2 for y in ys)
    if vx <= 0 or vy <= 0:
        return None
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / math.sqrt(vx * vy)


def spearman(xs: list[float], ys: list[float]) -> float | None:
    if len(xs) < 3:
        return None
    return pearson(rank(xs), rank(ys))


def performance(periods: list[dict], key: str) -> dict:
    returns = [row[key] for row in periods if isinstance(row.get(key), (int, float))]
    if not returns:
        return {"periods": 0}
    equity = 1.0
    curve = [equity]
    for ret in returns:
        equity *= 1 + ret
        curve.append(equity)
    peak = curve[0]
    max_drawdown = 0.0
    for value in curve:
        peak = max(peak, value)
        max_drawdown = max(max_drawdown, (peak - value) / peak if peak else 0)
    annualized = equity ** (12 / len(returns)) - 1 if equity > 0 else -1
    vol = statistics.stdev(returns) * math.sqrt(12) if len(returns) > 1 else None
    return {
        "periods": len(returns),
        "cumulativeReturn": equity - 1,
        "annualizedReturn": annualized,
        "volatilityAnnualized": vol,
        "sharpeLike": annualized / vol if vol and vol > 0 else None,
        "maxDrawdown": max_drawdown,
        "hitRate": sum(1 for ret in returns if ret > 0) / len(returns),
        "averageMonthlyReturn": sum(returns) / len(returns),
        "bestMonth": max(returns),
        "worstMonth": min(returns),
    }


def normal_two_sided_p(z_score: float | None) -> float | None:
    if z_score is None or not math.isfinite(z_score):
        return None
    return math.erfc(abs(z_score) / math.sqrt(2))


def signal_stats(values: list[float]) -> dict:
    clean = [value for value in values if isinstance(value, (int, float)) and math.isfinite(value)]
    if not clean:
        return {"periods": 0}
    mean_value = sum(clean) / len(clean)
    t_stat = None
    if len(clean) > 2 and statistics.stdev(clean) > 0:
        t_stat = mean_value / (statistics.stdev(clean) / math.sqrt(len(clean)))
    return {
        "periods": len(clean),
        "meanRankIC": mean_value,
        "tStat": t_stat,
        "roughPValue": normal_two_sided_p(t_stat),
        "positiveRate": sum(1 for value in clean if value > 0) / len(clean),
        "bestMonth": max(clean),
        "worstMonth": min(clean),
    }


def run_backtest(universe: dict[str, dict], benchmark: str, top_n: int, model_variant: str) -> dict:
    config = MODEL_CONFIGS[model_variant]
    tradable = {
        ticker: item
        for ticker, item in universe.items()
        if ticker != benchmark and (item.get("grades") or not config["requiresGrades"])
    }
    benchmark_available = benchmark in universe
    grade_tickers = sorted(ticker for ticker, item in universe.items() if ticker != benchmark and item.get("grades"))
    price_only_tickers = sorted(ticker for ticker, item in universe.items() if ticker != benchmark and not item.get("grades"))
    all_dates = [d for item in tradable.values() for d, _ in item["prices"]]
    if not all_dates:
        return {"status": "insufficient_data", "reason": "No usable FMP price histories."}
    start = max(min(all_dates) + timedelta(days=365), date(2019, 1, 1))
    end = max(all_dates)
    rebalance_dates = month_starts(start, end)
    periods = []
    rank_ics = []
    factor_ics = {key: [] for key, _ in FACTOR_SPECS}
    for start_date, end_date in zip(rebalance_dates, rebalance_dates[1:]):
        features = [row for item in tradable.values() if (row := stock_features(item, start_date, model_variant))]
        returns = {
            ticker: ret
            for ticker, item in tradable.items()
            if (ret := forward_return(item, start_date, end_date)) is not None
        }
        scored = [row for row in features if row["ticker"] in returns]
        if len(scored) < 2:
            continue
        scored.sort(key=lambda row: row["score"], reverse=True)
        side_n = min(top_n, max(1, len(scored) // 2))
        top = scored[:side_n]
        bottom = scored[-side_n:]
        top_return = sum(returns[row["ticker"]] for row in top) / len(top)
        bottom_return = sum(returns[row["ticker"]] for row in bottom) / len(bottom)
        equal_return = sum(returns[row["ticker"]] for row in scored) / len(scored)
        benchmark_return = forward_return(universe[benchmark], start_date, end_date) if benchmark_available else None
        ic = spearman([row["score"] for row in scored], [returns[row["ticker"]] for row in scored])
        if ic is not None:
            rank_ics.append(ic)
        period_factor_ics = {}
        for key, _label in FACTOR_SPECS:
            xs = [row[key] for row in scored if is_num(row.get(key))]
            ys = [returns[row["ticker"]] for row in scored if is_num(row.get(key))]
            factor_ic = spearman(xs, ys)
            if factor_ic is not None:
                factor_ics[key].append(factor_ic)
                period_factor_ics[key] = factor_ic
        periods.append(
            {
                "startDate": start_date.isoformat(),
                "endDate": end_date.isoformat(),
                "stockCount": len(scored),
                "effectiveTopN": side_n,
                "topTickers": [row["ticker"] for row in top],
                "topReturn": top_return,
                "bottomReturn": bottom_return,
                "equalUniverseReturn": equal_return,
                "benchmarkReturn": benchmark_return,
                "spreadReturn": top_return - bottom_return,
                "rankIC": ic,
                "factorRankIC": period_factor_ics,
            }
        )
    mean_ic = sum(rank_ics) / len(rank_ics) if rank_ics else None
    ic_t_stat = None
    if len(rank_ics) > 2 and statistics.stdev(rank_ics) > 0:
        ic_t_stat = mean_ic / (statistics.stdev(rank_ics) / math.sqrt(len(rank_ics)))
    return {
        "status": "ok" if periods else "insufficient_data",
        "model": model_variant,
        "description": config["description"],
        "benchmark": benchmark,
        "requestedTopN": top_n,
        "effectiveTopNRule": "Uses requested Top N, capped at half the tradable universe to prevent top/bottom overlap.",
        "loadedTickerCount": len(universe),
        "tickerCount": len(tradable),
        "gradeTickerCount": len(grade_tickers),
        "priceOnlyTickerCount": len(price_only_tickers),
        "tradableTickers": sorted(tradable),
        "gradeTickers": grade_tickers,
        "priceOnlyTickers": price_only_tickers[:50],
        "benchmarkAvailable": benchmark_available,
        "benchmarkIssue": None if benchmark_available else f"{benchmark} was not loaded with at least 30 usable price rows.",
        "periods": periods,
        "metrics": {
            "top": performance(periods, "topReturn"),
            "bottom": performance(periods, "bottomReturn"),
            "equalUniverse": performance(periods, "equalUniverseReturn"),
            "benchmark": performance(periods, "benchmarkReturn"),
            "spread": performance(periods, "spreadReturn"),
            "rankICMean": mean_ic,
            "rankICTStat": ic_t_stat,
            "rankICPValueApprox": normal_two_sided_p(ic_t_stat),
            "rankICPeriods": len(rank_ics),
        },
        "factorDiagnostics": {
            key: {"label": label, **signal_stats(factor_ics[key])}
            for key, label in FACTOR_SPECS
        },
    }


def fmt_pct(value) -> str:
    return "-" if value is None or not isinstance(value, (int, float)) else f"{value * 100:.2f}%"


def fmt_num(value) -> str:
    return "-" if value is None or not isinstance(value, (int, float)) else f"{value:.2f}"


def fmt_p(value) -> str:
    return "-" if value is None or not isinstance(value, (int, float)) else f"{value:.3f}"


def validation_issues(result: dict, min_tickers: int, require_benchmark: bool) -> list[str]:
    if result.get("status") != "ok":
        return [result.get("reason") or "Backtest did not produce a usable result."]
    issues = []
    if require_benchmark and not result.get("benchmarkAvailable"):
        issues.append(result.get("benchmarkIssue") or "Benchmark was not available.")
    if min_tickers and result.get("tickerCount", 0) < min_tickers:
        issues.append(f"Only {result.get('tickerCount', 0)} tradable tickers loaded; minimum requested is {min_tickers}.")
    if result.get("periods"):
        effective = [row.get("effectiveTopN") for row in result["periods"] if row.get("effectiveTopN")]
        if effective and max(effective) < 2:
            issues.append("Effective Top N is below 2, so top/bottom basket results are too noisy to trust.")
    return issues


def print_markdown(result: dict) -> None:
    print("# FMP Historical Backtest")
    print()
    if result.get("status") != "ok":
        print(f"Status: {result.get('status')}")
        print(result.get("reason") or "No result.")
        return
    print(result["description"])
    print()
    print(f"Model variant: {result.get('model')}")
    print(f"Benchmark: {result.get('benchmark')}")
    print(f"Loaded histories: {result.get('loadedTickerCount', result['tickerCount'])}")
    print(f"Ticker count: {result['tickerCount']}")
    print(f"Tickers with analyst grades: {result.get('gradeTickerCount', 0)}")
    print(f"Price-only tickers: {result.get('priceOnlyTickerCount', 0)}")
    print(f"Benchmark available: {'yes' if result.get('benchmarkAvailable') else 'no'}")
    if result.get("benchmarkIssue"):
        print(f"Benchmark issue: {result['benchmarkIssue']}")
    print(f"Periods: {len(result['periods'])}")
    print(f"Requested Top N: {result['requestedTopN']}")
    if result["periods"]:
        effective = sorted({row.get("effectiveTopN") for row in result["periods"] if row.get("effectiveTopN")})
        print(f"Effective Top N used: {', '.join(str(x) for x in effective)}")
    print(f"Rank IC mean: {fmt_pct(result['metrics'].get('rankICMean'))}")
    print(f"Rank IC t-stat: {fmt_num(result['metrics'].get('rankICTStat'))}")
    print(f"Rank IC rough p-value: {fmt_p(result['metrics'].get('rankICPValueApprox'))}")
    print()
    print("| Portfolio | Periods | Cumulative | Annualized | Max DD | Hit Rate |")
    print("| --- | ---: | ---: | ---: | ---: | ---: |")
    for name, row in result["metrics"].items():
        if not isinstance(row, dict) or "periods" not in row:
            continue
        print(
            f"| {name} | {row.get('periods', 0)} | {fmt_pct(row.get('cumulativeReturn'))} | "
            f"{fmt_pct(row.get('annualizedReturn'))} | {fmt_pct(row.get('maxDrawdown'))} | {fmt_pct(row.get('hitRate'))} |"
        )
    diagnostics = result.get("factorDiagnostics") or {}
    if diagnostics:
        print()
        print("## Signal Diagnostics")
        print()
        print("Rank IC measures whether each signal's ranking matched next month's return ranking. Positive is good.")
        print()
        print("| Signal | Periods | Mean Rank IC | t-stat | Rough p-value | Positive Months |")
        print("| --- | ---: | ---: | ---: | ---: | ---: |")
        for key, _label in FACTOR_SPECS:
            row = diagnostics.get(key) or {}
            print(
                f"| {row.get('label', key)} | {row.get('periods', 0)} | "
                f"{fmt_pct(row.get('meanRankIC'))} | {fmt_num(row.get('tStat'))} | "
                f"{fmt_p(row.get('roughPValue'))} | {fmt_pct(row.get('positiveRate'))} |"
            )


def main() -> int:
    parser = argparse.ArgumentParser(description="Backtest cached FMP historical data.")
    parser.add_argument("--history-dir", type=Path, default=HISTORY_DIR)
    parser.add_argument("--benchmark", default="SPY")
    parser.add_argument("--top", type=int, default=10)
    parser.add_argument("--output", type=Path, default=OUT_PATH)
    parser.add_argument("--format", choices=["json", "markdown"], default="markdown")
    parser.add_argument("--model", choices=sorted(MODEL_CONFIGS), default="analyst_price")
    parser.add_argument("--min-tickers", type=int, default=0)
    parser.add_argument("--require-benchmark", action="store_true")
    args = parser.parse_args()
    universe = load_universe(args.history_dir)
    result = run_backtest(universe, args.benchmark.strip().upper(), args.top, args.model)
    issues = validation_issues(result, args.min_tickers, args.require_benchmark)
    if issues:
        result["validationIssues"] = issues
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    if args.format == "json":
        print(json.dumps(result, indent=2))
    else:
        print_markdown(result)
    if issues:
        print()
        print("## Validation Issues")
        print()
        for issue in issues:
            print(f"- {issue}")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
