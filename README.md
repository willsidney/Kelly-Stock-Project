# Kelly Portfolio Model

Interactive Kelly Criterion portfolio model for a EUR 250 Trading 212 portfolio.

## Current Model

- Version: v13
- Default budget: EUR 250
- Kelly fraction: Half Kelly by default
- Holdings: Ryanair, Nvidia, Adidas, ASML, Broadcom, Cloudflare, Palantir, Novo Nordisk, IREN, Visa
- Model features:
  - blended win probability
  - browser-saved stock database
  - add/update stock records
  - JSON import/export
  - filterable optimal stock scanner with model score
  - separate fundamental quality and valuation scores
  - custom model builder from database stocks
  - stock search for model-loaded holdings
  - beta penalty and dynamic floors
  - downside-adjusted Kelly
  - short-interest penalty
  - sector concentration penalty
  - earnings proximity multiplier
  - on-demand Monte Carlo projection
  - EUR/USD FX overlay
  - 20% hard cap per position

## View On GitHub Pages

This repo includes a GitHub Actions workflow that builds the React app and deploys it to GitHub Pages.

After this repo is on GitHub:

1. Open the repo settings.
2. Go to Pages.
3. Set the source to `GitHub Actions`.
4. Push/upload the files from this repo.
5. Open the published Pages URL on your phone once the action succeeds.

## Run Locally

Install dependencies, then run the development server:

```bash
npm install
npm run dev
```

## Files

- `src/App.tsx` - current React model source.
- `public/data/stocks.json` - published stock database seed, prepared for Yahoo Finance-derived inputs.
- `.github/workflows/deploy-pages.yml` - GitHub Pages deployment workflow.
- `ROADMAP.md` - long-term plan for editable portfolios, candidate scoring, and market scanning.

## Database And Scanner

The app now includes:

- `Database` - add or update model stock records, export the database, import a saved JSON database, or reset to the original model stocks.
- `Scanner` - ranks every stock in the saved database using the active model settings, with filters for score, win probability, upside, drawdown, sector, and search.
- `Yahoo Scan` - shows the latest broad Yahoo Finance scan. `Preview` tests a scan result in the browser model only; `Save Picks` writes selected scan stocks into the permanent Yahoo database.
- `Fundamentals` - compares quality and valuation metrics from Yahoo Finance without changing the allocation model.
- `Create Model` - select stocks from the database and generate a fresh allocation table using the same Kelly model settings.
- `Stock Search` - looks up stocks already loaded into the saved database.

GitHub Pages can run the model and save data in the browser, but it cannot safely hold private API keys. Yahoo Finance is the chosen primary source for analyst-style data and stock prices. The updater reads Yahoo Finance data and writes trusted model inputs into `public/data/stocks.json`.

The app keeps the first page load light by running the v13 Kelly allocation model immediately. Monte Carlo is separate: it is an on-demand projection layer and does not change model score, win probability, target weight, or euro allocation.

## Yahoo Finance Updates

The repo includes a GitHub Actions workflow named `Update Yahoo Finance Data`.

It refreshes `public/data/stocks.json` from Yahoo Finance on weekdays and can also be run manually from the Actions tab. It updates best-effort fields including price, currency, analyst recommendation mix, target-price upside, beta, short interest, earnings distance, YTD performance, one-year drawdown, valuation multiples, margins, growth, cash flow, and balance-sheet metrics when Yahoo returns those fields.

Each successful update also writes a compact daily point-in-time snapshot in `public/data/history/`. Each snapshot stores the stock price, Yahoo model inputs, and frozen v13/v14 model outputs for each stock, so future backtests can compare what the model expected on that day with what actually happened afterward. If the updater runs multiple times in the same day, the latest run replaces that day's snapshot. This keeps the evidence trail useful for backtesting without making the repo grow too quickly.

For a large database, the updater has two modes:

