"""
African Game Hub - Pool Table generator
=======================================
Run:  python3 pool_table.py   -> writes pool-table-landscape.svg / pool-table-portrait.svg

HOW THE GAME SHOULD USE IT
- Use the SVG as the table background image. Balls and cue are NOT in this file - draw them on top in game code
  (recommended ball radius 14.5 table units).
- Coordinate system: the felt playing area is (0,0) to (1000,500) in landscape.
  The SVG viewBox starts at -66,-66 so the felt starts 66 units in from the image edge.
  Portrait = the same table rotated 90 degrees (felt is 500 wide x 1000 tall).
- To convert game pixels: scale = drawnFeltWidthPx / 1000 (landscape). Multiply EVERY
  value below by the same scale - balls, pockets, cushions. Never scale pockets alone.

GEOMETRY (edit these numbers to change the table)
- CU   cushion thickness;  OUT = cushion + wood rail
- CHR  corner pocket hole radius, centre at (-CO,-CO), (1000+CO,-CO), ... (cushion-back corner)
- SHR  side pocket hole radius, centre at (500,-SO) and (500,500+SO)
- CJ   corner cushion ends this far from the felt corner, then a 45-degree cut into the hole
- SJ   side cushion ends this far from the side pocket centre (back end at SJ-5)
PHYSICS: ball is potted when its centre is within the hole radius of a pocket centre.
Cushion collision lines = the cushion polygons drawn in cush() (nose line + angled jaw ends).
"""
import math
L,W=1000,500
CU=17           # cushion depth
OUT=57          # cushion + rail
CHR=32          # corner hole radius
CO=CU           # corner hole centre offset (at cushion-back intersection)
SHR=24          # side hole radius
SO=27           # side hole centre offset (tangent to nose line)
CJ=26           # corner jaw: cushion nose ends 33 from felt corner (45deg cut)
SJ=28           # side jaw: nose ends 27 from side pocket centre
VI,VO=CU+4,OUT-5
o=[];a=o.append

def rails():
    # (u,v)->(x,y) for each rail; u along rail, v outward from felt edge
    return {'T':lambda u,v:(u,-v),'B':lambda u,v:(u,W+v),'Lf':lambda u,v:(-v,u),'Rt':lambda u,v:(L+v,u)}

def band(f,us,ue,d=34):
    P=lambda u,v:"%.1f %.1f"%f(u,v)
    return (f"M{P(us,VI)} C{P(us+d*.95,VI)} {P(us+d*.05,VO)} {P(us+d,VO)} L{P(ue-d,VO)} "
            f"C{P(ue-d*.05,VO)} {P(ue-d*.95,VI)} {P(ue,VI)} Z")

