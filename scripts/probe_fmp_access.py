#!/usr/bin/env python3
"""Probe Financial Modeling Prep access for historical backtesting data.

Set FMP_API_KEY in your local shell or GitHub secret. The script writes a small
capability report and does not print or store the API key.
"""

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
OUT_PATH = ROOT / "public" / "data" / "fmp-access-report.json"
BASE_URL = "https://financialmodelingprep.com/stable"
DEFAULT_TICKERS = "AAPL,MSFT,NVDA,JPM,CELH"

ENDPOINTS = [
    {
        "name": "grades_historical",
        "path": "grades-historical",
        "params": {},
        "use_limit": False,
        "purpose": "Historical analyst rating positions",
        "must_have": True,
    },
    {
        "name": "grades_consensus",
        "path": "grades-consensus",
        "params": {},
        "use_limit": False,
        "purpose": "Current analyst rating consensus",
        "must_have": False,
    },
    {
        "name": "price_target_consensus",
        "path": "price-target-consensus",
        "params": {},
        "use_limit": False,
        "purpose": "Analyst target-price consensus",
        "must_have": True,
    },
    {
        "name": "price_target_summary",
        "path": "price-target-summary",
        "params": {},
        "use_limit": False,
        "purpose": "Analyst target-price summary",
        "must_have": False,
    },
    {
        "name": "dividend_adjusted_prices",
        "path": "historical-price-eod/dividend-adjusted",
        "params": {},
        "purpose": "Historical total-return-ish price series",
        "must_have": True,
    },
    {
        "name": "historical_market_cap",
        "path": "historical-market-capitalization",
        "params": {},
        "purpose": "Historical market-cap universe filters",
        "must_have": False,
    },
    {
        "name": "ratios_annual",
        "path": "ratios",
        "params": {"period": "annual"},
        "purpose": "Historical valuation/profitability ratios",
        "must_have": False,
    },
    {
        "name": "key_metrics_annual",
        "path": "key-metrics",
        "params": {"period": "annual"},
        "purpose": "Historical financial quality metrics",
        "must_have": False,
    },
    {
        "name": "income_statement_annual",
        "path": "income-statement",
        "params": {"period": "annual"},
        "purpose": "Historical revenue/earnings growth inputs",
        "must_have": False,
    },
    {
        "name": "ratings_historical",
        "path": "ratings-historical",
        "params": {},
        "use_limit": False,
        "purpose": "Historical analyst rating scores",
        "must_have": False,
    },
    {
        "name": "analyst_estimates_annual",
        "path": "analyst-estimates",
        "params": {"period": "annual"},
        "purpose": "Analyst EPS/revenue estimates",
        "must_have": False,
    },
    {
        "name": "analyst_estimates_quarterly",
        "path": "analyst-estimates",
        "params": {"period": "quarter"},
        "purpose": "Quarterly analyst EPS/revenue estimates",
        "must_have": False,
    },
    {
        "name": "financial_estimates_annual",
        "path": "financial-estimates",
        "params": {"period": "annual"},
        "purpose": "Alternative FMP financial estimates endpoint",
        "must_have": False,
    },
    {
        "name": "financial_estimates_quarterly",
        "path": "financial-estimates",
        "params": {"period": "quarter"},
        "purpose": "Alternative FMP quarterly estimates endpoint",
        "must_have": False,
    },
    {
        "name": "quote",
        "path": "quote",
        "params": {},
        "use_limit": False,
        "purpose": "Current price, volume, market cap, and exchange fields",
        "must_have": False,
    },
    {
        "name": "profile",
        "path": "profile",
        "params": {},
        "use_limit": False,
        "purpose": "Company profile, sector, industry, exchange, and beta",
        "must_have": False,
    },
    {
        "name": "ratios_ttm",
        "path": "ratios-ttm",
        "params": {},
        "purpose": "Current trailing valuation/profitability ratios",
        "must_have": False,
    },
    {
        "name": "key_metrics_ttm",
        "path": "key-metrics-ttm",
        "params": {},
        "purpose": "Current trailing financial quality metrics",
        "must_have": False,
    },
    {
        "name": "balance_sheet_annual",
        "path": "balance-sheet-statement",
        "params": {"period": "annual"},
        "purpose": "Historical balance-sheet quality inputs",
        "must_have": False,
    },
    {
        "name": "cash_flow_annual",
        "path": "cash-flow-statement",
        "params": {"period": "annual"},
        "purpose": "Historical free-cash-flow quality inputs",
        "must_have": False,
    },
    {
        "name": "enterprise_values_annual",
        "path": "enterprise-values",
        "params": {"period": "annual"},
        "purpose": "Historical enterprise value and share count",
        "must_have": False,
    },
    {
        "name": "financial_growth_annual",
        "path": "financial-growth",
        "params": {"period": "annual"},
        "purpose": "Historical financial growth rates",
        "must_have": False,
    },
    {
        "name": "financial_scores",
        "path": "financial-scores",
        "params": {},
        "use_limit": False,
        "purpose": "Altman/Piotroski-style financial health scores",
        "must_have": False,
    },
]

