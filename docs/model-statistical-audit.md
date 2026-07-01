# Kelly Model Statistical Audit

Date: 2026-06-24

This note reviews the active scoring logic in `src/App.tsx` and the Python mirror in `scripts/scan_yahoo_stocks.py`.

## What Is Active

The app currently has two selectable model versions:

- v13 Current: analyst rating mix, YTD mean-reversion, analyst target upside vs one-year drawdown, short interest, earnings proximity, then a downside-adjusted Kelly-style allocator.
- v14 Optimized: analyst signal plus quality, valuation, growth, balance-sheet strength, target-price upside, data confidence, and risk penalties.

Monte Carlo is only a projection layer. It does not set the score or allocation unless the code is changed to do that.

## Statistical Flaws

1. The model is not calibrated to realized future returns.

   The probability outputs are hand-built scores mapped into probability-like numbers. A 65% model probability has not yet been proven to win about 65% of the time.

2. The v13 Kelly equation is not the textbook fractional-loss Kelly equation.

   For a payoff of `+upside` or `-drawdown`, textbook Kelly is:

   ```text
   f* = (p * upside - (1 - p) * drawdown) / (upside * drawdown)
   ```

   The app uses:

   ```text
   rawK = (p * upside - (1 - p) * drawdown) / (upside + drawdown)
   ```

   This keeps the sign direction but changes magnitude and can change rankings.

3. Analyst target upside is the dominant driver.

   In the current local database, score rank correlation with upside is about 0.74 for v13 and 0.73 for v14. That means the scanner is still mostly asking: "Which stocks have the biggest Yahoo target-price upside?"

4. The YTD component is contrarian, not momentum.

   v13 calls the term momentum, but it rewards stocks that are down YTD. That may be intentional mean reversion, but it should be labelled and tested as mean reversion.

5. Current-snapshot testing is not a valid backtest.

   The app stores today's Yahoo snapshot, not historical point-in-time snapshots. Testing today's score against earlier YTD returns uses information that was not available at the start of the period.

6. Missing or incomplete fundamentals can look too neutral.

   v14 often defaults missing quality or valuation inputs to a neutral 50/100. The confidence penalty helps, but missing data can still avoid being punished enough.

7. Allocation floors force exposure to every selected stock.

   Every stock gets a positive floor. This is fine for a hand-picked 10-stock portfolio, but a 1,000-stock database should not automatically allocate capital to weak names. The scanner should rank the full database, then the model builder should allocate only selected candidates.

8. Sector and correlation handling is rough.

   The model uses simple sector penalties and fixed assumptions. It does not estimate covariance from returns, so portfolio risk can be understated when many names share the same macro or factor exposure.

9. v14 has more sensible ingredients but more degrees of freedom.

   Quality, valuation, growth, and balance-sheet strength are better signals to include, but the chosen weights are not yet backed by out-of-sample evidence.

## Local Diagnostic Results

The local database had 298 stocks at audit time. Of those, 293 were model-ready and 5 were tracked as incomplete.

Field coverage was strong for core model inputs:

- Upside: 298 / 298
- Drawdown: 298 / 298
- Beta: 298 / 298
- Short interest: 298 / 298
- YTD: 298 / 298
- Analyst count: 298 / 298
- Market cap: 294 / 298
- Forward P/E: 293 / 298
- Price/sales: 293 / 298
- Gross margins: 294 / 298

Current-snapshot YTD diagnostic:

- Equal-weight universe YTD: +13.09%
- v13 model-weighted YTD: +3.65%
- v14 model-weighted YTD: +4.08%
- v13 top-decile equal-weight YTD: -5.52%
- v14 top-decile equal-weight YTD: -7.62%

This is not a fair historical backtest because today's scores use today's Yahoo data. It does show that both models currently lean heavily toward underperformers with high implied target upside.

Model comparison:

- v13 vs v14 score-rank correlation: 0.853
- Top-30 overlap: 15 of 30

Kelly formula audit:

- Median app raw Kelly: 0.88%
- Median textbook raw Kelly: 10.66%
- Top-20 overlap between app formula and textbook formula: 10 of 20

## Backtesting Status

A proper backtest needs point-in-time features:

- What Yahoo analyst targets, ratings, prices, fundamentals, beta, short interest, and drawdown looked like on each rebalance date.
- Subsequent forward returns after each rebalance date.
- Benchmark returns, ideally S&P 500 through SPY or ^GSPC.
- Transaction-cost and turnover assumptions.

The current project does not store historical feature snapshots yet, so the clean backtest cannot be completed from the existing database alone.

Update: the project now saves compact daily snapshots in `public/data/history/`. Each snapshot includes prices, Yahoo inputs, and frozen v13/v14 model outputs, so future walk-forward tests can compare model expectation against later realized performance.

July 2026 validation update:

- v13.0.0 and v14.0.0 are frozen for prospective testing.
- A golden-output contract fails if either implementation changes without an explicit version update.
- New snapshots store formula IDs and a separate SPY price.
- A persistent v14.0.0 paper portfolio tracks the top 20 stocks, rebalances monthly, and charges 10 basis points per one-way turnover.
- Historical and prospective reports now remain `research_only` while rank significance, point-in-time delisted-stock coverage, or independent forward evidence is missing.
- The historical price-only test uses Newey-West/HAC rank-IC statistics and reports a recent evaluation segment separately. That segment is not described as untouched because its results have already been observed.

FMP free-access update: dated historical analyst grades and dividend-adjusted prices are available, but dated price-target consensus and dated fundamentals are not available from the tested endpoints. This supports a genuine historical test of a ratings-and-price model, but not a clean historical test of the current target-upside/fundamental model.

First FMP historical result, using 9 large-cap tickers plus `SPY` from 2019 to 2026:

- Benchmark was available and the top/bottom split was corrected to avoid overlap.
- The combined FMP proxy score had a negative mean rank IC of -4.49%.
- The top-ranked basket underperformed both the equal-weight universe and the bottom-ranked basket.
- Analyst consensus was negative in this sample, with mean rank IC of -8.93%.
- The low-risk composite was also negative, with mean rank IC of -10.02%.

This is not enough evidence to invert the model or call the result final. The sample is tiny, current-winner-biased, and cannot test historical Yahoo target-price upside or dated fundamentals. It is enough evidence to reject the idea that the current score is already statistically optimized. It also supports reducing or redesigning the volatility/drawdown penalty, because this test punished exactly the kind of high-upside stocks the model is meant to allow when the expected return is strong enough.

## Recommendation

Do not treat either v13 or v14 as fully validated yet.

The next statistically sound version should:

- Store daily or weekly point-in-time snapshots of all Yahoo inputs.
- Backtest with walk-forward rebalancing.
- Calibrate model score to realized forward return or win rate.
- Compare against SPY, equal-weight universe, and sector-neutral baselines.
- Replace the v13 raw Kelly formula with the correct fractional-loss Kelly formula or rename the current value as a relative conviction score.
- Use the full database for ranking only, then allocate only to selected stocks.
- Add drawdown, volatility, turnover, Sharpe, information ratio, hit rate, and max drawdown to the backtest output.

## References Used

- Kenneth French Data Library: factor and portfolio datasets for value, profitability, investment, momentum, and reversal research: https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html
- Bailey and Lopez de Prado, "The Deflated Sharpe Ratio": selection bias and backtest-overfitting controls: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551
- Kelly criterion reference material for binary and partial-loss Kelly formulas: https://en.wikipedia.org/wiki/Kelly_criterion

Run the repeatable local audit with:

```bash
python3 scripts/audit_model_stats.py --format markdown
```
