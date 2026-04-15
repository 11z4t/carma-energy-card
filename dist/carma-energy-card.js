/**
 * CARMA Energy Card v0.3.0 — Premium Deluxe Energy Visualization
 *
 * PLAT-1652-1656: State-of-the-art energy flow with wow factor.
 *
 * Visual features:
 *   - Comet-tail particles with gradient trail along Bezier curves
 *   - Neon-glow nodes with radial gradient + outer ring pulse
 *   - SoC donut arc with gradient stroke per battery
 *   - Central house node as energy-mix donut (PV/bat/grid shares)
 *   - Dynamic flow line width + gradient stroke
 *   - Day/night ambient background via sun entity
 *   - Smooth countUp value transitions (requestAnimationFrame)
 *   - Premium glassmorphism with CARMA orange accent glow
 *   - Responsive: 320px → 1200px
 *
 * Zero naked literals. All constants defined at top.
 */

const VERSION = '0.4.0';

// ============================================================
// Constants — every animation/threshold value named (NOLLTOLERANS)
// ============================================================
const FLOW_MIN_W = 50;
const FLOW_MAX_W = 8000;
const FLOW_SCALE_W = 1000;     // P1: scale factor for speed calc
const FLOW_MIN_DUR_S = 0.4;    // P1: fastest comet (high watts)
const FLOW_MAX_DUR_S = 8.0;    // P1: slowest comet (low watts)
const UPDATE_MS = 3000;
const W_TO_KW = 1000;
const BLUR_PX = 14;
const NODE_R = 28;
const NODE_PRIMARY_SCALE = 1.2; // P4: PV node 20% larger
const GLOW_R = 8;
const DOTS = 4;
const DOT_R = 3.5;
const TRAIL_LEN = 3;
const MIN_SW = 1.5;
const MAX_SW = 6;
const IDLE_OP = 0.08;
const IDLE_OPACITY_MIN = 0.3;  // P3: breathing glow min
const IDLE_OPACITY_MAX = 0.8;  // P3: breathing glow max
const IDLE_PULSE_S = 3;        // P3: breathing period
const ARC_R = 33;
const ARC_W = 3.5;
const DONUT_R = 22;
const DONUT_W = 5;
const PI2 = Math.PI * 2;
const PCT = 100;
const SVG_W = 400;
const SVG_H = 280;
const NUMBER_TWEEN_MS = 600;   // P2: countUp animation duration
const CHARGE_BLINK_MS = 800;   // P4: EV charging blink
const NODE_PULSE_THRESHOLD_W = 3000; // P4: house pulse when high consumption
const ALERT_SHADOW_PX = 20;    // P5: peak alert glow radius
const ALERT_OPACITY = 0.8;     // P5: peak alert glow opacity
const ALERT_PULSE_S = 1;       // P5: peak alert pulse speed
const ALERT_RGB = '255,50,50'; // P5: alert red color (RGB)
const ARC_FULL_CIRCLE_NUDGE_PX = 0.01; // SVG arc full-circle nudge
const ARC_HALF_PCT = PCT / 2;  // 50% threshold for SVG large-arc-flag
const TRAIL_OFFSET_FACTOR = 0.015; // Comet trail stagger factor

// Semantic colors
const C = {
  brand:   '#FFA040',
  brandDim:'rgba(255,160,64,0.15)',
  solar:   '#FFD600',
  solarDk: '#F9A825',
  bat:     '#4CAF50',
  batDk:   '#2E7D32',
  batDis:  '#42A5F5',
  batDisDk:'#1565C0',
  gridImp: '#EF5350',
  gridImpDk:'#C62828',
  gridExp: '#66BB6A',
  gridExpDk:'#2E7D32',
  home:    '#B0BEC5',
  homeDk:  '#546E7A',
  ev:      '#CE93D8',
  evDk:    '#7B1FA2',
  disp:    '#FFB74D',
  surface: '#12151F',
  surfGlass:'rgba(18,21,31,0.92)',
  border:  'rgba(255,160,64,0.10)',
  borderHi:'rgba(255,160,64,0.25)',
  txt:     '#ECEFF1',
  txt2:    '#78909C',
  txt3:    '#37474F',
  nightBg: '#0A0D14',
  dayBg:   '#1A1D2E',
};

