import docx

ct_path = r'[NETWORK_RADIOLOGY_SHARE] Pragadesh\FORMATS\Radiology report formats\CT reporting formats.docx'
doc = docx.Document(ct_path)

reports = []
for i, p in enumerate(doc.paragraphs):
    text = p.text.strip()
    if not text:
        continue
    is_bold = any(r.bold for r in p.runs)
    if is_bold and (text.upper().startswith('C.T.') or text.upper().startswith('CT ') or text.upper().startswith('HRCT') or text.upper().startswith('COMPUTED')):
        reports.append((i, text))

print(f"Total CT templates found in CT reporting formats.docx: {len(reports)}")
for idx, (p_idx, title) in enumerate(reports):
    print(f"  CT #{idx+1:02d} [P#{p_idx:04d}]: {title[:80]}")
