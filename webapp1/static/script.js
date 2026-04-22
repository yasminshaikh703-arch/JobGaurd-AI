// ── State ─────────────────────────────────────────────────────────────────────
let model   = 'xgboost';
let history = [];

// ── Model selector ────────────────────────────────────────────────────────────
function pickModel(el, m) {
  document.querySelectorAll('.model-item')
    .forEach(x => x.classList.remove('sel'));
  el.classList.add('sel');
  model = m;
}

// ── Word counter ──────────────────────────────────────────────────────────────
function onType() {
  const txt   = document.getElementById('job-text').value;
  const words = txt.trim() ? txt.trim().split(/\s+/).length : 0;
  const wc    = document.getElementById('wc');
  wc.textContent = words + ' words';
  wc.className   = 'wc' + (words >= 20 ? ' ok' : '');
}

// ── Fetch URL via Selenium backend ───────────────────────────────────────────
async function fetchURL() {
  const url  = document.getElementById('job-url').value.trim();
  const note = document.getElementById('fetch-note');
  const btn  = document.getElementById('fetch-btn');
  const ta   = document.getElementById('job-text');

  if (!url) { alert('Please enter a URL'); return; }
  if (!url.startsWith('http')) {
    alert('Please enter a valid URL starting with http'); return;
  }

  // Loading state
  btn.textContent = '⏳';
  btn.disabled    = true;
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
      // Success — put text directly in the textarea
      ta.value       = data.text;
      ta.placeholder = '';
      note.textContent = '✅ Job text fetched successfully (' +
        data.word_count + ' words from ' + data.site +
        ') — click Analyze below';
      note.className = 'url-note ok';
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

// ── Analyze ───────────────────────────────────────────────────────────────────
async function analyze() {
  const text = document.getElementById('job-text').value.trim();

  if (!text || text.split(/\s+/).length < 15) {
    showErr('Please enter more text.',
      'Paste the complete job posting — at least 20 words including title, description, and requirements.');
    return;
  }

  const btn     = document.getElementById('analyze-btn');
  const lbl     = document.getElementById('btn-label');
  const spin    = document.getElementById('spin');
  btn.disabled  = true;
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
    showErr('Cannot connect to server.', 'Make sure Flask is running in Anaconda Prompt.');
  }

  btn.disabled    = false;
  lbl.textContent = 'Analyze Job Posting';
  spin.classList.add('hidden');
}

