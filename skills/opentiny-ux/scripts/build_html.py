#!/usr/bin/env python3
"""Assemble an offline HTML file; standard library only."""
import argparse
import html
from pathlib import Path
import re
import json
from tokens import css_for

ROOT = Path(__file__).resolve().parents[1]
def build(title, body, script='', style='', components='auto'):
    if re.search(r'</script\b', script, re.I):
        raise ValueError('Escape embedded </script in JavaScript strings.')
    if re.search(r'</style\b', style, re.I):
        raise ValueError('Unexpected </style in CSS.')
    manifest = json.loads((ROOT/'assets/modules.json').read_text(encoding='utf-8'))
    if components == 'auto':
        source = body + '\n' + script + '\n' + style
        selected = [key for key, value in manifest.items() if any(term in source for term in value['match'])]
        if 'UX.toast' in source and 'feedback' not in selected:
            selected.append('feedback')
    else:
        selected = list(dict.fromkeys(s.strip() for s in components.split(',') if s.strip()))
        unknown = set(selected) - set(manifest)
        if unknown:
            raise ValueError('Unknown component modules: '+', '.join(sorted(unknown)))
    component_css = (ROOT/'assets/components.css').read_text(encoding='utf-8')
    for key in selected:
        component_css += '\n/* module: '+key+' */\n' + (ROOT/'assets/modules'/f'{key}.css').read_text(encoding='utf-8')
    aliases = (ROOT/'assets/tokens.css').read_text(encoding='utf-8')
    token_css = css_for(aliases + component_css + body + script + style) + aliases
    values = {
        'TITLE': html.escape(title),
        'LICENSE': (ROOT/'references/upstream-license.txt').read_text(encoding='utf-8').replace('--', '—'),
        'TOKENS': token_css,
        'COMPONENTS': component_css,
        'RUNTIME': (ROOT/'assets/runtime.js').read_text(encoding='utf-8') if 'UX.' in body+script else '',
        'BODY': body, 'PAGE_SCRIPT': script, 'PAGE_STYLE': style,
    }
    result = re.sub(r'\{\{([A-Z_]+)\}\}', lambda m: values[m[1]], (ROOT/'assets/starter.html').read_text(encoding='utf-8'))
    return result

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--title', required=True); p.add_argument('--body', type=Path, required=True)
    p.add_argument('--script', type=Path); p.add_argument('--style', type=Path); p.add_argument('--output', type=Path, required=True)
    p.add_argument('--components', default='auto', help='Usually omit: detect modules from body/script. Override with comma-separated module names for dynamically constructed class names.')
    a = p.parse_args()
    out = build(a.title, a.body.read_text(encoding='utf-8'), a.script.read_text(encoding='utf-8') if a.script else '', a.style.read_text(encoding='utf-8') if a.style else '', a.components)
    a.output.parent.mkdir(parents=True, exist_ok=True)
    with a.output.open('x', encoding='utf-8') as file: file.write(out)
    print(a.output.resolve())
if __name__ == '__main__': main()
