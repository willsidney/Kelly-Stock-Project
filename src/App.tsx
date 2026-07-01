import { useState, useEffect, useCallback, useMemo } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const MARKET_VOL    = 0.18;
const TRADING_DAYS  = 252;
const MC_SIMS       = 8000;
const PORT_SIMS     = 400;
const PORT_STEPS    = 52;
const MC_STOCK_LIMIT = 150;
const PORT_SIM_STOCK_LIMIT = 80;
const T_DF          = 5;
const JUMP_LAMBDA   = 4;
const JUMP_MU       = -0.02;
const JUMP_SIGMA    = 0.18;
const P_LOW_HIGH    = 0.02;
const P_HIGH_LOW    = 0.05;
const VOL_HIGH_MULT = 1.80;
const FX_MU         = 0.0015;
const FX_SIGMA      = 0.0820;

// Blended win probability weights
const W_ANALYST  = 0.40;  // Analyst consensus — forward-looking, professional
const W_MOMENTUM = 0.20;  // YTD price momentum — market expectation already priced in
const W_RR       = 0.20;  // Reward/risk ratio — pure mathematical upside/drawdown
const W_SI       = 0.10;  // Short interest — tail risk / smart money bearish signal
const W_EP       = 0.10;  // Earnings proximity — binary event uncertainty

const LAST_REVIEW = "May 25 2026";
const NEXT_REVIEW = "Nov 2026";
const STORAGE_KEY = "kelly-stock-database-v1";
const DATA_URL = "./data/stocks.json";
const SCAN_URL = "./data/scan-results.json";
const PAPER_URL = "./data/paper-portfolio.json";
const FMP_BACKTEST_URL = "./data/fmp-backtest-results.json";
const HISTORY_INDEX_URL = "./data/history/index.json";
const ACTION_URL = "https://github.com/willsidney/Kelly-Stock-Project/actions/workflows";
const RUN_SCAN_URL = `${ACTION_URL}/scan-yahoo-stocks.yml`;
const SAVE_SCAN_URL = `${ACTION_URL}/save-scan-picks.yml`;
const MODEL_V13 = "v13";
const MODEL_V14 = "v14";
const MODEL_FORMULA_VERSIONS = { [MODEL_V13]:"v13.0.0", [MODEL_V14]:"v14.0.0" };
const MODEL_OPTIONS = [
  { value: MODEL_V13, label: "v13 Current", short: "v13", pill: "Blended Kelly" },
  { value: MODEL_V14, label: "v14 Optimized", short: "v14", pill: "Optimized Risk" },
];
const MODEL_LABELS = Object.fromEntries(MODEL_OPTIONS.map(m=>[m.value,m]));
const ROW_LIMITS = ["50","100","250","500","all"];
const rowLimitValue = (value,total)=>value==="all"?total:(Number(value)||100);

// ─────────────────────────────────────────────────────────────────────────────
// STOCK DATA — May 2026 + Novo Nordisk replaces IonQ
// ─────────────────────────────────────────────────────────────────────────────
const BASE_STOCKS = [
  { name:"Ryanair",      ticker:"RYAAY", sector:"travel",      emoji:"✈️",  color:"#3b82f6", strongBuy:57, buy:7,  hold:36, sell:0,  upside:0.26, drawdown:0.28, shortInt:0.007, beta:1.2,  fxExposed:false, earningsDays:180, ytd:-0.22, analystCount:20, analystSrc:"investing.com (RYA)" },
  { name:"Nvidia",       ticker:"NVDA",  sector:"ai",          emoji:"🖥️",  color:"#84cc16", strongBuy:70, buy:27, hold:3,  sell:0,  upside:0.37, drawdown:0.40, shortInt:0.012, beta:1.7,  fxExposed:true,  earningsDays:4,   ytd:+0.67, analystCount:62, analystSrc:"stockanalysis.com" },
  { name:"Adidas",       ticker:"ADDYY", sector:"consumer",    emoji:"👟",  color:"#94a3b8", strongBuy:30, buy:40, hold:20, sell:10, upside:0.44, drawdown:0.22, shortInt:0.020, beta:0.9,  fxExposed:false, earningsDays:90,  ytd:+0.10, analystCount:28, analystSrc:"investing.com (ADS.DE)" },
  { name:"ASML",         ticker:"ASML",  sector:"semi",        emoji:"🔬",  color:"#38bdf8", strongBuy:60, buy:30, hold:10, sell:0,  upside:0.04, drawdown:0.25, shortInt:0.008, beta:1.1,  fxExposed:false, earningsDays:60,  ytd:-0.12, analystCount:44, analystSrc:"stockanalysis.com" },
  { name:"Broadcom",     ticker:"AVGO",  sector:"ai",          emoji:"⚡",  color:"#f87171", strongBuy:42, buy:50, hold:8,  sell:0,  upside:0.16, drawdown:0.25, shortInt:0.009, beta:1.2,  fxExposed:true,  earningsDays:120, ytd:+0.25, analystCount:47, analystSrc:"stockanalysis.com" },
  { name:"Cloudflare",   ticker:"NET",   sector:"ai",          emoji:"🛡️",  color:"#fb923c", strongBuy:55, buy:30, hold:15, sell:0,  upside:0.08, drawdown:0.35, shortInt:0.025, beta:1.6,  fxExposed:true,  earningsDays:90,  ytd:+0.15, analystCount:34, analystSrc:"stockanalysis.com" },
  { name:"Palantir",     ticker:"PLTR",  sector:"ai",          emoji:"🔭",  color:"#e879f9", strongBuy:42, buy:16, hold:37, sell:5,  upside:0.34, drawdown:0.42, shortInt:0.022, beta:2.0,  fxExposed:true,  earningsDays:90,  ytd:-0.23, analystCount:31, analystSrc:"stockanalysis.com" },
  { name:"Novo Nordisk", ticker:"NVO",   sector:"healthcare",  emoji:"💊",  color:"#22d3ee", strongBuy:55, buy:30, hold:15, sell:0,  upside:0.38, drawdown:0.30, shortInt:0.012, beta:0.7,  fxExposed:true,  earningsDays:90,  ytd:-0.35, analystCount:32, analystSrc:"stockanalysis.com" },
  { name:"IREN",         ticker:"IREN",  sector:"ai",          emoji:"🏭",  color:"#34d399", strongBuy:50, buy:30, hold:20, sell:0,  upside:0.32, drawdown:0.65, shortInt:0.178, beta:4.3,  fxExposed:true,  earningsDays:90,  ytd:-0.40, analystCount:14, analystSrc:"stockanalysis.com" },
  { name:"Visa",         ticker:"V",     sector:"payments",    emoji:"💳",  color:"#818cf8", strongBuy:74, buy:18, hold:8,  sell:0,  upside:0.27, drawdown:0.18, shortInt:0.012, beta:0.78, fxExposed:true,  earningsDays:60,  ytd:+0.12, analystCount:22, analystSrc:"stockanalysis.com" },
];

const SECTOR_LABELS  = { ai:"AI/Tech", travel:"Travel", consumer:"Consumer", semi:"Semiconductors", quantum:"Quantum", payments:"Payments", healthcare:"Healthcare", software:"Software", industrial:"Industrial", financial:"Financial", energy:"Energy", other:"Other" };
const EARNINGS_DATES = { RYAAY:"Nov 2026", NVDA:"Aug 26", ADDYY:"Aug 2026", ASML:"Jul 2026", AVGO:"Sep 2026", NET:"Aug 2026", PLTR:"Aug 2026", NVO:"Aug 2026", IREN:"Aug 2026", V:"Jul 2026" };
const SECTOR_OPTIONS = Object.entries(SECTOR_LABELS);
const STOCK_COLORS = ["#3b82f6","#84cc16","#94a3b8","#38bdf8","#f87171","#fb923c","#e879f9","#22d3ee","#34d399","#818cf8","#fbbf24","#a78bfa"];

// ─────────────────────────────────────────────────────────────────────────────
// BLENDED WIN PROBABILITY — 5 components
// ─────────────────────────────────────────────────────────────────────────────
function pAnalyst(sb, buy, hold, sell) {
  return (sb * 1.0 + buy * 0.75 + hold * 0.5 + sell * 0.15) / 100;
}

function pMomentum(ytd) {
  // Logistic: beaten-down stocks have higher forward win prob (mean reversion)
  // ytd=-0.50 → 0.75,  ytd=0 → 0.55,  ytd=+0.50 → 0.38
  return 0.55 - 0.34 * Math.tanh(ytd * 2.5);
}

function pRewardRisk(upside, drawdown) {
  // Ratio = upside / drawdown: higher ratio = better entry
  const ratio = upside / Math.max(drawdown, 0.01);
  return 0.35 + 0.45 * (1 - Math.exp(-ratio * 0.8));
}

function pShortInt(si) {
  // High short = institutional bearish signal
  // si=0 → 0.65,  si=0.15 → 0.515,  si=0.30 → 0.40
  return 0.65 - 0.50 * Math.min(si, 0.30) / 0.30;
}

function pEarnings(days) {
  if (days <= 7)  return 0.50;
  if (days <= 30) return 0.51;
  if (days <= 60) return 0.53;
  if (days <= 90) return 0.54;
  return 0.55;
}

function blendedP(s) {
  const pa  = pAnalyst(s.strongBuy, s.buy, s.hold, s.sell);
  const pm  = pMomentum(s.ytd);
  const prr = pRewardRisk(s.upside, s.drawdown);
  const psi = pShortInt(s.shortInt);
  const pep = pEarnings(s.earningsDays);
  const blend = W_ANALYST*pa + W_MOMENTUM*pm + W_RR*prr + W_SI*psi + W_EP*pep;
  return { pa, pm, prr, psi, pep, blend };
}

function normalizeStock(raw, idx=0){
  const n = (v,f=0) => Number.isFinite(Number(v)) ? Number(v) : f;
  const opt = v => v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
  const ticker = String(raw.ticker || `STK${idx+1}`).trim().toUpperCase();
  return {
    name: String(raw.name || ticker).trim(),
    ticker,
    sector: SECTOR_LABELS[raw.sector] ? raw.sector : "other",
    emoji: raw.emoji || "◆",
    color: raw.color || STOCK_COLORS[idx%STOCK_COLORS.length],
    strongBuy: Math.max(0,n(raw.strongBuy,0)),
    buy: Math.max(0,n(raw.buy,0)),
    hold: Math.max(0,n(raw.hold,100)),
    sell: Math.max(0,n(raw.sell,0)),
    upside: Math.max(0,n(raw.upside,0.15)),
    drawdown: Math.max(0.01,n(raw.drawdown,0.30)),
    shortInt: Math.max(0,n(raw.shortInt,0.02)),
    beta: Math.max(0.1,n(raw.beta,1)),
    currentPrice: raw.currentPrice === null || raw.currentPrice === undefined ? null : Math.max(0,n(raw.currentPrice,0)),
    priceCurrency: raw.priceCurrency || (raw.fxExposed ? "USD" : "EUR"),
    fxExposed: Boolean(raw.fxExposed),
    earningsDays: Math.max(0,n(raw.earningsDays,90)),
    ytd: n(raw.ytd,0),
    analystCount: Math.max(0,n(raw.analystCount,0)),
    analystSrc: raw.analystSrc || "database",
    dataProvider: raw.dataProvider || "Yahoo Finance",
    lastUpdated: raw.lastUpdated || null,
    priceSource: raw.priceSource || null,
    priceTime: raw.priceTime || null,
    marketCap: opt(raw.marketCap),
    forwardPE: opt(raw.forwardPE),
    trailingPE: opt(raw.trailingPE),
    pegRatio: opt(raw.pegRatio),
    priceToSales: opt(raw.priceToSales),
    priceToBook: opt(raw.priceToBook),
    enterpriseToEbitda: opt(raw.enterpriseToEbitda),
    revenueGrowth: opt(raw.revenueGrowth),
    earningsGrowth: opt(raw.earningsGrowth),
    grossMargins: opt(raw.grossMargins),
    operatingMargins: opt(raw.operatingMargins),
    profitMargins: opt(raw.profitMargins),
    returnOnEquity: opt(raw.returnOnEquity),
    returnOnAssets: opt(raw.returnOnAssets),
    freeCashflow: opt(raw.freeCashflow),
    operatingCashflow: opt(raw.operatingCashflow),
    totalDebt: opt(raw.totalDebt),
    totalCash: opt(raw.totalCash),
    debtToEquity: opt(raw.debtToEquity),
    currentRatio: opt(raw.currentRatio),
    quickRatio: opt(raw.quickRatio),
    freeCashflowYield: opt(raw.freeCashflowYield),
    operatingCashflowYield: opt(raw.operatingCashflowYield),
    cashDebtRatio: opt(raw.cashDebtRatio),
    sourceUrl: raw.sourceUrl || `https://finance.yahoo.com/quote/${ticker}`,
    modelReady: raw.modelReady !== undefined ? Boolean(raw.modelReady) : true,
    dataStatus: raw.dataStatus || "model-ready",
    dataIssues: Array.isArray(raw.dataIssues) ? raw.dataIssues : [],
  };
}

function loadStockDatabase(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return BASE_STOCKS;
    const parsed = JSON.parse(raw);
    if(!Array.isArray(parsed) || !parsed.length) return BASE_STOCKS;
    return parsed.map(normalizeStock);
  }catch{
    return BASE_STOCKS;
  }
}

function saveStockDatabase(stocks){
  localStorage.setItem(STORAGE_KEY,JSON.stringify(stocks,null,2));
}

function hasLocalStockDatabase(){
  try{return Boolean(localStorage.getItem(STORAGE_KEY));}catch{return false;}
}

function priceLabel(s){
  if(!s.currentPrice) return "—";
  const symbol = s.priceCurrency==="EUR" ? "€" : s.priceCurrency==="GBP" ? "£" : "$";
  return `${symbol}${Number(s.currentPrice).toFixed(2)}`;
}
const modelScore = s => Math.max(0,Number(s.adj)||0)*100;
const clamp01 = x => Math.max(0,Math.min(1,x));
const clampRange = (x,lo,hi) => Math.max(lo,Math.min(hi,x));
const isNum = v => Number.isFinite(Number(v));
const scoreHigher = (value, weak, strong) => isNum(value) ? clamp01((Number(value)-weak)/(strong-weak)) : null;
const scoreLower = (value, strong, weak) => isNum(value) && Number(value)>0 ? clamp01((weak-Number(value))/(weak-strong)) : null;
const avgScore = values => {
  const clean = values.filter(v=>v!==null&&v!==undefined&&Number.isFinite(Number(v)));
  return clean.length ? clean.reduce((s,v)=>s+Number(v),0)/clean.length : null;
};
const fmtScore = v => v===null||v===undefined ? "—" : Number(v).toFixed(0);
const fmtMultiple = v => v===null||v===undefined ? "—" : Number(v).toFixed(1)+"x";
const fmtPct = v => v===null||v===undefined ? "—" : (Number(v)*100).toFixed(0)+"%";
const debtRatio = v => !isNum(v) ? null : Number(v)>10 ? Number(v)/100 : Number(v);