- `full` - updates analyst data, targets, fundamentals, risk fields, and price. This is slower and is best for adding stocks or doing a daily deep refresh.
- `prices` - updates current Yahoo prices quickly and recalculates target-price upside when a stored Yahoo target is available.

The scheduled workflow runs one rotating full refresh early on weekdays and several faster price refreshes during the day. This is the intended path for a larger stock universe, because analyst and fundamental data do not need to be re-pulled as often as price.

To add new stocks:

1. Open GitHub Actions.
2. Choose `Update Yahoo Finance Data`.
3. Click `Run workflow`.
4. Enter ticker codes in the `tickers` field, for example `MSFT, AAPL, TEAM`.
5. Run the workflow. It adds missing tickers to `public/data/stocks.json`, refreshes Yahoo data, commits the database, and redeploys the site.

In the workflow log, the `Refresh Yahoo data` step prints `Requested tickers` and `database tickers`. If the new ticker is not in `database tickers`, the workflow did not receive the ticker input.

To save stocks from the broad market scan:

1. Run `Scan Yahoo Stocks`.
2. Open the website's `Yahoo Scan` tab to review the ranked results.
3. Choose `Save Picks` in the app, or open GitHub Actions and choose `Save Scan Picks To Database`.
4. Leave `tickers` blank to save the top scan results, or enter exact tickers such as `MSFT, AAPL, TEAM`.

New tickers are written to `public/data/stocks.json` even when Yahoo has not returned every model input yet. Incomplete stocks are marked as `tracked-incomplete` with `dataIssues`, then future scheduled Yahoo refreshes keep trying to improve them.

## Large Database Mode

The app is designed to support a larger Yahoo-backed stock universe. The browser tables use row limits such as top 50, top 100, top 250, top 500, or all rows, so a 1000-stock database can still be searched and ranked without rendering everything at once on a phone.

To build the universe:

1. Open GitHub Actions.
2. Choose `Expand Yahoo Stock Universe`.
3. Run it with `target_size` set to `1000` and `batch_size` around `100`.
4. Repeat the workflow until the database reaches the target size.

The expansion workflow seeds from S&P 500, Nasdaq 100, and Dow 30 constituent lists first. After that, it discovers additional US-listed common stocks, filters out ETFs/warrants/units, ranks candidates by Yahoo market cap and liquidity, then enriches the next batch before saving them into `public/data/stocks.json`. Stocks do not need to have every model field on day one; missing fields are tracked and refreshed over time.

If a bad expansion batch gets into the database, run `Clean Yahoo Stock Universe`. It removes only auto-expanded, non-index stocks that do not have market-cap proof above the configured threshold. Original/manual stocks and major-index seeds are left alone.

The right target structure is:

- `public/data/stocks.json` - permanent database of tracked stocks, including incomplete names that Yahoo can improve over time.
- `public/data/scan-results.json` - latest broad market scan shortlist.
- `Scanner` - ranks the permanent database with filters and model score.
- `Yahoo Scan` - reviews new scan candidates before saving them into the database.

For large databases, individual-stock Monte Carlo is disabled in the main app once the universe becomes too large for a phone browser. The core model ranking still runs across the full database, and the portfolio chart uses a top-ranked shortlist.

## Backtesting

The repo includes a manual GitHub Actions workflow named `Backtest Kelly Model`.

The backtester uses only saved files in `public/data/history/`, then compares model-selected top-N portfolios against the equal-weight tracked universe and the saved benchmark, currently `SPY`. It prefers the frozen model outputs saved inside each snapshot, so later formula changes do not rewrite old expectations. This avoids the main statistical error of testing today's Yahoo analyst targets and fundamentals against returns that happened before those inputs existed.

Early backtest results will be limited until enough dated snapshots have accumulated. The first useful checks start after at least two snapshots; weekly and monthly tests become more meaningful after several weeks or months.

Local commands:

