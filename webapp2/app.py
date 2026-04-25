# =============================================
# JOBGUARD AI - Flask Web Application
# Smart Detection of Fraudulent Job Postings
# M.E. Dissertation by Ms. Yasmin Rahim Shaikh
# Sanghavi College of Engineering, Nashik
# =============================================

from flask import Flask, render_template, request, jsonify
import joblib
import re
import os
import requests
from bs4 import BeautifulSoup
from nltk.corpus import stopwords
from nltk.stem import WordNetLemmatizer
import nltk
import warnings
warnings.filterwarnings('ignore')

nltk.download('stopwords', quiet=True)
nltk.download('wordnet',   quiet=True)
nltk.download('omw-1.4',   quiet=True)

# ── Paths ─────────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ── Flask app with explicit folder paths ──────────────────────────────────────
app = Flask(
    __name__,
    template_folder = os.path.join(BASE_DIR, 'templates'),
    static_folder   = os.path.join(BASE_DIR, 'static'),
)

# ── Load ML models ────────────────────────────────────────────────────────────
try:
    model = joblib.load(os.path.join(BASE_DIR, 'dataset', 'best_model_xgboost.pkl'))
    tfidf = joblib.load(os.path.join(BASE_DIR, 'dataset', 'tfidf_vectorizer.pkl'))
    print("✅ Models loaded successfully!")
except Exception as e:
    print(f"❌ Model loading error: {e}")
    model = None
    tfidf = None

# ── NLP tools ─────────────────────────────────────────────────────────────────
lemmatizer = WordNetLemmatizer()
stop_words  = set(stopwords.words('english'))

# ── Text cleaning ──────────────────────────────────────────────────────────────
def clean_text(text):
    text  = text.lower()
    text  = re.sub(r'<.*?>',       ' ', text)
    text  = re.sub(r'[^a-zA-Z\s]', ' ', text)
    text  = re.sub(r'\s+',         ' ', text).strip()
    words = [lemmatizer.lemmatize(w)
             for w in text.split() if w not in stop_words]
    return ' '.join(words)

# ── Job posting validator ─────────────────────────────────────────────────────
def is_job_posting(text):
    text_lower = text.lower()

    if len(text.split()) < 20:
        return False, "Text too short. Please paste the complete job posting."

    code_indicators = [
        'def ', 'import ', 'class ', 'print(',
        'return ', 'function(', 'var ', 'const ',
        'public static', '#!/', '<?php',
        'select ', 'int main', '#include', 'console.log',
    ]
    if sum(1 for c in code_indicators if c in text) >= 2:
        return False, "This looks like code, not a job posting."

    job_keywords = [
        'job', 'position', 'role', 'hiring', 'candidate',
        'experience', 'salary', 'skills', 'requirements',
        'company', 'team', 'work', 'apply', 'resume',
        'qualification', 'degree', 'engineer', 'manager',
        'developer', 'analyst', 'location', 'remote',
        'benefits', 'responsibilities', 'vacancy', 'ctc',
        'opening', 'recruitment', 'employer', 'fresher',
    ]
    if sum(1 for k in job_keywords if k in text_lower) < 2:
        return False, ("This does not look like a job posting. "
                       "Please paste actual job description text.")

    return True, "OK"

# ── Jina AI Reader (primary fetcher — works on all sites) ─────────────────────
def fetch_with_jina(url):
    try:
        jina_url = f"https://r.jina.ai/{url}"
        headers  = {
            "Accept"    : "text/plain",
            "User-Agent": "Mozilla/5.0 (compatible; JobGuardAI/1.0)",
        }
        response = requests.get(jina_url, headers=headers, timeout=30)

        if response.status_code != 200:
            return None, f"HTTP {response.status_code}"

        text = response.text.strip()

        # Strip Jina metadata header lines
        lines       = text.split('\n')
        clean_lines = []
        for line in lines:
            if line.startswith(('Title:', 'URL Source:', 'Markdown Content:', '---')):
                continue
            clean_lines.append(line)

        text = '\n'.join(clean_lines).strip()
        text = re.sub(r'\[.*?\]\(.*?\)', '', text)   # remove markdown links
        text = re.sub(r'#{1,6}\s',        '', text)   # remove markdown headers
        text = re.sub(r'\s+',             ' ', text).strip()

        if len(text) < 80:
            return None, "EXTRACT_FAILED"

        return text[:4000], None

    except requests.exceptions.Timeout:
        return None, "TIMEOUT"
    except requests.exceptions.ConnectionError:
        return None, "NO_CONNECTION"
    except Exception as e:
        print(f"Jina fetch error: {e}")
        return None, "ERROR"

