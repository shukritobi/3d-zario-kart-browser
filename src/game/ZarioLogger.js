/**
 * Zario Kart — Structured Telemetry & Diagnostic Logger (`ZarioLogger`).
 *
 * Provides detailed, categorized logging across physics, ramps, tricks, tracks,
 * 3D models, Samsung Smart TV adaptation, and Nintendo Switch iPhone controller
 * pairing. Exposes `window.__zarioLogger` and integrates with `window.__zarioDiag`.
 *
 * Compatible with ES2019 / Chromium M76 (2021 Samsung Smart TV Tizen 6.0).
 */

const MAX_ENTRIES = 1500;
const STORAGE_KEY = 'zario_structured_log_v1';

export const LogCategory = Object.freeze({
  BOOT: 'BOOT',
  PHYSICS: 'PHYSICS',
  RAMP: 'RAMP',
  TRICK: 'TRICK',
  TRACK: 'TRACK',
  MODEL: 'MODEL',
  AI: 'AI',
  ITEM: 'ITEM',
  AUDIO: 'AUDIO',
  RENDER: 'RENDER',
  TV_MODE: 'TV_MODE',
  SWITCH_CONTROLLER: 'SWITCH_CONTROLLER',
  INPUT: 'INPUT',
  ERROR: 'ERROR',
});

export const LogLevel = Object.freeze({
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  METRIC: 'METRIC',
});

const CATEGORY_COLORS = {
  BOOT: '#2ec4ff',
  PHYSICS: '#6cff8f',
  RAMP: '#ff9f45',
  TRICK: '#ffd166',
  TRACK: '#a8dadc',
  MODEL: '#c86bff',
  AI: '#90be6d',
  ITEM: '#f94144',
  AUDIO: '#f8961e',
  RENDER: '#4cc9f0',
  TV_MODE: '#ffd166',
  SWITCH_CONTROLLER: '#ff5a5f',
  INPUT: '#adb5bd',
  ERROR: '#ff3b3b',
};

function nowIso() {
  try {
    return new Date().toISOString();
  } catch (_e) {
    return String(Date.now());
  }
}

function perfNowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return Math.round(performance.now() * 100) / 100;
  }
  return Date.now();
}

export class ZarioLogger {
  constructor(options) {
    const opts = options || {};
    this.entries = [];
    this.seq = 0;
    this.sessionStartedAt = nowIso();
    this.consoleEcho = opts.consoleEcho !== undefined ? !!opts.consoleEcho : true;
    this.minLevel = opts.minLevel || LogLevel.DEBUG;
    this.listeners = [];
    this._overlayEl = null;
    this._overlayListEl = null;
    this._overlayStatsEl = null;
    this._overlayVisible = false;
    this._filterCategory = 'ALL';

    this.metrics = {
      rampsEntered: 0,
      rampsLaunched: 0,
      tricksTriggered: 0,
      trickBoostsLanded: 0,
      maxAirTimeSec: 0,
      maxJumpHeightM: 0,
      lastRampLaunchSpeed: 0,
      lastRampLaunchVy: 0,
      lastRampLateralOffset: 0,
      tracksLoaded: [],
      activeTrackId: null,
      activeTrackName: null,
      tvModeActive: false,
      tvDisplayInfo: null,
      tvRemoteKeysCount: 0,
      controllerConnected: false,
      controllerTransport: 'none',
      controllerRoomCode: null,
      controllerPacketsRx: 0,
      controllerLatencyMs: 0,
      controllerGyroEnabled: false,
      modelsBuilt: {
        karts: 0,
        drivers: 0,
        items: 0,
        landmarks: 0,
        glbLoaded: 0,
      },
      frameSpikesCount: 0,
      errorsCount: 0,
    };

    this._bindGlobalAccessors();
  }

  _bindGlobalAccessors() {
    if (typeof window === 'undefined') return;
    window.__zarioLogger = this;
    window.__zarioLogs = this.entries;
    window.exportZarioLogsJSON = () => this.exportJSON();
    window.exportZarioLogsMarkdown = () => this.exportMarkdownReport();
    window.toggleZarioLogOverlay = () => this.toggleOverlay();
  }

