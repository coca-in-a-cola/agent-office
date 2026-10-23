#!/usr/bin/env python3
"""Original AO-TYCOON-01 art + local librsvg/Cairo export; no engine imports.
Run: python assets_src/vector/own_tycoon_sample/export_assets.py
"""
from pathlib import Path
import ctypes as C
import ctypes.util
import hashlib
import json
import datetime
import xml.etree.ElementTree as ET
import subprocess

SRC = Path(__file__).resolve().parent
ROOT = SRC.parents[2]
OUT = ROOT / 'web/public/assets/sample'
OUT.mkdir(parents=True, exist_ok=True)
INK = '#34453e'
DEFS = '''<defs>
<linearGradient id="wood" x2="0.25" y2="1"><stop stop-color="#d7a364"/><stop offset="1" stop-color="#a06535"/></linearGradient>
<linearGradient id="leaf" x2="1" y2="1"><stop stop-color="#95ba78"/><stop offset="1" stop-color="#3b7052"/></linearGradient>
<linearGradient id="cloth" x2="0.8" y2="1"><stop stop-color="#73aaa0"/><stop offset="1" stop-color="#376d65"/></linearGradient>
<linearGradient id="skin" x2="0.8" y2="1"><stop stop-color="#f7cba0"/><stop offset="1" stop-color="#d9906e"/></linearGradient>
<linearGradient id="screen" x2="0.5" y2="1"><stop stop-color="#244b50"/><stop offset="1" stop-color="#142e35"/></linearGradient>
</defs>'''
def path(d, fill='none', stroke=INK, sw=1.3, extra=''):
    return f'<path d="{d}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" {extra}/>'
def poly(points, fill, stroke=INK, sw=1.3):
    return f'<polygon points="{points}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round"/>'
def ellipse(x,y,rx,ry,fill,extra=''):
    return f'<ellipse cx="{x}" cy="{y}" rx="{rx}" ry="{ry}" fill="{fill}" {extra}/>'