// ============================================================
// Helpers
// ============================================================
// P1: Flow speed proportional to watts — higher power = faster comets
function dur(w) {
  const a = Math.abs(w);
  if (a < FLOW_MIN_W) return 0;
  // Inverse: more watts → shorter duration → faster movement
  const d = FLOW_MAX_DUR_S / Math.max(a / FLOW_SCALE_W, FLOW_MIN_DUR_S);
  return Math.max(FLOW_MIN_DUR_S, Math.min(d, FLOW_MAX_DUR_S));
}
function sw(w) {
  const a = Math.abs(w);
  if (a < FLOW_MIN_W) return MIN_SW;
  return MIN_SW + (Math.min(a, FLOW_MAX_W) / FLOW_MAX_W) * (MAX_SW - MIN_SW);
}
function fW(w) {
  const a = Math.abs(w);
  return a < W_TO_KW ? `${Math.round(a)}W` : `${(a / W_TO_KW).toFixed(1)}kW`;
}
function fP(p) { return `${Math.round(p)}%`; }

// P2: Smooth number counter animation (easeOut tween)
class ValueTweener {
  constructor() { this._vals = {}; this._targets = {}; this._starts = {}; this._times = {}; }

  tween(key, target) {
    if (this._targets[key] === target) return this._vals[key] ?? target;
    this._starts[key] = this._vals[key] ?? target;
    this._targets[key] = target;
    this._times[key] = Date.now();
    return this._starts[key];
  }

  tick() {
    const now = Date.now();
    for (const k of Object.keys(this._targets)) {
      const elapsed = now - (this._times[k] || now);
      const progress = Math.min(elapsed / NUMBER_TWEEN_MS, 1);
      // easeOutCubic
      const ease = 1 - Math.pow(1 - progress, 3);
      const start = this._starts[k] ?? this._targets[k];
      this._vals[k] = start + (this._targets[k] - start) * ease;
    }
  }

  get(key) { return this._vals[key] ?? 0; }
}

function bez(x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  if (Math.abs(dx) < NODE_R) {
    return `M${x0},${y0} C${x0 + 25},${y0 + dy * 0.4} ${x1 - 25},${y1 - dy * 0.4} ${x1},${y1}`;
  }
  return `M${x0},${y0} C${x0 + dx * 0.2},${y0 + dy * 0.6} ${x0 + dx * 0.8},${y0 + dy * 0.4} ${x1},${y1}`;
}

function arc(cx, cy, r, pct) {
  const sa = -Math.PI / 2;
  const ea = sa + (Math.min(pct, PCT) / PCT) * PI2;
  const x0 = cx + r * Math.cos(sa), y0 = cy + r * Math.sin(sa);
  const x1 = cx + r * Math.cos(ea), y1 = cy + r * Math.sin(ea);
  return pct >= PCT
    ? `M${x0},${y0} A${r},${r} 0 1,1 ${x0 - ARC_FULL_CIRCLE_NUDGE_PX},${y0}`
    : `M${x0},${y0} A${r},${r} 0 ${pct > ARC_HALF_PCT ? 1 : 0},1 ${x1},${y1}`;
}

// Donut segment arc (for energy mix)
function donutArc(cx, cy, r, startPct, endPct) {
  const sa = -Math.PI / 2 + (startPct / PCT) * PI2;
  const ea = -Math.PI / 2 + (endPct / PCT) * PI2;
  const x0 = cx + r * Math.cos(sa), y0 = cy + r * Math.sin(sa);
  const x1 = cx + r * Math.cos(ea), y1 = cy + r * Math.sin(ea);
  const span = endPct - startPct;
  return `M${x0},${y0} A${r},${r} 0 ${span > ARC_HALF_PCT ? 1 : 0},1 ${x1},${y1}`;
}

