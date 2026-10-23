#!/usr/bin/env python3
"""Standalone asset checks: PNG CRC/decode, alpha, atlas bounds, sources, anchors."""
from pathlib import Path
import struct
import zlib
import json
import hashlib
import xml.etree.ElementTree as ET
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'web/public/assets/sample'

def decode(path):
    data=path.read_bytes()
    assert data[:8]==b'\x89PNG\r\n\x1a\n'
    off=8; compressed=b''; w=h=color=0
    while off<len(data):
        n=struct.unpack('>I',data[off:off+4])[0]
        typ=data[off+4:off+8]; block=data[off+8:off+8+n]
        assert zlib.crc32(typ+block)&0xffffffff==struct.unpack('>I',data[off+8+n:off+12+n])[0], 'CRC'
        if typ==b'IHDR':
            w,h,depth,color,comp,filt,inter=struct.unpack('>IIBBBBB',block)
            assert depth==8 and color in (2,6) and inter==0
        if typ==b'IDAT': compressed+=block
        off+=n+12
        if typ==b'IEND': break
    raw=zlib.decompress(compressed); bpp=4 if color==6 else 3
    stride=w*bpp; prev=bytearray(stride); rows=[]; p=0
    for _ in range(h):
        f=raw[p]; p+=1; row=bytearray(raw[p:p+stride]); p+=stride
        for i in range(stride):
            a=row[i-bpp] if i>=bpp else 0; b=prev[i]; c=prev[i-bpp] if i>=bpp else 0
            if f==1: v=a
            elif f==2: v=b
            elif f==3: v=(a+b)//2
            elif f==4:
                q=a+b-c; da,db,dc=abs(q-a),abs(q-b),abs(q-c)
                v=a if da<=db and da<=dc else b if db<=dc else c
            else:
                assert f==0; v=0
            row[i]=(row[i]+v)&255
        rows.append(row); prev=row
    assert p==len(raw)
    return w,h,bpp,rows

sheet=json.loads((OUT/'own_tycoon_atlas.json').read_text())
manifest=json.loads((OUT/'own_tycoon_manifest.json').read_text())
w,h,bpp,rows=decode(OUT/'own_tycoon_atlas.png')
assert (w,h,bpp)==(1024,1024,4)
assert w&(w-1)==0 and h&(h-1)==0
expected={'floor_sage','wall_cutaway','desk_wood','desk_front','chair_teal','ficus','miro_idle','miro_typing_01','miro_typing_02'}
assert set(sheet['frames'])==set(manifest['frames'])==expected
rects=[]; digests={}; checks={}
for name,frame in sheet['frames'].items():
    f=frame['frame']; x,y,fw,fh=[f[k] for k in ('x','y','w','h')]
    assert 0<=x<x+fw<=w and 0<=y<y+fh<=h
    assert not frame['rotated'] and not frame['trimmed']
    assert frame['sourceSize']=={'w':fw,'h':fh}
    for ox,oy,ow,oh in rects:
        assert x+fw<=ox or ox+ow<=x or y+fh<=oy or oy+oh<=y,'overlap'
    rects.append((x,y,fw,fh))
    m=manifest['frames'][name]; src=ROOT/m['source']; xml=ET.parse(src).getroot()
    assert list(map(int,[xml.attrib['width'],xml.attrib['height']]))==[fw,fh]
    assert hashlib.sha256(src.read_bytes()).hexdigest()==m['sha256']
    ax,ay=m['footAnchorPx']
    assert 0<=ax<=fw and 0<=ay<=fh
    assert frame['anchor']=={'x':ax/fw,'y':ay/fh}
    pixels=b''.join(row[x*4:(x+fw)*4] for row in rows[y:y+fh])
    digests[name]=hashlib.sha256(pixels).hexdigest()
    occupied=[(i%fw,i//fw) for i,a in enumerate(pixels[3::4]) if a]
    assert occupied
    bbox=[min(v[0] for v in occupied),min(v[1] for v in occupied),max(v[0] for v in occupied)+1,max(v[1] for v in occupied)+1]
    if name!='floor_sage': assert bbox[0]>0 and bbox[1]>0 and bbox[2]<fw and bbox[3]<fh,'source clipping'
    checks[name]={'frame':f,'alphaBounds':bbox,'footAnchorPx':[ax,ay]}
assert len(set(digests.values()))==len(expected)
assert manifest['frames']['floor_sage']['size']==[64,32]
for animation,names in sheet['animations'].items():
    assert all(n in expected for n in names)
    if animation=='miro_typing': assert len(names)==2
assert len({tuple(manifest['frames'][n]['footAnchorPx']) for n in expected if n.startswith('miro_')})==1
alpha=[a for row in rows for a in row[3::4]]
assert min(alpha)==0 and max(alpha)==255 and any(0<a<255 for a in alpha)
assert manifest['atlas']['sha256']==hashlib.sha256((OUT/'own_tycoon_atlas.png').read_bytes()).hexdigest()
cw,ch,_,_=decode(OUT/'own_tycoon_contact_sheet.png')
assert (cw,ch)==(1600,1260)
ET.parse(ROOT/'assets_src/vector/own_tycoon_sample/contact_sheet.svg')
result={'status':'PASS','frames':len(expected),'svgSources':9,'atlas':[w,h],'contactSheet':[cw,ch],'checks':['PNG signature + CRC + zlib scanline decode','RGBA transparency and antialiasing','POT 1024x1024','exact frame names','bounds + non-overlap','nonempty alpha bounds + no source clipping (floor edge exception)','SVG XML + dimensions + SHA256','foot anchors + fixed animation registration','different pixel content in all 8 frames','animation references','atlas provenance checksum'],'frameDetails':checks,'runtimePixiParse':'NOT RUN: JS runtime absent; structural Pixi spritesheet fields checked','visualAcceptance':'PENDING OWNER'}
result['svgSources']=len(expected)+1
result['checks']=[s.replace('all 8 frames',f'all {len(expected)} frames') for s in result['checks']]
result['runtimePixiParse']='NOT RUN here: standalone raster/source validator; Bun integration/geometry suites run separately. WebGL gate pending.'
(OUT/'own_tycoon_validation.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