def svg(w,h,body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">{DEFS}{body}</svg>'
assets = {}
def asset(name,w,h,foot,footprint,body,notes=''):
    text=svg(w,h,body)
    (SRC / (name+'.svg')).write_text(text)
    assets[name]={'size':[w,h], 'footAnchorPx':foot, 'footprintTiles':footprint,'notes':notes,'svg':text}

# One seamless diamond. No border or baked shadow along tile seams.
asset('floor_sage',64,32,[32,16],[1,1],poly('0,16 32,0 64,16 32,32','#3b6057','none')+path('M12 16 l3 -1.5 M29 8 l3 1.5 M45 19 l3 -1.5 M29 25 l2 1','#668478','#668478',.45), 'Exact 64x32 diamond; center anchor; no seam outline.')

# Interior corner: the shared foot is the BACK apex, with both returns
# descending towards the viewer. Each return exactly spans three tile edges.
wall=poly('12,62 112,12 212,62 208,64 112,16 16,64','#fff5df',sw=.7)
wall+=poly('16,64 112,16 112,88 16,136','#dedfce',sw=.7)
wall+=poly('112,16 208,64 208,136 112,88','#eee8d5',sw=.7)
wall+=poly('16,129 112,81 112,88 16,136','#536d60','none')
wall+=poly('112,81 208,129 208,136 112,88','#61796a','none')
wall+=path('M112 17 V80',stroke='#c0bca5',sw=.8)
wall+=path('M18 65 L110 19 M114 19 L206 65',stroke='#fff9e8',sw=1)
wall+=poly('40,65 65,52.5 65,78.5 40,91','#946b44',sw=.8)
wall+=poly('43,67 62,57.5 62,76.5 43,86','#f6eed7','none')
wall+=poly('43,79 51,70 57,73 62,66 62,76.5 43,86','#81a18a','none')
wall+=ellipse(56,65,2.5,3,'#dd9d54')
asset('wall_cutaway',224,160,[112,88],[3,3],wall,'Concave interior corner. Foot (112,88) maps to grid back vertex (originX,originY-16); returns end at +/-96,+48; height 72px.')

# Desk: 2x1 tile footprint, warm chamfered edge, hanging cable, monitor + espresso.
desk=ellipse(80,119,58,15,'#243f35','opacity=".18"')
for x,y,rx in [(40,120,7),(121,117,7),(115,120,12)]:
    desk+=ellipse(x,y,rx,2.8,'#172f2b','opacity=".12"')
    desk+=ellipse(x,y,rx*.65,1.3,'#172f2b','opacity=".15"')
for pts in ['36,87 43,90.5 43,121.5 36,118','117,89 124,85.5 124,115 117,118.5']:
    desk+=poly(pts,'#52605b')
desk+=poly('104,98 116,104 116,120 104,114','#69452c')+poly('116,104 126,99 126,115 116,120','#523b2b')
desk+=path('M108 105 l5 2.5',stroke='#ceaf73',sw=1.5)
desk+=path('M80 65 C70 86 100 93 92 110',stroke='#273f3b',sw=2)
desk+=poly('32,72 64,56 128,88 96,104','url(#wood)')
desk+=poly('32,72 96,104 96,110 32,78','#a06535')+poly('96,104 128,88 128,94 96,110','#714827')
desk+=path('M32 73 L98 106 L128 91',stroke='#efc890',sw=1.2)
desk+=path('M43 72 q12 1 25 10 M59 71 q15 3 28 12 M72 86 q12 2 23 10',stroke='#88582f',sw=.7)
# Monitor faces toward +Y, screen long axis +X.
desk+=poly('94,75 106,81 117,75.5 105,69.5','#52665d')
desk+=path('M105 63 V75',stroke='#334942',sw=3)
desk+=poly('87,43 119,59 119,79 87,63','#293d38',sw=1.5)
desk+=poly('90,47 116,60 116,74 90,61','url(#screen)',sw=.7)
desk+=path('M93 52 l6 3 M102 57 l10 5 M93 57 l13 6 M107 66 l5 2.5',stroke='#a6d0a2',sw=1)
# Keyboard is on the desktop plane, not a screen-facing rectangle.
desk+=poly('59,81 74,73.5 104,88.5 89,96','#533d2b','none')
desk+=poly('59,80 74,72.5 104,87.5 89,95','#263e42',sw=.9)
desk+=path('M60 81 L89 95 L103 88',stroke='#8fa59a',sw=.65)
# Three regular 2:1 rows: light keycaps separated by dark gutters.
for row in range(3):
    for col in range(7):
        x=73.5+col*4-row*3.3
        y=75+col*2+row*1.65
        desk+=poly(f'{x},{y} {x+3.1},{y+1.55} {x+.9},{y+2.65} {x-2.2},{y+1.1}', '#90b3ad' if row!=1 else '#769e99','none')
desk+=poly('73,86.8 85.5,93.05 87.7,91.95 75.2,85.7','#b4c3a3','none')
# Ochre mug, visible handle and coffee surface.
desk+=path('M112 81 C123 77 123 89 114 88',stroke='#f0cd8d',sw=2.3)
desk+=path('M105 75 L105 84 Q110 91 116 85 L116 80 Z','#d9a254',sw=.9)
desk+=ellipse(110.5,77.5,5.5,2.8,'#f7daa1')+ellipse(110.5,77.5,3.7,1.7,'#5c3a21')
desk+=path('M111 70 q-3 -3 0 -6',stroke='#f0e9cd',sw=.9,extra='opacity=".65"')
# Small amber sticky note on the monitor bezel.
desk+=poly('111,70 117,73 117,78 111,75','#e9ba63',sw=.4)
asset('desk_wood',160,144,[80,118],[2,1],desk,'Monitor, keyboard, coffee mug, drawer pedestal and cable are baked into one prop. Facing +Y.')
front=poly('32,72 96,104 96,110 32,78','#a06535')+poly('96,104 128,88 128,94 96,110','#714827')
front+=path('M33 73 L96 104 L127 88.5',stroke='#efc890',sw=1)
asset('desk_front',160,144,[80,118],[2,1],front,'Foreground apron only; exact shared desk anchor, masks lap below hands, not face or keyboard.')

chair=ellipse(48,106,27,7,'#213d35','opacity=".12"')
chair+=path('M39 82 L39 101',stroke='#b0c3b4',sw=3.4)
chair+=path('M39 100 L28 106 M39 100 L55 109 M39 100 L36 115',stroke='#98b0a0',sw=2.6)
for x,y in [(28,107),(55,110),(36,116)]:
    chair+=ellipse(x,y+1,4.5,1.6,'#17362d','opacity=".2"')
    chair+=ellipse(x,y,2.5,1.8,'#2a4941')
chair+=poly('28,73 52,61 78,74 54,86','#527f74')+poly('28,73 54,86 54,89 28,76','#39645c')+poly('54,86 78,74 78,77 54,89','#284a43')
chair+=path('M29 73 L54 85 L77 74',stroke='#9bb5a2',sw=1)
chair+=path('M33 71 L33 60 M76 76 L76 65',stroke='#64786d',sw=3)
chair+=path('M31 62 l13 6.5 M70 63 l13 6.5',stroke='#314c44',sw=4)
chair+=path('M44 30 Q42 23 49 24 L77 38 Q82 41 81 49 L78 70 Q77 74 71 72 L47 60 Z','url(#cloth)',sw=1.8)
chair+=path('M49 31 L73 43 M50 36 L72 47 M51 42 L71 52',stroke='#8bb5a5',sw=.7)
chair+=path('M60 61 l8 4',stroke='#bd9d61',sw=2)
chair='<g transform="translate(56 104) scale(.72) translate(-56 -104)">'+chair+'</g>'
asset('chair_teal',112,128,[56,104],[1,1],chair,'Unified human scale; chair and seated character share ground registration.')

plant=ellipse(56,143,28,9,'#243f35','opacity=".18"')
plant+=path('M35 112 L40 139 Q56 151 73 138 L78 112 Z','#b96f4d',sw=1.4)
plant+=path('M39 119 Q56 132 74 119 L73 127 Q56 138 41 127 Z','#d49368',sw=.5)
plant+=ellipse(56,113,21,10,'#e2ae7a',f'stroke="{INK}" stroke-width="1.2"')+ellipse(56,112,17,7,'#594837')
plant+=path('M56 115 Q51 88 58 33 M55 92 Q36 78 29 62 M57 76 Q76 64 82 49 M56 58 Q41 47 43 32',stroke='#736244',sw=3)
# Asymmetric leaves: each has a curled light-facing lip and visible midrib.
for x,y,ang,s in [(56,35,-20,1),(42,34,-48,.9),(29,59,-55,1.05),(39,77,-70,.95),(69,62,45,1.15),(82,48,48,.9),(62,87,65,.9),(49,96,-65,.8),(58,51,25,.85)]:
    plant+=f'<g transform="translate({x} {y}) rotate({ang}) scale({s})">'+path('M0 6 C-16 0 -15 -18 -3 -25 C9 -18 14 -3 0 6 Z','url(#leaf)',sw=1)+path('M0 4 L-3 -21',stroke='#b7cd8b',sw=.9)+path('M-3 -21 Q-10 -16 -10 -9',stroke='#bfd39b',sw=.6)+'</g>'
plant='<g transform="translate(56 141) scale(.46) translate(-56 -141)">'+plant+'</g>'
asset('ficus',112,160,[56,141],[1,1],plant,'Subordinate floor plant; 0.46 authored geometry scale, runtime scale 1.')

# Original character: Miro, a curly-haired developer with amber glasses and a pencil.
# Identical source rectangle and floor anchor across every pose.
def character(phase):
    typing=phase>0
    b=ellipse(52,105,27,4,'#243f35','opacity=".10"')
    for x,y in [(44,112),(62,112)]:
        b+=ellipse(x,y,8,1.8,'#172f2b','opacity=".24"')
        b+=ellipse(x,y,5,1.2,'#172f2b','opacity=".30"')
    b+=path('M29 83 Q35 80 41 86 L40 104 L47 108 L46 112 L34 111 Q31 108 32 103 L31 91 Z','#647882',sw=1.1)
    b+=path('M47 85 Q54 82 57 89 L58 98 L58 105 L64 108 L63 112 L53 109 L51 101 L50 94 Z','#81939a',sw=1.1)
    b+=path('M34 106 Q39 104 44 107 L50 110 Q51 112 47 113 L34 113 Z','#59493d',sw=1)
    b+=path('M55 105 Q60 104 64 107 L70 110 Q71 113 66 113 L54 110 Z','#806346',sw=1)
    b+=path('M35 113 L48 113 M56 110 L69 112',stroke='#d4c4a1',sw=1)
    b+=path('M34 90 L35 103 M54 91 L54 98 L55 105',stroke='#a3b2af',sw=.8)
    b+=path('M25 59 Q39 50 52 61 L57 84 Q43 96 25 84 Z','url(#cloth)',sw=1.7)
    b+=path('M36 58 L39 71 L46 60','#e7d5ad',sw=.8)
    b+=path('M38 72 L37 85 M47 77 l6 2',stroke='#abd0b5',sw=.9)
    b+=ellipse(39,78,1,1,'#d7b570')
    b+=path('M34 51 L34 60 Q40 66 45 59 L45 49','url(#skin)',sw=1)
    # Large soft head, asymmetrical curls, three-quarter face looking +X/+Y.
    b+=path('M21 30 Q20 12 39 11 Q59 10 62 28 L61 44 Q57 60 42 59 Q23 55 21 39 Z','url(#skin)',sw=1.7)
    b+=ellipse(23,39,5,7,'#e4a581',f'stroke="{INK}" stroke-width="1"')
    b+=path('M22 36 Q15 31 19 24 Q14 16 24 13 Q23 5 34 9 Q40 3 46 9 Q55 4 58 14 Q67 16 62 25 L60 31 Q49 29 45 21 Q40 31 28 29 L27 39 L23 40 Z','#513b31',sw=1.6)
    b+=path('M24 19 q1 -5 7 -4 M36 15 q4 -4 8 0 M50 16 q5 -2 7 3',stroke='#8c6550',sw=1.5)
    # Golden rounded glasses with dark eyes, bridge and temple.
    b+=path('M31 34 Q37 31 42 35 L42 42 Q36 46 31 41 Z M47 36 Q53 33 59 36 L58 43 Q52 47 47 43 Z',stroke='#a57438',sw=1.6)
    b+=path('M42 37 L47 38 M26 33 L31 36',stroke='#a57438',sw=1.4)
    b+=ellipse(38,38,1.4,2,'#2d3935')+ellipse(53,39,1.4,2,'#2d3935')
    b+=path('M45 40 l-1 5 4 1',stroke='#bd7e5f',sw=.9)
    b+=path('M43 51 Q49 54 53 49',stroke='#734e3d',sw=1.1)
    b+=ellipse(33,47,3,1.4,'#d98e70','opacity=".6"')
    b+=path('M23 24 L19 12',stroke='#e5b85e',sw=2)
    if not typing:
        b+=path('M25 62 Q18 64 22 73 L26 78 L33 77 L32 73 L29 69 L30 67','url(#cloth)',sw=1.2)
        b+=poly('28,73 33,73 35,78 30,80','#d4e4cf',sw=.7)
        b+=path('M34 77 Q37 76 40 79 L44 81 Q45 83 42 83 L36 81 L32 80 Z','url(#skin)',sw=1)
        b+=path('M51 63 Q58 63 60 73 L55 81 L49 79 L53 72','url(#cloth)',sw=1.2)
        b+=poly('50,77 56,80 54,84 48,81','#d4e4cf',sw=.7)
        b+=path('M51 82 Q55 82 58 85 L61 87 Q61 89 58 89 L52 86 L49 84 Z','url(#skin)',sw=1)
    else:
        # Each closed silhouette is one shoulder -> elbow -> forearm -> cuff -> hand.
        # Fingertips stay over the key plane; phases alternate a small finger press.
        near=0 if phase==1 else -1.7
        far=-1.7 if phase==1 else 0
        b+=ellipse(80,85,6,2,'#142f32','opacity=".45"')
        b+=ellipse(60,84,6,2,'#142f32','opacity=".45"')
        b+=path('M51 62 Q58 61 62 67 L65 73 L71 76 L68 81 L60 77 L57 70 L53 68','url(#cloth)',sw=1.2)
        b+=path('M57 66 L61 73 L65 76',stroke='#a0c7b5',sw=.9)
        b+=poly('65,73 73,77 70,83 63,79','#e1d4ab',sw=.8)
        b+=path(f'M71 78 Q75 77 78 80 L82 {82+far} Q85 {83+far} 83 {85+far} L80 {84+far} Q82 {87+far} 79 {87+far} L76 84 Q74 85 73 83 L69 82 Z','#efad7d',stroke='#694638',sw=.95)
        b+=path(f'M77 81 L80 {84+far} M79 80 L82 {83+far}',stroke='#a96550',sw=.75)
        b+=path('M25 62 Q19 64 21 72 L25 82 Q27 85 32 85 L46 82 L45 76 L30 77 L29 68','url(#cloth)',sw=1.3)
        b+=path('M24 69 L27 79 L32 81 L41 79',stroke='#a0c7b5',sw=1)
        b+=poly('43,76 48,76 49,82 44,83','#d4e4cf',sw=.8)
        b+=path(f'M49 77 Q54 76 57 78 L62 {81+near} Q65 {82+near} 63 {84+near} L60 {83+near} Q62 {86+near} 59 {86+near} L56 82 Q53 83 52 81 L48 82 Z','#efad7d',stroke='#694638',sw=.95)
        b+=path(f'M55 78 L60 {83+near} M58 78 L62 {82+near}',stroke='#a96550',sw=.75)
    return '<g transform="translate(40 103) scale(.72) translate(-40 -103)">'+b+'</g>'
for name,phase in [('miro_idle',0),('miro_typing_01',1),('miro_typing_02',2)]:
    asset(name,80,112,[40,103],[1,1],character(phase),'Miro, original fictional developer; seated working silhouette; +X/+Y three-quarter view. Fixed anchor across poses.')

# Local system libraries, already present on the host. No installs or network.
rsvg=C.CDLL(ctypes.util.find_library('rsvg-2'))
cairo=C.CDLL(ctypes.util.find_library('cairo'))
gobj=C.CDLL(ctypes.util.find_library('gobject-2.0'))
def bind(lib,name,args,ret):
    fn=getattr(lib,name); fn.argtypes=args; fn.restype=ret; return fn
ptr=C.c_void_p; integer=C.c_int; dbl=C.c_double
newsvg=bind(rsvg,'rsvg_handle_new_from_data',[C.c_char_p,C.c_size_t,ptr],ptr)
render=bind(rsvg,'rsvg_handle_render_cairo',[ptr,ptr],integer)
new_surface=bind(cairo,'cairo_image_surface_create',[integer,integer,integer],ptr)
ctx=bind(cairo,'cairo_create',[ptr],ptr)
png=bind(cairo,'cairo_surface_write_to_png',[ptr,C.c_char_p],integer)
source=bind(cairo,'cairo_set_source_surface',[ptr,ptr,dbl,dbl],None)
paint=bind(cairo,'cairo_paint',[ptr],None)
destroy=bind(cairo,'cairo_destroy',[ptr],None)
free_surface=bind(cairo,'cairo_surface_destroy',[ptr],None)
unref=bind(gobj,'g_object_unref',[ptr],None)
def raster(text,w,h):
    data=text.encode(); handle=newsvg(data,len(data),None)
    assert handle, 'Invalid SVG'
    surface=new_surface(0,w,h); cr=ctx(surface)
    assert render(handle,cr), 'librsvg failed'
    destroy(cr); unref(handle); return surface
def save(surface,path):
    assert png(surface,str(path).encode())==0

atlas=new_surface(0,1024,1024); cr=ctx(atlas)
frames={}; manifest_frames={}; x=y=4; rowh=0
for name,a in assets.items():
    w,h=a['size']
    if x+w+4>1024: x=4; y+=rowh+8; rowh=0
    assert y+h+4<=1024
    surface=raster(a['svg'],w,h)
    source(cr,surface,x,y); paint(cr); free_surface(surface)
    ax,ay=a['footAnchorPx']
    frames[name]={'frame':{'x':x,'y':y,'w':w,'h':h},'rotated':False,'trimmed':False,'spriteSourceSize':{'x':0,'y':0,'w':w,'h':h},'sourceSize':{'w':w,'h':h},'anchor':{'x':ax/w,'y':ay/h}}
    manifest_frames[name]={k:v for k,v in a.items() if k!='svg'}
    manifest_frames[name]['source']=f'assets_src/vector/own_tycoon_sample/{name}.svg'
    manifest_frames[name]['sha256']=hashlib.sha256(a['svg'].encode()).hexdigest()
    x+=w+8; rowh=max(rowh,h)
destroy(cr); save(atlas,OUT/'own_tycoon_atlas.png'); free_surface(atlas)
sheet={'frames':frames,'animations':{'miro_idle':['miro_idle'],'miro_typing':['miro_typing_01','miro_typing_02']},'meta':{'app':'Artist-2D native librsvg/Cairo exporter','version':'1.0','image':'own_tycoon_atlas.png','format':'RGBA8888','size':{'w':1024,'h':1024},'scale':'1'}}
(OUT/'own_tycoon_atlas.json').write_text(json.dumps(sheet,indent=2)+'\n')

# Contact sheet is presentation only, never packed into the runtime atlas.
def embed(name,x,y,scale=1.0):
    a=assets[name]; content=a['svg'].split('>',1)[1].rsplit('</svg>',1)[0]
    # Namespace all paint-server IDs for safe nesting multiple frames.
    key=f'i{str(x).replace(".","_")}_{str(y).replace(".","_")}_{name}'
    for ident in ['wood','leaf','cloth','skin','screen']:
        content=content.replace(f'id="{ident}"',f'id="{key}_{ident}"').replace(f'url(#{ident})',f'url(#{key}_{ident})')
    return f'<g transform="translate({x} {y}) scale({scale})">{content}</g>'
def text(x,y,s,size=18,color='#e8e1ca',weight='normal'):
    return f'<text x="{x}" y="{y}" font-family="sans-serif" font-size="{size}" font-weight="{weight}" fill="{color}">{s}</text>'
contact='<rect width="1600" height="1260" fill="#182e29"/>'
contact+=text(64,69,'WALNUT &amp; SAGE',40,weight='bold')+text(66,104,'AO–TYCOON–01  /  ORIGINAL VECTOR STUDY  /  ARTIST–2D',15,'#a9bda7')
contact+=path('M64 128 H1536',stroke='#526b59',sw=1)
# Main vignette: same production layout and anchors, presentation enlargement only.
contact+='<rect x="64" y="158" width="850" height="568" rx="24" fill="#243f36"/>'
layout=json.loads(subprocess.check_output(['/home/tyler/.bun/bin/bun','-e',"import {calculateDioramaLayout} from './src/components/canvas/tycoonAssets.ts'; console.log(JSON.stringify(calculateDioramaLayout(180,175)));"],cwd=ROOT/'web',text=True))
nodes=layout['floorTiles']+[layout[k] for k in ['wall','ficus','chair','miro','desk','deskFront']]
scene=''
for node in sorted(nodes,key=lambda n:n['zIndex']):
    name=node['name']
    name='floor_sage' if name.startswith('floor_') else 'miro_typing_01' if name=='miro' else name
    w,h=assets[name]['size']
    scene+=embed(name,node['screenX']-node['anchor']['x']*w,node['screenY']-node['anchor']['y']*h)
contact+=f'<g transform="translate(45 70) scale(2.25)">{scene}</g>'
contact+=text(94,690,'A small studio. A good cup. One more build.',18,'#e0d3b1')
# Intent / palette panel.
contact+=text(966,201,'THE LITTLE DETAILS',22,weight='bold')
for n,line in enumerate(['Honey-lit oak. Terracotta. Sage.','Amber glasses and unruly curls.','A pencil behind the ear.','A sunrise pinned to the wall.','Coffee beside a tiny green terminal.','Two alternating typing gestures.']):
    contact+=text(966,245+n*33,line,17,'#b9c9b5')
for i,col in enumerate(['#3b6057','#a06535','#5c3a21','#e9dfc5','#72a79b','#bd7756']):
    contact+=f'<rect x="{966+i*86}" y="479" width="66" height="48" rx="10" fill="{col}"/>'
contact+=text(966,571,'2:1 DIMETRIC  /  64 × 32 FLOOR',15,'#d6c398')+text(966,604,'Shared foot anchor on all character frames.',15,'#b9c9b5')+text(966,635,'Sample art only — owner review pending.',15,'#b9c9b5')
# Individual inventory cards, original exports shown at 1.65x.
for idx,name in enumerate(assets):
    col=idx%5; row=idx//5; xx=64+col*298; yy=758+row*235
    contact+=f'<rect x="{xx}" y="{yy}" width="274" height="216" rx="16" fill="#2c463b"/>'
    w,h=assets[name]['size']; sc=min(1.35,164/h,250/w)
    contact+=embed(name,xx+(274-w*sc)/2,yy+14,sc)
    contact+=text(xx+14,yy+191,name,13,'#f0e3c5',weight='bold')
    contact+=text(xx+200,yy+191,f'{w}×{h}',10,'#a9bda7')
contact+=text(66,1242,'Hand-authored SVG originals • Local librsvg / Cairo rasterization • No copied sprites • No online generation',14,'#9eb29d')
contact_svg=svg(1600,1260,contact)
(SRC/'contact_sheet.svg').write_text(contact_svg)
surf=raster(contact_svg,1600,1260); save(surf,OUT/'own_tycoon_contact_sheet.png'); free_surface(surf)
manifest={'id':'AO-TYCOON-01-own-tycoon-sample','title':'Walnut & Sage','createdUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'projection':{'type':'2:1 dimetric','tileSize':[64,32],'formula':'screenX=(gx-gy)*32; screenY=(gx+gy)*16-z'},'provenance':{'author':'Artist-2D / OpenAI gpt-6.1-sol','method':'Original hand-authored SVG geometry, Python art-export script, local system librsvg + Cairo; no external artwork or image generator.','model':'gpt-6.1-sol (SVG authoring, not image synthesis)','prompt':'AO-TYCOON-01: original cozy Game Dev Tycoon homage; sage 64x32 floor, cutaway wall, warm wooden desk with monitor and mug, chair, ficus, expressive chibi idle and two typing phases; unified 2:1 projection.','seed':None,'seedReason':'Deterministic hand-authored geometry; no stochastic generator.','referenceImageSha256':None,'referenceUse':'No reference image opened, traced, or copied. Textual art direction from milestone plan section 4 and user brief.','generatorScriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},'atlas':{'image':'own_tycoon_atlas.png','json':'own_tycoon_atlas.json','size':[1024,1024],'paddingPx':4,'betweenFramesPx':8,'rotated':False,'trimmed':False,'extruded':False,'samplingAdvice':'Linear or nearest at integer zoom; disable mipmaps for this sample with transparent gutters.','sha256':hashlib.sha256((OUT/'own_tycoon_atlas.png').read_bytes()).hexdigest()},'frames':manifest_frames,'animation':{'idle':{'frames':['miro_idle'],'fps':1},'typing':{'frames':['miro_typing_01','miro_typing_02'],'fps':6,'loop':True}},'anchorConvention':'footAnchorPx is absolute pixel position within untrimmed source rectangle; Pixi defaultAnchor=footAnchorPx/sourceSize. Floor uses center; furniture uses ground contact/sort point. Draw position equals ground anchor.','assemblyNotes':['Each prop has one orientation only; no runtime rotation variants in this sample.','Character is a seated pose; align ground anchors with chair (slight seat adjustment may be desired during integration).','Desk is a baked single sprite. Character hands/desk occlusion may require layer splitting in future integration; no canvas change made.','Contact sheet is an art-direction vignette, not proof of runtime placement or rendering.'],'review':{'visualAcceptance':'PENDING OWNER','canvasIntegration':'NOT PERFORMED','fpsContextLossMobile':'NOT TESTED'}}
manifest['provenance']['prompt']='AO01 local hands/keyboard/under-desk polish only: two continuous shoulder-elbow-forearm-cuff-skin-hand chains over a dark keyboard with three regular key rows; alternating finger presses in two phases, distinct resting idle; separate trouser/shoe silhouettes and lighter chair base with open gaps and soft contact shadows. Preserve accepted walls, floor, ficus scale, face/glasses and production layout. Offline atlas composite, not WebGL.'
reference=ROOT/'artifacts/polish_before_detail.png'
manifest['provenance']['referenceImageSha256']=hashlib.sha256(reference.read_bytes()).hexdigest() if reference.exists() else None
manifest['provenance']['referenceUse']='Own pre-polish offline atlas detail inspected via vision_analyze for hands and under-desk defect correction; no external artwork traced. Null seed: deterministic authored SVG geometry.'
manifest['assemblyNotes']=['Runtime scale is 1 for all frames; scene may be uniformly enlarged for inspection.','3x3 floor uses 64x32 frames with center anchor and 32/16 steps.','Concave wall foot (112,88) maps to originX,originY-16; both 96x48 returns align with full back boundaries.','Desk desktop z240, Miro z250, foreground apron z300; apron and desktop share anchor (80,118).','Chair and seated Miro share ground position (0.35,1.15).','Ficus is authored at 0.46 of former geometry about its ground anchor; chair and Miro at 0.72.','Contact vignette reads production calculateDioramaLayout; artifacts/reproduce_layout.py crops the actual runtime atlas. Neither is a WebGL screenshot.']
manifest['review']['canvasIntegration']='Production layout and split apron updated in tycoonAssets.ts; offline atlas composite inspected; WebGL gate pending.'
(OUT/'own_tycoon_manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print('EXPORTED',len(assets),'original SVG frames + contact SVG; atlas 1024x1024; contact 1600x1260')
print(OUT)
