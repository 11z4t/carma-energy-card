/**
 * CARMA Energy Card v0.1.0
 * Premium energy visualization for Home Assistant
 *
 * PLAT-1642: Real-time energy flows, DayPlan allocation,
 * SoC projections, and system status.
 *
 * Components:
 *   1. Hero Status — scenario + key metrics + glassmorphism
 *   2. Energy Flow — SVG nodes + animated flow lines
 *   3. DayPlan Timeline — per-hour plan vs actual stacked bars
 *   4. Battery Detail — SoC bars + charge/discharge indicators
 *
 * Design: CARMA orange brand + semantic energy colors.
 * All values from CSS custom properties.
 */

const VERSION = '0.1.0';

// ============================================================
// Constants — no naked literals
// ============================================================
const FLOW_MIN_W = 50;
const FLOW_MAX_W = 8000;
const FLOW_SLOW_S = 6.0;
const FLOW_FAST_S = 0.75;
const UPDATE_THROTTLE_MS = 5000;
const W_TO_KW = 1000;
const TIMELINE_START_H = 6;
const TIMELINE_END_H = 22;
const TIMELINE_HOURS = TIMELINE_END_H - TIMELINE_START_H;
const SOC_MIN_DISPLAY = 0;
const SOC_MAX_DISPLAY = 100;
const NODE_RADIUS = 28;
const FLOW_LINE_WIDTH = 2;

// ============================================================
// Helpers
// ============================================================
function flowDuration(watts) {
  const w = Math.abs(watts);
  if (w < FLOW_MIN_W) return 0;
  const r = Math.min(w, FLOW_MAX_W) / FLOW_MAX_W;
  return FLOW_SLOW_S - r * (FLOW_SLOW_S - FLOW_FAST_S);
}

function fmtW(w) {
  const a = Math.abs(w);
  return a < W_TO_KW ? `${Math.round(a)} W` : `${(a / W_TO_KW).toFixed(1)} kW`;
}

