#!/usr/bin/env python3
"""Create and mark a forward-only paper portfolio from saved model snapshots."""

from __future__ import annotations

import argparse
import json
import math
from datetime import date
from pathlib import Path

from scan_yahoo_stocks import MODEL_V13, MODEL_V14, model_formula_version


ROOT = Path(__file__).resolve().parents[1]
HISTORY_DIR = ROOT / "public" / "data" / "history"
OUT_PATH = ROOT / "public" / "data" / "paper-portfolio.json"


def is_num(value) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(value)


def clean_price(value) -> float | None:
    return float(value) if is_num(value) and value > 0 else None


def load_latest_snapshot(history_dir: Path) -> dict | None:
    candidates = sorted(path for path in history_dir.glob("*.json") if path.name != "index.json")
    for path in reversed(candidates):
        try:
            snapshot = json.loads(path.read_text())
        except Exception:
            continue
        if isinstance(snapshot, dict) and snapshot.get("snapshotDate") and isinstance(snapshot.get("stocks"), list):
            try:
                snapshot["_path"] = str(path.relative_to(ROOT))
            except ValueError:
                snapshot["_path"] = str(path)
            return snapshot
    return None


def load_existing(path: Path) -> dict | None:
    try:
        value = json.loads(path.read_text())
    except Exception:
        return None
    if not isinstance(value, dict) or value.get("status") in {"awaiting_first_snapshot", "not_started"}:
        return None
    return value


def stock_map(snapshot: dict) -> dict[str, dict]:
    return {
        str(row.get("ticker") or "").upper().strip(): row
        for row in snapshot.get("stocks", [])
        if row.get("ticker")
    }


def benchmark_map(snapshot: dict) -> dict[str, dict]:
    return {
        str(row.get("ticker") or "").upper().strip(): row
        for row in snapshot.get("benchmarks", [])
        if row.get("ticker")
    }


def frozen_output(stock: dict, model_name: str) -> dict:
    outputs = stock.get("modelOutputs")
    if not isinstance(outputs, dict):
        return {}
    value = outputs.get(model_name)
    return value if isinstance(value, dict) else {}


def snapshot_formula_version(snapshot: dict, model_name: str) -> str:
    versions = snapshot.get("modelFormulaVersions")
    if isinstance(versions, dict) and versions.get(model_name):
        return str(versions[model_name])
    for stock in snapshot.get("stocks", []):
        value = frozen_output(stock, model_name).get("formulaVersion")
        if value:
            return str(value)
    return model_formula_version(model_name)


def selected_targets(snapshot: dict, model_name: str, top_n: int) -> list[dict]:
    eligible = []
    for stock in snapshot.get("stocks", []):
        ticker = str(stock.get("ticker") or "").upper().strip()
        output = frozen_output(stock, model_name)
        price = clean_price(stock.get("currentPrice"))
        if not ticker or not price or stock.get("modelReady") is False or not is_num(output.get("score")):
            continue
        eligible.append(
            {
                "ticker": ticker,
                "name": stock.get("name") or ticker,
                "sector": stock.get("sector") or "other",
                "price": price,
                "score": float(output["score"]),
                "modelWeight": max(0.0, float(output.get("weight") or 0)),
            }
        )
    eligible.sort(key=lambda row: (row["score"], row["modelWeight"], row["ticker"]), reverse=True)
    selected = eligible[: max(1, top_n)]
    total = sum(row["modelWeight"] for row in selected)
    for row in selected:
        row["targetWeight"] = row["modelWeight"] / total if total > 0 else 1 / len(selected)
    return selected


def latest_prices(snapshot: dict, positions: list[dict]) -> dict[str, float]:
    stocks = stock_map(snapshot)
    prices = {}
    for position in positions:
        ticker = position["ticker"]
        price = clean_price((stocks.get(ticker) or {}).get("currentPrice"))
        if price is None:
            price = clean_price(position.get("lastPrice"))
        if price is not None:
            prices[ticker] = price
    return prices


def position_values(positions: list[dict], prices: dict[str, float]) -> dict[str, float]:
    return {
        position["ticker"]: float(position.get("shares") or 0) * prices[position["ticker"]]
        for position in positions
        if position["ticker"] in prices
    }


def make_positions(targets: list[dict], capital: float, snapshot_date: str) -> list[dict]:
    return [
        {
            "ticker": row["ticker"],
            "name": row["name"],
            "sector": row["sector"],
            "shares": (capital * row["targetWeight"]) / row["price"],
            "targetWeight": row["targetWeight"],
            "entryPrice": row["price"],
            "lastPrice": row["price"],
            "entryScore": row["score"],
            "lastScore": row["score"],
            "enteredDate": snapshot_date,
        }
        for row in targets
    ]


def month_key(value: str) -> str:
    return str(value)[:7]


