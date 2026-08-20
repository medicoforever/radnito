import docx

doc = docx.Document(r'D:\Desktop\MRI B.docx')

reports = []
current_lines = []

for i, p in enumerate(doc.paragraphs):
    has_page_break = False
    for r in p.runs:
        if 'w:br' in r._r.xml and 'type="page"' in r._r.xml:
            has_page_break = True
            break
        if 'w:br' in r._r.xml and 'type="column"' in r._r.xml:
            has_page_break = True
            break
            
    if has_page_break and current_lines:
        reports.append(current_lines)
        current_lines = []
    
    text = p.text.strip()
    if text:
        current_lines.append(text)

if current_lines:
    reports.append(current_lines)

print(f"Total reports detected by page breaks in MRI B.docx: {len(reports)}")
for idx, r in enumerate(reports):
    title = r[0] if r else "EMPTY"
    print(f"Report {idx+1} ({len(r)} lines): {title[:80]}")
