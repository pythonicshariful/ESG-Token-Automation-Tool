# -*- mode: python ; coding: utf-8 -*-
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
    hooksconfig={},
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
    icon=r'D:\Fiverr\eaststaginggrounds.com.sg\app_icon.ico',
)