ENDPOINT_META = {
    "grades_historical": ("Analyst ratings", "Historical analyst sentiment", "Analyst sentiment"),
    "ratings_historical": ("Analyst ratings", "Historical analyst sentiment", "Analyst sentiment"),
    "grades_consensus": ("Analyst ratings", "No, unless dated rows are returned", "Current analyst sentiment"),
    "price_target_consensus": ("Analyst targets", "No, unless dated rows are returned", "Target-price upside"),
    "price_target_summary": ("Analyst targets", "No, unless dated rows are returned", "Target-price upside and dispersion"),
    "analyst_estimates_annual": ("Analyst estimates", "Forward estimates if dated rows are returned", "Forward growth and valuation"),
    "analyst_estimates_quarterly": ("Analyst estimates", "Forward estimates if dated rows are returned", "Near-term revisions and growth"),
    "financial_estimates_annual": ("Analyst estimates", "Forward estimates if dated rows are returned", "Forward growth and valuation"),
    "financial_estimates_quarterly": ("Analyst estimates", "Forward estimates if dated rows are returned", "Near-term revisions and growth"),
    "dividend_adjusted_prices": ("Prices", "Future return measurement", "Current and historical price risk"),
    "historical_market_cap": ("Universe filters", "Point-in-time universe filters", "Size filter"),
    "quote": ("Current market data", "No, current snapshot only", "Live price and market data"),
    "profile": ("Reference data", "No, current snapshot only", "Sector, industry, beta, and exchange filters"),
    "ratios_annual": ("Fundamentals", "Valuation, profitability, leverage", "Valuation and quality"),
    "ratios_ttm": ("Fundamentals", "No, current snapshot only", "Current valuation and quality"),
    "key_metrics_annual": ("Fundamentals", "Valuation, growth, profitability, balance-sheet quality", "Quality and valuation"),
    "key_metrics_ttm": ("Fundamentals", "No, current snapshot only", "Current quality and valuation"),
    "income_statement_annual": ("Fundamentals", "Revenue and earnings growth", "Growth and profitability"),
    "balance_sheet_annual": ("Fundamentals", "Debt, cash, liquidity, book value", "Balance-sheet risk"),
    "cash_flow_annual": ("Fundamentals", "Free cash flow and capital intensity", "Cash-flow quality"),
    "enterprise_values_annual": ("Fundamentals", "Enterprise-value valuation ratios", "Current valuation context"),
    "financial_growth_annual": ("Fundamentals", "Growth trend signals", "Growth trend signals"),
    "financial_scores": ("Fundamentals", "No, unless dated rows are returned", "Financial health screen"),
}

