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

# Low cutaway return: all plan-view straight edges have dy/dx = +/- 0.5.
wall=poly('16,100 112,148 176,116 80,68','#263e36','none')
wall+=poly('16,30 112,78 112,142 16,94','#dedfce')
wall+=poly('112,78 176,46 176,110 112,142','#f1ecda')
wall+=poly('16,30 24,26 112,70 168,42 176,46 112,78','#fff5df')
wall+=poly('16,83 112,131 112,142 16,94','#465850')+poly('112,131 176,99 176,110 112,142','#62736a')
wall+=path('M20 34 L109 78 M116 78 L172 50',stroke='#fff9e8',sw=1)
# Little pinned original sunrise print and brass pin.
wall+=poly('44,53 71,66.5 71,91.5 44,78','#f6eed7',sw=.8)
wall+=poly('47,71 57,68 68,82 68,87 47,76.5','#81a18a','none')+ellipse(60,72,3,3,'#dd9d54')+ellipse(57,61,1.1,1.1,'#c19551')
wall+=path('M130 106 L162 90',stroke='#cabfa5',sw=.8)
asset('wall_cutaway',192,160,[112,142],[3,2],wall,'Back corner only; foreground open. Foot anchor is wall corner on floor; height 64px.')

# Desk: 2x1 tile footprint, warm chamfered edge, hanging cable, monitor + espresso.
desk=ellipse(80,119,58,15,'#243f35','opacity=".18"')
for pts in ['36,87 43,90.5 43,121.5 36,118','117,89 124,85.5 124,115 117,118.5']:
    desk+=poly(pts,'#52605b')
desk+=poly('66,97 86,107 86,127 66,117','#69452c')+poly('86,107 107,96.5 107,116.5 86,127','#523b2b')
desk+=path('M92 110 l8 -4',stroke='#ceaf73',sw=2)
desk+=path('M80 65 C70 86 100 93 92 110',stroke='#273f3b',sw=2)
desk+=poly('30,72 62,56 130,90 98,106','url(#wood)')
desk+=poly('30,72 98,106 98,113 30,79','#a06535')+poly('98,106 130,90 130,97 98,113','#714827')
desk+=path('M32 73 L98 106 L128 91',stroke='#efc890',sw=1.2)
desk+=path('M43 72 q12 1 25 10 M59 71 q15 3 28 12 M72 86 q12 2 23 10',stroke='#88582f',sw=.7)
# Monitor faces toward +Y, screen long axis +X.
desk+=poly('72,72 85,78.5 96,73 83,66.5','#52665d')+poly('82,59 87,61.5 87,74 82,71.5','#334942')
desk+=poly('60,30 101,50.5 101,77.5 60,57','#293d38',sw=1.8)
desk+=poly('64,35 97,51.5 97,70.5 64,54','url(#screen)',sw=.7)
desk+=path('M68 42 l6 3 M78 47 l12 6 M68 47 l12 6 M83 54 l8 4 M68 52 l4 2',stroke='#a6d0a2',sw=1.4)
desk+=ellipse(82,65,1,1,'#d8b566')
# Keyboard is on the desktop plane, not a screen-facing rectangle.
desk+=poly('52,78 64,72 90,85 78,91','#dedccb',sw=.8)
for x,y in [(59,78),(65,81),(71,84),(66,76),(72,79),(78,82)]:
    desk+=path(f'M{x} {y} l3 1.5',stroke='#657970',sw=1)
desk+=path('M65 84 l9 4.5',stroke='#657970',sw=1)
# Ochre mug, visible handle and coffee surface.
desk+=path('M112 81 C123 77 123 89 114 88',stroke='#f0cd8d',sw=2.3)
desk+=path('M105 75 L105 84 Q110 91 116 85 L116 80 Z','#d9a254',sw=.9)
desk+=ellipse(110.5,77.5,5.5,2.8,'#f7daa1')+ellipse(110.5,77.5,3.7,1.7,'#5c3a21')
desk+=path('M111 70 q-3 -3 0 -6',stroke='#f0e9cd',sw=.9,extra='opacity=".65"')
# Small amber sticky note on the monitor bezel.
desk+=poly('93,66 99,69 99,75 93,72','#e9ba63',sw=.4)
asset('desk_wood',160,144,[80,118],[2,1],desk,'Monitor, keyboard, coffee mug, drawer pedestal and cable are baked into one prop. Facing +Y.')

