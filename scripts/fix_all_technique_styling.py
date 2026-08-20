import os
import re
import copy
import docx
from docx.shared import Pt

DESKTOP_DIR = r'C:\Users\doctor\Desktop\Radiology_Templates_DOCX'

def fix_template_formatting(doc_path):
    doc = docx.Document(doc_path)
    changed = False
    
    for idx, p in enumerate(doc.paragraphs):
        txt = p.text.strip()
        if not txt:
            continue
            
        is_technique = (
            txt.lower().startswith('technique:') or
            txt.lower().startswith('mri technique:') or
            txt.lower().startswith('ct technique:') or
            bool(re.match(r'^(screening\s+of\s+(the\s+)?(rest\s+of\s+(the\s+)?spine|whole\s+spine|upper\s+abdomen))', txt, re.I))
        )
        
        is_clinical = txt.lower().startswith('clinical profile:')
        
        if is_technique or is_clinical:
            for r in p.runs:
                if r.underline:
                    r.underline = False
                    changed = True
                if not r.italic:
                    r.italic = True
                    changed = True
                r.font.name = 'Times New Roman'
                if r.font.size is None:
                    r.font.size = Pt(12)
        else:
            for r in p.runs:
                r.font.name = 'Times New Roman'
                if r.font.size is None:
                    r.font.size = Pt(12)

    if changed:
        doc.save(doc_path)
        print(f"[FIXED] {os.path.basename(doc_path)}")

def main():
    print("Checking all desktop templates for Technique / Screening italic formatting...")
    for root, dirs, files in os.walk(DESKTOP_DIR):
        for f in sorted(files):
            if f.endswith('.docx'):
                fix_template_formatting(os.path.join(root, f))
    print("All desktop templates verified!")

if __name__ == '__main__':
    main()