  log(category, level, message, data) {
    const cat = LogCategory[category] || category || LogCategory.BOOT;
    const lvl = LogLevel[level] || level || LogLevel.INFO;
    const entry = {
      seq: ++this.seq,
      ts: nowIso(),
      tMs: perfNowMs(),
      category: cat,
      level: lvl,
      message: String(message || ''),
      data: data !== undefined ? data : null,
    };

    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.shift();
    }

    if (lvl === LogLevel.ERROR) {
      this.metrics.errorsCount += 1;
    }

    if (this.consoleEcho && typeof console !== 'undefined') {
      const color = CATEGORY_COLORS[cat] || '#ffffff';
      const prefix = '[ZarioKart][' + cat + '][' + lvl + '] ' + entry.message;
      if (lvl === LogLevel.ERROR && console.error) {
        if (data !== undefined) console.error(prefix, data);
        else console.error(prefix);
      } else if (lvl === LogLevel.WARN && console.warn) {
        if (data !== undefined) console.warn(prefix, data);
        else console.warn(prefix);
      } else if (lvl !== LogLevel.DEBUG && console.log) {
        try {
          if (data !== undefined) {
            console.log('%c' + prefix, 'color:' + color + ';font-weight:bold', data);
          } else {
            console.log('%c' + prefix, 'color:' + color + ';font-weight:bold');
          }
        } catch (_e) {
          console.log(prefix);
        }
      }
    }

    for (let i = 0; i < this.listeners.length; i++) {
      try {
        this.listeners[i](entry);
      } catch (_e) {
        // ignore listener errors
      }
    }

    if (this._overlayVisible) {
      this._appendEntryToOverlay(entry);
      this._refreshOverlayStats();
    }