function fundamentalScores(s){
  const qualityParts = [
    scoreHigher(s.grossMargins,0.25,0.70),
    scoreHigher(s.operatingMargins,0.08,0.35),
    scoreHigher(s.profitMargins,0.04,0.25),
    scoreHigher(s.returnOnEquity,0.08,0.35),
    scoreHigher(s.returnOnAssets,0.03,0.15),
    scoreHigher(s.revenueGrowth,0.00,0.30),
    scoreHigher(s.earningsGrowth,0.00,0.40),
    scoreHigher(s.freeCashflowYield,0.00,0.08),
    scoreLower(debtRatio(s.debtToEquity),0.25,2.50),
    scoreHigher(s.currentRatio,1.00,2.50),
    scoreHigher(s.cashDebtRatio,0.25,2.00),
  ];
  const valuationParts = [
    scoreLower(s.forwardPE,12,45),
    scoreLower(s.trailingPE,12,55),
    scoreLower(s.enterpriseToEbitda,8,35),
    scoreLower(s.priceToSales,2,18),
    scoreLower(s.priceToBook,1.5,12),
    scoreLower(s.pegRatio,0.8,3.0),
    scoreHigher(s.freeCashflowYield,0.00,0.08),
    isNum(s.revenueGrowth)&&isNum(s.priceToSales)&&s.priceToSales>0 ? scoreHigher(Math.max(0,s.revenueGrowth)/s.priceToSales,0.01,0.08) : null,
  ];
  const quality = avgScore(qualityParts);
  const valuation = avgScore(valuationParts);
  return {
    quality: quality===null ? null : quality*100,
    valuation: valuation===null ? null : valuation*100,
    qualityCount: qualityParts.filter(v=>v!==null).length,
    valuationCount: valuationParts.filter(v=>v!==null).length,
  };
}

function optimizedProfile(s,flags,eurNow,eurFcast,bp){
  const fs = fundamentalScores(s);
  const pct = (value,fallback=0.50) => value===null||value===undefined ? fallback : clamp01(Number(value)/100);
  const quality = pct(fs.quality);
  const valuation = pct(fs.valuation);
  const growth = avgScore([
    scoreHigher(s.revenueGrowth,-0.05,0.35),
    scoreHigher(s.earningsGrowth,-0.10,0.45),
    scoreHigher(s.operatingMargins,0.05,0.30),
    scoreHigher(s.freeCashflowYield,-0.02,0.08),
  ]) ?? 0.50;
  const balance = avgScore([
    scoreLower(debtRatio(s.debtToEquity),0.25,2.50),
    scoreHigher(s.currentRatio,0.80,2.20),
    scoreHigher(s.cashDebtRatio,0.20,1.50),
  ]) ?? 0.50;
  const analyst = bp.pa;
  const analystCoverage = clamp01((Number(s.analystCount)||0)/25);
  const fundamentalCoverage = clamp01((fs.qualityCount+fs.valuationCount)/14);
  const dataConfidence = clampRange(0.35 + analystCoverage*0.35 + fundamentalCoverage*0.30,0.25,1);
  const betaRisk = flags.beta ? clamp01((s.beta-0.80)/2.70) : 0.35;
  const drawdownRisk = flags.drawdown ? clamp01((s.drawdown-0.15)/0.55) : 0.35;
  const shortRisk = flags.shortInt ? clamp01(s.shortInt/0.20) : 0.25;
  const balanceRisk = 1-balance;
  const riskScore = avgScore([betaRisk,drawdownRisk,shortRisk,balanceRisk]) ?? 0.40;
  const fxAdj = flags.fx&&s.fxExposed ? (eurFcast-eurNow)/eurNow : 0;
  const fxAdjUpside = Math.max(0,s.upside*(1+fxAdj));
  const upsideScore = clamp01(fxAdjUpside/0.60);
  const optimizedP = clampRange(
    0.38
      + analyst*0.18
      + quality*0.16
      + valuation*0.13
      + growth*0.12
      + bp.prr*0.11
      + balance*0.07
      + upsideScore*0.07
      - riskScore*0.14
      - (1-dataConfidence)*0.08,
    0.05,
    0.90
  );
  const returnTilt = clampRange(0.72 + quality*0.22 + valuation*0.16 + growth*0.16 + balance*0.12 - riskScore*0.18,0.40,1.45);
  const expectedReturn = clampRange(fxAdjUpside*returnTilt*(0.75+dataConfidence*0.25),0.005,2.50);
  const expectedLoss = clampRange(s.drawdown*(0.70+riskScore*0.55),0.01,0.95);
  return {fs,quality,valuation,growth,balance,analyst,dataConfidence,riskScore,optimizedP,expectedReturn,expectedLoss,fxAdj,fxAdjUpside};
}

// ─────────────────────────────────────────────────────────────────────────────
// CORRELATION MATRICES
// ─────────────────────────────────────────────────────────────────────────────
const CORR_BULL = [
  [1.00,0.22,0.18,0.25,0.22,0.20,0.18,0.12,0.18,0.20],
  [0.22,1.00,0.20,0.58,0.72,0.68,0.62,0.15,0.65,0.28],
  [0.18,0.20,1.00,0.22,0.18,0.18,0.15,0.12,0.15,0.30],
  [0.25,0.58,0.22,1.00,0.60,0.55,0.48,0.18,0.52,0.28],
  [0.22,0.72,0.18,0.60,1.00,0.68,0.62,0.15,0.65,0.28],
  [0.20,0.68,0.18,0.55,0.68,1.00,0.65,0.15,0.65,0.25],
  [0.18,0.62,0.15,0.48,0.62,0.65,1.00,0.15,0.62,0.22],
  [0.12,0.15,0.12,0.18,0.15,0.15,0.15,1.00,0.12,0.18], // NVO — low correlation, defensive
  [0.18,0.65,0.15,0.52,0.65,0.65,0.62,0.12,1.00,0.22],
  [0.20,0.28,0.30,0.28,0.28,0.25,0.22,0.18,0.22,1.00],
];
const CORR_BEAR = [
  [1.00,0.35,0.25,0.38,0.35,0.32,0.30,0.15,0.30,0.28],
  [0.35,1.00,0.25,0.70,0.85,0.82,0.78,0.18,0.80,0.35],
  [0.25,0.25,1.00,0.28,0.22,0.22,0.20,0.14,0.18,0.35],
  [0.38,0.70,0.28,1.00,0.72,0.68,0.60,0.22,0.65,0.35],
  [0.35,0.85,0.22,0.72,1.00,0.82,0.76,0.18,0.80,0.35],
  [0.32,0.82,0.22,0.68,0.82,1.00,0.78,0.18,0.80,0.30],
  [0.30,0.78,0.20,0.60,0.76,0.78,1.00,0.18,0.76,0.28],
  [0.15,0.18,0.14,0.22,0.18,0.18,0.18,1.00,0.15,0.20], // NVO bear — still defensive
  [0.30,0.80,0.18,0.65,0.80,0.80,0.76,0.15,1.00,0.28],
  [0.28,0.35,0.35,0.35,0.35,0.30,0.28,0.20,0.28,1.00],
];
const FX_CORR = [0.00,-0.20,0.00,0.00,-0.18,-0.22,-0.20,-0.15,-0.18,-0.12];

// ─────────────────────────────────────────────────────────────────────────────
// MATH CORE
// ─────────────────────────────────────────────────────────────────────────────
function cholesky(C) {
  const n = C.length;
  const L = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let s = 0; for (let k = 0; k < j; k++) s += L[i][k] * L[j][k];
    L[i][j] = i === j ? Math.sqrt(Math.max(0, C[i][i] - s))
                      : (L[j][j] > 1e-12 ? (C[i][j] - s) / L[j][j] : 0);
  }
  return L;
}
const CHOL_BULL = cholesky(CORR_BULL);
const CHOL_BEAR = cholesky(CORR_BEAR);
function baseIndex(ticker){ return BASE_STOCKS.findIndex(s=>s.ticker===ticker); }
function sectorCorr(a,b,bear){
  if(a.ticker===b.ticker) return 1;
  if(a.sector===b.sector) return bear ? 0.62 : 0.48;
  if((a.sector==="ai"||a.sector==="semi"||a.sector==="software")&&(b.sector==="ai"||b.sector==="semi"||b.sector==="software")) return bear ? 0.72 : 0.58;
  if(a.sector==="healthcare"||b.sector==="healthcare") return bear ? 0.18 : 0.14;
  return bear ? 0.32 : 0.22;
}
function buildChol(stocks,bear){
  if(stocks.length===BASE_STOCKS.length && stocks.every((s,i)=>s.ticker===BASE_STOCKS[i].ticker)) return bear ? CHOL_BEAR : CHOL_BULL;
  const C=stocks.map((a,i)=>stocks.map((b,j)=>{
    if(i===j) return 1;
    const ai=baseIndex(a.ticker),bi=baseIndex(b.ticker);
    if(ai>=0&&bi>=0) return bear ? CORR_BEAR[ai][bi] : CORR_BULL[ai][bi];
    return sectorCorr(a,b,bear);
  }));
  return cholesky(C);
}
function fxCorrFor(stock){
  const i=baseIndex(stock.ticker);
  return i>=0 ? FX_CORR[i] : (stock.fxExposed ? -0.16 : 0);
}

function makeRng(seed) {
  let s = seed >>> 0;
  const u = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; };
  const normal = () => { const u1=Math.max(1e-12,u()),u2=u(); return Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*u2); };
  const tDist  = (df) => { const z=normal(); let c=0; for(let i=0;i<df;i++){const x=normal();c+=x*x;} return(z/Math.sqrt(c/df))/Math.sqrt(df/(df-2)); };
  return { normal, tDist, u };
}
const momentumMu = (mu, ytd) =>
  ytd > 0.30 ? mu*0.80 : ytd > 0.15 ? mu*0.90 : ytd < -0.30 ? mu*1.10 : ytd < -0.15 ? mu*1.05 : mu;

// ─────────────────────────────────────────────────────────────────────────────
// MONTE CARLO — uses blended p for Kelly, GBM for paths
// ─────────────────────────────────────────────────────────────────────────────
function runMonteCarlo(stocks, seed, eurNow, eurFcast) {
  const n=stocks.length, dt=1/TRADING_DAYS, sqdt=Math.sqrt(dt);
  const rng=makeRng(seed);
  const sigmas=stocks.map(s=>s.beta*MARKET_VOL);
  const mus=stocks.map(s=>momentumMu(s.upside,s.ytd));
  const cholBull=buildChol(stocks,false), cholBear=buildChol(stocks,true);
  const fxCorrs=stocks.map(fxCorrFor);
  const fxDD=Math.log(eurFcast/eurNow)/TRADING_DAYS;
  const allR=stocks.map(()=>new Float64Array(MC_SIMS));
  for(let sim=0;sim<MC_SIMS;sim++){
    const logR=new Float64Array(n); let vr=0;
    for(let t=0;t<TRADING_DAYS;t++){
      if(vr===0&&rng.u()<P_LOW_HIGH) vr=1; else if(vr===1&&rng.u()<P_HIGH_LOW) vr=0;
      const vm=vr===1?VOL_HIGH_MULT:1.0, CH=vr===1?cholBear:cholBull;
      const z=Array.from({length:n+1},()=>rng.tDist(T_DF));
      const zC=new Float64Array(n);
      for(let i=0;i<n;i++) for(let j=0;j<=i;j++) zC[i]+=CH[i][j]*z[j];
      const fxStep=fxDD+FX_SIGMA*rng.normal()*sqdt;
      for(let i=0;i<n;i++){
        const sig=sigmas[i]*vm;
        let step=(mus[i]-0.5*sig*sig)*dt+sig*zC[i]*sqdt;
        if(rng.u()<JUMP_LAMBDA*dt) step+=JUMP_MU*dt+JUMP_SIGMA*rng.normal()*sqdt;
        if(stocks[i].fxExposed){step-=fxStep;step+=fxCorrs[i]*fxStep*0.3;}
        logR[i]+=step;
      }
    }
    for(let i=0;i<n;i++) allR[i][sim]=Math.exp(logR[i])-1;
  }
  return stocks.map((s,i)=>{
    const r=Array.from(allR[i]).sort((a,b)=>a-b);
    const wins=r.filter(x=>x>0), losses=r.filter(x=>x<=0);
    const pSim=wins.length/MC_SIMS;
    const avgWin=wins.length?wins.reduce((a,b)=>a+b,0)/wins.length:0;
    const avgLoss=losses.length?Math.abs(losses.reduce((a,b)=>a+b,0)/losses.length):0.001;
    const kellySim=(pSim*avgWin-(1-pSim)*avgLoss)/(avgWin+avgLoss);
    const bkts=new Float64Array(80);
    r.forEach(x=>{const bi=Math.floor((x+1.0)/0.05);if(bi>=0&&bi<80)bkts[bi]++;});
    for(let b=0;b<80;b++) bkts[b]/=MC_SIMS;
    return{ticker:s.ticker,pSim,avgWin,avgLoss,kellySim,sigma:s.beta*MARKET_VOL,adjMu:mus[i],
      p1:r[Math.floor(MC_SIMS*0.01)],p5:r[Math.floor(MC_SIMS*0.05)],p25:r[Math.floor(MC_SIMS*0.25)],
      p50:r[Math.floor(MC_SIMS*0.50)],p75:r[Math.floor(MC_SIMS*0.75)],p95:r[Math.floor(MC_SIMS*0.95)],
      p99:r[Math.floor(MC_SIMS*0.99)],buckets:Array.from(bkts)};
  });
}

function runPortfolioSim(stocks,weights,budget,seed,eurNow,eurFcast){
  const n=stocks.length,dt=1/PORT_STEPS,sqdt=Math.sqrt(dt);
  const rng=makeRng(seed);
  const sigmas=stocks.map(s=>s.beta*MARKET_VOL);
  const mus=stocks.map(s=>momentumMu(s.upside,s.ytd));
  const cholBull=buildChol(stocks,false), cholBear=buildChol(stocks,true);
  const fxCorrs=stocks.map(fxCorrFor);
  const fxDD=Math.log(eurFcast/eurNow)/PORT_STEPS;
  const paths=[];
  for(let sim=0;sim<PORT_SIMS;sim++){
    const path=[budget]; let val=budget,vr=0;
    for(let t=0;t<PORT_STEPS;t++){
      if(vr===0&&rng.u()<P_LOW_HIGH*7) vr=1; else if(vr===1&&rng.u()<P_HIGH_LOW*7) vr=0;
      const vm=vr===1?VOL_HIGH_MULT:1.0,CH=vr===1?cholBear:cholBull;
      const z=Array.from({length:n+1},()=>rng.tDist(T_DF));
      const zC=new Float64Array(n);
      for(let i=0;i<n;i++) for(let j=0;j<=i;j++) zC[i]+=CH[i][j]*z[j];
      const fxStep=fxDD+FX_SIGMA*rng.normal()*sqdt;
      let portR=0;
      for(let i=0;i<n;i++){
        const sig=sigmas[i]*vm;
        let step=(mus[i]-0.5*sig*sig)*dt+sig*zC[i]*sqdt;
        if(rng.u()<JUMP_LAMBDA*dt) step+=JUMP_MU*dt+JUMP_SIGMA*rng.normal()*sqdt;
        if(stocks[i].fxExposed){step-=fxStep;step+=fxCorrs[i]*fxStep*0.3;}
        portR+=weights[i]*(Math.exp(step)-1);
      }
      val=val*(1+portR); path.push(val);
    }
    paths.push(path);
  }
  const bands={p10:[],p25:[],p50:[],p75:[],p90:[]};
  for(let t=0;t<=PORT_STEPS;t++){
    const v=paths.map(p=>p[t]).sort((a,b)=>a-b);
    const at=p=>v[Math.floor(PORT_SIMS*p)];
    bands.p10.push(at(0.10));bands.p25.push(at(0.25));bands.p50.push(at(0.50));
    bands.p75.push(at(0.75));bands.p90.push(at(0.90));
  }
  return bands;
}

// ─────────────────────────────────────────────────────────────────────────────
// KELLY MODEL — now uses blended win probability
// ─────────────────────────────────────────────────────────────────────────────
const earningsMult=d=>d<=30?0.85:d<=60?0.92:d<=90?0.96:1.0;