```bash
python3 scripts/update_yahoo_data.py --snapshot-only --no-benchmark-fetch
python3 scripts/backtest_snapshots.py --schedule weekly --top 10,20 --output public/data/backtest-results.json
python3 scripts/audit_model_stats.py --format markdown
```

## FMP Historical Data Probe

For deeper historical backtests, the repo includes a workflow named `Probe FMP Access`. It checks which Financial Modeling Prep endpoints your account can access and writes `public/data/fmp-access-report.json`.

Set up once:

1. Open GitHub repo settings.
2. Go to `Secrets and variables` > `Actions`.
3. Add a repository secret named `FMP_API_KEY`.
4. Paste your FMP key there. Do not commit or share the key.

Then run `Probe FMP Access` from the Actions tab. The default test tickers are `AAPL,MSFT,NVDA,JPM,CELH`. The report tells us whether the account has dated analyst ratings, target-price consensus, historical prices, market caps, fundamentals, balance-sheet data, cash-flow data, analyst estimates, and current quote/profile fields.

The workflow has an `endpoint_set` input:

- `all` - probes every known useful endpoint family.
- `analyst` - probes analyst grades, ratings, target prices, and estimate endpoints.
- `fundamentals` - probes ratios, key metrics, financial statements, growth, enterprise value, and financial scores.
- `core` - probes prices, market cap, quote, and profile fields.

If FMP rate-limits the run, use fewer tickers first or set `endpoint_set` to `analyst` or `fundamentals`.

For historical backtesting, the most important result is a real `Historical series`, not just a single dated current snapshot. Current target-price consensus helps live scoring, but genuine historical validation needs historical analyst ratings, historical price targets, historical prices, and preferably historical fundamentals. If an endpoint shows `Accessible` but `Historical series` is `no`, it can support today's model but not a clean historical backtest of that signal.

Local version:

```bash
export FMP_API_KEY="your_key_here"
python3 scripts/probe_fmp_access.py --tickers AAPL,MSFT,NVDA,JPM,CELH --endpoint-set all --output public/data/fmp-access-report.json
```

## FMP Historical Backtest

The repo also includes a workflow named `FMP Historical Backtest`.

This workflow fetches FMP historical analyst grades and dividend-adjusted prices, stores them in `public/data/fmp-history/`, and writes `public/data/fmp-backtest-results.json`.

The free FMP access tested so far supports dated analyst grades and dated prices, but not dated price-target consensus or dated fundamentals. For that reason, this backtest is a genuine historical test of a separate `fmp_ratings_price_v1` model: historical analyst grades plus price momentum, drawdown, and volatility. It is not a full historical test of the current Yahoo target-upside model.

If `tickers` is left blank, the workflow selects the largest current database stocks by market cap, up to `max_tickers`. It fetches the benchmark first, usually `SPY`, uses Yahoo's historical chart endpoint for prices, and uses FMP mainly for historical analyst grades. This reduces FMP API calls and makes the benchmark less likely to go missing. It also preserves older good cached rows when a fresh provider response is empty, which prevents a partial free-account run from overwriting usable history with blank files. The workflow fails by default if the benchmark is missing or fewer than 10 usable stock histories are available, because tiny backtests can look convincing while still being mostly noise.

The workflow has two model variants:

- `price_only` - default while FMP analyst-grade coverage is sparse. It tests price momentum, trend, drawdown, and volatility across every loaded price history.
- `analyst_price` - requires dated FMP analyst grades and therefore may only work once enough tickers have grade history.

Run it first with a small ticker set such as:

```text
AAPL,MSFT,CELH,SPY
```

Then expand carefully. Free API limits may make a full database pull too slow or unavailable.

## Privacy Note

The uploaded PDFs, Word files, extracted text, project notes, and scratch files are ignored by Git because they may contain personal project context. Only the app source and GitHub Pages viewer are intended for publishing.

## Disclaimer

Educational/modeling purposes only. Not financial advice.
