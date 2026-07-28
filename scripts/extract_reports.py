import zipfile
import io
import pypdf
import re
import json
import os
from collections import defaultdict

ZIP_PATH = r'C:\Users\Dhiwakar Ks\Downloads\Aggregated_Reports.zip'
OUTPUT_JSON = r'C:\Users\Dhiwakar Ks\Documents\antigravity\vibrant-babbage\radiology_dictation_temp\public\report_knowledgebase.json'
MAX_TEMPLATES_PER_CAT = 30

def clean_report(text):
    lines = text.split('\n')
    cleaned = []
    for line in lines:
        l = line.strip()
        # Skip demographic header lines
        if re.match(r'^(Date;Sex;|[0-9]{2}\.[0-9]{2}\.[0-9]{4};)', l):
            continue
        cleaned.append(l)
    res = '\n'.join(cleaned).strip()
    res = re.sub(r'\n{3,}', '\n\n', res)
    return res

def extract_title(text):
    first_few_lines = [l.strip() for l in text.split('\n') if l.strip()][:3]
    if first_few_lines:
        title = first_few_lines[0]
        if len(title) < 100:
            return title
    return 'RADIOLOGY REPORT'

def process_reports():
    print("Opening zip file...")
    z = zipfile.ZipFile(ZIP_PATH)
    
    # Target Split PDFs for fast, incremental page extraction
    split_files = [f for f in z.namelist() if 'Split_1000pages' in f and f.endswith('.pdf')]
    print(f"Found {len(split_files)} split PDF files.")

    # Group split files by category
    files_by_cat = defaultdict(list)
    for sf in split_files:
        parts = sf.split('/')
        if len(parts) >= 3:
            cat = f"{parts[1]} - {parts[2]}"
        else:
            cat = "General"
        files_by_cat[cat].append(sf)

    print(f"Total categories identified: {len(files_by_cat)}")
    
    reports_by_category = {}
    total_unique = 0

    for cat_idx, (cat, files) in enumerate(files_by_cat.items()):
        print(f"[{cat_idx+1}/{len(files_by_cat)}] Extracting category: {cat} (files: {len(files)})...")
        cat_reports = []
        cat_seen = set()

        for sf in files:
            if len(cat_reports) >= MAX_TEMPLATES_PER_CAT:
                break
            try:
                data = z.read(sf)
                reader = pypdf.PdfReader(io.BytesIO(data))
                # Sample pages evenly from each split file
                step = max(1, len(reader.pages) // 10)
                for p_idx in range(0, len(reader.pages), step):
                    if len(cat_reports) >= MAX_TEMPLATES_PER_CAT:
                        break
                    raw_txt = reader.pages[p_idx].extract_text()
                    if not raw_txt:
                        continue
                    txt = clean_report(raw_txt)
                    if len(txt) < 40:
                        continue
                    
                    # Deduplicate by key text prefix
                    norm_key = re.sub(r'\s+', ' ', txt[:180]).lower()
                    if norm_key in cat_seen:
                        continue
                    cat_seen.add(norm_key)

                    modality = cat.split(' - ')[0] if ' - ' in cat else 'General'
                    region = cat.split(' - ')[1] if ' - ' in cat else 'General'
                    title = extract_title(txt)

                    total_unique += 1
                    cat_reports.append({
                        "id": f"rep-{total_unique}",
                        "modality": modality,
                        "region": region,
                        "category": cat,
                        "title": title,
                        "content": txt
                    })
            except Exception as e:
                pass
                
        reports_by_category[cat] = cat_reports
        print(f"   -> Extracted {len(cat_reports)} distinct templates for {cat}")

    print(f"\nExtraction complete! Total unique templates: {total_unique}")

    os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump({
            "total_reports": total_unique,
            "categories": list(reports_by_category.keys()),
            "reports_by_category": reports_by_category
        }, f, indent=2)

    file_size_mb = os.path.getsize(OUTPUT_JSON) / (1024 * 1024)
    print(f"Saved knowledgebase to {OUTPUT_JSON} ({file_size_mb:.2f} MB)")

if __name__ == '__main__':
    process_reports()
