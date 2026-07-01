#!/usr/bin/env python3
"""Golden-output contract for the frozen v13.0.0 and v14.0.0 formulas."""

from __future__ import annotations

import hashlib
import unittest
from pathlib import Path

import scan_yahoo_stocks as model


ROOT = Path(__file__).resolve().parents[1]
APP_PATH = ROOT / "src" / "App.tsx"
APP_MODEL_SHA256 = "f3ae4dce46c9f74670ad16fbd1fbf64e255bb5ae850bff713bed925d2634c68e"


STOCKS = [
    {
        "name": "Alpha",
        "ticker": "ALPHA",
        "sector": "ai",
        "strongBuy": 55,
        "buy": 25,
        "hold": 15,
        "sell": 5,
        "upside": 0.32,
        "drawdown": 0.38,
        "shortInt": 0.025,
        "beta": 1.4,
        "fxExposed": True,
        "earningsDays": 45,
        "ytd": 0.12,
        "analystCount": 22,
        "grossMargins": 0.62,
        "operatingMargins": 0.24,
        "profitMargins": 0.18,
        "returnOnEquity": 0.28,
        "returnOnAssets": 0.12,
        "revenueGrowth": 0.18,
        "earningsGrowth": 0.25,
        "freeCashflowYield": 0.045,
        "debtToEquity": 0.55,
        "currentRatio": 1.8,
        "cashDebtRatio": 0.8,
        "forwardPE": 24,
        "trailingPE": 29,
        "enterpriseToEbitda": 18,
        "priceToSales": 7,
        "priceToBook": 6,
        "pegRatio": 1.4,
    },
    {
        "name": "Beta",
        "ticker": "BETA",
        "sector": "consumer",
        "strongBuy": 20,
        "buy": 30,
        "hold": 40,
        "sell": 10,
        "upside": 0.18,
        "drawdown": 0.22,
        "shortInt": 0.04,
        "beta": 0.9,
        "fxExposed": False,
        "earningsDays": 120,
        "ytd": -0.08,
        "analystCount": 12,
        "grossMargins": 0.38,
        "operatingMargins": 0.11,
        "profitMargins": 0.07,
        "returnOnEquity": 0.14,
        "returnOnAssets": 0.06,
        "revenueGrowth": 0.05,
        "earningsGrowth": 0.08,
        "freeCashflowYield": 0.06,
        "debtToEquity": 1.1,
        "currentRatio": 1.3,
        "cashDebtRatio": 0.4,
        "forwardPE": 16,
        "trailingPE": 19,
        "enterpriseToEbitda": 11,
        "priceToSales": 2.5,
        "priceToBook": 3,
        "pegRatio": 1.1,
    },
]

EXPECTED = {
    model.MODEL_V13: {
        "version": "v13.0.0",
        "ALPHA": {"score": 3.1281897387994673, "pAdj": 0.6380629175162571, "rawK": 0.09520577465911423},
        "BETA": {"score": 2.436896580450971, "pAdj": 0.5938641384481175, "rawK": 0.04386413844811747},
    },
    model.MODEL_V14: {
        "version": "v14.0.0",
        "ALPHA": {"score": 15.338631756183513, "pAdj": 0.881062206273894, "rawK": 0.39872825200767636},
        "BETA": {"score": 10.621774682544801, "pAdj": 0.7356185590476203, "rawK": 0.21114091643763333},
    },
}


def app_function_source(source: str, name: str) -> str:
    start = source.index(f"function {name}(")
    brace = source.index("{", start)
    depth = 0
    for index in range(brace, len(source)):
        if source[index] == "{":
            depth += 1
        elif source[index] == "}":
            depth -= 1
            if depth == 0:
                return source[start : index + 1]
    raise ValueError(f"Could not isolate {name} in {APP_PATH}")


def app_model_hash() -> str:
    source = APP_PATH.read_text()
    constants = "\n".join(
        line.strip()
        for line in source.splitlines()
        if line.strip().startswith(
            (
                "const W_ANALYST",
                "const W_MOMENTUM",
                "const W_RR",
                "const W_SI",
                "const W_EP",
                "const MODEL_FORMULA_VERSIONS",
            )
        )
    )
    probability = source[source.index("function pAnalyst") : source.index("function normalizeStock")]
    correlation_label = source.index("// CORRELATION MATRICES")
    fundamentals_end = source.rfind("\n//", 0, correlation_label) + 1
    fundamentals = source[
        source.index("const clamp01") :
        fundamentals_end
    ]
    earnings = next(line for line in source.splitlines() if line.startswith("const earningsMult="))
    payload = "\n".join((constants, probability, fundamentals, earnings, app_function_source(source, "runModel")))
    return hashlib.sha256(payload.encode()).hexdigest()


class ModelContractTest(unittest.TestCase):
    def test_browser_model_source_is_frozen(self) -> None:
        self.assertEqual(
            app_model_hash(),
            APP_MODEL_SHA256,
            "App scoring changed. Issue a new formula version and intentionally update the contract.",
        )

    def test_frozen_model_outputs(self) -> None:
        for model_name, expected in EXPECTED.items():
            self.assertEqual(model.model_formula_version(model_name), expected["version"])
            rows = {
                row["ticker"]: row
                for row in model.run_model(STOCKS, model_name, budget=100, kelly_mult=0.5)
            }
            for ticker in ("ALPHA", "BETA"):
                for field, value in expected[ticker].items():
                    self.assertAlmostEqual(rows[ticker][field], value, places=12)


if __name__ == "__main__":
    unittest.main()
