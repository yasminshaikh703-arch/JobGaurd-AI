// =============================================
// JOBGUARD AI - Frontend JavaScript
// Complete Version with Input Validation
// =============================================

let selectedModel = 'xgboost';
let analysisHistory = [];

function switchTab(tab, btn) {
  document.querySelectorAll('.tab-btn')
    .forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-pane')
    .forEach(p => { p.style.display = 'none'; });
  btn.classList.add('active');
  document.getElementById('tab-' + tab).style.display = 'block';
  hideResult();
}

function onTextInput() {
  const text  = document.getElementById('job-text').value;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const wc    = document.getElementById('wc');
  wc.textContent = words + ' words';
  wc.className   = 'word-counter' + (words >= 20 ? ' good' : '');
}

function selectModel(el, model) {
  document.querySelectorAll('.model-opt')
    .forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  selectedModel = model;
}

function hideResult() {
  const box = document.getElementById('result-box');
  if (box) box.classList.add('hidden');
}

async function fetchURL() {
  const url         = document.getElementById('job-url').value.trim();
  const fetchedArea = document.getElementById('fetched-text');
  const btn         = document.querySelector('.fetch-job-btn');

  if (!url) {
    alert('Please enter a URL first');
    return;
  }

  if (!url.startsWith('http')) {
    alert('Please enter a valid URL starting with http');
    return;
  }

  // Clear previous content
  fetchedArea.value             = '';
  fetchedArea.style.borderColor = '';
  fetchedArea.style.background  = '';

  // Show loading state
  btn.textContent = '⏳ Loading...';
  btn.disabled    = true;
  fetchedArea.placeholder =
    'Chrome is opening in background...\n' +
    'Please wait 15-20 seconds ⏳';

  // Show loading in result box
  const box = document.getElementById('result-box');
  box.className     = 'result-box';
  box.style.borderColor = 'rgba(99,102,241,0.3)';
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="result-top" style="background:rgba(99,102,241,0.06);">
      <div class="result-icon-wrap"
           style="background:rgba(99,102,241,0.15);font-size:20px;">⏳</div>
      <div>
        <div class="result-verdict"
             style="color:#818cf8;font-size:15px;">
          Fetching Job Data via Selenium...
        </div>
        <div class="result-meta">
          Chrome opening in background — please wait 15–20 seconds
        </div>
      </div>
    </div>
    <div style="padding:16px 24px 20px;">
      <div style="font-size:13px;color:var(--text2);line-height:2;">
        🌐 Navigating to:
        <span style="color:#818cf8;">${url.substring(0,60)}...</span><br/>
        🤖 Using real Chrome browser (Selenium WebDriver)<br/>
        📄 Loading page and extracting job text...<br/>
        ⏱️ This takes 15-20 seconds — do NOT close this tab!
      </div>
    </div>`;

  try {
    const res  = await fetch('/fetch_url', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ url }),
    });
    const data = await res.json();

    if (data.error) {
      // Show error nicely
      fetchedArea.value             = '';
      fetchedArea.placeholder       = 'Paste job text manually here...';
      fetchedArea.style.borderColor = 'rgba(245,158,11,0.4)';
      box.innerHTML = `
        <div class="result-top"
             style="background:rgba(245,158,11,0.06);">
          <div class="result-icon-wrap"
               style="background:rgba(245,158,11,0.15);
                      font-size:20px;">⚠️</div>
          <div>
            <div class="result-verdict"
                 style="color:#f59e0b;font-size:15px;">
              Could Not Auto-Fetch
            </div>
            <div class="result-meta">
              Use manual copy-paste instead
            </div>
          </div>
        </div>
        <div style="padding:16px 24px 20px;">
          <div style="font-size:14px;color:#fcd34d;
                      line-height:1.8;margin-bottom:14px;">
            ${data.error}
          </div>
          <div style="font-size:13px;color:var(--text2);
                      background:rgba(255,255,255,0.03);
                      border:1px solid var(--border);
                      border-radius:10px;
                      padding:14px;line-height:1.9;">
            <strong style="color:var(--text);">
              ✅ Manual method — always works:
            </strong><br/>
            1. Open the job page in your browser<br/>
            2. Press <strong>Ctrl+A</strong> to select all text<br/>
            3. Press <strong>Ctrl+C</strong> to copy<br/>
            4. Click
               <strong style="color:#6366f1;">
               "Paste Job Text"</strong> tab above<br/>
            5. Paste with <strong>Ctrl+V</strong><br/>
            6. Click <strong>Analyze Job Posting</strong>
          </div>
        </div>`;
      box.style.borderColor = 'rgba(245,158,11,0.3)';

    } else {
      // ✅ SUCCESS — show extracted text
      fetchedArea.value             = data.text;
      fetchedArea.style.borderColor = 'rgba(16,185,129,0.4)';
      fetchedArea.style.background  = 'rgba(16,185,129,0.03)';
      fetchedArea.placeholder       = '';

      box.innerHTML = `
        <div class="result-top"
             style="background:rgba(16,185,129,0.06);">
          <div class="result-icon-wrap"
               style="background:rgba(16,185,129,0.15);
                      font-size:20px;">✅</div>
          <div>
            <div class="result-verdict"
                 style="color:#10b981;font-size:15px;">
              Job Text Fetched Successfully!
            </div>
            <div class="result-meta">
              ${data.word_count} words extracted from ${data.site}
            </div>
          </div>
        </div>
        <div style="padding:16px 24px 20px;">
          <div style="font-size:13px;color:var(--text2);line-height:1.9;">
            ✅ Job description extracted from
            <strong style="color:#10b981;">
              ${data.site}
            </strong><br/>
            📊 <strong>${data.word_count}</strong> words ·
               <strong>${data.char_count}</strong> characters<br/><br/>
            <strong style="color:var(--text);font-size:14px;">
              👇 Now click "Analyze Job Posting" to detect fraud!
            </strong>
          </div>
        </div>`;
      box.className     = 'result-box genuine';
      box.style.borderColor = 'rgba(16,185,129,0.3)';
      box.classList.remove('hidden');
    }

  } catch (e) {
    fetchedArea.placeholder = 'Paste job text manually here...';
    box.classList.add('hidden');
    alert('Connection error. Make sure Flask is running!');
  }

  btn.textContent = 'Fetch →';
  btn.disabled    = false;
}

async function analyze() {
  // Figure out active tab
  const urlTab = document.getElementById('tab-url');
  const isURL  = urlTab && urlTab.style.display !== 'none';

  let text = '';
  if (isURL) {
    const fetched = document.getElementById('fetched-text').value.trim();
    // Reject guide/error messages
    if (fetched.startsWith('⚠️') ||
        fetched.includes('blocks automated') ||
        fetched.includes('HOW TO ANALYZE') ||
        fetched.length < 50) {
      showErrorBox('Please paste actual job text first.',
        'Copy the job description from the website and paste it in the text area above, then click Analyze.');
      return;
    }
    text = fetched;
  } else {
    text = document.getElementById('job-text').value.trim();
  }

  // Basic length check
  if (!text || text.split(/\s+/).length < 15) {
    showErrorBox('Text too short.',
      'Please paste the complete job posting including title, description, requirements, and company details.');
    return;
  }

  // Start loading
  const btn     = document.getElementById('analyze-btn');
  const label   = document.getElementById('btn-label');
  const spinner = document.getElementById('spinner');
  btn.disabled  = true;
  label.textContent = 'Analyzing...';
  spinner.classList.remove('hidden');
  hideResult();

  try {
    const res  = await fetch('/predict', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ text, model: selectedModel })
    });
    const data = await res.json();

    if (data.error) {
      // Server rejected the input (code, gibberish, etc.)
      showErrorBox(data.error,
        'A valid job posting should include: Job Title · Company · Description · Requirements · Salary · Location · How to Apply');
    } else {
      showResult(data, text);
    }
  } catch (e) {
    showErrorBox('Cannot connect to server.',
      'Make sure Flask is running. Open Anaconda Prompt and run: python app.py');
  }

  btn.disabled = false;
  label.textContent = 'Analyze Job Posting';
  spinner.classList.add('hidden');
}

// ---- Show friendly error inside result box ----
function showErrorBox(title, hint) {
  const box = document.getElementById('result-box');
  box.className      = 'result-box';
  box.style.borderColor = 'rgba(245,158,11,0.35)';
  box.classList.remove('hidden');

  box.innerHTML = `
    <div class="result-top" style="background:rgba(245,158,11,0.06);">
      <div class="result-icon-wrap"
           style="background:rgba(245,158,11,0.15); font-size:20px;">⚠️</div>
      <div>
        <div class="result-verdict" style="color:#f59e0b; font-size:16px;">
          Invalid Input
        </div>
        <div class="result-meta">Please check your input and try again</div>
      </div>
    </div>
    <div style="padding:16px 24px 20px;">
      <div style="font-size:14px; color:#fcd34d;
                  line-height:1.8; margin-bottom:14px;">
        ${title}
      </div>
      <div style="font-size:13px; color:var(--text2);
                  background:rgba(255,255,255,0.03);
                  border:1px solid var(--border);
                  border-radius:10px; padding:14px; line-height:1.8;">
        <strong style="color:var(--text);">✅ Tip:</strong><br/>
        ${hint}
      </div>
      <div style="margin-top:14px; font-size:13px;
                  color:var(--text3); line-height:1.8;">
        <strong style="color:var(--text);">Example valid job posting:</strong><br/>
        "Software Engineer — TCS, Pune<br/>
        Experience: 2-4 years | Salary: 8-12 LPA<br/>
        Requirements: Python, Django, REST APIs, AWS<br/>
        Apply with resume on our careers portal."
      </div>
    </div>`;

  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---- Show detection result ----
function showResult(data, text) {
  const isF = data.prediction === 1;
  const box = document.getElementById('result-box');

  // Rebuild normal structure
  box.innerHTML = `
    <div class="result-top">
      <div class="result-icon-wrap" id="r-icon"></div>
      <div>
        <div class="result-verdict" id="r-verdict"></div>
        <div class="result-meta"   id="r-meta"></div>
      </div>
    </div>
    <div class="confidence-section">
      <div class="conf-label">Confidence Scores</div>
      <div class="conf-row">
        <span class="conf-name genuine-text">Genuine</span>
        <div class="conf-bar-track">
          <div class="conf-bar-fill genuine-bar" id="g-bar"></div>
        </div>
        <span class="conf-pct" id="g-pct" style="color:#10b981;"></span>
      </div>
      <div class="conf-row">
        <span class="conf-name fraud-text">Fraudulent</span>
        <div class="conf-bar-track">
          <div class="conf-bar-fill fraud-bar" id="f-bar"></div>
        </div>
        <span class="conf-pct" id="f-pct" style="color:#ef4444;"></span>
      </div>
    </div>
    <div class="result-warning" id="r-warning"></div>`;

  box.className         = 'result-box ' + (isF ? 'fraudulent' : 'genuine');
  box.style.borderColor = '';
  box.classList.remove('hidden');

  document.getElementById('r-icon').textContent    = isF ? '⚠️' : '✅';
  document.getElementById('r-verdict').textContent =
    isF ? 'FRAUDULENT JOB POSTING' : 'GENUINE JOB POSTING';
  document.getElementById('r-meta').textContent    =
    data.text_length + ' words analyzed · XGBoost · EMSCAD Model';

  // Animate bars
  setTimeout(() => {
    const gb = document.getElementById('g-bar');
    const fb = document.getElementById('f-bar');
    if (gb) gb.style.width = data.genuine_pct + '%';
    if (fb) fb.style.width = data.fraud_pct   + '%';
  }, 100);

  const gp = document.getElementById('g-pct');
  const fp = document.getElementById('f-pct');
  if (gp) gp.textContent = data.genuine_pct + '%';
  if (fp) fp.textContent = data.fraud_pct   + '%';

  const rw = document.getElementById('r-warning');
  if (rw) {
    rw.innerHTML = isF
      ? '<strong>⚠️ Warning:</strong> High fraud probability detected. ' +
        'Do NOT share Aadhaar, bank details, or pay any registration fee. ' +
        'Report this posting to the platform immediately.'
      : '<strong>✅ Appears Legitimate:</strong> This posting shows ' +
        'characteristics of genuine job listings. Always independently ' +
        'verify the company before sharing personal information.';
  }

  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  addToHistory(text, isF, data.fraud_pct, data.genuine_pct);
}

// ---- Add to history sidebar ----
function addToHistory(text, isF, fraudPct, genuinePct) {
  const preview = text.substring(0, 42).replace(/\n/g, ' ') + '...';
  analysisHistory.unshift({ preview, isF, fraudPct, genuinePct });
  if (analysisHistory.length > 5) analysisHistory.pop();

  const list = document.getElementById('history-list');
  if (!list) return;
  list.innerHTML = analysisHistory.map(h => `
    <div class="history-item">
      <div class="hi-dot ${h.isF ? 'f' : 'g'}"></div>
      <div class="hi-text">${h.preview}</div>
      <div class="hi-conf" style="color:${h.isF ? '#ef4444' : '#10b981'};">
        ${h.isF ? h.fraudPct : h.genuinePct}%
      </div>
    </div>`).join('');
}

// ---- Animate research bars on scroll ----
function animateBars() {
  const rows = [
    { acc: 'b-xg-acc',  f1: 'b-xg-f1',  a: 98.43, f: 82 },
    { acc: 'b-rf-acc',  f1: 'b-rf-f1',  a: 98.35, f: 80 },
    { acc: 'b-gb-acc',  f1: 'b-gb-f1',  a: 96.95, f: 72 },
    { acc: 'b-knn-acc', f1: 'b-knn-f1', a: 77.80, f: 30 }
  ];
  rows.forEach(d => {
    const a = document.getElementById(d.acc);
    const f = document.getElementById(d.f1);
    if (a) a.style.width = d.a + '%';
    if (f) f.style.width = d.f + '%';
  });
}

const chartEl = document.getElementById('bar-chart');
if (chartEl) {
  new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) animateBars(); });
  }, { threshold: 0.3 }).observe(chartEl);
}
// ---- Infinite Ticker ----
const tickerItems = [
  {icon:'🤖', name:'XGBoost',          stat:'98.43% Accuracy', cls:'t-purple'},
  {icon:'🌲', name:'Random Forest',     stat:'Ensemble Model',  cls:'t-teal'},
  {icon:'📊', name:'TF-IDF',            stat:'5,000 Features',  cls:'t-green'},
  {icon:'⚖️', name:'SMOTE',             stat:'Class Balancing', cls:'t-amber'},
  {icon:'🔬', name:'ADASYN',            stat:'Adaptive Sampling',cls:'t-rose'},
  {icon:'🧠', name:'NLP Pipeline',      stat:'NLTK + SpaCy',    cls:'t-purple'},
  {icon:'📦', name:'EMSCAD Dataset',    stat:'17,880 Samples',  cls:'t-teal'},
  {icon:'🐍', name:'Python 3.10',       stat:'Scikit-learn',    cls:'t-green'},
  {icon:'🔥', name:'Gradient Boosting', stat:'96.95% Accuracy', cls:'t-amber'},
  {icon:'📈', name:'F1-Score 0.82',     stat:'Best Model',      cls:'t-rose'},
  {icon:'🛡️', name:'Fraud Detection',   stat:'866 Scams Found', cls:'t-purple'},
  {icon:'⚡', name:'Real-Time',         stat:'Instant Results', cls:'t-teal'},
];

const track = document.getElementById('ticker-track');
if (track) {
  // Duplicate for seamless loop
  const allItems = [...tickerItems, ...tickerItems];
  track.innerHTML = allItems.map(i => `
    <div class="t-item">
      <span class="t-icon">${i.icon}</span>
      <span class="t-name">${i.name}</span>
      <span class="t-stat ${i.cls}">${i.stat}</span>
    </div>`).join('');
}

// ---- Feature Importance Bars ----
const featureData = [
  {word:'data entry', score:0.0108, type:'fraud'},
  {word:'earn',       score:0.0090, type:'fraud'},
  {word:'growing',    score:0.0087, type:'genuine'},
  {word:'duty',       score:0.0081, type:'genuine'},
  {word:'computer',   score:0.0067, type:'genuine'},
  {word:'team',       score:0.0067, type:'genuine'},
  {word:'clerical',   score:0.0065, type:'genuine'},
  {word:'creative',   score:0.0059, type:'genuine'},
  {word:'needed',     score:0.0058, type:'fraud'},
  {word:'position',   score:0.0056, type:'genuine'},
  {word:'oil gas',    score:0.0050, type:'genuine'},
  {word:'high school',score:0.0049, type:'genuine'},
  {word:'phone',      score:0.0045, type:'fraud'},
  {word:'email',      score:0.0045, type:'fraud'},
  {word:'skill',      score:0.0044, type:'genuine'},
];

const maxScore = featureData[0].score;

function renderFeatureBars() {
  const container = document.getElementById('feature-bars');
  if (!container) return;

  container.innerHTML = featureData.map(f => {
    const pct   = ((f.score / maxScore) * 100).toFixed(1);
    const label = f.score.toFixed(4);
    return `
      <div class="fb-row">
        <div class="fb-word">${f.word}</div>
        <div class="fb-track">
          <div class="fb-fill ${f.type}" 
               data-width="${pct}"
               style="width:0%;">
            ${f.type === 'fraud' ? '⚠' : ''}
          </div>
        </div>
        <div class="fb-score">${label}</div>
      </div>`;
  }).join('');

  // Animate on scroll
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        document.querySelectorAll('.fb-fill').forEach(bar => {
          bar.style.width = bar.dataset.width + '%';
        });
        obs.disconnect();
      }
    });
  }, {threshold: 0.3});

  obs.observe(container);
}

renderFeatureBars();