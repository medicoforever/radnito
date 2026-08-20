import docx

doc = docx.Document(r'D:\Desktop\MRI B.docx')

report_starts = []

for i, p in enumerate(doc.paragraphs):
    text = p.text.strip()
    if not text:
        continue
    
    # Check if this paragraph is a title of an MRI scan
    # Titles are typically in bold Times New Roman 12pt or uppercase MRI ...
    is_bold = any(r.bold for r in p.runs)
    is_mri_title = text.upper().startswith('MRI ') or text.upper().startswith('BRACHIAL PLEXUS') or 'SCAN OF' in text.upper()
    
    if is_mri_title and is_bold and len(text) < 100:
        report_starts.append((i, text))

print(f"Detected {len(report_starts)} reports in MRI B.docx:")
for idx, (p_idx, title) in enumerate(report_starts):
    print(f"Report {idx+1} [Paragraph #{p_idx}]: {title}")
