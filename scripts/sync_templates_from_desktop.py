import os
import re
import json
import base64
import subprocess
import docx

DESKTOP_DIR = r'C:\Users\doctor\Desktop\Radiology_Templates_DOCX'
RADNITO_DIR = r'C:\Users\doctor\antigravity\adventurous-babbage\radnito'
RADIOLOGY_DICTATION_DIR = r'C:\Users\doctor\antigravity\adventurous-babbage\radiology-dictation'
GITHUB_TOKEN = os.environ.get('GITHUB_TOKEN', '')

def extract_docx_info(filepath):
    try:
        doc = docx.Document(filepath)
        paragraphs = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
        
        # Read raw binary as base64
        with open(filepath, 'rb') as f:
            docx_base64 = base64.b64encode(f.read()).decode('utf-8')
            
        # First non-empty paragraph or file name as title
        filename_title = os.path.splitext(os.path.basename(filepath))[0]
        title = paragraphs[0] if paragraphs and len(paragraphs[0]) < 100 else filename_title
        
        # Clean title if it contains "Modality:" or symbols
        title = re.sub(r'―+', '', title).strip()
        if not title:
            title = filename_title

        # Determine modality from folder name or content
        parent_folder = os.path.basename(os.path.dirname(filepath))
        modality = 'Radiology'
        if '01_MRI' in parent_folder or 'MRI' in parent_folder:
            modality = 'MRI'
        elif '02_CT' in parent_folder or 'CT' in parent_folder:
            modality = 'CT'
        elif '03_USG' in parent_folder or 'USG' in parent_folder or 'Doppler' in parent_folder:
            modality = 'USG'
        elif '04_X-Ray' in parent_folder or 'X-Ray' in parent_folder:
            modality = 'X-Ray'
        elif '05_Mammography' in parent_folder or 'Mammography' in parent_folder:
            modality = 'Mammography'
        elif '06_Procedures' in parent_folder:
            modality = 'Procedures'

        category = f"{modality} Templates"

        return {
            'title': title,
            'modality': modality,
            'category': category,
            'lines': paragraphs,
            'docxBase64': docx_base64,
            'content': '\n'.join(paragraphs)
        }
    except Exception as e:
        print(f"Error parsing {filepath}: {e}")
        return None

def main():
    print(f"Scanning all .docx template files from: {DESKTOP_DIR}...")
    if not os.path.exists(DESKTOP_DIR):
        print(f"Error: {DESKTOP_DIR} does not exist.")
        return

    all_templates = []
    template_id_counter = 1

    for root, _, files in os.walk(DESKTOP_DIR):
        for f in sorted(files):
            if f.endswith('.docx') and not f.startswith('~$'):
                full_path = os.path.join(root, f)
                info = extract_docx_info(full_path)
                if info:
                    template_item = {
                        'id': f"tpl_{template_id_counter}",
                        'name': info['title'],
                        'title': info['title'],
                        'modality': info['modality'],
                        'category': info['category'],
                        'lines': info['lines'],
                        'docxBase64': info['docxBase64'],
                        'content': info['content']
                    }
                    all_templates.append(template_item)
                    template_id_counter += 1

    print(f"Found and parsed {len(all_templates)} DOCX templates.")

    if len(all_templates) == 0:
        print("No .docx files found. Aborting sync.")
        return

    # 1. Update templatesData.json in radnito and radiology-dictation
    for project_dir in [RADNITO_DIR, RADIOLOGY_DICTATION_DIR]:
        services_dir = os.path.join(project_dir, 'services')
        public_dir = os.path.join(project_dir, 'public')
        os.makedirs(services_dir, exist_ok=True)
        os.makedirs(public_dir, exist_ok=True)

        # Write templatesData.json
        td_file_services = os.path.join(services_dir, 'templatesData.json')
        td_file_public = os.path.join(public_dir, 'templatesData.json')

        with open(td_file_services, 'w', encoding='utf-8') as f_out:
            json.dump(all_templates, f_out, indent=2)
        with open(td_file_public, 'w', encoding='utf-8') as f_out:
            json.dump(all_templates, f_out, indent=2)

        print(f"Updated {td_file_services}")

    # 2. Build both projects
    print("\nBuilding radnito...")
    subprocess.run(["cmd.exe", "/c", "npm.cmd run build"], cwd=RADNITO_DIR, check=True)
    
    print("\nBuilding radiology-dictation...")
    subprocess.run(["cmd.exe", "/c", "npm.cmd run build"], cwd=RADIOLOGY_DICTATION_DIR, check=True)

    # 3. Commit and push radnito
    print("\nPushing updates to GitHub for radnito...")
    subprocess.run(["git", "add", "-A"], cwd=RADNITO_DIR, check=True)
    subprocess.run(["git", "commit", "-m", f"update: sync {len(all_templates)} templates from Desktop DOCX folder"], cwd=RADNITO_DIR)
    subprocess.run(["git", "push", f"https://{GITHUB_TOKEN}@github.com/medicoforever/radnito.git", "main"], cwd=RADNITO_DIR, check=True)

    # 4. Deploy gh-pages branch for radnito
    print("\nDeploying gh-pages for radnito...")
    tmp_target = os.path.join(RADNITO_DIR, "..", "radnito-gh-pages-sync-tmp")
    if os.path.exists(tmp_target):
        subprocess.run(["cmd.exe", "/c", f"rmdir /s /q \"{tmp_target}\""])
    subprocess.run(["git", "clone", f"https://{GITHUB_TOKEN}@github.com/medicoforever/radnito.git", tmp_target], check=True)
    subprocess.run(["git", "checkout", "--orphan", "gh-pages"], cwd=tmp_target, check=True)
    subprocess.run(["git", "rm", "-rf", "."], cwd=tmp_target, check=True)
    subprocess.run(["powershell", "-Command", f"Copy-Item -Path '{RADNITO_DIR}\\dist\\*' -Destination '{tmp_target}' -Recurse -Force"], check=True)
    subprocess.run(["git", "add", "-A"], cwd=tmp_target, check=True)
    subprocess.run(["git", "commit", "-m", "Deploy to GitHub Pages"], cwd=tmp_target)
    subprocess.run(["git", "push", "origin", "gh-pages", "--force"], cwd=tmp_target, check=True)
    subprocess.run(["cmd.exe", "/c", f"rmdir /s /q \"{tmp_target}\""])

    # 5. Commit and push radiology-dictation
    print("\nPushing updates to GitHub for radiology-dictation...")
    subprocess.run(["git", "add", "-A"], cwd=RADIOLOGY_DICTATION_DIR, check=True)
    subprocess.run(["git", "commit", "-m", f"update: sync {len(all_templates)} templates from Desktop DOCX folder"], cwd=RADIOLOGY_DICTATION_DIR)
    subprocess.run(["git", "push", f"https://{GITHUB_TOKEN}@github.com/medicoforever/radiology-dictation.git", "main"], cwd=RADIOLOGY_DICTATION_DIR, check=True)

    print("\n=======================================================")
    print(f"SUCCESS! Synced {len(all_templates)} templates to both web apps and GitHub.")
    print("=======================================================")

if __name__ == '__main__':
    main()