chair=ellipse(56,104,32,9,'#243f35','opacity=".18"')
chair+=path('M56 81 L56 101 M56 100 L34 105 M56 100 L77 108 M56 100 L59 113 M56 100 L70 94',stroke='#50645a',sw=3)
for x,y in [(34,106),(78,109),(59,114),(70,95)]:
    chair+=ellipse(x,y,3,2.5,'#2e433c')
chair+=poly('28,73 52,61 83,76.5 59,88.5','#3d645c')+poly('28,73 59,88.5 59,94 28,78.5','#304f49')+poly('59,88.5 83,76.5 83,82 59,94','#233f39')
chair+=path('M33 71 L33 60 M76 76 L76 65',stroke='#64786d',sw=3)
chair+=path('M31 62 l13 6.5 M70 63 l13 6.5',stroke='#314c44',sw=4)
chair+=path('M44 30 Q42 23 49 24 L77 38 Q82 41 81 49 L78 70 Q77 74 71 72 L47 60 Z','url(#cloth)',sw=1.8)
chair+=path('M49 31 L73 43 M50 36 L72 47 M51 42 L71 52',stroke='#8bb5a5',sw=.7)
chair+=path('M60 61 l8 4',stroke='#bd9d61',sw=2)
asset('chair_teal',112,128,[56,104],[1,1],chair,'Matching desk orientation; freestanding chair, no character baked in.')

plant=ellipse(56,143,28,9,'#243f35','opacity=".18"')
plant+=path('M35 112 L40 139 Q56 151 73 138 L78 112 Z','#b96f4d',sw=1.4)
plant+=path('M39 119 Q56 132 74 119 L73 127 Q56 138 41 127 Z','#d49368',sw=.5)
plant+=ellipse(56,113,21,10,'#e2ae7a',f'stroke="{INK}" stroke-width="1.2"')+ellipse(56,112,17,7,'#594837')
plant+=path('M56 115 Q51 88 58 33 M55 92 Q36 78 29 62 M57 76 Q76 64 82 49 M56 58 Q41 47 43 32',stroke='#736244',sw=3)
# Asymmetric leaves: each has a curled light-facing lip and visible midrib.
for x,y,ang,s in [(56,35,-20,1),(42,34,-48,.9),(29,59,-55,1.05),(39,77,-70,.95),(69,62,45,1.15),(82,48,48,.9),(62,87,65,.9),(49,96,-65,.8),(58,51,25,.85)]:
    plant+=f'<g transform="translate({x} {y}) rotate({ang}) scale({s})">'+path('M0 6 C-16 0 -15 -18 -3 -25 C9 -18 14 -3 0 6 Z','url(#leaf)',sw=1)+path('M0 4 L-3 -21',stroke='#b7cd8b',sw=.9)+path('M-3 -21 Q-10 -16 -10 -9',stroke='#bfd39b',sw=.6)+'</g>'
asset('ficus',112,160,[56,141],[1,1],plant,'Hand-shaped foliage, terracotta banded pot; contact shadow included.')

# Original character: Miro, a curly-haired developer with amber glasses and a pencil.
# Identical source rectangle and floor anchor across every pose.
def character(phase):
    typing=phase>0
    b=ellipse(40,103,22,5,'#243f35','opacity=".19"')
    b+=path('M30 83 L28 96 L21 98 Q18 101 22 103 L34 103 L38 86','#394b52',sw=1.5)
    b+=path('M43 85 L46 98 L42 100 Q40 104 45 105 L57 103 L53 84','#475c65',sw=1.5)
    b+=path('M21 101 L31 101 M45 103 L55 101',stroke='#e6d9b9',sw=1.4)
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
        b+=path('M25 63 Q17 67 24 79 L32 83 L37 77 L29 72','url(#cloth)',sw=1.5)
        b+=path('M32 76 Q36 73 40 77 L45 80 Q45 84 40 85 L33 82','url(#skin)',sw=1)
        b+=path('M51 63 Q58 65 56 76 L49 83 L44 78 L49 72','url(#cloth)',sw=1.5)
    else:
        dy= -2 if phase==1 else 2
        b+=path(f'M25 63 Q17 70 29 {77+dy} L43 {80+dy} L46 {74+dy} L31 70','url(#cloth)',sw=1.5)
        b+=path(f'M43 {74+dy} Q49 {72+dy} 54 {76+dy} L58 {79+dy} Q58 {83+dy} 52 {82+dy} L44 {80+dy}','url(#skin)',sw=1)
        b+=path(f'M51 63 Q58 64 61 {70-dy} L68 {73-dy} L65 {79-dy} L55 {76-dy}','url(#cloth)',sw=1.5)
        b+=path(f'M65 {73-dy} Q70 {71-dy} 75 {75-dy} L77 {79-dy} Q74 {82-dy} 68 {79-dy} L65 {78-dy}','url(#skin)',sw=1)
        b+=path(f'M52 {77+dy} l3 2 M71 {76-dy} l3 2',stroke='#b77a5d',sw=.7)
    return b
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
# Main vignette, enlarged 3x; floor first, walls, furnishings sorted manually.
contact+='<rect x="64" y="158" width="850" height="568" rx="24" fill="#243f36"/>'
scene=''
for j in range(5):
    for i in range(5):
        scene+=embed('floor_sage',180+(i-j)*32,105+(i+j)*16,1)
