import os
import subprocess
import shutil

temp_dir = os.path.join(os.path.expanduser("~"), "temp_deploy_gh_pages")
if os.path.exists(temp_dir):
    shutil.rmtree(temp_dir, ignore_errors=True)

# Fetch remote URL from current git repo
res = subprocess.run(["git", "remote", "get-url", "origin"], capture_output=True, text=True, check=True)
repo_url = res.stdout.trim() if hasattr(res.stdout, 'trim') else res.stdout.strip()
dist_src = os.path.abspath("dist")

os.makedirs(temp_dir, exist_ok=True)
subprocess.run(["git", "init"], cwd=temp_dir, check=True)
subprocess.run(["git", "config", "user.name", "medicoforever"], cwd=temp_dir, check=True)
subprocess.run(["git", "config", "user.email", "medicoforever@github.com"], cwd=temp_dir, check=True)
subprocess.run(["git", "remote", "add", "origin", repo_url], cwd=temp_dir, check=True)
subprocess.run(["git", "checkout", "-b", "gh-pages"], cwd=temp_dir, check=True)

for item in os.listdir(dist_src):
    s = os.path.join(dist_src, item)
    d = os.path.join(temp_dir, item)
    if os.path.isdir(s):
        shutil.copytree(s, d)
    else:
        shutil.copy2(s, d)

# Add .nojekyll so GitHub Pages doesn't ignore files starting with _
with open(os.path.join(temp_dir, ".nojekyll"), "w") as f:
    f.write("")

subprocess.run(["git", "add", "."], cwd=temp_dir, check=True)
subprocess.run(["git", "commit", "-m", "Deploy to GitHub Pages"], cwd=temp_dir, check=True)
subprocess.run(["git", "push", "-u", "origin", "gh-pages", "--force"], cwd=temp_dir, check=True)

print("SUCCESS: gh-pages branch deployed successfully!")
