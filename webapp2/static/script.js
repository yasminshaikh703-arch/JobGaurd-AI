// ── State ──────────────────────────────────────────────────────────────────
let model   = 'xgboost';
let history = [];

// ── Model selector ──────────────────────────────────────────────────────────
function pickModel(el, m) {
  document.querySelectorAll('.model-item').forEach(x => x.classList.remove('sel'));
  el.classList.add('sel');
  model = m;
}

// ── Word counter ────────────────────────────────────────────────────────────
function onType() {
  const txt   = document.getElementById('job-text').value;
  const words = txt.trim() ? txt.trim().split(/\s+/).length : 0;
  const wc    = document.getElementById('wc');
  wc.textContent = words + ' words';
  wc.className   = 'wc' + (words >= 20 ? ' ok' : '');
}

// ── Fetch URL via Selenium backend ──────────────────────────────────────────
async function fetchURL() {
  const url  = document.getElementById('job-url').value.trim();
  const note = document.getElementById('fetch-note');
  const btn  = document.getElementById('fetch-btn');
  const ta   = document.getElementById('job-text');

  if (!url) { alert('Please enter a URL'); return; }
  if (!url.startsWith('http')) {
    alert('Please enter a valid URL starting with http');
    return;
  }

  btn.textContent  = '⏳';
  btn.disabled     = true;
  note.textContent = 'Fetching job details — please wait 15–20 seconds...';
  note.className   = 'url-note';
  ta.value         = '';
  ta.placeholder   = 'Extracting job description from the page...';
  hideResult();

  try {
    const res  = await fetch('/fetch_url', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ url }),
    });
    const data = await res.json();

    if (data.error) {
      note.textContent = '⚠ Could not fetch — ' + data.error +
        ' Please copy-paste the job text below manually.';
      note.className   = 'url-note warn';
      ta.placeholder   = 'Paste the job description here manually...';
    } else {
      ta.value         = data.text;
      ta.placeholder   = '';
      note.textContent = '✅ Fetched successfully — ' + data.word_count +
        ' words from ' + data.site + '. Click Analyze below.';
      note.className   = 'url-note ok';
      onType();
    }
  } catch (e) {
    note.textContent = '⚠ Connection error. Make sure Flask is running.';
    note.className   = 'url-note warn';
    ta.placeholder   = 'Paste job text manually...';
  }

  btn.textContent = 'Fetch';
  btn.disabled    = false;
}

// ── Analyze ─────────────────────────────────────────────────────────────────
async function analyze() {
  const text = document.getElementById('job-text').value.trim();

  if (!text || text.split(/\s+/).length < 15) {
    showErr('Please enter more text.',
      'Paste the complete job posting including title, description, and requirements.');
    return;
  }

  const btn    = document.getElementById('analyze-btn');
  const lbl    = document.getElementById('btn-label');
  const spin   = document.getElementById('spin');
  btn.disabled = true;
  lbl.textContent = 'Analyzing...';
  spin.classList.remove('hidden');
  hideResult();

  try {
    const res  = await fetch('/predict', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ text, model }),
    });
    const data = await res.json();
    data.error ? showErr(data.error, '') : showResult(data, text);
  } catch (e) {
    showErr('Cannot connect to server.',
      'Make sure Flask is running in Anaconda Prompt.');
  }

  btn.disabled    = false;
  lbl.textContent = 'Analyze Job Posting';
  spin.classList.add('hidden');
}

