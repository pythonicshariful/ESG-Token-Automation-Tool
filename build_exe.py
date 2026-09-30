import os
import subprocess
import sys
import shutil
import stat
import time

def force_rmtree(path):
    """Remove a directory tree, forcing deletion of read-only/locked files."""
    def handle_error(func, fpath, exc_info):
        # Try to change permissions and retry
        try:
            os.chmod(fpath, stat.S_IWRITE)
            func(fpath)
        except Exception:
            time.sleep(0.5)
            try:
                func(fpath)
            except Exception as e:
                print(f"  Warning: Could not delete {fpath}: {e}")
    shutil.rmtree(path, onerror=handle_error)

def get_playwright_browsers_path():
    """Find where Playwright installed its browsers on this machine."""
    # Default locations Playwright uses
    candidates = [
        os.path.join(os.environ.get('LOCALAPPDATA', ''), 'ms-playwright'),
        os.path.join(os.environ.get('USERPROFILE', ''), '.cache', 'ms-playwright'),
        os.path.expanduser('~/.cache/ms-playwright'),
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    return None

def build_executable():
    print("Installing build dependencies...")
    subprocess.run([sys.executable, "-m", "pip", "install", "pyinstaller", "playwright", "pandas", "flask", "requests", "appdirs"])
    
    print("\nEnsuring Playwright Chromium browser is installed...")
    subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"])
    
    print("\nBuilding executable...")
    
    # Kill any running instance of the EXE to avoid PermissionError
    subprocess.run(['taskkill', '/f', '/im', 'ESG_Automation.exe'], 
                   capture_output=True)  # Silently kill if running
    time.sleep(1)
    
    icon_path = "app_icon.ico"
    icon_line = f"icon=r'{os.path.abspath(icon_path)}'," if os.path.exists(icon_path) else ""
    
    spec_content = f"""# -*- mode: python ; coding: utf-8 -*-
import sys
from PyInstaller.utils.hooks import collect_all

datas_pw, binaries_pw, hiddenimports_pw = collect_all('playwright')

a = Analysis(
    ['app.py'],
    pathex=[],
    binaries=binaries_pw,
    datas=[('templates', 'templates')] + datas_pw,
    hiddenimports=['appdirs'] + hiddenimports_pw,
    hookspath=[],
    hooksconfig={{}},
    runtime_hooks=[],
    excludes=['docutils'],
    noarchive=False,
)

# Remove the broken pyi_rth_pkgres hook that crashes on invalid pkg versions
a.scripts = [s for s in a.scripts if 'pkgres' not in s[0]]

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    name='ESG_Automation',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    {icon_line}
)
"""
    
    with open("ESG_Automation.spec", "w") as f:
        f.write(spec_content)
    
    result = subprocess.run([sys.executable, "-m", "PyInstaller", "--noconfirm", "ESG_Automation.spec"])
    
    if result.returncode != 0:
        print("\nBuild FAILED. Check the output above for errors.")
        return
    
    # --- Copy Chromium browsers into dist folder ---
    print("\nLocating Playwright browsers to bundle...")
    browsers_src = get_playwright_browsers_path()
    
    if not browsers_src:
        print("WARNING: Could not find Playwright browser folder automatically.")
        print("Please manually copy your ms-playwright folder into dist\\")
    else:
        browsers_dst = os.path.join("dist", "ms-playwright")
        print(f"Copying browsers from: {browsers_src}")
        print(f"             into:     {browsers_dst}")
        print("(This may take a minute, Chromium is ~300MB...)")
        
        if os.path.exists(browsers_dst):
            force_rmtree(browsers_dst)
        shutil.copytree(browsers_src, browsers_dst)
        
        # --- Remove unnecessary browsers (Firefox, WebKit, headless shells only) ---
        # Keep ALL chromium versions — Playwright needs a specific revision
        print("Removing Firefox, WebKit, and headless Chromium (keeping all full Chromium versions)...")
        items = os.listdir(browsers_dst)

        headless_dirs = [x for x in items if 'headless_shell' in x]
        firefox_dirs  = [x for x in items if x.startswith('firefox-')]
        webkit_dirs   = [x for x in items if x.startswith('webkit-')]

        to_remove = headless_dirs + firefox_dirs + webkit_dirs

        for folder in to_remove:
            fp = os.path.join(browsers_dst, folder)
            if os.path.exists(fp):
                force_rmtree(fp)
                print(f"  Removed {folder}")

        final_size = sum(os.path.getsize(os.path.join(r, f)) for r, d, files in os.walk(browsers_dst) for f in files)
        print(f"Browser folder final size: {final_size/1024/1024:.0f} MB")
        print("Browser copy complete!")
    
    print("\n=======================================================")
    print("BUILD COMPLETE!")
    print("Your deliverable is the entire 'dist' folder.")
    print("ZIP the 'dist' folder and send it. Users just double-")
    print("click ESG_Automation.exe — no installation needed!")
    print("=======================================================")

if __name__ == "__main__":
    build_executable()
