import os
import re
import json
import docx

DOCTOR_NAMES_REGEX = re.compile(
    r'\b(dr\.?|doctor)\s+[a-zA-Z\.]+(\s+[a-zA-Z\.]+)?',
    re.IGNORECASE
)

HOSPITAL_REGEX = re.compile(
    r'\b(kmch|kovai\s+medical|centricity|ihsr)\b',
    re.IGNORECASE
)

IP_REGEX = re.compile(
    r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b'
)

PERSONAL_NAMES = [
    'gopinath', 'prakhyath', 'gambira', 'pragadesh', 'mithun', 
    'sathish', 'suman', 'sherene', 'dharani', 'abhirami', 
    'bhuvanapriya', 'gowtham', 'santhosh', 'deepikha', 'arun', 
    'sumathi', 'dstr', 'emp1198'
]

def check_text(txt):
    matches = []
    if HOSPITAL_REGEX.search(txt):
        matches.append('HOSPITAL_NAME')
    if DOCTOR_NAMES_REGEX.search(txt):
        matches.append('DOCTOR_NAME')
    if IP_REGEX.search(txt):
        matches.append('IP_ADDRESS')
    for pn in PERSONAL_NAMES:
        if re.search(r'\b' + re.escape(pn) + r'\b', txt, re.IGNORECASE):
            matches.append(f'PERSONAL_NAME:{pn}')
    return list(set(matches))

def main():
    desktop_dir = r'C:\Users\doctor\Desktop\Radiology_Templates_DOCX'
    print("--- SCANNING DESKTOP TEMPLATES ---")
    for root, _, files in os.walk(desktop_dir):
        for f in files:
            full_p = os.path.join(root, f)
            # check filename
            f_matches = check_text(f)
            if f_matches:
                print(f"[Filename] {full_p} -> {f_matches}")
            
            if f.endswith('.docx'):
                try:
                    doc = docx.Document(full_p)
                    for i, p in enumerate(doc.paragraphs):
                        t = p.text.strip()
                        if t:
                            p_matches = check_text(t)
                            if p_matches:
                                print(f"  [{f}:P{i}] {p_matches}: {t[:90]}")
                except Exception as e:
                    pass

if __name__ == '__main__':
    main()
