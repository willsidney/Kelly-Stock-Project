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
  - optimal stock scanner
  - stock search for model-loaded holdings
  - beta penalty and dynamic floors
  - downside-adjusted Kelly
  - short-interest penalty
  - sector concentration penalty
  - earnings proximity multiplier
  - Monte Carlo projection
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
- `data/stocks.json` - shared stock database seed, prepared for Yahoo Finance-derived inputs.
- `.github/workflows/deploy-pages.yml` - GitHub Pages deployment workflow.
- `ROADMAP.md` - long-term plan for editable portfolios, candidate scoring, and market scanning.

## Database And Scanner

The app now includes:

- `Database` - add or update model stock records, export the database, import a saved JSON database, or reset to the original model stocks.
- `Scanner` - ranks every stock in the saved database using the active model settings.
- `Stock Search` - looks up stocks already loaded into the saved database.

GitHub Pages can run the model and save data in the browser, but it cannot safely hold private API keys. Yahoo Finance is the chosen primary source for analyst-style data and stock prices. The next step is a scheduled updater or lightweight backend that reads Yahoo Finance data and writes trusted model inputs into `data/stocks.json`.

## Privacy Note

The uploaded PDFs, Word files, extracted text, project notes, and scratch files are ignored by Git because they may contain personal project context. Only the app source and GitHub Pages viewer are intended for publishing.

## Disclaimer

Educational/modeling purposes only. Not financial advice.
