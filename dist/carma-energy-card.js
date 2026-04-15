/**
 * CARMA Energy Card v0.2.0 — Premium Energy Visualization
 *
 * PLAT-1652-1656: State-of-the-art energy flow visualization.
 *
 * Features:
 *   - Animated particle dots flowing along curved Bezier SVG paths
 *   - Glowing nodes with radial gradient fills + pulsing on active
 *   - Dynamic line width proportional to power (watts)
 *   - SoC arc rings around battery nodes
 *   - Premium dark glassmorphism card with CARMA orange branding
 *   - DayPlan current-hour allocation display
 *   - Smooth CSS transitions on value changes
 *   - Responsive: mobile → desktop
 *
 * Architecture: Vanilla JS + Shadow DOM, requestAnimationFrame animation.
 * All visual constants defined at top — zero naked literals.
 */

const VERSION = '0.2.0';

// ============================================================
// Constants
// ============================================================
const FLOW_MIN_W = 50;
const FLOW_MAX_W = 8000;
const FLOW_SLOW_S = 4.0;      // Animation duration at min watts
const FLOW_FAST_S = 0.6;      // Animation duration at max watts
const UPDATE_THROTTLE_MS = 3000;
const W_TO_KW = 1000;
const GLASS_BLUR_PX = 12;
const NODE_R = 30;             // Node circle radius
const DOTS_PER_PATH = 3;      // Animated dots per flow path
const MIN_STROKE_W = 1.5;     // Minimum flow line width
const MAX_STROKE_W = 5;       // Maximum flow line width
const IDLE_OPACITY = 0.12;    // Dimmed idle paths
const GLOW_BLUR = 6;          // SVG filter blur radius
const SOC_ARC_R = 34;         // SoC arc ring radius (outside node)
const SOC_ARC_W = 3;          // SoC arc stroke width
const TWO_PI = Math.PI * 2;
const PCT_FULL = 100;
const ANIM_STEP = 0.008;      // Animation position increment per frame

// Colors
const C = {
  primary:   '#FFA040',
  solar:     '#FFD600',
  battery:   '#4CAF50',
  batDis:    '#2196F3',
  gridImp:   '#EF5350',
  gridExp:   '#66BB6A',
  home:      '#90CAF9',
  ev:        '#B388FF',
  dispatch:  '#FF9800',
  surface:   '#1A1D2E',
  border:    '#2D3149',
  text:      '#F1F5F9',
  textDim:   '#94A3B8',
  textMuted: '#475569',
};

// ============================================================
// Helpers
// ============================================================
function flowDur(w) {
  const a = Math.abs(w);
  if (a < FLOW_MIN_W) return 0;
  const r = Math.min(a, FLOW_MAX_W) / FLOW_MAX_W;
  return FLOW_SLOW_S - r * (FLOW_SLOW_S - FLOW_FAST_S);
}

function strokeW(w) {
  const a = Math.abs(w);
  if (a < FLOW_MIN_W) return MIN_STROKE_W;
  const r = Math.min(a, FLOW_MAX_W) / FLOW_MAX_W;
  return MIN_STROKE_W + r * (MAX_STROKE_W - MIN_STROKE_W);
}

function fmtW(w) {
  const a = Math.abs(w);
  return a < W_TO_KW ? `${Math.round(a)} W` : `${(a / W_TO_KW).toFixed(1)} kW`;
}

function fmtP(p) { return `${Math.round(p)}%`; }

function bezier(x0, y0, x1, y1) {
  // Curved Bezier path between two points
  const dx = x1 - x0, dy = y1 - y0;
  if (Math.abs(dx) < NODE_R) {
    // Vertical: slight curve
    const mx = x0 + dx * 0.5 + 20;
    return `M${x0},${y0} Q${mx},${(y0 + y1) / 2} ${x1},${y1}`;
  }
  const cp1x = x0 + dx * 0.15, cp1y = y0 + dy * 0.5;
  const cp2x = x0 + dx * 0.85, cp2y = y0 + dy * 0.5;
  return `M${x0},${y0} C${cp1x},${cp1y} ${cp2x},${cp2y} ${x1},${y1}`;
}