    return entry;
  }

  debug(category, message, data) {
    return this.log(category, LogLevel.DEBUG, message, data);
  }

  info(category, message, data) {
    return this.log(category, LogLevel.INFO, message, data);
  }

  warn(category, message, data) {
    return this.log(category, LogLevel.WARN, message, data);
  }

  error(category, message, data) {
    return this.log(category, LogLevel.ERROR, message, data);
  }

  metric(category, message, data) {
    return this.log(category, LogLevel.METRIC, message, data);
  }

  // --- Specialized Domain Recorders ---

  recordRampClimb(kartId, rampInfo) {
    this.metrics.rampsEntered += 1;
    return this.debug(LogCategory.RAMP, 'Kart entered ramp surface', {
      kartId: kartId || 'player',
      along: rampInfo && rampInfo.along,
      lateral: rampInfo && rampInfo.lateral,
      climb01: rampInfo && rampInfo.climb,
      rampLift: rampInfo && rampInfo.rampLift,
      speed: rampInfo && rampInfo.speed,
    });
  }

  recordRampLaunch(kartId, launchInfo) {
    this.metrics.rampsLaunched += 1;
    const speed = Number(launchInfo && launchInfo.speed) || 0;
    const vY = Number(launchInfo && launchInfo.vY) || 0;
    const lateral = Number(launchInfo && launchInfo.lateral) || 0;
    this.metrics.lastRampLaunchSpeed = Math.round(speed * 100) / 100;
    this.metrics.lastRampLaunchVy = Math.round(vY * 100) / 100;
    this.metrics.lastRampLateralOffset = Math.round(lateral * 100) / 100;
    return this.info(LogCategory.RAMP, 'Ramp launch triggered', {
      kartId: kartId || 'player',
      speed: this.metrics.lastRampLaunchSpeed,
      vY: this.metrics.lastRampLaunchVy,
      along: launchInfo && launchInfo.along,
      lateral: this.metrics.lastRampLateralOffset,
      boostMs: launchInfo && launchInfo.boostMs,
      rampIndex: launchInfo && launchInfo.rampIndex,
    });
  }

  recordTrick(kartId, trickInfo) {
    if (!trickInfo || trickInfo.phase === 'start' || !trickInfo.phase) {
      this.metrics.tricksTriggered += 1;
      return this.info(LogCategory.TRICK, 'Mid-air Jump Trick performed!', trickInfo);
    }
    if (trickInfo && trickInfo.phase === 'land') {
      this.metrics.trickBoostsLanded += 1;
      const airTime = Number(trickInfo.airTime) || 0;
      const peakHeight = Number(trickInfo.peakHeight) || 0;
      if (airTime > this.metrics.maxAirTimeSec) {
        this.metrics.maxAirTimeSec = Math.round(airTime * 100) / 100;
      }
      if (peakHeight > this.metrics.maxJumpHeightM) {
        this.metrics.maxJumpHeightM = Math.round(peakHeight * 100) / 100;
      }
      return this.info(LogCategory.TRICK, 'Trick landing boost awarded!', trickInfo);
    }
    return this.debug(LogCategory.TRICK, 'Trick event', trickInfo);
  }

  recordAirLanding(kartId, landInfo) {
    const airTime = Number(landInfo && landInfo.airTime) || 0;
    const peakHeight = Number(landInfo && landInfo.peakHeight) || 0;
    if (airTime > this.metrics.maxAirTimeSec) {
      this.metrics.maxAirTimeSec = Math.round(airTime * 100) / 100;
    }
    if (peakHeight > this.metrics.maxJumpHeightM) {
      this.metrics.maxJumpHeightM = Math.round(peakHeight * 100) / 100;
    }
    if (airTime >= 0.18) {
      return this.debug(LogCategory.RAMP, 'Kart landed from jump', {
        kartId: kartId || 'player',
        airTimeSec: Math.round(airTime * 1000) / 1000,
        peakHeightM: Math.round(peakHeight * 100) / 100,
        trickBoost: !!(landInfo && landInfo.trickBoost),
      });
    }
    return null;
  }

  recordTrackLoad(trackSummaryOrId, maybeName, maybeRamps) {
    const summary =
      typeof trackSummaryOrId === 'object' && trackSummaryOrId !== null
        ? trackSummaryOrId
        : { trackId: trackSummaryOrId, name: maybeName, ramps: maybeRamps };
    this.metrics.activeTrackId = summary.trackId || null;
    this.metrics.activeTrackName = summary.name || null;
    this.metrics.tracksLoaded.push({
      ts: nowIso(),
      trackId: summary.trackId,
      name: summary.name,
      lengthM: summary.lengthM,
      ramps: summary.ramps,
      turboPads: summary.turboPads,
      itemBoxes: summary.itemBoxes,
    });
    return this.info(LogCategory.TRACK, 'Track loaded: ' + (summary.name || summary.trackId), summary);
  }

  recordTvMode(tvConfigOrEnabled, maybeReason) {
    const tvConfig =
      typeof tvConfigOrEnabled === 'object' && tvConfigOrEnabled !== null
        ? tvConfigOrEnabled
        : { enabled: !!tvConfigOrEnabled, reason: maybeReason || 'auto' };
    this.metrics.tvModeActive = !!(tvConfig && tvConfig.enabled);
    this.metrics.tvDisplayInfo = tvConfig || null;
    return this.info(
      LogCategory.TV_MODE,
      this.metrics.tvModeActive
        ? 'Samsung Smart TV Mode active (45" 16:9 10-foot UI + Safe Area + Tizen D-Pad)'
        : 'Standard display mode initialized',
      tvConfig
    );
  }

  recordControllerConnect(roomCode, transport) {
    return this.recordControllerEvent('connected', {
      connected: true,
      roomCode: roomCode || 'KART',
      transport: transport || 'LAN-Relay',
    });
  }

  recordControllerPacket(latencyMs) {
    return this.recordControllerEvent('packet', {
      connected: true,
      latencyMs: typeof latencyMs === 'number' ? latencyMs : 0,
    });
  }

  clear() {
    this.entries = [];
    this.seq = 0;
    this.metrics.rampsEntered = 0;
    this.metrics.rampsLaunched = 0;
    this.metrics.tricksTriggered = 0;
    this.metrics.trickBoostsLanded = 0;
    this.metrics.maxAirTimeSec = 0;
    this.metrics.maxJumpHeightM = 0;
    this.metrics.controllerPacketsRx = 0;
    this.metrics.errorsCount = 0;
  }

  exportMarkdown() {
    return this.exportMarkdownReport();
  }

  recordControllerEvent(eventType, details) {
    const info = details || {};
    if (info.connected !== undefined) this.metrics.controllerConnected = !!info.connected;
    if (info.transport) this.metrics.controllerTransport = info.transport;
    if (info.roomCode) this.metrics.controllerRoomCode = info.roomCode;
    if (typeof info.latencyMs === 'number') this.metrics.controllerLatencyMs = Math.round(info.latencyMs);
    if (info.gyro !== undefined) this.metrics.controllerGyroEnabled = !!info.gyro;
    if (eventType === 'packet') {
      this.metrics.controllerPacketsRx += 1;
      if (this.metrics.controllerPacketsRx % 180 === 0) {
        return this.metric(LogCategory.SWITCH_CONTROLLER, 'Controller telemetry heartbeat', {
          packetsRx: this.metrics.controllerPacketsRx,
          latencyMs: this.metrics.controllerLatencyMs,
          gyro: this.metrics.controllerGyroEnabled,
        });
      }
      return null;
    }
    return this.info(LogCategory.SWITCH_CONTROLLER, 'Switch iPhone Controller: ' + eventType, info);
  }

  persistSnapshot() {
    if (typeof localStorage === 'undefined') return false;
    try {
      const payload = {
        sessionStartedAt: this.sessionStartedAt,
        savedAt: nowIso(),
        metrics: this.metrics,
        recentEntries: this.entries.slice(-150),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      return true;
    } catch (_e) {
      return false;
    }
  }

  getSummary() {
    return {
      sessionStartedAt: this.sessionStartedAt,
      totalEntries: this.entries.length,
      metrics: JSON.parse(JSON.stringify(this.metrics)),
      recent: this.entries.slice(-25),
    };
  }

  exportJSON() {
    return JSON.stringify(
      {
        sessionStartedAt: this.sessionStartedAt,
        exportedAt: nowIso(),
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'node',
        viewport:
          typeof window !== 'undefined'
            ? { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 }
            : null,
        metrics: this.metrics,
        entries: this.entries,
      },
      null,
      2
    );
  }

  exportMarkdownReport() {
    const m = this.metrics;
    const lines = [
      '# Zario Kart — Detailed Telemetry & Diagnostic Log',
      '',
      '- **Session Started**: `' + this.sessionStartedAt + '`',
      '- **Exported At**: `' + nowIso() + '`',
      '- **Active Track**: `' + (m.activeTrackName || 'Menu') + ' (ID: ' + (m.activeTrackId || '-') + ')`',
      '- **Samsung TV Mode**: `' + (m.tvModeActive ? 'ENABLED' : 'Standard') + '`',
      '- **iPhone Switch Controller**: `' + (m.controllerConnected ? 'CONNECTED (' + m.controllerTransport + ')' : 'Disconnected') + '`',
      '',
      '## Key Physics, Ramp & Trick Metrics',
      '| Metric | Value |',
      '| :--- | :--- |',
      '| Ramps Climbed | ' + m.rampsEntered + ' |',
      '| Ramp Launches | ' + m.rampsLaunched + ' |',
      '| Mid-Air Tricks Performed | ' + m.tricksTriggered + ' |',
      '| Trick Landing Boosts | ' + m.trickBoostsLanded + ' |',
      '| Max Air Time (s) | ' + m.maxAirTimeSec + 's |',
      '| Max Jump Height (m) | ' + m.maxJumpHeightM + 'm |',
      '| Last Ramp Launch Speed | ' + m.lastRampLaunchSpeed + ' m/s |',
      '| Last Ramp Launch vY | ' + m.lastRampLaunchVy + ' m/s |',
      '| Controller Packets Rx | ' + m.controllerPacketsRx + ' |',
      '| Errors Count | ' + m.errorsCount + ' |',
      '',
      '## Recent Structured Events (Last 50)',
      '```text',
    ];
    const recent = this.entries.slice(-50);
    for (let i = 0; i < recent.length; i++) {
      const e = recent[i];
      const dataStr = e.data ? ' ' + JSON.stringify(e.data) : '';
      lines.push('[' + e.tMs + 'ms] [' + e.category + '/' + e.level + '] ' + e.message + dataStr);
    }
    lines.push('```');
    return lines.join('\n');
  }

  downloadLogFile(format) {
    if (typeof document === 'undefined') return;
    const isMd = format === 'md' || format === 'markdown';
    const content = isMd ? this.exportMarkdownReport() : this.exportJSON();
    const mime = isMd ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8';
    const ext = isMd ? 'md' : 'json';
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'zario-kart-telemetry-' + Date.now() + '.' + ext;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  // --- Interactive In-Game Log & Telemetry Drawer ---

  toggleOverlay(forceState) {
    if (typeof document === 'undefined') return false;
    if (!this._overlayEl) this._buildOverlayDOM();
    this._overlayVisible =
      forceState !== undefined ? !!forceState : !this._overlayVisible;
    this._overlayEl.style.display = this._overlayVisible ? 'flex' : 'none';
    if (this._overlayVisible) {
      this._renderAllOverlayEntries();
      this._refreshOverlayStats();
    }
    return this._overlayVisible;
  }

  _buildOverlayDOM() {
    const root = document.createElement('div');
    root.id = 'zario-telemetry-drawer';
    root.style.cssText = [
      'position:fixed',
      'top:14px',
      'right:14px',
      'width:min(540px, calc(100vw - 28px))',
      'max-height:calc(100vh - 28px)',
      'background:rgba(11,17,34,0.95)',
      'border:2px solid #2ec4ff',
      'border-radius:16px',
      'box-shadow:0 16px 48px rgba(0,0,0,0.65)',
      'color:#e8f1ff',
      'font-family:ui-monospace,SFMono-Regular,Consolas,monospace',
      'font-size:12px',
      'z-index:120000',
      'display:none',
      'flex-direction:column',
      'overflow:hidden',
      'pointer-events:auto',
    ].join(';');

    const header = document.createElement('div');
    header.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#162447;border-bottom:1px solid rgba(46,196,255,0.3);font-weight:800;gap:8px;flex-wrap:wrap;';
    header.innerHTML =
      '<span style="color:#ffd166;font-size:13px">📋 ZARIO KART TELEMETRY & LOGS (F9)</span>' +
      '<div style="display:flex;gap:6px;align-items:center">' +
      '<select class="zlog-filter" style="background:#0b1122;color:#fff;border:1px solid #2ec4ff;border-radius:6px;padding:3px 6px;font-size:11px">' +
      '<option value="ALL">All Categories</option>' +
      '<option value="RAMP">RAMP</option>' +
      '<option value="TRICK">TRICK</option>' +
      '<option value="TRACK">TRACK</option>' +
      '<option value="TV_MODE">TV_MODE</option>' +
      '<option value="SWITCH_CONTROLLER">SWITCH_CONTROLLER</option>' +
      '<option value="MODEL">MODEL</option>' +
      '<option value="PHYSICS">PHYSICS</option>' +
      '<option value="ERROR">ERROR</option>' +
      '</select>' +
      '<button type="button" class="zlog-dl-json" style="background:#2ec4ff;color:#0b1122;border:none;border-radius:6px;padding:4px 8px;font-weight:800;cursor:pointer;font-size:11px">JSON</button>' +
      '<button type="button" class="zlog-dl-md" style="background:#6cff8f;color:#0b1122;border:none;border-radius:6px;padding:4px 8px;font-weight:800;cursor:pointer;font-size:11px">MD</button>' +
      '<button type="button" class="zlog-close" style="background:#ff5a5f;color:#fff;border:none;border-radius:6px;padding:4px 8px;font-weight:800;cursor:pointer;font-size:11px">✕</button>' +
      '</div>';

    const stats = document.createElement('div');
    stats.style.cssText =
      'padding:8px 14px;background:rgba(22,36,71,0.55);border-bottom:1px solid rgba(255,255,255,0.12);display:grid;grid-template-columns:repeat(3,1fr);gap:6px;font-size:11px;';

    const list = document.createElement('div');
    list.style.cssText =
      'padding:10px 14px;overflow-y:auto;max-height:360px;display:flex;flex-direction:column;gap:4px;line-height:1.45;';

    root.appendChild(header);
    root.appendChild(stats);
    root.appendChild(list);
    document.body.appendChild(root);

    this._overlayEl = root;
    this._overlayStatsEl = stats;
    this._overlayListEl = list;

    const filterSel = header.querySelector('.zlog-filter');
    filterSel.addEventListener('change', () => {
      this._filterCategory = filterSel.value;
      this._renderAllOverlayEntries();
    });
    header.querySelector('.zlog-dl-json').addEventListener('click', () => {
      this.downloadLogFile('json');
    });
    header.querySelector('.zlog-dl-md').addEventListener('click', () => {
      this.downloadLogFile('md');
    });
    header.querySelector('.zlog-close').addEventListener('click', () => {
      this.toggleOverlay(false);
    });
  }

  _refreshOverlayStats() {
    if (!this._overlayStatsEl) return;
    const m = this.metrics;
    this._overlayStatsEl.innerHTML =
      '<div>🚀 <b>Launches:</b> ' + m.rampsLaunched + ' (Climb: ' + m.rampsEntered + ')</div>' +
      '<div>✨ <b>Tricks:</b> ' + m.tricksTriggered + ' (Landed: ' + m.trickBoostsLanded + ')</div>' +
      '<div>🦅 <b>Max Air:</b> ' + m.maxAirTimeSec + 's / ' + m.maxJumpHeightM + 'm</div>' +
      '<div>🗺️ <b>Track:</b> ' + (m.activeTrackName || 'Menu') + '</div>' +
      '<div>📺 <b>TV Mode:</b> ' + (m.tvModeActive ? 'ON' : 'OFF') + '</div>' +
      '<div>📱 <b>iPhone Pad:</b> ' + (m.controllerConnected ? 'ONLINE (' + m.controllerLatencyMs + 'ms)' : 'Waiting') + '</div>';
  }

  _renderAllOverlayEntries() {
    if (!this._overlayListEl) return;
    this._overlayListEl.innerHTML = '';
    const slice = this.entries.slice(-120);
    for (let i = 0; i < slice.length; i++) {
      this._appendEntryToOverlay(slice[i]);
    }
  }

  _appendEntryToOverlay(entry) {
    if (!this._overlayListEl) return;
    if (this._filterCategory !== 'ALL' && entry.category !== this._filterCategory) return;
    const row = document.createElement('div');
    const col = CATEGORY_COLORS[entry.category] || '#e8f1ff';
    row.style.cssText = 'border-bottom:1px solid rgba(255,255,255,0.06);padding-bottom:3px;word-break:break-word;';
    const detail = entry.data ? ' <span style="color:#98b2d4">' + JSON.stringify(entry.data) + '</span>' : '';
    row.innerHTML =
      '<span style="color:#6c82a3">[' + entry.tMs + 'ms]</span> ' +
      '<span style="color:' + col + ';font-weight:700">[' + entry.category + ']</span> ' +
      '<span>' + entry.message + '</span>' +
      detail;
    this._overlayListEl.appendChild(row);
    while (this._overlayListEl.children.length > 120) {
      this._overlayListEl.removeChild(this._overlayListEl.firstChild);
    }
    this._overlayListEl.scrollTop = this._overlayListEl.scrollHeight;
  }
}

export const zarioLogger = new ZarioLogger();
