/**
 * CARMA Energy Card — Premium energy visualization for Home Assistant
 *
 * PLAT-1642: Custom Lovelace card showing real-time energy flows,
 * DayPlan allocation, SoC projections, and system status.
 *
 * Architecture: Vanilla JS + Shadow DOM (matches existing HA card pattern).
 * All visual values from CSS custom properties (design tokens).
 */

const VERSION = '0.1.0';

// ============================================================
// Design token constants (mirrored from tokens.css for JS logic)
// ============================================================
const FLOW_MIN_W = 50;
const FLOW_MAX_W = 8000;
const FLOW_MIN_DURATION_S = 6.0;
const FLOW_MAX_DURATION_S = 0.75;
const UPDATE_THROTTLE_MS = 5000;
const W_TO_KW = 1000;
const GLASS_BLUR_DEFAULT_PX = 12;

/**
 * Calculate flow animation duration from watts.
 * Higher watt = faster animation (shorter duration).
 * Below FLOW_MIN_W = no animation (returns 0).
 */
function flowDuration(watts) {
  const w = Math.abs(watts);
  if (w < FLOW_MIN_W) return 0;
  const clamped = Math.min(w, FLOW_MAX_W);
  const ratio = clamped / FLOW_MAX_W;
  return FLOW_MIN_DURATION_S - ratio * (FLOW_MIN_DURATION_S - FLOW_MAX_DURATION_S);
}

/**
 * Format watts for display.
 * < W_TO_KW: "340 W"
 * >= 1000W: "3.4 kW"
 */
function fmtWatt(w) {
  const abs = Math.abs(w);
  if (abs < W_TO_KW) return `${Math.round(abs)} W`;
  return `${(abs / W_TO_KW).toFixed(1)} kW`;
}

/**
 * Format percentage for display.
 */
function fmtPct(pct) {
  return `${Math.round(pct)}%`;
}