function runModel(stocks,mcResults,budget,kellyMult,flags,marketBull,eurNow,eurFcast,modelVersion=MODEL_V13){
  const n=stocks.length,hardMin=1/(2*n),meanInvB=stocks.reduce((s,x)=>s+1/x.beta,0)/n;
  const meanInvRootB=stocks.reduce((s,x)=>s+(1/Math.sqrt(Math.max(0.1,x.beta))),0)/n;
  const CAP=0.20,regime=marketBull?1.0:0.7,fxDrift=(eurFcast-eurNow)/eurNow;
  const optimized=modelVersion===MODEL_V14;
  const sectorCnt={};
  stocks.forEach(s=>sectorCnt[s.sector]=(sectorCnt[s.sector]||0)+1);

  const computed=stocks.map((s,i)=>{
    const mc=mcResults?.[i]??null;

    const bp=blendedP(s);
    if(optimized){
      const opt=optimizedProfile(s,flags,eurNow,eurFcast,bp);
      const pComposite = flags.blendedP ? opt.optimizedP : bp.pa;
      const siP=flags.shortInt?Math.min(0.12,s.shortInt*0.45):0;
      const pAdj=clampRange(pComposite*(1-siP),0.01,0.95);
      const b=opt.expectedReturn,d=flags.drawdown?opt.expectedLoss:0.001,q=1-pAdj;
      const rawK=flags.drawdown?(pAdj*b-q*d)/(b+d):(pAdj*b-q)/b;
      const bm=flags.beta?clampRange(1/Math.sqrt(Math.max(0.1,s.beta)),0.55,1.25):1;
      const sc=sectorCnt[s.sector];
      const sm=flags.sector&&sc>1?Math.max(0.70,1-(sc-1)*0.06):1;
      const em=flags.earnings?earningsMult(s.earningsDays):1;
      const floor=flags.beta?Math.max(hardMin,hardMin*(bm/meanInvRootB)):hardMin;
      const confidenceMult=0.75+opt.dataConfidence*0.25;
      const adj=Math.max(0,rawK*kellyMult*bm*sm*em*regime*confidenceMult);

      return{...s,bp,pAdj,pComposite,rawK,adj,floor,
        fxAdjUpside:opt.fxAdjUpside,siP,secMult:sm,epMult:em,betaMult:bm,
        isFloorOnly:adj===0,mc,modelVersion,opt,fs:opt.fs};
    }

    const pComposite = flags.blendedP ? bp.blend : bp.pa;
    const siP=flags.shortInt?Math.min(0.15,s.shortInt*0.5):0;
    const pAdj=pComposite*(1-siP);

    const fxAdj=flags.fx&&s.fxExposed?fxDrift:0;
    const b=s.upside*(1+fxAdj),d=flags.drawdown?s.drawdown:0.001,q=1-pAdj;
    const rawK=flags.drawdown?(pAdj*b-q*d)/(b+d):(pAdj*b-q)/b;

    const bm=flags.beta?1/s.beta:1;
    const sc=sectorCnt[s.sector];
    const sm=flags.sector&&sc>1?Math.max(0.60,1-(sc-1)*0.08):1;
    const em=flags.earnings?earningsMult(s.earningsDays):1;
    const floor=flags.beta?Math.max(hardMin,hardMin*(1/s.beta)/meanInvB):hardMin;
    const adj=Math.max(0,rawK*kellyMult*bm*sm*em*regime);

    return{...s,bp,pAdj,pComposite,rawK,adj,floor,
      fxAdjUpside:s.upside*(1+fxAdj),siP,secMult:sm,epMult:em,betaMult:bm,
      isFloorOnly:adj===0,mc,modelVersion};
  });

  const tFloor=computed.reduce((s,x)=>s+x.floor,0);
  const rem=Math.max(0,1-tFloor),rawSum=computed.reduce((s,x)=>s+x.adj,0);
  const staged=computed.map(s=>({...s,ks:rawSum>0?(s.adj/rawSum)*rem:0,weight:s.floor+(rawSum>0?(s.adj/rawSum)*rem:0)}));
  let exc=0; staged.forEach(s=>{if(s.weight>CAP){exc+=s.weight-CAP;s.weight=CAP;}});
  if(exc>0){const u=staged.filter(s=>s.weight<CAP),us=u.reduce((s,x)=>s+x.weight,0);if(us>0)u.forEach(s=>s.weight+=exc*(s.weight/us));}
  const tw=staged.reduce((s,x)=>s+x.weight,0);
  return staged.map(s=>({...s,weight:s.weight/tw,euros:(s.weight/tw)*budget,isCapped:s.weight>=CAP*0.99})).sort((a,b)=>b.euros-a.euros);
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
function Sparkline({buckets,color,p5,p50,p95}){
  if(!buckets) return null;
  const maxB=Math.max(...buckets,0.001),W=200,H=52;
  return(
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block"}}>
        {buckets.map((b,i)=>{
          const bh=(b/maxB)*H,ret=-1.0+i*0.05;
          return <rect key={i} x={i*(W/buckets.length)} y={H-bh} width={(W/buckets.length)-0.4} height={Math.max(0,bh)} fill={ret<0?"#f87171":ret<0.10?"#fbbf24":color} opacity={0.88}/>;
        })}
        <line x1={20*(W/buckets.length)} y1={0} x2={20*(W/buckets.length)} y2={H} stroke="#ffffff18" strokeWidth={1} strokeDasharray="2,2"/>
        <line x1={Math.round((p50+1.0)/0.05)*(W/buckets.length)} y1={0} x2={Math.round((p50+1.0)/0.05)*(W/buckets.length)} y2={H} stroke="#ffffff55" strokeWidth={1}/>
      </svg>
      <div style={{display:"flex",justifyContent:"space-between",marginTop:4,fontSize:9}}>
        <span style={{color:"#f87171"}}>P5 {(p5*100).toFixed(0)}%</span>
        <span style={{color:"#cbd5e1"}}>Med +{(p50*100).toFixed(0)}%</span>
        <span style={{color:"#4ade80"}}>P95 +{(p95*100).toFixed(0)}%</span>
      </div>
    </div>
  );
}

function PortfolioChart({bands,budget}){
  if(!bands) return(
    <div style={{height:160,display:"flex",alignItems:"center",justifyContent:"center",background:"#0f172a",borderRadius:12,border:"1px solid #1e293b"}}>
      <span style={{fontSize:11,color:"#334155"}}>SIMULATING…</span>
    </div>
  );
  const{p10,p25,p50,p75,p90}=bands;
  const allV=[...p10,...p90],minV=Math.min(...allV)*0.93,maxV=Math.max(...allV)*1.06;
  const W=520,H=140;
  const toX=t=>(t/PORT_STEPS)*W,toY=v=>H-((v-minV)/(maxV-minV))*H;
  const ln=arr=>arr.map((v,i)=>`${i===0?"M":"L"}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(" ");
  const ar=(lo,hi)=>`${ln(lo)} ${[...hi].reverse().map((v,i)=>`L${toX(hi.length-1-i).toFixed(1)},${toY(v).toFixed(1)}`).join(" ")} Z`;
  return(
    <div style={{background:"#0f172a",borderRadius:12,border:"1px solid #1e293b",padding:"16px 20px"}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:8,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:12,fontWeight:600,color:"#e2e8f0"}}>Portfolio Projection — 12 Months</div>
          <div style={{fontSize:9,color:"#475569",marginTop:2}}>Blended win prob · {PORT_SIMS} correlated paths · t(5) · jumps · regime-switching</div>
        </div>
        <div style={{display:"flex",gap:16}}>
          {[{l:"P10",v:p10[PORT_STEPS],c:"#f87171"},{l:"Median",v:p50[PORT_STEPS],c:"#60a5fa"},{l:"P90",v:p90[PORT_STEPS],c:"#4ade80"}].map(x=>(
            <div key={x.l} style={{textAlign:"center"}}>
              <div style={{fontFamily:"monospace",fontSize:13,fontWeight:700,color:x.c}}>€{x.v.toFixed(0)}</div>
              <div style={{fontSize:9,color:"#475569"}}>{x.l}</div>
            </div>
          ))}
        </div>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{display:"block",height:130}}>
        <path d={ar(p10,p25)} fill="#ef444410"/>
        <path d={ar(p25,p75)} fill="#3b82f618"/>
        <path d={ar(p75,p90)} fill="#22c55e10"/>
        <line x1={0} y1={toY(budget)} x2={W} y2={toY(budget)} stroke="#334155" strokeWidth={1} strokeDasharray="5,4"/>
        <path d={ln(p10)} fill="none" stroke="#f87171" strokeWidth={1.5} opacity={.7}/>
        <path d={ln(p50)} fill="none" stroke="#60a5fa" strokeWidth={2.5}/>
        <path d={ln(p90)} fill="none" stroke="#4ade80" strokeWidth={1.5} opacity={.7}/>
        <text x={4} y={toY(budget)-5} fontSize={8} fill="#475569">€{budget} invested</text>
      </svg>
      <div style={{display:"flex",justifyContent:"space-between",marginTop:4,fontSize:9,color:"#334155"}}>
        {["Now","Mar","Jun","Sep","Dec"].map(l=><span key={l}>{l}</span>)}
      </div>
    </div>
  );
}

function ProbBreakdownPanel({stocks}){
  const ranked=[...stocks].sort((a,b)=>blendedP(b).blend-blendedP(a).blend);
  return(
    <div style={{padding:"20px 22px"}}>
      <div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:12,padding:"16px 20px",marginBottom:16}}>
        <div style={{fontSize:13,fontWeight:700,color:"#e2e8f0",marginBottom:4}}>Blended Win Probability Breakdown</div>
        <div style={{fontSize:9,color:"#475569",marginBottom:14}}>
          5-component composite: Analyst 40% · Momentum 20% · Reward/Risk 20% · Short Interest 10% · Earnings 10%
        </div>
        {/* Weight legend */}
        <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
          {[
            {l:"Analyst 40%",       c:"#60a5fa"},
            {l:"Momentum 20%",      c:"#fbbf24"},
            {l:"Reward/Risk 20%",   c:"#34d399"},
            {l:"Short Interest 10%",c:"#f87171"},
            {l:"Earnings 10%",      c:"#a78bfa"},
          ].map(x=>(
            <div key={x.l} style={{display:"flex",alignItems:"center",gap:5}}>
              <div style={{width:10,height:10,borderRadius:2,background:x.c}}/>
              <span style={{fontSize:9,color:"#64748b"}}>{x.l}</span>
            </div>
          ))}
        </div>
        {/* Table header */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 72px 68px 68px 68px 68px 80px 80px",gap:4,padding:"6px 10px",background:"#080f1e",borderRadius:8,marginBottom:4}}>
          {["Stock","Analyst","Momentum","R/R Ratio","Short SI","Earnings","Blended","vs Analyst"].map((h,i)=>(
            <div key={i} style={{fontSize:8,fontWeight:700,color:"#1e3a5f",letterSpacing:".06em",textTransform:"uppercase",textAlign:i>0?"center":"left"}}>{h}</div>
          ))}
        </div>
        {ranked.map(s=>{
          const bp=blendedP(s);
          const delta=(bp.blend-bp.pa)*100;
          const dColor=delta>2?"#4ade80":delta<-2?"#f87171":"#94a3b8";
          const mkBar=(val,color)=>(
            <div style={{display:"flex",alignItems:"center",gap:3}}>
              <div style={{flex:1,height:3,background:"#1e293b",borderRadius:2,overflow:"hidden"}}>
                <div style={{width:`${val*100}%`,height:"100%",background:color}}/>
              </div>
              <span style={{fontFamily:"monospace",fontSize:10,fontWeight:600,color,minWidth:28,textAlign:"right"}}>{(val*100).toFixed(0)}%</span>
            </div>
          );
          return(
            <div key={s.ticker} style={{display:"grid",gridTemplateColumns:"1fr 72px 68px 68px 68px 68px 80px 80px",gap:4,padding:"8px 10px",background:"#0a0f1e",borderRadius:8,marginBottom:3,alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:13}}>{s.emoji}</span>
                <div>
                  <div style={{fontSize:11,fontWeight:600,color:"#f1f5f9"}}>{s.name}</div>
                  <div style={{fontSize:8,color:"#334155"}}>{s.ticker}</div>
                </div>
              </div>
              <div>{mkBar(bp.pa,"#60a5fa")}</div>
              <div>{mkBar(bp.pm,"#fbbf24")}</div>
              <div>{mkBar(bp.prr,"#34d399")}</div>
              <div>{mkBar(bp.psi,"#f87171")}</div>
              <div>{mkBar(bp.pep,"#a78bfa")}</div>
              <div style={{textAlign:"center"}}>
                <div style={{fontFamily:"monospace",fontSize:13,fontWeight:700,color:"#e2e8f0"}}>{(bp.blend*100).toFixed(1)}%</div>
              </div>
              <div style={{textAlign:"center"}}>
                <span style={{fontFamily:"monospace",fontSize:11,fontWeight:700,color:dColor}}>
                  {delta>0?"▲":"▼"}{Math.abs(delta).toFixed(1)}pp
                </span>
              </div>
            </div>
          );
        })}
        <div style={{marginTop:12,padding:"10px 14px",background:"#080f1e",borderRadius:8,fontSize:9,color:"#475569",lineHeight:1.9}}>
          <div><span style={{color:"#60a5fa"}}>Analyst</span>: weighted average of Strong Buy/Buy/Hold/Sell ratings from professional research</div>
          <div><span style={{color:"#fbbf24"}}>Momentum</span>: YTD price action — beaten-down stocks have higher forward win probability (mean reversion)</div>
          <div><span style={{color:"#34d399"}}>Reward/Risk</span>: upside ÷ drawdown ratio — pure mathematical entry quality regardless of analyst opinion</div>
          <div><span style={{color:"#f87171"}}>Short Interest</span>: institutional bearish signal — high SI reduces win probability</div>
          <div><span style={{color:"#a78bfa"}}>Earnings</span>: binary event uncertainty — near earnings reduces confidence slightly toward 50/50</div>
        </div>
      </div>
    </div>
  );
}

function StockSearch({portfolioResults}){
  const [query,setQuery] = useState("");
  const ticker = query.trim().toUpperCase();
  const match = ticker ? portfolioResults.find(s=>s.ticker===ticker || s.name.toUpperCase().includes(ticker)) : null;
  const top = portfolioResults[0];
  const metric = (label,value,color="#e2e8f0",sub=null) => (
    <div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:8,padding:"10px 12px"}}>
      <div style={{fontSize:8,fontWeight:700,color:"#334155",letterSpacing:".06em",textTransform:"uppercase",marginBottom:4}}>{label}</div>
      <div className="mono" style={{fontSize:18,fontWeight:700,color,lineHeight:1}}>{value}</div>
      {sub&&<div style={{fontSize:8,color:"#475569",marginTop:4}}>{sub}</div>}
    </div>
  );
  const inputStyle = {width:"100%",background:"#0f172a",border:"1px solid #1e293b",color:"#e2e8f0",fontFamily:"inherit",fontSize:12,padding:"8px 10px",borderRadius:8,outline:"none"};
  const pColor = match?.pAdj>0.75?"#4ade80":match?.pAdj>0.60?"#fbbf24":"#f87171";
  const rank = match ? portfolioResults.findIndex(s=>s.ticker===match.ticker)+1 : null;

  return(
    <div style={{padding:"20px 22px"}}>
      <div style={{background:"#080f1e",border:"1px solid #1e293b",borderRadius:12,padding:"16px 18px",maxWidth:920}}>
        <div style={{display:"grid",gridTemplateColumns:"minmax(260px,.8fr) minmax(320px,1.2fr)",gap:16}} className="candidate-grid">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,marginBottom:14}}>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:"#e2e8f0"}}>Stock Search</div>
              <div style={{fontSize:9,color:"#475569",marginTop:2}}>Search the stocks currently loaded into the model</div>
            </div>
            <input style={{...inputStyle,fontFamily:"JetBrains Mono,monospace",fontSize:15,textTransform:"uppercase"}} placeholder="NVDA, V, RYAAY..." value={query} onChange={e=>setQuery(e.target.value)}/>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:10}}>
              {portfolioResults.slice(0,5).map(s=>(
                <button key={s.ticker} className="btn" onClick={()=>setQuery(s.ticker)}>{s.ticker}</button>
              ))}
            </div>
          </div>
          <div>
            <div>
              {match ? (
                <>
                  <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",marginBottom:14}}>
                    <div>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
                        <span style={{fontSize:18}}>{match.emoji}</span>
                        <div style={{fontSize:16,fontWeight:700,color:"#f8fafc"}}>{match.name}</div>
                        <span style={{fontSize:9,color:"#334155",background:"#1e293b",padding:"2px 6px",borderRadius:5,fontFamily:"monospace"}}>{match.ticker}</span>
                      </div>
                      <div style={{fontSize:9,color:"#475569"}}>{SECTOR_LABELS[match.sector] || match.sector} · model-ranked #{rank}</div>
                    </div>
                    {match.isCapped&&<span className="pill" style={{background:"#172554",color:"#60a5fa",border:"1px solid #60a5fa30"}}>cap applied</span>}
                  </div>

                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:12}}>
                    {metric("Model score",(match.adj*100).toFixed(1)+"%","#4ade80","adjusted Kelly")}
                    {metric("Win probability",(match.pAdj*100).toFixed(1)+"%",pColor,"after model penalties")}
                    {metric("Allocation","€"+match.euros.toFixed(2),"#60a5fa",(match.weight*100).toFixed(1)+"% target")}
                  </div>
                  <div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:8,padding:"11px 12px"}}>
                    <div style={{fontSize:9,fontWeight:700,color:"#334155",letterSpacing:".06em",textTransform:"uppercase",marginBottom:8}}>Model Readout</div>
                    {[
                      ["Rank",`#${rank} of ${portfolioResults.length}`,"#60a5fa"],
                      ["Top allocation",top?`${top.name} · €${top.euros.toFixed(2)}`:"—","#a78bfa"],
                      ["Sector",SECTOR_LABELS[match.sector] || match.sector,"#94a3b8"],
                      ["Status",match.isFloorOnly?"floor allocation only":"eligible for Kelly allocation",match.isFloorOnly?"#fb923c":"#4ade80"],
                    ].map(([l,v,c])=>(
                      <div key={l} style={{display:"flex",justifyContent:"space-between",gap:10,padding:"4px 0",borderBottom:"1px solid #1e293b"}}>
                        <span style={{fontSize:9,color:"#475569"}}>{l}</span>
                        <span className="mono" style={{fontSize:9,fontWeight:700,color:c,textAlign:"right"}}>{v}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:8,padding:"18px 20px",minHeight:168,display:"flex",flexDirection:"column",justifyContent:"center"}}>
                  <div style={{fontSize:15,fontWeight:700,color:"#e2e8f0",marginBottom:6}}>{ticker ? `${ticker} is not loaded yet` : "Search a loaded stock"}</div>
                  <div style={{fontSize:10,color:"#475569",lineHeight:1.8,maxWidth:520}}>
                    The public app will keep the raw model assumptions behind the scenes. The next build step is adding a data-backed candidate engine so a ticker can be scored without asking you to type upside, downside, beta, or analyst inputs manually.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Scanner({results,setView}){
  const [sector,setSector] = useState("all");
  const [query,setQuery] = useState("");
  const [minWin,setMinWin] = useState(0);
  const [minScore,setMinScore] = useState(0);
  const [minUpside,setMinUpside] = useState(0);
  const [maxDrawdown,setMaxDrawdown] = useState(100);
  const [sortBy,setSortBy] = useState("score");
  const [rowLimit,setRowLimit] = useState("100");
  const filterFields = [
    {label:"Min score", value:minScore, setter:setMinScore},
    {label:"Min win %", value:minWin, setter:setMinWin},
    {label:"Min upside %", value:minUpside, setter:setMinUpside},
    {label:"Max drawdown %", value:maxDrawdown, setter:setMaxDrawdown},
  ];
  const filtered = results
    .filter(s=>(sector==="all"||s.sector===sector)
      && (!query || `${s.name} ${s.ticker}`.toUpperCase().includes(query.toUpperCase()))
      && s.pAdj*100>=minWin
      && modelScore(s)>=minScore
      && s.fxAdjUpside*100>=minUpside
      && s.drawdown*100<=maxDrawdown)
    .sort((a,b)=>{
      const map = {
        score: modelScore,
        win: s=>s.pAdj*100,
        quality: s=>fundamentalScores(s).quality ?? -1,
        valuation: s=>fundamentalScores(s).valuation ?? -1,
        upside: s=>s.fxAdjUpside*100,
        drawdown: s=>-s.drawdown*100,
        allocation: s=>s.weight*100,
        price: s=>s.currentPrice || 0,
      };
      return (map[sortBy](b)-map[sortBy](a));
    });
  const visible = filtered.slice(0,rowLimitValue(rowLimit,filtered.length));
  return(
    <div style={{padding:"20px 22px"}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-end",flexWrap:"wrap",marginBottom:12}}>
        <div>
          <div style={{fontSize:13,fontWeight:700,color:"#e2e8f0"}}>Optimal Stock Scanner</div>
          <div style={{fontSize:9,color:"#475569",marginTop:2}}>Ranks every stock in the database using the active model settings</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <input className="ni" style={{width:150}} placeholder="Search" value={query} onChange={e=>setQuery(e.target.value)}/>
          <select className="ni" style={{width:150}} value={sector} onChange={e=>setSector(e.target.value)}>
            <option value="all">All sectors</option>
            {SECTOR_OPTIONS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
          </select>
          <select className="ni" style={{width:130}} value={sortBy} onChange={e=>setSortBy(e.target.value)}>
            <option value="score">Sort score</option>
            <option value="quality">Sort quality</option>
            <option value="valuation">Sort valuation</option>
            <option value="win">Sort win %</option>
            <option value="upside">Sort upside</option>
            <option value="drawdown">Sort drawdown</option>
            <option value="allocation">Sort allocation</option>
            <option value="price">Sort price</option>
          </select>
          <select className="ni" style={{width:110}} value={rowLimit} onChange={e=>setRowLimit(e.target.value)}>
            {ROW_LIMITS.map(v=><option key={v} value={v}>{v==="all"?"All rows":`Top ${v}`}</option>)}
          </select>
          <button className="btn" onClick={()=>setView("database")}>Add Stocks</button>
        </div>
      </div>
      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:12}}>
        {filterFields.map(({label,value,setter})=>(
          <label key={label} style={{display:"flex",alignItems:"center",gap:5,fontSize:9,color:"#475569"}}>
            {label}
            <input className="ni" style={{width:72}} type="number" value={value} onChange={e=>setter(Number(e.target.value)||0)}/>
          </label>
        ))}
        <span style={{fontSize:9,color:"#334155"}}>{visible.length} shown · {filtered.length} matched · {results.length} total</span>
      </div>
      <div style={{background:"#080f1e",border:"1px solid #1e293b",borderRadius:12,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"42px 1.35fr 76px 78px 78px 78px 86px 76px 76px 88px",padding:"9px 14px",background:"#0f172a",borderBottom:"1px solid #1e293b"}}>
          {["#","Stock","Price","Score","Quality","Value","Win Prob","Upside","Drawdown","Allocation"].map((h,i)=>(
            <div key={h} style={{fontSize:8,fontWeight:700,color:"#1e3a5f",letterSpacing:".08em",textTransform:"uppercase",textAlign:i>1?"right":"left"}}>{h}</div>
          ))}
        </div>
        {visible.map((s,i)=>{
          const score=modelScore(s);
          const fs=fundamentalScores(s);
          return(
            <div key={s.ticker} style={{display:"grid",gridTemplateColumns:"42px 1.35fr 76px 78px 78px 78px 86px 76px 76px 88px",padding:"10px 14px",borderBottom:"1px solid #0f172a",alignItems:"center"}}>
              <div className="mono" style={{fontSize:11,fontWeight:700,color:i<3?"#60a5fa":"#334155"}}>{i+1}</div>
              <div style={{display:"flex",alignItems:"center",gap:7}}>
                <span>{s.emoji}</span>
                <div>
                  <div style={{fontSize:12,fontWeight:700,color:"#f8fafc"}}>{s.name}</div>
                  <div className="mono" style={{fontSize:8,color:"#475569"}}>{s.ticker} · {SECTOR_LABELS[s.sector]||s.sector}</div>
                </div>
              </div>
              <div className="mono" style={{fontSize:12,fontWeight:700,color:s.currentPrice?"#94a3b8":"#334155",textAlign:"right"}}>{priceLabel(s)}</div>
              <div className="mono" style={{fontSize:13,fontWeight:700,color:"#4ade80",textAlign:"right"}}>{score.toFixed(1)}</div>
              <div className="mono" style={{fontSize:12,fontWeight:700,color:fs.quality===null?"#334155":"#a78bfa",textAlign:"right"}}>{fmtScore(fs.quality)}</div>
              <div className="mono" style={{fontSize:12,fontWeight:700,color:fs.valuation===null?"#334155":"#fbbf24",textAlign:"right"}}>{fmtScore(fs.valuation)}</div>
              <div className="mono" style={{fontSize:12,fontWeight:700,color:"#22d3ee",textAlign:"right"}}>{(s.pAdj*100).toFixed(1)}%</div>
              <div className="mono" style={{fontSize:12,fontWeight:700,color:"#94a3b8",textAlign:"right"}}>{(s.fxAdjUpside*100).toFixed(0)}%</div>
              <div className="mono" style={{fontSize:12,fontWeight:700,color:s.drawdown>0.45?"#f87171":"#94a3b8",textAlign:"right"}}>{(s.drawdown*100).toFixed(0)}%</div>
              <div className="mono" style={{fontSize:12,fontWeight:700,color:"#60a5fa",textAlign:"right"}}>{(s.weight*100).toFixed(1)}%</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function YahooScan({scanData,setStocks,setDbMode,setView}){
  const [query,setQuery] = useState("");
  const [sortBy,setSortBy] = useState("score");
  const [rowLimit,setRowLimit] = useState("100");
  const rows = Array.isArray(scanData?.results) ? scanData.results : [];
  const generated = scanData?.generatedAt ? new Date(scanData.generatedAt).toLocaleString() : "No scan yet";
  const sorters = {
    score: s=>Number(s.score)||0,
    win: s=>Number(s.pAdj)||0,
    upside: s=>Number(s.fxAdjUpside ?? s.upside)||0,
    quality: s=>Number(s.qualityScore)||-1,
    valuation: s=>Number(s.valuationScore)||-1,
    confidence: s=>Number(s.dataConfidence)||0,
    price: s=>Number(s.currentPrice)||0,
  };
  const filtered = rows
    .filter(s=>!query || `${s.name} ${s.ticker} ${s.scanSource||""}`.toUpperCase().includes(query.toUpperCase()))
    .sort((a,b)=>(sorters[sortBy](b)-sorters[sortBy](a)));
  const visible = filtered.slice(0,rowLimitValue(rowLimit,filtered.length));
  const addCandidate = row => {
    const next = normalizeStock(row,0);
    setDbMode("local");
    setStocks(prev=>{
      const without = prev.filter(s=>s.ticker!==next.ticker);
      return [...without,next].sort((a,b)=>a.ticker.localeCompare(b.ticker));
    });
    setView("scanner");
  };
  return(
    <div style={{padding:"20px 22px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:12,flexWrap:"wrap",marginBottom:12}}>
        <div>
          <div style={{fontSize:13,fontWeight:700,color:"#e2e8f0"}}>Yahoo Market Scan</div>
          <div style={{fontSize:9,color:"#475569",marginTop:2}}>
            {rows.length} results · {scanData?.modelVersion||"v14"} · {generated}
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <input className="ni" style={{width:150}} placeholder="Search" value={query} onChange={e=>setQuery(e.target.value)}/>
          <select className="ni" style={{width:138}} value={sortBy} onChange={e=>setSortBy(e.target.value)}>
            <option value="score">Sort score</option>
            <option value="win">Sort win %</option>
            <option value="upside">Sort upside</option>
            <option value="quality">Sort quality</option>
            <option value="valuation">Sort value</option>
            <option value="confidence">Sort confidence</option>
            <option value="price">Sort price</option>
          </select>
          <select className="ni" style={{width:110}} value={rowLimit} onChange={e=>setRowLimit(e.target.value)}>
            {ROW_LIMITS.map(v=><option key={v} value={v}>{v==="all"?"All rows":`Top ${v}`}</option>)}
          </select>
          <a className="btn" href={RUN_SCAN_URL} target="_blank" rel="noreferrer" style={{textDecoration:"none"}}>Run Scan</a>
          <a className="btn active" href={SAVE_SCAN_URL} target="_blank" rel="noreferrer" style={{textDecoration:"none"}}>Save Picks</a>
        </div>
      </div>
      <div style={{background:"#080f1e",border:"1px solid #1e293b",borderRadius:12,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"42px 1.35fr 76px 76px 76px 70px 70px 78px 92px 78px",gap:8,padding:"9px 14px",background:"#0f172a",borderBottom:"1px solid #1e293b"}}>
          {["#","Stock","Price","Score","Win %","Upside","Quality","Value","Confidence",""].map((h,i)=>(
            <div key={h||i} style={{fontSize:8,fontWeight:700,color:"#1e3a5f",letterSpacing:".08em",textTransform:"uppercase",textAlign:i>1?"right":"left"}}>{h}</div>
          ))}
        </div>
        {visible.map((s,i)=>(
          <div key={s.ticker} style={{display:"grid",gridTemplateColumns:"42px 1.35fr 76px 76px 76px 70px 70px 78px 92px 78px",gap:8,padding:"10px 14px",borderBottom:"1px solid #0f172a",alignItems:"center"}}>
            <div className="mono" style={{fontSize:11,fontWeight:700,color:i<3?"#60a5fa":"#334155"}}>{s.rank||i+1}</div>
            <div>
              <div style={{fontSize:12,fontWeight:700,color:"#f8fafc"}}>{s.name||s.ticker} <span className="mono" style={{fontSize:9,color:"#60a5fa"}}>{s.ticker}</span></div>
              <div style={{fontSize:8,color:"#475569"}}>{SECTOR_LABELS[s.sector]||s.sector||"Other"} · {s.scanSource||"Yahoo"}</div>
            </div>
            <div className="mono" style={{fontSize:11,fontWeight:700,color:s.currentPrice?"#94a3b8":"#334155",textAlign:"right"}}>{priceLabel(s)}</div>
            <div className="mono" style={{fontSize:13,fontWeight:700,color:"#4ade80",textAlign:"right"}}>{(Number(s.score)||0).toFixed(1)}</div>
            <div className="mono" style={{fontSize:12,fontWeight:700,color:"#22d3ee",textAlign:"right"}}>{fmtPct(s.pAdj)}</div>
            <div className="mono" style={{fontSize:12,fontWeight:700,color:"#94a3b8",textAlign:"right"}}>{fmtPct(s.fxAdjUpside ?? s.upside)}</div>
            <div className="mono" style={{fontSize:12,fontWeight:700,color:s.qualityScore===undefined?"#334155":"#a78bfa",textAlign:"right"}}>{fmtScore(s.qualityScore)}</div>
            <div className="mono" style={{fontSize:12,fontWeight:700,color:s.valuationScore===undefined?"#334155":"#fbbf24",textAlign:"right"}}>{fmtScore(s.valuationScore)}</div>
            <div className="mono" style={{fontSize:12,fontWeight:700,color:"#94a3b8",textAlign:"right"}}>{fmtPct(s.dataConfidence)}</div>
            <button className="btn" onClick={()=>addCandidate(s)} style={{padding:"5px 8px"}}>Preview</button>
          </div>
        ))}
        {!visible.length&&(
          <div style={{padding:24,color:"#475569",fontSize:12,textAlign:"center"}}>No scan results yet.</div>
        )}
      </div>
    </div>
  );
}

function StockDatabase({stocks,results,setStocks,setView,setDbMode}){
  const empty = { name:"", ticker:"", sector:"other", emoji:"◆", color:STOCK_COLORS[0], strongBuy:40, buy:30, hold:25, sell:5, upside:0.25, drawdown:0.30, shortInt:0.02, beta:1.1, currentPrice:null, priceCurrency:"USD", fxExposed:true, earningsDays:90, ytd:0, analystCount:0, analystSrc:"Yahoo Finance", dataProvider:"Yahoo Finance" };
  const [draft,setDraft] = useState(empty);
  const [importText,setImportText] = useState("");
  const [dbQuery,setDbQuery] = useState("");
  const [dbSector,setDbSector] = useState("all");
  const [dbMinScore,setDbMinScore] = useState(0);
  const [dbLimit,setDbLimit] = useState("100");
  const resultByTicker = Object.fromEntries(results.map(s=>[s.ticker,s]));
  const matchedStocks = stocks
    .map(s=>resultByTicker[s.ticker] || s)
    .filter(s=>(dbSector==="all"||s.sector===dbSector)
      && (!dbQuery || `${s.name} ${s.ticker}`.toUpperCase().includes(dbQuery.toUpperCase()))
      && (s.adj===undefined || modelScore(s)>=dbMinScore))
    .sort((a,b)=>(modelScore(b)-modelScore(a)));
  const visibleStocks = matchedStocks.slice(0,rowLimitValue(dbLimit,matchedStocks.length));
  const update=(k,v)=>setDraft(d=>({...d,[k]:v}));
  const pct=(k,v)=>update(k,(Number(v)||0)/100);
  const upsert=()=>{
    const next=normalizeStock(draft,stocks.length);
    setDbMode("local");
    setStocks(prev=>{
      const without=prev.filter(s=>s.ticker!==next.ticker);
      return [...without,next].sort((a,b)=>a.ticker.localeCompare(b.ticker));
    });
    setDraft(empty);
    setView("scanner");
  };
  const resetDb=()=>{ localStorage.removeItem(STORAGE_KEY); setDbMode("published"); setStocks(BASE_STOCKS); };
  const exportDb=()=>{
    const blob=new Blob([JSON.stringify(stocks,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download="kelly-stock-database.json";a.click();URL.revokeObjectURL(url);
  };
  const importDb=()=>{
    try{
      const parsed=JSON.parse(importText);
      if(!Array.isArray(parsed)) return;
      setDbMode("local");
      setStocks(parsed.map(normalizeStock));
      setImportText("");
      setView("scanner");
    }catch{}
  };
  const inputStyle={width:"100%",background:"#0f172a",border:"1px solid #1e293b",color:"#e2e8f0",fontFamily:"inherit",fontSize:12,padding:"8px 10px",borderRadius:8,outline:"none"};
  const Field=({label,children})=><label><div style={{fontSize:8,fontWeight:700,color:"#334155",letterSpacing:".06em",textTransform:"uppercase",marginBottom:4}}>{label}</div>{children}</label>;
  return(
    <div style={{padding:"20px 22px"}}>
      <div style={{display:"grid",gridTemplateColumns:"minmax(320px,1fr) minmax(320px,.9fr)",gap:16}} className="candidate-grid">
        <div style={{background:"#080f1e",border:"1px solid #1e293b",borderRadius:12,padding:"16px 18px"}}>
          <div style={{fontSize:13,fontWeight:700,color:"#e2e8f0",marginBottom:2}}>Add Stock To Database</div>
          <div style={{fontSize:9,color:"#475569",marginBottom:14}}>Yahoo Finance is the chosen source; manual entry is the bridge until the updater is connected</div>
          <div style={{display:"grid",gridTemplateColumns:"1.4fr .8fr 1fr",gap:10,marginBottom:10}}>
            <Field label="Company"><input style={inputStyle} value={draft.name} onChange={e=>update("name",e.target.value)}/></Field>
            <Field label="Ticker"><input style={{...inputStyle,fontFamily:"JetBrains Mono,monospace",textTransform:"uppercase"}} value={draft.ticker} onChange={e=>update("ticker",e.target.value.toUpperCase())}/></Field>
            <Field label="Sector"><select style={inputStyle} value={draft.sector} onChange={e=>update("sector",e.target.value)}>{SECTOR_OPTIONS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></Field>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:10}}>
            {["strongBuy","buy","hold","sell"].map(k=><Field key={k} label={k.replace(/([A-Z])/g," $1")}><input style={inputStyle} type="number" value={draft[k]} onChange={e=>update(k,Number(e.target.value)||0)}/></Field>)}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:10}}>
            <Field label="Upside %"><input style={inputStyle} type="number" value={(draft.upside*100).toFixed(0)} onChange={e=>pct("upside",e.target.value)}/></Field>
            <Field label="Drawdown %"><input style={inputStyle} type="number" value={(draft.drawdown*100).toFixed(0)} onChange={e=>pct("drawdown",e.target.value)}/></Field>
            <Field label="YTD %"><input style={inputStyle} type="number" value={(draft.ytd*100).toFixed(0)} onChange={e=>pct("ytd",e.target.value)}/></Field>
            <Field label="Short %"><input style={inputStyle} type="number" value={(draft.shortInt*100).toFixed(1)} onChange={e=>pct("shortInt",e.target.value)}/></Field>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:10}}>
            <Field label="Price"><input style={inputStyle} type="number" step="0.01" value={draft.currentPrice??""} onChange={e=>update("currentPrice",e.target.value===""?null:Number(e.target.value)||0)}/></Field>
            <Field label="Currency"><select style={inputStyle} value={draft.priceCurrency} onChange={e=>update("priceCurrency",e.target.value)}><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option></select></Field>
            <Field label="Beta"><input style={inputStyle} type="number" step="0.1" value={draft.beta} onChange={e=>update("beta",Number(e.target.value)||1)}/></Field>
            <Field label="Earnings Days"><input style={inputStyle} type="number" value={draft.earningsDays} onChange={e=>update("earningsDays",Number(e.target.value)||90)}/></Field>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8,marginBottom:12}}>
            <Field label="Analysts"><input style={inputStyle} type="number" value={draft.analystCount} onChange={e=>update("analystCount",Number(e.target.value)||0)}/></Field>
            <Field label="FX"><select style={inputStyle} value={draft.fxExposed?"usd":"native"} onChange={e=>update("fxExposed",e.target.value==="usd")}><option value="usd">USD exposed</option><option value="native">Native/EUR</option></select></Field>
          </div>
          <button className="btn active" onClick={upsert} disabled={!draft.ticker}>Add / Update Stock</button>
        </div>
        <div style={{background:"#080f1e",border:"1px solid #1e293b",borderRadius:12,padding:"16px 18px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:10}}>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:"#e2e8f0"}}>Database</div>
              <div style={{fontSize:9,color:"#475569"}}>{visibleStocks.length} shown · {matchedStocks.length} matched · {stocks.length} total</div>
            </div>
            <div style={{display:"flex",gap:6}}>
              <button className="btn" onClick={exportDb}>Export</button>
              <button className="btn" onClick={resetDb}>Reset</button>
            </div>
          </div>
          <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
            <input className="ni" style={{width:130}} placeholder="Search" value={dbQuery} onChange={e=>setDbQuery(e.target.value)}/>
            <select className="ni" style={{width:132}} value={dbSector} onChange={e=>setDbSector(e.target.value)}>
              <option value="all">All sectors</option>
              {SECTOR_OPTIONS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </select>
            <label style={{display:"flex",alignItems:"center",gap:5,fontSize:9,color:"#475569"}}>
              Min score
              <input className="ni" style={{width:72}} type="number" value={dbMinScore} onChange={e=>setDbMinScore(Number(e.target.value)||0)}/>
            </label>
            <select className="ni" style={{width:110}} value={dbLimit} onChange={e=>setDbLimit(e.target.value)}>
              {ROW_LIMITS.map(v=><option key={v} value={v}>{v==="all"?"All rows":`Top ${v}`}</option>)}
            </select>
          </div>
          <textarea style={{...inputStyle,height:120,fontFamily:"JetBrains Mono,monospace",fontSize:10,resize:"vertical"}} placeholder="Paste exported JSON here to import..." value={importText} onChange={e=>setImportText(e.target.value)}/>
          <button className="btn" style={{marginTop:8}} onClick={importDb}>Import JSON</button>
          <div style={{marginTop:12,maxHeight:260,overflow:"auto",border:"1px solid #1e293b",borderRadius:8}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 64px 58px 54px 54px 62px",gap:8,padding:"7px 10px",background:"#0f172a",borderBottom:"1px solid #1e293b"}}>
              {["Stock","Price","Score","Qual","Value","Win %"].map((h,i)=><div key={h} style={{fontSize:8,fontWeight:700,color:"#1e3a5f",letterSpacing:".08em",textTransform:"uppercase",textAlign:i?"right":"left"}}>{h}</div>)}
            </div>
            {visibleStocks.map(s=>{
              const fs=fundamentalScores(s);
              return(
                <div key={s.ticker} style={{display:"grid",gridTemplateColumns:"1fr 64px 58px 54px 54px 62px",gap:8,padding:"8px 10px",borderBottom:"1px solid #0f172a",alignItems:"center"}}>
                  <span style={{fontSize:11,color:"#e2e8f0"}}>{s.emoji} {s.name} <span className="mono" style={{fontSize:9,color:"#60a5fa"}}>{s.ticker}</span></span>
                  <span className="mono" style={{fontSize:10,color:"#94a3b8",textAlign:"right"}}>{priceLabel(s)}</span>
                  <span className="mono" style={{fontSize:10,color:"#4ade80",textAlign:"right"}}>{s.adj!==undefined?modelScore(s).toFixed(1):"—"}</span>
                  <span className="mono" style={{fontSize:10,color:"#a78bfa",textAlign:"right"}}>{fmtScore(fs.quality)}</span>
                  <span className="mono" style={{fontSize:10,color:"#fbbf24",textAlign:"right"}}>{fmtScore(fs.valuation)}</span>
                  <span className="mono" style={{fontSize:10,color:"#22d3ee",textAlign:"right"}}>{s.pAdj!==undefined?(s.pAdj*100).toFixed(1)+"%":"—"}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Fundamentals({results}){
  const [rowLimit,setRowLimit] = useState("100");
  const rows = results
    .map(s=>({...s,fs:fundamentalScores(s)}))
    .sort((a,b)=>(((b.fs.quality??0)+(b.fs.valuation??0))-((a.fs.quality??0)+(a.fs.valuation??0))));
  const visible = rows.slice(0,rowLimitValue(rowLimit,rows.length));
  return(
    <div style={{padding:"20px 22px"}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-end",flexWrap:"wrap",marginBottom:12}}>
        <div>
          <div style={{fontSize:13,fontWeight:700,color:"#e2e8f0"}}>Fundamentals</div>
          <div style={{fontSize:9,color:"#475569",marginTop:2}}>Quality and valuation are research layers only; they do not change allocations yet</div>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <select className="ni" style={{width:110}} value={rowLimit} onChange={e=>setRowLimit(e.target.value)}>
            {ROW_LIMITS.map(v=><option key={v} value={v}>{v==="all"?"All rows":`Top ${v}`}</option>)}
          </select>
          <span className="pill" style={{background:"#2e1065",color:"#c4b5fd",border:"1px solid #a78bfa40"}}>Quality</span>
          <span className="pill" style={{background:"#422006",color:"#fde68a",border:"1px solid #fbbf2440"}}>Valuation</span>
        </div>
      </div>
      <div style={{background:"#080f1e",border:"1px solid #1e293b",borderRadius:12,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"42px 1.3fr 86px 86px 82px 70px 70px 74px 74px 74px 82px",gap:8,padding:"9px 14px",background:"#0f172a",borderBottom:"1px solid #1e293b"}}>
          {["#","Stock","Quality","Value","Fwd P/E","P/S","EV/EBITDA","Gross","Op Margin","Rev Gr.","Debt/Eq"].map((h,i)=>(
            <div key={h} style={{fontSize:8,fontWeight:700,color:"#1e3a5f",letterSpacing:".08em",textTransform:"uppercase",textAlign:i>1?"right":"left"}}>{h}</div>
          ))}
        </div>
        {visible.map((s,i)=>{
          const debt=debtRatio(s.debtToEquity);
          return(
            <div key={s.ticker} style={{display:"grid",gridTemplateColumns:"42px 1.3fr 86px 86px 82px 70px 70px 74px 74px 74px 82px",gap:8,padding:"10px 14px",borderBottom:"1px solid #0f172a",alignItems:"center"}}>
              <div className="mono" style={{fontSize:11,fontWeight:700,color:i<3?"#60a5fa":"#334155"}}>{i+1}</div>
              <div>
                <div style={{fontSize:12,fontWeight:700,color:"#f8fafc"}}>{s.emoji} {s.name}</div>
                <div className="mono" style={{fontSize:8,color:"#475569"}}>{s.ticker} · {SECTOR_LABELS[s.sector]||s.sector}</div>
              </div>
              <div className="mono" style={{fontSize:13,fontWeight:700,color:s.fs.quality===null?"#334155":"#a78bfa",textAlign:"right"}}>{fmtScore(s.fs.quality)}<span style={{fontSize:8,color:"#475569"}}>/{s.fs.qualityCount}</span></div>
              <div className="mono" style={{fontSize:13,fontWeight:700,color:s.fs.valuation===null?"#334155":"#fbbf24",textAlign:"right"}}>{fmtScore(s.fs.valuation)}<span style={{fontSize:8,color:"#475569"}}>/{s.fs.valuationCount}</span></div>
              <div className="mono" style={{fontSize:12,color:"#94a3b8",textAlign:"right"}}>{fmtMultiple(s.forwardPE)}</div>
              <div className="mono" style={{fontSize:12,color:"#94a3b8",textAlign:"right"}}>{fmtMultiple(s.priceToSales)}</div>
              <div className="mono" style={{fontSize:12,color:"#94a3b8",textAlign:"right"}}>{fmtMultiple(s.enterpriseToEbitda)}</div>
              <div className="mono" style={{fontSize:12,color:"#94a3b8",textAlign:"right"}}>{fmtPct(s.grossMargins)}</div>
              <div className="mono" style={{fontSize:12,color:"#94a3b8",textAlign:"right"}}>{fmtPct(s.operatingMargins)}</div>
              <div className="mono" style={{fontSize:12,color:"#94a3b8",textAlign:"right"}}>{fmtPct(s.revenueGrowth)}</div>
              <div className="mono" style={{fontSize:12,color:"#94a3b8",textAlign:"right"}}>{fmtMultiple(debt)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CreateModel({stocks,results,budget,kellyMult,flags,marketBull,eurUsdNow,eurUsdForecast,modelVersion}){
  const [query,setQuery] = useState("");
  const [sector,setSector] = useState("all");
  const [rowLimit,setRowLimit] = useState("100");
  const [selected,setSelected] = useState(()=>stocks.slice(0,Math.min(10,stocks.length)).map(s=>s.ticker));
  const selectedStocks = stocks.filter(s=>selected.includes(s.ticker));
  const customResults = selectedStocks.length ? runModel(selectedStocks,null,budget,kellyMult,flags,marketBull,eurUsdNow,eurUsdForecast,modelVersion) : [];
  const available = stocks
    .filter(s=>(sector==="all"||s.sector===sector) && (!query || `${s.name} ${s.ticker}`.toUpperCase().includes(query.toUpperCase())))
    .sort((a,b)=>a.ticker.localeCompare(b.ticker));
  const visibleAvailable = available.slice(0,rowLimitValue(rowLimit,available.length));
  const toggleTicker = ticker => setSelected(prev=>prev.includes(ticker)?prev.filter(t=>t!==ticker):[...prev,ticker]);
  const clear = () => setSelected([]);
  const topTen = () => setSelected(results.slice().sort((a,b)=>modelScore(b)-modelScore(a)).slice(0,10).map(s=>s.ticker));
  return(
    <div style={{padding:"20px 22px"}}>
      <div style={{display:"grid",gridTemplateColumns:"minmax(310px,.8fr) minmax(420px,1.2fr)",gap:16}} className="candidate-grid">
        <div style={{background:"#080f1e",border:"1px solid #1e293b",borderRadius:12,padding:"16px 18px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:12}}>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:"#e2e8f0"}}>Create Model</div>
              <div style={{fontSize:9,color:"#475569"}}>{selected.length} stocks selected from database</div>
            </div>
            <div style={{display:"flex",gap:6}}>
              <button className="btn" onClick={topTen}>Top 10</button>
              <button className="btn" onClick={clear}>Clear</button>
            </div>
          </div>
          <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
            <input className="ni" style={{width:150}} placeholder="Search" value={query} onChange={e=>setQuery(e.target.value)}/>
            <select className="ni" style={{width:145}} value={sector} onChange={e=>setSector(e.target.value)}>
              <option value="all">All sectors</option>
              {SECTOR_OPTIONS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </select>
            <select className="ni" style={{width:110}} value={rowLimit} onChange={e=>setRowLimit(e.target.value)}>
              {ROW_LIMITS.map(v=><option key={v} value={v}>{v==="all"?"All rows":`Top ${v}`}</option>)}
            </select>
          </div>
          <div style={{maxHeight:460,overflow:"auto",border:"1px solid #1e293b",borderRadius:8}}>
            {visibleAvailable.map(s=>(
              <button key={s.ticker} onClick={()=>toggleTicker(s.ticker)}
                style={{width:"100%",display:"grid",gridTemplateColumns:"26px 1fr 70px",gap:8,alignItems:"center",padding:"8px 10px",background:selected.includes(s.ticker)?"#0f172a":"#080f1e",border:"none",borderBottom:"1px solid #0f172a",cursor:"pointer",textAlign:"left"}}>
                <span style={{width:14,height:14,borderRadius:4,border:`1px solid ${selected.includes(s.ticker)?"#60a5fa":"#334155"}`,background:selected.includes(s.ticker)?"#3b82f6":"transparent"}}/>
                <span style={{fontSize:11,color:"#e2e8f0"}}>{s.emoji} {s.name} <span className="mono" style={{fontSize:9,color:"#60a5fa"}}>{s.ticker}</span></span>
                <span className="mono" style={{fontSize:10,color:"#94a3b8",textAlign:"right"}}>{priceLabel(s)}</span>
              </button>
            ))}
          </div>
        </div>
        <div style={{background:"#080f1e",border:"1px solid #1e293b",borderRadius:12,overflow:"hidden"}}>
          <div style={{padding:"14px 16px",borderBottom:"1px solid #1e293b",display:"flex",justifyContent:"space-between",gap:10,alignItems:"center"}}>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:"#e2e8f0"}}>Model Allocation</div>
              <div style={{fontSize:9,color:"#475569"}}>Uses the current budget, Kelly mode, regime, and model toggles</div>
            </div>
            <div className="mono" style={{fontSize:15,fontWeight:700,color:"#4ade80"}}>€{customResults.reduce((s,x)=>s+x.euros,0).toFixed(2)}</div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"42px 1fr 82px 82px 90px 90px",padding:"8px 14px",background:"#0f172a",borderBottom:"1px solid #1e293b"}}>
            {["#","Stock","Score","Win %","Weight","€"].map((h,i)=><div key={h} style={{fontSize:8,fontWeight:700,color:"#1e3a5f",letterSpacing:".08em",textTransform:"uppercase",textAlign:i>1?"right":"left"}}>{h}</div>)}
          </div>
          {customResults.map((s,i)=>(
            <div key={s.ticker} style={{display:"grid",gridTemplateColumns:"42px 1fr 82px 82px 90px 90px",padding:"10px 14px",borderBottom:"1px solid #0f172a",alignItems:"center"}}>
              <div className="mono" style={{fontSize:11,fontWeight:700,color:i<3?"#60a5fa":"#334155"}}>{i+1}</div>
              <div style={{fontSize:12,fontWeight:700,color:"#f8fafc"}}>{s.emoji} {s.name} <span className="mono" style={{fontSize:9,color:"#60a5fa"}}>{s.ticker}</span></div>
              <div className="mono" style={{fontSize:12,fontWeight:700,color:"#4ade80",textAlign:"right"}}>{modelScore(s).toFixed(1)}</div>
              <div className="mono" style={{fontSize:12,fontWeight:700,color:"#22d3ee",textAlign:"right"}}>{(s.pAdj*100).toFixed(1)}%</div>
              <div className="mono" style={{fontSize:12,fontWeight:700,color:"#60a5fa",textAlign:"right"}}>{(s.weight*100).toFixed(1)}%</div>
              <div className="mono" style={{fontSize:13,fontWeight:700,color:"#e2e8f0",textAlign:"right"}}>€{s.euros.toFixed(2)}</div>
            </div>
          ))}
          {!customResults.length&&<div style={{padding:24,color:"#475569",fontSize:12}}>Select stocks to build a model.</div>}
        </div>
      </div>
    </div>
  );
}

function Validation(){
  const [paper,setPaper] = useState(null);
  const [backtest,setBacktest] = useState(null);
  const [snapshots,setSnapshots] = useState([]);
  useEffect(()=>{
    Promise.all([
      fetch(PAPER_URL,{cache:"no-store"}).then(r=>r.ok?r.json():null),
      fetch(FMP_BACKTEST_URL,{cache:"no-store"}).then(r=>r.ok?r.json():null),
      fetch(HISTORY_INDEX_URL,{cache:"no-store"}).then(r=>r.ok?r.json():[]),
    ]).then(([paperData,backtestData,historyData])=>{
      setPaper(paperData);
      setBacktest(backtestData);
      setSnapshots(Array.isArray(historyData)?historyData:[]);
    }).catch(()=>{});
  },[]);
  const pct = value => isNum(value) ? `${(Number(value)*100).toFixed(2)}%` : "-";
  const money = value => isNum(value) ? `$${Number(value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}` : "-";
  const readiness = backtest?.readiness;
  const gates = Array.isArray(readiness?.gates) ? readiness.gates : [];
  const summary = paper?.summary || {};
  const positions = Array.isArray(paper?.positions) ? paper.positions : [];
  const lastSnapshot = snapshots.length ? snapshots[snapshots.length-1] : null;
  const historical = backtest?.metrics || {};
  const statusColor = readiness?.status==="live_pilot_candidate" ? "#4ade80" : "#fbbf24";
  const paperActive = paper?.status==="active";
  const paperStatus = paperActive ? "ACTIVE" : paper?.status==="formula_changed" ? "FROZEN" : "WAITING";
  const metrics = [
    {label:"Readiness",value:readiness?`${readiness.passed}/${readiness.total}`:"-",sub:"validation gates",color:statusColor},
    {label:"Forward evidence",value:String(summary.evidenceDays||0),sub:"paper snapshot days",color:summary.evidenceDays>=90?"#4ade80":"#60a5fa"},
    {label:"Rank IC",value:pct(historical.rankICMean),sub:`p ${isNum(historical.rankICPValueApprox)?Number(historical.rankICPValueApprox).toFixed(3):"-"}`,color:(historical.rankICMean||0)>0?"#4ade80":"#f87171"},
    {label:"Net spread",value:pct(historical.spread?.annualizedReturn),sub:"annualized after costs",color:(historical.spread?.annualizedReturn||0)>0?"#4ade80":"#f87171"},
    {label:"Paper return",value:pct(summary.portfolioReturn),sub:`SPY ${pct(summary.benchmarkReturn)}`,color:(summary.excessReturn||0)>=0?"#4ade80":"#f87171"},
    {label:"Last evidence",value:lastSnapshot?.date||"-",sub:`${snapshots.length} saved snapshots`,color:"#94a3b8"},
  ];
  return(
    <div style={{padding:"20px 22px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:12,flexWrap:"wrap",marginBottom:14}}>
        <div>
          <div style={{fontSize:14,fontWeight:700,color:"#e2e8f0"}}>Model Validation</div>
          <div style={{fontSize:9,color:"#475569",marginTop:3}}>Frozen formula {paper?.formulaVersion||MODEL_FORMULA_VERSIONS[MODEL_V14]} - forward paper account versus SPY</div>
        </div>
        <span className="pill" style={{background:statusColor+"15",color:statusColor,border:`1px solid ${statusColor}40`,fontSize:10}}>
          {readiness?.status==="live_pilot_candidate"?"Live pilot candidate":"Research only"}
        </span>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(6,minmax(110px,1fr))",gap:1,background:"#1e293b",border:"1px solid #1e293b",marginBottom:16}} className="validation-stats">
        {metrics.map(metric=>(
          <div key={metric.label} style={{background:"#080f1e",padding:"12px 14px",minHeight:70}}>
            <div style={{fontSize:8,fontWeight:700,color:"#334155",textTransform:"uppercase",marginBottom:5}}>{metric.label}</div>
            <div className="mono" style={{fontSize:16,fontWeight:700,color:metric.color}}>{metric.value}</div>
            <div style={{fontSize:8,color:"#475569",marginTop:3}}>{metric.sub}</div>
          </div>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"minmax(280px,.8fr) minmax(420px,1.2fr)",gap:16}} className="candidate-grid">
        <section>
          <div style={{fontSize:11,fontWeight:700,color:"#cbd5e1",marginBottom:8}}>Readiness gates</div>
          <div style={{borderTop:"1px solid #1e293b"}}>
            {gates.map(gate=>(
              <div key={gate.id} style={{display:"grid",gridTemplateColumns:"54px 1fr",gap:10,padding:"9px 2px",borderBottom:"1px solid #1e293b",alignItems:"center"}}>
                <span className="mono" style={{fontSize:9,fontWeight:700,color:gate.passed?"#4ade80":"#f87171"}}>{gate.passed?"PASS":"FAIL"}</span>
                <span style={{fontSize:10,color:gate.passed?"#94a3b8":"#cbd5e1"}}>{gate.label}</span>
              </div>
            ))}
            {!gates.length&&<div style={{fontSize:10,color:"#475569",padding:"12px 0"}}>Run the FMP Historical Backtest workflow to generate readiness gates.</div>}
          </div>
        </section>

        <section>
          <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",marginBottom:8}}>
            <div>
              <div style={{fontSize:11,fontWeight:700,color:"#cbd5e1"}}>Forward paper portfolio</div>
              <div style={{fontSize:8,color:"#475569",marginTop:2}}>v14.0.0 - top 20 - monthly - 10 bps costs</div>
            </div>
            <span className="mono" style={{fontSize:9,color:paperActive?"#4ade80":paper?.status==="formula_changed"?"#f87171":"#fbbf24"}}>{paperStatus}</span>
          </div>
          {!paperActive&&(
            <div style={{border:"1px solid #422006",background:"#1c1305",padding:"14px 16px",color:"#fbbf24",fontSize:10,lineHeight:1.7}}>
              {paper?.statusReason||paper?.reason||"The paper portfolio will begin with the next complete Yahoo snapshot and SPY price."}
            </div>
          )}
          {paperActive&&(
            <>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:1,background:"#1e293b",marginBottom:10}}>
                {[
                  ["Value",money(summary.portfolioValue),"#e2e8f0"],
                  ["Excess",pct(summary.excessReturn),(summary.excessReturn||0)>=0?"#4ade80":"#f87171"],
                  ["Max DD",pct(summary.maxDrawdown),"#fb923c"],
                ].map(([label,value,color])=>(
                  <div key={label} style={{background:"#080f1e",padding:"10px 12px"}}>
                    <div style={{fontSize:8,color:"#334155",marginBottom:3}}>{label}</div>
                    <div className="mono" style={{fontSize:13,fontWeight:700,color}}>{value}</div>
                  </div>
                ))}
              </div>
              <div style={{overflowX:"auto",borderTop:"1px solid #1e293b"}}>
                <div style={{display:"grid",gridTemplateColumns:"42px 1fr 76px 76px 80px",gap:8,padding:"8px 4px",borderBottom:"1px solid #1e293b"}}>
                  {["#","Holding","Weight","Score","Value"].map((label,index)=>(
                    <div key={label} style={{fontSize:8,fontWeight:700,color:"#334155",textAlign:index>1?"right":"left"}}>{label}</div>
                  ))}
                </div>
                {positions.map((position,index)=>{
                  const value=(Number(position.shares)||0)*(Number(position.lastPrice)||0);
                  return(
                    <div key={position.ticker} style={{display:"grid",gridTemplateColumns:"42px 1fr 76px 76px 80px",gap:8,padding:"9px 4px",borderBottom:"1px solid #0f172a",alignItems:"center"}}>
                      <div className="mono" style={{fontSize:9,color:"#334155"}}>{index+1}</div>
                      <div>
                        <div style={{fontSize:10,fontWeight:700,color:"#e2e8f0"}}>{position.name}</div>
                        <div className="mono" style={{fontSize:8,color:"#475569"}}>{position.ticker}</div>
                      </div>
                      <div className="mono" style={{fontSize:10,color:"#60a5fa",textAlign:"right"}}>{pct(position.targetWeight)}</div>
                      <div className="mono" style={{fontSize:10,color:"#4ade80",textAlign:"right"}}>{isNum(position.lastScore)?Number(position.lastScore).toFixed(1):"-"}</div>
                      <div className="mono" style={{fontSize:10,color:"#94a3b8",textAlign:"right"}}>{money(value)}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Toggle({label,sub,on,onToggle,color="#00cc77"}){
  return(
    <div style={{background:on?color+"0a":"#0f172a",border:`1px solid ${on?color+"50":"#1e293b"}`,borderRadius:10,padding:"9px 12px",cursor:"pointer",transition:"all .15s",userSelect:"none"}}
      onClick={onToggle}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
        <div style={{fontSize:10,fontWeight:600,color:on?color:"#475569"}}>{label}</div>
        <div style={{width:26,height:13,borderRadius:7,background:on?color:"#1e293b",position:"relative",transition:"background .2s",flexShrink:0}}>
          <div style={{position:"absolute",top:2,left:on?"15px":"2px",width:9,height:9,borderRadius:"50%",background:"#fff",transition:"left .2s"}}/>
        </div>
      </div>
      <div style={{fontSize:8,color:"#334155"}}>{sub}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────────────
export default function App(){
  const [stocks,         setStocks]         = useState(()=>loadStockDatabase());
  const [dbMode,         setDbMode]         = useState(()=>hasLocalStockDatabase()?"local":"published");
  const [budget,         setBudget]         = useState(250);
  const [kellyMult,      setKellyMult]      = useState(0.5);
  const [marketBull,     setMarketBull]     = useState(true);
  const [modelVersion,   setModelVersion]   = useState(MODEL_V13);
  const [eurUsdNow,      setEurUsdNow]      = useState(1.1733);
  const [eurUsdForecast, setEurUsdForecast] = useState(1.175);
  const [flags, setFlags] = useState({blendedP:true,beta:true,drawdown:true,shortInt:true,sector:true,fx:true,earnings:true});
  const [expanded,  setExpanded]  = useState(null);
  const [view,      setView]      = useState("table");
  const [mcResults, setMcResults] = useState(null);
  const [portBands, setPortBands] = useState(null);
  const [scanData,  setScanData]  = useState(null);
  const [running,   setRunning]   = useState(false);
  const [mcSeed,    setMcSeed]    = useState(12345);
  const toggle = k => setFlags(f=>({...f,[k]:!f[k]}));

  const runSim = useCallback((seed)=>{
    if(stocks.length>MC_STOCK_LIMIT){
      setRunning(false); setMcResults(null);
      return;
    }
    setRunning(true); setMcResults(null); setPortBands(null);
    setTimeout(()=>{ const mc=runMonteCarlo(stocks,seed,eurUsdNow,eurUsdForecast); setMcResults(mc); setRunning(false); },50);
  },[stocks,eurUsdNow,eurUsdForecast]);

  useEffect(()=>{ if(dbMode==="local") saveStockDatabase(stocks); },[stocks,dbMode]);
  useEffect(()=>{
    fetch(SCAN_URL,{cache:"no-store"})
      .then(r=>r.ok?r.json():null)
      .then(data=>{ if(data&&Array.isArray(data.results)) setScanData(data); })
      .catch(()=>{});
  },[]);
  useEffect(()=>{
    if(dbMode!=="published") return;
    fetch(DATA_URL,{cache:"no-store"})
      .then(r=>r.ok?r.json():null)
      .then(data=>{ if(Array.isArray(data)&&data.length) setStocks(data.map(normalizeStock)); })
      .catch(()=>{});
  },[dbMode]);

  useEffect(()=>{ setMcResults(null); setPortBands(null); },[stocks,eurUsdNow,eurUsdForecast]);

  const results = useMemo(
    ()=>runModel(stocks,mcResults,budget,kellyMult,flags,marketBull,eurUsdNow,eurUsdForecast,modelVersion),
    [stocks,mcResults,budget,kellyMult,flags,marketBull,eurUsdNow,eurUsdForecast,modelVersion]
  );
  const portfolioSimRows = useMemo(()=>results.slice(0,Math.min(PORT_SIM_STOCK_LIMIT,results.length)),[results]);
  const portfolioSimWeights = useMemo(()=>{
    const total=portfolioSimRows.reduce((s,x)=>s+x.weight,0)||1;
    return portfolioSimRows.map(s=>s.weight/total);
  },[portfolioSimRows]);

  useEffect(()=>{
    setPortBands(null);
  },[budget,kellyMult,flags,marketBull,modelVersion,stocks,mcResults,eurUsdNow,eurUsdForecast]);

  useEffect(()=>{
    if(view!=="chart" || portBands) return;
    const id=setTimeout(()=>{
      setPortBands(runPortfolioSim(portfolioSimRows,portfolioSimWeights,budget,mcSeed+7,eurUsdNow,eurUsdForecast));
    },50);
    return()=>clearTimeout(id);
  },[view,portBands,portfolioSimRows,portfolioSimWeights,budget,mcSeed,eurUsdNow,eurUsdForecast]);

  const maxEuros   = results[0]?.euros||1;
  const totalFloor = results.reduce((s,x)=>s+x.floor,0);
  const totalW     = results.reduce((s,x)=>s+x.weight,0);
  const totalE     = results.reduce((s,x)=>s+x.euros,0);
  const kellyLabel = kellyMult===1?"Full Kelly":kellyMult===0.5?"Half Kelly":"Quarter Kelly";
  const modelLabel = MODEL_LABELS[modelVersion] || MODEL_LABELS[MODEL_V13];
  const allocationRows = results.slice(0,Math.min(200,results.length));
  const canRunMc   = stocks.length<=MC_STOCK_LIMIT;
  const portMed    = portBands?.p50[PORT_STEPS];
  const portP10    = portBands?.p10[PORT_STEPS];
  const fxPct      = ((eurUsdForecast-eurUsdNow)/eurUsdNow*100).toFixed(2);
  const usePublishedDatabase = () => {
    try{ localStorage.removeItem(STORAGE_KEY); }catch{}
    setDbMode("published");
    fetch(DATA_URL,{cache:"no-store"})
      .then(r=>r.ok?r.json():null)
      .then(data=>{ if(Array.isArray(data)&&data.length) setStocks(data.map(normalizeStock)); else setStocks(BASE_STOCKS); })
      .catch(()=>setStocks(BASE_STOCKS));
  };

  const flagDefs=[
    {k:"blendedP",   label:modelVersion===MODEL_V14?"🔀 Optimized Conviction":"🔀 Blended Win Prob",sub:modelVersion===MODEL_V14?"Return+quality+value-risk":"Analyst+Momentum+R/R+SI+EP",color:"#22d3ee"},
    {k:"beta",       label:"β Beta Penalty",      sub:"1/β + dynamic floors",     color:"#34d399"},
    {k:"drawdown",   label:"📉 Drawdown",          sub:"Analytical loss floor",    color:"#f87171"},
    {k:"shortInt",   label:"🩳 Short Interest",    sub:"Penalty on top of blend",  color:"#fb923c"},
    {k:"sector",     label:"📊 Sector Overlap",    sub:"−8% per AI stock",         color:"#e879f9"},
    {k:"earnings",   label:"📅 Earnings",          sub:"Proximity multiplier",     color:"#fbbf24"},
  ];

  return(
    <div style={{minHeight:"100vh",background:"#020617",color:"#e2e8f0",fontFamily:"'Inter','DM Sans',system-ui,sans-serif"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:4px;height:4px;}::-webkit-scrollbar-track{background:#0f172a;}::-webkit-scrollbar-thumb{background:#334155;border-radius:2px;}
        .mono{font-family:'JetBrains Mono',monospace;}
        .pill{display:inline-flex;align-items:center;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:500;}
        .btn{background:#1e293b;border:1px solid #334155;color:#94a3b8;font-family:inherit;font-size:11px;font-weight:500;padding:6px 14px;border-radius:8px;cursor:pointer;transition:all .15s;}
        .btn:hover{background:#334155;color:#e2e8f0;}.btn.active{background:#3b82f6;border-color:#3b82f6;color:#fff;}
        .ni{background:#1e293b;border:1px solid #334155;color:#e2e8f0;font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:500;padding:6px 10px;border-radius:8px;width:100px;outline:none;}
        .ni:focus{border-color:#3b82f6;box-shadow:0 0 0 3px #3b82f620;}.ni-sm{width:78px;}
        .row-card{border-bottom:1px solid #0a0f1e;transition:background .12s;cursor:pointer;}
        .row-card:hover,.row-card.sel{background:#0f172a;}
        .view-btn{background:transparent;border:none;color:#475569;font-family:inherit;font-size:11px;font-weight:600;padding:7px 16px;border-radius:8px;cursor:pointer;transition:all .15s;letter-spacing:.04em;text-transform:uppercase;}
        .view-btn.active{background:#1e293b;color:#e2e8f0;}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}.pulsing{animation:pulse 1.1s ease-in-out infinite;}
        @media(max-width:920px){.candidate-grid{grid-template-columns:1fr!important;}.validation-stats{grid-template-columns:repeat(3,1fr)!important;}}
        @media(max-width:780px){.hide-sm{display:none!important;}.grid-flags{grid-template-columns:repeat(2,1fr)!important;}.grid-stats{grid-template-columns:repeat(2,1fr)!important;}}
        @media(max-width:560px){.validation-stats{grid-template-columns:repeat(2,1fr)!important;}}
      `}</style>

      {/* HEADER */}
      <div style={{background:"linear-gradient(135deg,#0f172a 0%,#1e1b4b 50%,#0f172a 100%)",borderBottom:"1px solid #1e293b",padding:"18px 22px 14px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:10}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:4}}>
              <h1 style={{fontFamily:"Inter",fontSize:23,fontWeight:700,letterSpacing:"-.02em",background:"linear-gradient(135deg,#60a5fa,#a78bfa,#34d399)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>
                Kelly Criterion Portfolio
              </h1>
              <span className="pill" style={{background:"#1e293b",color:"#60a5fa",border:"1px solid #3b82f630"}}>{modelLabel.short}</span>
              <span className="pill" style={{background:modelVersion===MODEL_V14?"#312e81":"#083344",color:modelVersion===MODEL_V14?"#c4b5fd":"#22d3ee",border:`1px solid ${modelVersion===MODEL_V14?"#a78bfa40":"#22d3ee40"}`}}>{modelLabel.pill}</span>
              <span className="pill" style={{background:"#052e16",color:"#4ade80",border:"1px solid #4ade8040"}}>{stocks.length} stocks · {dbMode}</span>
              {dbMode==="local"&&<button className="btn" onClick={usePublishedDatabase} style={{padding:"3px 9px",fontSize:9}}>Use Yahoo DB</button>}
              {running&&<span className="pill pulsing" style={{background:"#451a03",color:"#fb923c",border:"1px solid #fb923c40"}}>⟳ MC Running</span>}
            </div>
            <p style={{fontSize:11,color:"#475569"}}>
              {stocks.length>MC_STOCK_LIMIT
                ? `Large database mode: ranking all ${stocks.length} stocks; simulations use shortlist views · ${LAST_REVIEW}`
                : modelVersion===MODEL_V14
                ? `Optimized = expected return + quality + valuation + growth - risk - data confidence penalty · ${LAST_REVIEW}`
                : `Win prob = Analyst(40%) + Momentum(20%) + R/R(20%) + Short Int(10%) + Earnings(10%) · ${LAST_REVIEW}`}
            </p>
          </div>
          <button className={`btn${canRunMc?" active":""}`} disabled={!canRunMc} onClick={()=>{const s=(Date.now()%99997)+1;setMcSeed(s);runSim(s);}}
            style={{display:"flex",alignItems:"center",gap:6,opacity:canRunMc?1:.45,cursor:canRunMc?"pointer":"not-allowed"}}>
            <span style={{fontSize:14}}>↺</span> Re-run MC
          </button>
        </div>
      </div>

      {/* STATS */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:1,background:"#1e293b",borderBottom:"1px solid #1e293b"}} className="grid-stats">
        {[
          {l:"Budget",        v:`€${Number(budget).toLocaleString()}`,  c:"#60a5fa"},
          {l:"Kelly Mode",    v:kellyLabel,                              c:"#fbbf24"},
          {l:"Floor Reserved",v:`${(totalFloor*100).toFixed(1)}%`,      c:"#fb923c", s:`€${(totalFloor*budget).toFixed(2)}`},
          {l:"Kelly Pool",    v:`${((1-totalFloor)*100).toFixed(1)}%`,  c:"#34d399", s:`€${((1-totalFloor)*budget).toFixed(2)}`},
          {l:"MC Median",     v:portMed?`€${portMed.toFixed(0)}`:"—",  c:"#34d399", s:portMed?`+${((portMed/budget-1)*100).toFixed(0)}%`:null},
          {l:"Downside P10",  v:portP10?`€${portP10.toFixed(0)}`:"—",  c:portP10&&portP10<budget?"#f87171":"#34d399",s:portP10?`${((portP10/budget-1)*100).toFixed(0)}%`:null},
        ].map((x,i)=>(
          <div key={i} style={{background:"#020617",padding:"10px 14px"}}>
            <div style={{fontSize:8,fontWeight:600,color:"#334155",letterSpacing:".06em",textTransform:"uppercase",marginBottom:2}}>{x.l}</div>
            <div className="mono" style={{fontSize:17,fontWeight:700,color:x.c,lineHeight:1}}>{x.v}</div>
            {x.s&&<div style={{fontSize:8,color:"#1e293b",marginTop:1}}>{x.s}</div>}
          </div>
        ))}
      </div>

      {/* CONTROLS */}
      <div style={{padding:"12px 22px",borderBottom:"1px solid #1e293b",display:"flex",gap:16,flexWrap:"wrap",alignItems:"flex-end",background:"#020617"}}>
        <div>
          <div style={{fontSize:9,fontWeight:600,color:"#334155",letterSpacing:".06em",textTransform:"uppercase",marginBottom:4}}>Model</div>
          <div style={{display:"flex",gap:4}}>
            {MODEL_OPTIONS.map(o=>(
              <button key={o.value} className={`btn${modelVersion===o.value?" active":""}`} onClick={()=>setModelVersion(o.value)}>{o.label}</button>
            ))}
          </div>
        </div>
        <div>
          <div style={{fontSize:9,fontWeight:600,color:"#334155",letterSpacing:".06em",textTransform:"uppercase",marginBottom:4}}>Budget (€)</div>
          <input className="ni" type="number" min={10} value={budget} onChange={e=>setBudget(Math.max(10,Number(e.target.value)))}/>
        </div>
        <div>
          <div style={{fontSize:9,fontWeight:600,color:"#334155",letterSpacing:".06em",textTransform:"uppercase",marginBottom:4}}>Kelly Fraction</div>
          <div style={{display:"flex",gap:4}}>
            {[{l:"Full",v:1},{l:"Half",v:0.5},{l:"Quarter",v:0.25}].map(o=>(
              <button key={o.v} className={`btn${kellyMult===o.v?" active":""}`} onClick={()=>setKellyMult(o.v)}>{o.l}</button>
            ))}
          </div>
        </div>
        <div>
          <div style={{fontSize:9,fontWeight:600,color:"#334155",letterSpacing:".06em",textTransform:"uppercase",marginBottom:4}}>Market Regime</div>
          <div style={{display:"flex",gap:4}}>
            {[{l:"🟢 Bull ×1.0",v:true},{l:"🔴 Bear ×0.7",v:false}].map(o=>(
              <button key={String(o.v)} className={`btn${marketBull===o.v?" active":""}`} onClick={()=>setMarketBull(o.v)}>{o.l}</button>
            ))}
          </div>
        </div>
        <div>
          <div style={{fontSize:9,fontWeight:600,color:"#334155",letterSpacing:".06em",textTransform:"uppercase",marginBottom:4}}>EUR/USD</div>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <div><div style={{fontSize:8,color:"#334155",marginBottom:2}}>Current</div><input className="ni ni-sm" type="number" step="0.001" value={eurUsdNow} onChange={e=>setEurUsdNow(parseFloat(e.target.value)||1.17)}/></div>
            <span style={{color:"#334155",paddingTop:14}}>→</span>
            <div><div style={{fontSize:8,color:"#334155",marginBottom:2}}>Forecast</div><input className="ni ni-sm" type="number" step="0.001" value={eurUsdForecast} onChange={e=>setEurUsdForecast(parseFloat(e.target.value)||1.18)}/></div>
          </div>
        </div>
      </div>

      {/* TOGGLES */}
      <div style={{padding:"12px 22px",borderBottom:"1px solid #1e293b",background:"#020617"}}>
        <div style={{fontSize:9,fontWeight:600,color:"#334155",letterSpacing:".06em",textTransform:"uppercase",marginBottom:8}}>Model Adjustments</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:7}} className="grid-flags">
          {flagDefs.map(f=><Toggle key={f.k} label={f.label} sub={f.sub} on={flags[f.k]} onToggle={()=>toggle(f.k)} color={f.color}/>)}
        </div>
      </div>

      {/* TABS */}
      <div style={{padding:"8px 22px",borderBottom:"1px solid #1e293b",display:"flex",gap:4,background:"#020617",flexWrap:"wrap"}}>
        {[{l:"Allocations",v:"table"},{l:"Portfolio Chart",v:"chart"},{l:"Scanner",v:"scanner"},{l:"Yahoo Scan",v:"scan"},{l:"Database",v:"database"},{l:"Fundamentals",v:"fundamentals"},{l:"Create Model",v:"create"},{l:"Stock Search",v:"search"},{l:"Validation",v:"validation"},{l:"🔀 Win Prob Breakdown",v:"prob"}].map(o=>(
          <button key={o.v} className={`view-btn${view===o.v?" active":""}`} onClick={()=>setView(o.v)}
            style={o.v==="prob"?{color:view==="prob"?"#e2e8f0":"#22d3ee"}:{}}>{o.l}</button>
        ))}
      </div>

      {view==="chart"&&<div style={{padding:"20px 22px"}}><PortfolioChart bands={portBands} budget={budget}/></div>}
      {view==="scanner"&&<Scanner results={results} setView={setView}/>}
      {view==="scan"&&<YahooScan scanData={scanData} setStocks={setStocks} setDbMode={setDbMode} setView={setView}/>}
      {view==="database"&&<StockDatabase stocks={stocks} results={results} setStocks={setStocks} setView={setView} setDbMode={setDbMode}/>}
      {view==="fundamentals"&&<Fundamentals results={results}/>}
      {view==="create"&&<CreateModel stocks={stocks} results={results} budget={budget} kellyMult={kellyMult} flags={flags} marketBull={marketBull} eurUsdNow={eurUsdNow} eurUsdForecast={eurUsdForecast} modelVersion={modelVersion}/>}
      {view==="search"&&<StockSearch portfolioResults={results}/>}
      {view==="validation"&&<Validation/>}
      {view==="prob"&&<ProbBreakdownPanel stocks={stocks}/>}

      {view==="table"&&(
        <div>
          <div style={{display:"grid",gridTemplateColumns:"36px 1fr 76px 90px 68px 88px 72px 68px 68px 150px 88px",padding:"9px 22px",borderBottom:"1px solid #1e293b",background:"#080f1e"}}>
            {["#","Stock","Price","Win Prob","Upside","Beta","Short","Earn.","Floor","Weight","€ Amount"].map((h,i)=>(
              <div key={i} style={{fontSize:8,fontWeight:700,color:"#1e3a5f",letterSpacing:".08em",textTransform:"uppercase",textAlign:i>=9||i===2?"right":"left"}}>{h}</div>
            ))}
          </div>

          {allocationRows.map((s,ri)=>{
            const pColor  = s.pAdj>0.75?"#4ade80":s.pAdj>0.60?"#fbbf24":"#f87171";
            const bColor  = s.beta<1.5?"#4ade80":s.beta<2.5?"#fbbf24":"#f87171";
            const siColor = s.shortInt>0.15?"#f87171":s.shortInt>0.07?"#fbbf24":"#4ade80";
            const epColor = s.epMult<0.90?"#f87171":s.epMult<0.97?"#fbbf24":"#4ade80";
            const isExp   = expanded===s.ticker;
            const mc      = mcResults?.find(m=>m.ticker===s.ticker);
            const barW    = (s.euros/maxEuros)*100;
            const floorW  = Math.min(barW,(s.floor*budget/maxEuros)*100);
            const ytdColor= s.ytd>0.15?"#f87171":s.ytd<-0.15?"#4ade80":"#64748b";
            const paDelta  = (s.pAdj - s.bp.pa)*100;
            const isV14 = s.modelVersion===MODEL_V14;
            const opt = s.opt;
            const pctV = v => v===null||v===undefined ? "—" : `${(v*100).toFixed(0)}%`;

            return(
              <div key={s.ticker}>
                <div className={`row-card${isExp?" sel":""}`}
                  style={{display:"grid",gridTemplateColumns:"36px 1fr 76px 90px 68px 88px 72px 68px 68px 150px 88px",padding:"11px 22px",alignItems:"center"}}
                  onClick={()=>setExpanded(isExp?null:s.ticker)}>
                  <div style={{fontFamily:"monospace",fontSize:12,fontWeight:700,color:"#1e293b"}}>{ri+1}</div>
                  <div>
                    <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>
                      <span style={{fontSize:14}}>{s.emoji}</span>
                      <span style={{fontSize:12,fontWeight:600,color:"#f1f5f9"}}>{s.name}</span>
                      <span style={{fontSize:8,color:"#334155",background:"#1e293b",padding:"1px 5px",borderRadius:4,fontFamily:"monospace"}}>{s.ticker}</span>
                      {s.isFloorOnly&&<span className="pill" style={{background:"#451a03",color:"#fb923c",border:"1px solid #fb923c30",fontSize:7}}>floor</span>}
                      {s.isCapped  &&<span className="pill" style={{background:"#172554",color:"#60a5fa",border:"1px solid #60a5fa30",fontSize:7}}>cap</span>}
                    </div>
                    <div style={{fontSize:9,color:"#334155",marginTop:2,display:"flex",gap:5}}>
                      <span>{SECTOR_LABELS[s.sector]}</span>
                      <span style={{color:s.fxExposed?"#38bdf8":"#475569"}}>{s.fxExposed?"USD":"EUR"}</span>
                      <span style={{color:ytdColor,fontFamily:"monospace"}}>{s.ytd>0?"+":""}{(s.ytd*100).toFixed(0)}%YTD</span>
                    </div>
                  </div>
                  <div className="mono" style={{fontSize:11,fontWeight:700,color:s.currentPrice?"#94a3b8":"#334155",textAlign:"right"}}>{priceLabel(s)}</div>

                  {/* Win prob / conviction */}
                  <div>
                    <span className="pill" style={{background:pColor+"15",color:pColor,border:`1px solid ${pColor}30`,fontSize:11,fontWeight:700}}>
                      {(s.pAdj*100).toFixed(1)}%
                    </span>
                    {flags.blendedP&&(
                      <div style={{fontSize:8,color:paDelta<-1?"#f87171":paDelta>1?"#4ade80":"#475569",marginTop:1}}>
                        {paDelta>0?"▲":"▼"}{Math.abs(paDelta).toFixed(0)}pp vs analyst
                      </div>
                    )}
                  </div>

                  <div style={{fontFamily:"monospace",fontSize:11,fontWeight:600,color:"#94a3b8"}}>+{(s.fxAdjUpside*100).toFixed(0)}%</div>
                  <div>
                    <div style={{display:"flex",alignItems:"center",gap:4,marginBottom:2}}>
                      <div style={{flex:1,height:3,background:"#1e293b",borderRadius:2,overflow:"hidden"}}>
                        <div style={{width:`${Math.min(100,(s.beta/5)*100)}%`,height:"100%",background:bColor}}/>
                      </div>
                      <span style={{fontFamily:"monospace",fontSize:10,fontWeight:600,color:bColor,minWidth:20,textAlign:"right"}}>β{s.beta}</span>
                    </div>
                    <div style={{fontSize:8,color:"#334155"}}>σ={(s.beta*MARKET_VOL*100).toFixed(0)}%</div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:3}}>
                    <div style={{flex:1,height:3,background:"#1e293b",borderRadius:2,overflow:"hidden"}}>
                      <div style={{width:`${Math.min(100,(s.shortInt/0.30)*100)}%`,height:"100%",background:siColor}}/>
                    </div>
                    <span style={{fontFamily:"monospace",fontSize:10,fontWeight:600,color:siColor,minWidth:18,textAlign:"right"}}>{(s.shortInt*100).toFixed(0)}%</span>
                  </div>
                  <div style={{fontFamily:"monospace",fontSize:10,fontWeight:600,color:epColor}}>×{s.epMult.toFixed(2)}</div>
                  <div style={{fontFamily:"monospace",fontSize:10,fontWeight:600,color:"#fb923c"}}>{(s.floor*100).toFixed(1)}%</div>
                  <div>
                    <div style={{display:"flex",alignItems:"center",gap:4}}>
                      <div style={{flex:1,height:5,background:"#1e293b",borderRadius:3,overflow:"hidden",display:"flex"}}>
                        <div style={{width:`${floorW}%`,height:"100%",background:"#fb923c33",transition:"width .5s"}}/>
                        <div style={{width:`${Math.max(0,barW-floorW)}%`,height:"100%",background:s.color,transition:"width .5s"}}/>
                      </div>
                      <span style={{fontFamily:"monospace",fontSize:11,fontWeight:700,color:"#cbd5e1",minWidth:34,textAlign:"right"}}>
                        {(s.weight*100).toFixed(1)}%
                      </span>
                    </div>
                    {mc&&<div style={{fontSize:8,color:"#334155",marginTop:1}}>Med +{(mc.p50*100).toFixed(0)}% · P5 {(mc.p5*100).toFixed(0)}%</div>}
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div className="mono" style={{fontSize:15,fontWeight:700,color:ri===0?"#60a5fa":s.isFloorOnly?"#fb923c":"#94a3b8"}}>€{s.euros.toFixed(2)}</div>
                  </div>
                </div>

                {isExp&&(
                  <div style={{background:"#080f1e",borderBottom:"1px solid #1e293b",padding:"14px 22px",display:"grid",gridTemplateColumns:"1fr 1.6fr",gap:20}}>
                    <div>
                      <div style={{fontSize:9,fontWeight:700,color:"#334155",letterSpacing:".06em",textTransform:"uppercase",marginBottom:8}}>Factor Breakdown</div>
                      {(isV14?[
                        {l:"Model",           v:"v14 Optimized Risk",                                                                  c:"#c4b5fd"},
                        {l:"Analyst base",    v:`${(s.bp.pa*100).toFixed(0)}%`,                                                        c:"#60a5fa"},
                        {l:"Optimized p",     v:`${pctV(opt?.optimizedP)}  (${(paDelta>0?"▲":"▼")+(Math.abs(paDelta).toFixed(0))}pp vs analyst)`, c:"#22d3ee"},
                        {l:"Expected return", v:pctV(opt?.expectedReturn),                                                             c:"#4ade80"},
                        {l:"Expected loss",   v:pctV(opt?.expectedLoss),                                                               c:"#f87171"},
                        {l:"Quality",         v:`${fmtScore(opt?.fs?.quality)} / 100  (${opt?.fs?.qualityCount??0} fields)`,           c:"#a78bfa"},
                        {l:"Valuation",       v:`${fmtScore(opt?.fs?.valuation)} / 100  (${opt?.fs?.valuationCount??0} fields)`,       c:"#fbbf24"},
                        {l:"Growth",          v:pctV(opt?.growth),                                                                     c:"#34d399"},
                        {l:"Risk score",      v:pctV(opt?.riskScore),                                                                  c:"#fb923c"},
                        {l:"Data confidence", v:pctV(opt?.dataConfidence),                                                             c:"#94a3b8"},
                        {l:"Raw Kelly f*",    v:s.rawK<0?"Negative — floor only":(s.rawK*100).toFixed(1)+"%",                          c:s.rawK<0?"#f87171":"#e2e8f0"},
                        {l:"β Multiplier",    v:`×${s.betaMult.toFixed(3)}  (β=${s.beta})`,                                            c:"#34d399"},
                        {l:"Sector",          v:`×${s.secMult.toFixed(2)}  (${SECTOR_LABELS[s.sector]})`,                             c:s.secMult<1?"#fb923c":"#34d399"},
                        {l:"Source",          v:s.analystSrc,                                                                           c:"#64748b"},
                      ]:[
                        {l:"Model",           v:"v13 Blended Kelly",                                                                   c:"#60a5fa"},
                        {l:"p Analyst",       v:`${(s.bp.pa*100).toFixed(0)}%  (×${W_ANALYST})`,                                       c:"#60a5fa"},
                        {l:"p Momentum",      v:`${(s.bp.pm*100).toFixed(0)}%  YTD ${s.ytd>0?"+":""}${(s.ytd*100).toFixed(0)}%  (×${W_MOMENTUM})`, c:"#fbbf24"},
                        {l:"p Reward/Risk",   v:`${(s.bp.prr*100).toFixed(0)}%  ratio ${(s.upside/s.drawdown).toFixed(2)}  (×${W_RR})`,c:"#34d399"},
                        {l:"p Short Int",     v:`${(s.bp.psi*100).toFixed(0)}%  SI ${(s.shortInt*100).toFixed(0)}%  (×${W_SI})`,       c:"#f87171"},
                        {l:"p Earnings",      v:`${(s.bp.pep*100).toFixed(0)}%  ${EARNINGS_DATES[s.ticker]}  (×${W_EP})`,              c:"#a78bfa"},
                        {l:"p BLENDED",       v:`${(s.bp.blend*100).toFixed(1)}%  (${(paDelta>0?"▲":"▼")+(Math.abs(paDelta).toFixed(0))}pp vs analyst)`, c:"#22d3ee"},
                        {l:"Raw Kelly f*",    v:s.rawK<0?"Negative — floor only":(s.rawK*100).toFixed(1)+"%",                          c:s.rawK<0?"#f87171":"#e2e8f0"},
                        {l:"β Multiplier",    v:`×${s.betaMult.toFixed(3)}  (β=${s.beta})`,                                            c:"#34d399"},
                        {l:"Sector",          v:`×${s.secMult.toFixed(2)}  (${SECTOR_LABELS[s.sector]})`,                             c:s.secMult<1?"#fb923c":"#34d399"},
                        {l:"Source",          v:s.analystSrc,                                                                           c:"#64748b"},
                      ]).map((d,j)=>(
                        <div key={j} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderBottom:"1px solid #0f172a"}}>
                          <span style={{fontSize:9,color:"#475569"}}>{d.l}</span>
                          <span style={{fontFamily:"monospace",fontSize:9,fontWeight:600,color:d.c,textAlign:"right",maxWidth:"60%"}}>{d.v}</span>
                        </div>
                      ))}
                    </div>
                    <div>
                      <div style={{fontSize:9,fontWeight:700,color:"#334155",letterSpacing:".06em",textTransform:"uppercase",marginBottom:8}}>MC Distribution</div>
                      {mc?(
                        <>
                          <Sparkline buckets={mc.buckets} color={s.color} p5={mc.p5} p50={mc.p50} p95={mc.p95}/>
                          <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:5,marginTop:8}}>
                            {[
                              {l:"Win%",   v:(mc.pSim*100).toFixed(0)+"%",       c:"#4ade80"},
                              {l:"AvgWin", v:"+"+(mc.avgWin*100).toFixed(0)+"%", c:"#4ade80"},
                              {l:"AvgLoss",v:"−"+(mc.avgLoss*100).toFixed(0)+"%",c:"#f87171"},
                              {l:"MCKelly",v:(mc.kellySim*100).toFixed(0)+"%",   c:"#a78bfa"},
                              {l:"Median", v:"+"+(mc.p50*100).toFixed(0)+"%",    c:"#fbbf24"},
                              {l:"P1",     v:(mc.p1*100).toFixed(0)+"%",         c:"#dc2626"},
                              {l:"P5",     v:(mc.p5*100).toFixed(0)+"%",         c:"#f87171"},
                              {l:"P95",    v:"+"+(mc.p95*100).toFixed(0)+"%",    c:"#4ade80"},
                              {l:"P99",    v:"+"+(mc.p99*100).toFixed(0)+"%",    c:"#22c55e"},
                              {l:"σ",      v:(mc.sigma*100).toFixed(0)+"%",      c:"#64748b"},
                            ].map((x,j)=>(
                              <div key={j} style={{background:"#0f172a",borderRadius:6,padding:"5px 7px",border:"1px solid #1e293b"}}>
                                <div style={{fontSize:7,color:"#334155",marginBottom:2}}>{x.l}</div>
                                <div className="mono" style={{fontSize:11,fontWeight:700,color:x.c}}>{x.v}</div>
                              </div>
                            ))}
                          </div>
                        </>
                      ):<div style={{padding:"20px",textAlign:"center",color:"#334155"}}>Running...</div>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <div style={{display:"grid",gridTemplateColumns:"36px 1fr 76px 90px 68px 88px 72px 68px 68px 150px 88px",padding:"9px 22px",borderTop:"1px solid #1e293b",background:"#080f1e",alignItems:"center"}}>
            <div/>
            <div className="mono" style={{fontSize:9,fontWeight:700,color:"#1e3a5f",letterSpacing:".1em",textTransform:"uppercase"}}>Total</div>
            <div/><div/><div/><div/><div/><div/><div/>
            <div className="mono" style={{fontSize:11,fontWeight:700,color:"#4ade80",textAlign:"right"}}>{(totalW*100).toFixed(2)}%</div>
            <div className="mono" style={{fontSize:14,fontWeight:700,color:"#4ade80",textAlign:"right"}}>€{totalE.toFixed(2)}</div>
          </div>
          <div style={{padding:"5px 22px",fontSize:8,color:"#1e293b",letterSpacing:".08em"}}>
            ↑ CLICK ROW TO EXPAND · CHART FOR PATHS · WIN PROB FOR 5-COMPONENT BREAKDOWN
          </div>
        </div>
      )}

      <div style={{padding:"8px 22px",borderTop:"1px solid #1e293b",background:"#020617",fontSize:7,color:"#1e293b",display:"flex",gap:8,flexWrap:"wrap"}}>
        <span style={{color:"#22d3ee"}}>{modelVersion===MODEL_V14?"▪ v14: expected return + fundamentals - risk, then Kelly allocation":"▪ v13: analyst×0.4+momentum×0.2+R/R×0.2+SI×0.1+earnings×0.1"}</span>
        {["t(5) fat tails","Merton jumps","vol regime","bear corr","momentum drift","full FX"].map(t=><span key={t} style={{color:"#1e3a5f"}}>▪ {t}</span>)}
        <span style={{marginLeft:"auto",color:"#f59e0b44"}}>Not financial advice</span>
      </div>
    </div>
  );
}