def update_position_marks(positions: list[dict], snapshot: dict, prices: dict[str, float], model_name: str) -> None:
    stocks = stock_map(snapshot)
    for position in positions:
        ticker = position["ticker"]
        if ticker in prices:
            position["lastPrice"] = prices[ticker]
        output = frozen_output(stocks.get(ticker) or {}, model_name)
        if is_num(output.get("score")):
            position["lastScore"] = float(output["score"])


def portfolio_drawdown(history: list[dict]) -> float | None:
    values = [float(row["portfolioValue"]) for row in history if is_num(row.get("portfolioValue"))]
    if not values:
        return None
    peak = values[0]
    drawdown = 0.0
    for value in values:
        peak = max(peak, value)
        if peak > 0:
            drawdown = max(drawdown, (peak - value) / peak)
    return drawdown


def upsert_history(portfolio: dict, row: dict) -> None:
    by_date = {
        str(item.get("date")): item
        for item in portfolio.get("history", [])
        if isinstance(item, dict) and item.get("date")
    }
    by_date[row["date"]] = row
    portfolio["history"] = [by_date[key] for key in sorted(by_date)]


def initialize_portfolio(
    snapshot: dict,
    *,
    model_name: str,
    top_n: int,
    benchmark: str,
    initial_value: float,
    cost_bps: float,
) -> dict:
    snapshot_date = str(snapshot["snapshotDate"])
    targets = selected_targets(snapshot, model_name, top_n)
    benchmark_row = benchmark_map(snapshot).get(benchmark)
    benchmark_price = clean_price((benchmark_row or {}).get("currentPrice"))
    if not targets or benchmark_price is None:
        return {
            "schemaVersion": 1,
            "status": "awaiting_first_snapshot",
            "reason": "A snapshot with model scores, stock prices, and a SPY benchmark price is required.",
            "model": model_name,
            "formulaVersion": snapshot_formula_version(snapshot, model_name),
            "benchmark": benchmark,
            "topN": top_n,
            "latestSnapshot": snapshot.get("_path"),
        }
    initial_cost = initial_value * cost_bps / 10_000
    invested_value = initial_value - initial_cost
    positions = make_positions(targets, invested_value, snapshot_date)
    portfolio = {
        "schemaVersion": 1,
        "status": "active",
        "model": model_name,
        "formulaVersion": snapshot_formula_version(snapshot, model_name),
        "benchmark": benchmark,
        "topN": top_n,
        "rebalanceSchedule": "monthly",
        "transactionCostBps": cost_bps,
        "initialValue": initial_value,
        "inceptionDate": snapshot_date,
        "lastRebalanceDate": snapshot_date,
        "lastUpdated": snapshot.get("snapshotTime"),
        "latestSnapshot": snapshot.get("_path"),
        "cumulativeCosts": initial_cost,
        "benchmarkStartPrice": benchmark_price,
        "positions": positions,
        "rebalanceHistory": [
            {
                "date": snapshot_date,
                "reason": "inception",
                "turnover": 1.0,
                "transactionCost": initial_cost,
                "tickers": [row["ticker"] for row in positions],
            }
        ],
        "history": [],
    }
    upsert_history(
        portfolio,
        {
            "date": snapshot_date,
            "snapshotTime": snapshot.get("snapshotTime"),
            "portfolioValue": invested_value,
            "benchmarkValue": initial_value,
            "portfolioReturn": invested_value / initial_value - 1,
            "benchmarkReturn": 0.0,
            "excessReturn": invested_value / initial_value - 1,
            "transactionCost": initial_cost,
            "rebalanced": True,
        },
    )
    portfolio["summary"] = {
        "portfolioValue": invested_value,
        "benchmarkValue": initial_value,
        "portfolioReturn": invested_value / initial_value - 1,
        "benchmarkReturn": 0.0,
        "excessReturn": invested_value / initial_value - 1,
        "maxDrawdown": 0.0,
        "evidenceDays": 1,
    }
    return portfolio