ENDPOINT_SETS = {
    "core": {"dividend_adjusted_prices", "historical_market_cap", "quote", "profile"},
    "analyst": {
        "grades_historical",
        "ratings_historical",
        "grades_consensus",
        "price_target_consensus",
        "price_target_summary",
        "analyst_estimates_annual",
        "analyst_estimates_quarterly",
        "financial_estimates_annual",
        "financial_estimates_quarterly",
    },
    "fundamentals": {
        "ratios_annual",
        "ratios_ttm",
        "key_metrics_annual",
        "key_metrics_ttm",
        "income_statement_annual",
        "balance_sheet_annual",
        "cash_flow_annual",
        "enterprise_values_annual",
        "financial_growth_annual",
        "financial_scores",
    },
}
ENDPOINT_SETS["all"] = set().union(*ENDPOINT_SETS.values())

CURRENT_SNAPSHOT_ONLY = {"quote", "profile", "ratios_ttm", "key_metrics_ttm"}


def fetch_json(url: str) -> tuple[int | None, object | None, str | None]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "KellyStockProject/1.0",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8", errors="replace")
            return response.status, json.loads(body), None
    except Exception as exc:
        return None, None, str(exc)


def make_url(endpoint: dict, ticker: str, api_key: str, limit: int) -> str:
    params = {"symbol": ticker, "apikey": api_key}
    params.update(endpoint.get("params") or {})
    if endpoint.get("use_limit", True):
        params.setdefault("limit", str(limit))
    return f"{BASE_URL}/{endpoint['path']}?{urllib.parse.urlencode(params)}"


def classify_response(data: object) -> tuple[list[dict], str | None]:
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)], None
    if isinstance(data, dict):
        for key in ("data", "historical", "results", "result"):
            nested = data.get(key)
            if isinstance(nested, list):
                return [row for row in nested if isinstance(row, dict)], None
        if "Error Message" in data:
            return [], str(data.get("Error Message"))
        if "error" in data:
            return [], str(data.get("error"))
        if "message" in data and len(data) <= 2:
            return [], str(data.get("message"))
        return [data], None
    return [], "unexpected response shape"


def response_shape(data: object) -> dict:
    if isinstance(data, list):
        return {"type": "list", "length": len(data)}
    if isinstance(data, dict):
        preview = {}
        for key, value in list(data.items())[:8]:
            if isinstance(value, list):
                preview[key] = f"list[{len(value)}]"
            elif isinstance(value, dict):
                preview[key] = f"dict[{len(value)}]"
            else:
                text = str(value)
                preview[key] = text[:120]
        return {"type": "dict", "keys": list(data.keys())[:20], "preview": preview}
    return {"type": type(data).__name__}


def value_kind(value) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int):
        return "int"
    if isinstance(value, float):
        return "float"
    if isinstance(value, str):
        return "date/string" if looks_like_date(value) else "string"
    return type(value).__name__


def looks_like_date(value: str) -> bool:
    try:
        datetime.fromisoformat(value[:10])
        return len(value) >= 10 and value[4] == "-" and value[7] == "-"
    except Exception:
        return False


def summarize_rows(rows: list[dict]) -> dict:
    fields = sorted({key for row in rows for key in row.keys()})
    date_fields = [
        field
        for field in fields
        if any(looks_like_date(str(row.get(field))) for row in rows[:20] if row.get(field) is not None)
    ]
    dates = []
    for field in date_fields:
        for row in rows:
            value = row.get(field)
            if value and looks_like_date(str(value)):
                dates.append(str(value)[:10])
    field_types = {}
    for field in fields:
        for row in rows:
            value = row.get(field)
            if value is not None:
                field_types[field] = value_kind(value)
                break
        else:
            field_types[field] = "null"
    return {
        "rowCount": len(rows),
        "fields": fields,
        "fieldTypes": field_types,
        "dateFields": sorted(date_fields),
        "minDate": min(dates) if dates else None,
        "maxDate": max(dates) if dates else None,
        "sample": rows[:2],
    }


