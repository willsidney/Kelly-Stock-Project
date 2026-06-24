# Product Roadmap

## Goal

Turn the current Kelly Portfolio model into an accessible stock-selection system where the user can:

- enter and edit their own stocks
- refresh model inputs over time
- compare candidate stocks
- scan the market for stocks that score well
- publish/use the app from phone and desktop

## Phase 1: Accessible App

- Publish the current v13 model through GitHub Pages.
- Keep private handoff files and scratch files out of the public repo.
- Preserve the current 10-stock model exactly while deployment is stabilized.

## Phase 2: Editable Portfolio

- Move stock data out of hardcoded component code into structured JSON/state. **Done**
- Add stock add/edit/remove screens. **Add/update done; remove pending**
- Add validation for analyst percentages, upside, drawdown, beta, short interest, earnings proximity, YTD performance, FX exposure, and sector. **Basic normalization done; stricter validation pending**
- Add import/export so the portfolio can be backed up as JSON or CSV. **JSON done; CSV pending**

## Phase 3: Candidate Scoring

- Add Stock Search for stocks already loaded into the model. **Done**
- Add optimal scanner over the saved stock database. **Done**
- Add scanner filters and a model score column so the strongest candidates can be surfaced quickly. **Done**
- Add row-limited searchable tables so a larger stock universe remains usable on mobile. **Done**
- Add fundamental quality and valuation research scores before feeding them into allocation. **Research display done; allocation integration pending**
- Add a data-backed candidate engine where the user enters a ticker and the system gathers/upserts the required model inputs behind the scenes. **Done through Yahoo updater**
- Score each candidate through the same blended win-probability and Kelly pipeline. **Done**
- Rank candidates against the current portfolio. **Done for saved database**
- Show why a candidate wins or loses through user-facing model results, without exposing raw assumption entry as the main workflow.
- Add a candidate-watchlist table. **Yahoo Scan results done; persistent watchlist pending**
- Add an admin/import path for updating model inputs from a trusted data file or data source.

## Phase 4: Market Scan

- Add a repeatable workflow for collecting current analyst inputs.
- Start with user-provided candidate lists and database import/export. **Done**
- Use Yahoo Finance as the primary analyst-data source. **Chosen**
- Add a Yahoo Finance updater that writes refreshed prices and model inputs into `public/data/stocks.json`. **Done**
- Extend the Yahoo updater to capture valuation, profitability, growth, cash-flow, and balance-sheet metrics. **Done**
- Add a scan-to-database save path so scan winners become permanent Yahoo-refreshed database stocks. **Done**
- Split Yahoo refreshes into full data refreshes and faster price-only refreshes for larger databases. **Done**
- Add a 1000-stock universe expansion workflow that grows the database in model-ready Yahoo batches. **Done; index-first using S&P 500, Nasdaq 100, and Dow 30**
- Rotate deep Yahoo refreshes across the database while updating prices multiple times daily. **Done**
- Prefer a scheduled updater or lightweight backend over direct browser API calls, because GitHub Pages cannot safely store private API keys.
- Keep source attribution visible for each input.

## Phase 5: Rebalancing

- Add a Create Model section where the user selects database stocks and the app generates portfolio allocations from the active model settings. **Done**
- Add target-vs-current allocation entry.
- Show drift against the target weights.
- Highlight rebalance actions only when drift exceeds the configured threshold.

## Important Constraint

Automated market data and analyst ratings require reliable data sources. The app should not silently invent or stale-cache inputs; it should show date/source for every update.