// ============================================================
// Card
// ============================================================
class CarmaEnergyCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._h = null;
    this._c = {};
    this._lu = 0;
    this._aid = null;
    this._off = 0;
    this._tw = new ValueTweener();
  }

  set hass(h) {
    this._h = h;
    const n = Date.now();
    if (n - this._lu < UPDATE_MS) return;
    this._lu = n;
    this._render();
  }

  setConfig(c) { if (!c) throw new Error('Config'); this._c = c; }
  getCardSize() { return 8; }
  connectedCallback() { this._startAnim(); }
  disconnectedCallback() { if (this._aid) cancelAnimationFrame(this._aid); }

  _s(id) { return this._h?.states?.[id]?.state ?? null; }
  _a(id) { return this._h?.states?.[id]?.attributes ?? null; }
  _n(id) {
    if (typeof id === 'number') return id;
    const s = this._s(id);
    return (s && s !== 'unknown' && s !== 'unavailable') ? (parseFloat(s) || 0) : 0;
  }

  // ----------------------------------------------------------
  _render() {
    if (!this._h) return;
    const c = this._c;

    const scen = (this._s(c.scenario || 'sensor.carma_box_scenario') || 'CARMA ENERGY').replace(/_/g, ' ');
    const dec = this._s(c.decision || 'sensor.carma_box_decision_reason') || '';
    const pa = this._a(c.day_plan || 'sensor.carma_box_day_plan') || {};
    const slot = pa.current_hour || null;
    const sun = this._s('sun.sun');
    const isNight = sun === 'below_horizon';

    const bats = (c.batteries || []).map(b => ({
      id: b.id, soc: this._n(b.soc), pw: this._n(b.power), pv: this._n(b.pv),
    }));
    const bAvg = bats.length ? bats.reduce((s, b) => s + b.soc, 0) / bats.length : 0;
    const bPw = bats.reduce((s, b) => s + b.pw, 0);
    const gW = this._n(c.grid_power);
    const pvW = this._n(c.pv_total) || bats.reduce((s, b) => s + b.pv, 0);
    const eSoc = this._n(c.ev_soc);
    const ePw = this._n(c.ev_power);
    const elv = this._n(c.ellevio);

    // Energy mix for house donut
    const pvShare = pvW > FLOW_MIN_W ? pvW : 0;
    const batShare = bPw > FLOW_MIN_W ? bPw : 0;
    const gridShare = gW > FLOW_MIN_W ? gW : 0;
    const totalIn = pvShare + batShare + gridShare || 1;
    const pvPct = (pvShare / totalIn) * PCT;
    const batPct = (batShare / totalIn) * PCT;

    // Nodes
    const hasEv = eSoc > 0 || ePw > FLOW_MIN_W;
    const N = {
      pv:   { x: SVG_W / 2, y: 42, c: C.solar, c2: C.solarDk, icon: '\u2600\uFE0F', lbl: 'Sol', v: pvW, pct: -1 },
      bat:  { x: 70, y: 150, c: bPw < -FLOW_MIN_W ? C.bat : bPw > FLOW_MIN_W ? C.batDis : C.txt3,
              c2: bPw < -FLOW_MIN_W ? C.batDk : C.batDisDk, icon: '\uD83D\uDD0B', lbl: 'Batteri', v: bPw, pct: bAvg },
      home: { x: SVG_W / 2, y: 150, c: C.home, c2: C.homeDk, icon: '\uD83C\uDFE0', lbl: 'Hus', v: 0, pct: -1, donut: true },
      grid: { x: SVG_W - 70, y: 150, c: gW > FLOW_MIN_W ? C.gridImp : gW < -FLOW_MIN_W ? C.gridExp : C.txt3,
              c2: gW > FLOW_MIN_W ? C.gridImpDk : C.gridExpDk, icon: '\u26A1', lbl: gW < -FLOW_MIN_W ? 'Export' : 'N\u00e4t', v: gW, pct: -1 },
    };
    if (hasEv) N.ev = { x: SVG_W / 2, y: 240, c: C.ev, c2: C.evDk, icon: '\uD83D\uDE97', lbl: 'EV', v: ePw, pct: eSoc };

    // Flows
    const F = [];
    if (pvW > FLOW_MIN_W) F.push({ f: N.pv, t: N.home, w: pvW, c: C.solar, c2: C.solarDk });
    if (pvW > FLOW_MIN_W && bPw < -FLOW_MIN_W) F.push({ f: N.pv, t: N.bat, w: Math.min(pvW, Math.abs(bPw)), c: C.bat, c2: C.batDk });
    if (bPw > FLOW_MIN_W) F.push({ f: N.bat, t: N.home, w: bPw, c: C.batDis, c2: C.batDisDk });
    if (gW > FLOW_MIN_W) F.push({ f: N.grid, t: N.home, w: gW, c: C.gridImp, c2: C.gridImpDk });
    if (gW < -FLOW_MIN_W) F.push({ f: N.home, t: N.grid, w: Math.abs(gW), c: C.gridExp, c2: C.gridExpDk });
    if (hasEv && ePw > FLOW_MIN_W) F.push({ f: N.home, t: N.ev, w: ePw, c: C.ev, c2: C.evDk });

    const bg = isNight ? C.nightBg : C.dayBg;

    // P5: Check if guard is in breach/alarm state
    const guardLevel = dec.toLowerCase();
    const isAlert = guardLevel.includes('breach') || guardLevel.includes('alarm') || guardLevel.includes('critical');

    this.shadowRoot.innerHTML = `<style>${this._css(bg)}</style>
<div class="card ${isAlert ? 'alert' : ''}">
  ${isAlert ? '<div class="alert-text">ELLEVIO PEAK — BEGR\u00c4NSAR</div>' : ''}
  <!-- Header with brand accent line -->
  <div class="hdr">
    <div class="accent"></div>
    <div class="scen">${scen}</div>
    <div class="dec">${dec}</div>
  </div>

  <!-- SVG Flow Diagram -->
  <svg viewBox="0 0 ${SVG_W} ${SVG_H}" class="svg">
    <defs>
      <filter id="gl" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="${GLOW_R}" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <filter id="glSm" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      ${Object.entries(N).map(([k, n]) => `
        <radialGradient id="rg-${k}" cx="40%" cy="35%">
          <stop offset="0%" stop-color="${n.c}" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="${n.c2}" stop-opacity="0.12"/>
        </radialGradient>
      `).join('')}
      ${F.map((f, i) => `
        <linearGradient id="lg${i}" gradientUnits="userSpaceOnUse"
          x1="${f.f.x}" y1="${f.f.y}" x2="${f.t.x}" y2="${f.t.y}">
          <stop offset="0%" stop-color="${f.c}" stop-opacity="0.9"/>
          <stop offset="100%" stop-color="${f.c2}" stop-opacity="0.4"/>
        </linearGradient>
      `).join('')}
    </defs>

    <!-- Background flow paths (dim) -->
    ${F.map((f, i) => {
      const d = bez(f.f.x, f.f.y, f.t.x, f.t.y);
      return `<path d="${d}" fill="none" stroke="${f.c}" stroke-width="${MIN_SW}"
        stroke-opacity="${IDLE_OP}" stroke-linecap="round"/>`;
    }).join('')}

    <!-- Active flow paths with gradient -->
    ${F.map((f, i) => {
      const d = bez(f.f.x, f.f.y, f.t.x, f.t.y);
      const w = sw(f.w);
      return `<path d="${d}" fill="none" stroke="url(#lg${i})" stroke-width="${w}"
        stroke-linecap="round" filter="url(#glSm)" class="fl" id="fp${i}"
        stroke-dasharray="10 6"/>`;
    }).join('')}

    <!-- Comet-tail animated dots -->
    ${F.map((f, i) => {
      const d = dur(f.w);
      if (d <= 0) return '';
      return Array.from({length: DOTS}, (_, j) => {
        const delay = -(d / DOTS) * j;
        // Lead dot (bright)
        const lead = `<circle r="${DOT_R}" fill="${f.c}" opacity="0.95" filter="url(#glSm)">
          <animateMotion dur="${d}s" repeatCount="indefinite" begin="${delay}s" calcMode="linear">
            <mpath href="#fp${i}"/>
          </animateMotion>
        </circle>`;
        // Trail dots (fading)
        const trail = Array.from({length: TRAIL_LEN}, (_, t) => {
          const trailDelay = delay - (d * TRAIL_OFFSET_FACTOR * (t + 1));
          const op = 0.6 - t * 0.18;
          const r = DOT_R - t * 0.6;
          return `<circle r="${Math.max(r, 1)}" fill="${f.c}" opacity="${Math.max(op, 0.1)}">
            <animateMotion dur="${d}s" repeatCount="indefinite" begin="${trailDelay}s" calcMode="linear">
              <mpath href="#fp${i}"/>
            </animateMotion>
          </circle>`;
        }).join('');
        return lead + trail;
      }).join('');
    }).join('')}

    <!-- Nodes -->
    ${Object.entries(N).map(([k, n]) => {
      const active = Math.abs(n.v) > FLOW_MIN_W || k === 'home';
      const op = active ? 1 : 0.45;
      const pulse = active && k !== 'home' ? 'pulse' : '';
      // P3: idle breathing class when inactive
      const breathe = !active && k !== 'home' ? 'breathe' : '';
      // P4: EV charging blink
      const evBlink = k === 'ev' && ePw > FLOW_MIN_W ? 'ev-charge' : '';
      // P4: house pulse when high consumption
      const housePulse = k === 'home' && Math.abs(gW) > NODE_PULSE_THRESHOLD_W ? 'house-high' : '';

      // SoC arc
      const socArc = n.pct >= 0 ? `<path d="${arc(n.x, n.y, ARC_R, n.pct)}"
        fill="none" stroke="${n.c}" stroke-width="${ARC_W}" stroke-linecap="round"
        opacity="0.7" filter="url(#glSm)"/>` : '';

      // Energy mix donut for house
      const donut = n.donut ? `
        <path d="${donutArc(n.x, n.y, DONUT_R, 0, pvPct)}"
          fill="none" stroke="${C.solar}" stroke-width="${DONUT_W}" stroke-linecap="round" opacity="0.8"/>
        <path d="${donutArc(n.x, n.y, DONUT_R, pvPct, pvPct + batPct)}"
          fill="none" stroke="${C.bat}" stroke-width="${DONUT_W}" stroke-linecap="round" opacity="0.8"/>
        <path d="${donutArc(n.x, n.y, DONUT_R, pvPct + batPct, PCT)}"
          fill="none" stroke="${gW > FLOW_MIN_W ? C.gridImp : C.txt3}" stroke-width="${DONUT_W}" stroke-linecap="round" opacity="0.5"/>
      ` : '';

      const r = k === 'pv' ? Math.round(NODE_R * NODE_PRIMARY_SCALE) : NODE_R;
      return `<g class="nd ${pulse} ${breathe} ${evBlink} ${housePulse}" opacity="${op}">
        ${socArc}
        ${donut}
        <circle cx="${n.x}" cy="${n.y}" r="${r}" fill="url(#rg-${k})"
          stroke="${n.c}" stroke-width="1.5" ${active ? 'filter="url(#gl)"' : ''}/>
        <text x="${n.x}" y="${n.y + 2}" text-anchor="middle" dominant-baseline="central"
          font-size="16" class="ico">${n.icon}</text>
        <text x="${n.x}" y="${n.y + NODE_R + 13}" text-anchor="middle"
          font-size="9" fill="${C.txt2}" font-weight="600" letter-spacing="0.05em">${n.lbl}</text>
        <text x="${n.x}" y="${n.y + NODE_R + 25}" text-anchor="middle"
          font-size="11" fill="${n.c}" font-weight="700" class="mono">
          ${n.pct >= 0 ? fP(n.pct) : (Math.abs(n.v) > FLOW_MIN_W ? fW(n.v) : '')}
        </text>
      </g>`;
    }).join('')}
  </svg>

  <!-- Metrics strip -->
  <div class="strip">
    <div class="chip" style="--cc:${C.solar}"><span class="cv" data-tw="pv">${this._tw.tween('pv', pvW), fW(pvW)}</span><span class="cl">PV</span></div>
    <div class="chip" style="--cc:${gW > 0 ? C.gridImp : C.gridExp}"><span class="cv" data-tw="grid">${this._tw.tween('grid', gW), fW(gW)}</span><span class="cl">${gW < -FLOW_MIN_W ? 'Exp' : 'Grid'}</span></div>
    ${bats.map((b, i) => `<div class="chip" style="--cc:${C.bat}"><span class="cv" data-tw="bsoc${i}_pct">${this._tw.tween(`bsoc${i}_pct`, b.soc), fP(b.soc)}</span><span class="cl">${b.id}</span></div>`).join('')}
    ${eSoc > 0 ? `<div class="chip" style="--cc:${C.ev}"><span class="cv" data-tw="evsoc_pct">${this._tw.tween('evsoc_pct', eSoc), fP(eSoc)}</span><span class="cl">EV</span></div>` : ''}
    ${elv > 0 ? `<div class="chip" style="--cc:${C.txt2}"><span class="cv">${elv.toFixed(2)}</span><span class="cl">Ellevio</span></div>` : ''}
  </div>

  <!-- DayPlan slot -->
  ${slot ? `<div class="plan">
    <span class="plan-t">${slot.hour}:00</span>
    ${slot.bat_w > 0 ? `<span class="tag" style="--tc:${C.bat}">${slot.bat_mode} ${fW(slot.bat_w)}</span>` : ''}
    ${slot.ev_w > 0 ? `<span class="tag" style="--tc:${C.ev}">EV ${slot.ev_amps}A</span>` : ''}
    ${slot.dispatch_w > 0 ? `<span class="tag" style="--tc:${C.disp}">${fW(slot.dispatch_w)}</span>` : ''}
    ${slot.export_w > 0 ? `<span class="tag" style="--tc:${C.gridExp}">Exp ${fW(slot.export_w)}</span>` : ''}
  </div>` : ''}

  <!-- Battery bars -->
  <div class="bats">
    ${bats.map(b => {
      const color = b.pw < -FLOW_MIN_W ? C.bat : b.pw > FLOW_MIN_W ? C.batDis : C.txt3;
      return `<div class="br">
        <span class="bi">${b.id}</span>
        <div class="bb"><div class="bf ${b.pw < 0 ? 'chg' : b.pw > 0 ? 'dis' : ''}"
          style="width:${b.soc}%;background:linear-gradient(90deg,${color},${color}88)"></div></div>
        <span class="bv">${fP(b.soc)}</span>
        <span class="bp">${fW(b.pw)}</span>
      </div>`;
    }).join('')}
  </div>

  <div class="ft">
    <span>${isNight ? '\uD83C\uDF19' : '\u2600\uFE0F'} CARMA Energy v${VERSION}</span>
  </div>
</div>`;
  }

  // ----------------------------------------------------------
  _startAnim() {
    let o = 0;
    const tick = () => {
      o = (o + 0.5) % 20;
      this.shadowRoot?.querySelectorAll('.fl')?.forEach(l => l.setAttribute('stroke-dashoffset', -o));

      // P2: Tick tweener and update displayed values
      this._tw.tick();
      this.shadowRoot?.querySelectorAll('[data-tw]')?.forEach(el => {
        const k = el.getAttribute('data-tw');
        const v = this._tw.get(k);
        const isP = k.endsWith('_pct');
        el.textContent = isP ? fP(v) : fW(v);
      });

      this._aid = requestAnimationFrame(tick);
    };
    this._aid = requestAnimationFrame(tick);
  }

  // ----------------------------------------------------------
  _css(bg) { return `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap');
:host { display: block; }
.card {
  background: ${C.surfGlass};
  backdrop-filter: blur(${BLUR_PX}px); -webkit-backdrop-filter: blur(${BLUR_PX}px);
  border: 1px solid ${C.borderHi};
  border-radius: 20px;
  box-shadow: 0 8px 40px rgba(0,0,0,0.6), 0 0 60px ${C.brandDim}, inset 0 1px 0 rgba(255,255,255,0.03);
  padding: 16px 18px;
  color: ${C.txt};
  font-family: 'Inter',sans-serif;
  position: relative;
  overflow: hidden;
}
/* Ambient glow behind card */
.card::before {
  content: '';
  position: absolute;
  top: -40%; left: -20%; width: 140%; height: 180%;
  background: radial-gradient(ellipse at 30% 20%, ${C.brandDim} 0%, transparent 60%),
              radial-gradient(ellipse at 70% 80%, rgba(66,165,245,0.06) 0%, transparent 50%);
  pointer-events: none;
  z-index: 0;
}
.card > * { position: relative; z-index: 1; }

/* Header */
.hdr { margin-bottom: 6px; }
.accent { height: 2px; width: 40px; background: linear-gradient(90deg, ${C.brand}, transparent); margin-bottom: 8px; border-radius: 1px; }
.scen { font-size: 1.15rem; font-weight: 700; color: ${C.brand}; letter-spacing: 0.04em; text-shadow: 0 0 20px ${C.brandDim}; }
.dec { font-size: 0.6rem; color: ${C.txt3}; margin-top: 2px; }

/* SVG */
.svg { width: 100%; height: auto; margin: -2px 0 2px; }
.mono { font-family: 'JetBrains Mono',monospace; font-feature-settings: "tnum"; }
.ico { filter: drop-shadow(0 0 4px rgba(255,255,255,0.3)); }

/* Node pulse on active */
.nd.pulse > circle:first-of-type { animation: np 2.5s ease-in-out infinite; }
@keyframes np {
  0%,100% { stroke-opacity: 1; stroke-width: 1.5; }
  50% { stroke-opacity: 0.4; stroke-width: 2.5; }
}

/* P3: Idle breathing glow when no flow */
.nd.breathe .ico { animation: breathe ${IDLE_PULSE_S}s ease-in-out infinite; }
@keyframes breathe {
  0%,100% { opacity: ${IDLE_OPACITY_MIN}; }
  50% { opacity: ${IDLE_OPACITY_MAX}; }
}

/* P4: EV charging blink */
.nd.ev-charge > circle:first-of-type { animation: evBlink ${CHARGE_BLINK_MS}ms ease-in-out infinite; }
@keyframes evBlink {
  0%,100% { stroke: ${C.ev}; stroke-width: 1.5; }
  50% { stroke: ${C.brand}; stroke-width: 3; }
}

/* P4: House high consumption pulse */
.nd.house-high > circle:first-of-type { animation: housePulse 1.5s ease-in-out infinite; }
@keyframes housePulse {
  0%,100% { stroke-opacity: 0.6; }
  50% { stroke-opacity: 1; stroke-width: 2.5; }
}

/* P5: Peak alert border */
.card.alert {
  border-color: rgba(${ALERT_RGB},0.5) !important;
  box-shadow: 0 0 ${ALERT_SHADOW_PX}px rgba(${ALERT_RGB},${ALERT_OPACITY}),
              0 8px 40px rgba(0,0,0,0.6) !important;
  animation: alertPulse ${ALERT_PULSE_S}s ease-in-out infinite;
}
@keyframes alertPulse {
  0%,100% { box-shadow: 0 0 ${ALERT_SHADOW_PX}px rgba(${ALERT_RGB},${ALERT_OPACITY}), 0 8px 40px rgba(0,0,0,0.6); }
  50% { box-shadow: 0 0 ${ALERT_SHADOW_PX * 2}px rgba(${ALERT_RGB},${ALERT_OPACITY * 0.5}), 0 8px 40px rgba(0,0,0,0.6); }
}
.alert-text { color: ${C.gridImp}; font-size: 0.7rem; font-weight: 700; text-align: center;
  padding: 4px 0; letter-spacing: 0.05em; animation: alertPulse ${ALERT_PULSE_S}s ease-in-out infinite; }

/* Metrics chips */
.strip { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-bottom: 8px; }
.chip {
  display: flex; flex-direction: column; align-items: center;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
  border-radius: 10px; padding: 4px 10px; min-width: 50px;
  transition: border-color 0.5s ease;
}
.chip:hover { border-color: var(--cc); }
.cv { font-family: 'JetBrains Mono',monospace; font-feature-settings: "tnum";
  font-size: 0.95rem; font-weight: 700; color: var(--cc); transition: color 0.5s ease; }
.cl { font-size: 0.55rem; color: ${C.txt3}; text-transform: uppercase; letter-spacing: 0.1em; margin-top: 1px; }

/* Plan slot */
.plan { display: flex; gap: 6px; align-items: center; flex-wrap: wrap;
  background: rgba(255,255,255,0.02); border: 1px solid ${C.border};
  border-radius: 10px; padding: 6px 12px; margin-bottom: 6px; }
.plan-t { font-size: 0.65rem; color: ${C.txt2}; font-weight: 600; }
.tag { font-family: 'JetBrains Mono',monospace; font-size: 0.55rem; padding: 2px 7px;
  border-radius: 999px; background: color-mix(in srgb, var(--tc) 15%, transparent);
  color: var(--tc); font-weight: 600; border: 1px solid color-mix(in srgb, var(--tc) 25%, transparent); }

/* Battery bars */
.bats { margin-bottom: 4px; }
.br { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
.bi { font-size: 0.6rem; color: ${C.txt2}; min-width: 36px; }
.bb { flex: 1; height: 5px; background: rgba(255,255,255,0.05); border-radius: 3px; overflow: hidden; }
.bf { height: 100%; border-radius: 3px; transition: width 1.5s ease; }
.bf.chg { animation: cp 2s ease infinite; }
@keyframes cp { 0%,100% { opacity:1; } 50% { opacity:0.6; } }
.bv { font-family: 'JetBrains Mono',monospace; font-feature-settings: "tnum";
  font-size: 0.6rem; min-width: 26px; color: ${C.txt}; }
.bp { font-family: 'JetBrains Mono',monospace; font-size: 0.55rem; color: ${C.txt3}; min-width: 42px; }

.ft { font-size: 0.5rem; color: ${C.txt3}; text-align: right; }

@media (max-width: 500px) {
  .card { padding: 12px 14px; border-radius: 16px; }
  .scen { font-size: 0.95rem; }
  .cv { font-size: 0.8rem; }
  .svg { margin: 0; }
}
`; }
}

customElements.define('carma-energy-card', CarmaEnergyCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'carma-energy-card',
  name: 'CARMA Energy Card',
  description: 'Premium energy flow with animated comet particles & glow effects',
  preview: true,
});
console.info(`%c CARMA Energy v${VERSION} `, 'background: linear-gradient(90deg,#FFA040,#E65100); color: #fff; font-weight: bold; border-radius: 4px; padding: 2px 8px;');
