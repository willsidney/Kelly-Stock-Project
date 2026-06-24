#!/usr/bin/env python3
"""Audit the Kelly scoring model against the local Yahoo stock database.

This script does not need internet access. It tests the model's current
cross-sectional behaviour and runs a limited YTD diagnostic using the returns
already stored in public/data/stocks.json.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "public" / "data" / "stocks.json"

sys.path.insert(0, str(ROOT / "scripts"))
import scan_yahoo_stocks as model  # noqa: E402


FIELDS = [
    "currentPrice",
    "targetMeanPrice",
    "upside",
    "drawdown",
    "beta",
    "shortInt",
    "ytd",
    "analystCount",
    "marketCap",
    "forwardPE",
    "trailingPE",
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
    "freeCashflowYield",
    "cashDebtRatio",
]

CORRELATION_FEATURES = [
    "upside",
    "drawdown",
    "beta",
    "shortInt",
    "ytd",
    "analystCount",
    "marketCap",
    "forwardPE",
    "trailingPE",
    "priceToSales",
    "priceToBook",
    "revenueGrowth",
    "earningsGrowth",
    "grossMargins",
    "operatingMargins",
    "profitMargins",
    "returnOnEquity",
    "freeCashflowYield",
    "cashDebtRatio",
]


def is_num(value) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(value)


def mean(values) -> float | None:
    clean = [float(value) for value in values if is_num(value)]
    return sum(clean) / len(clean) if clean else None


def median(values) -> float | None:
    clean = sorted(float(value) for value in values if is_num(value))
    return statistics.median(clean) if clean else None


def pearson(left, right) -> float | None:
    pairs = [(float(a), float(b)) for a, b in zip(left, right) if is_num(a) and is_num(b)]
    if len(pairs) < 3:
        return None
    xs = [pair[0] for pair in pairs]
    ys = [pair[1] for pair in pairs]
    mx = sum(xs) / len(xs)
    my = sum(ys) / len(ys)
    vx = sum((x - mx) ** 2 for x in xs)
    vy = sum((y - my) ** 2 for y in ys)
    if vx <= 0 or vy <= 0:
        return None
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / math.sqrt(vx * vy)


def ranks(values: list[float]) -> list[float]:
    ordered = sorted((value, idx) for idx, value in enumerate(values))
    out = [0.0] * len(values)
    i = 0
    while i < len(ordered):
        j = i
        while j + 1 < len(ordered) and ordered[j + 1][0] == ordered[i][0]:
            j += 1
        avg_rank = (i + j) / 2 + 1
        for k in range(i, j + 1):
            out[ordered[k][1]] = avg_rank
        i = j + 1
    return out


def spearman(left, right) -> float | None:
    pairs = [(float(a), float(b)) for a, b in zip(left, right) if is_num(a) and is_num(b)]
    if len(pairs) < 3:
        return None
    return pearson(ranks([pair[0] for pair in pairs]), ranks([pair[1] for pair in pairs]))


def pct(value) -> float | None:
    return None if value is None else value * 100


def source_counts(stocks: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for stock in stocks:
        source = stock.get("universeSource") or "manual/original"
        counts[source] = counts.get(source, 0) + 1
    return dict(sorted(counts.items(), key=lambda item: item[0]))


def coverage(stocks: list[dict]) -> dict[str, int]:
    return {field: sum(1 for stock in stocks if is_num(stock.get(field))) for field in FIELDS}


def equal_weight_ytd(rows: list[dict]) -> float | None:
    return mean(row.get("ytd") for row in rows)


def model_weight_ytd(rows: list[dict]) -> float | None:
    weighted = [
        (float(row["ytd"]), float(row["weight"]))
        for row in rows
        if is_num(row.get("ytd")) and is_num(row.get("weight"))
    ]
    total = sum(weight for _, weight in weighted)
    if total <= 0:
        return None
    return sum(ret * weight for ret, weight in weighted) / total


def summarize_model(rows: list[dict], label: str) -> dict:
    n = len(rows)
    top_n = max(1, n // 10)
    top = rows[:top_n]
    bottom = rows[-top_n:]
    positive = [row for row in rows if (row.get("score") or 0) > 0]
    return {
        "label": label,
        "count": n,
        "top_decile_count": top_n,
        "top_decile_tickers": [row["ticker"] for row in top[:20]],
        "positive_score_count": len(positive),
        "floor_only_count": sum(1 for row in rows if row.get("isFloorOnly")),
        "universe_equal_ytd_pct": pct(equal_weight_ytd(rows)),
        "model_weighted_ytd_pct": pct(model_weight_ytd(rows)),
        "top_decile_equal_ytd_pct": pct(equal_weight_ytd(top)),
        "bottom_decile_equal_ytd_pct": pct(equal_weight_ytd(bottom)),
        "positive_score_equal_ytd_pct": pct(equal_weight_ytd(positive)),
        "universe_beta_mean": mean(row.get("beta") for row in rows),
        "top_decile_beta_mean": mean(row.get("beta") for row in top),
        "universe_drawdown_mean_pct": pct(mean(row.get("drawdown") for row in rows)),
        "top_decile_drawdown_mean_pct": pct(mean(row.get("drawdown") for row in top)),
        "universe_upside_mean_pct": pct(mean(row.get("upside") for row in rows)),
        "top_decile_upside_mean_pct": pct(mean(row.get("upside") for row in top)),
        "spearman_score": {
            feature: spearman([row.get("score") for row in rows], [row.get(feature) for row in rows])
            for feature in CORRELATION_FEATURES
        },
    }


def kelly_formula_audit(rows: list[dict]) -> dict:
    items = []
    for row in rows:
        upside = float(row.get("upside") or 0)
        drawdown = float(row.get("drawdown") or 0.30)
        p_adj = float(row.get("pAdj") or 0)
        numerator = p_adj * upside - (1 - p_adj) * drawdown
        app_raw = numerator / (upside + drawdown) if upside + drawdown > 0 else None
        textbook_raw = numerator / (upside * drawdown) if upside > 0 and drawdown > 0 else None
        if textbook_raw is None:
            continue
        items.append(
            {
                "ticker": row["ticker"],
                "app_raw_k": app_raw,
                "textbook_raw_k": textbook_raw,
                "upside": upside,
                "drawdown": drawdown,
                "p_adj": p_adj,
                "score": row.get("score"),
            }
        )
    app_ranked = sorted(items, key=lambda item: item["app_raw_k"], reverse=True)
    textbook_ranked = sorted(items, key=lambda item: item["textbook_raw_k"], reverse=True)
    return {
        "count_with_positive_upside": len(items),
        "median_app_raw_k_pct": pct(median(item["app_raw_k"] for item in items)),
        "median_textbook_raw_k_pct": pct(median(item["textbook_raw_k"] for item in items)),
        "spearman_app_vs_textbook": spearman(
            [item["app_raw_k"] for item in items],
            [item["textbook_raw_k"] for item in items],
        ),
        "top20_overlap_app_vs_textbook": len(
            {item["ticker"] for item in app_ranked[:20]}
            & {item["ticker"] for item in textbook_ranked[:20]}
        ),
    }


def compare_models(v13: list[dict], v14: list[dict]) -> dict:
    by_v13 = {row["ticker"]: row for row in v13}
    by_v14 = {row["ticker"]: row for row in v14}
    common = sorted(set(by_v13) & set(by_v14))
    top30_v13 = {row["ticker"] for row in v13[:30]}
    top30_v14 = {row["ticker"] for row in v14[:30]}
    return {
        "score_spearman_v13_v14": spearman(
            [by_v13[ticker]["score"] for ticker in common],
            [by_v14[ticker]["score"] for ticker in common],
        ),
        "top30_overlap": len(top30_v13 & top30_v14),
        "v13_only_top30": sorted(top30_v13 - top30_v14),
        "v14_only_top30": sorted(top30_v14 - top30_v13),
    }


def build_audit() -> dict:
    stocks = json.loads(DATA_PATH.read_text())
    v13 = model.run_model(stocks, model.MODEL_V13, budget=100, kelly_mult=0.5)
    v14 = model.run_model(stocks, model.MODEL_V14, budget=100, kelly_mult=0.5)
    return {
        "database": {
            "count": len(stocks),
            "model_ready": sum(1 for stock in stocks if stock.get("modelReady")),
            "tracked_incomplete": sum(1 for stock in stocks if not stock.get("modelReady")),
            "source_counts": source_counts(stocks),
            "coverage": coverage(stocks),
        },
        "v13": summarize_model(v13, model.MODEL_V13),
        "v14": summarize_model(v14, model.MODEL_V14),
        "model_compare": compare_models(v13, v14),
        "kelly_formula_audit_v13": kelly_formula_audit(v13),
    }


def fmt_num(value, digits=2, suffix="") -> str:
    if value is None:
        return "-"
    return f"{float(value):.{digits}f}{suffix}"


def print_markdown(audit: dict) -> None:
    print("# Kelly Model Statistical Audit")
    print()
    print("This is a local snapshot audit, not a clean point-in-time historical backtest.")
    print("The database stores today's Yahoo inputs, so YTD tests below are diagnostic only.")
    print()
    db = audit["database"]
    print("## Database")
    print(f"- Stocks: {db['count']}")
    print(f"- Model-ready: {db['model_ready']}")
    print(f"- Tracked incomplete: {db['tracked_incomplete']}")
    print("- Source counts:")
    for source, count in db["source_counts"].items():
        print(f"  - {source}: {count}")
    print()
    print("## Model Diagnostics")
    for key in ("v13", "v14"):
        row = audit[key]
        print(f"### {key}")
        print(f"- Positive-score stocks: {row['positive_score_count']}")
        print(f"- Floor-only stocks: {row['floor_only_count']}")
        print(f"- Current-snapshot model-weighted YTD: {fmt_num(row['model_weighted_ytd_pct'], 2, '%')}")
        print(f"- Current-snapshot universe equal YTD: {fmt_num(row['universe_equal_ytd_pct'], 2, '%')}")
        print(f"- Top decile equal YTD: {fmt_num(row['top_decile_equal_ytd_pct'], 2, '%')}")
        print(f"- Top decile average upside: {fmt_num(row['top_decile_upside_mean_pct'], 2, '%')}")
        print(f"- Top decile average beta: {fmt_num(row['top_decile_beta_mean'], 2)}")
        print(f"- Top tickers: {', '.join(row['top_decile_tickers'])}")
        print()
    comp = audit["model_compare"]
    print("## v13 vs v14")
    print(f"- Score rank correlation: {fmt_num(comp['score_spearman_v13_v14'], 3)}")
    print(f"- Top-30 overlap: {comp['top30_overlap']} of 30")
    print()
    kelly = audit["kelly_formula_audit_v13"]
    print("## Kelly Formula Audit")
    print(f"- Median app raw Kelly: {fmt_num(kelly['median_app_raw_k_pct'], 2, '%')}")
    print(f"- Median textbook raw Kelly: {fmt_num(kelly['median_textbook_raw_k_pct'], 2, '%')}")
    print(f"- App-vs-textbook raw Kelly rank correlation: {fmt_num(kelly['spearman_app_vs_textbook'], 3)}")
    print(f"- Top-20 overlap: {kelly['top20_overlap_app_vs_textbook']} of 20")


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit Kelly model statistics.")
    parser.add_argument("--format", choices=["json", "markdown"], default="markdown")
    args = parser.parse_args()
    audit = build_audit()
    if args.format == "json":
        print(json.dumps(audit, indent=2, sort_keys=True))
    else:
        print_markdown(audit)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
