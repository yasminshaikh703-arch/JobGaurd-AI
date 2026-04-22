# =============================================
# JOBGUARD AI - Flask Web Application
# With Real Selenium-based Web Scraping
# PhD Project by Ms. Yasmin Rahim Shaikh
# =============================================

from flask import Flask, render_template, request, jsonify
import joblib
import re
import os
import time
import threading
import requests
from bs4 import BeautifulSoup

# Selenium imports
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, WebDriverException
from webdriver_manager.chrome import ChromeDriverManager

from nltk.corpus import stopwords
from nltk.stem import WordNetLemmatizer
import nltk
import warnings
warnings.filterwarnings('ignore')

nltk.download('stopwords', quiet=True)
nltk.download('wordnet', quiet=True)

app = Flask(__name__)

# ── Load models ──────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

model = joblib.load(os.path.join(BASE_DIR, 'dataset', 'best_model_xgboost.pkl'))
tfidf = joblib.load(os.path.join(BASE_DIR, 'dataset', 'tfidf_vectorizer.pkl'))
print("✅ Models loaded successfully!")

# ── Text cleaning ─────────────────────────────────────────────────────────────
lemmatizer = WordNetLemmatizer()
stop_words  = set(stopwords.words('english'))

def clean_text(text):
    text = text.lower()
    text = re.sub(r'<.*?>', ' ', text)
    text = re.sub(r'[^a-zA-Z\s]', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
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
        'SELECT ', 'int main', '#include', 'console.log'
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
        'opening', 'recruitment', 'employer', 'fresher'
    ]
    if sum(1 for k in job_keywords if k in text_lower) < 2:
        return False, "This does not look like a job posting. Please paste actual job description text."

    return True, "OK"

# ── Chrome driver builder ─────────────────────────────────────────────────────
def build_driver():
    """Build a headless Chrome driver that mimics a real browser."""
    opts = Options()
    opts.add_argument("--headless=new")          # invisible Chrome
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-blink-features=AutomationControlled")
    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    opts.add_experimental_option("useAutomationExtension", False)
    opts.add_argument("--window-size=1920,1080")
    opts.add_argument(
        "user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
    # Disable images to speed up loading
    prefs = {"profile.managed_default_content_settings.images": 2}
    opts.add_experimental_option("prefs", prefs)

    service = Service(ChromeDriverManager().install())
    driver  = webdriver.Chrome(service=service, options=opts)

    # Hide Selenium signature from JavaScript detection
    driver.execute_cdp_cmd(
        "Page.addScriptToEvaluateOnNewDocument",
        {"source": "Object.defineProperty(navigator,'webdriver',{get:()=>undefined})"}
    )
    return driver

# ── Site-specific extractors ──────────────────────────────────────────────────
def extract_naukri(driver, url):
    driver.get(url)
    time.sleep(3)
    selectors = [
        "div.job-desc", "div.dang-inner-html",
        "div[class*='job-desc']", "div[class*='description']",
        "section.job-desc", "div.jd-desc"
    ]
    for sel in selectors:
        try:
            el = WebDriverWait(driver, 5).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, sel))
            )
            text = el.text.strip()
            if len(text) > 100:
                return text
        except:
            continue
    return _fallback_extract(driver)


def extract_indeed(driver, url):
    driver.get(url)
    time.sleep(3)
    selectors = [
        "div#jobDescriptionText",
        "div.jobsearch-jobDescriptionText",
        "div[class*='jobDescription']"
    ]
    for sel in selectors:
        try:
            el = WebDriverWait(driver, 5).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, sel))
            )
            text = el.text.strip()
            if len(text) > 100:
                return text
        except:
            continue
    return _fallback_extract(driver)


def extract_shine(driver, url):
    driver.get(url)
    time.sleep(3)
    selectors = [
        "div.job-description", "div[class*='description']",
        "section.description", "div.jd"
    ]
    for sel in selectors:
        try:
            el = WebDriverWait(driver, 5).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, sel))
            )
            text = el.text.strip()
            if len(text) > 100:
                return text
        except:
            continue
    return _fallback_extract(driver)


def extract_linkedin(driver, url):
    driver.get(url)
    time.sleep(4)
    selectors = [
        "div.description__text",
        "div.show-more-less-html__markup",
        "section.description",
        "div[class*='description']"
    ]
    for sel in selectors:
        try:
            el = WebDriverWait(driver, 5).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, sel))
            )
            text = el.text.strip()
            if len(text) > 100:
                return text
        except:
            continue
    # LinkedIn may require login
    if "authwall" in driver.current_url or "login" in driver.current_url:
        return "REQUIRES_LOGIN"
    return _fallback_extract(driver)


def extract_monster(driver, url):
    driver.get(url)
    time.sleep(3)
    selectors = [
        "div.job-description", "div[class*='description']",
        "section[class*='description']", "div#JobDescription"
    ]
    for sel in selectors:
        try:
            el = WebDriverWait(driver, 5).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, sel))
            )
            text = el.text.strip()
            if len(text) > 100:
                return text
        except:
            continue
    return _fallback_extract(driver)