def probe_endpoint(endpoint: dict, ticker: str, api_key: str, limit: int) -> dict:
    url = make_url(endpoint, ticker, api_key, limit)
    status, data, error = fetch_json(url)
    rows, message = classify_response(data)
    category, backtest_use, live_use = ENDPOINT_META.get(
        endpoint["name"], ("Other", "Unknown", "Unknown")
    )
    result = {
        "endpoint": endpoint["name"],
        "path": endpoint["path"],
        "category": category,
        "purpose": endpoint["purpose"],
        "backtestUse": backtest_use,
        "liveUse": live_use,
        "mustHave": endpoint["must_have"],
        "ticker": ticker,
        "httpStatus": status,
        "accessible": bool(rows),
        "error": error or message,
        "responseShape": response_shape(data),
    }
    if rows:
        result.update(summarize_rows(rows))
    else:
        result.update({"rowCount": 0, "fields": [], "dateFields": [], "minDate": None, "maxDate": None, "sample": []})
    return result


def capability_summary(results: list[dict]) -> dict:
    by_endpoint: dict[str, list[dict]] = {}
    for row in results:
        by_endpoint.setdefault(row["endpoint"], []).append(row)
    endpoints = {}
    for name, rows in by_endpoint.items():
        accessible_rows = [row for row in rows if row["accessible"]]
        dated_rows = [row for row in accessible_rows if row.get("dateFields")]
        category, backtest_use, live_use = ENDPOINT_META.get(name, ("Other", "Unknown", "Unknown"))
        earliest_date = min((row["minDate"] for row in dated_rows if row.get("minDate")), default=None)
        latest_date = max((row["maxDate"] for row in dated_rows if row.get("maxDate")), default=None)
        total_rows = sum(row.get("rowCount", 0) for row in accessible_rows)
        has_historical_series = bool(dated_rows) and (
            total_rows > max(1, len(accessible_rows)) or bool(earliest_date and latest_date and earliest_date < latest_date)
        )
        if name in CURRENT_SNAPSHOT_ONLY:
            has_historical_series = False
        endpoints[name] = {
            "category": category,
            "path": rows[0].get("path") if rows else None,
            "purpose": rows[0].get("purpose") if rows else None,
            "backtestUse": backtest_use,
            "liveUse": live_use,
            "accessibleTickers": [row["ticker"] for row in accessible_rows],
            "rowCounts": {row["ticker"]: row.get("rowCount", 0) for row in rows},
            "totalRows": total_rows,
            "hasDatedRows": bool(dated_rows),
            "hasHistoricalSeries": has_historical_series,
            "earliestDate": earliest_date,
            "latestDate": latest_date,
            "dateFields": sorted({field for row in accessible_rows for field in row.get("dateFields", [])}),
            "fields": sorted({field for row in accessible_rows for field in row.get("fields", [])}),
        }
    return {
        "historicalAnalystRatings": any(
            endpoints.get(name, {}).get("hasHistoricalSeries")
            for name in ("grades_historical", "ratings_historical")
        ),
        "targetPriceAvailable": bool(endpoints.get("price_target_consensus", {}).get("accessibleTickers")),
        "historicalTargetPrices": any(
            endpoints.get(name, {}).get("hasHistoricalSeries")
            for name in ("price_target_consensus", "price_target_summary")
        ),
        "analystEstimates": any(
            endpoints.get(name, {}).get("accessibleTickers")
            for name in (
                "analyst_estimates_annual",
                "analyst_estimates_quarterly",
                "financial_estimates_annual",
                "financial_estimates_quarterly",
            )
        ),
        "historicalPrices": bool(endpoints.get("dividend_adjusted_prices", {}).get("hasHistoricalSeries")),
        "historicalFundamentals": any(
            endpoints.get(name, {}).get("hasHistoricalSeries")
            for name in (
                "ratios_annual",
                "key_metrics_annual",
                "income_statement_annual",
                "balance_sheet_annual",
                "cash_flow_annual",
                "enterprise_values_annual",
                "financial_growth_annual",
            )
        ),
        "endpointSummary": endpoints,
    }


