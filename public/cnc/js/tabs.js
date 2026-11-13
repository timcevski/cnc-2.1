window.CNCApp = window.CNCApp || {};

CNCApp.Tabs = {
  tabs: [],
  activeTabId: null,
  _idCounter: 1,
  DEFAULT_FOOTER: "G28.1 X2 Y2\r\nG1 X1 Y1 F2000\r\nM5\r\nM30",

  generateId: function() {
    var id = "tab_" + Date.now() + "_" + this._idCounter;
    this._idCounter++;
    return id;
  },

  suggestNewProjectName: function() {
    var base = "Нов проект.csv";
    var exists = false;
    for (var i = 0; i < this.tabs.length; i++) {
      if (this.tabs[i].projectName === base) {
        exists = true;
        break;
      }
    }
    if (!exists) return base;

    var num = 2;
    while (num < 100) {
      var candidate = "Нов проект " + num + ".csv";
      var found = false;
      for (var j = 0; j < this.tabs.length; j++) {
        if (this.tabs[j].projectName === candidate) {
          found = true;
          break;
        }
      }
      if (!found) return candidate;
      num++;
    }
    return "Нов проект " + this._idCounter + ".csv";
  },

  createTabRecord: function(overrides) {
    var opts = overrides || {};
    var pts = Array.isArray(opts.points) ? opts.points : [];
    var hist = Array.isArray(opts.history) && opts.history.length > 0
      ? opts.history
      : [JSON.stringify(pts)];
    var histIdx = (typeof opts.historyIndex === 'number' && opts.historyIndex >= 0)
      ? opts.historyIndex
      : (hist.length - 1);

    return {
      id: opts.id || this.generateId(),
      projectName: opts.projectName || this.suggestNewProjectName(),
      isDirty: !!opts.isDirty,
      isRunningOnMachine: !!opts.isRunningOnMachine,
      points: pts,
      header: opts.header || '',
      footer: (opts.footer !== undefined && opts.footer !== null) ? opts.footer : this.DEFAULT_FOOTER,
      svgData: opts.svgData || null,
      svgImage: opts.svgImage || null,
      svgObjectUrl: opts.svgObjectUrl || null,
      showSvg: opts.showSvg !== false,
      showClearanceRings: opts.showClearanceRings !== false,
      isAddMode: !!opts.isAddMode,
      selectedIndices: Array.isArray(opts.selectedIndices) ? opts.selectedIndices.slice() : [],
      activePointIndex: (opts.activePointIndex !== undefined) ? opts.activePointIndex : null,
      lastSelectedRowIndex: (opts.lastSelectedRowIndex !== undefined) ? opts.lastSelectedRowIndex : null,
      shadedDispensers: Array.isArray(opts.shadedDispensers) ? opts.shadedDispensers.slice() : [],
      history: hist,
      historyIndex: histIdx,
      viewState: opts.viewState || null
    };
  },

  getActiveTab: function() {
    for (var i = 0; i < this.tabs.length; i++) {
      if (this.tabs[i].id === this.activeTabId) return this.tabs[i];
    }
    return this.tabs.length > 0 ? this.tabs[0] : null;
  },

  getTabById: function(tabId) {
    for (var i = 0; i < this.tabs.length; i++) {
      if (this.tabs[i].id === tabId) return this.tabs[i];
    }
    return null;
  },

  syncFromState: function() {
    var tab = this.getActiveTab();
    if (!tab) return;

    tab.projectName = CNCApp.State.projectName || 'Нов проект.csv';
    tab.isDirty = !!CNCApp.State.isDirty;
    tab.points = CNCApp.State.points || [];
    tab.header = CNCApp.State.header || '';
    tab.footer = (CNCApp.State.footer !== undefined && CNCApp.State.footer !== null)
      ? CNCApp.State.footer
      : this.DEFAULT_FOOTER;
    tab.svgData = CNCApp.State.svgData || null;
    tab.svgImage = CNCApp.State.svgImage || null;
    tab.svgObjectUrl = CNCApp.State.svgObjectUrl || null;
    tab.showSvg = CNCApp.State.showSvg !== false;
    tab.showClearanceRings = CNCApp.State.showClearanceRings !== false;
    tab.isAddMode = !!CNCApp.State.isAddMode;
    tab.selectedIndices = CNCApp.State.selectedIndices ? Array.from(CNCApp.State.selectedIndices) : [];
    tab.activePointIndex = CNCApp.State.activePointIndex;
    tab.lastSelectedRowIndex = CNCApp.State.lastSelectedRowIndex;
    tab.shadedDispensers = CNCApp.State.shadedDispensers ? Array.from(CNCApp.State.shadedDispensers) : [];
    tab.history = CNCApp.State.history || [JSON.stringify(tab.points)];
    tab.historyIndex = (typeof CNCApp.State.historyIndex === 'number') ? CNCApp.State.historyIndex : 0;

    if (CNCApp.Canvas && CNCApp.Canvas.canvas) {
      tab.viewState = {
        scale: CNCApp.Canvas.scale,
        panX: CNCApp.Canvas.panX,
        panY: CNCApp.Canvas.panY
      };
    }
  },

  applyTabToState: function(tab, options) {
    if (!tab) return;
    var opts = options || {};

    this.activeTabId = tab.id;
    CNCApp.State.projectName = tab.projectName || 'Нов проект.csv';
    CNCApp.State.isDirty = !!tab.isDirty;
    CNCApp.State.points = tab.points || [];
    CNCApp.State.header = tab.header || '';
    CNCApp.State.footer = (tab.footer !== undefined && tab.footer !== null) ? tab.footer : this.DEFAULT_FOOTER;
    CNCApp.State.svgData = tab.svgData || null;
    CNCApp.State.svgImage = tab.svgImage || null;
    CNCApp.State.svgObjectUrl = tab.svgObjectUrl || null;
    CNCApp.State.showSvg = tab.showSvg !== false;
    CNCApp.State.showClearanceRings = tab.showClearanceRings !== false;
    CNCApp.State.isAddMode = !!tab.isAddMode;
    CNCApp.State.selectedIndices = new Set(tab.selectedIndices || []);
    CNCApp.State.activePointIndex = (tab.activePointIndex !== undefined) ? tab.activePointIndex : null;
    CNCApp.State.lastSelectedRowIndex = (tab.lastSelectedRowIndex !== undefined) ? tab.lastSelectedRowIndex : null;
    CNCApp.State.shadedDispensers = new Set(tab.shadedDispensers || []);
    CNCApp.State.history = (tab.history && tab.history.length > 0) ? tab.history : [JSON.stringify(CNCApp.State.points)];
    CNCApp.State.historyIndex = (typeof tab.historyIndex === 'number' && tab.historyIndex >= 0)
      ? tab.historyIndex
      : (CNCApp.State.history.length - 1);

    if (CNCApp.Canvas) {
      CNCApp.Canvas.isDragging = false;
      CNCApp.Canvas.isPanning = false;
      CNCApp.Canvas.isBoxSelecting = false;
      CNCApp.Canvas.draggedIndex = null;
      if (CNCApp.Canvas.dragStartPoints) CNCApp.Canvas.dragStartPoints.clear();
    }

    if (typeof CNCApp.State.updateProjectUI === 'function') {
      CNCApp.State.updateProjectUI();
    }
    if (CNCApp.App && typeof CNCApp.App.refreshToolbarStates === 'function') {
      CNCApp.App.refreshToolbarStates();
    }
    if (CNCApp.Table) {
      CNCApp.Table.render();
    }
    if (CNCApp.Canvas && CNCApp.Canvas.canvas) {
      if (tab.viewState && !opts.forceResetView) {
        CNCApp.Canvas.scale = tab.viewState.scale || 15;
        CNCApp.Canvas.panX = tab.viewState.panX || 50;
        CNCApp.Canvas.panY = tab.viewState.panY || (CNCApp.Canvas.canvas.height - 50);
        CNCApp.Canvas.render();
      } else {
        CNCApp.Canvas.resetView();
      }
    }
    this.renderTabBar();
  },

  revokeTabSvgUrl: function(tab) {
    if (tab && tab.svgObjectUrl) {
      try {
        URL.revokeObjectURL(tab.svgObjectUrl);
      } catch (e) {}
      tab.svgObjectUrl = null;
    }
  },

  hydrateSvgForTab: function(tab) {
    if (!tab || !tab.svgData) return;
    var self = this;
    this.revokeTabSvgUrl(tab);

    try {
      var blob = new Blob([tab.svgData], { type: 'image/svg+xml;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var img = new Image();
      tab.svgObjectUrl = url;
      img.onload = function() {
        tab.svgImage = img;
        if (tab.id === self.activeTabId) {
          CNCApp.State.svgData = tab.svgData;
          CNCApp.State.svgImage = img;
          CNCApp.State.svgObjectUrl = url;
          if (typeof CNCApp.updateSvgToggleUI === 'function') {
            CNCApp.updateSvgToggleUI();
          }
          if (CNCApp.Canvas && CNCApp.Canvas.canvas) {
            if (tab.viewState) {
              CNCApp.Canvas.render();
            } else {
              CNCApp.Canvas.resetView();
            }
          }
        }
      };
      img.src = url;
    } catch (e) {}
  },

  initWithDefaultDemo: function() {
    var pts = [
      CNCApp.State.createPoint(10, 10),
      CNCApp.State.createPoint(25, 20),
      CNCApp.State.createPoint(35, 10)
    ];
    var firstTab = this.createTabRecord({
      projectName: 'Нов проект.csv',
      isDirty: false,
      points: pts,
      history: [JSON.stringify(pts)],
      historyIndex: 0
    });
    this.tabs = [firstTab];
    this.applyTabToState(firstTab, { forceResetView: true });
    if (CNCApp.Storage) CNCApp.Storage.saveAutoSave();
  },

  restoreFromStorage: function(savedTabs, activeId) {
    var self = this;
    // Ослободи постоечки URL-и ако има
    for (var k = 0; k < this.tabs.length; k++) {
      this.revokeTabSvgUrl(this.tabs[k]);
    }
    this.tabs = [];

    for (var i = 0; i < savedTabs.length; i++) {
      var st = savedTabs[i];
      var pts = Array.isArray(st.points) ? st.points : [];
      var tab = this.createTabRecord({
        id: st.id || this.generateId(),
        projectName: st.projectName || 'Нов проект.csv',
        isDirty: !!st.isDirty,
        isRunningOnMachine: false,
        points: pts,
        header: st.header || '',
        footer: (st.footer !== undefined && st.footer !== null) ? st.footer : this.DEFAULT_FOOTER,
        svgData: st.svgData || null,
        showSvg: st.showSvg !== false,
        showClearanceRings: st.showClearanceRings !== false,
        isAddMode: !!st.isAddMode,
        selectedIndices: Array.isArray(st.selectedIndices) ? st.selectedIndices : [],
        activePointIndex: (st.activePointIndex !== undefined) ? st.activePointIndex : null,
        lastSelectedRowIndex: (st.lastSelectedRowIndex !== undefined) ? st.lastSelectedRowIndex : null,
        shadedDispensers: Array.isArray(st.shadedDispensers) ? st.shadedDispensers : [],
        history: [JSON.stringify(pts)],
        historyIndex: 0,
        viewState: st.viewState || null
      });
      this.tabs.push(tab);
    }

    if (this.tabs.length === 0) {
      this.initWithDefaultDemo();
      return;
    }

    var target = this.getTabById(activeId) || this.tabs[0];
    this.applyTabToState(target);

    for (var j = 0; j < this.tabs.length; j++) {
      if (this.tabs[j].svgData) {
        this.hydrateSvgForTab(this.tabs[j]);
      }
    }
  },

  switchTab: function(tabId) {
    if (!tabId || tabId === this.activeTabId) return;
    if (CNCApp.App && typeof CNCApp.App.isTabSwitchLocked === 'function' && CNCApp.App.isTabSwitchLocked()) {
      alert("⛔ Строг производствен режим: менувањето табови е заклучено додека машината активно работи.");
      return;
    }

    var target = this.getTabById(tabId);
    if (!target) return;

    this.syncFromState();
    this.applyTabToState(target);
    if (CNCApp.Storage) CNCApp.Storage.saveAutoSave();
  },

  newTab: function(switchNow) {
    if (CNCApp.App && typeof CNCApp.App.isTabSwitchLocked === 'function' && CNCApp.App.isTabSwitchLocked()) {
      alert("⛔ Строг производствен режим: не може да се отвори нов таб додека машината активно работи.");
      return null;
    }
    this.syncFromState();
    var tab = this.createTabRecord({
      projectName: this.suggestNewProjectName(),
      isDirty: false,
      points: [],
      history: ['[]'],
      historyIndex: 0
    });
    this.tabs.push(tab);
    if (switchNow !== false) {
      this.applyTabToState(tab, { forceResetView: true });
    } else {
      this.renderTabBar();
    }
    if (CNCApp.Storage) CNCApp.Storage.saveAutoSave();
    return tab;
  },

  closeTab: function(tabId, forceDiscard) {
    var targetId = tabId || this.activeTabId;
    var tab = this.getTabById(targetId);
    if (!tab) return;

    if (tab.isRunningOnMachine) {
      alert("⛔ Проектот \"" + tab.projectName + "\" моментално работи на машината и не може да се затвори додека не заврши!");
      return;
    }

    this.syncFromState();
    tab = this.getTabById(targetId);

    if (!forceDiscard && tab.isDirty) {
      var self = this;
      if (targetId !== this.activeTabId) {
        this.applyTabToState(tab);
      }
      if (CNCApp.App && typeof CNCApp.App.openUnsavedModal === 'function') {
        CNCApp.App.openUnsavedModal(
          "Затворање на проект",
          "Проектот <strong>\"" + this.escapeHtml(tab.projectName) + "\"</strong> има незачувани измени.<br>Дали сакате да ги зачувате промените пред да го затворите?",
          function() {
            self.closeTab(targetId, true);
          }
        );
        return;
      }
    }

    this.revokeTabSvgUrl(tab);

    if (this.tabs.length <= 1) {
      // Последен таб: затвори го тековниот проект и отвори чист празен проект
      var fresh = this.createTabRecord({
        id: tab.id,
        projectName: 'Нов проект.csv',
        isDirty: false,
        points: [],
        history: ['[]'],
        historyIndex: 0
      });
      this.tabs[0] = fresh;
      this.applyTabToState(fresh, { forceResetView: true });
      if (CNCApp.Storage) CNCApp.Storage.saveAutoSave();
      return;
    }

    var idxToRemove = -1;
    for (var i = 0; i < this.tabs.length; i++) {
      if (this.tabs[i].id === targetId) {
        idxToRemove = i;
        break;
      }
    }
    if (idxToRemove === -1) return;

    this.tabs.splice(idxToRemove, 1);

    if (targetId === this.activeTabId) {
      var nextIdx = idxToRemove < this.tabs.length ? idxToRemove : (this.tabs.length - 1);
      this.applyTabToState(this.tabs[nextIdx]);
    } else {
      this.renderTabBar();
    }

    if (CNCApp.Storage) CNCApp.Storage.saveAutoSave();
  },

  resetActiveTabForLoadedData: function(opts) {
    var options = opts || {};
    var tab = this.getActiveTab();
    if (!tab) return;

    if (options.clearSvg) {
      this.revokeTabSvgUrl(tab);
      CNCApp.State.svgData = null;
      CNCApp.State.svgImage = null;
      CNCApp.State.svgObjectUrl = null;
      CNCApp.State.showSvg = true;
    }

    CNCApp.State.points = options.points || [];
    if (options.header !== undefined) CNCApp.State.header = options.header;
    if (options.footer !== undefined && options.footer !== '') {
      CNCApp.State.footer = options.footer;
    } else if (options.footer === '') {
      CNCApp.State.footer = this.DEFAULT_FOOTER;
    }

    CNCApp.State.selectedIndices = new Set();
    CNCApp.State.activePointIndex = null;
    CNCApp.State.lastSelectedRowIndex = null;
    CNCApp.State.shadedDispensers = new Set();
    CNCApp.State.isAddMode = false;
    CNCApp.State.history = [JSON.stringify(CNCApp.State.points)];
    CNCApp.State.historyIndex = 0;

    if (options.projectName) {
      CNCApp.State.projectName = options.projectName;
    }
    CNCApp.State.isDirty = false;
    tab.viewState = null;

    this.syncFromState();

    if (typeof CNCApp.State.updateProjectUI === 'function') CNCApp.State.updateProjectUI();
    if (CNCApp.App && typeof CNCApp.App.refreshToolbarStates === 'function') {
      CNCApp.App.refreshToolbarStates();
    }
    if (CNCApp.Table) CNCApp.Table.render();
    if (CNCApp.Canvas) CNCApp.Canvas.resetView();
    this.renderTabBar();
    if (CNCApp.Storage) CNCApp.Storage.saveAutoSave();
  },

  hasAnyUnsavedChanges: function() {
    this.syncFromState();
    for (var i = 0; i < this.tabs.length; i++) {
      if (this.tabs[i].isDirty) return true;
    }
    return false;
  },

  exportTabsForStorage: function(stripInactiveSvgs) {
    this.syncFromState();
    var out = [];
    for (var i = 0; i < this.tabs.length; i++) {
      var t = this.tabs[i];
      var isActive = (t.id === this.activeTabId);
      out.push({
        id: t.id,
        projectName: t.projectName,
        isDirty: !!t.isDirty,
        points: t.points || [],
        header: t.header || '',
        footer: t.footer,
        svgData: (stripInactiveSvgs && !isActive) ? null : (t.svgData || null),
        showSvg: t.showSvg !== false,
        showClearanceRings: t.showClearanceRings !== false,
        isAddMode: !!t.isAddMode,
        selectedIndices: t.selectedIndices || [],
        activePointIndex: t.activePointIndex,
        lastSelectedRowIndex: t.lastSelectedRowIndex,
        shadedDispensers: t.shadedDispensers || [],
        viewState: t.viewState || null
      });
    }
    return out;
  },

  escapeHtml: function(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  renderTabBar: function() {
    var listEl = document.getElementById('tabsList');
    if (!listEl) return;

    listEl.innerHTML = '';
    var self = this;

    for (var i = 0; i < this.tabs.length; i++) {
      (function(tab) {
        var isActive = (tab.id === self.activeTabId);
        var tabEl = document.createElement('div');
        tabEl.className = 'tab-item' + (isActive ? ' active' : '') + (tab.isRunningOnMachine ? ' running' : '');
        tabEl.title = tab.projectName + (tab.isDirty ? ' (Незачувани измени)' : '') + ' — Двоен клик за преименување';

        if (tab.isRunningOnMachine) {
          var lockSpan = document.createElement('span');
          lockSpan.className = 'tab-lock-icon';
          lockSpan.innerText = '🔒';
          lockSpan.title = 'Овој проект моментално се извршува на машината';
          tabEl.appendChild(lockSpan);
        }

        var titleSpan = document.createElement('span');
        titleSpan.className = 'tab-title';
        titleSpan.innerText = tab.projectName || 'Нов проект.csv';
        tabEl.appendChild(titleSpan);

        var countSpan = document.createElement('span');
        countSpan.className = 'tab-count';
        var ptsLen = (isActive && CNCApp.State.points) ? CNCApp.State.points.length : (tab.points ? tab.points.length : 0);
        countSpan.innerText = '(' + ptsLen + ')';
        tabEl.appendChild(countSpan);

        var dirtyNow = isActive ? !!CNCApp.State.isDirty : !!tab.isDirty;
        if (dirtyNow) {
          var dotSpan = document.createElement('span');
          dotSpan.className = 'tab-dirty-dot';
          dotSpan.innerText = '●';
          dotSpan.title = 'Незачувани измени';
          tabEl.appendChild(dotSpan);
        }

        var closeBtn = document.createElement('button');
        closeBtn.className = 'tab-close-btn';
        closeBtn.type = 'button';
        closeBtn.innerHTML = '&times;';
        closeBtn.title = 'Затвори проект';
        closeBtn.onclick = function(e) {
          e.stopPropagation();
          self.closeTab(tab.id, false);
        };
        tabEl.appendChild(closeBtn);

        tabEl.onclick = function() {
          self.switchTab(tab.id);
        };

        tabEl.ondblclick = function(e) {
          if (e.target === closeBtn) return;
          if (tab.isRunningOnMachine) {
            alert('🔒 Не може да се преименува таб додека активно работи на машината.');
            return;
          }
          if (tab.id !== self.activeTabId) {
            self.switchTab(tab.id);
            if (tab.id !== self.activeTabId) return;
          }
          var entered = prompt('Внесете ново име за проектот:', tab.projectName || 'Нов проект.csv');
          if (entered && entered.trim()) {
            CNCApp.State.setProjectName(entered.trim());
            CNCApp.State.markDirty(true);
            if (CNCApp.Storage) CNCApp.Storage.saveAutoSave();
          }
        };

        listEl.appendChild(tabEl);
      })(this.tabs[i]);
    }
  }
};
