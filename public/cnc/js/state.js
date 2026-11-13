window.CNCApp = window.CNCApp || {};

CNCApp.State = {
  points: [],
  selectedIndices: new Set(),
  activePointIndex: null,
  lastSelectedRowIndex: null,
  header: '',
  footer: 'G28.1 X2 Y2\r\nG1 X1 Y1 F2000\r\nM5\r\nM30',
  svgData: null,
  svgImage: null,
  svgObjectUrl: null,
  history: [],
  historyIndex: -1,
  isAddMode: false,
  stepIncrement: 0.05,
  shadedDispensers: new Set(),
  showClearanceRings: true,
  showSvg: true,

  machine: {
    name: "Стандардна Машина (5 Диспензери)",
    systemDelayLower: 150,
    systemDelayRaise: 150,
    mCommandLatency: 120,
    valveOpenCmd: "M103",
    valveCloseCmd: "M203",
    timeUnit: "ms",
    decimalSeparator: ".",
    minX: -5,
    maxX: 350,
    minY: -5,
    maxY: 300,
    moveClickSpeed: 3000,
    dispensers: [
      { id: 1, name: "Боја 1", color: "#2563eb", lowerCmd: "M104", raiseCmd: "M204", offsetX: -0.30, offsetY: 34.45 },
      { id: 2, name: "Боја 2", color: "#059669", lowerCmd: "M105", raiseCmd: "M205", offsetX: 39.70, offsetY: 34.45 },
      { id: 3, name: "Боја 3", color: "#dc2626", lowerCmd: "M106", raiseCmd: "M206", offsetX: 79.70, offsetY: 34.45 },
      { id: 4, name: "Боја 4", color: "#d97706", lowerCmd: "M107", raiseCmd: "M207", offsetX: 119.70, offsetY: 34.45 },
      { id: 5, name: "Боја 5", color: "#7c3aed", lowerCmd: "M108", raiseCmd: "M208", offsetX: 159.70, offsetY: 34.45 }
    ]
  },

  normalizeMachineConfig: function() {
    var m = this.machine;
    if (!m) return;
    if (typeof m.minX !== 'number' || isNaN(m.minX)) m.minX = -5;
    if (typeof m.maxX !== 'number' || isNaN(m.maxX) || m.maxX <= m.minX) m.maxX = 350;
    if (typeof m.minY !== 'number' || isNaN(m.minY)) m.minY = -5;
    if (typeof m.maxY !== 'number' || isNaN(m.maxY) || m.maxY <= m.minY) m.maxY = 300;
    if (typeof m.moveClickSpeed !== 'number' || isNaN(m.moveClickSpeed) || m.moveClickSpeed <= 0) m.moveClickSpeed = 3000;
  },

  createPoint: function(x, y, refPt) {
    const inheritedDispenser = (refPt && refPt.dispenser) ? refPt.dispenser : 1;
    const inheritedSpeed = (refPt && refPt.speed) ? refPt.speed : 1000;
    const inheritedGroup1 = (refPt && refPt.group1) ? refPt.group1 : '';
    const inheritedGroup2 = (refPt && refPt.group2) ? refPt.group2 : '';

    return {
      active: true,
      x: parseFloat(parseFloat(x || 0).toFixed(3)),
      y: parseFloat(parseFloat(y || 0).toFixed(3)),
      speed: inheritedSpeed,
      lower: true,
      valveStart: true,
      time: '',
      valveStop: true,
      raise: true,
      dispenser: inheritedDispenser,
      group1: inheritedGroup1,
      group2: inheritedGroup2
    };
  },

  projectName: 'Нов проект.csv',
  isDirty: false,

  isActiveTabReadOnly: function() {
    if (CNCApp.Machine && typeof CNCApp.Machine.isActiveTabReadOnly === 'function') {
      return CNCApp.Machine.isActiveTabReadOnly();
    }
    if (CNCApp.Tabs) {
      var tab = CNCApp.Tabs.getActiveTab();
      return !!(tab && tab.isRunningOnMachine);
    }
    return false;
  },

  setProjectName: function(name) {
    if (!name || !name.trim()) name = 'Нов проект.csv';
    name = name.trim();
    if (!name.toLowerCase().endsWith('.csv') && !name.toLowerCase().endsWith('.txt')) {
      name += '.csv';
    }
    this.projectName = name;
    this.updateProjectUI();
    if (CNCApp.Tabs) {
      CNCApp.Tabs.syncFromState();
      CNCApp.Tabs.renderTabBar();
    }
    if (CNCApp.Storage) CNCApp.Storage.saveAutoSave();
  },

  markDirty: function(dirty = true) {
    this.isDirty = dirty;
    this.updateProjectUI();
    if (CNCApp.Tabs) {
      CNCApp.Tabs.syncFromState();
      CNCApp.Tabs.renderTabBar();
    }
  },

  updateProjectUI: function() {
    const nameEl = document.getElementById('projectNameDisplay');
    const statusEl = document.getElementById('projectSaveStatus');
    const btnSave = document.getElementById('btnSaveProjectCsv');

    if (nameEl) {
      nameEl.innerText = this.projectName || 'Нов проект.csv';
    }

    if (statusEl) {
      if (this.isDirty) {
        statusEl.className = 'proj-status unsaved';
        statusEl.innerHTML = '● Незачувано';
        statusEl.title = 'Имате незачувани измени на дискот/USB!';
      } else {
        statusEl.className = 'proj-status saved';
        statusEl.innerHTML = '✔ Зачувано';
        statusEl.title = 'Сите измени се зачувани во датотеката.';
      }
    }

    if (btnSave) {
      if (this.isDirty) {
        btnSave.classList.add('btn-save-dirty');
        btnSave.title = 'Сними ги незачуваните измени во датотеката (Ctrl+S)';
      } else {
        btnSave.classList.remove('btn-save-dirty');
        btnSave.title = 'Сними Проект (.csv)';
      }
    }
  },

  snapshot: function() {
    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1);
    }
    this.history.push(JSON.stringify(this.points));
    if (this.history.length > 50) this.history.shift();
    this.historyIndex = this.history.length - 1;
    this.markDirty(true);
    if (CNCApp.Storage) CNCApp.Storage.saveAutoSave();
  },

  undo: function() {
    if (this.isActiveTabReadOnly()) return;
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.points = JSON.parse(this.history[this.historyIndex]);
      this.markDirty(true);
      if (CNCApp.Storage) CNCApp.Storage.saveAutoSave();
      CNCApp.Table.render();
      CNCApp.Canvas.render();
    }
  },

  redo: function() {
    if (this.isActiveTabReadOnly()) return;
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.points = JSON.parse(this.history[this.historyIndex]);
      this.markDirty(true);
      if (CNCApp.Storage) CNCApp.Storage.saveAutoSave();
      CNCApp.Table.render();
      CNCApp.Canvas.render();
    }
  }
};