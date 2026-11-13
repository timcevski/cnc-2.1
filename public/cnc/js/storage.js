window.CNCApp = window.CNCApp || {};

CNCApp.Storage = {
  KEY: "CNC_DISPENSER_V20_STORAGE",
  _bootedWithoutLocalStorage: false,
  _loadedSlimLocalStorage: false,

  _buildPayload: function(stripInactiveSvgs) {
    var tabsPayload = [];
    var activeId = null;

    if (CNCApp.Tabs) {
      tabsPayload = CNCApp.Tabs.exportTabsForStorage(!!stripInactiveSvgs);
      activeId = CNCApp.Tabs.activeTabId;
    } else {
      tabsPayload = [{
        id: 'tab_default',
        projectName: CNCApp.State.projectName || 'Нов проект.csv',
        isDirty: !!CNCApp.State.isDirty,
        points: CNCApp.State.points || [],
        header: CNCApp.State.header || '',
        footer: CNCApp.State.footer,
        svgData: CNCApp.State.svgData || null
      }];
      activeId = 'tab_default';
    }

    return {
      version: '2.0',
      activeTabId: activeId,
      tabs: tabsPayload,
      machine: CNCApp.State.machine,
      stepIncrement: CNCApp.State.stepIncrement
    };
  },

  _isUntouchedDefaultDemo: function() {
    if (!this._bootedWithoutLocalStorage) return false;
    if (!CNCApp.Tabs || !Array.isArray(CNCApp.Tabs.tabs) || CNCApp.Tabs.tabs.length !== 1) return false;
    CNCApp.Tabs.syncFromState();
    var t = CNCApp.Tabs.tabs[0];
    if (!t || t.isDirty || t.svgData) return false;
    if ((t.projectName || 'Нов проект.csv') !== 'Нов проект.csv') return false;
    var pts = Array.isArray(t.points) ? t.points : [];
    if (pts.length !== 3) return false;
    return (
      pts[0].x === 10 && pts[0].y === 10 &&
      pts[1].x === 25 && pts[1].y === 20 &&
      pts[2].x === 35 && pts[2].y === 10
    );
  },

  _isNontrivialBackup: function(data) {
    if (!data || !Array.isArray(data.tabs) || data.tabs.length === 0) return false;
    if (data.tabs.length > 1) return true;
    var t0 = data.tabs[0];
    if (!t0) return false;
    if (t0.svgData || t0.isDirty) return true;
    if ((t0.projectName || 'Нов проект.csv') !== 'Нов проект.csv') return true;
    var pts = Array.isArray(t0.points) ? t0.points : [];
    if (pts.length !== 3) return true;
    return !(
      pts[0].x === 10 && pts[0].y === 10 &&
      pts[1].x === 25 && pts[1].y === 20 &&
      pts[2].x === 35 && pts[2].y === 10
    );
  },

  _fetchBridgeTemp: function(cb) {
    if (!CNCApp.Mach3BridgeDriver || !CNCApp.Mach3BridgeDriver.connected) {
      if (typeof cb === 'function') cb(null);
      return;
    }
    try {
      var xhr = new XMLHttpRequest();
      var finished = false;
      function done(res) {
        if (finished) return;
        finished = true;
        if (typeof cb === 'function') cb(res);
      }
      xhr.open('GET', CNCApp.Mach3BridgeDriver.baseUrl + '/temp/autosave', true);
      xhr.timeout = 2500;
      xhr.onreadystatechange = function() {
        if (xhr.readyState !== 4) return;
        if (xhr.status >= 200 && xhr.status < 300 && xhr.responseText) {
          try {
            var parsed = JSON.parse(xhr.responseText);
            if (parsed && Array.isArray(parsed.tabs) && parsed.tabs.length > 0) {
              done(parsed);
              return;
            }
          } catch (e) {}
        }
        done(null);
      };
      xhr.ontimeout = function() { done(null); };
      xhr.onerror = function() { done(null); };
      xhr.send();
    } catch (e) {
      if (typeof cb === 'function') cb(null);
    }
  },

  saveToBridgeTemp: function(payloadObj) {
    if (!CNCApp.Mach3BridgeDriver || !CNCApp.Mach3BridgeDriver.connected) return;
    if (!CNCApp.Machine || CNCApp.Machine.activeDriverId !== 'mach3') return;
    try {
      var fullPayload = payloadObj || this._buildPayload(false);
      var xhr = new XMLHttpRequest();
      xhr.open('POST', CNCApp.Mach3BridgeDriver.baseUrl + '/temp/autosave', true);
      xhr.timeout = 2500;
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify(fullPayload));
    } catch (e) {}
  },

  syncOrRecoverBridgeTemp: function(cb) {
    if (!CNCApp.Mach3BridgeDriver || !CNCApp.Mach3BridgeDriver.connected) {
      if (typeof cb === 'function') cb(false);
      return;
    }
    if (!CNCApp.Machine || CNCApp.Machine.activeDriverId !== 'mach3') {
      if (typeof cb === 'function') cb(false);
      return;
    }

    var self = this;

    if (this._isUntouchedDefaultDemo()) {
      this._fetchBridgeTemp(function(diskData) {
        if (!self._isUntouchedDefaultDemo()) {
          self._bootedWithoutLocalStorage = false;
          self.saveToBridgeTemp();
          if (typeof cb === 'function') cb(false);
          return;
        }

        if (self._isNontrivialBackup(diskData)) {
          var tabCount = diskData.tabs.length;
          var ask = confirm(
            '💾 Пронајдена е резервна копија на диск (./temp/tabs_autosave.json) со ' + tabCount + ' таб(а).\n\n' +
            'Прелистувачот немаше зачувана состојба во localStorage (пр. по пад или во Incognito).\n' +
            'Дали сакате да ги вратите проектите од диск?'
          );
          if (ask) {
            if (diskData.machine) {
              self.migrateMachineSettings(diskData.machine);
            }
            if (diskData.stepIncrement) {
              CNCApp.State.stepIncrement = diskData.stepIncrement;
            }
            if (CNCApp.Tabs) {
              for (var i = 0; i < diskData.tabs.length; i++) {
                diskData.tabs[i].footer = self.migrateFooter(diskData.tabs[i].footer);
              }
              CNCApp.Tabs.restoreFromStorage(diskData.tabs, diskData.activeTabId);
            }
            if (CNCApp.Mach3BridgeDriver && CNCApp.Mach3BridgeDriver.connected && typeof CNCApp.Mach3BridgeDriver.syncConfig === 'function') {
              CNCApp.Mach3BridgeDriver.syncConfig();
            }
            self._bootedWithoutLocalStorage = false;
            self._loadedSlimLocalStorage = false;
            self.saveAutoSave();
            if (typeof cb === 'function') cb(true);
            return;
          }
        }

        self._bootedWithoutLocalStorage = false;
        self.saveToBridgeTemp();
        if (typeof cb === 'function') cb(false);
      });
      return;
    }

    if (this._loadedSlimLocalStorage && CNCApp.Tabs) {
      this._fetchBridgeTemp(function(diskData) {
        if (diskData && Array.isArray(diskData.tabs)) {
          var diskMap = {};
          for (var i = 0; i < diskData.tabs.length; i++) {
            var dt = diskData.tabs[i];
            if (dt && dt.id) diskMap[dt.id] = dt;
          }
          for (var j = 0; j < CNCApp.Tabs.tabs.length; j++) {
            var curTab = CNCApp.Tabs.tabs[j];
            var match = diskMap[curTab.id];
            if (!curTab.svgData && match && match.svgData) {
              curTab.svgData = match.svgData;
              CNCApp.Tabs.hydrateSvgForTab(curTab);
            }
          }
        }
        self._bootedWithoutLocalStorage = false;
        self._loadedSlimLocalStorage = false;
        self.saveToBridgeTemp();
        if (typeof cb === 'function') cb(false);
      });
      return;
    }

    this._bootedWithoutLocalStorage = false;
    this.saveToBridgeTemp();
    if (typeof cb === 'function') cb(false);
  },

  saveAutoSave: function() {
    var payload = this._buildPayload(false);

    try {
      localStorage.setItem(this.KEY, JSON.stringify(payload));
      this._loadedSlimLocalStorage = false;
    } catch (e) {
      // Заштита од надминување на 5MB localStorage лимит: зачувај без SVG на неактивните табови
      try {
        if (CNCApp.Tabs) {
          var slimPayload = this._buildPayload(true);
          slimPayload._slimmed = true;
          localStorage.setItem(this.KEY, JSON.stringify(slimPayload));
          this._loadedSlimLocalStorage = true;
        }
      } catch (e2) {}
    }

    // Ако работи Mach3Bridge.exe, запиши целосна копија (со сите SVG) во ./temp/tabs_autosave.json
    this.saveToBridgeTemp(payload);
  },

  migrateMachineSettings: function(machine) {
    if (machine && Array.isArray(machine.dispensers)) {
      var d1 = machine.dispensers[0];
      if (d1 && (d1.offsetX === 0.8 || d1.offsetX === -0.4 || d1.offsetY === 36 || d1.offsetY === 34.55)) {
        machine.dispensers = [
          { id: 1, name: "Боја 1", color: "#2563eb", lowerCmd: "M104", raiseCmd: "M204", offsetX: -0.30, offsetY: 34.45 },
          { id: 2, name: "Боја 2", color: "#059669", lowerCmd: "M105", raiseCmd: "M205", offsetX: 39.70, offsetY: 34.45 },
          { id: 3, name: "Боја 3", color: "#dc2626", lowerCmd: "M106", raiseCmd: "M206", offsetX: 79.70, offsetY: 34.45 },
          { id: 4, name: "Боја 4", color: "#d97706", lowerCmd: "M107", raiseCmd: "M207", offsetX: 119.70, offsetY: 34.45 },
          { id: 5, name: "Боја 5", color: "#7c3aed", lowerCmd: "M108", raiseCmd: "M208", offsetX: 159.70, offsetY: 34.45 }
        ];
      }
      CNCApp.State.machine = machine;
      if (typeof CNCApp.State.normalizeMachineConfig === 'function') {
        CNCApp.State.normalizeMachineConfig();
      }
    }
  },

  migrateFooter: function(footerStr) {
    if (!footerStr || footerStr === 'G28.1 X2 Y2;M5;M30' || footerStr.indexOf('G1 X1 Y1 F2000') === -1) {
      return "G28.1 X2 Y2\r\nG1 X1 Y1 F2000\r\nM5\r\nM30";
    }
    return footerStr;
  },

  loadAutoSave: function() {
    this._bootedWithoutLocalStorage = false;
    this._loadedSlimLocalStorage = false;

    try {
      var raw = localStorage.getItem(this.KEY)
        || localStorage.getItem("CNC_DISPENSER_V19_STORAGE")
        || localStorage.getItem("CNC_DISPENSER_V185_STORAGE")
        || localStorage.getItem("CNC_DISPENSER_V161_AUTOSAVE");
      if (!raw) {
        this._bootedWithoutLocalStorage = true;
        return false;
      }
      var data = JSON.parse(raw);

      if (data.machine) {
        this.migrateMachineSettings(data.machine);
      }
      if (data.stepIncrement) {
        CNCApp.State.stepIncrement = data.stepIncrement;
      }

      // Нов V2.0 мулти-таб формат
      if (Array.isArray(data.tabs) && data.tabs.length > 0 && CNCApp.Tabs) {
        this._bootedWithoutLocalStorage = false;
        this._loadedSlimLocalStorage = !!data._slimmed;
        for (var i = 0; i < data.tabs.length; i++) {
          data.tabs[i].footer = this.migrateFooter(data.tabs[i].footer);
        }
        CNCApp.Tabs.restoreFromStorage(data.tabs, data.activeTabId);
        return true;
      }

      // Наследен V1.x формат (еден проект)
      if (data.points && data.points.length > 0) {
        this._bootedWithoutLocalStorage = false;
        this._loadedSlimLocalStorage = !!data._slimmed;
        var migratedFooter = this.migrateFooter(data.footer);
        if (CNCApp.Tabs) {
          CNCApp.Tabs.restoreFromStorage([{
            id: 'tab_migrated',
            projectName: data.projectName || 'Нов проект.csv',
            isDirty: !!data.isDirty,
            points: data.points,
            header: data.header || '',
            footer: migratedFooter,
            svgData: data.svgData || null
          }], 'tab_migrated');
          return true;
        }

        CNCApp.State.points = data.points;
        CNCApp.State.header = data.header || '';
        CNCApp.State.footer = migratedFooter;
        if (data.projectName) CNCApp.State.projectName = data.projectName;
        CNCApp.State.isDirty = !!data.isDirty;
        if (data.svgData) CNCApp.Parser.loadSvgContent(data.svgData);
        if (typeof CNCApp.State.updateProjectUI === 'function') CNCApp.State.updateProjectUI();
        return true;
      }
    } catch (e) {}

    this._bootedWithoutLocalStorage = true;
    return false;
  }
};