import os

mri_a_dir = r'[NETWORK_RADIOLOGY_SHARE] Prakhyath Gambira\mri formats'

files = []
for root, _, filenames in os.walk(mri_a_dir):
    for f in filenames:
        if f.endswith('.docx') or f.endswith('.doc'):
            full_path = os.path.join(root, f)
            size = os.path.getsize(full_path)
            if size > 0 and not f.startswith('~$'):
                files.append((f, size, full_path))

print(f"Found {len(files)} valid DOC/DOCX files in MRI A ({mri_a_dir}):")
for f, size, p in sorted(files):
    rel = os.path.relpath(p, mri_a_dir)
    print(f"  {size:7d} bytes: {rel}")
