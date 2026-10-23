#!/usr/bin/env python3
"""Matching 3x inspection crops. Both panels are OFFLINE, never WebGL."""
from pathlib import Path
import ctypes as C
import ctypes.util
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT.parent / 'agent-office-ledger/tycoon-canvas-milestone/spacing-quality'
lib = C.CDLL(ctypes.util.find_library('cairo'))
P, D, I = C.c_void_p, C.c_double, C.c_int

def fn(name, args, ret=None):
    f = getattr(lib, 'cairo_' + name)
    f.argtypes, f.restype = args, ret
    return f

surface = fn('image_surface_create', [I,I,I], P)
ctx = fn('create', [P], P)
load = fn('image_surface_create_from_png', [C.c_char_p], P)
source = fn('set_source_surface', [P,P,D,D])
paint = fn('paint', [P])
color = fn('set_source_rgb', [P,D,D,D])
size = fn('set_font_size', [P,D])
move = fn('move_to', [P,D,D])
text = fn('show_text', [P,C.c_char_p])
save = fn('save', [P]); restore = fn('restore', [P])
scale = fn('scale', [P,D,D]); translate = fn('translate', [P,D,D])
rect = fn('rectangle', [P,D,D,D,D]); clip = fn('clip', [P])
write = fn('surface_write_to_png', [P,C.c_char_p], I)
s = surface(0,1800,860); cr = ctx(s)
color(cr,15/255,29/255,26/255); paint(cr)
for label,x in [('BEFORE - accepted spacing, pre hands polish',24), ('AFTER - hands / keyboard / under-desk polish',924)]:
    color(cr,.91,.88,.78); size(cr,22); move(cr,x,32); text(cr,label.encode())
color(cr,.64,.74,.65); size(cr,16); move(cr,24,62)
text(cr,b'OFFLINE PROOF / equal 3x inspection scale / no WebGL screenshot / native scale remains 1')
save(cr); rect(cr,0,80,900,780); clip(cr)
source(cr,load(str(OUT/'polish_before_detail.png').encode()),0,80); paint(cr); restore(cr)
source(cr,load(str(OUT/'corrected_offline_detail.png').encode()),900,80); paint(cr)
assert write(s,str(OUT/'before-after.png').encode()) == 0
print(OUT/'before-after.png')
