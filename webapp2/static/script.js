// ── Config ──────────────────────────────────────────────────────────────────

const CONFIG = {
  sources: [
    { id: 'shine',      base: 'https://jobguard-ai.onrender.com/fetch_url' },
    { id: 'naukri',     base: 'https://jobguard-ai.onrender.com/fetch_url' },
    { id: 'linkedin',   base: 'https://jobguard-ai.onrender.com/fetch_url' },
  ],
  dedup: {
    titleThreshold: 0.85,   // Similarity score to consider titles duplicate
    normalize: s => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim(),
  },
  fetch: {
    timeout:  30_000,        // ms per request
    retries:  3,
    retryGap: 5_000,         // ms between retries (Render cold start buffer)
  },
};

// ── Types ───────────────────────────────────────────────────────────────────
/**
 * @typedef {Object} JobResult
 * @property {string}   id          - Dedup fingerprint
 * @property {string}   source      - Origin source id
 * @property {string}   url         - Original URL
 * @property {string}   title       - Job title
 * @property {string}   text        - Full job text
 * @property {number}   word_count  - Word count
 * @property {string}   site        - Human-readable site name
 * @property {number|null} prediction  - 0=genuine, 1=fraud (null if unanalyzed)
 * @property {number|null} fraud_pct
 * @property {number|null} genuine_pct
 * @property {string}   fetched_at  - ISO timestamp
 */

// ── Utilities ────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function fingerprint(title, site) {
  const norm = CONFIG.dedup.normalize(title + site);
  let h = 0;
  for (let i = 0; i < norm.length; i++) {
    h = Math.imul(31, h) + norm.charCodeAt(i) | 0;
  }
  return (h >>> 0).toString(16);
}

function jaccardSim(a, b) {
  const setA = new Set(a.split(/\s+/));
  const setB = new Set(b.split(/\s+/));
  const inter = [...setA].filter(x => setB.has(x)).length;
  return inter / (setA.size + setB.size - inter);
}

// ── Core Fetch (single URL, with retry) ─────────────────────────────────────
async function fetchOne(sourceBase, url, retries = CONFIG.fetch.retries) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.fetch.timeout);

  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(sourceBase, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ url }),
        signal:  controller.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      clearTimeout(timer);

      if (data.error) throw new Error(data.error);
      return { ok: true, data };
    } catch (err) {
      if (i < retries) {
        await sleep(CONFIG.fetch.retryGap);
        continue;
      }
      clearTimeout(timer);
      return { ok: false, error: err.message };
    }
  }
}

// ── Multi-source Aggregator ──────────────────────────────────────────────────
/**
 * Fetch a job URL across all configured sources concurrently.
 * Returns deduplicated, normalised JobResult array.
 *
 * @param {string[]} urls
 * @returns {Promise<{ jobs: JobResult[], errors: Object[] }>}
 */
async function aggregateJobs(urls) {
  // Build tasks: every (url × source) pair
  const tasks = urls.flatMap(url =>
    CONFIG.sources.map(src => ({ url, src }))
  );

  // Fan out all requests concurrently
  const settled = await Promise.allSettled(
    tasks.map(({ url, src }) => fetchOne(src.base, url).then(r => ({ ...r, url, src })))
  );

  const errors = [];
  const rawJobs = [];

  for (const res of settled) {
    if (res.status === 'rejected') {
      errors.push({ reason: res.reason?.message ?? 'unknown' });
      continue;
    }
    const { ok, data, error, url, src } = res.value;
    if (!ok) {
      errors.push({ source: src.id, url, error });
      continue;
    }

    rawJobs.push({
      id:          fingerprint(data.text?.slice(0, 80) ?? url, src.id),
      source:      src.id,
      url,
      title:       data.title ?? url,
      text:        data.text  ?? '',
      word_count:  data.word_count ?? 0,
      site:        data.site  ?? src.id,
      prediction:  null,
      fraud_pct:   null,
      genuine_pct: null,
      fetched_at:  new Date().toISOString(),
    });
  }

  return {
    jobs:   deduplicate(rawJobs),
    errors,
  };
}

// ── Deduplication ────────────────────────────────────────────────────────────
function deduplicate(jobs) {
  const seen   = new Map();   // id → job (exact dedup)
  const titles = [];          // [{ norm, job }] (fuzzy dedup)

  for (const job of jobs) {
    // Exact fingerprint match
    if (seen.has(job.id)) continue;

    // Fuzzy title match across already-accepted jobs
    const norm = CONFIG.dedup.normalize(job.title);
    const isDup = titles.some(({ t }) =>
      jaccardSim(norm, t) >= CONFIG.dedup.titleThreshold
    );
    if (isDup) continue;

    seen.set(job.id, job);
    titles.push({ t: norm, job });
  }

  return [...seen.values()];
}

