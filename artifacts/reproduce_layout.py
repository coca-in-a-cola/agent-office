#!/usr/bin/env python3
"""Offline Cairo composite of ACTUAL exported atlas + production TS layout.
Not a WebGL screenshot. No invented coordinates, substitute SVGs or scaling.
"""
from pathlib import Path
import ctypes as C
import ctypes.util
import subprocess
import json
import argparse

ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser()
p.add_argument('--output', default=str(ROOT / 'artifacts/corrected_offline.png'))
p.add_argument('--pose', default='miro_typing_01')
a = p.parse_args()
layout = json.loads(subprocess.check_output([
    '/home/tyler/.bun/bin/bun', '-e',
    "import {calculateDioramaLayout} from './src/components/canvas/tycoonAssets.ts'; console.log(JSON.stringify(calculateDioramaLayout(400,270)));"
], cwd=ROOT / 'web', text=True))
atlas_path = ROOT / 'web/public/assets/sample'
sheet = json.loads((atlas_path / 'own_tycoon_atlas.json').read_text())
lib = C.CDLL(ctypes.util.find_library('cairo'))
ptr, dbl, integer = C.c_void_p, C.c_double, C.c_int

def bind(name, args, ret=None):
    f = getattr(lib, 'cairo_' + name)
    f.argtypes, f.restype = args, ret
    return f

surface = bind('image_surface_create', [integer, integer, integer], ptr)
load = bind('image_surface_create_from_png', [C.c_char_p], ptr)
context = bind('create', [ptr], ptr)
source = bind('set_source_surface', [ptr, ptr, dbl, dbl])
paint = bind('paint', [ptr])
rectangle = bind('rectangle', [ptr, dbl, dbl, dbl, dbl])
clip = bind('clip', [ptr])
save = bind('save', [ptr])
restore = bind('restore', [ptr])
scale = bind('scale', [ptr, dbl, dbl])
translate = bind('translate', [ptr, dbl, dbl])
color = bind('set_source_rgb', [ptr, dbl, dbl, dbl])
write = bind('surface_write_to_png', [ptr, C.c_char_p], integer)
tex = load(str(atlas_path / 'own_tycoon_atlas.png').encode())
canvas = surface(0, 800, 600)
cr = context(canvas)
color(cr, 15/255, 29/255, 26/255)
paint(cr)
nodes = layout['floorTiles'] + [layout[k] for k in ('wall', 'ficus', 'chair', 'desk', 'miro')]
if 'deskFront' in layout:
    nodes.append(layout['deskFront'])
for node in sorted(nodes, key=lambda n: n['zIndex']):
    name = node['name']
    name = 'floor_sage' if name.startswith('floor_') else a.pose if name == 'miro' else name
    f = sheet['frames'][name]['frame']
    x = node['screenX'] - node['anchor']['x'] * f['w']
    y = node['screenY'] - node['anchor']['y'] * f['h']
    save(cr)
    rectangle(cr, x, y, f['w'], f['h'])
    clip(cr)
    source(cr, tex, x - f['x'], y - f['y'])
    paint(cr)
    restore(cr)
out = Path(a.output)
out.parent.mkdir(parents=True, exist_ok=True)
assert write(canvas, str(out).encode()) == 0
# Clearly separate inspection enlargement: production geometry unchanged.
zoom = surface(0, 900, 660)
zcr = context(zoom)
scale(zcr, 3, 3)
source(zcr, canvas, -250, -160)
paint(zcr)
assert write(zoom, str(out.with_name(out.stem + '_detail.png')).encode()) == 0
out.with_suffix('.json').write_text(json.dumps({'kind': 'OFFLINE ATLAS COMPOSITE, NOT WEBGL', 'viewport': [800,600], 'runtimeScale': 1, 'pose': a.pose, 'layout': layout, 'atlas': sheet}, indent=2) + '\n')
print(out)