def print_markdown(report: dict) -> None:
    print("# FMP Access Probe")
    print()
    print(f"Generated: {report['generatedAt']}")
    print(f"Tickers: {', '.join(report['tickers'])}")
    print()
    cap = report["capabilities"]
    print("## Capability Summary")
    print(f"- Historical analyst ratings: {'yes' if cap['historicalAnalystRatings'] else 'no'}")
    print(f"- Target-price consensus: {'yes' if cap['targetPriceAvailable'] else 'no'}")
    print(f"- Historical target prices: {'yes' if cap['historicalTargetPrices'] else 'no'}")
    print(f"- Analyst/financial estimates: {'yes' if cap['analystEstimates'] else 'no'}")
    print(f"- Historical prices: {'yes' if cap['historicalPrices'] else 'no'}")
    print(f"- Historical fundamentals: {'yes' if cap['historicalFundamentals'] else 'no'}")
    print()
    print("| Endpoint | Area | Accessible | Dated | Historical series | Earliest | Latest | Rows | Backtest use | Live use | Fields |")
    print("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |")
    for name, row in cap["endpointSummary"].items():
        print(
            f"| {name} | {row['category']} | {len(row['accessibleTickers'])} | "
            f"{'yes' if row['hasDatedRows'] else 'no'} | "
            f"{'yes' if row['hasHistoricalSeries'] else 'no'} | {row['earliestDate'] or '-'} | "
            f"{row['latestDate'] or '-'} | {row['totalRows']} | {row['backtestUse']} | "
            f"{row['liveUse']} | {len(row['fields'])} |"
        )
    print()
    print("## Field Samples")
    print()
    print("| Endpoint | Date fields | Sample fields |")
    print("| --- | --- | --- |")
    for name, row in cap["endpointSummary"].items():
        if not row["fields"]:
            continue
        date_fields = ", ".join(row["dateFields"]) or "-"
        sample_fields = ", ".join(row["fields"][:18])
        if len(row["fields"]) > 18:
            sample_fields += f", ... (+{len(row['fields']) - 18})"
        print(f"| {name} | {date_fields} | {sample_fields} |")


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe FMP endpoint access for backtesting.")
    parser.add_argument("--tickers", default=DEFAULT_TICKERS, help="Comma separated sample tickers.")
    parser.add_argument(
        "--endpoint-set",
        choices=sorted(ENDPOINT_SETS.keys()),
        default="all",
        help="Endpoint family to probe.",
    )
    parser.add_argument("--limit", type=int, default=120)
    parser.add_argument("--pause", type=float, default=0.25, help="Seconds to wait between requests.")
    parser.add_argument("--output", type=Path, default=OUT_PATH)
    parser.add_argument("--format", choices=["json", "markdown"], default="markdown")
    parser.add_argument("--api-key", default="", help="Optional API key. Prefer FMP_API_KEY env var.")
    args = parser.parse_args()

    api_key = args.api_key or os.environ.get("FMP_API_KEY")
    if not api_key:
        print("error: set FMP_API_KEY first, or pass --api-key locally.", file=sys.stderr)
        return 2

    tickers = [token.strip().upper() for token in args.tickers.split(",") if token.strip()]
    selected_names = ENDPOINT_SETS[args.endpoint_set]
    selected_endpoints = [endpoint for endpoint in ENDPOINTS if endpoint["name"] in selected_names]
    results = []
    for ticker in tickers:
        for endpoint in selected_endpoints:
            print(f"probing {endpoint['name']} for {ticker}", file=sys.stderr)
            results.append(probe_endpoint(endpoint, ticker, api_key, args.limit))
            time.sleep(args.pause)

    report = {
        "generatedAt": datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "provider": "Financial Modeling Prep",
        "tickers": tickers,
        "endpointSet": args.endpoint_set,
        "capabilities": capability_summary(results),
        "results": results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")

    if args.format == "json":
        print(json.dumps(report, indent=2))
    else:
        print_markdown(report)
    print(f"wrote {args.output}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
