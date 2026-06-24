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

New tickers are only written to `public/data/stocks.json` after Yahoo returns model-ready data: current price, beta, analyst count, analyst rating mix, Yahoo source, and update timestamp. Once a ticker is in `public/data/stocks.json`, every scheduled Yahoo refresh updates it with the rest of the database.

## Large Database Mode

The app is designed to support a larger Yahoo-backed stock universe. The browser tables use row limits such as top 50, top 100, top 250, top 500, or all rows, so a 1000-stock database can still be searched and ranked without rendering everything at once on a phone.

To build the universe:

1. Open GitHub Actions.
2. Choose `Expand Yahoo Stock Universe`.
3. Run it with `target_size` set to `1000` and `batch_size` around `100`.
4. Repeat the workflow until the database reaches the target size.

The expansion workflow discovers US-listed common stocks, filters out ETFs/warrants/units, ranks candidates by Yahoo market cap and liquidity, then enriches the next batch with model-ready Yahoo data before saving them into `public/data/stocks.json`.

The right target structure is:

- `public/data/stocks.json` - permanent database of model-ready stocks.
- `public/data/scan-results.json` - latest broad market scan shortlist.
- `Scanner` - ranks the permanent database with filters and model score.
- `Yahoo Scan` - reviews new scan candidates before saving them into the database.

For large databases, individual-stock Monte Carlo is disabled in the main app once the universe becomes too large for a phone browser. The core model ranking still runs across the full database, and the portfolio chart uses a top-ranked shortlist.

## Privacy Note

The uploaded PDFs, Word files, extracted text, project notes, and scratch files are ignored by Git because they may contain personal project context. Only the app source and GitHub Pages viewer are intended for publishing.

## Disclaimer

Educational/modeling purposes only. Not financial advice.