def update_portfolio(portfolio: dict, snapshot: dict) -> dict:
    snapshot_date = str(snapshot["snapshotDate"])
    model_name = str(portfolio["model"])
    current_formula = snapshot_formula_version(snapshot, model_name)
    formula_changed = current_formula != portfolio.get("formulaVersion")
    positions = list(portfolio.get("positions") or [])
    prices = latest_prices(snapshot, positions)
    values = position_values(positions, prices)
    pre_cost_value = sum(values.values())
    transaction_cost = 0.0
    rebalanced = False

    should_rebalance = (
        portfolio.get("rebalanceSchedule") == "monthly"
        and month_key(snapshot_date) != month_key(str(portfolio.get("lastRebalanceDate") or ""))
    )
    if should_rebalance and not formula_changed and pre_cost_value > 0:
        targets = selected_targets(snapshot, model_name, int(portfolio.get("topN") or 20))
        if targets:
            old_weights = {ticker: value / pre_cost_value for ticker, value in values.items()}
            new_weights = {row["ticker"]: row["targetWeight"] for row in targets}
            tickers = set(old_weights) | set(new_weights)
            turnover = 0.5 * sum(abs(new_weights.get(ticker, 0) - old_weights.get(ticker, 0)) for ticker in tickers)
            transaction_cost = pre_cost_value * turnover * float(portfolio.get("transactionCostBps") or 0) / 10_000
            investable = max(0.0, pre_cost_value - transaction_cost)
            positions = make_positions(targets, investable, snapshot_date)
            prices = {row["ticker"]: row["price"] for row in targets}
            values = position_values(positions, prices)
            portfolio["lastRebalanceDate"] = snapshot_date
            portfolio.setdefault("rebalanceHistory", []).append(
                {
                    "date": snapshot_date,
                    "reason": "monthly",
                    "turnover": turnover,
                    "transactionCost": transaction_cost,
                    "tickers": [row["ticker"] for row in positions],
                }
            )
            portfolio["cumulativeCosts"] = float(portfolio.get("cumulativeCosts") or 0) + transaction_cost
            rebalanced = True

    update_position_marks(positions, snapshot, prices, model_name)
    portfolio_value = sum(position_values(positions, prices).values())
    benchmark_price = clean_price((benchmark_map(snapshot).get(str(portfolio["benchmark"])) or {}).get("currentPrice"))
    benchmark_start = clean_price(portfolio.get("benchmarkStartPrice"))
    initial_value = float(portfolio["initialValue"])
    benchmark_value = (
        initial_value * benchmark_price / benchmark_start
        if benchmark_price is not None and benchmark_start is not None
        else None
    )
    portfolio_return = portfolio_value / initial_value - 1
    benchmark_return = benchmark_value / initial_value - 1 if benchmark_value is not None else None
    history_row = {
        "date": snapshot_date,
        "snapshotTime": snapshot.get("snapshotTime"),
        "portfolioValue": portfolio_value,
        "benchmarkValue": benchmark_value,
        "portfolioReturn": portfolio_return,
        "benchmarkReturn": benchmark_return,
        "excessReturn": portfolio_return - benchmark_return if benchmark_return is not None else None,
        "transactionCost": transaction_cost,
        "rebalanced": rebalanced,
    }
    upsert_history(portfolio, history_row)
    portfolio["positions"] = positions
    portfolio["lastUpdated"] = snapshot.get("snapshotTime")
    portfolio["latestSnapshot"] = snapshot.get("_path")
    portfolio["status"] = "formula_changed" if formula_changed else "active"
    portfolio["requiresReset"] = formula_changed
    if formula_changed:
        portfolio["statusReason"] = (
            f"Snapshot uses {current_formula}; paper portfolio remains frozen on "
            f"{portfolio.get('formulaVersion')} until explicitly reset."
        )
    else:
        portfolio.pop("statusReason", None)
    history = portfolio.get("history") or []
    portfolio["summary"] = {
        "portfolioValue": portfolio_value,
        "benchmarkValue": benchmark_value,
        "portfolioReturn": portfolio_return,
        "benchmarkReturn": benchmark_return,
        "excessReturn": portfolio_return - benchmark_return if benchmark_return is not None else None,
        "maxDrawdown": portfolio_drawdown(history),
        "evidenceDays": len(history),
    }
    return portfolio


def main() -> int:
    parser = argparse.ArgumentParser(description="Update the forward Kelly paper portfolio.")
    parser.add_argument("--history-dir", type=Path, default=HISTORY_DIR)
    parser.add_argument("--output", type=Path, default=OUT_PATH)
    parser.add_argument("--model", choices=[MODEL_V13, MODEL_V14], default=MODEL_V14)
    parser.add_argument("--top", type=int, default=20)
    parser.add_argument("--benchmark", default="SPY")
    parser.add_argument("--initial-value", type=float, default=10_000)
    parser.add_argument("--cost-bps", type=float, default=10)
    parser.add_argument("--reset", action="store_true")
    args = parser.parse_args()

    snapshot = load_latest_snapshot(args.history_dir)
    if snapshot is None:
        raise SystemExit("No dated model snapshot is available.")
    existing = None if args.reset else load_existing(args.output)
    if existing is None:
        portfolio = initialize_portfolio(
            snapshot,
            model_name=args.model,
            top_n=args.top,
            benchmark=args.benchmark.strip().upper(),
            initial_value=args.initial_value,
            cost_bps=args.cost_bps,
        )
    else:
        portfolio = update_portfolio(existing, snapshot)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(portfolio, indent=2) + "\n")
    print(
        f"paper portfolio status={portfolio.get('status')} "
        f"date={snapshot.get('snapshotDate')} evidenceDays={(portfolio.get('summary') or {}).get('evidenceDays', 0)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