// ── Analyze (predict fraud) ──────────────────────────────────────────────────
async function analyzeJobs(jobs, model = 'xgboost') {
  const results = await Promise.allSettled(
    jobs.map(job =>
      fetch('/predict', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text: job.text, model }),
      })
      .then(r => r.json())
      .then(d => ({ ...job, ...d }))
    )
  );

  return results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { ...jobs[i], error: r.reason?.message }
  );
}

// ── Clean API Response Builder ────────────────────────────────────────────────
/**
 * Fetch, deduplicate, and optionally analyze a list of URLs.
 *
 * @param {string[]} urls
 * @param {{ model?: string, analyze?: boolean }} opts
 * @returns {Promise<Object>}
 */
async function processJobs(urls, { model = 'xgboost', analyze = false } = {}) {
  if (!Array.isArray(urls) || !urls.length) {
    return apiResponse([], [], { message: 'No URLs provided' });
  }

  const { jobs, errors } = await aggregateJobs(urls);
  const analyzed = analyze && jobs.length ? await analyzeJobs(jobs, model) : jobs;

  return apiResponse(analyzed, errors);
}

function apiResponse(jobs, errors = [], meta = {}) {
  return {
    success:    errors.length === 0 || jobs.length > 0,
    count:      jobs.length,
    jobs:       jobs.map(sanitize),
    errors,
    meta: {
      sources:    CONFIG.sources.map(s => s.id),
      dedup_algo: 'fingerprint + jaccard',
      threshold:  CONFIG.dedup.titleThreshold,
      timestamp:  new Date().toISOString(),
      ...meta,
    },
  };
}

function sanitize(job) {
  return {
    id:          job.id,
    source:      job.source,
    url:         job.url,
    title:       job.title,
    word_count:  job.word_count,
    site:        job.site,
    prediction:  job.prediction,
    fraud_pct:   job.fraud_pct,
    genuine_pct: job.genuine_pct,
    fetched_at:  job.fetched_at,
    error:       job.error ?? null,
  };
}

// ── Keep-alive (Render free tier) ─────────────────────────────────────────────
(function keepAlive() {
  setTimeout(() => fetch('/ping').catch(() => {}), 2_000);
  setInterval(() => fetch('/ping').catch(() => {}), 10 * 60 * 1_000);
})();

// ── State & Model Selector ───────────────────────────────────────────────────
let activeModel = 'xgboost';

function pickModel(el, m) {
  document.querySelectorAll('.model-item').forEach(x => x.classList.remove('sel'));
  el.classList.add('sel');
  activeModel = m;
}

// ── Word Counter ─────────────────────────────────────────────────────────────
function onType() {
  const txt   = document.getElementById('job-text').value;
  const words = txt.trim() ? txt.trim().split(/\s+/).length : 0;
  const wc    = document.getElementById('wc');
  wc.textContent = `${words} words`;
  wc.className   = `wc${words >= 20 ? ' ok' : ''}`;
}

// ── UI: Fetch & Analyze ───────────────────────────────────────────────────────
async function fetchURL() {
  const url  = document.getElementById('job-url').value.trim();
  const note = document.getElementById('fetch-note');
  const btn  = document.getElementById('fetch-btn');
  const ta   = document.getElementById('job-text');

  if (!url || !url.startsWith('http')) {
    return alert('Please enter a valid URL starting with http');
  }

  btn.textContent = '⏳'; btn.disabled = true;
  note.textContent = 'Fetching job details — please wait...';
  note.className = 'url-note';
  ta.value = ''; ta.placeholder = 'Extracting job description...';
  hideResult();

  const { jobs, errors } = await aggregateJobs([url]);

  if (jobs.length) {
    const job = jobs[0];
    ta.value = job.text; ta.placeholder = '';
    note.textContent = `✅ Fetched — ${job.word_count} words from ${job.site}. Click Analyze below.`;
    note.className = 'url-note ok';
    onType();
  } else {
    note.textContent = `⚠ Could not fetch — ${errors[0]?.error ?? 'unknown error'}. Paste text manually.`;
    note.className = 'url-note warn';
    ta.placeholder = 'Paste job text manually...';
  }

  btn.textContent = 'Fetch'; btn.disabled = false;
}

