#!/usr/bin/env python3
"""Find an OpenTiny reference without loading the whole component library."""
import argparse
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('query', nargs='?', default='')
    p.add_argument('--part', choices=['api', 'tokens', 'style', 'demo', 'recipe'])
    p.add_argument('--name', help='Exact demo filename or archive path from the lookup result')
    p.add_argument('--list-demos', action='store_true', help='List every demo; default shows at most 8')
    a = p.parse_args()
    index = json.loads((ROOT/'references/component-index.json').read_text(encoding='utf-8'))
    for value in index.values():
        if value.get('demos_from'):
            value['demos'] = index[value['demos_from']]['demos']
    matches = [a.query] if a.query in index else [k for k,v in index.items() if a.query.lower() in (k+' '+v['label']).lower()]
    if not matches:
        p.error('No matching component. Search the Chinese name or the upstream key.')
    if len(matches) != 1 or not a.part:
        for key in matches:
            v = index[key]
            print(f"{key} | {v['label']} | recipe: {v['recipe'] or 'adapt on demand'}")
            if len(matches) == 1:
                for part in ['api', 'tokens', 'style']:
                    print(f"  {part}: {v[part] or 'not in snapshot'}")
                if v.get('related'):
                    print('  composed from: '+', '.join(v['related']))
                print(f"  demos: {len(v['demos'])}")
                demos = v['demos'] if a.list_demos else sorted(v['demos'], key=lambda n: (Path(n).name not in ['basic-usage.vue', 'basic.vue'], n))[:8]
                print('\n'.join('    '+n for n in demos))
                if len(demos) < len(v['demos']):
                    print('    Use --list-demos only when needed.')
        return
    v = index[matches[0]]
    if a.part == 'recipe':
        if not v['recipe']:
            p.error('No native recipe; read tokens/style and implement only the requested branch.')
        print((ROOT/v['recipe']).read_text(encoding='utf-8'))
        return
    path = v.get(a.part)
    if a.part == 'demo':
        demos = v['demos']
        candidates = [n for n in demos if a.name in [n, Path(n).name]] if a.name else [n for n in demos if Path(n).name in ['basic-usage.vue', 'basic.vue']]
        if not candidates and demos and not a.name:
            candidates = demos[:1]
        if len(candidates) != 1:
            p.error('Choose an exact demo --name from the lookup result.')
        path = candidates[0]
    paths = [path] if path else []
    if not paths and a.part in ['tokens', 'style']:
        paths = [index[key][a.part] for key in v.get('related', []) if index.get(key, {}).get(a.part)]
        if paths:
            print('<!-- This composed control has no standalone theme; related base component sources follow. -->')
    if not paths:
        p.error(f'{a.part} not present in this snapshot; do not invent an upstream rule.')
    with zipfile.ZipFile(ROOT/'references/opentiny-reference.zip') as z:
        for path in paths:
            print(f'<!-- OpenTiny reference: {path}; reference only, not a runtime dependency. -->')
            print(z.read(path).decode('utf-8'))

if __name__ == '__main__':
    main()
