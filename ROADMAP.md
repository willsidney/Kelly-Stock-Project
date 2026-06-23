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

- Move stock data out of hardcoded component code into structured JSON/state.
- Add stock add/edit/remove screens.
- Add validation for analyst percentages, upside, drawdown, beta, short interest, earnings proximity, YTD performance, FX exposure, and sector.
- Add import/export so the portfolio can be backed up as JSON or CSV.

## Phase 3: Candidate Scoring

- Add a manual Candidate Lab for testing one stock at a time. **Done**
- Score each candidate through the same blended win-probability and Kelly pipeline. **Done for manual entry**
- Rank candidates against the current portfolio.
- Show why a candidate wins or loses: blended p, raw Kelly, adjusted Kelly, diversification, sector overlap, beta, drawdown, and short interest. **Done for manual entry**
- Add a candidate-watchlist table.
- Allow saved JSON candidates to be imported back into the app.

## Phase 4: Market Scan

- Add a repeatable workflow for collecting current analyst inputs.
- Start with user-provided candidate lists and manual data entry.
- Later add API/source integrations if a suitable data source is chosen.
- Keep source attribution visible for each input.

## Phase 5: Rebalancing

- Add target-vs-current allocation entry.
- Show drift against the target weights.
- Highlight rebalance actions only when drift exceeds the configured threshold.

## Important Constraint

Automated market data and analyst ratings require reliable data sources. The app should not silently invent or stale-cache inputs; it should show date/source for every update.