async function analyze() {
  const text = document.getElementById('job-text').value.trim();
  if (!text || text.split(/\s+/).length < 15) {
    return showErr('Please enter more text.',
      'Paste the complete job posting including title, description, and requirements.');
  }

  const btn  = document.getElementById('analyze-btn');
  const lbl  = document.getElementById('btn-label');
  const spin = document.getElementById('spin');
  btn.disabled = true; lbl.textContent = 'Analyzing...';
  spin.classList.remove('hidden');
  hideResult();

  const result = await processJobs(
    [document.getElementById('job-url').value.trim() || 'manual'],
    { model: activeModel, analyze: true }
  ).catch(() => null);

  if (!result || !result.jobs.length) {
    showErr('Server is starting up.', 'Please wait 30 seconds and try again.');
  } else {
    const job = result.jobs[0];
    job.error ? showErr(job.error, '') : showResult({ ...job, text_length: text.split(/\s+/).length }, text);
  }

  btn.disabled = false; lbl.textContent = 'Analyze Job Posting';
  spin.classList.add('hidden');
}

// ── UI: Result / Error / History ─────────────────────────────────────────────
const analysisHistory = [];

function showResult(data, text) {
  const isF = data.prediction === 1;
  const box = document.getElementById('result');

  box.innerHTML = `
    <div class="res-top">
      <div class="res-ic">${isF ? '⚠️' : '✅'}</div>
      <div>
        <div class="res-title">${isF ? 'FRAUDULENT JOB POSTING' : 'GENUINE JOB POSTING'}</div>
        <div class="res-meta">${data.text_length} words · ${activeModel.toUpperCase()} · EMSCAD Model</div>
      </div>
    </div>
    <div class="res-bars">
      <div class="rb-lbl">Confidence Scores</div>
      <div class="rb-row">
        <span class="rb-name genuine-c">Genuine</span>
        <div class="rb-track"><div class="rb-fill g" id="rb-g"></div></div>
        <span class="rb-pct genuine-c" id="rb-gp"></span>
      </div>
      <div class="rb-row">
        <span class="rb-name fraud-c">Fraudulent</span>
        <div class="rb-track"><div class="rb-fill f" id="rb-f"></div></div>
        <span class="rb-pct fraud-c" id="rb-fp"></span>
      </div>
    </div>
    <div class="res-tip">
      ${isF
        ? '<strong>⚠ Warning:</strong> Do NOT share Aadhaar, bank details, or pay any fee. Report this posting immediately.'
        : '<strong>✅ Looks Legitimate:</strong> Always verify the company through official channels before sharing personal info.'}
    </div>`;

  box.className = `result ${isF ? 'fraudulent' : 'genuine'}`;
  box.classList.remove('hidden');

  setTimeout(() => {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.style.width = val + '%'; };
    const txt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val + '%'; };
    set('rb-g', data.genuine_pct); txt('rb-gp', data.genuine_pct);
    set('rb-f', data.fraud_pct);   txt('rb-fp', data.fraud_pct);
  }, 80);

  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  addHistory(text, isF, data.fraud_pct, data.genuine_pct);
}

