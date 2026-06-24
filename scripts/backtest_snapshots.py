#!/usr/bin/env python3
"""Walk-forward backtest for saved Yahoo model snapshots.

The backtest intentionally uses only files in public/data/history. That avoids
testing today's model inputs against past returns, which is the main source of
look-ahead bias in quick stock-model tests.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HISTORY_DIR = ROOT / "public" / "data" / "history"

sys.path.insert(0, str(ROOT / "scripts"))
import scan_yahoo_stocks as model  # noqa: E402


def is_num(value) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(value)


def parse_date(value: str) -> date:
    return date.fromisoformat(str(value)[:10])


def clean_price(value) -> float | None:
    if is_num(value) and value > 0:
        return float(value)
    return None


def load_snapshots(history_dir: Path = HISTORY_DIR) -> list[dict]:
    snapshots = []
    if not history_dir.exists():
        return []
    for path in sorted(history_dir.glob("*.json")):
        if path.name == "index.json":
            continue
        try:
            data = json.loads(path.read_text())
        except Exception as exc:
            print(f"warn: could not read {path}: {exc}", file=sys.stderr)
            continue
        if not isinstance(data, dict) or not data.get("snapshotDate") or not isinstance(data.get("stocks"), list):
            continue
        data["_path"] = str(path.relative_to(ROOT))
        snapshots.append(data)
    snapshots.sort(key=lambda snap: (snap["snapshotDate"], snap.get("snapshotTime") or ""))
    return snapshots


def select_rebalance_snapshots(snapshots: list[dict], schedule: str) -> list[dict]:
    if schedule == "every":
        return snapshots
    selected = []
    last_key = None
    for snap in snapshots:
        d = parse_date(snap["snapshotDate"])
        key = d.isocalendar()[:2] if schedule == "weekly" else (d.year, d.month)
        if key != last_key:
            selected.append(snap)
            last_key = key
    if snapshots and selected[-1] is not snapshots[-1]:
        selected.append(snapshots[-1])
    return selected


def stock_map(snapshot: dict) -> dict[str, dict]:
    return {
        str(stock.get("ticker") or "").upper().strip(): stock
        for stock in snapshot.get("stocks", [])
        if stock.get("ticker")
    }


def benchmark_map(snapshot: dict) -> dict[str, dict]:
    return {
        str(row.get("ticker") or "").upper().strip(): row
        for row in snapshot.get("benchmarks", [])
        if row.get("ticker")
    }


def forward_return(start_row: dict | None, end_row: dict | None) -> float | None:
    start_price = clean_price((start_row or {}).get("currentPrice"))
    end_price = clean_price((end_row or {}).get("currentPrice"))
    if start_price is None or end_price is None:
        return None
    return (end_price / start_price) - 1


def weighted_return(rows: list[dict], returns_by_ticker: dict[str, float]) -> float | None:
    pairs = [
        (float(row.get("weight") or 0), returns_by_ticker[row["ticker"]])
        for row in rows
        if row.get("ticker") in returns_by_ticker and is_num(row.get("weight"))
    ]
    total_weight = sum(weight for weight, _ in pairs)
    if total_weight <= 0:
        return None
    return sum((weight / total_weight) * ret for weight, ret in pairs)


def equal_weight_return(tickers: list[str], returns_by_ticker: dict[str, float]) -> float | None:
    clean = [returns_by_ticker[ticker] for ticker in tickers if ticker in returns_by_ticker]
    if not clean:
        return None
    return sum(clean) / len(clean)


def score_then_allocate(start_stocks: list[dict], model_name: str, top_n: int) -> list[dict]:
    scored = model.run_model(start_stocks, model_name, budget=100, kelly_mult=0.5)
    ranked = sorted(scored, key=lambda row: (float(row.get("score") or 0), float(row.get("weight") or 0)), reverse=True)
    top_tickers = [row["ticker"] for row in ranked[:top_n]]
    by_ticker = {str(stock.get("ticker") or "").upper().strip(): stock for stock in start_stocks}
    selected = [by_ticker[ticker] for ticker in top_tickers if ticker in by_ticker]
    return model.run_model(selected, model_name, budget=100, kelly_mult=0.5) if selected else []


def period_days(start: dict, end: dict) -> int:
    return max(1, (parse_date(end["snapshotDate"]) - parse_date(start["snapshotDate"])).days)


def run_backtest(snapshots: list[dict], models: list[str], top_ns: list[int], benchmark: str, schedule: str) -> dict:
    selected = select_rebalance_snapshots(snapshots, schedule)
    result = {
        "status": "ok" if len(selected) >= 2 else "insufficient_history",
        "reason": None,
        "snapshotCount": len(snapshots),
        "rebalanceSnapshotCount": len(selected),
        "schedule": schedule,
        "benchmark": benchmark,
        "models": {},
        "baselines": {},
        "periods": [],
    }
    if len(selected) < 2:
        result["reason"] = "At least two dated history snapshots are needed for a walk-forward backtest."
        return result

    universe_periods = []
    benchmark_periods = []
    model_periods = {
        f"{model_name}_top_{top_n}": []
        for model_name in models
        for top_n in top_ns
    }

    for start, end in zip(selected, selected[1:]):
        start_stocks = stock_map(start)
        end_stocks = stock_map(end)
        common_tickers = sorted(set(start_stocks) & set(end_stocks))
        returns_by_ticker = {
            ticker: ret
            for ticker in common_tickers
            if (ret := forward_return(start_stocks[ticker], end_stocks[ticker])) is not None
        }
        period = {
            "startDate": start["snapshotDate"],
            "endDate": end["snapshotDate"],
            "days": period_days(start, end),
            "tradableStocks": len(returns_by_ticker),
        }

        universe_ret = equal_weight_return(list(returns_by_ticker), returns_by_ticker)
        if universe_ret is not None:
            universe_periods.append({"return": universe_ret, "days": period["days"]})
            period["equalUniverseReturn"] = universe_ret

        start_benchmarks = benchmark_map(start)
        end_benchmarks = benchmark_map(end)
        benchmark_ret = forward_return(start_benchmarks.get(benchmark), end_benchmarks.get(benchmark))
        if benchmark_ret is not None:
            benchmark_periods.append({"return": benchmark_ret, "days": period["days"]})
            period["benchmarkReturn"] = benchmark_ret

        start_rows = [stock for ticker, stock in start_stocks.items() if ticker in returns_by_ticker]
        for model_name in models:
            for top_n in top_ns:
                key = f"{model_name}_top_{top_n}"
                selected_rows = score_then_allocate(start_rows, model_name, top_n)
                portfolio_ret = weighted_return(selected_rows, returns_by_ticker)
                if portfolio_ret is None:
                    continue
                model_periods[key].append({"return": portfolio_ret, "days": period["days"]})
                period[key] = {
                    "return": portfolio_ret,
                    "tickers": [row["ticker"] for row in selected_rows],
                }
        result["periods"].append(period)

    result["baselines"]["equal_universe"] = metrics(universe_periods)
    result["baselines"][benchmark] = metrics(benchmark_periods)
    result["models"] = {key: metrics(periods) for key, periods in model_periods.items()}
    return result


def metrics(periods: list[dict]) -> dict:
    returns = [float(row["return"]) for row in periods if is_num(row.get("return"))]
    days = [int(row.get("days") or 1) for row in periods if is_num(row.get("return"))]
    if not returns:
        return {"periods": 0}
    equity = 1.0
    curve = [equity]
    for ret in returns:
        equity *= 1 + ret
        curve.append(equity)
    total_days = max(1, sum(days))
    cumulative = equity - 1
    annualized = (equity ** (365 / total_days)) - 1 if equity > 0 else -1
    periods_per_year = 365 / max(1, statistics.median(days))
    volatility = statistics.stdev(returns) * math.sqrt(periods_per_year) if len(returns) > 1 else None
    peak = curve[0]
    max_drawdown = 0.0
    for value in curve:
        peak = max(peak, value)
        if peak > 0:
            max_drawdown = max(max_drawdown, (peak - value) / peak)
    return {
        "periods": len(returns),
        "totalDays": total_days,
        "cumulativeReturn": cumulative,
        "annualizedReturn": annualized,
        "periodVolatilityAnnualized": volatility,
        "sharpeLike": annualized / volatility if volatility and volatility > 0 else None,
        "maxDrawdown": max_drawdown,
        "hitRate": sum(1 for ret in returns if ret > 0) / len(returns),
        "averagePeriodReturn": sum(returns) / len(returns),
        "bestPeriod": max(returns),
        "worstPeriod": min(returns),
    }


def fmt_pct(value) -> str:
    if value is None or not is_num(value):
        return "-"
    return f"{value * 100:.2f}%"


def print_markdown(result: dict) -> None:
    print("# Kelly Walk-Forward Backtest")
    print()
    if result["status"] != "ok":
        print(f"Status: {result['status']}")
        print(result.get("reason") or "Backtest could not run.")
        print(f"Snapshots found: {result['snapshotCount']}")
        return
    print(f"Snapshots: {result['snapshotCount']}")
    print(f"Rebalance points: {result['rebalanceSnapshotCount']}")
    print(f"Schedule: {result['schedule']}")
    print()
    print("| Portfolio | Periods | Cumulative | Annualized | Max drawdown | Hit rate |")
    print("| --- | ---: | ---: | ---: | ---: | ---: |")
    rows = {**result["baselines"], **result["models"]}
    for name, row in rows.items():
        print(
            f"| {name} | {row.get('periods', 0)} | {fmt_pct(row.get('cumulativeReturn'))} | "
            f"{fmt_pct(row.get('annualizedReturn'))} | {fmt_pct(row.get('maxDrawdown'))} | "
            f"{fmt_pct(row.get('hitRate'))} |"
        )


def parse_csv(value: str, *, cast=str) -> list:
    out = []
    for token in str(value or "").split(","):
        token = token.strip()
        if token:
            out.append(cast(token))
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Backtest saved Kelly model snapshots.")
    parser.add_argument("--history-dir", type=Path, default=HISTORY_DIR)
    parser.add_argument("--models", default=f"{model.MODEL_V13},{model.MODEL_V14}")
    parser.add_argument("--top", default="10,20", help="Comma separated top-N portfolio sizes.")
    parser.add_argument("--benchmark", default="SPY")
    parser.add_argument("--schedule", choices=["every", "weekly", "monthly"], default="weekly")
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--format", choices=["json", "markdown"], default="markdown")
    args = parser.parse_args()

    snapshots = load_snapshots(args.history_dir)
    models = parse_csv(args.models)
    top_ns = parse_csv(args.top, cast=int)
    result = run_backtest(snapshots, models, top_ns, args.benchmark.upper(), args.schedule)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + "\n")
    if args.format == "json":
        print(json.dumps(result, indent=2))
    else:
        print_markdown(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
