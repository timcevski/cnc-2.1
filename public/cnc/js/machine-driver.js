window.CNCApp = window.CNCApp || {};

CNCApp.MachineDriver = {
  _drivers: {},
  _activeId: 'simulator',

  register: function(driver) {
    if (driver && driver.id) {
      this._drivers[driver.id] = driver;
    }
  },

  get: function(id) {
    return this._drivers[id] || null;
  },

  list: function() {
    var out = [];
    for (var k in this._drivers) {
      if (this._drivers.hasOwnProperty(k)) {
        out.push(this._drivers[k]);
      }
    }
    return out;
  },

  setActive: function(id) {
    if (this._drivers[id]) {
      this._activeId = id;
      return this._drivers[id];
    }
    return null;
  },

  getActive: function() {
    return this._drivers[this._activeId] || this._drivers.simulator || null;
  }
};

CNCApp.Machine = {
  PREFS_KEY: 'CNC_DISPENSER_V20_MACHINE_UI',
  activeDriverId: 'simulator',
  status: 'DISCONNECTED', // DISCONNECTED | IDLE | RUNNING | HOLD | ESTOP
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
  runningTabId: null,
  runningTabName: '',
  strictTabLock: false,
  panelCollapsed: false,
  panelRatio: 0.48,
  simSpeedMultiplier: 1,
  keyboardJogMode: false,
  isMoveToClickMode: false,
  lastError: null,
  _pollTimer: null,
  _isDraggingSplitter: false,
  _jogInFlight: false,

  init: function() {
    if (CNCApp.SimulatorDriver) {
      CNCApp.MachineDriver.register(CNCApp.SimulatorDriver);
    }
    if (CNCApp.Mach3BridgeDriver) {
      CNCApp.MachineDriver.register(CNCApp.Mach3BridgeDriver);
    }

    this._loadPrefs();
    CNCApp.MachineDriver.setActive(this.activeDriverId);
    if (CNCApp.SimulatorDriver) {
      CNCApp.SimulatorDriver.setSpeedMultiplier(this.simSpeedMultiplier);
    }

    this._bindDOMEvents();
    this._bindSplitter();
    this.refreshDispenserSelect();
    this.applyPanelLayout();
    this.refreshUI();
  },

  _loadPrefs: function() {
    try {
      var raw = localStorage.getItem(this.PREFS_KEY);
      if (!raw) return;
      var p = JSON.parse(raw);
      if (p.activeDriverId && CNCApp.MachineDriver.get(p.activeDriverId)) {
        this.activeDriverId = p.activeDriverId;
      }
      if (typeof p.strictTabLock === 'boolean') this.strictTabLock = p.strictTabLock;
      if (typeof p.panelCollapsed === 'boolean') this.panelCollapsed = p.panelCollapsed;
      if (typeof p.panelRatio === 'number' && p.panelRatio >= 0.2 && p.panelRatio <= 0.72) {
        this.panelRatio = p.panelRatio;
      }
      if (p.simSpeedMultiplier === 1 || p.simSpeedMultiplier === 5 || p.simSpeedMultiplier === 15) {
        this.simSpeedMultiplier = p.simSpeedMultiplier;
      }
    } catch (e) {}
  },

  _savePrefs: function() {
    try {
      localStorage.setItem(this.PREFS_KEY, JSON.stringify({
        activeDriverId: this.activeDriverId,
        strictTabLock: !!this.strictTabLock,
        panelCollapsed: !!this.panelCollapsed,
        panelRatio: this.panelRatio,
        simSpeedMultiplier: this.simSpeedMultiplier
      }));
    } catch (e) {}
  },

  isConnected: function() {
    return this.status !== 'DISCONNECTED';
  },

  isBusy: function() {
    return this.status === 'RUNNING' || this.status === 'HOLD';
  },

  isTabSwitchLocked: function() {
    return !!(this.strictTabLock && this.isBusy() && this.runningTabId);
  },

  isTabLocked: function(tabId) {
    if (!tabId) return false;
    if (this.isBusy() && this.runningTabId === tabId) return true;
    if (CNCApp.Tabs) {
      var tab = CNCApp.Tabs.getTabById(tabId);
      if (tab && tab.isRunningOnMachine && this.isBusy()) return true;
    }
    return false;
  },

  isActiveTabReadOnly: function() {
    if (!this.isBusy() || !this.runningTabId || !CNCApp.Tabs) return false;
    return this.isTabLocked(CNCApp.Tabs.activeTabId);
  },

  getLimits: function() {
    var m = (CNCApp.State && CNCApp.State.machine) ? CNCApp.State.machine : {};
    return {
      minX: (typeof m.minX === 'number' && !isNaN(m.minX)) ? m.minX : -5,
      maxX: (typeof m.maxX === 'number' && !isNaN(m.maxX)) ? m.maxX : 350,
      minY: (typeof m.minY === 'number' && !isNaN(m.minY)) ? m.minY : -5,
      maxY: (typeof m.maxY === 'number' && !isNaN(m.maxY)) ? m.maxY : 300,
      moveClickSpeed: (typeof m.moveClickSpeed === 'number' && m.moveClickSpeed > 0) ? m.moveClickSpeed : 3000
    };
  },

  validateMachineCoords: function(x, y) {
    var lim = this.getLimits();
    if (x < lim.minX || x > lim.maxX) {
      return {
        ok: false,
        message: 'Координатата X = ' + x.toFixed(3) + ' mm ги надминува лимитите на машината [' + lim.minX + ' .. ' + lim.maxX + ' mm].'
      };
    }
    if (y < lim.minY || y > lim.maxY) {
      return {
        ok: false,
        message: 'Координатата Y = ' + y.toFixed(3) + ' mm ги надминува лимитите на машината [' + lim.minY + ' .. ' + lim.maxY + ' mm].'
      };
    }
    return { ok: true };
  },

  checkActivePointsBounds: function(startIndex) {
    var pts = CNCApp.State.points || [];
    var dispensers = (CNCApp.State.machine && CNCApp.State.machine.dispensers) ? CNCApp.State.machine.dispensers : [];
    var violations = [];
    var fromIdx = (typeof startIndex === 'number' && startIndex > 0) ? startIndex : 0;

    // Доколку се стартува од одредена точка N > 0, провери ја и претходната активна точка N-1 за репозиционирање
    if (fromIdx > 0) {
      for (var pi = fromIdx - 1; pi >= 0; pi--) {
        if (pts[pi] && pts[pi].active) {
          var prevP = pts[pi];
          var prevDisp = null;
          for (var pd = 0; pd < dispensers.length; pd++) {
            if (dispensers[pd].id === prevP.dispenser) {
              prevDisp = dispensers[pd];
              break;
            }
          }
          if (!prevDisp) prevDisp = dispensers[0] || { id: 1, name: 'Боја 1', offsetX: 0, offsetY: 0 };
          var pMachX = prevP.x + (prevDisp.offsetX || 0);
          var pMachY = prevP.y + (prevDisp.offsetY || 0);
          var pCheck = this.validateMachineCoords(pMachX, pMachY);
          if (!pCheck.ok) {
            violations.push({
              rowNum: pi + 1,
              dispenserName: prevDisp.name || ('Д' + prevDisp.id),
              machX: pMachX,
              machY: pMachY,
              message: 'Претходна референтна точка N-1: ' + pCheck.message
            });
          }
          break;
        }
      }
    }

    for (var i = fromIdx; i < pts.length; i++) {
      var p = pts[i];
      if (!p.active) continue;
      var disp = null;
      for (var d = 0; d < dispensers.length; d++) {
        if (dispensers[d].id === p.dispenser) {
          disp = dispensers[d];
          break;
        }
      }
      if (!disp) disp = dispensers[0] || { id: 1, name: 'Боја 1', offsetX: 0, offsetY: 0 };

      var machX = p.x + (disp.offsetX || 0);
      var machY = p.y + (disp.offsetY || 0);
      var check = this.validateMachineCoords(machX, machY);
      if (!check.ok) {
        violations.push({
          rowNum: i + 1,
          dispenserName: disp.name || ('Д' + disp.id),
          machX: machX,
          machY: machY,
          message: check.message
        });
      }
    }
    return violations;
  },

  isDispenserLowered: function(dispId) {
    var arr = (this.coords && Array.isArray(this.coords.loweredDispensers)) ? this.coords.loweredDispensers : [];
    return arr.indexOf(dispId) !== -1;
  },

  hasLoweredOrValveOpen: function() {
    var arr = (this.coords && Array.isArray(this.coords.loweredDispensers)) ? this.coords.loweredDispensers : [];
    return arr.length > 0 || !!(this.coords && this.coords.valveOpen);
  },

  _describeUnsafeHeadState: function() {
    var arr = (this.coords && Array.isArray(this.coords.loweredDispensers)) ? this.coords.loweredDispensers : [];
    var parts = [];
    if (arr.length > 0) parts.push('спуштени диспензери: [' + arr.join(', ') + ']');
    if (this.coords && this.coords.valveOpen) parts.push('отворен вентил');
    return parts.join(' и ');
  },

  _unlockAllTabs: function() {
    this.runningTabId = null;
    this.runningTabName = '';
    if (CNCApp.Tabs && Array.isArray(CNCApp.Tabs.tabs)) {
      for (var i = 0; i < CNCApp.Tabs.tabs.length; i++) {
        CNCApp.Tabs.tabs[i].isRunningOnMachine = false;
      }
      CNCApp.Tabs.renderTabBar();
    }
    if (CNCApp.Table) CNCApp.Table.render();
    if (CNCApp.App && typeof CNCApp.App.refreshToolbarStates === 'function') {
      CNCApp.App.refreshToolbarStates();
    }
    if (CNCApp.Canvas) CNCApp.Canvas.render();
  },

  _applySnapshot: function(snap) {
    if (!snap) return;
    var wasBusy = this.isBusy();
    this.status = snap.status || 'DISCONNECTED';
    if (snap.coords) {
      this.coords = snap.coords;
    }
    this.lastError = snap.lastError || null;

    if (wasBusy && !this.isBusy()) {
      if (this.runningTabId) {
        this._unlockAllTabs();
      }
    }

    if (this.isBusy() || this.status === 'DISCONNECTED' || this.status === 'ESTOP') {
      this.keyboardJogMode = false;
      if (this.status !== 'IDLE') this.isMoveToClickMode = false;
    }

    this.refreshUI();
    if (CNCApp.Canvas && this.isConnected()) {
      CNCApp.Canvas.render();
    }
  },

  _startPolling: function() {
    this._stopPolling();
    var self = this;
    var pollMs = (this.activeDriverId === 'simulator') ? 50 : 100;
    this._pollTimer = setInterval(function() {
      var drv = CNCApp.MachineDriver.getActive();
      if (!drv || !self.isConnected()) return;
      drv.getStatus(function(err, snap) {
        if (err && !snap) {
          self.lastError = err.message;
          self.refreshUI();
          return;
        }
        if (snap) self._applySnapshot(snap);
      });
    }, pollMs);
  },

  _stopPolling: function() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  },

  connect: function() {
    var drv = CNCApp.MachineDriver.getActive();
    if (!drv) return;
    var self = this;
    this.lastError = null;
    drv.connect(function(err, snap) {
      if (err) {
        self.status = 'DISCONNECTED';
        self.lastError = err.message;
        self.refreshUI();
        return;
      }
      self._applySnapshot(snap);
      self._startPolling();
    });
  },

  disconnect: function() {
    if (this.isBusy()) {
      alert('⛔ Машината моментално работи! Прво сопрете ја со ⏹ СТОП пред да ја исклучите врската.');
      return;
    }
    var drv = CNCApp.MachineDriver.getActive();
    this._stopPolling();
    this.keyboardJogMode = false;
    this.isMoveToClickMode = false;
    var self = this;
    if (drv) {
      drv.disconnect(function() {
        self.status = 'DISCONNECTED';
        self.coords.loweredDispensers = [];
        self.coords.valveOpen = false;
        self.lastError = null;
        self._unlockAllTabs();
        self.refreshUI();
        if (CNCApp.Canvas) CNCApp.Canvas.render();
      });
    } else {
      self.status = 'DISCONNECTED';
      self.refreshUI();
    }
  },

  switchDriver: function(driverId) {
    if (this.isConnected()) {
      if (this.isBusy()) {
        alert('⛔ Не може да се менува драјверот додека машината работи.');
        return;
      }
      this.disconnect();
    }
    if (CNCApp.MachineDriver.setActive(driverId)) {
      this.activeDriverId = driverId;
      this.lastError = null;
      this._savePrefs();
      this.refreshUI();
    }
  },

  startActiveTabJob: function() {
    if (!this.isConnected()) {
      alert('⚠️ Прво поврзете се со Симулатор или Mach3 Bridge преку копчето „Поврзи“.');
      return;
    }
    if (this.isBusy()) {
      alert('⛔ Машината веќе извршува програма или е во движење.');
      return;
    }
    if (this.status === 'ESTOP') {
      alert('⚠️ Машината е во СТОП / Reset состојба. Притиснете 🔄 Reset пред нов старт.');
      return;
    }

    var activePts = [];
    for (var i = 0; i < CNCApp.State.points.length; i++) {
      if (CNCApp.State.points[i].active) activePts.push(CNCApp.State.points[i]);
    }
    if (activePts.length === 0) {
      alert('⚠️ Во тековниот таб нема ниту една активна точка за извршување!');
      return;
    }

    if (CNCApp.Table) CNCApp.Table.enforceDispenserSafety();

    var violations = this.checkActivePointsBounds();
    if (violations.length > 0) {
      var firstV = violations[0];
      alert('⛔ БЕЗБЕДНОСНА БЛОКАДА (Работни лимити):\n\nПрограмата содржи ' + violations.length + ' точкa/и што излегуваат надвор од границите на машината!\nПример: Точка #' + firstV.rowNum + ' (' + firstV.dispenserName + ') -> X=' + firstV.machX.toFixed(2) + ', Y=' + firstV.machY.toFixed(2) + '\n\n' + firstV.message);
      return;
    }

    var gcode = CNCApp.GCode.generate();
    var drv = CNCApp.MachineDriver.getActive();
    if (!drv) return;

    this.keyboardJogMode = false;
    this.isMoveToClickMode = false;

    var activeTab = CNCApp.Tabs ? CNCApp.Tabs.getActiveTab() : null;
    if (activeTab) {
      activeTab.isRunningOnMachine = true;
      this.runningTabId = activeTab.id;
      this.runningTabName = activeTab.projectName || 'Тековен проект';
    } else {
      this.runningTabId = 'default';
      this.runningTabName = CNCApp.State.projectName || 'Проект';
    }

    this.status = 'RUNNING';
    if (CNCApp.Tabs) CNCApp.Tabs.renderTabBar();
    if (CNCApp.Table) CNCApp.Table.render();
    this.refreshUI();

    var self = this;
    drv.loadAndRun(gcode, {
      projectName: this.runningTabName,
      machine: CNCApp.State.machine
    }, function(err, snap) {
      if (err) {
        self.status = 'IDLE';
        self.lastError = err.message;
        self._unlockAllTabs();
        self.refreshUI();
        alert('❌ Грешка при старт на програмата:\n' + err.message);
        return;
      }
      self._applySnapshot(snap);
    });
  },

  startFromSelectedPoint: function() {
    if (!this.isConnected()) {
      alert('⚠️ Прво поврзете се со Симулатор или Mach3 Bridge преку копчето „Поврзи“.');
      return;
    }
    if (this.isBusy()) {
      alert('⛔ Машината веќе извршува програма или е во движење.');
      return;
    }
    if (this.status === 'ESTOP') {
      alert('⚠️ Машината е во СТОП / Reset состојба. Притиснете 🔄 Reset пред нов старт.');
      return;
    }

    var pts = CNCApp.State.points || [];
    if (pts.length === 0) {
      alert('⚠️ Во тековниот таб нема точки за извршување!');
      return;
    }

    // Определување на селектираниот ред
    var selIdx = null;
    if (CNCApp.State.activePointIndex !== null && CNCApp.State.activePointIndex >= 0 && CNCApp.State.activePointIndex < pts.length) {
      selIdx = CNCApp.State.activePointIndex;
    } else if (CNCApp.State.selectedIndices && CNCApp.State.selectedIndices.size > 0) {
      var arr = Array.from(CNCApp.State.selectedIndices).sort(function(a, b) { return a - b; });
      selIdx = arr[0];
    }

    if (selIdx === null || selIdx < 0 || selIdx >= pts.length) {
      alert('⚠️ Ве молиме прво селектирајте ред од табелата (кликнете на редот) од каде сакате да започне извршувањето.');
      return;
    }

    if (!pts[selIdx].active) {
      alert('⚠️ Селектираниот ред #' + (selIdx + 1) + ' е деактивиран (исклучен).\n\nВе молиме штиклирајте го за да го активирате или изберете друг активен ред.');
      return;
    }

    if (CNCApp.Table) CNCApp.Table.enforceDispenserSafety();

    var violations = this.checkActivePointsBounds(selIdx);
    if (violations.length > 0) {
      var firstV = violations[0];
      alert('⛔ БЕЗБЕДНОСНА БЛОКАДА (Работни лимити):\n\nПрограмата содржи ' + violations.length + ' точкa/и што излегуваат надвор од границите на машината!\nПример: Точка #' + firstV.rowNum + ' (' + firstV.dispenserName + ') -> X=' + firstV.machX.toFixed(2) + ', Y=' + firstV.machY.toFixed(2) + '\n\n' + firstV.message);
      return;
    }

    var gcode = CNCApp.GCode.generate(selIdx);
    var drv = CNCApp.MachineDriver.getActive();
    if (!drv) return;

    this.keyboardJogMode = false;
    this.isMoveToClickMode = false;

    var activeTab = CNCApp.Tabs ? CNCApp.Tabs.getActiveTab() : null;
    var baseName = activeTab ? (activeTab.projectName || 'Тековен проект') : (CNCApp.State.projectName || 'Проект');
    var jobName = baseName + ' [од ред #' + (selIdx + 1) + ']';

    if (activeTab) {
      activeTab.isRunningOnMachine = true;
      this.runningTabId = activeTab.id;
      this.runningTabName = jobName;
    } else {
      this.runningTabId = 'default';
      this.runningTabName = jobName;
    }

    this.status = 'RUNNING';
    if (CNCApp.Tabs) CNCApp.Tabs.renderTabBar();
    if (CNCApp.Table) CNCApp.Table.render();
    this.refreshUI();

    var self = this;
    drv.loadAndRun(gcode, {
      projectName: this.runningTabName,
      machine: CNCApp.State.machine
    }, function(err, snap) {
      if (err) {
        self.status = 'IDLE';
        self.lastError = err.message;
        self._unlockAllTabs();
        self.refreshUI();
        alert('❌ Грешка при старт на програмата:\n' + err.message);
        return;
      }
      self._applySnapshot(snap);
    });
  },

  togglePause: function() {
    var drv = CNCApp.MachineDriver.getActive();
    if (!drv || !this.isConnected()) return;
    var self = this;
    if (this.status === 'RUNNING') {
      drv.pause(function(err, snap) {
        if (!err && snap) self._applySnapshot(snap);
      });
    } else if (this.status === 'HOLD') {
      drv.resume(function(err, snap) {
        if (!err && snap) self._applySnapshot(snap);
      });
    }
  },

  stopJob: function() {
    var drv = CNCApp.MachineDriver.getActive();
    if (!drv || !this.isConnected()) return;
    this.keyboardJogMode = false;
    this.isMoveToClickMode = false;
    var self = this;
    drv.stop(function(err, snap) {
      if (err) {
        self.lastError = err.message;
        self.refreshUI();
        return;
      }
      self.status = (snap && snap.status) ? snap.status : 'ESTOP';
      if (snap && snap.coords) self.coords = snap.coords;
      self._unlockAllTabs();
      self.refreshUI();
    });
  },

  resetMachine: function() {
    var drv = CNCApp.MachineDriver.getActive();
    if (!drv || !this.isConnected()) return;
    if (this.isBusy()) {
      alert('⛔ Прво притиснете ⏹ СТОП пред Reset додека машината е во движење.');
      return;
    }
    var self = this;
    drv.reset(function(err, snap) {
      if (err) {
        self.lastError = err.message;
        self.refreshUI();
        return;
      }
      self._unlockAllTabs();
      self._applySnapshot(snap);
    });
  },

  jogAxis: function(axis, dir, opts) {
    if (!this.isConnected() || this.status !== 'IDLE') return;
    if (axis !== 'X' && axis !== 'Y') return;
    if (this._jogInFlight) return;

    var stepEl = document.getElementById('jogStepSelect');
    var stepVal = stepEl ? (parseFloat(stepEl.value) || 1) : 1;
    var delta = dir * stepVal;
    var nextX = (axis === 'X') ? parseFloat(((this.coords.x || 0) + delta).toFixed(3)) : (this.coords.x || 0);
    var nextY = (axis === 'Y') ? parseFloat(((this.coords.y || 0) + delta).toFixed(3)) : (this.coords.y || 0);

    var limCheck = this.validateMachineCoords(nextX, nextY);
    if (!limCheck.ok) {
      this.lastError = limCheck.message;
      this.refreshUI();
      if (!opts || !opts.fromKeyboard) {
        alert('⛔ Достигнат лимит на машината!\n\n' + limCheck.message);
      }
      return;
    }

    var drv = CNCApp.MachineDriver.getActive();
    if (!drv) return;
    this._jogInFlight = true;
    var self = this;
    drv.jog(axis, delta, function(err, snap) {
      self._jogInFlight = false;
      if (err) {
        self.lastError = err.message;
        self.refreshUI();
        return;
      }
      self._applySnapshot(snap);
    });
  },

  zeroAxis: function(axis) {
    if (!this.isConnected() || this.status !== 'IDLE') return;
    var drv = CNCApp.MachineDriver.getActive();
    if (!drv) return;
    var self = this;
    drv.zeroAxis(axis, function(err, snap) {
      if (err) {
        self.lastError = err.message;
        self.refreshUI();
        return;
      }
      self._applySnapshot(snap);
    });
  },

  getSelectedPanelDispenser: function() {
    var sel = document.getElementById('machineActiveDispenser');
    var id = sel ? parseInt(sel.value, 10) : 1;
    var list = CNCApp.State.machine.dispensers || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return list[0] || { id: 1, name: 'Боја 1', offsetX: 0, offsetY: 0, lowerCmd: 'M104', raiseCmd: 'M204', color: '#2563eb' };
  },

  teachPointFromDro: function() {
    if (!this.isConnected()) {
      alert('⚠️ Прво поврзете се со Симулатор или Mach3.');
      return;
    }
    if (this.status !== 'IDLE') {
      alert('⛔ Преземање точка (Teach) е дозволено само кога машината стои во СПРЕМНА (IDLE) состојба.');
      return;
    }
    if (this.isActiveTabReadOnly()) {
      alert('🔒 Тековниот таб е заклучен за уредување.');
      return;
    }

    var disp = this.getSelectedPanelDispenser();
    var modelX = parseFloat(((this.coords.x || 0) - (disp.offsetX || 0)).toFixed(3));
    var modelY = parseFloat(((this.coords.y || 0) - (disp.offsetY || 0)).toFixed(3));

    if (CNCApp.Table) {
      CNCApp.Table.insertNewPointAt(modelX, modelY);
      var newIdx = CNCApp.State.activePointIndex;
      if (newIdx !== null && CNCApp.State.points[newIdx]) {
        CNCApp.State.points[newIdx].dispenser = disp.id;
        CNCApp.Table.enforceDispenserSafety();
        CNCApp.Table.render();
        CNCApp.Canvas.render();
      }
    }
  },

  setMoveToClickMode: function(on) {
    var desired = !!on;
    if (desired) {
      if (!this.isConnected()) {
        alert('⚠️ Прво поврзете се со Симулатор или Mach3 Bridge за да користите движење со клик на графикот.');
        this.isMoveToClickMode = false;
        this.refreshUI();
        return;
      }
      if (this.status !== 'IDLE') {
        alert('⛔ „Оди на клик“ може да се активира само кога машината е СПРЕМНА (IDLE).');
        this.isMoveToClickMode = false;
        this.refreshUI();
        return;
      }
      if (CNCApp.State.isAddMode) {
        CNCApp.State.isAddMode = false;
      }
    }
    this.isMoveToClickMode = desired;
    if (CNCApp.App && typeof CNCApp.App.refreshToolbarStates === 'function') {
      CNCApp.App.refreshToolbarStates();
    } else {
      this.refreshUI();
    }
  },

  moveDispenserToModelPoint: function(modelX, modelY) {
    if (!this.isConnected()) {
      alert('⚠️ Прво поврзете се со Симулатор или Mach3.');
      return;
    }
    if (this.status !== 'IDLE') {
      alert('⛔ Машината веќе се движи или не е во IDLE состојба.');
      return;
    }
    if (this.hasLoweredOrValveOpen()) {
      alert('⛔ БЕЗБЕДНОСНА БЛОКАДА:\n\nНе смее да се придвижи главата додека има ' + this._describeUnsafeHeadState() + '!\nПрво подигнете ги сите диспензери (⬆ Сите) и затворете го вентилот.');
      return;
    }

    var disp = this.getSelectedPanelDispenser();
    var targetX = parseFloat((modelX + (disp.offsetX || 0)).toFixed(3));
    var targetY = parseFloat((modelY + (disp.offsetY || 0)).toFixed(3));

    var limCheck = this.validateMachineCoords(targetX, targetY);
    if (!limCheck.ok) {
      alert('⛔ НЕДОЗВОЛЕНА ПОЗИЦИЈА ЗА ' + disp.name + ':\n\n' + limCheck.message + '\n(Модел: X=' + modelX.toFixed(2) + ', Y=' + modelY.toFixed(2) + ' + Офсет Д' + disp.id + ')');
      return;
    }

    var lim = this.getLimits();
    var drv = CNCApp.MachineDriver.getActive();
    if (!drv || typeof drv.moveTo !== 'function') return;

    this.coords.activeDispenserId = disp.id;
    this.lastError = null;
    var self = this;
    drv.moveTo(targetX, targetY, lim.moveClickSpeed, function(err, snap) {
      if (err) {
        self.lastError = err.message;
        self.refreshUI();
        alert('❌ ' + err.message);
        return;
      }
      self._applySnapshot(snap);
    });
  },

  runQuickCommand: function(cmdStr) {
    if (!this.isConnected()) {
      alert('⚠️ Прво поврзете се со Симулатор или Mach3 Bridge.');
      return;
    }
    if (this.status !== 'IDLE') {
      alert('⛔ Брзата команда е дозволена само кога машината е СПРЕМНА (IDLE).');
      return;
    }
    if (this.hasLoweredOrValveOpen()) {
      alert('⛔ БЕЗБЕДНОСНА БЛОКАДА:\n\nКомандата „' + cmdStr + '“ е блокирана бидејќи има ' + this._describeUnsafeHeadState() + '!\nПрво подигнете ги сите диспензери и затворете го вентилот.');
      return;
    }

    var drv = CNCApp.MachineDriver.getActive();
    if (!drv || typeof drv.runQuickCommand !== 'function') return;
    var self = this;
    drv.runQuickCommand(cmdStr, function(err, snap) {
      if (err) {
        self.lastError = err.message;
        self.refreshUI();
        alert('❌ ' + err.message);
        return;
      }
      self._applySnapshot(snap);
    });
  },

  toggleDispenser: function(dispId) {
    if (!this.isConnected() || this.status !== 'IDLE') return;
    var list = CNCApp.State.machine.dispensers || [];
    var disp = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === dispId) {
        disp = list[i];
        break;
      }
    }
    if (!disp) return;

    var lowered = this.isDispenserLowered(dispId);
    var cmd = lowered ? (disp.raiseCmd || ('M' + (203 + dispId))) : (disp.lowerCmd || ('M' + (103 + dispId)));
    var drv = CNCApp.MachineDriver.getActive();
    if (!drv) return;
    var self = this;
    drv.sendCommand(cmd, function(err, snap) {
      if (err) {
        self.lastError = err.message;
        self.refreshUI();
        return;
      }
      self._applySnapshot(snap);
    });
  },

  raiseAllDispensers: function() {
    if (!this.isConnected() || this.status !== 'IDLE') return;
    var drv = CNCApp.MachineDriver.getActive();
    if (!drv) return;
    var self = this;
    if (typeof drv.raiseAllDispensers === 'function') {
      drv.raiseAllDispensers(CNCApp.State.machine.dispensers || [], function(err, snap) {
        if (err) {
          self.lastError = err.message;
          self.refreshUI();
          return;
        }
        self._applySnapshot(snap);
      });
    } else {
      drv.sendCommand('RAISE_ALL', function(err, snap) {
        if (err) {
          self.lastError = err.message;
          self.refreshUI();
          return;
        }
        self._applySnapshot(snap);
      });
    }
  },

  toggleValve: function() {
    if (!this.isConnected() || this.status !== 'IDLE') return;
    var m = CNCApp.State.machine;
    var cmd = (this.coords && this.coords.valveOpen) ? (m.valveCloseCmd || 'M203') : (m.valveOpenCmd || 'M103');
    var drv = CNCApp.MachineDriver.getActive();
    if (!drv) return;
    var self = this;
    drv.sendCommand(cmd, function(err, snap) {
      if (err) {
        self.lastError = err.message;
        self.refreshUI();
        return;
      }
      self._applySnapshot(snap);
    });
  },

  pulseValve100ms: function() {
    if (!this.isConnected() || this.status !== 'IDLE') return;
    var drv = CNCApp.MachineDriver.getActive();
    if (!drv) return;
    var self = this;
    drv.sendCommand('PULSE:100', function(err, snap) {
      if (err) {
        self.lastError = err.message;
        self.refreshUI();
        return;
      }
      self._applySnapshot(snap);
    });
  },

  setKeyboardJogMode: function(enabled) {
    var want = !!enabled;
    if (want && (!this.isConnected() || this.status !== 'IDLE')) {
      alert('⚠️ Стрелките за возење машина можат да се вклучат само кога машината е поврзана и СПРЕМНА (IDLE).');
      this.keyboardJogMode = false;
      this.refreshUI();
      return;
    }
    this.keyboardJogMode = want;
    this.refreshUI();
  },

  handleKeyboardArrow: function(e) {
    if (!this.keyboardJogMode) return false;
    e.preventDefault();
    if (e.repeat) return true;
    if (!this.isConnected() || this.status !== 'IDLE') {
      this.lastError = 'Стрелките кон машината работат само во СПРЕМНА (IDLE) состојба.';
      this.refreshUI();
      return true;
    }
    if (e.key === 'ArrowUp') this.jogAxis('Y', 1, { fromKeyboard: true });
    else if (e.key === 'ArrowDown') this.jogAxis('Y', -1, { fromKeyboard: true });
    else if (e.key === 'ArrowLeft') this.jogAxis('X', -1, { fromKeyboard: true });
    else if (e.key === 'ArrowRight') this.jogAxis('X', 1, { fromKeyboard: true });
    return true;
  },

  toggleCollapse: function() {
    this.panelCollapsed = !this.panelCollapsed;
    this._savePrefs();
    this.applyPanelLayout();
    this.refreshUI();
  },

  applyPanelLayout: function() {
    var leftCol = document.getElementById('leftColumn');
    var machinePanel = document.getElementById('machinePanel');
    var splitter = document.getElementById('leftPaneSplitter');
    var bodyEl = document.getElementById('machinePanelBody');
    if (!leftCol || !machinePanel) return;

    if (this.panelCollapsed) {
      machinePanel.classList.add('collapsed');
      machinePanel.style.height = '34px';
      if (splitter) splitter.style.display = 'none';
      if (bodyEl) bodyEl.style.display = 'none';
    } else {
      machinePanel.classList.remove('collapsed');
      if (splitter) splitter.style.display = 'flex';
      if (bodyEl) bodyEl.style.display = 'flex';

      var colH = leftCol.clientHeight || 560;
      var targetH = Math.round(colH * (this.panelRatio || 0.48));
      var minH = 200;
      var maxH = Math.max(minH, colH - 110);
      if (targetH < minH) targetH = minH;
      if (targetH > maxH) targetH = maxH;
      machinePanel.style.height = targetH + 'px';
    }
  },

  _bindSplitter: function() {
    var splitter = document.getElementById('leftPaneSplitter');
    var leftCol = document.getElementById('leftColumn');
    var machinePanel = document.getElementById('machinePanel');
    if (!splitter || !leftCol || !machinePanel) return;

    var self = this;

    splitter.onmousedown = function(e) {
      if (self.panelCollapsed) return;
      e.preventDefault();
      self._isDraggingSplitter = true;
      document.body.style.cursor = 'ns-resize';
      splitter.classList.add('dragging');
    };

    window.addEventListener('mousemove', function(e) {
      if (!self._isDraggingSplitter || self.panelCollapsed) return;
      var rect = leftCol.getBoundingClientRect();
      var colH = rect.height || 560;
      var desiredMachineH = rect.bottom - e.clientY;
      var minH = 200;
      var maxH = Math.max(minH, colH - 110);
      if (desiredMachineH < minH) desiredMachineH = minH;
      if (desiredMachineH > maxH) desiredMachineH = maxH;

      self.panelRatio = parseFloat((desiredMachineH / colH).toFixed(3));
      machinePanel.style.height = Math.round(desiredMachineH) + 'px';
    });

    window.addEventListener('mouseup', function() {
      if (self._isDraggingSplitter) {
        self._isDraggingSplitter = false;
        document.body.style.cursor = '';
        splitter.classList.remove('dragging');
        self._savePrefs();
      }
    });

    window.addEventListener('resize', function() {
      self.applyPanelLayout();
    });
  },

  _bindDOMEvents: function() {
    var self = this;

    var selDriver = document.getElementById('machineDriverSelect');
    if (selDriver) {
      selDriver.value = this.activeDriverId;
      selDriver.onchange = function() {
        self.switchDriver(selDriver.value);
      };
    }

    var btnConnect = document.getElementById('btnMachineConnect');
    if (btnConnect) {
      btnConnect.onclick = function() {
        if (self.isConnected()) self.disconnect();
        else self.connect();
      };
    }

    var btnToggle = document.getElementById('btnToggleMachinePanel');
    if (btnToggle) {
      btnToggle.onclick = function() {
        self.toggleCollapse();
      };
    }

    var btnRun = document.getElementById('btnMachineRun');
    if (btnRun) btnRun.onclick = function() { self.startActiveTabJob(); };

    var btnRunFromHere = document.getElementById('btnMachineRunFromHere');
    if (btnRunFromHere) btnRunFromHere.onclick = function() { self.startFromSelectedPoint(); };

    var btnPause = document.getElementById('btnMachinePause');
    if (btnPause) btnPause.onclick = function() { self.togglePause(); };

    var btnStop = document.getElementById('btnMachineStop');
    if (btnStop) btnStop.onclick = function() { self.stopJob(); };

    var btnReset = document.getElementById('btnMachineReset');
    if (btnReset) btnReset.onclick = function() { self.resetMachine(); };

    var chkStrict = document.getElementById('chkStrictTabLock');
    if (chkStrict) {
      chkStrict.checked = !!this.strictTabLock;
      chkStrict.onchange = function() {
        self.strictTabLock = !!chkStrict.checked;
        self._savePrefs();
      };
    }

    var simSpeedBtns = document.querySelectorAll('[data-sim-speed]');
    for (var s = 0; s < simSpeedBtns.length; s++) {
      (function(btn) {
        btn.onclick = function() {
          var mult = parseInt(btn.getAttribute('data-sim-speed'), 10) || 1;
          self.simSpeedMultiplier = mult;
          if (CNCApp.SimulatorDriver) CNCApp.SimulatorDriver.setSpeedMultiplier(mult);
          self._savePrefs();
          self.refreshUI();
        };
      })(simSpeedBtns[s]);
    }

    var btnZeroX = document.getElementById('btnZeroX');
    var btnZeroY = document.getElementById('btnZeroY');
    var btnZeroAll = document.getElementById('btnZeroAll');
    if (btnZeroX) btnZeroX.onclick = function() { self.zeroAxis('X'); };
    if (btnZeroY) btnZeroY.onclick = function() { self.zeroAxis('Y'); };
    if (btnZeroAll) btnZeroAll.onclick = function() { self.zeroAxis('XY'); };

    var selPanelDisp = document.getElementById('machineActiveDispenser');
    if (selPanelDisp) {
      selPanelDisp.onchange = function() {
        if (CNCApp.Canvas) CNCApp.Canvas.render();
      };
    }

    var btnTeach = document.getElementById('btnMachineTeach');
    if (btnTeach) btnTeach.onclick = function() { self.teachPointFromDro(); };

    var jogBtns = document.querySelectorAll('[data-jog-axis]');
    for (var j = 0; j < jogBtns.length; j++) {
      (function(jBtn) {
        jBtn.onclick = function() {
          var ax = jBtn.getAttribute('data-jog-axis');
          var dr = parseInt(jBtn.getAttribute('data-jog-dir'), 10) || 1;
          self.jogAxis(ax, dr, { fromKeyboard: false });
        };
      })(jogBtns[j]);
    }

    var btnKbdPoints = document.getElementById('btnKbdModePoints');
    var btnKbdMachine = document.getElementById('btnKbdModeMachine');
    if (btnKbdPoints) btnKbdPoints.onclick = function() { self.setKeyboardJogMode(false); };
    if (btnKbdMachine) btnKbdMachine.onclick = function() { self.setKeyboardJogMode(true); };

    var btnValve = document.getElementById('btnMachineValve');
    var btnPulse100 = document.getElementById('btnMachinePulse100');
    var btnRaiseAll = document.getElementById('btnRaiseAllDispensers');
    if (btnValve) btnValve.onclick = function() { self.toggleValve(); };
    if (btnPulse100) btnPulse100.onclick = function() { self.pulseValve100ms(); };
    if (btnRaiseAll) btnRaiseAll.onclick = function() { self.raiseAllDispensers(); };

    var btnCmdHome = document.getElementById('btnCmdHomeRef');
    var btnCmdPark = document.getElementById('btnCmdParkPos');
    if (btnCmdHome) btnCmdHome.onclick = function() { self.runQuickCommand('G28.1 X2 Y2'); };
    if (btnCmdPark) btnCmdPark.onclick = function() { self.runQuickCommand('G1 X1 Y1 F2000'); };

    var btnJumpTab = document.getElementById('btnJumpToRunningTab');
    if (btnJumpTab) {
      btnJumpTab.onclick = function() {
        if (self.runningTabId && CNCApp.Tabs) {
          CNCApp.Tabs.switchTab(self.runningTabId);
        }
      };
    }
  },

  refreshDispenserSelect: function() {
    var sel = document.getElementById('machineActiveDispenser');
    if (sel) {
      var cur = sel.value;
      var list = CNCApp.State.machine.dispensers || [];
      var html = '';
      for (var i = 0; i < list.length; i++) {
        html += '<option value="' + list[i].id + '">' + list[i].name + '</option>';
      }
      sel.innerHTML = html;
      if (cur) sel.value = cur;
      if (!sel.value && list.length > 0) sel.value = String(list[0].id);
    }
    this.renderDispenserButtons();
  },

  renderDispenserButtons: function() {
    var container = document.getElementById('machineDispButtons');
    if (!container) return;

    var connected = this.isConnected();
    var isIdle = (this.status === 'IDLE');
    var manualLocked = !connected || !isIdle;
    var list = (CNCApp.State.machine && CNCApp.State.machine.dispensers) ? CNCApp.State.machine.dispensers : [];
    var self = this;

    // Не ги бриши постоечките копчиња на секои 50-100ms polling за да не се губи клик на глувчето!
    var sigParts = [];
    for (var k = 0; k < list.length; k++) {
      sigParts.push(list[k].id + ':' + (list[k].name || '') + ':' + (list[k].color || '') + ':' + (list[k].lowerCmd || '') + ':' + (list[k].raiseCmd || ''));
    }
    var sig = sigParts.join('|');

    if (container.getAttribute('data-disp-sig') !== sig || container.children.length !== list.length) {
      container.innerHTML = '';
      for (var i = 0; i < list.length; i++) {
        (function(d) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.setAttribute('data-disp-id', String(d.id));
          btn.onclick = function() {
            var targetId = parseInt(btn.getAttribute('data-disp-id'), 10);
            if (!isNaN(targetId)) self.toggleDispenser(targetId);
          };
          container.appendChild(btn);
        })(list[i]);
      }
      container.setAttribute('data-disp-sig', sig);
    }

    for (var j = 0; j < list.length; j++) {
      var d = list[j];
      var btn = container.children[j];
      if (!btn) continue;

      var isLower = self.isDispenserLowered(d.id);
      var desiredText = d.id + (isLower ? ' ⬇' : ' ⬆');
      var desiredClass = 'btn btn-xs disp-toggle-btn' + (isLower ? ' is-lowered' : '');
      var desiredTitle = d.name + (isLower ? ' — СПУШТЕН (клик за кревање ' + (d.raiseCmd || '') + ')' : ' — ГОРЕ (клик за спуштање ' + (d.lowerCmd || '') + ')');

      if (btn.innerText !== desiredText) btn.innerText = desiredText;
      if (btn.className !== desiredClass) btn.className = desiredClass;
      if (btn.title !== desiredTitle) btn.title = desiredTitle;
      if (btn.disabled !== manualLocked) btn.disabled = manualLocked;

      var col = d.color || '#2563eb';
      if (isLower) {
        btn.style.background = col;
        btn.style.borderColor = col;
        btn.style.borderBottom = '1px solid ' + col;
        btn.style.color = '#ffffff';
      } else {
        btn.style.background = '';
        btn.style.borderColor = '';
        btn.style.borderBottom = '2px solid ' + col;
        btn.style.color = '#1e293b';
      }
    }
  },

  _setDisabled: function(id, disabled) {
    var el = document.getElementById(id);
    if (el) el.disabled = !!disabled;
  },

  refreshUI: function() {
    var connected = this.isConnected();
    var busy = this.isBusy();
    var isIdle = (this.status === 'IDLE');
    var isHold = (this.status === 'HOLD');
    var isEstop = (this.status === 'ESTOP');
    var tabRO = this.isActiveTabReadOnly();
    var hasTabJob = !!(busy && this.runningTabId);

    var selDriver = document.getElementById('machineDriverSelect');
    if (selDriver) {
      selDriver.value = this.activeDriverId;
      selDriver.disabled = busy;
    }

    var btnConnect = document.getElementById('btnMachineConnect');
    if (btnConnect) {
      btnConnect.innerText = connected ? '🔌 Исклучи' : '🔌 Поврзи';
      btnConnect.className = connected ? 'btn btn-xs btn-outline-dark' : 'btn btn-xs btn-primary';
      btnConnect.disabled = busy;
    }

    var badge = document.getElementById('machineStatusBadge');
    if (badge) {
      if (this.status === 'DISCONNECTED') {
        badge.innerText = 'НЕПОВРЗАНА';
        badge.className = 'machine-badge status-disconnected';
      } else if (this.status === 'IDLE') {
        badge.innerText = 'СПРЕМНА (IDLE)';
        badge.className = 'machine-badge status-idle';
      } else if (this.status === 'RUNNING') {
        badge.innerText = hasTabJob ? 'РАБОТИ (RUN)' : 'ДВИЖЕЊЕ...';
        badge.className = 'machine-badge status-running';
      } else if (this.status === 'HOLD') {
        badge.innerText = 'ПАУЗА (HOLD)';
        badge.className = 'machine-badge status-hold';
      } else if (this.status === 'ESTOP') {
        badge.innerText = 'СТОП / RESET';
        badge.className = 'machine-badge status-estop';
      }
    }

    var summaryEl = document.getElementById('machineJobSummary');
    if (summaryEl) {
      if (hasTabJob && this.runningTabName) {
        summaryEl.innerText = '🔒 ' + this.runningTabName + ' (' + (this.coords.lineNum || 0) + '/' + (this.coords.totalLines || 0) + ')';
        summaryEl.style.display = 'inline-block';
      } else {
        summaryEl.style.display = 'none';
      }
    }

    var btnToggle = document.getElementById('btnToggleMachinePanel');
    if (btnToggle) {
      btnToggle.innerText = this.panelCollapsed ? '▴ Рашири' : '▾ Собери';
      btnToggle.title = this.panelCollapsed ? 'Отвори го панелот за контрола на машина' : 'Собери го панелот за повеќе простор на табелата';
    }

    var safetyBanner = document.getElementById('machineSafetyBanner');
    var safetyText = document.getElementById('machineSafetyText');
    var btnJump = document.getElementById('btnJumpToRunningTab');
    if (safetyBanner && safetyText) {
      if (hasTabJob) {
        var curTabId = CNCApp.Tabs ? CNCApp.Tabs.activeTabId : null;
        var viewingRunning = (curTabId && curTabId === this.runningTabId);
        safetyText.innerText = viewingRunning
          ? ('🔒 Табот „' + this.runningTabName + '“ работи и е заклучен за измени.')
          : ('🔒 Машината активно работи на „' + this.runningTabName + '“ (командите кон машината се заклучени).');
        safetyBanner.className = 'machine-banner banner-warn';
        safetyBanner.style.display = 'flex';
        if (btnJump) btnJump.style.display = (!viewingRunning && !this.strictTabLock) ? 'inline-block' : 'none';
      } else if (busy) {
        safetyText.innerText = '🕹️ Машината се движи кон зададена позиција...';
        safetyBanner.className = 'machine-banner banner-warn';
        safetyBanner.style.display = 'flex';
        if (btnJump) btnJump.style.display = 'none';
      } else if (isEstop && this.lastError) {
        safetyText.innerText = '⚠️ ' + this.lastError;
        safetyBanner.className = 'machine-banner banner-danger';
        safetyBanner.style.display = 'flex';
        if (btnJump) btnJump.style.display = 'none';
      } else if (isEstop) {
        safetyText.innerText = '⏹ Машината е сопрена (СТОП). Притиснете „🔄 Reset“ пред повторно пуштање.';
        safetyBanner.className = 'machine-banner banner-danger';
        safetyBanner.style.display = 'flex';
        if (btnJump) btnJump.style.display = 'none';
      } else if (this.lastError) {
        safetyText.innerText = '⚠️ ' + this.lastError;
        safetyBanner.className = 'machine-banner banner-danger';
        safetyBanner.style.display = 'flex';
        if (btnJump) btnJump.style.display = 'none';
      } else {
        safetyBanner.style.display = 'none';
      }
    }

    var simRow = document.getElementById('simSpeedRow');
    if (simRow) {
      simRow.style.display = (this.activeDriverId === 'simulator') ? 'flex' : 'none';
    }
    var simBtns = document.querySelectorAll('[data-sim-speed]');
    for (var sb = 0; sb < simBtns.length; sb++) {
      var val = parseInt(simBtns[sb].getAttribute('data-sim-speed'), 10);
      simBtns[sb].className = (val === this.simSpeedMultiplier) ? 'btn btn-xs btn-primary' : 'btn btn-xs';
    }

    this._setDisabled('btnMachineRun', !connected || !isIdle);
    this._setDisabled('btnMachineRunFromHere', !connected || !isIdle);
    this._setDisabled('btnMachinePause', !busy);
    var btnPause = document.getElementById('btnMachinePause');
    if (btnPause) {
      btnPause.innerText = isHold ? '▶ Продолжи' : '⏸ Пауза';
      btnPause.className = isHold ? 'btn btn-xs btn-success' : 'btn btn-xs btn-warning';
    }
    this._setDisabled('btnMachineStop', !connected || (!busy && !isIdle));
    this._setDisabled('btnMachineReset', !connected || busy || (!isEstop && !this.lastError));

    var progFill = document.getElementById('machineProgressFill');
    var progText = document.getElementById('machineProgressText');
    var pct = 0;
    if (this.coords.totalLines > 0) {
      pct = Math.min(100, Math.round(((this.coords.lineNum || 0) / this.coords.totalLines) * 100));
    }
    if (progFill) progFill.style.width = pct + '%';
    if (progText) {
      if (hasTabJob) {
        progText.innerText = 'Линија: ' + (this.coords.lineNum || 0) + ' / ' + (this.coords.totalLines || 0) + ' (' + pct + '%)';
      } else if (busy) {
        progText.innerText = 'Позиционирање...';
      } else {
        progText.innerText = 'Подготвено';
      }
    }

    // 2D DRO без Z
    var droX = document.getElementById('droX');
    var droY = document.getElementById('droY');
    var droState = document.getElementById('droIOState');
    if (droX) droX.innerText = (this.coords.x || 0).toFixed(3);
    if (droY) droY.innerText = (this.coords.y || 0).toFixed(3);
    if (droState) {
      if (!connected) {
        droState.innerText = 'Исклучено';
      } else {
        var lowArr = Array.isArray(this.coords.loweredDispensers) ? this.coords.loweredDispensers : [];
        var dTxt = (lowArr.length > 0) ? ('⬇ Д:' + lowArr.join(',')) : '⬆ Горе';
        var vTxt = this.coords.valveOpen ? '💧 ОТВ' : '○ ЗАТ';
        droState.innerText = dTxt + ' | ' + vTxt;
      }
    }

    var manualLocked = !connected || !isIdle;
    this._setDisabled('btnZeroX', manualLocked);
    this._setDisabled('btnZeroY', manualLocked);
    this._setDisabled('btnZeroAll', manualLocked);
    this._setDisabled('btnMachineTeach', manualLocked || tabRO);
    this._setDisabled('btnMachineValve', manualLocked);
    this._setDisabled('btnMachinePulse100', manualLocked);
    this._setDisabled('btnRaiseAllDispensers', manualLocked);
    this._setDisabled('btnCmdHomeRef', manualLocked);
    this._setDisabled('btnCmdParkPos', manualLocked);

    // Освежи ги динамичките копчиња за диспензери и статус-беџот
    this.renderDispenserButtons();

    var dispBadge = document.getElementById('dispActiveBadge');
    if (dispBadge) {
      if (!connected) {
        dispBadge.innerText = '—';
        dispBadge.className = 'disp-status-pill';
      } else {
        var curLow = (this.coords && Array.isArray(this.coords.loweredDispensers)) ? this.coords.loweredDispensers : [];
        if (curLow.length > 0) {
          dispBadge.innerText = '⬇ Д' + curLow.join(',Д') + ' ДОЛЕ';
          dispBadge.className = 'disp-status-pill is-down';
        } else {
          dispBadge.innerText = '⬆ Горе';
          dispBadge.className = 'disp-status-pill is-up';
        }
      }
    }

    // Копче за вентил
    var btnValve = document.getElementById('btnMachineValve');
    if (btnValve) {
      var vOpen = !!(this.coords && this.coords.valveOpen);
      btnValve.innerText = vOpen ? '💧 Вентил: ОТВОРЕН' : '💧 Вентил: ЗАТВОРЕН';
      btnValve.className = vOpen ? 'btn btn-xs valve-btn valve-open' : 'btn btn-xs valve-btn';
    }

    // Тастатурни стрелки режим (Точки vs Машина)
    var btnKbdPts = document.getElementById('btnKbdModePoints');
    var btnKbdMach = document.getElementById('btnKbdModeMachine');
    var jogBox = document.getElementById('machineJogBox');
    if (btnKbdPts) {
      btnKbdPts.className = !this.keyboardJogMode ? 'btn btn-xs kbd-mode-btn active-points' : 'btn btn-xs kbd-mode-btn';
    }
    if (btnKbdMach) {
      btnKbdMach.disabled = manualLocked;
      btnKbdMach.className = this.keyboardJogMode ? 'btn btn-xs kbd-mode-btn active-machine' : 'btn btn-xs kbd-mode-btn';
    }
    if (jogBox) {
      if (this.keyboardJogMode) jogBox.classList.add('jog-kbd-active');
      else jogBox.classList.remove('jog-kbd-active');
    }

    var jogBtns = document.querySelectorAll('[data-jog-axis]');
    for (var jb = 0; jb < jogBtns.length; jb++) {
      jogBtns[jb].disabled = manualLocked;
    }

    // Копче „Оди на клик“ над платното
    var btnMoveClick = document.getElementById('btnToggleMoveToClick');
    if (btnMoveClick) {
      btnMoveClick.disabled = manualLocked;
      if (this.isMoveToClickMode && !manualLocked) {
        btnMoveClick.innerText = '🎯 Оди на клик: ВКЛ';
        btnMoveClick.className = 'btn btn-xs btn-moveclick-on';
      } else {
        btnMoveClick.innerText = '🎯 Оди на клик: ИСКЛ';
        btnMoveClick.className = 'btn btn-xs btn-moveclick-off';
      }
    }

    // Поставки на машина се глобално заклучени додека машината работи или се движи
    this._setDisabled('btnOpenSettings', busy);

    // Read-Only заштита само за тековниот таб ако тој таб работи на машината
    this._setDisabled('btnAddPoint', tabRO);
    this._setDisabled('btnPresetLine', tabRO);
    this._setDisabled('btnMoveUp', tabRO);
    this._setDisabled('btnMoveDown', tabRO);
    this._setDisabled('btnDeleteSelected', tabRO);
    this._setDisabled('btnUndo', tabRO);
    this._setDisabled('btnRedo', tabRO);
    this._setDisabled('btnApplyBatchValues', tabRO);
    this._setDisabled('btnSpeedMinus5', tabRO);
    this._setDisabled('btnSpeedPlus5', tabRO);
    this._setDisabled('btnTimeMinus5', tabRO);
    this._setDisabled('btnTimePlus5', tabRO);
    this._setDisabled('btnToggleAddMode', tabRO);
    this._setDisabled('btnLoadSvg', tabRO);
    this._setDisabled('btnClearSvg', tabRO);
    this._setDisabled('btnOpenTxt', tabRO);
    this._setDisabled('btnOpenLegacyCsv', tabRO);
    this._setDisabled('btnOpenProjectCsv', tabRO);
    this._setDisabled('btnCloseProject', tabRO);

    var tablePanel = document.getElementById('tablePanel');
    if (tablePanel) {
      if (tabRO) tablePanel.classList.add('table-readonly');
      else tablePanel.classList.remove('table-readonly');
    }
  }
};