function socArc(cx, cy, r, pct) {
  // SVG arc for SoC percentage (0-100)
  const a = (pct / PCT_FULL) * TWO_PI - Math.PI / 2;
  const startA = -Math.PI / 2;
  const x0 = cx + r * Math.cos(startA), y0 = cy + r * Math.sin(startA);
  const x1 = cx + r * Math.cos(a), y1 = cy + r * Math.sin(a);
  const large = pct > 50 ? 1 : 0;
  return pct >= PCT_FULL
    ? `M${x0},${y0} A${r},${r} 0 1,1 ${x0 - 0.01},${y0}`
    : `M${x0},${y0} A${r},${r} 0 ${large},1 ${x1},${y1}`;
}

// ============================================================
// Card
// ============================================================
class CarmaEnergyCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass = null;
    this._config = {};
    this._lastUp = 0;
    this._dots = [];       // Animated dot positions (0..1)
    this._animId = null;
    this._flows = [];      // Current flow definitions
  }

  set hass(h) {
    this._hass = h;
    const now = Date.now();
    if (now - this._lastUp < UPDATE_THROTTLE_MS) return;
    this._lastUp = now;
    this._update();
  }

  setConfig(c) {
    if (!c) throw new Error('Config required');
    this._config = c;
  }

  getCardSize() { return 7; }

  connectedCallback() { this._startAnim(); }
  disconnectedCallback() { if (this._animId) cancelAnimationFrame(this._animId); }

  _s(id) { return this._hass?.states?.[id]?.state ?? null; }
  _a(id) { return this._hass?.states?.[id]?.attributes ?? null; }
  _n(id) {
    if (typeof id === 'number') return id;
    const s = this._s(id);
    return (s && s !== 'unknown' && s !== 'unavailable') ? (parseFloat(s) || 0) : 0;
  }

  // ----------------------------------------------------------
  // Update data + render
  // ----------------------------------------------------------
  _update() {
    if (!this._hass) return;
    const c = this._config;

    const scenario = this._s(c.scenario || 'sensor.carma_box_scenario') || '';
    const decision = this._s(c.decision || 'sensor.carma_box_decision_reason') || '';
    const planAttrs = this._a(c.day_plan || 'sensor.carma_box_day_plan') || {};
    const currentSlot = planAttrs.current_hour || null;

    const bats = (c.batteries || []).map(b => ({
      id: b.id, soc: this._n(b.soc), power: this._n(b.power), pv: this._n(b.pv),
    }));
    const batAvg = bats.length ? bats.reduce((s, b) => s + b.soc, 0) / bats.length : 0;
    const batPw = bats.reduce((s, b) => s + b.power, 0);
    const gridW = this._n(c.grid_power);
    const pvW = this._n(c.pv_total) || bats.reduce((s, b) => s + b.pv, 0);
    const evSoc = this._n(c.ev_soc);
    const evPw = this._n(c.ev_power);
    const ellevio = this._n(c.ellevio);

    // Node positions
    const W = 380, H = 260;
    const nodes = [
      { id: 'pv',   x: W/2,  y: 40,   icon: '\u2600', label: 'Sol',     val: pvW,  color: C.solar,  pct: -1 },
      { id: 'bat',  x: 65,   y: 140,  icon: '\uD83D\uDD0B', label: 'Batteri', val: batPw, color: batPw < -FLOW_MIN_W ? C.battery : batPw > FLOW_MIN_W ? C.batDis : C.border, pct: batAvg },
      { id: 'home', x: W/2,  y: 140,  icon: '\uD83C\uDFE0', label: 'Hus',     val: 0, color: C.home, pct: -1 },
      { id: 'grid', x: W-65, y: 140,  icon: '\u26A1', label: gridW < -FLOW_MIN_W ? 'Export' : 'Nät', val: gridW, color: gridW > FLOW_MIN_W ? C.gridImp : gridW < -FLOW_MIN_W ? C.gridExp : C.border, pct: -1 },
    ];
    if (evSoc > 0 || evPw > FLOW_MIN_W) {
      nodes.push({ id: 'ev', x: W/2, y: 230, icon: '\uD83D\uDE97', label: 'EV', val: evPw, color: C.ev, pct: evSoc });
    }

    // Flow paths
    const flows = [];
    if (pvW > FLOW_MIN_W && batPw < -FLOW_MIN_W)
      flows.push({ from: nodes[0], to: nodes[1], w: Math.min(pvW, Math.abs(batPw)), c: C.solar });
    if (pvW > FLOW_MIN_W)
      flows.push({ from: nodes[0], to: nodes[2], w: pvW, c: C.solar });
    if (batPw > FLOW_MIN_W)
      flows.push({ from: nodes[1], to: nodes[2], w: batPw, c: C.batDis });
    if (gridW > FLOW_MIN_W)
      flows.push({ from: nodes[3], to: nodes[2], w: gridW, c: C.gridImp });
    if (gridW < -FLOW_MIN_W)
      flows.push({ from: nodes[2], to: nodes[3], w: Math.abs(gridW), c: C.gridExp });
    const evNode = nodes.find(n => n.id === 'ev');
    if (evNode && evPw > FLOW_MIN_W)
      flows.push({ from: nodes[2], to: evNode, w: evPw, c: C.ev });

    this._flows = flows;

    // Init dots if needed
    while (this._dots.length < flows.length * DOTS_PER_PATH) {
      this._dots.push(Math.random());
    }

    // Render
    this.shadowRoot.innerHTML = `<style>${this._css()}</style>
<div class="card">
  <div class="header">
    <div class="brand">${scenario.replace(/_/g, ' ') || 'CARMA ENERGY'}</div>
    <div class="sub">${decision}</div>
  </div>

  <svg viewBox="0 0 ${W} ${H + 20}" class="flow">
    <defs>
      <filter id="glow"><feGaussianBlur stdDeviation="${GLOW_BLUR}" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      ${flows.map((f, i) => `
        <linearGradient id="fg${i}" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="${f.c}" stop-opacity="0.8"/>
          <stop offset="100%" stop-color="${f.c}" stop-opacity="0.3"/>
        </linearGradient>
      `).join('')}
    </defs>

    <!-- Flow lines (background) -->
    ${flows.map((f, i) => {
      const d = bezier(f.from.x, f.from.y, f.to.x, f.to.y);
      const sw = strokeW(f.w);
      return `<path d="${d}" fill="none" stroke="${f.c}" stroke-width="${sw}"
        stroke-opacity="${IDLE_OPACITY}" stroke-linecap="round" class="bg-path"/>
        <path d="${d}" fill="none" stroke="url(#fg${i})" stroke-width="${sw}"
          stroke-linecap="round" filter="url(#glow)" class="flow-line"
          stroke-dasharray="8 6" id="fp${i}"/>`;
    }).join('')}

    <!-- Animated dots -->
    ${flows.map((f, i) => {
      const d = bezier(f.from.x, f.from.y, f.to.x, f.to.y);
      const dur = flowDur(f.w);
      if (dur <= 0) return '';
      return Array.from({length: DOTS_PER_PATH}, (_, j) => {
        const delay = -(dur / DOTS_PER_PATH) * j;
        return `<circle r="3" fill="${f.c}" filter="url(#glow)" class="dot">
          <animateMotion dur="${dur}s" repeatCount="indefinite" begin="${delay}s">
            <mpath href="#fp${i}"/>
          </animateMotion>
        </circle>`;
      }).join('');
    }).join('')}

    <!-- Nodes -->
    ${nodes.map(n => {
      const active = Math.abs(n.val) > FLOW_MIN_W || n.id === 'home';
      const opacity = active ? 1 : 0.5;
      const pulseClass = active && n.id !== 'home' ? 'pulse' : '';
      return `
        <g class="node ${pulseClass}" opacity="${opacity}">
          ${n.pct >= 0 ? `<path d="${socArc(n.x, n.y, SOC_ARC_R, n.pct)}"
            fill="none" stroke="${n.color}" stroke-width="${SOC_ARC_W}"
            stroke-linecap="round" opacity="0.6"/>` : ''}
          <circle cx="${n.x}" cy="${n.y}" r="${NODE_R}"
            fill="${C.surface}" stroke="${n.color}" stroke-width="2"
            filter="${active ? 'url(#glow)' : ''}"/>
          <text x="${n.x}" y="${n.y + 1}" text-anchor="middle"
            dominant-baseline="central" font-size="18">${n.icon}</text>
          <text x="${n.x}" y="${n.y + NODE_R + 14}" text-anchor="middle"
            font-size="10" fill="${C.textDim}" font-weight="500">${n.label}</text>
          <text x="${n.x}" y="${n.y + NODE_R + 26}" text-anchor="middle"
            font-size="12" fill="${n.color}" font-weight="700"
            font-family="'JetBrains Mono',monospace"
            style="font-feature-settings:'tnum'">${
              n.pct >= 0 ? fmtP(n.pct) : (Math.abs(n.val) > FLOW_MIN_W ? fmtW(n.val) : '')
            }</text>
        </g>`;
    }).join('')}
  </svg>

  <!-- Metrics bar -->
  <div class="metrics">
    <div class="m"><span class="mv" style="color:${C.solar}">${fmtW(pvW)}</span><span class="ml">PV</span></div>
    <div class="m"><span class="mv" style="color:${gridW > 0 ? C.gridImp : C.gridExp}">${fmtW(gridW)}</span><span class="ml">${gridW < -FLOW_MIN_W ? 'Export' : 'Grid'}</span></div>
    ${bats.map(b => `<div class="m"><span class="mv" style="color:${C.battery}">${fmtP(b.soc)}</span><span class="ml">${b.id}</span></div>`).join('')}
    ${evSoc > 0 ? `<div class="m"><span class="mv" style="color:${C.ev}">${fmtP(evSoc)}</span><span class="ml">EV</span></div>` : ''}
    ${ellevio > 0 ? `<div class="m"><span class="mv" style="color:${C.textMuted}">${ellevio.toFixed(2)}</span><span class="ml">Ellevio</span></div>` : ''}
  </div>

  <!-- DayPlan current slot -->
  ${currentSlot ? `<div class="slot">
    <span class="slot-h">${currentSlot.hour}:00</span>
    ${currentSlot.bat_w > 0 ? `<span class="tag" style="--tc:${C.battery}">${currentSlot.bat_mode} ${fmtW(currentSlot.bat_w)}</span>` : ''}
    ${currentSlot.ev_w > 0 ? `<span class="tag" style="--tc:${C.ev}">EV ${currentSlot.ev_amps}A</span>` : ''}
    ${currentSlot.dispatch_w > 0 ? `<span class="tag" style="--tc:${C.dispatch}">${fmtW(currentSlot.dispatch_w)}</span>` : ''}
    ${currentSlot.export_w > 0 ? `<span class="tag" style="--tc:${C.gridExp}">Exp ${fmtW(currentSlot.export_w)}</span>` : ''}
  </div>` : ''}

  <!-- Battery bars -->
  <div class="bats">
    ${bats.map(b => `<div class="bat">
      <span class="bat-id">${b.id}</span>
      <div class="bat-bar"><div class="bat-fill ${b.power < 0 ? 'chg' : b.power > 0 ? 'dis' : ''}" style="width:${b.soc}%"></div></div>
      <span class="bat-v">${fmtP(b.soc)}</span>
      <span class="bat-p">${fmtW(b.power)}</span>
    </div>`).join('')}
  </div>

  <div class="foot">CARMA Energy v${VERSION}</div>
</div>`;
  }

  // ----------------------------------------------------------
  // Animation loop (flow line dash offset)
  // ----------------------------------------------------------
  _startAnim() {
    let offset = 0;
    const tick = () => {
      offset = (offset + 0.4) % 20;
      const lines = this.shadowRoot?.querySelectorAll('.flow-line');
      if (lines) lines.forEach(l => l.setAttribute('stroke-dashoffset', -offset));
      this._animId = requestAnimationFrame(tick);
    };
    this._animId = requestAnimationFrame(tick);
  }

  // ----------------------------------------------------------
  // CSS
  // ----------------------------------------------------------
  _css() { return `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

:host { display: block; }

.card {
  background: rgba(26,29,46,0.9);
  backdrop-filter: blur(${GLASS_BLUR_PX}px);
  -webkit-backdrop-filter: blur(${GLASS_BLUR_PX}px);
  border: 1px solid rgba(255,160,64,0.12);
  border-radius: 16px;
  box-shadow: 0 4px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04);
  padding: 16px;
  color: ${C.text};
  font-family: 'Inter',sans-serif;
}

.header { margin-bottom: 8px; }
.brand { font-size: 1.1rem; font-weight: 700; color: ${C.primary}; letter-spacing: 0.03em; }
.sub { font-size: 0.65rem; color: ${C.textMuted}; margin-top: 2px; }

.flow { width: 100%; height: auto; margin: -4px 0 4px; }

/* Animated pulse on active nodes */
.node.pulse circle { animation: nodePulse 2s ease-in-out infinite; }
@keyframes nodePulse {
  0%, 100% { stroke-opacity: 1; }
  50% { stroke-opacity: 0.5; stroke-width: 3; }
}

/* Glowing dots */
.dot { opacity: 0.9; }

.metrics { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; margin-bottom: 8px; }
.m { display: flex; flex-direction: column; align-items: center; min-width: 48px; }
.mv { font-family: 'JetBrains Mono',monospace; font-feature-settings: "tnum";
  font-size: 1rem; font-weight: 600; transition: color 0.5s ease; }
.ml { font-size: 0.6rem; color: ${C.textMuted}; text-transform: uppercase; letter-spacing: 0.08em; }

.slot { display: flex; gap: 6px; align-items: center; flex-wrap: wrap;
  background: ${C.surface}; border: 1px solid ${C.border}; border-radius: 10px;
  padding: 8px 12px; margin-bottom: 8px; }
.slot-h { font-size: 0.7rem; color: ${C.textDim}; font-weight: 600; }
.tag { font-family: 'JetBrains Mono',monospace; font-size: 0.6rem; padding: 2px 8px;
  border-radius: 999px; background: color-mix(in srgb, var(--tc) 20%, transparent);
  color: var(--tc); font-weight: 500; }

.bats { margin-bottom: 6px; }
.bat { display: flex; align-items: center; gap: 8px; margin-bottom: 3px; }
.bat-id { font-size: 0.65rem; color: ${C.textDim}; min-width: 40px; }
.bat-bar { flex: 1; height: 5px; background: ${C.border}; border-radius: 3px; overflow: hidden; }
.bat-fill { height: 100%; border-radius: 3px; background: ${C.battery};
  transition: width 1s ease; }
.bat-fill.chg { animation: chgPulse 2s ease infinite; }
.bat-fill.dis { background: ${C.batDis}; }
@keyframes chgPulse { 0%,100% { opacity:1; } 50% { opacity:0.65; } }
.bat-v { font-family: 'JetBrains Mono',monospace; font-feature-settings: "tnum";
  font-size: 0.65rem; min-width: 28px; }
.bat-p { font-family: 'JetBrains Mono',monospace; font-size: 0.6rem; color: ${C.textMuted}; }

.foot { font-size: 0.5rem; color: ${C.textMuted}; text-align: right; margin-top: 4px; }

@media (max-width: 500px) {
  .mv { font-size: 0.85rem; }
  .brand { font-size: 0.95rem; }
}
`; }
}

customElements.define('carma-energy-card', CarmaEnergyCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'carma-energy-card',
  name: 'CARMA Energy Card',
  description: 'Premium energy flow visualization with animated particles',
  preview: true,
});
console.info(`%c CARMA Energy Card v${VERSION} `, 'background: #FFA040; color: #0F1117; font-weight: bold; border-radius: 4px;');
