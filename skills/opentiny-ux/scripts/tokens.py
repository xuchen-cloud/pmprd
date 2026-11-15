#!/usr/bin/env python3
"""Query official tokens or emit just the variables a standalone HTML needs."""
import argparse
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REF = re.compile(r'var\(\s*(--tv-[\w-]+)')

def declarations(source):
    source = re.sub(r'/\*.*?\*/', '', source, flags=re.S)
    source = re.sub(r'//[^\n]*', '', source)
    return dict((k, v.strip()) for k, v in re.findall(r'(--[\w-]+)\s*:\s*([^;]+);', source))

def load_tokens(include_components=False):
    base = json.loads((ROOT/'references/token-index.json').read_text(encoding='utf-8'))
    if include_components:
        with zipfile.ZipFile(ROOT/'references/opentiny-reference.zip') as z:
            for path in z.namelist():
                if path.startswith('theme/') and path.endswith('/vars.less') and path != 'theme/base/vars.less':
                    for key, value in declarations(z.read(path).decode('utf-8')).items():
                        base.setdefault(key, value)
    return base

def css_for(source):
    """Preserve var() dependency chains, so semantic values override fallbacks."""
    tokens = load_tokens()
    local = declarations(source)
    requested = set(REF.findall(source))
    if any(k not in tokens and k not in local for k in requested):
        tokens = load_tokens(True)
    needed = set()
    def add(key, stack=()):
        if key in needed or key in stack:
            return
        if key in local and key not in tokens:
            return
        if key not in tokens:
            return  # A caller's explicit CSS fallback remains intact.
        needed.add(key)
        for dependency in REF.findall(tokens[key]):
            add(dependency, stack+(key,))
    for key in requested:
        add(key)
    return ':root {\n'+''.join(f'  {k}: {v};\n' for k,v in tokens.items() if k in needed)+'}\n' if needed else ''

def resolve(value, tokens, stack=()):
    start = value.find('var(')
    if start < 0:
        return value
    depth, end = 1, start+4
    while depth and end < len(value):
        depth += (value[end] == '(') - (value[end] == ')')
        end += 1
    if depth:
        raise ValueError('Unbalanced CSS variable')
    args = value[start+4:end-1]
    name, _, fallback = args.partition(',')
    name = name.strip()
    if name in stack:
        raise ValueError('Cyclic token reference: '+name)
    if name in tokens:
        replacement = resolve(tokens[name], tokens, stack+(name,))
    elif fallback:
        replacement = resolve(fallback.strip(), tokens, stack)
    else:
        replacement = 'UNRESOLVED('+name+')'
    return value[:start]+replacement+resolve(value[end:], tokens, stack)

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('query', help='Token name or group: space, font, size, radius, shadow, color; component prefix e.g. Steps')
    p.add_argument('--css', action='store_true', help='Emit only matching tokens and transitive dependencies')
    a = p.parse_args()
    tokens = load_tokens()
    query = {'spacing':'space', 'typography':'font', 'radius':'border-radius'}.get(a.query, a.query)
    matches = [k for k in tokens if query.lower() in k.lower()]
    if not matches:
        tokens = load_tokens(True)
        matches = [k for k in tokens if query.lower() in k.lower()]
    if not matches:
        p.error('No token matched; consult component.py for its theme sources.')
    if a.css:
        print(css_for(' '.join('var('+k+')' for k in matches)))
    else:
        for k in matches:
            print(f'{k}: {tokens[k]} => {resolve(tokens[k], tokens, (k,))}')

if __name__ == '__main__':
    main()