// ── Show result ──────────────────────────────────────────────────────────────
function showResult(data, text) {
  const isF = data.prediction === 1;
  const box = document.getElementById('result');

  box.innerHTML = `
    <div class="res-top">
      <div class="res-ic">${isF ? '⚠️' : '✅'}</div>
      <div>
        <div class="res-title">
          ${isF ? 'FRAUDULENT JOB POSTING' : 'GENUINE JOB POSTING'}
        </div>
        <div class="res-meta">
          ${data.text_length} words · XGBoost + TF-IDF · EMSCAD Model
        </div>
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
        ? '<strong>⚠ Warning:</strong> This posting shows strong fraud indicators. Do NOT share Aadhaar, bank details, or pay any registration fee. Report this posting to the platform immediately.'
        : '<strong>✅ Looks Legitimate:</strong> This posting appears genuine. Always independently verify the company through official channels before sharing personal information.'}
    </div>`;

  box.className = 'result ' + (isF ? 'fraudulent' : 'genuine');
  box.classList.remove('hidden');

  setTimeout(() => {
    const rg = document.getElementById('rb-g');
    const rf = document.getElementById('rb-f');
    const gp = document.getElementById('rb-gp');
    const fp = document.getElementById('rb-fp');
    if (rg) rg.style.width = data.genuine_pct + '%';
    if (rf) rf.style.width = data.fraud_pct   + '%';
    if (gp) gp.textContent = data.genuine_pct + '%';
    if (fp) fp.textContent = data.fraud_pct   + '%';
  }, 80);

  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  addHistory(text, isF, data.fraud_pct, data.genuine_pct);
}

// ── Show error ───────────────────────────────────────────────────────────────
function showErr(msg, hint) {
  const box = document.getElementById('result');
  box.className     = 'result';
  box.style.borderColor = 'rgba(245,158,11,.28)';
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="res-top" style="background:rgba(245,158,11,.05);">
      <div class="res-ic" style="background:rgba(245,158,11,.14);">⚠️</div>
      <div>
        <div class="res-title" style="color:#f59e0b;">Invalid Input</div>
        <div class="res-meta">${msg}</div>
      </div>
    </div>
    ${hint ? `<div class="res-tip" style="margin:0 20px 18px;
      background:rgba(245,158,11,.05);border-color:rgba(245,158,11,.18);
      color:#fbbf24;">${hint}</div>` : ''}`;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideResult() {
  const b = document.getElementById('result');
  if (b) { b.classList.add('hidden'); b.style.borderColor = ''; }
}

// ── Analysis history ─────────────────────────────────────────────────────────
function addHistory(text, isF, fp, gp) {
  history.unshift({ preview: text.substring(0,45).replace(/\n/g,' ') + '...', isF, fp, gp });
  if (history.length > 5) history.pop();
  const el = document.getElementById('history');
  el.innerHTML = history.map(h => `
    <div class="h-item">
      <div class="h-dot ${h.isF ? 'f' : 'g'}"></div>
      <div class="h-text">${h.preview}</div>
      <div class="h-pct" style="color:${h.isF?'#e5484d':'#00b894'}">
        ${h.isF ? h.fp : h.gp}%
      </div>
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

// ── Performance chart ─────────────────────────────────────────────────────────
(function animateChart() {
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      document.querySelectorAll('.prow').forEach(row => {
        const bars = row.querySelectorAll('.pb');
        if (bars[0]) bars[0].style.width = row.dataset.a + '%';
        if (bars[1]) bars[1].style.width = row.dataset.f + '%';
      });
      obs.disconnect();
    });
  }, { threshold: 0.3 });
  const chart = document.getElementById('perf-chart');
  if (chart) obs.observe(chart);
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
const maxScore = featData[0].score;

(function buildFeatureBars() {
  const container = document.getElementById('feat-bars');
  if (!container) return;

  container.innerHTML = featData.map(f => {
    const pct = ((f.score / maxScore) * 100).toFixed(1);
    return `
      <div class="fb-row">
        <div class="fb-word">${f.word}</div>
        <div class="fb-track">
          <div class="fb-fill ${f.type}"
               data-w="${pct}" style="width:0%;">
            ${f.type === 'fr' ? '⚠' : ''}
          </div>
        </div>
        <div class="fb-score">${f.score.toFixed(4)}</div>
      </div>`;
  }).join('');

  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      container.querySelectorAll('.fb-fill').forEach(bar => {
        bar.style.width = bar.dataset.w + '%';
      });
      obs.disconnect();
    });
  }, { threshold: 0.25 });
  obs.observe(container);
})();
