# Kelly Portfolio Model

Interactive Kelly Criterion portfolio model for a EUR 250 Trading 212 portfolio.

## Current Model

- Version: v13
- Default budget: EUR 250
- Kelly fraction: Half Kelly by default
- Holdings: Ryanair, Nvidia, Adidas, ASML, Broadcom, Cloudflare, Palantir, Novo Nordisk, IREN, Visa
- Model features:
  - blended win probability
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
- `.github/workflows/deploy-pages.yml` - GitHub Pages deployment workflow.
- `ROADMAP.md` - long-term plan for editable portfolios, candidate scoring, and market scanning.

## Stock Search

The app includes a Stock Search tab for looking up stocks already loaded into the model. The long-term candidate workflow should accept a ticker, collect/update the required model inputs behind the scenes, then show the model result without asking the user to manually enter upside, downside, beta, short interest, or analyst data.

## Privacy Note

The uploaded PDFs, Word files, extracted text, project notes, and scratch files are ignored by Git because they may contain personal project context. Only the app source and GitHub Pages viewer are intended for publishing.

## Disclaimer

Educational/modeling purposes only. Not financial advice.