// ============================================================
// Main Card Element
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
    if (!config) throw new Error('CARMA Energy Card: no config provided');
    this._config = {
      // Entity mappings (from card YAML config)
      scenario: config.scenario || 'sensor.carma_box_scenario',
      day_plan: config.day_plan || 'sensor.carma_box_day_plan',
      decision: config.decision || 'sensor.carma_box_decision_reason',
      // Battery entities (array of {id, soc, power, pv})
      batteries: config.batteries || [],
      // Grid
      grid_power: config.grid_power || '',
      pv_total: config.pv_total || '',
      // EV
      ev_soc: config.ev_soc || '',
      ev_power: config.ev_power || '',
      // Ellevio
      ellevio: config.ellevio || '',
      // Display options
      show_flow: config.show_flow !== false,
      show_timeline: config.show_timeline !== false,
      show_forecast: config.show_forecast !== false,
      glass_blur: config.glass_blur ?? GLASS_BLUR_DEFAULT_PX,
      ...config,
    };
    this._render();
  }

  getCardSize() {
    return 6;
  }

  static getConfigElement() {
    return document.createElement('carma-energy-card-editor');
  }

  // ----------------------------------------------------------
  // Render
  // ----------------------------------------------------------

  _render() {
    if (!this._hass || !this._config) return;

    const scenario = this._state(this._config.scenario);
    const scenarioAttrs = this._attrs(this._config.scenario);
    const decision = this._state(this._config.decision);

    // Battery data
    const batteries = (this._config.batteries || []).map(b => ({
      id: b.id || '',
      soc: this._num(b.soc),
      power: this._num(b.power),
      pv: this._num(b.pv),
    }));
    const batSocAvg = batteries.length
      ? batteries.reduce((s, b) => s + b.soc, 0) / batteries.length
      : 0;
    const batPowerTotal = batteries.reduce((s, b) => s + b.power, 0);

    // Grid & PV
    const gridW = this._num(this._config.grid_power);
    const pvW = this._num(this._config.pv_total) || batteries.reduce((s, b) => s + b.pv, 0);

    // EV
    const evSoc = this._num(this._config.ev_soc);
    const evPower = this._num(this._config.ev_power);

    // Ellevio
    const ellevioAvg = this._num(this._config.ellevio);

    // DayPlan
    const planAttrs = this._attrs(this._config.day_plan);
    const planState = this._state(this._config.day_plan);
    const currentSlot = planAttrs?.current_hour || null;

    // Determine key flows
    const isExporting = gridW < -FLOW_MIN_W;
    const isImporting = gridW > FLOW_MIN_W;
    const isBatCharging = batPowerTotal < -FLOW_MIN_W;
    const isBatDischarging = batPowerTotal > FLOW_MIN_W;
    const isEvCharging = evPower > FLOW_MIN_W;

    this.shadowRoot.innerHTML = `
      <style>
        ${this._styles()}
      </style>

      <div class="carma-card">
        <!-- Hero Section -->
        <div class="hero">
          <div class="hero-scenario">${scenario || 'INITIALIZING'}</div>
          <div class="hero-decision">${decision || ''}</div>
          <div class="hero-metrics">
            <div class="metric solar">
              <span class="metric-value">${fmtWatt(pvW)}</span>
              <span class="metric-label">PV</span>
            </div>
            <div class="metric ${isImporting ? 'grid-import' : 'grid-export'}">
              <span class="metric-value">${fmtWatt(gridW)}</span>
              <span class="metric-label">${isExporting ? 'Export' : 'Grid'}</span>
            </div>
            <div class="metric battery">
              <span class="metric-value">${fmtPct(batSocAvg)}</span>
              <span class="metric-label">Bat SoC</span>
            </div>
            ${evSoc > 0 ? `
            <div class="metric ev">
              <span class="metric-value">${fmtPct(evSoc)}</span>
              <span class="metric-label">EV</span>
            </div>
            ` : ''}
          </div>
          ${ellevioAvg > 0 ? `
          <div class="hero-ellevio">Ellevio ${ellevioAvg.toFixed(2)} kW</div>
          ` : ''}
        </div>

        <!-- DayPlan Current Hour -->
        ${currentSlot ? `
        <div class="plan-current">
          <div class="plan-hour">Timme ${currentSlot.hour}:00</div>
          <div class="plan-alloc">
            ${currentSlot.bat_w > 0 ? `<span class="tag battery">Bat ${fmtWatt(currentSlot.bat_w)}</span>` : ''}
            ${currentSlot.ev_w > 0 ? `<span class="tag ev">EV ${fmtWatt(currentSlot.ev_w)}</span>` : ''}
            ${currentSlot.dispatch_w > 0 ? `<span class="tag dispatch">Dispatch ${fmtWatt(currentSlot.dispatch_w)}</span>` : ''}
            ${currentSlot.export_w > 0 ? `<span class="tag export">Export ${fmtWatt(currentSlot.export_w)}</span>` : ''}
          </div>
        </div>
        ` : ''}

        <!-- Battery Detail -->
        <div class="bat-detail">
          ${batteries.map(b => `
            <div class="bat-item">
              <div class="bat-bar" style="--soc: ${b.soc}%">
                <div class="bat-fill ${b.power < 0 ? 'charging' : b.power > 0 ? 'discharging' : ''}"></div>
              </div>
              <div class="bat-info">
                <span class="bat-id">${b.id}</span>
                <span class="bat-soc">${fmtPct(b.soc)}</span>
                <span class="bat-power">${fmtWatt(b.power)}</span>
              </div>
            </div>
          `).join('')}
        </div>

        <div class="footer">
          CARMA Energy v${VERSION}
        </div>
      </div>
    `;
  }

  // ----------------------------------------------------------
  // Styles
  // ----------------------------------------------------------

  _styles() {
    const blur = this._config.glass_blur ?? GLASS_BLUR_DEFAULT_PX;
    return `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

      :host {
        --carma-primary: #FFA040;
        --carma-bg: #0F1117;
        --carma-surface: #1A1D2E;
        --carma-border: #2D3149;
        --carma-solar: #FFD600;
        --carma-battery: #4CAF50;
        --carma-battery-discharge: #2196F3;
        --carma-grid-import: #F44336;
        --carma-grid-export: #8BC34A;
        --carma-ev: #A78BFA;
        --carma-dispatch: #F97316;
        --carma-text: #F1F5F9;
        --carma-text-secondary: #94A3B8;
        --carma-text-muted: #475569;
        --carma-glass-blur: ${blur}px;
      }

      .carma-card {
        background: rgba(26, 29, 46, 0.85);
        backdrop-filter: blur(var(--carma-glass-blur));
        -webkit-backdrop-filter: blur(var(--carma-glass-blur));
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 16px;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
        padding: 20px;
        color: var(--carma-text);
        font-family: 'Inter', sans-serif;
      }

      /* Hero */
      .hero { margin-bottom: 16px; }
      .hero-scenario {
        font-size: 1.5rem;
        font-weight: 700;
        color: var(--carma-primary);
        letter-spacing: 0.02em;
        margin-bottom: 4px;
      }
      .hero-decision {
        font-size: 0.75rem;
        color: var(--carma-text-secondary);
        margin-bottom: 12px;
      }
      .hero-metrics {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
      }
      .metric {
        display: flex;
        flex-direction: column;
        align-items: center;
        min-width: 60px;
      }
      .metric-value {
        font-family: 'JetBrains Mono', monospace;
        font-feature-settings: "tnum";
        font-size: 1.25rem;
        font-weight: 600;
      }
      .metric-label {
        font-size: 0.6875rem;
        color: var(--carma-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .metric.solar .metric-value { color: var(--carma-solar); }
      .metric.grid-import .metric-value { color: var(--carma-grid-import); }
      .metric.grid-export .metric-value { color: var(--carma-grid-export); }
      .metric.battery .metric-value { color: var(--carma-battery); }
      .metric.ev .metric-value { color: var(--carma-ev); }
      .hero-ellevio {
        font-size: 0.75rem;
        color: var(--carma-text-muted);
        margin-top: 8px;
      }

      /* Plan current hour */
      .plan-current {
        background: var(--carma-surface);
        border: 1px solid var(--carma-border);
        border-radius: 12px;
        padding: 12px 16px;
        margin-bottom: 12px;
      }
      .plan-hour {
        font-size: 0.75rem;
        color: var(--carma-text-secondary);
        margin-bottom: 6px;
      }
      .plan-alloc { display: flex; gap: 8px; flex-wrap: wrap; }
      .tag {
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.6875rem;
        padding: 2px 8px;
        border-radius: 9999px;
        font-weight: 500;
      }
      .tag.battery { background: rgba(76,175,80,0.2); color: var(--carma-battery); }
      .tag.ev { background: rgba(167,139,250,0.2); color: var(--carma-ev); }
      .tag.dispatch { background: rgba(249,115,22,0.2); color: var(--carma-dispatch); }
      .tag.export { background: rgba(139,195,74,0.2); color: var(--carma-grid-export); }

      /* Battery bars */
      .bat-detail {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 12px;
      }
      .bat-item { display: flex; align-items: center; gap: 12px; }
      .bat-bar {
        flex: 1;
        height: 8px;
        background: var(--carma-border);
        border-radius: 4px;
        overflow: hidden;
      }
      .bat-fill {
        height: 100%;
        width: var(--soc);
        border-radius: 4px;
        background: var(--carma-battery);
        transition: width 1s ease;
      }
      .bat-fill.discharging { background: var(--carma-battery-discharge); }
      .bat-fill.charging {
        background: var(--carma-battery);
        animation: pulse-charge 2s ease-in-out infinite;
      }
      @keyframes pulse-charge {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
      }
      .bat-info {
        display: flex;
        gap: 8px;
        font-family: 'JetBrains Mono', monospace;
        font-feature-settings: "tnum";
        font-size: 0.75rem;
        min-width: 140px;
      }
      .bat-id { color: var(--carma-text-secondary); min-width: 48px; }
      .bat-soc { color: var(--carma-text); min-width: 32px; }
      .bat-power { color: var(--carma-text-muted); }

      /* Footer */
      .footer {
        font-size: 0.625rem;
        color: var(--carma-text-muted);
        text-align: right;
        margin-top: 8px;
      }

      /* Responsive */
      @media (max-width: 600px) {
        .hero-metrics { gap: 12px; }
        .metric-value { font-size: 1rem; }
        .hero-scenario { font-size: 1.25rem; }
      }
    `;
  }

  // ----------------------------------------------------------
  // HA helpers
  // ----------------------------------------------------------

  _state(entityId) {
    if (!entityId || !this._hass) return null;
    const s = this._hass.states[entityId];
    return s ? s.state : null;
  }

  _attrs(entityId) {
    if (!entityId || !this._hass) return null;
    const s = this._hass.states[entityId];
    return s ? s.attributes : null;
  }

  _num(entityOrValue) {
    if (typeof entityOrValue === 'number') return entityOrValue;
    const s = this._state(entityOrValue);
    if (s === null || s === 'unknown' || s === 'unavailable') return 0;
    return parseFloat(s) || 0;
  }
}

customElements.define('carma-energy-card', CarmaEnergyCard);

// Card info for HA picker
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'carma-energy-card',
  name: 'CARMA Energy Card',
  description: 'Premium energy visualization with DayPlan, flow animation, and SoC tracking',
  preview: true,
});

console.info(`%c CARMA Energy Card v${VERSION} `, 'background: #FFA040; color: #0F1117; font-weight: bold;');
