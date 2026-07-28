import zipfile
import io
import re
import json
import os
import sys

def clean_report_text(raw_text):
    lines = raw_text.split('\n')
    cleaned_lines = []
    
    # Strip patient metadata header lines like Date;Sex;Date of birth;Workplace;Patient foreign ID;Age;
    header_pattern = re.compile(r'^(date|sex|date of birth|workplace|patient foreign id|age)', re.IGNORECASE)
    date_val_pattern = re.compile(r'^\d{2}\.\d{2}\.\d{4};(male|female)', re.IGNORECASE)
    
    for line in lines:
        l = line.strip()
        if not l:
            continue
        if header_pattern.search(l) or date_val_pattern.search(l):
            continue
        # Remove any lingering patient ID numbers or raw date lines
        if re.match(r'^\d{2}\.\d{2}\.\d{4}$', l):
            continue
        cleaned_lines.append(l)
        
    return '\n'.join(cleaned_lines).strip()

def detect_modality_and_region(text, title):
    combined = (title + ' ' + text).lower()
    
    modality = 'Other'
    if 'mri' in combined or 'magnetic resonance' in combined:
        modality = 'MRI'
    elif 'ct' in combined or 'computed tomography' in combined or 'c.t.' in combined:
        modality = 'CT'
    elif 'ultrasound' in combined or 'usg' in combined or 'sonography' in combined or 'doppler' in combined:
        modality = 'USG'
    elif 'x-ray' in combined or 'xray' in combined or 'radiograph' in combined or 'pa view' in combined:
        modality = 'X-Ray'
    elif 'mammogram' in combined or 'mammography' in combined:
        modality = 'Mammography'

    region = 'Other'
    if any(k in combined for k in ['brain', 'head', 'cranial', 'cerebral', 'stroke', 'pituitary', 'orbit', 'pns', 'sinus']):
        region = 'Brain & Head'
    elif any(k in combined for k in ['chest', 'thorax', 'lung', 'pleural', 'mediastinal', 'hrct chest']):
        region = 'Thorax & Chest'
    elif any(k in combined for k in ['abdomen', 'pelvis', 'liver', 'kidney', 'spleen', 'gallbladder', 'pancreas', 'klub', 'kUB']):
        region = 'Abdomen & Pelvis'
    elif any(k in combined for k in ['spine', 'lumbar', 'cervical', 'dorsal', 'vertebra', 'lumbosacral']):
        region = 'Spine'
    elif any(k in combined for k in ['knee', 'shoulder', 'joint', 'femur', 'hip', 'ankle', 'wrist', 'elbow', 'foot']):
        region = 'Extremities & Joints'
    elif any(k in combined for k in ['neck', 'thyroid', 'carotid']):
        region = 'Neck'
    elif any(k in combined for k in ['fetal', 'foetal', 'obstetric', 'pregnancy', 'gestation', 'anomaly']):
        region = 'Obstetrics'

    category = f"{modality} - {region}" if modality != 'Other' else region
    return modality, region, category

def extract_keywords(text):
    words = re.findall(r'\b[a-zA-Z]{3,}\b', text.lower())
    stop_words = {'the', 'and', 'for', 'with', 'are', 'was', 'not', 'been', 'seen', 'noted', 'normal', 'both', 'from', 'that', 'this', 'date', 'male', 'female'}
    keywords = sorted(list(set(w for w in words if w not in stop_words)))
    return keywords[:30]

def main():
    zip_path = r'C:\Users\Dhiwakar Ks\Downloads\NEWWWWW.zip'
    if not os.path.exists(zip_path):
        print(f"Error: Zip path {zip_path} not found.")
        sys.exit(1)

    print(f"Opening {zip_path}...")
    z = zipfile.ZipFile(zip_path)
    master_files = [n for n in z.namelist() if 'Master' in n and n.endswith('.pdf')]
    
    print(f"Found {len(master_files)} Master PDF files.")
    
    reports_by_category = {}
    seen_hashes = set()
    total_extracted = 0

    import pypdf

    for idx, master in enumerate(master_files):
        try:
            data = z.read(master)
            reader = pypdf.PdfReader(io.BytesIO(data))
            for page in reader.pages:
                text = page.extract_text()
                if not text:
                    continue
                
                cleaned = clean_report_text(text)
                if len(cleaned) < 50:
                    continue
                
                lines = cleaned.split('\n')
                title = lines[0] if lines else 'RADIOLOGY REPORT'
                if len(title) > 80:
                    title = title[:80]
                
                # Create hash of structure to avoid exact duplicates
                first_200 = cleaned[:200].lower()
                if first_200 in seen_hashes:
                    continue
                seen_hashes.add(first_200)

                modality, region, category = detect_modalityAnd_region(cleaned, title) if 'detect_modalityAnd_region' in locals() else detect_modality_and_region(cleaned, title)
                keywords = extract_keywords(cleaned)
                
                report_item = {
                    'id': f'tpl-{total_extracted + 1}',
                    'title': title,
                    'category': category,
                    'modality': modality,
                    'region': region,
                    'content': cleaned,
                    'summary_keywords': keywords
                }

                if category not in reports_by_category:
                    reports_by_category[category] = []
                
                # Limit to 150 distinct templates per category for high quality & fast loading
                if len(reports_by_category[category]) < 150:
                    reports_by_category[category].append(report_item)
                    total_extracted += 1
                    
        except Exception as e:
            print(f"Warning reading {master}: {e}")
            continue

        if (idx + 1) % 25 == 0 or (idx + 1) == len(master_files):
            print(f"Processed {idx + 1}/{len(master_files)} Master files. Total unique templates: {total_extracted}")

    output_kb = {
        'version': '2.0.0',
        'source': 'NEWWWWW.zip',
        'total_templates': total_extracted,
        'categories': list(reports_by_category.keys()),
        'reports_by_category': reports_by_category
    }

    output_path = r'C:\Users\Dhiwakar Ks\Documents\antigravity\vibrant-babbage\radiology_dictation_temp\public\report_knowledgebase.json'
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output_kb, f, indent=2)

    print(f"Successfully generated {output_path} with {total_extracted} report templates across {len(reports_by_category)} categories!")

if __name__ == '__main__':
    main()