def extract_timesjobs(driver, url):
    driver.get(url)
    time.sleep(3)
    selectors = [
        "div.jd-desc", "div[class*='job-desc']",
        "li.clearfix.job-experienc"
    ]
    for sel in selectors:
        try:
            el = WebDriverWait(driver, 5).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, sel))
            )
            text = el.text.strip()
            if len(text) > 100:
                return text
        except:
            continue
    return _fallback_extract(driver)


def _fallback_extract(driver):
    """Generic extraction: get all visible text, remove nav/footer noise."""
    try:
        soup = BeautifulSoup(driver.page_source, 'html.parser')
        for tag in soup(['script','style','nav','footer',
                         'header','aside','form']):
            tag.decompose()

        # Try common job containers first
        for sel in ['article', 'main', 'div[role="main"]']:
            found = soup.select(sel)
            if found:
                text = ' '.join(f.get_text(' ', strip=True) for f in found)
                if len(text) > 150:
                    return re.sub(r'\s+', ' ', text).strip()[:4000]

        # Last resort: all paragraph text
        paras = soup.find_all(['p','li'])
        text  = ' '.join(p.get_text(' ', strip=True) for p in paras)
        text  = re.sub(r'\s+', ' ', text).strip()
        return text[:4000] if len(text) > 100 else None
    except:
        return None

# ── Main Selenium scraper ─────────────────────────────────────────────────────
def selenium_scrape(url):
    """
    Dispatches to site-specific extractor.
    Returns (text, error_code) tuple.
    error_code: None = success | string = error type
    """
    driver = None
    try:
        driver = build_driver()

        url_lower = url.lower()
        if 'naukri.com'    in url_lower: text = extract_naukri(driver, url)
        elif 'indeed.com'  in url_lower: text = extract_indeed(driver, url)
        elif 'shine.com'   in url_lower: text = extract_shine(driver, url)
        elif 'linkedin.com'in url_lower: text = extract_linkedin(driver, url)
        elif 'monster.com' in url_lower: text = extract_monster(driver, url)
        elif 'timesjobs.com'in url_lower:text = extract_timesjobs(driver, url)
        else:
            # Generic fallback for unknown sites
            driver.get(url)
            time.sleep(3)
            text = _fallback_extract(driver)

        if text == "REQUIRES_LOGIN":
            return None, "REQUIRES_LOGIN"
        if not text or len(text.strip()) < 80:
            return None, "EXTRACT_FAILED"

        return text.strip(), None

    except TimeoutException:
        return None, "TIMEOUT"
    except WebDriverException as e:
        err = str(e).lower()
        if 'net::err' in err or 'connection' in err:
            return None, "NO_CONNECTION"
        return None, "BROWSER_ERROR"
    except Exception as e:
        print(f"Selenium error: {e}")
        return None, "ERROR"
    finally:
        if driver:
            try:
                driver.quit()
            except:
                pass

# ── Routes ────────────────────────────────────────────────────────────────────
@app.route('/')
def home():
    return render_template('index.html')


@app.route('/predict', methods=['POST'])
def predict():
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
        'text_length': len(job_text.split())
    })


@app.route('/fetch_url', methods=['POST'])
def fetch_url():
    data = request.get_json()
    url  = data.get('url', '').strip()

    if not url.startswith('http'):
        return jsonify({'error': 'Please enter a valid URL starting with http'})

    # ── Use Selenium for real scraping ────────────────────────────────────────
    text, error = selenium_scrape(url)

    if error == "REQUIRES_LOGIN":
        return jsonify({
            'error': (
                'LinkedIn requires you to be logged in. '
                'Please: 1) Open LinkedIn in your browser, '
                '2) Log in to your account, '
                '3) Copy the job description text manually, '
                '4) Paste it in the "Paste Job Text" tab.'
            )
        })
    elif error == "TIMEOUT":
        return jsonify({'error': 'Page took too long to load. Please try again.'})
    elif error == "NO_CONNECTION":
        return jsonify({'error': 'Cannot reach this URL. Check your internet connection.'})
    elif error == "BROWSER_ERROR":
        return jsonify({'error': 'Browser error occurred. Please try again or paste text manually.'})
    elif error == "EXTRACT_FAILED":
        return jsonify({
            'error': (
                'Could not extract job description from this page. '
                'Please copy the job text manually and paste it in the '
                '"Paste Job Text" tab for accurate analysis.'
            )
        })
    elif error:
        return jsonify({'error': 'Unexpected error. Please paste the job text manually.'})

    return jsonify({
        'text'      : text,
        'char_count': len(text),
        'word_count': len(text.split()),
        'site'      : url.split('/')[2] if '/' in url else url
    })


@app.route('/stats')
def stats():
    return jsonify({
        'accuracy'  : 98.43,
        'precision' : 0.91,
        'recall'    : 0.75,
        'f1'        : 0.82,
        'total_jobs': 17880,
        'fraud_jobs': 866,
        'models'    : ['XGBoost','Random Forest','Gradient Boosting','KNN'],
        'best_model': 'XGBoost + ADASYN'
    })


if __name__ == '__main__':
    app.run(debug=True, port=5000)