function showErr(msg, hint) {
  const box = document.getElementById('result');
  box.className = 'result'; box.style.borderColor = 'rgba(245,158,11,.28)';
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="res-top" style="background:rgba(245,158,11,.05);">
      <div class="res-ic" style="background:rgba(245,158,11,.14);">⚠️</div>
      <div>
        <div class="res-title" style="color:#f59e0b;">Notice</div>
        <div class="res-meta">${msg}</div>
      </div>
    </div>
    ${hint ? `<div class="res-tip" style="margin:0 20px 18px;background:rgba(245,158,11,.05);border-color:rgba(245,158,11,.18);color:#fbbf24;">${hint}</div>` : ''}`;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideResult() {
  const b = document.getElementById('result');
  if (b) { b.classList.add('hidden'); b.style.borderColor = ''; }
}

function addHistory(text, isF, fp, gp) {
  analysisHistory.unshift({ preview: text.substring(0, 45).replace(/\n/g, ' ') + '...', isF, fp, gp });
  if (analysisHistory.length > 5) analysisHistory.pop();
  document.getElementById('history').innerHTML = analysisHistory.map(h => `
    <div class="h-item">
      <div class="h-dot ${h.isF ? 'f' : 'g'}"></div>
      <div class="h-text">${h.preview}</div>
      <div class="h-pct" style="color:${h.isF ? '#e5484d' : '#00b894'}">${h.isF ? h.fp : h.gp}%</div>
    </div>`).join('');
}

// ── Ticker ───────────────────────────────────────────────────────────────────
const tickerItems = [
  { icon:'🤖', name:'XGBoost',          badge:'98.43% Acc',      cls:'tb-p' },
  { icon:'🌲', name:'Random Forest',     badge:'Ensemble',        cls:'tb-t' },
  { icon:'📊', name:'TF-IDF',            badge:'5,000 Features',  cls:'tb-g' },
  { icon:'⚖️', name:'SMOTE',             badge:'Balanced',        cls:'tb-a' },
  { icon:'🔬', name:'ADASYN',            badge:'Adaptive',        cls:'tb-r' },
  { icon:'🧠', name:'NLP Pipeline',      badge:'NLTK + SpaCy',    cls:'tb-p' },
  { icon:'📦', name:'EMSCAD Dataset',    badge:'17,880 Jobs',     cls:'tb-t' },
  { icon:'🐍', name:'Python 3.10',       badge:'Scikit-learn',    cls:'tb-g' },
  { icon:'🔥', name:'Gradient Boosting', badge:'96.95% Acc',      cls:'tb-a' },
  { icon:'📈', name:'F1-Score 0.82',     badge:'Best Model',      cls:'tb-r' },
  { icon:'🛡️', name:'Fraud Detection',   badge:'866 Scams Found', cls:'tb-p' },
  { icon:'⚡', name:'Real-Time URL',     badge:'Auto-Fetch',      cls:'tb-t' },
];

(function buildTicker() {
  const track = document.getElementById('ticker');
  if (!track) return;
  track.innerHTML = [...tickerItems, ...tickerItems].map(i =>
    `<div class="t-item">
      <span class="t-icon">${i.icon}</span>
      <span class="t-name">${i.name}</span>
      <span class="t-badge ${i.cls}">${i.badge}</span>
    </div>`
  ).join('');
})();

// ── Performance Chart ─────────────────────────────────────────────────────────
(function animateChart() {
  const chart = document.getElementById('perf-chart');
  if (!chart) return;
  new IntersectionObserver((entries, obs) => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      document.querySelectorAll('.prow').forEach(row => {
        const bars = row.querySelectorAll('.pb');
        if (bars[0]) bars[0].style.width = row.dataset.a + '%';
        if (bars[1]) bars[1].style.width = row.dataset.f + '%';
      });
      obs.disconnect();
    });
  }, { threshold: 0.3 }).observe(chart);
})();

// ── Feature Importance Bars ───────────────────────────────────────────────────
const featData = [
  { word:'data entry', score:0.0108, type:'fr' },
  { word:'earn',       score:0.0090, type:'fr' },
  { word:'growing',    score:0.0087, type:'ge' },
  { word:'duty',       score:0.0081, type:'ge' },
  { word:'computer',   score:0.0067, type:'ge' },
  { word:'team',       score:0.0067, type:'ge' },
  { word:'clerical',   score:0.0065, type:'ge' },
  { word:'needed',     score:0.0058, type:'fr' },
  { word:'position',   score:0.0056, type:'ge' },
  { word:'oil gas',    score:0.0050, type:'ge' },
  { word:'phone',      score:0.0045, type:'fr' },
  { word:'email',      score:0.0045, type:'fr' },
  { word:'skill',      score:0.0044, type:'ge' },
  { word:'entry',      score:0.0043, type:'fr' },
  { word:'service',    score:0.0043, type:'ge' },
];

(function buildFeatureBars() {
  const container = document.getElementById('feat-bars');
  if (!container) return;
  const max = featData[0].score;
  container.innerHTML = featData.map(f => {
    const pct = ((f.score / max) * 100).toFixed(1);
    return `
      <div class="fb-row">
        <div class="fb-word">${f.word}</div>
        <div class="fb-track">
          <div class="fb-fill ${f.type}" data-w="${pct}" style="width:0%;">
            ${f.type === 'fr' ? '⚠' : ''}
          </div>
        </div>
        <div class="fb-score">${f.score.toFixed(4)}</div>
      </div>`;
  }).join('');

  new IntersectionObserver((entries, obs) => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      container.querySelectorAll('.fb-fill').forEach(bar => {
        bar.style.width = bar.dataset.w + '%';
      });
      obs.disconnect();
    });
  }, { threshold: 0.25 }).observe(container);
})();