# ── Direct requests fallback ──────────────────────────────────────────────────
def fetch_with_requests(url):
    try:
        headers = {
            'User-Agent'     : ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                                'AppleWebKit/537.36 (KHTML, like Gecko) '
                                'Chrome/120.0.0.0 Safari/537.36'),
            'Accept'         : 'text/html,application/xhtml+xml,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection'     : 'keep-alive',
        }
        response = requests.get(url, headers=headers, timeout=15)

        if response.status_code != 200:
            return None, f"HTTP {response.status_code}"

        soup = BeautifulSoup(response.text, 'html.parser')
        for tag in soup(['script','style','nav','footer','header','aside']):
            tag.decompose()

        selectors = [
            'div#jobDescriptionText',
            'div.job-desc',
            'div.dang-inner-html',
            'div.description__text',
            'div[class*="job-description"]',
            'div[class*="description"]',
            'div[class*="jobDetail"]',
            'article', 'main',
        ]
        text = ''
        for sel in selectors:
            found = soup.select(sel)
            if found:
                text = ' '.join(f.get_text(' ', strip=True) for f in found)
                if len(text) > 100:
                    break

        if len(text) < 100:
            paras = soup.find_all(['p', 'li'])
            text  = ' '.join(p.get_text(' ', strip=True) for p in paras)

        text = re.sub(r'\s+', ' ', text).strip()

        if len(text) < 80:
            return None, "EXTRACT_FAILED"

        return text[:4000], None

    except requests.exceptions.Timeout:
        return None, "TIMEOUT"
    except Exception as e:
        print(f"Direct fetch error: {e}")
        return None, "ERROR"

# ══════════════════════════════════════════════════════════════════════════════
# ROUTES
# ══════════════════════════════════════════════════════════════════════════════

# ── Test / health-check route ─────────────────────────────────────────────────
@app.route('/test')
def test():
    return jsonify({
        'status'          : 'OK',
        'base_dir'        : BASE_DIR,
        'template_folder' : app.template_folder,
        'static_folder'   : app.static_folder,
        'dataset_exists'  : os.path.exists(os.path.join(BASE_DIR, 'dataset')),
        'model_exists'    : os.path.exists(
                                os.path.join(BASE_DIR, 'dataset',
                                             'best_model_xgboost.pkl')),
        'tfidf_exists'    : os.path.exists(
                                os.path.join(BASE_DIR, 'dataset',
                                             'tfidf_vectorizer.pkl')),
        'template_exists' : os.path.exists(
                                os.path.join(BASE_DIR, 'templates',
                                             'index.html')),
        'model_loaded'    : model is not None,
        'tfidf_loaded'    : tfidf is not None,
    })

# ── Home ──────────────────────────────────────────────────────────────────────
@app.route('/')
def home():
    return render_template('index.html')

# ── Predict ───────────────────────────────────────────────────────────────────
@app.route('/predict', methods=['POST'])
def predict():
    if model is None or tfidf is None:
        return jsonify({'error': 'Models not loaded. Please try again later.'})

    data     = request.get_json()
    job_text = data.get('text', '').strip()

    if len(job_text) < 20:
        return jsonify({'error': 'Please enter more text!'})

    is_valid, reason = is_job_posting(job_text)
    if not is_valid:
        return jsonify({'error': reason})

    cleaned     = clean_text(job_text)
    features    = tfidf.transform([cleaned])
    prediction  = int(model.predict(features)[0])
    probability = model.predict_proba(features)[0]
    fraud_pct   = round(float(probability[1]) * 100, 1)
    genuine_pct = round(float(probability[0]) * 100, 1)

    return jsonify({
        'prediction' : prediction,
        'fraud_pct'  : fraud_pct,
        'genuine_pct': genuine_pct,
        'label'      : 'FRAUDULENT' if prediction == 1 else 'GENUINE',
        'text_length': len(job_text.split()),
    })

# ── Fetch URL ─────────────────────────────────────────────────────────────────
@app.route('/fetch_url', methods=['POST'])
def fetch_url():
    data = request.get_json()
    url  = data.get('url', '').strip()

    if not url.startswith('http'):
        return jsonify({'error': 'Please enter a valid URL starting with http'})

    # Strategy 1: Jina AI Reader (best — works on all sites)
    text, error = fetch_with_jina(url)

    # Strategy 2: Direct requests fallback
    if error:
        print(f"Jina failed ({error}), trying direct requests...")
        text, error = fetch_with_requests(url)

    # Handle errors
    if error == "TIMEOUT":
        return jsonify({'error': ('Page took too long to load. '
                                  'Please try again.')})
    elif error == "NO_CONNECTION":
        return jsonify({'error': 'Cannot reach this URL. Check the link.'})
    elif error == "EXTRACT_FAILED":
        return jsonify({'error': ('Could not extract job description. '
                                  'Please copy-paste the job text manually.')})
    elif error:
        return jsonify({'error': ('Could not fetch this URL. '
                                  'Please copy-paste the job text manually.')})

    # Validate extracted content
    is_valid, reason = is_job_posting(text)
    if not is_valid:
        return jsonify({'error': ('Fetched content does not look like a job '
                                  'posting. Please copy-paste the actual '
                                  'job description text.')})

    site = url.split('/')[2] if '/' in url else url

    return jsonify({
        'text'      : text,
        'word_count': len(text.split()),
        'char_count': len(text),
        'site'      : site,
    })

# ── Stats ─────────────────────────────────────────────────────────────────────
@app.route('/stats')
def stats():
    return jsonify({
        'accuracy'  : 98.43,
        'precision' : 0.91,
        'recall'    : 0.75,
        'f1'        : 0.82,
        'total_jobs': 17880,
        'fraud_jobs': 866,
        'models'    : ['XGBoost', 'Random Forest', 'Gradient Boosting', 'KNN'],
        'best_model': 'XGBoost + ADASYN',
    })

# ── Run ───────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
