window.CNCApp = window.CNCApp || {};

CNCApp.SimulatorDriver = {
  id: 'simulator',
  label: '🧪 Симулатор (Тест)',
  connected: false,
  status: 'DISCONNECTED', // DISCONNECTED | IDLE | RUNNING | HOLD | ESTOP
  speedMultiplier: 1,
  lastError: null,
  coords: {
    x: 0,
    y: 0,
    feedrate: 0,
    lineNum: 0,
    totalLines: 0,
    activeDispenserId: 1,
    loweredDispensers: [],
    valveOpen: false
  },

  _timer: null,
  _pulseTimer: null,
  _steps: [],
  _stepIndex: 0,
  _stepElapsedMs: 0,
  _stepDurationMs: 0,
  _segStartX: 0,
  _segStartY: 0,
  _segTargetX: 0,
  _segTargetY: 0,
  _lastTickMs: 0,

  setSpeedMultiplier: function(mult) {
    var m = parseInt(mult, 10);
    if (m === 1 || m === 5 || m === 15) {
      this.speedMultiplier = m;
    }
  },

  _addLowered: function(dispId) {
    var id = parseInt(dispId, 10);
    if (!id) return;
    if (!Array.isArray(this.coords.loweredDispensers)) {
      this.coords.loweredDispensers = [];
    }
    if (this.coords.loweredDispensers.indexOf(id) === -1) {
      this.coords.loweredDispensers.push(id);
      this.coords.loweredDispensers.sort(function(a, b) { return a - b; });
    }
    this.coords.activeDispenserId = id;
  },

  _removeLowered: function(dispId) {
    var id = parseInt(dispId, 10);
    if (!id || !Array.isArray(this.coords.loweredDispensers)) return;
    var out = [];
    for (var i = 0; i < this.coords.loweredDispensers.length; i++) {
      if (this.coords.loweredDispensers[i] !== id) {
        out.push(this.coords.loweredDispensers[i]);
      }
    }
    this.coords.loweredDispensers = out;
  },

  _clearLowered: function() {
    this.coords.loweredDispensers = [];
  },

  _hasLowered: function() {
    return Array.isArray(this.coords.loweredDispensers) && this.coords.loweredDispensers.length > 0;
  },

  _getLimits: function() {
    var m = (CNCApp.State && CNCApp.State.machine) ? CNCApp.State.machine : {};
    return {
      minX: (typeof m.minX === 'number' && !isNaN(m.minX)) ? m.minX : -5,
      maxX: (typeof m.maxX === 'number' && !isNaN(m.maxX)) ? m.maxX : 350,
      minY: (typeof m.minY === 'number' && !isNaN(m.minY)) ? m.minY : -5,
      maxY: (typeof m.maxY === 'number' && !isNaN(m.maxY)) ? m.maxY : 300
    };
  },

  _validateBounds: function(x, y) {
    var lim = this._getLimits();
    if (x < lim.minX || x > lim.maxX) {
      return 'Координатата X=' + x.toFixed(3) + 'mm е надвор од лимитите на машината [' + lim.minX + ' .. ' + lim.maxX + ' mm].';
    }
    if (y < lim.minY || y > lim.maxY) {
      return 'Координатата Y=' + y.toFixed(3) + 'mm е надвор од лимитите на машината [' + lim.minY + ' .. ' + lim.maxY + ' mm].';
    }
    return null;
  },

  _copyCoords: function() {
    return {
      x: parseFloat((this.coords.x || 0).toFixed(3)),
      y: parseFloat((this.coords.y || 0).toFixed(3)),
      feedrate: Math.round(this.coords.feedrate || 0),
      lineNum: this.coords.lineNum || 0,
      totalLines: this.coords.totalLines || 0,
      activeDispenserId: this.coords.activeDispenserId || 1,
      loweredDispensers: Array.isArray(this.coords.loweredDispensers) ? this.coords.loweredDispensers.slice() : [],
      valveOpen: !!this.coords.valveOpen
    };
  },

  connect: function(cb) {
    this.connected = true;
    this.lastError = null;
    if (this.status === 'DISCONNECTED') {
      this.status = 'IDLE';
    }
    if (typeof cb === 'function') cb(null, this.getSnapshot());
  },

  disconnect: function(cb) {
    this._stopLoop();
    if (this._pulseTimer) {
      clearTimeout(this._pulseTimer);
      this._pulseTimer = null;
    }
    this.connected = false;
    this.status = 'DISCONNECTED';
    this.coords.feedrate = 0;
    this.coords.valveOpen = false;
    this._clearLowered();
    this._steps = [];
    this._stepIndex = 0;
    this.lastError = null;
    if (typeof cb === 'function') cb(null, this.getSnapshot());
  },

  getSnapshot: function() {
    return {
      driverId: this.id,
      connected: this.connected,
      status: this.status,
      coords: this._copyCoords(),
      lastError: this.lastError
    };
  },

  getStatus: function(cb) {
    if (typeof cb === 'function') cb(null, this.getSnapshot());
  },

  _buildStepsFromGcode: function(gcodeText, meta) {
    var lines = String(gcodeText || '').split(/\r?\n/);
    var m = (meta && meta.machine) ? meta.machine : CNCApp.State.machine;
    var timeUnit = (m && m.timeUnit) ? m.timeUnit : 'ms';
    var mLatencyMs = (m && m.mCommandLatency) ? parseInt(m.mCommandLatency, 10) : 120;
    var valveOpenCmd = (m && m.valveOpenCmd) ? String(m.valveOpenCmd).toUpperCase().trim() : 'M103';
    var valveCloseCmd = (m && m.valveCloseCmd) ? String(m.valveCloseCmd).toUpperCase().trim() : 'M203';
    var dispensers = (m && Array.isArray(m.dispensers)) ? m.dispensers : [];

    var curFeed = 1000;
    var steps = [];

    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i].trim();
      if (!raw) continue;
      var codeOnly = raw.split(';')[0].trim();
      if (!codeOnly) continue;
      var upper = codeOnly.toUpperCase();

      // G28.1 двофазно хомирање: брзо до X2 Y2, па бавно до (0,0) и ресет на апсолутна нула
      if (/\bG28\.1\b/.test(upper)) {
        var hxMatch = upper.match(/X\s*([+-]?\d+(?:[.,]\d+)?)/);
        var hyMatch = upper.match(/Y\s*([+-]?\d+(?:[.,]\d+)?)/);
        var approachX = hxMatch ? parseFloat(hxMatch[1].replace(',', '.')) : 2;
        var approachY = hyMatch ? parseFloat(hyMatch[1].replace(',', '.')) : 2;
        steps.push({
          type: 'MOVE',
          lineNum: i + 1,
          x: approachX,
          y: approachY,
          feedrate: 3000,
          raw: raw
        });
        steps.push({
          type: 'MOVE',
          lineNum: i + 1,
          x: 0,
          y: 0,
          feedrate: 400,
          resetZeroAfter: true,
          raw: raw
        });
        continue;
      }

      // G1 / G0 движење (X/Y)
      if (/\bG(?:0|1|00|01)\b/.test(upper) || (/[XY]\s*[+-]?\d/.test(upper) && !/\bG4\b/.test(upper))) {
        var mx = upper.match(/X\s*([+-]?\d+(?:[.,]\d+)?)/);
        var my = upper.match(/Y\s*([+-]?\d+(?:[.,]\d+)?)/);
        var mf = upper.match(/F\s*(\d+(?:[.,]\d+)?)/);
        if (mf) {
          var parsedF = parseFloat(mf[1].replace(',', '.'));
          if (!isNaN(parsedF) && parsedF > 0) curFeed = parsedF;
        }
        steps.push({
          type: 'MOVE',
          lineNum: i + 1,
          x: mx ? parseFloat(mx[1].replace(',', '.')) : null,
          y: my ? parseFloat(my[1].replace(',', '.')) : null,
          feedrate: curFeed,
          raw: raw
        });
        continue;
      }

      // G4 пауза
      if (/\bG4\b/.test(upper)) {
        var mp = upper.match(/P\s*(\d+(?:[.,]\d+)?)/);
        var pVal = mp ? parseFloat(mp[1].replace(',', '.')) : 0;
        var dwellMs = (timeUnit === 's') ? (pVal * 1000) : pVal;
        if (isNaN(dwellMs) || dwellMs < 20) dwellMs = 20;
        steps.push({
          type: 'DWELL',
          lineNum: i + 1,
          durationMs: dwellMs,
          raw: raw
        });
        continue;
      }

      // Вентил M-команди
      if (upper === valveOpenCmd || upper.indexOf(valveOpenCmd + ' ') === 0) {
        steps.push({
          type: 'CMD',
          lineNum: i + 1,
          durationMs: mLatencyMs,
          action: 'VALVE_OPEN',
          raw: raw
        });
        continue;
      }

      if (upper === valveCloseCmd || upper.indexOf(valveCloseCmd + ' ') === 0) {
        steps.push({
          type: 'CMD',
          lineNum: i + 1,
          durationMs: mLatencyMs,
          action: 'VALVE_CLOSE',
          raw: raw
        });
        continue;
      }

      // Диспензер M-команди (Спушти / Крени)
      var matchedDisp = false;
      for (var dIdx = 0; dIdx < dispensers.length; dIdx++) {
        var d = dispensers[dIdx];
        var lCmd = String(d.lowerCmd || '').toUpperCase().trim();
        var rCmd = String(d.raiseCmd || '').toUpperCase().trim();
        if (lCmd && (upper === lCmd || upper.indexOf(lCmd + ' ') === 0)) {
          steps.push({
            type: 'CMD',
            lineNum: i + 1,
            durationMs: mLatencyMs,
            action: 'DISP_LOWER',
            dispenserId: d.id,
            raw: raw
          });
          matchedDisp = true;
          break;
        }
        if (rCmd && (upper === rCmd || upper.indexOf(rCmd + ' ') === 0)) {
          steps.push({
            type: 'CMD',
            lineNum: i + 1,
            durationMs: mLatencyMs,
            action: 'DISP_RAISE',
            dispenserId: d.id,
            raw: raw
          });
          matchedDisp = true;
          break;
        }
      }
      if (matchedDisp) continue;

      if (/\bM5\b/.test(upper)) {
        steps.push({
          type: 'CMD',
          lineNum: i + 1,
          durationMs: 40,
          action: 'STOP_SPINDLE',
          raw: raw
        });
      }
    }

    return { steps: steps, totalLines: lines.length };
  },

  loadAndRun: function(gcodeText, meta, cb) {
    if (!this.connected) {
      if (typeof cb === 'function') cb(new Error('Симулаторот не е поврзан.'));
      return;
    }
    if (this.status === 'RUNNING' || this.status === 'HOLD') {
      if (typeof cb === 'function') cb(new Error('Машината веќе извршува програма или се движи.'));
      return;
    }
    if (this.status === 'ESTOP') {
      if (typeof cb === 'function') cb(new Error('Машината е во СТОП/Reset состојба. Притиснете Reset прво.'));
      return;
    }

    var built = this._buildStepsFromGcode(gcodeText, meta);
    if (built.steps.length === 0) {
      if (typeof cb === 'function') cb(new Error('Генерираниот G-код нема активни команди за извршување.'));
      return;
    }

    this._stopLoop();
    this._steps = built.steps;
    this._stepIndex = -1;
    this._stepElapsedMs = 0;
    this._stepDurationMs = 0;
    this.coords.lineNum = 0;
    this.coords.totalLines = built.totalLines;
    this.status = 'RUNNING';
    this.lastError = null;

    this._advanceToStep(0);
    this._startLoop();

    if (typeof cb === 'function') cb(null, this.getSnapshot());
  },

  moveTo: function(targetX, targetY, feedrate, cb) {
    if (!this.connected || this.status !== 'IDLE') {
      if (typeof cb === 'function') cb(new Error('Движењето е дозволено само кога машината е СПРЕМНА (IDLE).'));
      return;
    }
    if (this._hasLowered() || this.coords.valveOpen) {
      if (typeof cb === 'function') cb(new Error('⛔ Безбедносна блокада: подигнете ги сите диспензери и затворете го вентилот пред движење!'));
      return;
    }

    var tx = parseFloat(targetX);
    var ty = parseFloat(targetY);
    if (isNaN(tx) || isNaN(ty)) {
      if (typeof cb === 'function') cb(new Error('Невалидни целни координати.'));
      return;
    }
    var errLim = this._validateBounds(tx, ty);
    if (errLim) {
      if (typeof cb === 'function') cb(new Error('⛔ ' + errLim));
      return;
    }

    var feed = Math.round(parseFloat(feedrate) || 3000);
    this._stopLoop();
    this._steps = [{
      type: 'MOVE',
      lineNum: 1,
      x: tx,
      y: ty,
      feedrate: feed,
      raw: 'G90 G1 X' + tx.toFixed(3) + ' Y' + ty.toFixed(3) + ' F' + feed
    }];
    this._stepIndex = -1;
    this._stepElapsedMs = 0;
    this._stepDurationMs = 0;
    this.coords.lineNum = 0;
    this.coords.totalLines = 1;
    this.status = 'RUNNING';
    this.lastError = null;

    this._advanceToStep(0);
    this._startLoop();
    if (typeof cb === 'function') cb(null, this.getSnapshot());
  },

  runQuickCommand: function(cmdStr, cb) {
    if (!this.connected || this.status !== 'IDLE') {
      if (typeof cb === 'function') cb(new Error('Брзите команди се дозволени само кога машината е СПРЕМНА (IDLE).'));
      return;
    }
    if (this._hasLowered() || this.coords.valveOpen) {
      if (typeof cb === 'function') cb(new Error('⛔ Безбедносна блокада: прво подигнете ги сите диспензери и затворете го вентилот!'));
      return;
    }

    var built = this._buildStepsFromGcode(String(cmdStr || ''), { machine: CNCApp.State.machine });
    if (built.steps.length === 0) {
      if (typeof cb === 'function') cb(new Error('Непозната брза команда: ' + cmdStr));
      return;
    }

    for (var i = 0; i < built.steps.length; i++) {
      var st = built.steps[i];
      if (st.type === 'MOVE' && !st.resetZeroAfter) {
        var chkX = (st.x !== null) ? st.x : this.coords.x;
        var chkY = (st.y !== null) ? st.y : this.coords.y;
        var bErr = this._validateBounds(chkX, chkY);
        if (bErr) {
          if (typeof cb === 'function') cb(new Error('⛔ ' + bErr));
          return;
        }
      }
    }

    this._stopLoop();
    this._steps = built.steps;
    this._stepIndex = -1;
    this._stepElapsedMs = 0;
    this._stepDurationMs = 0;
    this.coords.lineNum = 0;
    this.coords.totalLines = built.totalLines;
    this.status = 'RUNNING';
    this.lastError = null;

    this._advanceToStep(0);
    this._startLoop();
    if (typeof cb === 'function') cb(null, this.getSnapshot());
  },

  _advanceToStep: function(idx) {
    if (idx >= this._steps.length) {
      this._finishJob();
      return false;
    }
    this._stepIndex = idx;
    this._stepElapsedMs = 0;
    var step = this._steps[idx];
    this.coords.lineNum = step.lineNum;

    if (step.type === 'MOVE') {
      this._segStartX = this.coords.x;
      this._segStartY = this.coords.y;
      this._segTargetX = (step.x !== null) ? step.x : this.coords.x;
      this._segTargetY = (step.y !== null) ? step.y : this.coords.y;
      this.coords.feedrate = step.feedrate || 1000;

      var dx = this._segTargetX - this._segStartX;
      var dy = this._segTargetY - this._segStartY;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var feedMmPerSec = (this.coords.feedrate || 1000) / 60;
      var moveMs = (feedMmPerSec > 0) ? ((dist / feedMmPerSec) * 1000) : 20;
      if (dist > 0.01) moveMs += 60;
      this._stepDurationMs = Math.max(20, moveMs);
    } else if (step.type === 'DWELL') {
      this.coords.feedrate = 0;
      this._stepDurationMs = Math.max(20, step.durationMs || 50);
    } else if (step.type === 'CMD') {
      this.coords.feedrate = 0;
      this._stepDurationMs = Math.max(20, step.durationMs || 80);
      if (step.action === 'VALVE_OPEN') {
        this.coords.valveOpen = true;
      } else if (step.action === 'VALVE_CLOSE') {
        this.coords.valveOpen = false;
      } else if (step.action === 'DISP_LOWER') {
        this._addLowered(step.dispenserId || 1);
      } else if (step.action === 'DISP_RAISE') {
        this._removeLowered(step.dispenserId || 1);
      } else if (step.action === 'STOP_SPINDLE') {
        this.coords.valveOpen = false;
        this._clearLowered();
      }
    }
    return true;
  },

  _finishJob: function() {
    this._stopLoop();
    this.status = 'IDLE';
    this.coords.feedrate = 0;
    this.coords.valveOpen = false;
    this._clearLowered();
    this._steps = [];
    this._stepIndex = 0;
  },

  _startLoop: function() {
    var self = this;
    this._lastTickMs = Date.now();
    this._timer = setInterval(function() {
      self._tick();
    }, 50);
  },

  _stopLoop: function() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  },

  _tick: function() {
    var now = Date.now();
    var rawDt = now - (this._lastTickMs || now);
    this._lastTickMs = now;
    if (this.status !== 'RUNNING') return;
    if (rawDt <= 0) rawDt = 50;
    if (rawDt > 250) rawDt = 250;

    var remainingDt = rawDt * (this.speedMultiplier || 1);

    while (remainingDt > 0 && this.status === 'RUNNING') {
      var step = this._steps[this._stepIndex];
      if (!step) {
        this._finishJob();
        break;
      }
      var needed = this._stepDurationMs - this._stepElapsedMs;
      if (remainingDt >= needed) {
        if (step.type === 'MOVE') {
          if (step.resetZeroAfter) {
            this.coords.x = 0;
            this.coords.y = 0;
          } else {
            this.coords.x = this._segTargetX;
            this.coords.y = this._segTargetY;
          }
        }
        remainingDt -= needed;
        if (!this._advanceToStep(this._stepIndex + 1)) {
          break;
        }
      } else {
        this._stepElapsedMs += remainingDt;
        if (step.type === 'MOVE' && this._stepDurationMs > 0) {
          var t = this._stepElapsedMs / this._stepDurationMs;
          this.coords.x = this._segStartX + (this._segTargetX - this._segStartX) * t;
          this.coords.y = this._segStartY + (this._segTargetY - this._segStartY) * t;
        }
        remainingDt = 0;
      }
    }
  },

  pause: function(cb) {
    if (this.status === 'RUNNING') {
      this.status = 'HOLD';
      this.coords.feedrate = 0;
    }
    if (typeof cb === 'function') cb(null, this.getSnapshot());
  },

  resume: function(cb) {
    if (this.status === 'HOLD') {
      this._lastTickMs = Date.now();
      this.status = 'RUNNING';
    }
    if (typeof cb === 'function') cb(null, this.getSnapshot());
  },

  stop: function(cb) {
    this._stopLoop();
    if (this._pulseTimer) {
      clearTimeout(this._pulseTimer);
      this._pulseTimer = null;
    }
    this.status = 'ESTOP';
    this.coords.feedrate = 0;
    this.coords.valveOpen = false;
    this._clearLowered();
    this._steps = [];
    this._stepIndex = 0;
    if (typeof cb === 'function') cb(null, this.getSnapshot());
  },

  reset: function(cb) {
    if (!this.connected) {
      if (typeof cb === 'function') cb(new Error('Симулаторот не е поврзан.'));
      return;
    }
    this._stopLoop();
    if (this._pulseTimer) {
      clearTimeout(this._pulseTimer);
      this._pulseTimer = null;
    }
    this.status = 'IDLE';
    this.coords.feedrate = 0;
    this.coords.valveOpen = false;
    this._clearLowered();
    this.coords.lineNum = 0;
    this.coords.totalLines = 0;
    this.lastError = null;
    if (typeof cb === 'function') cb(null, this.getSnapshot());
  },

  jog: function(axis, stepMm, cb) {
    if (!this.connected || this.status !== 'IDLE') {
      if (typeof cb === 'function') cb(new Error('Jog е дозволен само кога машината е СПРЕМНА (IDLE).'));
      return;
    }
    if (axis !== 'X' && axis !== 'Y') {
      if (typeof cb === 'function') cb(new Error('Неподдржана оска (само X и Y).'));
      return;
    }
    var delta = parseFloat(stepMm) || 0;
    var nextX = (axis === 'X') ? parseFloat((this.coords.x + delta).toFixed(3)) : this.coords.x;
    var nextY = (axis === 'Y') ? parseFloat((this.coords.y + delta).toFixed(3)) : this.coords.y;
    var bErr = this._validateBounds(nextX, nextY);
    if (bErr) {
      this.lastError = bErr;
      if (typeof cb === 'function') cb(new Error('⛔ ' + bErr));
      return;
    }

    this.lastError = null;
    this.coords.x = nextX;
    this.coords.y = nextY;
    if (typeof cb === 'function') cb(null, this.getSnapshot());
  },

  zeroAxis: function(axis, cb) {
    if (!this.connected || this.status !== 'IDLE') {
      if (typeof cb === 'function') cb(new Error('Zero е дозволено само кога машината е СПРЕМНА (IDLE).'));
      return;
    }
    if (axis === 'X' || axis === 'XY' || axis === 'ALL') this.coords.x = 0;
    if (axis === 'Y' || axis === 'XY' || axis === 'ALL') this.coords.y = 0;
    this.lastError = null;
    if (typeof cb === 'function') cb(null, this.getSnapshot());
  },

  sendCommand: function(cmdStr, cb) {
    if (!this.connected || this.status !== 'IDLE') {
      if (typeof cb === 'function') cb(new Error('Рачна команда е дозволена само во IDLE режим.'));
      return;
    }
    var upper = String(cmdStr || '').toUpperCase().trim();
    var m = CNCApp.State.machine;
    var valveOpenCmd = String(m.valveOpenCmd || 'M103').toUpperCase().trim();
    var valveCloseCmd = String(m.valveCloseCmd || 'M203').toUpperCase().trim();

    if (upper === valveOpenCmd) {
      this.coords.valveOpen = true;
    } else if (upper === valveCloseCmd) {
      this.coords.valveOpen = false;
    } else if (upper === 'RAISE_ALL') {
      this._clearLowered();
    } else if (upper.indexOf('PULSE:') === 0) {
      var parts = upper.split(':');
      var pulseMs = parseInt(parts[parts.length - 1], 10) || 100;
      var self = this;
      if (this._pulseTimer) clearTimeout(this._pulseTimer);
      this.coords.valveOpen = true;
      this._pulseTimer = setTimeout(function() {
        self.coords.valveOpen = false;
        self._pulseTimer = null;
      }, pulseMs);
    } else {
      for (var i = 0; i < m.dispensers.length; i++) {
        var d = m.dispensers[i];
        if (upper === String(d.lowerCmd || '').toUpperCase().trim()) {
          this._addLowered(d.id);
          break;
        }
        if (upper === String(d.raiseCmd || '').toUpperCase().trim()) {
          this._removeLowered(d.id);
          break;
        }
      }
    }

    this.lastError = null;
    if (typeof cb === 'function') cb(null, this.getSnapshot());
  },

  raiseAllDispensers: function(dispensers, cb) {
    if (!this.connected || this.status !== 'IDLE') {
      if (typeof cb === 'function') cb(new Error('Подигање е дозволено само во IDLE режим.'));
      return;
    }
    this._clearLowered();
    this.lastError = null;
    if (typeof cb === 'function') cb(null, this.getSnapshot());
  }
};