scene+=embed('wall_cutaway',100,36,1)
scene+=embed('ficus',229,22,1)
scene+=embed('chair_teal',107,78,1)
scene+=embed('miro_typing_01',123,88,1)
scene+=embed('desk_wood',116,92,1)
contact+=f'<g transform="translate(-35 20) scale(2.25)">{scene}</g>'
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
    col=idx%4; row=idx//4; xx=64+col*374; yy=758+row*235
    contact+=f'<rect x="{xx}" y="{yy}" width="350" height="216" rx="16" fill="#2c463b"/>'
    w,h=assets[name]['size']; sc=min(1.35,164/h,310/w)
    contact+=embed(name,xx+(350-w*sc)/2,yy+14,sc)
    contact+=text(xx+18,yy+191,name,16,'#f0e3c5',weight='bold')
    contact+=text(xx+270,yy+191,f'{w}×{h}',12,'#a9bda7')
contact+=text(66,1242,'Hand-authored SVG originals • Local librsvg / Cairo rasterization • No copied sprites • No online generation',14,'#9eb29d')
contact_svg=svg(1600,1260,contact)
(SRC/'contact_sheet.svg').write_text(contact_svg)
surf=raster(contact_svg,1600,1260); save(surf,OUT/'own_tycoon_contact_sheet.png'); free_surface(surf)
manifest={'id':'AO-TYCOON-01-own-tycoon-sample','title':'Walnut & Sage','createdUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'projection':{'type':'2:1 dimetric','tileSize':[64,32],'formula':'screenX=(gx-gy)*32; screenY=(gx+gy)*16-z'},'provenance':{'author':'Artist-2D / OpenAI gpt-6.1-sol','method':'Original hand-authored SVG geometry, Python art-export script, local system librsvg + Cairo; no external artwork or image generator.','model':'gpt-6.1-sol (SVG authoring, not image synthesis)','prompt':'AO-TYCOON-01: original cozy Game Dev Tycoon homage; sage 64x32 floor, cutaway wall, warm wooden desk with monitor and mug, chair, ficus, expressive chibi idle and two typing phases; unified 2:1 projection.','seed':None,'seedReason':'Deterministic hand-authored geometry; no stochastic generator.','referenceImageSha256':None,'referenceUse':'No reference image opened, traced, or copied. Textual art direction from milestone plan section 4 and user brief.','generatorScriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},'atlas':{'image':'own_tycoon_atlas.png','json':'own_tycoon_atlas.json','size':[1024,1024],'paddingPx':4,'betweenFramesPx':8,'rotated':False,'trimmed':False,'extruded':False,'samplingAdvice':'Linear or nearest at integer zoom; disable mipmaps for this sample with transparent gutters.','sha256':hashlib.sha256((OUT/'own_tycoon_atlas.png').read_bytes()).hexdigest()},'frames':manifest_frames,'animation':{'idle':{'frames':['miro_idle'],'fps':1},'typing':{'frames':['miro_typing_01','miro_typing_02'],'fps':6,'loop':True}},'anchorConvention':'footAnchorPx is absolute pixel position within untrimmed source rectangle; Pixi defaultAnchor=footAnchorPx/sourceSize. Floor uses center; furniture uses ground contact/sort point. Draw position equals ground anchor.','assemblyNotes':['Each prop has one orientation only; no runtime rotation variants in this sample.','Character is a seated pose; align ground anchors with chair (slight seat adjustment may be desired during integration).','Desk is a baked single sprite. Character hands/desk occlusion may require layer splitting in future integration; no canvas change made.','Contact sheet is an art-direction vignette, not proof of runtime placement or rendering.'],'review':{'visualAcceptance':'PENDING OWNER','canvasIntegration':'NOT PERFORMED','fpsContextLossMobile':'NOT TESTED'}}
(OUT/'own_tycoon_manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print('EXPORTED',len(assets),'original SVG frames + contact SVG; atlas 1024x1024; contact 1600x1260')
print(OUT)
