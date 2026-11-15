#!/usr/bin/env python3
"""Static single-file checks. Browser interaction/visual QA is still required."""
from html.parser import HTMLParser
from pathlib import Path
import argparse
import re
import shutil
import subprocess
import tempfile

class Check(HTMLParser):
    def __init__(self):
        super().__init__(); self.ids=set(); self.errors=[]; self.scripts=[]; self.code=None
    def handle_starttag(self, tag, attrs):
        a=dict(attrs)
        if 'id' in a:
            if a['id'] in self.ids: self.errors.append('Duplicate id: '+a['id'])
            self.ids.add(a['id'])
        for key in ('src','srcset','poster'):
            if key in a and a[key] and not a[key].startswith(('data:','#')):
                self.errors.append('Non-embedded asset: '+a[key][:80])
        if tag=='link' and a.get('rel') in ('stylesheet','preload','modulepreload'): self.errors.append('External asset link')
        if tag=='script':
            if a.get('type')=='module': self.errors.append('Module script: use classic script for file://')
            self.code='' if a.get('type','') not in ('application/json','application/ld+json') else None
        if tag=='form' and a.get('action'): self.errors.append('Form action submits outside the prototype')
    def handle_data(self, data):
        if self.code is not None: self.code+=data
    def handle_endtag(self, tag):
        if tag=='script' and self.code is not None: self.scripts.append(self.code); self.code=None

def check(path):
    source=path.read_text(encoding='utf-8'); p=Check(); p.feed(source)
    if not re.search(r'<!doctype html',source,re.I): p.errors.append('Missing HTML doctype')
    if '{{TOKENS}}' in source or '{{BODY}}' in source: p.errors.append('Unexpanded template')
    if re.search(r'@import\s',source): p.errors.append('CSS @import')
    for match in re.findall(r'(?<![\w])url\((.*?)\)',source,re.I):
        value=match.strip(' \"\'')
        if value and not value.startswith(('data:','#')): p.errors.append('Non-embedded CSS asset: '+value[:80])
    for script in p.scripts:
        if re.search(r'\b(fetch\s*\(|XMLHttpRequest\b|WebSocket\b|import\s*\()',script): p.errors.append('Network or dynamic import API detected; review/remove')
    node=shutil.which('node')
    if node:
        for script in p.scripts:
            with tempfile.TemporaryDirectory() as directory:
                script_path = Path(directory)/'check.js'
                script_path.write_text(script,encoding='utf-8')
                r=subprocess.run([node,'--check',str(script_path)],capture_output=True,text=True,encoding='utf-8',errors='replace')
                if r.returncode: p.errors.append(r.stderr)
    else: print('NOTE: Node unavailable; JS syntax check skipped.')
    print(('FAIL' if p.errors else 'PASS')+': '+str(path))
    for error in p.errors: print(' - '+error)
    print('Static checks only; inspect rendered UI and complete the main flow.')
    return not p.errors
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__); parser.add_argument('html',type=Path); args=parser.parse_args()
    raise SystemExit(0 if check(args.html) else 1)
