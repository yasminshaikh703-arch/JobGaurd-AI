# =============================================
# FAKE JOB DETECTOR - GUI APPLICATION v2.0
# WITH REAL-TIME URL SCRAPING FEATURE
# PhD Project by Ms. Yasmin Rahim Shaikh
# =============================================

import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox
import joblib
import re
import requests
from bs4 import BeautifulSoup
from nltk.corpus import stopwords
from nltk.stem import WordNetLemmatizer
import nltk
import threading

nltk.download('stopwords', quiet=True)
nltk.download('wordnet', quiet=True)

# ---- Load saved model and vectorizer ----
try:
    model = joblib.load('dataset/best_model_xgboost.pkl')
    tfidf = joblib.load('dataset/tfidf_vectorizer.pkl')
    print("✅ Models loaded!")
except Exception as e:
    print(f"Error: {e}")

# ---- Text cleaning ----
lemmatizer = WordNetLemmatizer()
stop_words  = set(stopwords.words('english'))

def clean_text(text):
    text = text.lower()
    text = re.sub(r'<.*?>', ' ', text)
    text = re.sub(r'[^a-zA-Z\s]', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    words = text.split()
    words = [w for w in words if w not in stop_words]
    words = [lemmatizer.lemmatize(w) for w in words]
    return ' '.join(words)

# ---- Scrape job text from URL ----
def scrape_job_from_url(url):
    try:
        headers = {
            'User-Agent': (
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                'AppleWebKit/537.36 (KHTML, like Gecko) '
                'Chrome/120.0.0.0 Safari/537.36'
            )
        }
        response = requests.get(url, headers=headers, timeout=15)
        soup = BeautifulSoup(response.text, 'html.parser')

        # Remove script and style elements
        for tag in soup(['script', 'style', 'nav', 
                         'footer', 'header']):
            tag.decompose()

        # Try common job description containers
        job_text = ""

        # LinkedIn selectors
        for selector in [
            'div.description__text',
            'div.show-more-less-html',
            'section.description',
            'div.job-description',
            'div[class*="description"]',
            'div[class*="job-detail"]',
            'div[class*="jobDetail"]',
            'div[class*="job_description"]',
            'article',
            'main'
        ]:
            found = soup.select(selector)
            if found:
                job_text = ' '.join([f.get_text() for f in found])
                break

        # Fallback: get all paragraph text
        if len(job_text.strip()) < 100:
            paragraphs = soup.find_all(['p', 'li', 'span', 'div'])
            job_text = ' '.join([p.get_text() for p in paragraphs])

        # Clean up whitespace
        job_text = re.sub(r'\s+', ' ', job_text).strip()

        if len(job_text) < 50:
            return None, "Could not extract job text from this URL."

        return job_text[:3000], None

    except requests.exceptions.Timeout:
        return None, "Connection timed out. Please try again."
    except requests.exceptions.ConnectionError:
        return None, "No internet connection or URL not reachable."
    except Exception as e:
        return None, f"Error reading URL: {str(e)}"

# ---- Show result in UI ----
def show_result(prediction, probability):
    fraud_prob   = round(probability[1] * 100, 1)
    genuine_prob = round(probability[0] * 100, 1)

    if prediction == 1:
        result_label.config(
            text="⚠️ FRAUDULENT JOB POSTING DETECTED!",
            fg='#e74c3c',
            font=('Arial', 15, 'bold')
        )
        detail_label.config(
            text=(f"Fraud Probability   : {fraud_prob}%\n"
                  f"Genuine Probability : {genuine_prob}%\n\n"
                  f"⚠️  WARNING: This posting shows signs of fraud.\n"
                  f"    Do NOT share personal or financial information!"),
            fg='#e74c3c'
        )
        result_frame.config(bg='#fdecea')
    else:
        result_label.config(
            text="✅ GENUINE JOB POSTING",
            fg='#27ae60',
            font=('Arial', 15, 'bold')
        )
        detail_label.config(
            text=(f"Genuine Probability : {genuine_prob}%\n"
                  f"Fraud Probability   : {fraud_prob}%\n\n"
                  f"✅  This posting appears legitimate.\n"
                  f"    Always verify company details independently."),
            fg='#27ae60'
        )
        result_frame.config(bg='#eafaf1')

    status_label.config(text="✅ Analysis complete!", fg='#27ae60')
    detect_btn.config(state='normal')
    url_detect_btn.config(state='normal')

# ---- Predict from text box ----
def predict_from_text():
    job_text = text_input.get("1.0", tk.END).strip()
    if len(job_text) < 20:
        messagebox.showwarning("Warning",
                               "Please enter more job posting text!")
        return
    cleaned     = clean_text(job_text)
    features    = tfidf.transform([cleaned])
    prediction  = model.predict(features)[0]
    probability = model.predict_proba(features)[0]
    show_result(prediction, probability)

# ---- Predict from URL (runs in background thread) ----
def fetch_and_predict():
    url = url_entry.get().strip()
    if not url.startswith('http'):
        messagebox.showwarning("Warning",
                               "Please enter a valid URL starting with http")
        return

    # Disable buttons while loading
    detect_btn.config(state='disabled')
    url_detect_btn.config(state='disabled')
    status_label.config(
        text="⏳ Fetching job posting from URL... please wait...",
        fg='#f39c12'
    )
    result_label.config(text="Analyzing...", 
                        fg='#7f8c8d',
                        font=('Arial', 13))
    detail_label.config(text="")
    root.update()

    def run():
        job_text, error = scrape_job_from_url(url)

        if error:
            status_label.config(text=f"❌ {error}", fg='#e74c3c')
            result_label.config(text="Could not analyze this URL",
                                fg='#e74c3c',
                                font=('Arial', 13))
            detect_btn.config(state='normal')
            url_detect_btn.config(state='normal')
            return

        # Show extracted text in text box
        text_input.delete("1.0", tk.END)
        text_input.insert("1.0", job_text)

        # Predict
        cleaned     = clean_text(job_text)
        features    = tfidf.transform([cleaned])
        prediction  = model.predict(features)[0]
        probability = model.predict_proba(features)[0]
        show_result(prediction, probability)

    threading.Thread(target=run, daemon=True).start()

# ---- Clear all ----
def clear_all():
    text_input.delete("1.0", tk.END)
    url_entry.delete(0, tk.END)
    result_label.config(text="Result will appear here",
                        fg='#7f8c8d',
                        font=('Arial', 13))
    detail_label.config(text="")
    result_frame.config(bg='#f8f9fa')
    status_label.config(text="", fg='black')

# =============================================
# BUILD THE GUI
# =============================================

root = tk.Tk()
root.title("Smart Fake Job Detector v2.0 — Ms. Yasmin Rahim Shaikh")
root.geometry("850x750")
root.configure(bg='#2c3e50')
root.resizable(True, True)

# ---- Title ----
title_frame = tk.Frame(root, bg='#2c3e50', pady=12)
title_frame.pack(fill='x')

tk.Label(title_frame,
         text="🔍 Smart Detection of Fraudulent Job Postings",
         font=('Arial', 17, 'bold'),
         bg='#2c3e50', fg='white').pack()

tk.Label(title_frame,
         text="M.E. Dissertation | Dept. of AI | SCOE Nashik | "
              "XGBoost + TF-IDF + ADASYN | Accuracy: 98.43%",
         font=('Arial', 9),
         bg='#2c3e50', fg='#bdc3c7').pack()

# ---- URL Section ----
url_frame = tk.Frame(root, bg='#34495e', padx=15, pady=12)
url_frame.pack(fill='x', padx=20, pady=(10,0))

tk.Label(url_frame,
         text="🌐 Option 1: Enter Job URL (LinkedIn, Naukri, Indeed, etc.)",
         font=('Arial', 11, 'bold'),
         bg='#34495e', fg='white').pack(anchor='w')

url_input_frame = tk.Frame(url_frame, bg='#34495e')
url_input_frame.pack(fill='x', pady=(6,0))

url_entry = tk.Entry(url_input_frame,
                     font=('Arial', 11),
                     relief='solid', borderwidth=1)
url_entry.pack(side='left', fill='x', expand=True, ipady=6)
url_entry.insert(0, "https://www.linkedin.com/jobs/view/...")

url_detect_btn = tk.Button(
    url_input_frame,
    text="🌐 FETCH & DETECT",
    command=fetch_and_predict,
    font=('Arial', 11, 'bold'),
    bg='#8e44ad', fg='white',
    relief='flat', padx=15, pady=6,
    cursor='hand2'
)
url_detect_btn.pack(side='left', padx=(8,0))

status_label = tk.Label(url_frame, text="",
                         font=('Arial', 9),
                         bg='#34495e', fg='#27ae60')
status_label.pack(anchor='w', pady=(4,0))

# ---- Text Input Section ----
input_frame = tk.Frame(root, bg='white', padx=15, pady=12)
input_frame.pack(fill='both', expand=True, padx=20, pady=(8,0))

tk.Label(input_frame,
         text="📋 Option 2: Paste Job Posting Text Directly:",
         font=('Arial', 11, 'bold'),
         bg='white', fg='#2c3e50').pack(anchor='w')

tk.Label(input_frame,
         text="(When URL fetch works, text appears here automatically)",
         font=('Arial', 9),
         bg='white', fg='#7f8c8d').pack(anchor='w')

text_input = scrolledtext.ScrolledText(
    input_frame,
    height=9,
    font=('Arial', 10),
    wrap=tk.WORD,
    relief='solid',
    borderwidth=1
)
text_input.pack(fill='both', expand=True, pady=(6,0))

# ---- Buttons ----
btn_frame = tk.Frame(root, bg='#2c3e50', pady=8)
btn_frame.pack(fill='x', padx=20)

detect_btn = tk.Button(
    btn_frame,
    text="🔍 DETECT FROM TEXT",
    command=predict_from_text,
    font=('Arial', 12, 'bold'),
    bg='#e74c3c', fg='white',
    relief='flat', padx=25, pady=8,
    cursor='hand2'
)
detect_btn.pack(side='left', padx=(0,10))

clear_btn = tk.Button(
    btn_frame,
    text="🗑️ CLEAR ALL",
    command=clear_all,
    font=('Arial', 12, 'bold'),
    bg='#95a5a6', fg='white',
    relief='flat', padx=25, pady=8,
    cursor='hand2'
)
clear_btn.pack(side='left')

# ---- Result Section ----
result_frame = tk.Frame(root, bg='#f8f9fa',
                         padx=15, pady=12,
                         relief='solid', borderwidth=1)
result_frame.pack(fill='x', padx=20, pady=(8,15))

tk.Label(result_frame,
         text="📊 Detection Result:",
         font=('Arial', 11, 'bold'),
         bg='#f8f9fa', fg='#2c3e50').pack(anchor='w')

result_label = tk.Label(
    result_frame,
    text="Result will appear here",
    font=('Arial', 13),
    bg='#f8f9fa', fg='#7f8c8d'
)
result_label.pack(pady=(5,3))

detail_label = tk.Label(
    result_frame,
    text="",
    font=('Arial', 10),
    bg='#f8f9fa', fg='black',
    justify='left'
)
detail_label.pack(anchor='w')

root.mainloop()