def svg(portrait, view=None):
    o.clear()
    vb=view or ((-66,-66,L+132,W+132) if not portrait else (-66,-66,W+132,L+132))
    a(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{" ".join(map(str,vb))}" width="{vb[2]*2}" height="{vb[3]*2}">')
    a('<g transform="translate(500,0) rotate(90)">' if portrait else '<g>')
    corners=[(-CO,-CO),(L+CO,-CO),(-CO,W+CO),(L+CO,W+CO)]
    sides=[(L/2,-SO),(L/2,W+SO)]
    a('<defs>')
    a('''<radialGradient id="felt" cx="50%" cy="50%" r="60%"><stop offset="0" stop-color="#c4ad88"/><stop offset=".6" stop-color="#ab9471"/><stop offset="1" stop-color="#7f6b4e"/></radialGradient>
<linearGradient id="wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e7883a"/><stop offset=".45" stop-color="#cf6a22"/><stop offset="1" stop-color="#a24b14"/></linearGradient>
<filter id="noise" x="0" y="0" width="1" height="1"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="3"/><feColorMatrix values="0 0 0 0 .2 0 0 0 0 .14 0 0 0 0 .08 0 0 0 .12 0"/></filter>
<filter id="grain" x="0" y="0" width="1" height="1"><feTurbulence type="fractalNoise" baseFrequency=".004 .35" numOctaves="2" seed="9"/><feColorMatrix values="0 0 0 0 .35 0 0 0 0 .12 0 0 0 0 .02 0 0 0 .5 -.1"/></filter>
<filter id="drop" x="-5%" y="-8%" width="110%" height="120%"><feDropShadow dx="0" dy="6" stdDeviation="8" flood-opacity=".6"/></filter>
<filter id="blur4"><feGaussianBlur stdDeviation="4"/></filter>
<filter id="carve" x="-2%" y="-20%" width="104%" height="140%">
  <feMorphology in="SourceAlpha" operator="dilate" radius=".5" result="a"/>
  <feGaussianBlur in="a" stdDeviation="1" result="b"/>
  <feSpecularLighting in="b" surfaceScale="3" specularConstant="1.1" specularExponent="16" lighting-color="#ffd59a" result="s"><feDistantLight azimuth="225" elevation="40"/></feSpecularLighting>
  <feComposite in="s" in2="a" operator="in" result="s2"/>
  <feOffset in="a" dx="1" dy="1.4" result="sh"/><feFlood flood-color="#140600"/><feComposite in2="sh" operator="in" result="shadow"/>
  <feFlood flood-color="#b0743a"/><feComposite in2="a" operator="in" result="body"/>
  <feMerge><feMergeNode in="shadow"/><feMergeNode in="body"/><feMergeNode in="s2"/></feMerge>
</filter>
<pattern id="scrollH" width="58" height="27" patternUnits="userSpaceOnUse" y="0">
  <g fill="none" stroke="#000" stroke-width="2" stroke-linecap="round">
   <path d="M0 14 C7 3 18 3 23 10 C27 16 21 20 17 17 C14 14 17 10 20 12"/>
   <path d="M29 14 C36 25 47 25 52 18 C56 12 50 8 46 11 C43 14 46 18 49 16"/>
   <path d="M23 10 C26 14 28 14 29 14 M52 18 C55 16 57 14 58 14"/>
   <path d="M3 22 C10 25 16 24 22 20 M32 6 C39 3 45 4 51 8" stroke-width="1.4"/>
  </g>
  <g fill="#000"><path d="M8 18 q4 -3 8 2 q-5 3 -8 -2Z"/><path d="M37 9 q4 3 8 -2 q-5 -3 -8 2Z"/><circle cx="27" cy="4" r="1.5"/><circle cx="56" cy="24" r="1.5"/></g>
</pattern>
<pattern id="scrollV" href="#scrollH" patternTransform="rotate(90)"/>
<path id="arcT" d="M400 250a100 100 0 0 1 200 0"/>
<path id="arcB" d="M388 250a112 112 0 0 0 224 0"/>''')
    # per-pocket tube gradients: dark on the felt side, maroon wall on far side
    for i,(x,y) in enumerate(corners+sides):
        dx=500-x; dy=250-y; n=math.hypot(dx,dy); fx=50+28*dx/n; fy=50+28*dy/n
        a(f'<radialGradient id="h{i}" cx="{50-10*dx/n:.0f}%" cy="{50-10*dy/n:.0f}%" fx="{fx:.0f}%" fy="{fy:.0f}%" r="62%"><stop offset="0" stop-color="#000"/><stop offset=".5" stop-color="#030000"/><stop offset=".78" stop-color="#2c0905"/><stop offset=".93" stop-color="#5c1d0d"/><stop offset="1" stop-color="#72300f"/></radialGradient>')
    a(f'<clipPath id="play"><rect x="-{CU}" y="-{CU}" width="{L+2*CU}" height="{W+2*CU}"/></clipPath>')
    a(f'<clipPath id="wood"><path clip-rule="evenodd" d="M-{OUT} -{OUT}H{L+OUT}V{W+OUT}H-{OUT}Z M-{CU} -{CU}V{W+CU}H{L+CU}V-{CU}Z"/></clipPath>')
    a('</defs>')
    # frame (smooth orange wood everywhere = the pocket plates)
    a(f'<rect x="-{OUT}" y="-{OUT}" width="{L+2*OUT}" height="{W+2*OUT}" rx="40" fill="url(#wood)" filter="url(#drop)"/>')
    a(f'<rect x="-{OUT}" y="-{OUT}" width="{L+2*OUT}" height="{W+2*OUT}" rx="40" filter="url(#grain)" opacity=".5"/>')
    a(f'<rect x="-{OUT-1.5}" y="-{OUT-1.5}" width="{L+2*OUT-3}" height="{W+2*OUT-3}" rx="39" fill="none" stroke="#ffb067" stroke-opacity=".7" stroke-width="1.5"/>')
    # carved bands with ogee ends
    rs=rails(); paths=[]
    edge=CO+CHR+12  # band starts this far from felt corner at the cushion line
    for k in ('T','B'):
        paths.append((band(rs[k],edge-CO,L/2-SHR-14),'H'))
        paths.append((band(rs[k],L/2+SHR+14,L-edge+CO),'H'))
    for k in ('Lf','Rt'):
        paths.append((band(rs[k],edge-CO,W-edge+CO),'V'))
    for p,dirn in paths:
        a(f'<path d="{p}" fill="#3a1606"/>')
        a(f'<path d="{p}" fill="url(#scroll{dirn})" filter="url(#carve)" clip-path="url(#none)"/>' if False else '')
    # carvings clipped to each band
    for i,(p,dirn) in enumerate(paths):
        a(f'<clipPath id="bc{i}"><path d="{p}"/></clipPath>')
        a(f'<g clip-path="url(#bc{i})"><rect x="-80" y="-80" width="{L+160}" height="{W+160}" fill="url(#scroll{dirn})" filter="url(#carve)"/></g>')
        a(f'<path d="{p}" fill="none" stroke="#1c0802" stroke-width="2.2"/><path d="{p}" fill="none" stroke="#ffa955" stroke-width="1" stroke-opacity=".9" transform="translate(-.6 -.6)"/>')
    # inner wood lip line next to cushions
    a(f'<rect x="-{CU+1.5}" y="-{CU+1.5}" width="{L+2*CU+3}" height="{W+2*CU+3}" fill="none" stroke="#5a2508" stroke-width="2"/>')
    # diamonds
    mid=(VI+VO)/2
    def dmd(x,y):
        a(f'<circle cx="{x}" cy="{y}" r="5.2" fill="#2a0f03"/><circle cx="{x}" cy="{y}" r="4.3" fill="none" stroke="#e7b25a" stroke-width="1.3"/><circle cx="{x}" cy="{y}" r="2.4" fill="#fbf4e4"/>')
    for t in (125,250,375,625,750,875):
        for k in ('T','B'): dmd(*rs[k](t,mid))
    for t in (125,250,375):
        for k in ('Lf','Rt'): dmd(*rs[k](t,mid))
    # gold rings around pockets (on wood)
    a('<g clip-path="url(#wood)">')
    for x,y in corners: a(f'<circle cx="{x}" cy="{y}" r="{CHR+2}" fill="none" stroke="#6a2a0a" stroke-width="3"/><circle cx="{x}" cy="{y}" r="{CHR+3.6}" fill="none" stroke="#ffb35c" stroke-width="1"/>')
    for x,y in sides: a(f'<circle cx="{x}" cy="{y}" r="{SHR+2}" fill="none" stroke="#6a2a0a" stroke-width="3"/><circle cx="{x}" cy="{y}" r="{SHR+3.6}" fill="none" stroke="#ffb35c" stroke-width="1"/>')
    a('</g>')
    # felt + throat
    a(f'<rect x="-{CU}" y="-{CU}" width="{L+2*CU}" height="{W+2*CU}" fill="url(#felt)"/><rect x="-{CU}" y="-{CU}" width="{L+2*CU}" height="{W+2*CU}" filter="url(#noise)"/>')
    # cushions: (u0 nose start,u1 nose end, back start, back end) per rail
    def cush(f,n0,n1,b0,b1):
        pts=[f(n0,0),f(n1,0),f(b1,CU),f(b0,CU)]
        s=" ".join("%.1f,%.1f"%p for p in pts)
        cx_,cy_=f(0,-3)[0]-f(0,0)[0], f(0,-3)[1]-f(0,0)[1]
        a(f'<polygon points="{s}" fill="#000" opacity=".35" filter="url(#blur4)" transform="translate({cx_} {cy_})"/>')
        a(f'<polygon points="{s}" fill="#a69a7a" stroke="#6b5e45" stroke-width=".8"/>')
        # nose bevel strip
        q=[f(n0,0),f(n1,0),f(n1-2.5 if n1>n0 else n1+2.5,4),f(n0+2.5 if n1>n0 else n0-2.5,4)]
        a('<polygon points="%s" fill="#bcb091"/>'%" ".join("%.1f,%.1f"%p for p in q))
    sb=SJ-5  # side cushion back end is a little closer to the pocket
    for k in ('T','B'):
        cush(rs[k],CJ,L/2-SJ,CJ-CU,L/2-sb)
        cush(rs[k],L/2+SJ,L-CJ,L/2+sb,L-CJ+CU)
    for k in ('Lf','Rt'):
        cush(rs[k],CJ,W-CJ,CJ-CU,W-CJ+CU)
    # cushion shadow on felt
    # break line
    a(f'<line x1="250" y1="1" x2="250" y2="{W-1}" stroke="#efe3c8" stroke-opacity=".6" stroke-width="1.5"/>')
    # watermark logo
    ink='fill="#4a3216" fill-opacity=".2"'; st='stroke="#4a3216" stroke-opacity=".2"'
    cx,cy=500,250
    a(f'<g transform="rotate({-90 if portrait else 0} {cx} {cy})">')
    a(f'<circle cx="{cx}" cy="{cy}" r="80" fill="none" {st} stroke-width="5"/>')
    for i in range(28):
        t=2*math.pi*i/28; t1=t-math.pi/28*.9; t2=t+math.pi/28*.9
        p=[(cx+86*math.cos(t1),cy+86*math.sin(t1)),(cx+98*math.cos(t),cy+98*math.sin(t)),(cx+86*math.cos(t2),cy+86*math.sin(t2))]
        a('<polygon points="%s" %s/>'%(" ".join(f"{x:.1f},{y:.1f}" for x,y in p),ink))
    s=30
    a(f'<rect x="{cx-s-4}" y="{cy-s-4}" width="{2*s+8}" height="{2*s+8}" rx="6" fill="none" {st} stroke-width="4"/><rect x="{cx-s}" y="{cy-s}" width="{s}" height="{s}" {ink}/><rect x="{cx}" y="{cy}" width="{s}" height="{s}" {ink}/>')
    font='font-family="Arial Black, Arial, sans-serif" font-weight="900"'
    a(f'<text {font} font-size="21" letter-spacing="3" {ink}><textPath href="#arcT" startOffset="50%" text-anchor="middle">AFRICAN</textPath></text>')
    a(f'<text {font} font-size="21" letter-spacing="3" {ink} dy="16"><textPath href="#arcB" startOffset="50%" text-anchor="middle">GAME HUB</textPath></text></g>')
    # pocket holes
    for i,((x,y),r) in enumerate([(c,CHR) for c in corners]+[(c,SHR) for c in sides]):
        a(f'<circle cx="{x}" cy="{y}" r="{r}" fill="url(#h{i})"/>')
        a(f'<g clip-path="url(#play)"><circle cx="{x}" cy="{y}" r="{r}" fill="none" stroke="#d7c49e" stroke-width="1.6" stroke-opacity=".85"/></g>')
        a(f'<g clip-path="url(#wood)"><circle cx="{x}" cy="{y}" r="{r}" fill="none" stroke="#f0a050" stroke-width="1.4"/></g>')
    a('</g></svg>')
    return "\n".join(o)
open('pool-table-landscape.svg','w').write(svg(False))
open('pool-table-portrait.svg','w').write(svg(True))
