window.CNCApp = window.CNCApp || {};

document.addEventListener('DOMContentLoaded', function() {
  if (CNCApp.State && typeof CNCApp.State.normalizeMachineConfig === 'function') {
    CNCApp.State.normalizeMachineConfig();
  }
  CNCApp.Canvas.init();

  function renderCanvasDispenserFilters() {
    const container = document.getElementById('dispenserFilterButtons');
    if (!container) return;
    container.innerHTML = '';
    CNCApp.State.shadedDispensers = CNCApp.State.shadedDispensers || new Set();

    CNCApp.State.machine.dispensers.forEach(d => {
      const isShaded = CNCApp.State.shadedDispensers.has(d.id);
      const btn = document.createElement('button');
      btn.className = 'btn btn-xs';
      btn.style.display = 'inline-flex';
      btn.style.alignItems = 'center';
      btn.style.gap = '3px';
      btn.style.padding = '1px 5px';
      btn.style.fontSize = '10px';
      btn.style.fontWeight = '600';
      btn.style.cursor = 'pointer';
      btn.style.transition = '0.15s';
      btn.title = `Клик: вклучи/исклучи (shade) за ${d.name}. Alt+Клик: изолирај само овој диспензер.`;

      if (isShaded) {
        btn.style.background = '#f1f5f9';
        btn.style.color = '#94a3b8';
        btn.style.borderColor = '#cbd5e1';
        btn.style.opacity = '0.6';
        btn.style.textDecoration = 'line-through';
        btn.innerHTML = `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#cbd5e1;"></span>${d.name}`;
      } else {
        btn.style.background = '#ffffff';
        btn.style.color = '#0f172a';
        btn.style.borderColor = d.color;
        btn.style.boxShadow = `0 1px 2px rgba(0,0,0,0.05)`;
        btn.innerHTML = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${d.color};"></span>${d.name}`;
      }

      btn.onclick = (e) => {
        if (e.altKey) {
          CNCApp.State.shadedDispensers.clear();
          CNCApp.State.machine.dispensers.forEach(otherD => {
            if (otherD.id !== d.id) CNCApp.State.shadedDispensers.add(otherD.id);
          });
        } else {
          if (CNCApp.State.shadedDispensers.has(d.id)) {
            CNCApp.State.shadedDispensers.delete(d.id);
          } else {
            CNCApp.State.shadedDispensers.add(d.id);
          }
        }
        renderCanvasDispenserFilters();
        CNCApp.Canvas.render();
      };

      container.appendChild(btn);
    });

    if (CNCApp.State.shadedDispensers.size > 0) {
      const btnAll = document.createElement('button');
      btnAll.className = 'btn btn-xs';
      btnAll.style.fontSize = '10px';
      btnAll.style.padding = '1px 5px';
      btnAll.style.color = '#2563eb';
      btnAll.style.fontWeight = 'bold';
      btnAll.innerText = 'Сите';
      btnAll.title = 'Прикажи ги сите диспензери одеднаш';
      btnAll.onclick = () => {
        CNCApp.State.shadedDispensers.clear();
        renderCanvasDispenserFilters();
        CNCApp.Canvas.render();
      };
      container.appendChild(btnAll);
    }
  }

  const btnToggleSvg = document.getElementById('btnToggleSvg');
  function updateSvgToggleUI() {
    if (!btnToggleSvg) return;
    const isVisible = CNCApp.State.showSvg !== false;
    btnToggleSvg.style.display = 'inline-flex';
    btnToggleSvg.style.alignItems = 'center';
    btnToggleSvg.style.gap = '3px';
    btnToggleSvg.style.padding = '1px 6px';
    btnToggleSvg.style.fontSize = '10.5px';
    btnToggleSvg.style.fontWeight = '600';
    btnToggleSvg.style.cursor = 'pointer';
    btnToggleSvg.style.transition = '0.15s';

    if (isVisible) {
      btnToggleSvg.style.background = '#ffffff';
      btnToggleSvg.style.color = '#1e293b';
      btnToggleSvg.style.borderColor = '#6366f1';
      btnToggleSvg.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)';
      btnToggleSvg.style.opacity = '1.0';
      btnToggleSvg.style.textDecoration = 'none';
      btnToggleSvg.innerHTML = '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#6366f1;"></span>🖼️ SVG';
      btnToggleSvg.title = 'Клик: исклучи приказ на SVG подлогата на графикот';
    } else {
      btnToggleSvg.style.background = '#f1f5f9';
      btnToggleSvg.style.color = '#94a3b8';
      btnToggleSvg.style.borderColor = '#cbd5e1';
      btnToggleSvg.style.boxShadow = 'none';
      btnToggleSvg.style.opacity = '0.6';
      btnToggleSvg.style.textDecoration = 'line-through';
      btnToggleSvg.innerHTML = '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#cbd5e1;"></span>🖼️ SVG';
      btnToggleSvg.title = 'Клик: вклучи приказ на SVG подлогата на графикот';
    }
  }
  CNCApp.updateSvgToggleUI = updateSvgToggleUI;

  if (btnToggleSvg) {
    btnToggleSvg.onclick = () => {
      CNCApp.State.showSvg = (CNCApp.State.showSvg === false) ? true : false;
      updateSvgToggleUI();
      if (CNCApp.Tabs) CNCApp.Tabs.syncFromState();
      CNCApp.Canvas.render();
      if (CNCApp.Storage) CNCApp.Storage.saveAutoSave();
    };
    updateSvgToggleUI();
  }

  const btnToggleAdd = document.getElementById('btnToggleAddMode');
  function updateAddModeUI() {
    if (!btnToggleAdd) return;
    if (CNCApp.State.isAddMode) {
      btnToggleAdd.innerText = "➕ Точка: ВКЛ";
      btnToggleAdd.className = "btn btn-xs btn-addmode-on";
    } else {
      btnToggleAdd.innerText = "➕ Точка: ИСКЛ";
      btnToggleAdd.className = "btn btn-xs btn-addmode-off";
    }
  }

  const btnToggleClearance = document.getElementById('btnToggleClearance');
  function updateClearanceToggleUI() {
    if (!btnToggleClearance) return;
    if (CNCApp.State.showClearanceRings !== false) {
      btnToggleClearance.innerText = "⭕ Клиренс: ВКЛ";
      btnToggleClearance.style.background = "#f0fdf4";
      btnToggleClearance.style.color = "#166534";
    } else {
      btnToggleClearance.innerText = "⭕ Клиренс: ИСКЛ";
      btnToggleClearance.style.background = "#f1f5f9";
      btnToggleClearance.style.color = "#64748b";
    }
  }

  function populateDispenserSelectors() {
    const bColor = document.getElementById('batchColor');
    const selColor = document.getElementById('selByColor');
    bColor.innerHTML = '<option value="">-- Избери --</option>';
    selColor.innerHTML = '<option value="">-- По боја --</option>';
    CNCApp.State.machine.dispensers.forEach(d => {
      bColor.innerHTML += `<option value="${d.id}">${d.name}</option>`;
      selColor.innerHTML += `<option value="${d.id}">${d.name}</option>`;
    });
    renderCanvasDispenserFilters();
    if (CNCApp.Machine && typeof CNCApp.Machine.refreshDispenserSelect === 'function') {
      CNCApp.Machine.refreshDispenserSelect();
    }
  }

  function refreshToolbarStates() {
    populateDispenserSelectors();
    updateAddModeUI();
    updateSvgToggleUI();
    updateClearanceToggleUI();
    if (CNCApp.Machine && typeof CNCApp.Machine.refreshUI === 'function') {
      CNCApp.Machine.refreshUI();
    }
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function decodeBase64Utf8(b64) {
    try {
      return decodeURIComponent(escape(atob(b64)));
    } catch (e) {
      return atob(b64);
    }
  }

  function fallbackDownloadSave(content, defaultName, mime) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = defaultName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function() {
      try { URL.revokeObjectURL(url); } catch (e) {}
    }, 1500);
    return true;
  }

  function saveWithPicker(content, defaultName, mime, options) {
    var opts = options || {};
    if (window.showSaveFilePicker) {
      var ext = defaultName.indexOf('.') !== -1 ? '.' + defaultName.split('.').pop() : '.csv';
      var acceptObj = {};
      acceptObj[mime] = [ext];
      return window.showSaveFilePicker({
        suggestedName: defaultName,
        types: [{ description: 'Фајл', accept: acceptObj }]
      }).then(function(handle) {
        return handle.createWritable().then(function(writable) {
          return writable.write(content).then(function() {
            return writable.close().then(function() {
              if (opts.updateProjectName && handle && handle.name) {
                CNCApp.State.setProjectName(handle.name);
              }
              return true;
            });
          });
        });
      }).catch(function(err) {
        if (err && err.name === 'AbortError') return false;
        return fallbackDownloadSave(content, defaultName, mime);
      });
    }
    return Promise.resolve(fallbackDownloadSave(content, defaultName, mime));
  }

  function saveCurrentProject() {
    var csvContent = CNCApp.Parser.exportProjectCsv();
    var defaultName = CNCApp.State.projectName || 'cnc_project.csv';
    return saveWithPicker(csvContent, defaultName, 'text/csv', { updateProjectName: true })
      .then(function(saved) {
        if (saved !== false) {
          CNCApp.State.markDirty(false);
          if (CNCApp.Storage) CNCApp.Storage.saveAutoSave();
          return true;
        }
        return false;
      });
  }

  // 3-ОПЦИСКИ ДИЈАЛОГ ЗА НЕЗАЧУВАНИ ИЗМЕНИ
  var unsavedModalEl = document.getElementById('unsavedModal');
  var unsavedTitleEl = document.getElementById('unsavedModalTitle');
  var unsavedMsgEl = document.getElementById('unsavedModalMessage');
  var btnUnsavedSave = document.getElementById('btnUnsavedSave');
  var btnUnsavedDiscard = document.getElementById('btnUnsavedDiscard');
  var btnUnsavedCancel = document.getElementById('btnUnsavedCancel');
  var btnCloseUnsavedModal = document.getElementById('btnCloseUnsavedModal');
  var pendingUnsavedProceed = null;

  function closeUnsavedModal() {
    if (unsavedModalEl) unsavedModalEl.style.display = 'none';
    if (btnUnsavedSave) btnUnsavedSave.disabled = false;
    pendingUnsavedProceed = null;
  }

  function openUnsavedModal(titleText, messageHtml, onProceed) {
    if (!unsavedModalEl) {
      if (confirm(String(titleText || '') + '\n\nДали сакате да продолжите без да ги снимите промените?')) {
        if (typeof onProceed === 'function') onProceed();
      }
      return;
    }
    if (unsavedTitleEl) unsavedTitleEl.innerText = titleText || 'Незачувани измени';
    if (unsavedMsgEl) unsavedMsgEl.innerHTML = messageHtml || '';
    if (btnUnsavedSave) btnUnsavedSave.disabled = false;
    pendingUnsavedProceed = (typeof onProceed === 'function') ? onProceed : null;
    unsavedModalEl.style.display = 'flex';
  }

  if (btnUnsavedCancel) btnUnsavedCancel.onclick = closeUnsavedModal;
  if (btnCloseUnsavedModal) btnCloseUnsavedModal.onclick = closeUnsavedModal;
  if (btnUnsavedDiscard) {
    btnUnsavedDiscard.onclick = function() {
      var cb = pendingUnsavedProceed;
      closeUnsavedModal();
      if (cb) cb();
    };
  }
  if (btnUnsavedSave) {
    btnUnsavedSave.onclick = function() {
      var cb = pendingUnsavedProceed;
      btnUnsavedSave.disabled = true;
      saveCurrentProject().then(function(savedOk) {
        btnUnsavedSave.disabled = false;
        if (savedOk) {
          closeUnsavedModal();
          if (cb) cb();
        }
      }).catch(function() {
        btnUnsavedSave.disabled = false;
      });
    };
  }

  // ДИНАМИЧКИ ДИСПЕНЗЕРИ (1 ДО N)
  function renderSettingsDispensers() {
    const tb = document.getElementById('dispensersTableBody');
    tb.innerHTML = '';
    CNCApp.State.machine.dispensers.forEach((d, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${d.id}</td>
        <td><input type="text" value="${d.name}" class="inp inp-sm" style="width:70px"></td>
        <td><input type="color" value="${d.color}" style="width:30px;height:24px"></td>
        <td><input type="text" value="${d.lowerCmd}" class="inp inp-sm" style="width:55px"></td>
        <td><input type="text" value="${d.raiseCmd}" class="inp inp-sm" style="width:55px"></td>
        <td><input type="number" step="0.05" value="${d.offsetX}" class="inp inp-sm" style="width:55px"></td>
        <td><input type="number" step="0.05" value="${d.offsetY}" class="inp inp-sm" style="width:55px"></td>
        <td><button class="btn btn-xs btn-danger" onclick="CNCApp.App.deleteDispenser(${idx})">🗑️</button></td>
      `;
      tb.appendChild(tr);
    });
  }

  CNCApp.App = {
    renderCanvasDispenserFilters: renderCanvasDispenserFilters,
    refreshToolbarStates: refreshToolbarStates,
    isTabSwitchLocked: function() {
      return !!(CNCApp.Machine && typeof CNCApp.Machine.isTabSwitchLocked === 'function' && CNCApp.Machine.isTabSwitchLocked());
    },
    saveCurrentProject: saveCurrentProject,
    openUnsavedModal: openUnsavedModal,
    deleteDispenser: function(index) {
      if (CNCApp.State.machine.dispensers.length <= 1) {
        alert("Мора да остане минимум 1 диспензер!");
        return;
      }
      CNCApp.State.machine.dispensers.splice(index, 1);
      renderSettingsDispensers();
    }
  };

  // ИНИЦИЈАЛИЗАЦИЈА НА СОСТОЈБА И ТАБОВИ
  if (!CNCApp.Storage.loadAutoSave()) {
    if (CNCApp.Tabs) {
      CNCApp.Tabs.initWithDefaultDemo();
    } else {
      CNCApp.State.points.push(CNCApp.State.createPoint(10, 10));
      CNCApp.State.points.push(CNCApp.State.createPoint(25, 20));
      CNCApp.State.points.push(CNCApp.State.createPoint(35, 10));
      CNCApp.State.snapshot();
      CNCApp.State.markDirty(false);
      refreshToolbarStates();
      CNCApp.Table.render();
      CNCApp.Canvas.resetView();
      CNCApp.State.updateProjectUI();
    }
  }

  if (CNCApp.Machine && typeof CNCApp.Machine.init === 'function') {
    CNCApp.Machine.init();
  }

  const btnNewTab = document.getElementById('btnNewTab');
  if (btnNewTab) {
    btnNewTab.onclick = function() {
      if (CNCApp.Tabs) CNCApp.Tabs.newTab(true);
    };
  }

  const btnCloseProject = document.getElementById('btnCloseProject');
  if (btnCloseProject) {
    btnCloseProject.onclick = function() {
      if (CNCApp.Tabs) {
        CNCApp.Tabs.closeTab(CNCApp.Tabs.activeTabId, false);
      }
    };
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && unsavedModalEl && unsavedModalEl.style.display === 'flex') {
      e.preventDefault();
      closeUnsavedModal();
      return;
    }

    // Ctrl+S / Cmd+S save project shortcut
    if ((e.ctrlKey || e.metaKey) && e.key && e.key.toLowerCase() === 's') {
      e.preventDefault();
      var saveBtn = document.getElementById('btnSaveProjectCsv');
      if (saveBtn) saveBtn.click();
      return;
    }

    if (unsavedModalEl && unsavedModalEl.style.display === 'flex') return;
    var settingsModalEl = document.getElementById('settingsModal');
    if (settingsModalEl && settingsModalEl.style.display === 'flex') return;
    var svgModalEl = document.getElementById('svgGeneratorModal');
    if (svgModalEl && svgModalEl.style.display === 'flex') return;

    const tag = document.activeElement ? document.activeElement.tagName : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.key && e.key.indexOf('Arrow') === 0 && CNCApp.Machine && typeof CNCApp.Machine.handleKeyboardArrow === 'function') {
      if (CNCApp.Machine.handleKeyboardArrow(e)) return;
    }

    if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) return;
    if (CNCApp.State.selectedIndices.size === 0) return;

    const step = CNCApp.State.stepIncrement || 0.05;
    let dx = 0, dy = 0;
    if (e.key === 'ArrowUp') dy = step;
    else if (e.key === 'ArrowDown') dy = -step;
    else if (e.key === 'ArrowLeft') dx = -step;
    else if (e.key === 'ArrowRight') dx = step;
    else return;

    e.preventDefault();
    CNCApp.State.selectedIndices.forEach(idx => {
      const p = CNCApp.State.points[idx];
      p.x = parseFloat((p.x + dx).toFixed(3));
      p.y = parseFloat((p.y + dy).toFixed(3));
      CNCApp.Table.updateRow(idx);
    });

    CNCApp.Canvas.render();
    CNCApp.State.snapshot();
  });

  if (btnToggleAdd) {
    updateAddModeUI();
    btnToggleAdd.onclick = () => {
      if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) return;
      CNCApp.State.isAddMode = !CNCApp.State.isAddMode;
      if (CNCApp.State.isAddMode && CNCApp.Machine && CNCApp.Machine.isMoveToClickMode) {
        CNCApp.Machine.isMoveToClickMode = false;
        CNCApp.Machine.refreshUI();
      }
      updateAddModeUI();
      if (CNCApp.Tabs) CNCApp.Tabs.syncFromState();
      if (CNCApp.Canvas) CNCApp.Canvas.render();
      if (CNCApp.Storage) CNCApp.Storage.saveAutoSave();
    };
  }

  const btnToggleMoveClick = document.getElementById('btnToggleMoveToClick');
  if (btnToggleMoveClick) {
    btnToggleMoveClick.onclick = () => {
      if (CNCApp.Machine && typeof CNCApp.Machine.setMoveToClickMode === 'function') {
        CNCApp.Machine.setMoveToClickMode(!CNCApp.Machine.isMoveToClickMode);
        if (CNCApp.Tabs) CNCApp.Tabs.syncFromState();
        if (CNCApp.Canvas) CNCApp.Canvas.render();
      }
    };
  }

  document.getElementById('btnResetView').onclick = () => {
    CNCApp.Canvas.resetView();
  };

  document.getElementById('btnClearSvg').onclick = () => {
    if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) return;
    if (CNCApp.State.svgObjectUrl) {
      try { URL.revokeObjectURL(CNCApp.State.svgObjectUrl); } catch (e) {}
      CNCApp.State.svgObjectUrl = null;
    }
    CNCApp.State.svgData = null;
    CNCApp.State.svgImage = null;
    if (CNCApp.SvgGenerator) CNCApp.SvgGenerator.currentSvgString = null;
    updateSvgToggleUI();
    CNCApp.State.markDirty(true);
    CNCApp.Canvas.render();
    if (CNCApp.Storage) CNCApp.Storage.saveAutoSave();
  };

  if (btnToggleClearance) {
    updateClearanceToggleUI();
    btnToggleClearance.onclick = () => {
      CNCApp.State.showClearanceRings = (CNCApp.State.showClearanceRings === false) ? true : false;
      updateClearanceToggleUI();
      if (CNCApp.Tabs) CNCApp.Tabs.syncFromState();
      CNCApp.Canvas.render();
      if (CNCApp.Storage) CNCApp.Storage.saveAutoSave();
    };
  }

  document.getElementById('btnAddPoint').onclick = () => {
    if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) return;
    CNCApp.Table.insertNewPointAt(20, 20);
  };

  document.getElementById('btnMoveUp').onclick = () => CNCApp.Table.moveSelectedUp();
  document.getElementById('btnMoveDown').onclick = () => CNCApp.Table.moveSelectedDown();

  document.getElementById('btnDeleteSelected').onclick = () => {
    if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) return;
    const sel = CNCApp.State.selectedIndices;
    if (sel.size === 0) return;
    CNCApp.State.points = CNCApp.State.points.filter((_, idx) => !sel.has(idx));
    sel.clear();
    CNCApp.State.activePointIndex = null;
    CNCApp.State.lastSelectedRowIndex = null;
    CNCApp.State.snapshot();
    CNCApp.Table.render();
    CNCApp.Canvas.render();
  };

  document.getElementById('btnUndo').onclick = () => CNCApp.State.undo();
  document.getElementById('btnRedo').onclick = () => CNCApp.State.redo();

  document.getElementById('btnApplyBatchValues').onclick = () => {
    if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) return;
    const sel = CNCApp.State.selectedIndices;
    if (sel.size === 0) return;

    const bColor = document.getElementById('batchColor');
    const bSpeed = document.getElementById('batchSpeed');
    const bTime = document.getElementById('batchTime');
    const bOffsetX = document.getElementById('batchOffsetX');
    const bOffsetY = document.getElementById('batchOffsetY');
    const bGroup1 = document.getElementById('batchGroup1');
    const bGroup2 = document.getElementById('batchGroup2');

    const col = parseInt(bColor.value);
    const spd = parseFloat(bSpeed.value);
    const tm = bTime.value !== '' ? parseFloat(bTime.value) : null;
    const ox = parseFloat(bOffsetX.value) || 0;
    const oy = parseFloat(bOffsetY.value) || 0;
    const g1 = bGroup1.value;
    const g2 = bGroup2.value;

    sel.forEach(idx => {
      const p = CNCApp.State.points[idx];
      if (col) p.dispenser = col;
      if (!isNaN(spd) && spd > 0) p.speed = Math.round(spd);
      if (tm !== null) p.time = Math.round(tm);
      if (ox !== 0) p.x = parseFloat((p.x + ox).toFixed(3));
      if (oy !== 0) p.y = parseFloat((p.y + oy).toFixed(3));
      if (g1) p.group1 = g1;
      if (g2) p.group2 = g2;
    });

    bColor.value = '';
    bSpeed.value = '';
    bTime.value = '';
    bOffsetX.value = '0';
    bOffsetY.value = '0';
    bGroup1.value = '';
    bGroup2.value = '';

    CNCApp.State.snapshot();
    CNCApp.Table.render();
    CNCApp.Canvas.render();
  };

  const btnLine = document.getElementById('btnPresetLine');
  if (btnLine) {
    btnLine.onclick = () => {
      if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) return;
      const sel = Array.from(CNCApp.State.selectedIndices).sort((a, b) => a - b);
      if (sel.length < 2) {
        alert("⚠️ За да формирате линија, потребно е да селектирате минимум 2 последователни точки.");
        return;
      }

      // БЕЗБЕДНОСНА ПРОВЕРКА 1: Сите точки мора да припаѓаат на ист диспензер (иста боја)
      const firstDisp = CNCApp.State.points[sel[0]].dispenser;
      const hasMixedDispensers = sel.some(idx => CNCApp.State.points[idx].dispenser !== firstDisp);
      if (hasMixedDispensers) {
        alert("⛔ БЕЗБЕДНОСНА БЛОКАДА: Не може да се креира континуирана линија меѓу точки со различни бои/диспензери!\n\nСите селектирани точки мора да припаѓаат на ИСТ диспензер. За премин на друг диспензер, машината мора задолжително да го подигне алатот (Горе) за да се спречи судир или влечење на боја по материјалот.");
        return;
      }

      // БЕЗБЕДНОСНА ПРОВЕРКА 2: Точките мора да бидат строго последователни во табелата
      for (let i = 0; i < sel.length - 1; i++) {
        if (sel[i + 1] !== sel[i] + 1) {
          alert("⚠️ БЕЗБЕДНОСНА ПРОВЕРКА: Селектираните точки мора да бидат строго последователни во табелата (без прескокнување редови).");
          return;
        }
      }

      sel.forEach((idx, i) => {
        const p = CNCApp.State.points[idx];
        p.active = true;
        if (i === 0) {
          p.lower = true;
          p.valveStart = true;
          p.valveStop = false;
          p.raise = false;
        } else if (i === sel.length - 1) {
          p.lower = false;
          p.valveStart = false;
          p.valveStop = true;
          p.raise = true;
        } else {
          p.lower = false;
          p.valveStart = false;
          p.valveStop = false;
          p.raise = false;
        }
      });

      CNCApp.Table.enforceDispenserSafety();
      CNCApp.State.snapshot();
      CNCApp.Table.render();
      CNCApp.Canvas.render();
      CNCApp.GCode.updateCycleTime();
    };
  }

  document.getElementById('btnSpeedPlus5').onclick = () => scaleField('speed', 1.05);
  document.getElementById('btnSpeedMinus5').onclick = () => scaleField('speed', 0.95);
  document.getElementById('btnTimePlus5').onclick = () => scaleField('time', 1.05);
  document.getElementById('btnTimeMinus5').onclick = () => scaleField('time', 0.95);

  function scaleField(fld, factor) {
    if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) return;
    const sel = CNCApp.State.selectedIndices;
    if (sel.size === 0) return;
    sel.forEach(idx => {
      let v = parseFloat(CNCApp.State.points[idx][fld]) || 0;
      if (v > 0) {
        CNCApp.State.points[idx][fld] = Math.round(v * factor);
      }
    });
    CNCApp.State.snapshot();
    CNCApp.Table.render();
  }

  document.getElementById('btnSelectAll').onclick = () => {
    CNCApp.State.points.forEach((_, idx) => CNCApp.State.selectedIndices.add(idx));
    CNCApp.Table.render();
    CNCApp.Canvas.render();
  };
  document.getElementById('btnDeselectAll').onclick = () => {
    CNCApp.State.selectedIndices.clear();
    CNCApp.Table.render();
    CNCApp.Canvas.render();
  };
  document.getElementById('btnInvertSelect').onclick = () => {
    const cur = new Set(CNCApp.State.selectedIndices);
    CNCApp.State.selectedIndices.clear();
    CNCApp.State.points.forEach((_, idx) => {
      if (!cur.has(idx)) CNCApp.State.selectedIndices.add(idx);
    });
    CNCApp.Table.render();
    CNCApp.Canvas.render();
  };

  const btnSelInter = document.getElementById('btnSelectIntermediate');
  if (btnSelInter) {
    btnSelInter.onclick = () => CNCApp.Table.selectIntermediatePoints();
  }
  const btnSelPass = document.getElementById('btnSelectPassPoints');
  if (btnSelPass) {
    btnSelPass.onclick = () => CNCApp.Table.selectIntermediatePoints();
  }
  document.getElementById('selByColor').onchange = (e) => {
    const val = parseInt(e.target.value);
    if (!val) return;
    CNCApp.State.selectedIndices.clear();
    CNCApp.State.points.forEach((p, idx) => {
      if (p.dispenser === val) CNCApp.State.selectedIndices.add(idx);
    });
    CNCApp.Table.render();
    CNCApp.Canvas.render();
  };
  document.getElementById('selByGroup').onchange = (e) => {
    const txt = e.target.value;
    if (!txt) return;
    CNCApp.State.selectedIndices.clear();
    CNCApp.State.points.forEach((p, idx) => {
      if (p.group1 === txt || p.group2 === txt) CNCApp.State.selectedIndices.add(idx);
    });
    CNCApp.Table.render();
    CNCApp.Canvas.render();
  };

  document.getElementById('cycleTimeBox').onclick = () => {
    const t = CNCApp.GCode.telemetry;
    const mTotal = Math.floor(t.totalSec / 60);
    const sTotal = Math.round(t.totalSec % 60);
    const mMove = Math.floor(t.travelSec / 60);
    const sMove = Math.round(t.travelSec % 60);
    const mDwell = Math.floor(t.dwellSec / 60);
    const sDwell = Math.round(t.dwellSec % 60);
    alert(`📊 Детална статистика на програмот:\n\n` +
          `⏱️ Вкупно време: ${mTotal}м ${sTotal}с\n` +
          `🚗 Време на движење со рампи: ${mMove}м ${sMove}с\n` +
          `💧 Време на дозирање + M-латенција: ${mDwell}м ${sDwell}с\n` +
          `📏 Вкупна физичка патека: ${(t.totalDistMm / 1000).toFixed(3)} метри`);
  };

  const fileInp = document.getElementById('fileInput');
  let currentFileMode = '';

  function canModifyActiveTabForFileLoad() {
    var activeTab = CNCApp.Tabs ? CNCApp.Tabs.getActiveTab() : null;
    if (activeTab && activeTab.isRunningOnMachine) {
      alert('⛔ Овој таб моментално се извршува на машината и не смее да се пребрише со нова датотека. Отворете нов таб (➕ Нов таб) за друг проект.');
      return false;
    }
    return true;
  }

  function applyLoadedFileToCurrentTab(mode, fileName, txt) {
    if (mode === 'TXT') {
      var ptsTxt = CNCApp.Parser.parseTxt(txt);
      if (CNCApp.Tabs) {
        CNCApp.Tabs.resetActiveTabForLoadedData({
          clearSvg: true,
          points: ptsTxt,
          projectName: fileName
        });
      } else {
        CNCApp.State.points = ptsTxt;
        CNCApp.State.setProjectName(fileName);
        CNCApp.State.snapshot();
        CNCApp.State.markDirty(false);
        CNCApp.Table.render();
        CNCApp.Canvas.resetView();
      }
      if (CNCApp.SvgGenerator) CNCApp.SvgGenerator.currentSvgString = null;
    } else if (mode === 'LEGACY_CSV') {
      var resLegacy = CNCApp.Parser.parseLegacyCsv(txt);
      if (CNCApp.Tabs) {
        CNCApp.Tabs.resetActiveTabForLoadedData({
          clearSvg: true,
          points: resLegacy.points,
          header: resLegacy.header,
          footer: resLegacy.footer,
          projectName: fileName
        });
      } else {
        CNCApp.State.points = resLegacy.points;
        CNCApp.State.header = resLegacy.header;
        CNCApp.State.footer = resLegacy.footer;
        CNCApp.State.setProjectName(fileName);
        CNCApp.State.snapshot();
        CNCApp.State.markDirty(false);
        CNCApp.Table.render();
        CNCApp.Canvas.resetView();
      }
      if (CNCApp.SvgGenerator) CNCApp.SvgGenerator.currentSvgString = null;
    } else if (mode === 'PROJECT_CSV') {
      var resProj = CNCApp.Parser.parseProjectCsv(txt);
      var shouldClearSvg = !resProj.svg;
      if (CNCApp.Tabs) {
        CNCApp.Tabs.resetActiveTabForLoadedData({
          clearSvg: shouldClearSvg,
          points: resProj.points,
          header: resProj.header,
          footer: resProj.footer,
          projectName: fileName
        });
      } else {
        CNCApp.State.points = resProj.points;
        CNCApp.State.header = resProj.header;
        CNCApp.State.footer = resProj.footer;
        CNCApp.State.setProjectName(fileName);
        CNCApp.State.snapshot();
        CNCApp.State.markDirty(false);
        CNCApp.Table.render();
        CNCApp.Canvas.resetView();
      }

      if (resProj.svg) {
        var decodedSvg = decodeBase64Utf8(resProj.svg);
        CNCApp.Parser.loadSvgContent(decodedSvg);
        if (CNCApp.SvgGenerator) CNCApp.SvgGenerator.currentSvgString = decodedSvg;
      } else if (CNCApp.SvgGenerator) {
        CNCApp.SvgGenerator.currentSvgString = null;
      }
      populateDispenserSelectors();
    }
  }

  document.getElementById('btnOpenTxt').onclick = () => {
    if (!canModifyActiveTabForFileLoad()) return;
    currentFileMode = 'TXT';
    fileInp.accept = '.txt,text/plain';
    fileInp.click();
  };
  document.getElementById('btnOpenLegacyCsv').onclick = () => {
    if (!canModifyActiveTabForFileLoad()) return;
    currentFileMode = 'LEGACY_CSV';
    fileInp.accept = '.csv,.txt,text/csv';
    fileInp.click();
  };
  document.getElementById('btnOpenProjectCsv').onclick = () => {
    if (!canModifyActiveTabForFileLoad()) return;
    currentFileMode = 'PROJECT_CSV';
    fileInp.accept = '.csv,.txt,text/csv';
    fileInp.click();
  };
  document.getElementById('btnLoadSvg').onclick = () => {
    if (!canModifyActiveTabForFileLoad()) return;
    currentFileMode = 'SVG';
    fileInp.accept = '.svg,image/svg+xml';
    fileInp.click();
  };

  fileInp.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    var modeForLoad = currentFileMode;
    const reader = new FileReader();

    if (modeForLoad === 'SVG') {
      reader.onload = (evt) => {
        const svgContent = evt.target.result;
        CNCApp.Parser.loadSvgContent(svgContent);
        CNCApp.State.markDirty(true);
        if (CNCApp.Storage) CNCApp.Storage.saveAutoSave();
        if (CNCApp.SvgGenerator) {
          CNCApp.SvgGenerator.currentSvgString = svgContent;
          setTimeout(() => {
            if (confirm("Вчитан е SVG фајл! Дали сакате да го отворите волшебникот за автоматско генерирање на CNC патека со точки за диспензерите?")) {
              CNCApp.SvgGenerator.openModal(svgContent);
            }
          }, 150);
        }
      };
      reader.readAsText(file);
    } else {
      reader.onload = (evt) => {
        const txt = evt.target.result;
        if (CNCApp.State.isDirty) {
          openUnsavedModal(
            "Отворање нова датотека",
            "Тековниот проект <strong>\"" + escapeHtml(CNCApp.State.projectName) + "\"</strong> содржи незачувани измени.<br>Дали сакате да ги зачувате пред да ја вчитате <strong>\"" + escapeHtml(file.name) + "\"</strong> во овој таб?",
            function() {
              applyLoadedFileToCurrentTab(modeForLoad, file.name, txt);
            }
          );
        } else {
          applyLoadedFileToCurrentTab(modeForLoad, file.name, txt);
        }
      };
      reader.readAsText(file);
    }
    fileInp.value = '';
  };

  document.getElementById('btnSaveProjectCsv').onclick = () => {
    saveCurrentProject();
  };

  const projectBadge = document.getElementById('projectInfoBadge');
  if (projectBadge) {
    projectBadge.onclick = () => {
      if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) {
        alert('🔒 Не може да се преименува проектот додека активно работи на машината.');
        return;
      }
      const cur = CNCApp.State.projectName || 'Нов проект.csv';
      const entered = prompt('Внесете ново име за проектот:', cur);
      if (entered && entered.trim()) {
        CNCApp.State.setProjectName(entered.trim());
        CNCApp.State.markDirty(true);
        if (CNCApp.Storage) CNCApp.Storage.saveAutoSave();
      }
    };
  }

  window.addEventListener('beforeunload', (e) => {
    var hasDirty = CNCApp.Tabs ? CNCApp.Tabs.hasAnyUnsavedChanges() : CNCApp.State.isDirty;
    var machineBusy = CNCApp.Machine && typeof CNCApp.Machine.isBusy === 'function' && CNCApp.Machine.isBusy();
    if (hasDirty || machineBusy) {
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
  });

  const btnExportAi = document.getElementById('btnExportForAi');
  if (btnExportAi) {
    btnExportAi.onclick = () => {
      const csvContent = CNCApp.Parser.exportProjectCsv();
      const numPts = CNCApp.State.points.length;
      const hasSvg = !!CNCApp.State.svgData;

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(csvContent).then(() => {
          alert(`✅ ИСКОПИРАНО ВО CLIPBOARD!\n\n` +
                `• Вкупно работни точки: ${numPts}\n` +
                `• SVG содржина: ${hasSvg ? 'ВКЛУЧЕНА во податоците' : 'Нема SVG'}\n\n` +
                `Сега само кликнете во полето за порака во разговорот со AI и притиснете Ctrl+V (Paste)!`);
        }).catch(() => {
          prompt("Ископирајте го кодот со Ctrl+A и Ctrl+C, па пастирајте го во чатот со AI:", csvContent);
        });
      } else {
        prompt("Ископирајте го кодот со Ctrl+A и Ctrl+C, па пастирајте го во чатот со AI:", csvContent);
      }
    };
  }

  document.getElementById('btnExportGcode').onclick = () => {
    if (CNCApp.Machine && typeof CNCApp.Machine.checkActivePointsBounds === 'function') {
      var violations = CNCApp.Machine.checkActivePointsBounds();
      if (violations.length > 0) {
        var firstV = violations[0];
        var proceedExport = confirm(
          '⚠️ ПРЕДУПРЕДУВАЊЕ (Работни лимити):\n\n' +
          violations.length + ' активна/и точка/и со пресметан офсет ги надминуваат границите на машината!\n' +
          'Пример: Точка #' + firstV.rowNum + ' (' + firstV.dispenserName + ') -> X=' + firstV.machX.toFixed(2) + ', Y=' + firstV.machY.toFixed(2) + '\n' +
          firstV.message + '\n\nДали сепак сакате да го извезете G-кодот (.tap)?'
        );
        if (!proceedExport) return;
      }
    }
    const gcode = CNCApp.GCode.generate();
    saveWithPicker(gcode, 'dispenser_program.tap', 'text/plain', { updateProjectName: false });
  };

  document.getElementById('btnAddDispenser').onclick = () => {
    const list = CNCApp.State.machine.dispensers;
    const nextId = list.length > 0 ? Math.max(...list.map(d => d.id)) + 1 : 1;
    const lastDisp = list[list.length - 1] || { offsetX: -40.3, offsetY: 34.45 };
    const palette = ["#2563eb", "#059669", "#dc2626", "#d97706", "#7c3aed", "#ec4899", "#06b6d4", "#84cc16"];
    const nextColor = palette[(nextId - 1) % palette.length];

    list.push({
      id: nextId,
      name: "Боја " + nextId,
      color: nextColor,
      lowerCmd: "M" + (103 + nextId),
      raiseCmd: "M" + (203 + nextId),
      offsetX: parseFloat((lastDisp.offsetX + 40.0).toFixed(3)),
      offsetY: lastDisp.offsetY
    });
    renderSettingsDispensers();
  };

  const modal = document.getElementById('settingsModal');
  document.getElementById('btnOpenSettings').onclick = () => {
    if (CNCApp.Machine && typeof CNCApp.Machine.isBusy === 'function' && CNCApp.Machine.isBusy()) {
      alert('⛔ Не смеат да се менуваат глобалните поставки на машината (офсети, M-команди) додека машината активно работи!');
      return;
    }
    if (CNCApp.Machine && CNCApp.Machine.keyboardJogMode) {
      CNCApp.Machine.keyboardJogMode = false;
      CNCApp.Machine.refreshUI();
    }
    // Автоматска заштита: ако се затекнати стари вредности, понуди ги калибрираните дефаулти
    const d1 = CNCApp.State.machine.dispensers[0];
    if (d1 && (d1.offsetX === 0.8 || d1.offsetX === -0.4 || d1.offsetY === 36 || d1.offsetY === 34.55)) {
      CNCApp.State.machine.dispensers = [
        { id: 1, name: "Боја 1", color: "#2563eb", lowerCmd: "M104", raiseCmd: "M204", offsetX: -0.30, offsetY: 34.45 },
        { id: 2, name: "Боја 2", color: "#059669", lowerCmd: "M105", raiseCmd: "M205", offsetX: 39.70, offsetY: 34.45 },
        { id: 3, name: "Боја 3", color: "#dc2626", lowerCmd: "M106", raiseCmd: "M206", offsetX: 79.70, offsetY: 34.45 },
        { id: 4, name: "Боја 4", color: "#d97706", lowerCmd: "M107", raiseCmd: "M207", offsetX: 119.70, offsetY: 34.45 },
        { id: 5, name: "Боја 5", color: "#7c3aed", lowerCmd: "M108", raiseCmd: "M208", offsetX: 159.70, offsetY: 34.45 }
      ];
    }
    if (!CNCApp.State.footer || CNCApp.State.footer === 'G28.1 X2 Y2;M5;M30' || !CNCApp.State.footer.includes('G1 X1 Y1 F2000')) {
      CNCApp.State.footer = "G28.1 X2 Y2\r\nG1 X1 Y1 F2000\r\nM5\r\nM30";
    }
    if (typeof CNCApp.State.normalizeMachineConfig === 'function') {
      CNCApp.State.normalizeMachineConfig();
    }

    document.getElementById('modalHeaderCode').value = CNCApp.State.header;
    document.getElementById('modalFooterCode').value = CNCApp.State.footer;
    document.getElementById('modalTimeUnit').value = CNCApp.State.machine.timeUnit || 'ms';
    document.getElementById('modalDecimalSeparator').value = CNCApp.State.machine.decimalSeparator || '.';
    document.getElementById('modalMLatency').value = CNCApp.State.machine.mCommandLatency || 120;
    document.getElementById('modalDelayLower').value = CNCApp.State.machine.systemDelayLower;
    document.getElementById('modalDelayRaise').value = CNCApp.State.machine.systemDelayRaise;
    document.getElementById('modalStepIncrement').value = CNCApp.State.stepIncrement || 0.05;
    document.getElementById('modalMinX').value = CNCApp.State.machine.minX;
    document.getElementById('modalMaxX').value = CNCApp.State.machine.maxX;
    document.getElementById('modalMinY').value = CNCApp.State.machine.minY;
    document.getElementById('modalMaxY').value = CNCApp.State.machine.maxY;
    document.getElementById('modalMoveClickSpeed').value = CNCApp.State.machine.moveClickSpeed;

    renderSettingsDispensers();
    modal.style.display = 'flex';
  };

  const btnResetCal = document.getElementById('btnResetCalibratedDispensers');
  if (btnResetCal) {
    btnResetCal.onclick = () => {
      CNCApp.State.machine.dispensers = [
        { id: 1, name: "Боја 1", color: "#2563eb", lowerCmd: "M104", raiseCmd: "M204", offsetX: -0.30, offsetY: 34.45 },
        { id: 2, name: "Боја 2", color: "#059669", lowerCmd: "M105", raiseCmd: "M205", offsetX: 39.70, offsetY: 34.45 },
        { id: 3, name: "Боја 3", color: "#dc2626", lowerCmd: "M106", raiseCmd: "M206", offsetX: 79.70, offsetY: 34.45 },
        { id: 4, name: "Боја 4", color: "#d97706", lowerCmd: "M107", raiseCmd: "M207", offsetX: 119.70, offsetY: 34.45 },
        { id: 5, name: "Боја 5", color: "#7c3aed", lowerCmd: "M108", raiseCmd: "M208", offsetX: 159.70, offsetY: 34.45 }
      ];
      CNCApp.State.machine.minX = -5;
      CNCApp.State.machine.maxX = 350;
      CNCApp.State.machine.minY = -5;
      CNCApp.State.machine.maxY = 300;
      CNCApp.State.machine.moveClickSpeed = 3000;
      CNCApp.State.footer = "G28.1 X2 Y2\r\nG1 X1 Y1 F2000\r\nM5\r\nM30";
      document.getElementById('modalFooterCode').value = CNCApp.State.footer;
      document.getElementById('modalMinX').value = CNCApp.State.machine.minX;
      document.getElementById('modalMaxX').value = CNCApp.State.machine.maxX;
      document.getElementById('modalMinY').value = CNCApp.State.machine.minY;
      document.getElementById('modalMaxY').value = CNCApp.State.machine.maxY;
      document.getElementById('modalMoveClickSpeed').value = CNCApp.State.machine.moveClickSpeed;
      renderSettingsDispensers();
      refreshToolbarStates();
      CNCApp.Canvas.render();
      CNCApp.Storage.saveAutoSave();
      if (CNCApp.Machine && CNCApp.Machine.activeDriverId === 'mach3' && CNCApp.Mach3BridgeDriver && CNCApp.Mach3BridgeDriver.connected) {
        CNCApp.Mach3BridgeDriver.syncConfig();
      }
    };
  }

  document.getElementById('btnCloseSettings').onclick = () => modal.style.display = 'none';

  document.getElementById('btnSaveSettings').onclick = () => {
    const pMinX = parseFloat(document.getElementById('modalMinX').value);
    const pMaxX = parseFloat(document.getElementById('modalMaxX').value);
    const pMinY = parseFloat(document.getElementById('modalMinY').value);
    const pMaxY = parseFloat(document.getElementById('modalMaxY').value);
    const pMoveF = parseFloat(document.getElementById('modalMoveClickSpeed').value);

    if (!isNaN(pMinX) && !isNaN(pMaxX) && pMaxX <= pMinX) {
      alert('⚠️ Максималната X граница (Макс X) мора да биде поголема од Мин X!');
      return;
    }
    if (!isNaN(pMinY) && !isNaN(pMaxY) && pMaxY <= pMinY) {
      alert('⚠️ Максималната Y граница (Макс Y) мора да биде поголема од Мин Y!');
      return;
    }
    if (!isNaN(pMoveF) && pMoveF <= 0) {
      alert('⚠️ Брзината за „Оди на клик“ (F) мора да биде поголема од 0!');
      return;
    }

    CNCApp.State.header = document.getElementById('modalHeaderCode').value;
    CNCApp.State.footer = document.getElementById('modalFooterCode').value;
    CNCApp.State.machine.timeUnit = document.getElementById('modalTimeUnit').value;
    CNCApp.State.machine.decimalSeparator = document.getElementById('modalDecimalSeparator').value;
    CNCApp.State.machine.mCommandLatency = parseInt(document.getElementById('modalMLatency').value) || 120;
    CNCApp.State.machine.systemDelayLower = parseInt(document.getElementById('modalDelayLower').value) || 150;
    CNCApp.State.machine.systemDelayRaise = parseInt(document.getElementById('modalDelayRaise').value) || 150;
    CNCApp.State.stepIncrement = parseFloat(document.getElementById('modalStepIncrement').value) || 0.05;
    CNCApp.State.machine.minX = isNaN(pMinX) ? -5 : pMinX;
    CNCApp.State.machine.maxX = isNaN(pMaxX) ? 350 : pMaxX;
    CNCApp.State.machine.minY = isNaN(pMinY) ? -5 : pMinY;
    CNCApp.State.machine.maxY = isNaN(pMaxY) ? 300 : pMaxY;
    CNCApp.State.machine.moveClickSpeed = isNaN(pMoveF) ? 3000 : Math.round(pMoveF);
    if (typeof CNCApp.State.normalizeMachineConfig === 'function') {
      CNCApp.State.normalizeMachineConfig();
    }

    const rows = document.querySelectorAll('#dispensersTableBody tr');
    rows.forEach((r, i) => {
      const inputs = r.querySelectorAll('input');
      CNCApp.State.machine.dispensers[i].name = inputs[0].value;
      CNCApp.State.machine.dispensers[i].color = inputs[1].value;
      CNCApp.State.machine.dispensers[i].lowerCmd = inputs[2].value;
      CNCApp.State.machine.dispensers[i].raiseCmd = inputs[3].value;
      CNCApp.State.machine.dispensers[i].offsetX = parseFloat(inputs[4].value) || 0;
      CNCApp.State.machine.dispensers[i].offsetY = parseFloat(inputs[5].value) || 0;
    });

    refreshToolbarStates();
    CNCApp.Table.render();
    CNCApp.Canvas.render();
    CNCApp.Storage.saveAutoSave();
    if (CNCApp.Machine && CNCApp.Machine.activeDriverId === 'mach3' && CNCApp.Mach3BridgeDriver && CNCApp.Mach3BridgeDriver.connected) {
      CNCApp.Mach3BridgeDriver.syncConfig();
    }
    modal.style.display = 'none';
  };

  document.getElementById('btnExportMachineProfile').onclick = () => {
    const prof = JSON.stringify(CNCApp.State.machine, null, 2);
    saveWithPicker(prof, 'machine_profile.json', 'application/json', { updateProjectName: false });
  };

  const profInp = document.getElementById('machineProfileInput');
  document.getElementById('btnImportMachineProfile').onclick = () => profInp.click();
  profInp.onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = (evt) => {
      try {
        CNCApp.State.machine = JSON.parse(evt.target.result);
        if (typeof CNCApp.State.normalizeMachineConfig === 'function') {
          CNCApp.State.normalizeMachineConfig();
        }
        renderSettingsDispensers();
        refreshToolbarStates();
        CNCApp.Table.render();
        CNCApp.Canvas.render();
        CNCApp.Storage.saveAutoSave();
        if (CNCApp.Machine && CNCApp.Machine.activeDriverId === 'mach3' && CNCApp.Mach3BridgeDriver && CNCApp.Mach3BridgeDriver.connected) {
          CNCApp.Mach3BridgeDriver.syncConfig();
        }
      } catch(err) { alert('Невалиден профил!'); }
    };
    r.readAsText(f);
    profInp.value = '';
  };

  // --- НАСТАНИ ЗА АВТОМАТСКИ ГЕНЕРАТОР НА SVG ---
  const btnOpenSvgGenTop = document.getElementById('btnOpenSvgGenTop');
  if (btnOpenSvgGenTop) {
    btnOpenSvgGenTop.onclick = () => {
      if (CNCApp.Machine && CNCApp.Machine.keyboardJogMode) {
        CNCApp.Machine.keyboardJogMode = false;
        CNCApp.Machine.refreshUI();
      }
      if (CNCApp.SvgGenerator) CNCApp.SvgGenerator.openModal();
    };
  }

  const btnCloseSvgGen = document.getElementById('btnCloseSvgGen');
  if (btnCloseSvgGen) {
    btnCloseSvgGen.onclick = () => {
      if (CNCApp.SvgGenerator) CNCApp.SvgGenerator.closeModal();
    };
  }

  const btnCancelSvgGen = document.getElementById('btnCancelSvgGen');
  if (btnCancelSvgGen) {
    btnCancelSvgGen.onclick = () => {
      if (CNCApp.SvgGenerator) CNCApp.SvgGenerator.closeModal();
    };
  }

  const btnSvgGenLoadFile = document.getElementById('btnSvgGenLoadFile');
  const svgGenFileInput = document.getElementById('svgGenFileInput');
  if (btnSvgGenLoadFile && svgGenFileInput) {
    btnSvgGenLoadFile.onclick = () => svgGenFileInput.click();
    svgGenFileInput.onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = (evt) => {
        if (CNCApp.SvgGenerator) {
          CNCApp.SvgGenerator.parseAndAnalyze(evt.target.result);
          CNCApp.SvgGenerator.updateModalUI();
        }
      };
      r.readAsText(f);
      svgGenFileInput.value = '';
    };
  }

  const btnSvgGenUseCurrent = document.getElementById('btnSvgGenUseCurrent');
  if (btnSvgGenUseCurrent) {
    btnSvgGenUseCurrent.onclick = () => {
      if (!CNCApp.State.svgData) {
        alert("⚠️ Во моментов нема вчитано SVG на платното. Вчитајте SVG или изберете еден од готовите тест примероци.");
        return;
      }
      if (CNCApp.SvgGenerator) {
        CNCApp.SvgGenerator.parseAndAnalyze(CNCApp.State.svgData);
        CNCApp.SvgGenerator.updateModalUI();
      }
    };
  }

  const btnSvgSampleChannels = document.getElementById('btnSvgSampleChannels');
  if (btnSvgSampleChannels) {
    btnSvgSampleChannels.onclick = () => {
      if (CNCApp.SvgGenerator) {
        CNCApp.SvgGenerator.parseAndAnalyze(CNCApp.SvgGenerator.sampleSvgs.channelsAndPockets);
        CNCApp.SvgGenerator.updateModalUI();
      }
    };
  }

  const btnSvgSampleStar = document.getElementById('btnSvgSampleStar');
  if (btnSvgSampleStar) {
    btnSvgSampleStar.onclick = () => {
      if (CNCApp.SvgGenerator) {
        CNCApp.SvgGenerator.parseAndAnalyze(CNCApp.SvgGenerator.sampleSvgs.star);
        CNCApp.SvgGenerator.updateModalUI();
      }
    };
  }

  const btnSvgSampleFlower = document.getElementById('btnSvgSampleFlower');
  if (btnSvgSampleFlower) {
    btnSvgSampleFlower.onclick = () => {
      if (CNCApp.SvgGenerator) {
        CNCApp.SvgGenerator.parseAndAnalyze(CNCApp.SvgGenerator.sampleSvgs.flower3Color);
        CNCApp.SvgGenerator.updateModalUI();
      }
    };
  }

  const btnSvgSampleLines = document.getElementById('btnSvgSampleLines');
  if (btnSvgSampleLines) {
    btnSvgSampleLines.onclick = () => {
      if (CNCApp.SvgGenerator) {
        CNCApp.SvgGenerator.parseAndAnalyze(CNCApp.SvgGenerator.sampleSvgs.cncGridLines);
        CNCApp.SvgGenerator.updateModalUI();
      }
    };
  }

  const btnSvgGenPasteCode = document.getElementById('btnSvgGenPasteCode');
  if (btnSvgGenPasteCode) {
    btnSvgGenPasteCode.onclick = () => {
      const pasted = prompt("Пастирајте го вашиот SVG XML код овде (<svg ...> ... </svg>):");
      if (pasted && pasted.includes('<svg')) {
        if (CNCApp.SvgGenerator) {
          CNCApp.SvgGenerator.parseAndAnalyze(pasted);
          CNCApp.SvgGenerator.updateModalUI();
        }
      } else if (pasted) {
        alert("Невалиден SVG код!");
      }
    };
  }

  const btnSvgGenReplace = document.getElementById('btnSvgGenReplace');
  if (btnSvgGenReplace) {
    btnSvgGenReplace.onclick = () => {
      if (CNCApp.SvgGenerator) CNCApp.SvgGenerator.applyToProject(true);
    };
  }

  const btnSvgGenAppend = document.getElementById('btnSvgGenAppend');
  if (btnSvgGenAppend) {
    btnSvgGenAppend.onclick = () => {
      if (CNCApp.SvgGenerator) CNCApp.SvgGenerator.applyToProject(false);
    };
  }
});