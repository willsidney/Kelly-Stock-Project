import { useState, useEffect, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const MARKET_VOL    = 0.18;
const TRADING_DAYS  = 252;
const MC_SIMS       = 8000;
const PORT_SIMS     = 400;
const PORT_STEPS    = 52;
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

const SECTOR_LABELS  = { ai:"AI/Tech", travel:"Travel", consumer:"Consumer", semi:"Semiconductors", quantum:"Quantum", payments:"Payments", healthcare:"Healthcare" };
const EARNINGS_DATES = { RYAAY:"Nov 2026", NVDA:"Aug 26", ADDYY:"Aug 2026", ASML:"Jul 2026", AVGO:"Sep 2026", NET:"Aug 2026", PLTR:"Aug 2026", NVO:"Aug 2026", IREN:"Aug 2026", V:"Jul 2026" };
const SECTOR_OPTIONS = [
  ["ai","AI/Tech"],
  ["travel","Travel"],
  ["consumer","Consumer"],
  ["semi","Semiconductors"],
  ["payments","Payments"],
  ["healthcare","Healthcare"],
  ["software","Software"],
  ["industrial","Industrial"],
  ["financial","Financial"],
  ["energy","Energy"],
  ["other","Other"],
];

const DEFAULT_CANDIDATE = {
  name:"Candidate Stock",
  ticker:"TEST",
  sector:"software",
  emoji:"◇",
  color:"#22d3ee",
  strongBuy:45,
  buy:30,
  hold:20,
  sell:5,
  upside:0.30,
  drawdown:0.30,
  shortInt:0.03,
  beta:1.20,
  fxExposed:true,
  earningsDays:90,
  ytd:-0.10,
  analystCount:20,
  analystSrc:"manual entry",
};

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
  const fxDD=Math.log(eurFcast/eurNow)/TRADING_DAYS;
  const allR=stocks.map(()=>new Float64Array(MC_SIMS));
  for(let sim=0;sim<MC_SIMS;sim++){
    const logR=new Float64Array(n); let vr=0;
    for(let t=0;t<TRADING_DAYS;t++){
      if(vr===0&&rng.u()<P_LOW_HIGH) vr=1; else if(vr===1&&rng.u()<P_HIGH_LOW) vr=0;
      const vm=vr===1?VOL_HIGH_MULT:1.0, CH=vr===1?CHOL_BEAR:CHOL_BULL;
      const z=Array.from({length:n+1},()=>rng.tDist(T_DF));
      const zC=new Float64Array(n);
      for(let i=0;i<n;i++) for(let j=0;j<=i;j++) zC[i]+=CH[i][j]*z[j];
      const fxStep=fxDD+FX_SIGMA*rng.normal()*sqdt;
      for(let i=0;i<n;i++){
        const sig=sigmas[i]*vm;
        let step=(mus[i]-0.5*sig*sig)*dt+sig*zC[i]*sqdt;
        if(rng.u()<JUMP_LAMBDA*dt) step+=JUMP_MU*dt+JUMP_SIGMA*rng.normal()*sqdt;
        if(stocks[i].fxExposed){step-=fxStep;step+=FX_CORR[i]*fxStep*0.3;}
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
  const fxDD=Math.log(eurFcast/eurNow)/PORT_STEPS;
  const paths=[];
  for(let sim=0;sim<PORT_SIMS;sim++){
    const path=[budget]; let val=budget,vr=0;
    for(let t=0;t<PORT_STEPS;t++){
      if(vr===0&&rng.u()<P_LOW_HIGH*7) vr=1; else if(vr===1&&rng.u()<P_HIGH_LOW*7) vr=0;
      const vm=vr===1?VOL_HIGH_MULT:1.0,CH=vr===1?CHOL_BEAR:CHOL_BULL;
      const z=Array.from({length:n+1},()=>rng.tDist(T_DF));
      const zC=new Float64Array(n);
      for(let i=0;i<n;i++) for(let j=0;j<=i;j++) zC[i]+=CH[i][j]*z[j];
      const fxStep=fxDD+FX_SIGMA*rng.normal()*sqdt;
      let portR=0;
      for(let i=0;i<n;i++){
        const sig=sigmas[i]*vm;
        let step=(mus[i]-0.5*sig*sig)*dt+sig*zC[i]*sqdt;
        if(rng.u()<JUMP_LAMBDA*dt) step+=JUMP_MU*dt+JUMP_SIGMA*rng.normal()*sqdt;
        if(stocks[i].fxExposed){step-=fxStep;step+=FX_CORR[i]*fxStep*0.3;}
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

function runModel(stocks,mcResults,budget,kellyMult,flags,marketBull,eurNow,eurFcast){
  const n=stocks.length,hardMin=1/(2*n),meanInvB=stocks.reduce((s,x)=>s+1/x.beta,0)/n;
  const CAP=0.20,regime=marketBull?1.0:0.7,fxDrift=(eurFcast-eurNow)/eurNow;
  const sectorCnt={};
  stocks.forEach(s=>sectorCnt[s.sector]=(sectorCnt[s.sector]||0)+1);

  const computed=stocks.map((s,i)=>{
    const mc=mcResults?.[i]??null;

    // Blended win probability (new)
    const bp=blendedP(s);
    const pComposite = flags.blendedP ? bp.blend : bp.pa;
    // Short interest penalty applied on top of blend (existing factor)
    const siP=flags.shortInt?Math.min(0.15,s.shortInt*0.5):0;
    const pAdj=pComposite*(1-siP);

    const fxAdj=flags.fx&&s.fxExposed?fxDrift:0;
    let rawK;
    if(mc&&flags.monteCarlo){
      const pMC=mc.pSim*(1-siP);
      rawK=(pMC*mc.avgWin-(1-pMC)*mc.avgLoss)/(mc.avgWin+mc.avgLoss);
    } else {
      const b=s.upside*(1+fxAdj),d=flags.drawdown?s.drawdown:0.001,q=1-pAdj;
      rawK=flags.drawdown?(pAdj*b-q*d)/(b+d):(pAdj*b-q)/b;
    }

    const bm=flags.beta?1/s.beta:1;
    const sc=sectorCnt[s.sector];
    const sm=flags.sector&&sc>1?Math.max(0.60,1-(sc-1)*0.08):1;
    const em=flags.earnings?earningsMult(s.earningsDays):1;
    const floor=flags.beta?Math.max(hardMin,hardMin*(1/s.beta)/meanInvB):hardMin;
    const adj=Math.max(0,rawK*kellyMult*bm*sm*em*regime);

    return{...s,bp,pAdj,pComposite,rawK,adj,floor,
      fxAdjUpside:s.upside*(1+fxAdj),siP,secMult:sm,epMult:em,betaMult:bm,
      isFloorOnly:adj===0,mc};
  });

  const tFloor=computed.reduce((s,x)=>s+x.floor,0);
  const rem=Math.max(0,1-tFloor),rawSum=computed.reduce((s,x)=>s+x.adj,0);
  const staged=computed.map(s=>({...s,ks:rawSum>0?(s.adj/rawSum)*rem:0,weight:s.floor+(rawSum>0?(s.adj/rawSum)*rem:0)}));
  let exc=0; staged.forEach(s=>{if(s.weight>CAP){exc+=s.weight-CAP;s.weight=CAP;}});
  if(exc>0){const u=staged.filter(s=>s.weight<CAP),us=u.reduce((s,x)=>s+x.weight,0);if(us>0)u.forEach(s=>s.weight+=exc*(s.weight/us));}
  const tw=staged.reduce((s,x)=>s+x.weight,0);
  return staged.map(s=>({...s,weight:s.weight/tw,euros:(s.weight/tw)*budget,isCapped:s.weight>=CAP*0.99})).sort((a,b)=>b.euros-a.euros);
}

function scoreCandidate(candidate, portfolioResults, kellyMult, flags, marketBull, eurNow, eurFcast){
  const existingCount = BASE_STOCKS.reduce((n,s)=>n+(s.sector===candidate.sector?1:0),0);
  const sectorCnt = existingCount + 1;
  const regime = marketBull ? 1.0 : 0.7;
  const fxDrift = (eurFcast - eurNow) / eurNow;
  const bp = blendedP(candidate);
  const pComposite = flags.blendedP ? bp.blend : bp.pa;
  const siP = flags.shortInt ? Math.min(0.15,candidate.shortInt*0.5) : 0;
  const pAdj = pComposite * (1-siP);
  const fxAdj = flags.fx && candidate.fxExposed ? fxDrift : 0;
  const b = Math.max(0.001,candidate.upside*(1+fxAdj));
  const d = flags.drawdown ? Math.max(0.001,candidate.drawdown) : 0.001;
  const q = 1-pAdj;
  const rawK = flags.drawdown ? (pAdj*b-q*d)/(b+d) : (pAdj*b-q)/b;
  const betaMult = flags.beta ? 1/Math.max(0.01,candidate.beta) : 1;
  const secMult = flags.sector && sectorCnt>1 ? Math.max(0.60,1-(sectorCnt-1)*0.08) : 1;
  const epMult = flags.earnings ? earningsMult(candidate.earningsDays) : 1;
  const adj = Math.max(0,rawK*kellyMult*betaMult*secMult*epMult*regime);
  const portfolioBlend = portfolioResults.map(s=>s.bp.blend).sort((a,b)=>a-b);
  const medianBlend = portfolioBlend[Math.floor(portfolioBlend.length/2)] ?? 0;
  const topBlend = Math.max(...portfolioResults.map(s=>s.bp.blend),0);
  const topAdj = Math.max(...portfolioResults.map(s=>s.adj),0);
  const fitScore = topAdj>0 ? Math.min(100,(adj/topAdj)*100) : 0;
  const notes = [
    rawK>0 ? "positive raw Kelly" : "negative raw Kelly",
    bp.blend>=medianBlend ? "above portfolio median win probability" : "below portfolio median win probability",
    bp.blend>=topBlend ? "highest blended probability in the set" : "not highest probability yet",
    secMult<1 ? `${sectorCnt} stocks in ${SECTOR_LABELS[candidate.sector]||candidate.sector}` : "adds sector variety",
    candidate.beta>1.5 ? "high-beta risk penalty" : "beta penalty is moderate",
  ];
  return {...candidate,bp,pComposite,pAdj,siP,fxAdj,rawK,betaMult,secMult,epMult,adj,fitScore,medianBlend,topBlend,topAdj,notes};
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

function CandidateLab({candidate,setCandidate,score,portfolioResults}){
  const update = (key,val) => setCandidate(s=>({...s,[key]:val}));
  const pct = (key,val) => update(key,(parseFloat(val)||0)/100);
  const number = (key,val,fallback=0) => update(key,parseFloat(val)||fallback);
  const ratingTotal = candidate.strongBuy + candidate.buy + candidate.hold + candidate.sell;
  const ratingWarn = Math.abs(ratingTotal-100) > 0.5;
  const topPortfolio = portfolioResults[0];
  const downloadCandidate = () => {
    const blob = new Blob([JSON.stringify({savedAt:new Date().toISOString(),candidate},null,2)],{type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${candidate.ticker || "candidate"}-kelly-inputs.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const resetCandidate = () => setCandidate(DEFAULT_CANDIDATE);
  const metric = (label,value,color="#e2e8f0",sub=null) => (
    <div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:8,padding:"10px 12px"}}>
      <div style={{fontSize:8,fontWeight:700,color:"#334155",letterSpacing:".06em",textTransform:"uppercase",marginBottom:4}}>{label}</div>
      <div className="mono" style={{fontSize:18,fontWeight:700,color,lineHeight:1}}>{value}</div>
      {sub&&<div style={{fontSize:8,color:"#475569",marginTop:4}}>{sub}</div>}
    </div>
  );
  const Field = ({label,children}) => (
    <label style={{display:"block"}}>
      <div style={{fontSize:8,fontWeight:700,color:"#334155",letterSpacing:".06em",textTransform:"uppercase",marginBottom:4}}>{label}</div>
      {children}
    </label>
  );
  const inputStyle = {width:"100%",background:"#0f172a",border:"1px solid #1e293b",color:"#e2e8f0",fontFamily:"inherit",fontSize:12,padding:"8px 10px",borderRadius:8,outline:"none"};
  const notes = score.notes;
  const pColor = score.pAdj>0.75?"#4ade80":score.pAdj>0.60?"#fbbf24":"#f87171";
  const kColor = score.rawK>0?"#4ade80":"#f87171";

  return(
    <div style={{padding:"20px 22px"}}>
      <div className="candidate-grid" style={{display:"grid",gridTemplateColumns:"minmax(320px,0.95fr) minmax(340px,1.05fr)",gap:16}}>
        <div style={{background:"#080f1e",border:"1px solid #1e293b",borderRadius:12,padding:"16px 18px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,marginBottom:14}}>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:"#e2e8f0"}}>Candidate Inputs</div>
              <div style={{fontSize:9,color:"#475569",marginTop:2}}>Manual stock test against the current model settings</div>
            </div>
            <div style={{display:"flex",gap:6}}>
              <button className="btn" onClick={resetCandidate}>Reset</button>
              <button className="btn active" onClick={downloadCandidate}>Save JSON</button>
            </div>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1.4fr .8fr",gap:10,marginBottom:10}}>
            <Field label="Company">
              <input style={inputStyle} value={candidate.name} onChange={e=>update("name",e.target.value)}/>
            </Field>
            <Field label="Ticker">
              <input style={{...inputStyle,fontFamily:"JetBrains Mono,monospace",textTransform:"uppercase"}} value={candidate.ticker} onChange={e=>update("ticker",e.target.value.toUpperCase())}/>
            </Field>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
            <Field label="Sector">
              <select style={inputStyle} value={candidate.sector} onChange={e=>update("sector",e.target.value)}>
                {SECTOR_OPTIONS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label="Currency Exposure">
              <select style={inputStyle} value={candidate.fxExposed?"usd":"eur"} onChange={e=>update("fxExposed",e.target.value==="usd")}>
                <option value="usd">USD exposed</option>
                <option value="eur">EUR/native</option>
              </select>
            </Field>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:10}}>
            {[
              ["strongBuy","Strong Buy"],
              ["buy","Buy"],
              ["hold","Hold"],
              ["sell","Sell"],
            ].map(([key,label])=>(
              <Field key={key} label={label}>
                <input style={{...inputStyle,fontFamily:"JetBrains Mono,monospace"}} type="number" min={0} max={100} value={candidate[key]} onChange={e=>number(key,e.target.value)}/>
              </Field>
            ))}
          </div>
          <div style={{fontSize:9,color:ratingWarn?"#f87171":"#475569",marginBottom:12}}>
            Analyst rating total: {ratingTotal.toFixed(0)}%{ratingWarn?" · should total 100%":""}
          </div>

          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:10}}>
            <Field label="Upside %">
              <input style={{...inputStyle,fontFamily:"JetBrains Mono,monospace"}} type="number" value={(candidate.upside*100).toFixed(0)} onChange={e=>pct("upside",e.target.value)}/>
            </Field>
            <Field label="Drawdown %">
              <input style={{...inputStyle,fontFamily:"JetBrains Mono,monospace"}} type="number" value={(candidate.drawdown*100).toFixed(0)} onChange={e=>pct("drawdown",e.target.value)}/>
            </Field>
            <Field label="YTD %">
              <input style={{...inputStyle,fontFamily:"JetBrains Mono,monospace"}} type="number" value={(candidate.ytd*100).toFixed(0)} onChange={e=>pct("ytd",e.target.value)}/>
            </Field>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
            <Field label="Beta">
              <input style={{...inputStyle,fontFamily:"JetBrains Mono,monospace"}} type="number" step="0.1" value={candidate.beta} onChange={e=>number("beta",e.target.value,1)}/>
            </Field>
            <Field label="Short Interest %">
              <input style={{...inputStyle,fontFamily:"JetBrains Mono,monospace"}} type="number" step="0.1" value={(candidate.shortInt*100).toFixed(1)} onChange={e=>pct("shortInt",e.target.value)}/>
            </Field>
            <Field label="Days To Earnings">
              <input style={{...inputStyle,fontFamily:"JetBrains Mono,monospace"}} type="number" value={candidate.earningsDays} onChange={e=>number("earningsDays",e.target.value,90)}/>
            </Field>
          </div>
        </div>

        <div style={{background:"#080f1e",border:"1px solid #1e293b",borderRadius:12,padding:"16px 18px"}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",marginBottom:14}}>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
                <span style={{fontSize:18}}>{candidate.emoji}</span>
                <div style={{fontSize:16,fontWeight:700,color:"#f8fafc"}}>{candidate.name || "Candidate"}</div>
                <span style={{fontSize:9,color:"#334155",background:"#1e293b",padding:"2px 6px",borderRadius:5,fontFamily:"monospace"}}>{candidate.ticker || "TICKER"}</span>
              </div>
              <div style={{fontSize:9,color:"#475569"}}>{SECTOR_LABELS[candidate.sector] || candidate.sector} · compared with current portfolio</div>
            </div>
            <span className="pill" style={{background:score.fitScore>=75?"#052e16":"#1e293b",color:score.fitScore>=75?"#4ade80":"#94a3b8",border:"1px solid #334155"}}>
              Fit {score.fitScore.toFixed(0)}/100
            </span>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:12}}>
            {metric("Blended p",(score.bp.blend*100).toFixed(1)+"%","#22d3ee",`Analyst-only ${(score.bp.pa*100).toFixed(1)}%`)}
            {metric("Adjusted p",(score.pAdj*100).toFixed(1)+"%",pColor,`SI penalty ${(score.siP*100).toFixed(1)}%`)}
            {metric("Raw Kelly",score.rawK>0?(score.rawK*100).toFixed(1)+"%":"Negative",kColor,"before model multipliers")}
          </div>

          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14}}>
            {metric("Beta x","×"+score.betaMult.toFixed(2),score.betaMult<0.75?"#fbbf24":"#94a3b8")}
            {metric("Sector x","×"+score.secMult.toFixed(2),score.secMult<1?"#fb923c":"#4ade80")}
            {metric("Earnings x","×"+score.epMult.toFixed(2),score.epMult<0.95?"#fbbf24":"#94a3b8")}
            {metric("Adj Kelly",(score.adj*100).toFixed(1)+"%",score.adj>0?"#4ade80":"#f87171")}
          </div>

          <div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:8,padding:"11px 12px",marginBottom:12}}>
            <div style={{fontSize:9,fontWeight:700,color:"#334155",letterSpacing:".06em",textTransform:"uppercase",marginBottom:8}}>Portfolio Comparison</div>
            {[
              ["Top current allocation",topPortfolio?`${topPortfolio.name} · €${topPortfolio.euros.toFixed(2)}`:"—","#60a5fa"],
              ["Candidate blended p",`${(score.bp.blend*100).toFixed(1)}% vs portfolio median ${(score.medianBlend*100).toFixed(1)}%`,"#22d3ee"],
              ["Current best blended p",`${(score.topBlend*100).toFixed(1)}%`,"#a78bfa"],
              ["Candidate adjusted Kelly",`${(score.adj*100).toFixed(1)}% vs current best ${(score.topAdj*100).toFixed(1)}%`,"#4ade80"],
            ].map(([l,v,c])=>(
              <div key={l} style={{display:"flex",justifyContent:"space-between",gap:10,padding:"4px 0",borderBottom:"1px solid #1e293b"}}>
                <span style={{fontSize:9,color:"#475569"}}>{l}</span>
                <span className="mono" style={{fontSize:9,fontWeight:700,color:c,textAlign:"right"}}>{v}</span>
              </div>
            ))}
          </div>

          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {notes.map((n,i)=>(
              <span key={i} className="pill" style={{background:i===0&&score.rawK<=0?"#450a0a":"#0f172a",color:i===0&&score.rawK<=0?"#f87171":"#94a3b8",border:"1px solid #1e293b"}}>{n}</span>
            ))}
          </div>
        </div>
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
  const [budget,         setBudget]         = useState(250);
  const [kellyMult,      setKellyMult]      = useState(0.5);
  const [marketBull,     setMarketBull]     = useState(true);
  const [eurUsdNow,      setEurUsdNow]      = useState(1.1733);
  const [eurUsdForecast, setEurUsdForecast] = useState(1.175);
  const [flags, setFlags] = useState({blendedP:true,monteCarlo:true,beta:true,drawdown:true,shortInt:true,sector:true,fx:true,earnings:true});
  const [expanded,  setExpanded]  = useState(null);
  const [view,      setView]      = useState("table");
  const [mcResults, setMcResults] = useState(null);
  const [portBands, setPortBands] = useState(null);
  const [running,   setRunning]   = useState(false);
  const [mcSeed,    setMcSeed]    = useState(12345);
  const [candidate, setCandidate] = useState(DEFAULT_CANDIDATE);
  const toggle = k => setFlags(f=>({...f,[k]:!f[k]}));

  const runSim = useCallback((seed)=>{
    setRunning(true); setMcResults(null); setPortBands(null);
    setTimeout(()=>{ const mc=runMonteCarlo(BASE_STOCKS,seed,eurUsdNow,eurUsdForecast); setMcResults(mc); setRunning(false); },50);
  },[eurUsdNow,eurUsdForecast]);

  useEffect(()=>{ runSim(mcSeed); },[]);

  const results       = runModel(BASE_STOCKS,mcResults,budget,kellyMult,flags,marketBull,eurUsdNow,eurUsdForecast);
  const candidateScore = scoreCandidate(candidate,results,kellyMult,flags,marketBull,eurUsdNow,eurUsdForecast);
  const weightsByBase = BASE_STOCKS.map(s=>results.find(r=>r.ticker===s.ticker)?.weight??0.1);

  useEffect(()=>{
    if(!mcResults) return;
    const bands=runPortfolioSim(BASE_STOCKS,weightsByBase,budget,mcSeed+7,eurUsdNow,eurUsdForecast);
    setPortBands(bands);
  },[mcResults,budget]);

  const maxEuros   = results[0]?.euros||1;
  const totalFloor = results.reduce((s,x)=>s+x.floor,0);
  const totalW     = results.reduce((s,x)=>s+x.weight,0);
  const totalE     = results.reduce((s,x)=>s+x.euros,0);
  const kellyLabel = kellyMult===1?"Full Kelly":kellyMult===0.5?"Half Kelly":"Quarter Kelly";
  const portMed    = portBands?.p50[PORT_STEPS];
  const portP10    = portBands?.p10[PORT_STEPS];
  const fxPct      = ((eurUsdForecast-eurUsdNow)/eurUsdNow*100).toFixed(2);

  const flagDefs=[
    {k:"blendedP",   label:"🔀 Blended Win Prob",sub:"Analyst+Momentum+R/R+SI+EP",color:"#22d3ee"},
    {k:"monteCarlo", label:"🎲 Monte Carlo",      sub:"t(5)+jumps+regime+FX",     color:"#a78bfa"},
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
        @media(max-width:920px){.candidate-grid{grid-template-columns:1fr!important;}}
        @media(max-width:780px){.hide-sm{display:none!important;}.grid-flags{grid-template-columns:repeat(2,1fr)!important;}.grid-stats{grid-template-columns:repeat(2,1fr)!important;}}
      `}</style>

      {/* HEADER */}
      <div style={{background:"linear-gradient(135deg,#0f172a 0%,#1e1b4b 50%,#0f172a 100%)",borderBottom:"1px solid #1e293b",padding:"18px 22px 14px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:10}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:4}}>
              <h1 style={{fontFamily:"Inter",fontSize:23,fontWeight:700,letterSpacing:"-.02em",background:"linear-gradient(135deg,#60a5fa,#a78bfa,#34d399)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>
                Kelly Criterion Portfolio
              </h1>
              <span className="pill" style={{background:"#1e293b",color:"#60a5fa",border:"1px solid #3b82f630"}}>v13</span>
              <span className="pill" style={{background:"#083344",color:"#22d3ee",border:"1px solid #22d3ee40"}}>🔀 Blended Win Prob</span>
              <span className="pill" style={{background:"#052e16",color:"#4ade80",border:"1px solid #4ade8040"}}>💊 NVO Added</span>
              {running&&<span className="pill pulsing" style={{background:"#451a03",color:"#fb923c",border:"1px solid #fb923c40"}}>⟳ MC Running</span>}
            </div>
            <p style={{fontSize:11,color:"#475569"}}>
              Win prob = Analyst(40%) + Momentum(20%) + R/R(20%) + Short Int(10%) + Earnings(10%) · {LAST_REVIEW}
            </p>
          </div>
          <button className="btn active" onClick={()=>{const s=(Date.now()%99997)+1;setMcSeed(s);runSim(s);}}
            style={{display:"flex",alignItems:"center",gap:6}}>
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
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:7}} className="grid-flags">
          {flagDefs.map(f=><Toggle key={f.k} label={f.label} sub={f.sub} on={flags[f.k]} onToggle={()=>toggle(f.k)} color={f.color}/>)}
        </div>
      </div>

      {/* TABS */}
      <div style={{padding:"8px 22px",borderBottom:"1px solid #1e293b",display:"flex",gap:4,background:"#020617"}}>
        {[{l:"Allocations",v:"table"},{l:"Portfolio Chart",v:"chart"},{l:"Candidate Lab",v:"candidate"},{l:"🔀 Win Prob Breakdown",v:"prob"}].map(o=>(
          <button key={o.v} className={`view-btn${view===o.v?" active":""}`} onClick={()=>setView(o.v)}
            style={o.v==="prob"?{color:view==="prob"?"#e2e8f0":"#22d3ee"}:{}}>{o.l}</button>
        ))}
      </div>

      {view==="chart"&&<div style={{padding:"20px 22px"}}><PortfolioChart bands={portBands} budget={budget}/></div>}
      {view==="candidate"&&<CandidateLab candidate={candidate} setCandidate={setCandidate} score={candidateScore} portfolioResults={results}/>}
      {view==="prob"&&<ProbBreakdownPanel stocks={BASE_STOCKS}/>}

      {view==="table"&&(
        <div>
          <div style={{display:"grid",gridTemplateColumns:"36px 1fr 90px 68px 88px 72px 68px 68px 150px 88px",padding:"9px 22px",borderBottom:"1px solid #1e293b",background:"#080f1e"}}>
            {["#","Stock","Win Prob","Upside","Beta","Short","Earn.","Floor","Weight","€ Amount"].map((h,i)=>(
              <div key={i} style={{fontSize:8,fontWeight:700,color:"#1e3a5f",letterSpacing:".08em",textTransform:"uppercase",textAlign:i>=8?"right":"left"}}>{h}</div>
            ))}
          </div>

          {results.map((s,ri)=>{
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

            return(
              <div key={s.ticker}>
                <div className={`row-card${isExp?" sel":""}`}
                  style={{display:"grid",gridTemplateColumns:"36px 1fr 90px 68px 88px 72px 68px 68px 150px 88px",padding:"11px 22px",alignItems:"center"}}
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

                  {/* Win prob — blended */}
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
                      {[
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
                      ].map((d,j)=>(
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

          <div style={{display:"grid",gridTemplateColumns:"36px 1fr 90px 68px 88px 72px 68px 68px 150px 88px",padding:"9px 22px",borderTop:"1px solid #1e293b",background:"#080f1e",alignItems:"center"}}>
            <div/>
            <div className="mono" style={{fontSize:9,fontWeight:700,color:"#1e3a5f",letterSpacing:".1em",textTransform:"uppercase"}}>Total</div>
            <div/><div/><div/><div/><div/><div/>
            <div className="mono" style={{fontSize:11,fontWeight:700,color:"#4ade80",textAlign:"right"}}>{(totalW*100).toFixed(2)}%</div>
            <div className="mono" style={{fontSize:14,fontWeight:700,color:"#4ade80",textAlign:"right"}}>€{totalE.toFixed(2)}</div>
          </div>
          <div style={{padding:"5px 22px",fontSize:8,color:"#1e293b",letterSpacing:".08em"}}>
            ↑ CLICK ROW TO EXPAND · CHART FOR PATHS · WIN PROB FOR 5-COMPONENT BREAKDOWN
          </div>
        </div>
      )}

      <div style={{padding:"8px 22px",borderTop:"1px solid #1e293b",background:"#020617",fontSize:7,color:"#1e293b",display:"flex",gap:8,flexWrap:"wrap"}}>
        <span style={{color:"#22d3ee"}}>▪ Blended p: analyst×0.4+momentum×0.2+R/R×0.2+SI×0.1+earnings×0.1</span>
        {["t(5) fat tails","Merton jumps","vol regime","bear corr","momentum drift","full FX"].map(t=><span key={t} style={{color:"#1e3a5f"}}>▪ {t}</span>)}
        <span style={{marginLeft:"auto",color:"#f59e0b44"}}>Not financial advice</span>
      </div>
    </div>
  );
}
