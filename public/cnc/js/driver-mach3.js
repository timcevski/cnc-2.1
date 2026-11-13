window.CNCApp = window.CNCApp || {};

CNCApp.Mach3BridgeDriver = {
  id: 'mach3',
  label: '🔌 Mach3 Bridge (127.0.0.1:8765)',
  baseUrl: 'http://127.0.0.1:8765',
  connected: false,
  status: 'DISCONNECTED',
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

  _addLowered: function(dispId) {
    var id = parseInt(dispId, 10);
    if (!id) return;
    if (!Array.isArray(this.coords.loweredDispensers)) this.coords.loweredDispensers = [];
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
      if (this.coords.loweredDispensers[i] !== id) out.push(this.coords.loweredDispensers[i]);
    }
    this.coords.loweredDispensers = out;
  },

  _request: function(method, path, bodyObj, cb) {
    var xhr = new XMLHttpRequest();
    var self = this;
    var done = false;

    function finish(err, data) {
      if (done) return;
      done = true;
      if (typeof cb === 'function') cb(err, data);
    }

    try {
      xhr.open(method, this.baseUrl + path, true);
      xhr.timeout = (String(method).toUpperCase() === 'GET' && path === '/status') ? 1800 : 6000;
      if (bodyObj !== null && bodyObj !== undefined) {
        xhr.setRequestHeader('Content-Type', 'application/json');
      }

      xhr.onreadystatechange = function() {
        if (xhr.readyState !== 4) return;
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            var parsed = xhr.responseText ? JSON.parse(xhr.responseText) : {};
            self.lastError = parsed.error || null;
            finish(null, parsed);
          } catch (e) {
            finish(new Error('Невалиден одговор од Mach3Bridge.exe'));
          }
        } else {
          var errMsg = 'Нема врска со Mach3Bridge.exe (' + self.baseUrl + '). Проверете дали е стартуван или користете Симулатор.';
          if (xhr.responseText) {
            try {
              var errJson = JSON.parse(xhr.responseText);
              if (errJson && errJson.error) errMsg = errJson.error;
            } catch (e2) {}
          }
          self.lastError = errMsg;
          finish(new Error(errMsg));
        }
      };

      xhr.ontimeout = function() {
        var msg = 'Mach3Bridge.exe не одговори навреме (' + self.baseUrl + ').';
        self.lastError = msg;
        finish(new Error(msg));
      };

      xhr.onerror = function() {
        var msg = 'Нема врска со Mach3Bridge.exe (' + self.baseUrl + '). Проверете дали е стартуван или изберете Симулатор.';
        self.lastError = msg;
        finish(new Error(msg));
      };

      if (bodyObj !== null && bodyObj !== undefined) {
        xhr.send(JSON.stringify(bodyObj));
      } else {
        xhr.send();
      }
    } catch (ex) {
      var msg = 'Грешка при комуникација со Mach3 Bridge: ' + ex.message;
      self.lastError = msg;
      finish(new Error(msg));
    }
  },

  _applyRemoteSnapshot: function(data) {
    if (!data) return this.getSnapshot();
    var st = String(data.status || 'IDLE').toUpperCase();
    if (st !== 'IDLE' && st !== 'RUNNING' && st !== 'HOLD' && st !== 'ESTOP' && st !== 'DISCONNECTED') {
      st = 'IDLE';
    }
    if (data.mach3Connected === false) {
      this.lastError = data.error || 'Mach3Bridge.exe работи, но Mach3 не е стартуван на овој компјутер.';
    }
    this.status = st;
    this.coords.x = parseFloat(data.x) || 0;
    this.coords.y = parseFloat(data.y) || 0;
    this.coords.feedrate = parseFloat(data.feedrate) || 0;
    this.coords.lineNum = parseInt(data.lineNum, 10) || 0;
    this.coords.totalLines = parseInt(data.totalLines, 10) || 0;
    if (typeof data.valveOpen === 'boolean') {
      this.coords.valveOpen = data.valveOpen;
    }
    if (Array.isArray(data.loweredDispensers)) {
      this.coords.loweredDispensers = data.loweredDispensers.slice();
    }
    if (data.activeDispenserId) {
      this.coords.activeDispenserId = parseInt(data.activeDispenserId, 10) || 1;
    }
    return this.getSnapshot();
  },

  getSnapshot: function() {
    return {
      driverId: this.id,
      connected: this.connected,
      status: this.connected ? this.status : 'DISCONNECTED',
      coords: {
        x: parseFloat((this.coords.x || 0).toFixed(3)),
        y: parseFloat((this.coords.y || 0).toFixed(3)),
        feedrate: Math.round(this.coords.feedrate || 0),
        lineNum: this.coords.lineNum || 0,
        totalLines: this.coords.totalLines || 0,
        activeDispenserId: this.coords.activeDispenserId || 1,
        loweredDispensers: Array.isArray(this.coords.loweredDispensers) ? this.coords.loweredDispensers.slice() : [],
        valveOpen: !!this.coords.valveOpen
      },
      lastError: this.lastError
    };
  },

  _buildConfigPayload: function(machineObj) {
    var m = machineObj || (CNCApp.State ? CNCApp.State.machine : {}) || {};
    var list = Array.isArray(m.dispensers) ? m.dispensers : [];
    var outDisp = [];
    for (var i = 0; i < list.length; i++) {
      outDisp.push({
        id: list[i].id,
        lowerCmd: list[i].lowerCmd || ('M' + (103 + list[i].id)),
        raiseCmd: list[i].raiseCmd || ('M' + (203 + list[i].id))
      });
    }
    return {
      valveOpenCmd: m.valveOpenCmd || 'M103',
      valveCloseCmd: m.valveCloseCmd || 'M203',
      dispensers: outDisp
    };
  },

  syncConfig: function(cb) {
    var payload = this._buildConfigPayload();
    this._request('POST', '/config', payload, function(err, data) {
      if (typeof cb === 'function') cb(err, data);
    });
  },

  connect: function(cb) {
    var self = this;
    this._request('GET', '/status', null, function(err, data) {
      if (err) {
        self.connected = false;
        self.status = 'DISCONNECTED';
        if (typeof cb === 'function') cb(err, self.getSnapshot());
        return;
      }
      self.connected = true;
      var snap = self._applyRemoteSnapshot(data);
      self.syncConfig();
      if (CNCApp.Storage) {
        if (typeof CNCApp.Storage.syncOrRecoverBridgeTemp === 'function') {
          CNCApp.Storage.syncOrRecoverBridgeTemp();
        } else if (typeof CNCApp.Storage.saveToBridgeTemp === 'function') {
          CNCApp.Storage.saveToBridgeTemp();
        }
      }
      if (typeof cb === 'function') cb(null, snap);
    });
  },

  disconnect: function(cb) {
    this.connected = false;
    this.status = 'DISCONNECTED';
    this.coords.loweredDispensers = [];
    this.coords.valveOpen = false;
    this.lastError = null;
    if (typeof cb === 'function') cb(null, this.getSnapshot());
  },

  getStatus: function(cb) {
    if (!this.connected) {
      if (typeof cb === 'function') cb(null, this.getSnapshot());
      return;
    }
    var self = this;
    this._request('GET', '/status', null, function(err, data) {
      if (err) {
        if (typeof cb === 'function') cb(err, self.getSnapshot());
        return;
      }
      var snap = self._applyRemoteSnapshot(data);
      if (typeof cb === 'function') cb(null, snap);
    });
  },

  loadAndRun: function(gcodeText, meta, cb) {
    if (!this.connected) {
      if (typeof cb === 'function') cb(new Error('Mach3 Bridge не е поврзан.'));
      return;
    }
    var self = this;
    var cfg = this._buildConfigPayload(meta && meta.machine ? meta.machine : null);
    var payload = {
      gcode: gcodeText,
      filename: (meta && meta.projectName) ? meta.projectName : 'active_job.tap',
      valveOpenCmd: cfg.valveOpenCmd,
      valveCloseCmd: cfg.valveCloseCmd,
      dispensers: cfg.dispensers
    };
    this._request('POST', '/load_and_run', payload, function(err, data) {
      if (err) {
        if (typeof cb === 'function') cb(err);
        return;
      }
      var snap = self._applyRemoteSnapshot(data);
      if (typeof cb === 'function') cb(null, snap);
    });
  },

  pause: function(cb) {
    var self = this;
    this._request('POST', '/pause', {}, function(err, data) {
      if (err) { if (typeof cb === 'function') cb(err); return; }
      if (typeof cb === 'function') cb(null, self._applyRemoteSnapshot(data));
    });
  },

  resume: function(cb) {
    var self = this;
    this._request('POST', '/resume', {}, function(err, data) {
      if (err) { if (typeof cb === 'function') cb(err); return; }
      if (typeof cb === 'function') cb(null, self._applyRemoteSnapshot(data));
    });
  },

  stop: function(cb) {
    var self = this;
    this._request('POST', '/stop', {}, function(err, data) {
      if (err) { if (typeof cb === 'function') cb(err); return; }
      self.coords.loweredDispensers = [];
      self.coords.valveOpen = false;
      if (typeof cb === 'function') cb(null, self._applyRemoteSnapshot(data));
    });
  },

  reset: function(cb) {
    var self = this;
    this._request('POST', '/reset', {}, function(err, data) {
      if (err) { if (typeof cb === 'function') cb(err); return; }
      self.coords.loweredDispensers = [];
      self.coords.valveOpen = false;
      if (typeof cb === 'function') cb(null, self._applyRemoteSnapshot(data));
    });
  },

  jog: function(axis, stepMm, cb) {
    var self = this;
    if (axis !== 'X' && axis !== 'Y') {
      if (typeof cb === 'function') cb(new Error('Неподдржана оска (само X и Y).'));
      return;
    }
    this._request('POST', '/jog', { axis: axis, step: parseFloat(stepMm) || 0 }, function(err, data) {
      if (err) { if (typeof cb === 'function') cb(err); return; }
      if (typeof cb === 'function') cb(null, self._applyRemoteSnapshot(data));
    });
  },

  zeroAxis: function(axis, cb) {
    var self = this;
    this._request('POST', '/zero', { axis: axis }, function(err, data) {
      if (err) { if (typeof cb === 'function') cb(err); return; }
      if (typeof cb === 'function') cb(null, self._applyRemoteSnapshot(data));
    });
  },

  moveTo: function(x, y, feedrate, cb) {
    var self = this;
    var feed = Math.round(parseFloat(feedrate) || 3000);
    var cmd = 'G90 G1 X' + parseFloat(x).toFixed(3) + ' Y' + parseFloat(y).toFixed(3) + ' F' + feed;
    this._request('POST', '/mdi', { cmd: cmd }, function(err, data) {
      if (err) { if (typeof cb === 'function') cb(err); return; }
      if (typeof cb === 'function') cb(null, self._applyRemoteSnapshot(data));
    });
  },

  runQuickCommand: function(cmdStr, cb) {
    var self = this;
    this._request('POST', '/mdi', { cmd: String(cmdStr || '') }, function(err, data) {
      if (err) { if (typeof cb === 'function') cb(err); return; }
      if (typeof cb === 'function') cb(null, self._applyRemoteSnapshot(data));
    });
  },

  sendCommand: function(cmdStr, cb) {
    var self = this;
    var upper = String(cmdStr || '').toUpperCase().trim();
    var m = CNCApp.State.machine;
    var valveOpenCmd = String(m.valveOpenCmd || 'M103').toUpperCase().trim();
    var valveCloseCmd = String(m.valveCloseCmd || 'M203').toUpperCase().trim();

    var bodyObj = { cmd: String(cmdStr || '') };
    if (upper.indexOf('PULSE:') === 0) {
      bodyObj.openCmd = valveOpenCmd;
      bodyObj.closeCmd = valveCloseCmd;
    }

    this._request('POST', '/mdi', bodyObj, function(err, data) {
      if (err) { if (typeof cb === 'function') cb(err); return; }

      if (upper.indexOf('PULSE:') === 0) {
        self.coords.valveOpen = true;
      } else if (upper === valveOpenCmd) {
        self.coords.valveOpen = true;
      } else if (upper === valveCloseCmd) {
        self.coords.valveOpen = false;
      } else {
        for (var i = 0; i < m.dispensers.length; i++) {
          var d = m.dispensers[i];
          if (upper === String(d.lowerCmd || '').toUpperCase().trim()) {
            self._addLowered(d.id);
            break;
          }
          if (upper === String(d.raiseCmd || '').toUpperCase().trim()) {
            self._removeLowered(d.id);
            break;
          }
        }
      }

      if (typeof cb === 'function') cb(null, self._applyRemoteSnapshot(data));
    });
  },

  raiseAllDispensers: function(dispensers, cb) {
    var list = Array.isArray(dispensers) ? dispensers : [];
    var self = this;
    var cmds = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].raiseCmd) cmds.push(list[i].raiseCmd);
    }
    this._request('POST', '/mdi', { cmd: 'RAISE_ALL', raiseCmds: cmds }, function(err, data) {
      if (err) {
        if (typeof cb === 'function') cb(err);
        return;
      }
      self.coords.loweredDispensers = [];
      if (typeof cb === 'function') cb(null, self._applyRemoteSnapshot(data));
    });
  }
};