// ── Show result ───────────────────────────────────────────────────────────────
function showResult(data, text) {
  const isF  = data.prediction === 1;
  const box  = document.getElementById('result');

  box.innerHTML = `
    <div class="res-top">
      <div class="res-ic">${isF ? '⚠️' : '✅'}</div>
      <div>
        <div class="res-title">
          ${isF ? 'FRAUDULENT JOB POSTING' : 'GENUINE JOB POSTING'}
        </div>
        <div class="res-meta">
          ${data.text_length} words analyzed · XGBoost · EMSCAD Model
        </div>
      </div>
    </div>
    <div class="res-bars">
      <div class="rb-lbl">Confidence Scores</div>
      <div class="rb-row">
        <span class="rb-name genuine-c">Genuine</span>
        <div class="rb-track">
          <div class="rb-fill g" id="rb-g"></div>
        </div>
        <span class="rb-pct genuine-c" id="rb-gp"></span>
      </div>
      <div class="rb-row">
        <span class="rb-name fraud-c">Fraudulent</span>
        <div class="rb-track">
          <div class="rb-fill f" id="rb-f"></div>
        </div>
        <span class="rb-pct fraud-c" id="rb-fp"></span>
      </div>
    </div>
    <div class="res-tip">
      ${isF
        ? '<strong>⚠ Warning:</strong> This posting shows strong fraud indicators. Do NOT share Aadhaar, bank details, or pay any registration fee. Report this to the platform.'
        : '<strong>✅ Looks Legitimate:</strong> This posting appears genuine. Always independently verify the company through official channels before sharing personal information.'}
    </div>`;

  box.className = 'result ' + (isF ? 'fraudulent' : 'genuine');
  box.classList.remove('hidden');

  // Animate bars
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

// ── Show error ────────────────────────────────────────────────────────────────
function showErr(msg, hint) {
  const box = document.getElementById('result');
  box.className     = 'result';
  box.style.borderColor = 'rgba(255,165,2,.3)';
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="res-top" style="background:rgba(255,165,2,.05);">
      <div class="res-ic" style="background:rgba(255,165,2,.15);">⚠️</div>
      <div>
        <div class="res-title" style="color:#ffa502;">Invalid Input</div>
        <div class="res-meta">${msg}</div>
      </div>
    </div>
    ${hint ? `<div class="res-tip" style="margin:0 22px 20px;
      background:rgba(255,165,2,.05);border-color:rgba(255,165,2,.2);
      color:#ffd48a;">${hint}</div>` : ''}`;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideResult() {
  const b = document.getElementById('result');
  if (b) { b.classList.add('hidden'); b.style.borderColor = ''; }
}

// ── Analysis history ──────────────────────────────────────────────────────────
function addHistory(text, isF, fp, gp) {
  history.unshift({
    preview : text.substring(0,45).replace(/\n/g,' ') + '...',
    isF, fp, gp
  });
  if (history.length > 5) history.pop();

  const el = document.getElementById('history');
  el.innerHTML = history.map(h => `
    <div class="h-item">
      <div class="h-dot ${h.isF ? 'f' : 'g'}"></div>
      <div class="h-text">${h.preview}</div>
      <div class="h-pct" style="color:${h.isF?'#ff4d6d':'#00b894'}">
        ${h.isF ? h.fp : h.gp}%
      </div>
    </div>`).join('');
}

// ── Ticker ────────────────────────────────────────────────────────────────────
const tickerItems = [
  { icon:'🤖', name:'XGBoost',          badge:'98.43% Acc',      cls:'tb-purple' },
  { icon:'🌲', name:'Random Forest',     badge:'Ensemble',        cls:'tb-teal'   },
  { icon:'📊', name:'TF-IDF',            badge:'5,000 Features',  cls:'tb-green'  },
  { icon:'⚖️', name:'SMOTE',             badge:'Balanced',        cls:'tb-amber'  },
  { icon:'🔬', name:'ADASYN',            badge:'Adaptive',        cls:'tb-red'    },
  { icon:'🧠', name:'NLP Pipeline',      badge:'NLTK + SpaCy',    cls:'tb-purple' },
  { icon:'📦', name:'EMSCAD Dataset',    badge:'17,880 Jobs',     cls:'tb-teal'   },
  { icon:'🐍', name:'Python 3.10',       badge:'Scikit-learn',    cls:'tb-green'  },
  { icon:'🔥', name:'Gradient Boosting', badge:'96.95% Acc',      cls:'tb-amber'  },
  { icon:'📈', name:'F1-Score 0.82',     badge:'Best Model',      cls:'tb-red'    },
  { icon:'🛡️', name:'Fraud Detection',   badge:'866 Scams Found', cls:'tb-purple' },
  { icon:'⚡', name:'Real-Time URL',     badge:'Selenium',        cls:'tb-teal'   },
];

(function buildTicker() {
  const track = document.getElementById('ticker');
  if (!track) return;
  track.innerHTML = [...tickerItems, ...tickerItems].map(i => `
    <div class="t-item">
      <span class="t-icon">${i.icon}</span>
      <span class="t-name">${i.name}</span>
      <span class="t-badge ${i.cls}">${i.badge}</span>
    </div>`).join('');
})();

// ── Performance chart bars ────────────────────────────────────────────────────
(function animateChart() {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      document.querySelectorAll('.prow').forEach(row => {
        const a = parseFloat(row.dataset.a);
        const f = parseFloat(row.dataset.f);
        const bars = row.querySelectorAll('.pb');
        if (bars[0]) bars[0].style.width = a + '%';
        if (bars[1]) bars[1].style.width = f + '%';
      });
      observer.disconnect();
    });
  }, { threshold: 0.3 });

  const chart = document.getElementById('perf-chart');
  if (chart) observer.observe(chart);
})();