function fmtPct(p) { return `${Math.round(p)}%`; }

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ============================================================
// Main Card
// ============================================================
class CarmaEnergyCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass = null;
    this._config = {};
    this._lastUpdate = 0;
  }

  set hass(hass) {
    this._hass = hass;
    const now = Date.now();
    if (now - this._lastUpdate < UPDATE_THROTTLE_MS) return;
    this._lastUpdate = now;
    this._render();
  }

  setConfig(config) {
    if (!config) throw new Error('CARMA Energy Card requires config');
    this._config = {
      scenario: config.scenario || 'sensor.carma_box_scenario',
      day_plan: config.day_plan || 'sensor.carma_box_day_plan',
      decision: config.decision || 'sensor.carma_box_decision_reason',
      batteries: config.batteries || [],
      grid_power: config.grid_power || '',
      pv_total: config.pv_total || '',
      ev_soc: config.ev_soc || '',
      ev_power: config.ev_power || '',
      ellevio: config.ellevio || '',
      glass_blur: config.glass_blur ?? 12,
    };
  }

  getCardSize() { return 8; }

  // --- HA state helpers ---
  _s(id) {
    if (!id || !this._hass) return null;
    const e = this._hass.states[id];
    return e ? e.state : null;
  }
  _a(id) {
    if (!id || !this._hass) return null;
    const e = this._hass.states[id];
    return e ? e.attributes : null;
  }
  _n(id) {
    if (typeof id === 'number') return id;
    const s = this._s(id);
    if (!s || s === 'unknown' || s === 'unavailable') return 0;
    return parseFloat(s) || 0;
  }

  // --- Render ---
  _render() {
    if (!this._hass) return;
    const c = this._config;

    // Data
    const scenario = this._s(c.scenario) || 'INITIALIZING';
    const scenarioAttrs = this._a(c.scenario) || {};
    const decision = this._s(c.decision) || '';
    const planAttrs = this._a(c.day_plan) || {};
    const currentSlot = planAttrs.current_hour || null;
    const planSlots = planAttrs.slots || [];
    const canDischargeFm = planAttrs.can_discharge_fm || false;

    const bats = (c.batteries || []).map(b => ({
      id: b.id || '',
      soc: this._n(b.soc),
      power: this._n(b.power),
      pv: this._n(b.pv),
    }));
    const batSocAvg = bats.length ? bats.reduce((s, b) => s + b.soc, 0) / bats.length : 0;
    const batPower = bats.reduce((s, b) => s + b.power, 0);
    const gridW = this._n(c.grid_power);
    const pvW = this._n(c.pv_total) || bats.reduce((s, b) => s + b.pv, 0);
    const evSoc = this._n(c.ev_soc);
    const evPower = this._n(c.ev_power);
    const ellevio = this._n(c.ellevio);

    const isExport = gridW < -FLOW_MIN_W;
    const isImport = gridW > FLOW_MIN_W;
    const isBatChg = batPower < -FLOW_MIN_W;
    const isBatDis = batPower > FLOW_MIN_W;
    const isEvChg = evPower > FLOW_MIN_W;
    const nowH = new Date().getHours();

    this.shadowRoot.innerHTML = `
<style>${this._css()}</style>
<div class="card">

  <!-- HERO -->
  <div class="hero">
    <div class="hero-top">
      <img src="/local/community/carma-energy-card/logo.png" class="logo" alt="CARMA" onerror="this.style.display='none'">
      <div class="hero-title">
        <div class="scenario">${scenario.replace(/_/g, ' ')}</div>
        <div class="decision">${decision}</div>
      </div>
    </div>
    <div class="metrics">
      <div class="m solar"><span class="mv">${fmtW(pvW)}</span><span class="ml">PV</span></div>
      <div class="m ${isImport ? 'grid-imp' : 'grid-exp'}"><span class="mv">${fmtW(gridW)}</span><span class="ml">${isExport ? 'Export' : 'Grid'}</span></div>
      <div class="m bat"><span class="mv">${fmtPct(batSocAvg)}</span><span class="ml">Bat SoC</span></div>
      ${evSoc > 0 ? `<div class="m ev"><span class="mv">${fmtPct(evSoc)}</span><span class="ml">EV</span></div>` : ''}
    </div>
    ${canDischargeFm ? '<div class="badge fm">FM DISCHARGE</div>' : ''}
    ${ellevio > 0 ? `<div class="ellevio">Ellevio ${ellevio.toFixed(2)} kW</div>` : ''}
  </div>

  <!-- ENERGY FLOW SVG -->
  <div class="flow-wrap">
    <svg viewBox="0 0 360 200" class="flow-svg">
      <!-- Nodes -->
      ${this._node(180, 20, pvW, 'solar', '☀', fmtW(pvW))}
      ${this._node(60, 100, Math.abs(batPower), isBatChg ? 'bat' : isBatDis ? 'bat-dis' : 'idle', '🔋', fmtPct(batSocAvg))}
      ${this._node(300, 100, Math.abs(gridW), isImport ? 'grid-imp' : isExport ? 'grid-exp' : 'idle', '⚡', fmtW(gridW))}
      ${this._node(180, 100, 0, 'home', '🏠', '')}
      ${evSoc > 0 ? this._node(180, 180, evPower, isEvChg ? 'ev' : 'idle', '🚗', fmtPct(evSoc)) : ''}

      <!-- Flow lines -->
      ${this._flowLine(180, 44, 180, 76, pvW, 'solar')}
      ${this._flowLine(84, 100, 156, 100, Math.abs(batPower), isBatChg ? 'bat' : 'bat-dis')}
      ${this._flowLine(204, 100, 276, 100, Math.abs(gridW), isImport ? 'grid-imp' : 'grid-exp')}
      ${evSoc > 0 ? this._flowLine(180, 124, 180, 156, evPower, 'ev') : ''}
    </svg>
  </div>

  <!-- DAYPLAN CURRENT HOUR -->
  ${currentSlot ? `
  <div class="plan-now">
    <div class="plan-label">Plan timme ${currentSlot.hour}:00</div>
    <div class="plan-tags">
      ${currentSlot.bat_w > 0 ? `<span class="tag bat">${currentSlot.bat_mode} ${fmtW(currentSlot.bat_w)}</span>` : ''}
      ${currentSlot.ev_w > 0 ? `<span class="tag ev">EV ${currentSlot.ev_amps}A</span>` : ''}
      ${currentSlot.dispatch_w > 0 ? `<span class="tag disp">${fmtW(currentSlot.dispatch_w)}</span>` : ''}
      ${currentSlot.export_w > 0 ? `<span class="tag exp">Export ${fmtW(currentSlot.export_w)}</span>` : ''}
    </div>
  </div>` : ''}

  <!-- TIMELINE -->
  ${planSlots.length > 0 ? `
  <div class="timeline-wrap">
    <div class="timeline-label">DayPlan 06–22</div>
    <div class="timeline">
      ${planSlots.map(s => {
        const total = (s.bat_w || 0) + (s.ev_w || 0) + (s.dispatch_w || 0) + (s.export_w || 0);
        const max = 6000;
        const batH = clamp((s.bat_w || 0) / max * 100, 0, 100);
        const evH = clamp((s.ev_w || 0) / max * 100, 0, 100);
        const dispH = clamp((s.dispatch_w || 0) / max * 100, 0, 100);
        const expH = clamp((s.export_w || 0) / max * 100, 0, 100);
        const isNow = s.hour === nowH;
        return `<div class="tbar ${isNow ? 'now' : ''}" title="${s.hour}:00 — ${fmtW(total)}">
          <div class="tseg exp" style="height:${expH}%"></div>
          <div class="tseg disp" style="height:${dispH}%"></div>
          <div class="tseg ev" style="height:${evH}%"></div>
          <div class="tseg bat" style="height:${batH}%"></div>
          <div class="thour">${s.hour}</div>
        </div>`;
      }).join('')}
    </div>
    <div class="timeline-legend">
      <span class="leg bat">Bat</span>
      <span class="leg ev">EV</span>
      <span class="leg disp">Dispatch</span>
      <span class="leg exp">Export</span>
    </div>
  </div>` : ''}

  <!-- BATTERY DETAIL -->
  <div class="bat-detail">
    ${bats.map(b => `
    <div class="bat-row">
      <span class="bat-id">${b.id}</span>
      <div class="bat-bar"><div class="bat-fill ${b.power < 0 ? 'chg' : b.power > 0 ? 'dis' : ''}" style="width:${b.soc}%"></div></div>
      <span class="bat-soc">${fmtPct(b.soc)}</span>
      <span class="bat-pw">${fmtW(b.power)}</span>
    </div>`).join('')}
  </div>

  <div class="footer">CARMA Energy v${VERSION}</div>
</div>`;
  }

  // --- SVG helpers ---
  _node(x, y, watts, cls, icon, label) {
    const r = NODE_RADIUS;
    const opacity = watts > FLOW_MIN_W || cls === 'home' ? 1 : 0.4;
    return `
      <g class="node ${cls}" opacity="${opacity}">
        <circle cx="${x}" cy="${y}" r="${r}" />
        <text x="${x}" y="${y - 4}" class="icon">${icon}</text>
        <text x="${x}" y="${y + 14}" class="nlabel">${label}</text>
      </g>`;
  }

  _flowLine(x1, y1, x2, y2, watts, cls) {
    const dur = flowDuration(watts);
    const opacity = dur > 0 ? 1 : 0.15;
    const anim = dur > 0
      ? `stroke-dasharray="6 4" style="animation:flowAnim ${dur}s linear infinite"`
      : 'stroke-dasharray="4 8"';
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
      class="fline ${cls}" opacity="${opacity}" ${anim}
      stroke-width="${FLOW_LINE_WIDTH}"/>`;
  }

  // --- CSS ---
  _css() {
    const blur = this._config.glass_blur ?? 12;
    return `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

:host {
  --carma: #FFA040;
  --solar: #FFD600;
  --bat: #4CAF50;
  --bat-dis: #2196F3;
  --grid-imp: #F44336;
  --grid-exp: #8BC34A;
  --ev: #A78BFA;
  --disp: #F97316;
  --home: #E2E8F0;
  --bg: #0F1117;
  --surf: #1A1D2E;
  --brd: #2D3149;
  --txt: #F1F5F9;
  --txt2: #94A3B8;
  --txt3: #475569;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

.card {
  background: rgba(26,29,46,0.85);
  backdrop-filter: blur(${blur}px);
  -webkit-backdrop-filter: blur(${blur}px);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 16px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.4);
  padding: 16px;
  color: var(--txt);
  font-family: 'Inter', sans-serif;
}

/* HERO */
.hero { margin-bottom: 12px; }
.hero-top { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.logo { width: 36px; height: 36px; border-radius: 8px; }
.scenario { font-size: 1.25rem; font-weight: 700; color: var(--carma); letter-spacing: 0.02em; }
.decision { font-size: 0.7rem; color: var(--txt2); }
.metrics { display: flex; gap: 14px; flex-wrap: wrap; }
.m { display: flex; flex-direction: column; align-items: center; min-width: 52px; }
.mv { font-family: 'JetBrains Mono', monospace; font-feature-settings: "tnum"; font-size: 1.1rem; font-weight: 600; }
.ml { font-size: 0.625rem; color: var(--txt3); text-transform: uppercase; letter-spacing: 0.08em; }
.m.solar .mv { color: var(--solar); }
.m.grid-imp .mv { color: var(--grid-imp); }
.m.grid-exp .mv { color: var(--grid-exp); }
.m.bat .mv { color: var(--bat); }
.m.ev .mv { color: var(--ev); }
.badge { display: inline-block; font-size: 0.625rem; font-weight: 600; padding: 2px 8px; border-radius: 999px; margin-top: 6px; letter-spacing: 0.05em; }
.badge.fm { background: rgba(255,160,64,0.2); color: var(--carma); }
.ellevio { font-size: 0.7rem; color: var(--txt3); margin-top: 4px; }

/* FLOW SVG */
.flow-wrap { margin-bottom: 12px; }
.flow-svg { width: 100%; height: auto; }
.node circle { fill: var(--surf); stroke: var(--brd); stroke-width: 1.5; }
.node.solar circle { stroke: var(--solar); }
.node.bat circle { stroke: var(--bat); }
.node.bat-dis circle { stroke: var(--bat-dis); }
.node.grid-imp circle { stroke: var(--grid-imp); }
.node.grid-exp circle { stroke: var(--grid-exp); }
.node.ev circle { stroke: var(--ev); }
.node.home circle { stroke: var(--home); fill: rgba(226,232,240,0.1); }
.node.idle circle { stroke: var(--brd); }
.icon { font-size: 16px; text-anchor: middle; dominant-baseline: central; }
.nlabel { font-family: 'JetBrains Mono', monospace; font-size: 9px; text-anchor: middle; fill: var(--txt2); font-feature-settings: "tnum"; }
.fline { fill: none; }
.fline.solar { stroke: var(--solar); }
.fline.bat { stroke: var(--bat); }
.fline.bat-dis { stroke: var(--bat-dis); }
.fline.grid-imp { stroke: var(--grid-imp); }
.fline.grid-exp { stroke: var(--grid-exp); }
.fline.ev { stroke: var(--ev); }

@keyframes flowAnim { to { stroke-dashoffset: -20; } }

/* PLAN CURRENT */
.plan-now { background: var(--surf); border: 1px solid var(--brd); border-radius: 10px; padding: 10px 14px; margin-bottom: 10px; }
.plan-label { font-size: 0.7rem; color: var(--txt2); margin-bottom: 4px; }
.plan-tags { display: flex; gap: 6px; flex-wrap: wrap; }
.tag { font-family: 'JetBrains Mono', monospace; font-size: 0.625rem; padding: 2px 8px; border-radius: 999px; font-weight: 500; }
.tag.bat { background: rgba(76,175,80,0.2); color: var(--bat); }
.tag.ev { background: rgba(167,139,250,0.2); color: var(--ev); }
.tag.disp { background: rgba(249,115,22,0.2); color: var(--disp); }
.tag.exp { background: rgba(139,195,74,0.2); color: var(--grid-exp); }

/* TIMELINE */
.timeline-wrap { margin-bottom: 10px; }
.timeline-label { font-size: 0.7rem; color: var(--txt2); margin-bottom: 4px; }
.timeline { display: flex; gap: 2px; height: 64px; align-items: flex-end; }
.tbar { flex: 1; display: flex; flex-direction: column-reverse; align-items: center; position: relative; min-width: 0; }
.tbar.now { background: rgba(255,160,64,0.12); border-radius: 4px; }
.tseg { width: 100%; border-radius: 2px; min-height: 0; transition: height 0.5s ease; }
.tseg.bat { background: var(--bat); }
.tseg.ev { background: var(--ev); }
.tseg.disp { background: var(--disp); }
.tseg.exp { background: var(--grid-exp); opacity: 0.6; }
.thour { font-size: 7px; color: var(--txt3); margin-top: 2px; font-family: 'JetBrains Mono', monospace; }
.timeline-legend { display: flex; gap: 10px; margin-top: 4px; }
.leg { font-size: 0.6rem; color: var(--txt3); display: flex; align-items: center; gap: 3px; }
.leg::before { content: ''; width: 8px; height: 8px; border-radius: 2px; }
.leg.bat::before { background: var(--bat); }
.leg.ev::before { background: var(--ev); }
.leg.disp::before { background: var(--disp); }
.leg.exp::before { background: var(--grid-exp); }

/* BATTERY DETAIL */
.bat-detail { margin-bottom: 8px; }
.bat-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.bat-id { font-size: 0.7rem; color: var(--txt2); min-width: 44px; }
.bat-bar { flex: 1; height: 6px; background: var(--brd); border-radius: 3px; overflow: hidden; }
.bat-fill { height: 100%; border-radius: 3px; background: var(--bat); transition: width 1s ease; }
.bat-fill.chg { animation: pulseChg 2s ease infinite; }
.bat-fill.dis { background: var(--bat-dis); }
@keyframes pulseChg { 0%,100% { opacity:1; } 50% { opacity:0.7; } }
.bat-soc { font-family: 'JetBrains Mono', monospace; font-feature-settings: "tnum"; font-size: 0.7rem; min-width: 28px; }
.bat-pw { font-family: 'JetBrains Mono', monospace; font-size: 0.65rem; color: var(--txt3); min-width: 48px; }

.footer { font-size: 0.55rem; color: var(--txt3); text-align: right; margin-top: 4px; }

@media (max-width: 600px) {
  .metrics { gap: 10px; }
  .mv { font-size: 0.95rem; }
  .scenario { font-size: 1.1rem; }
  .timeline { height: 48px; }
}
`;
  }
}

customElements.define('carma-energy-card', CarmaEnergyCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'carma-energy-card',
  name: 'CARMA Energy Card',
  description: 'Premium energy visualization — flows, DayPlan, SoC tracking',
  preview: true,
});

console.info(`%c CARMA Energy Card v${VERSION} `, 'background: #FFA040; color: #0F1117; font-weight: bold; border-radius: 4px;');
