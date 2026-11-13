window.CNCApp = window.CNCApp || {};

CNCApp.Table = {
  dragSourceIndex: null,

  render: function() {
    this.enforceDispenserSafety();
    this.bindContextMenu();
    const tb = document.getElementById('tableBody');
    tb.innerHTML = '';
    const pts = CNCApp.State.points;
    const countBadge = document.getElementById('selectedCount');
    countBadge.innerText = 'Селектирани: ' + CNCApp.State.selectedIndices.size;
    const step = CNCApp.State.stepIncrement || 0.05;
    const isReadOnly = CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly();
    const disAttr = isReadOnly ? 'disabled' : '';

    pts.forEach((p, idx) => {
      const tr = document.createElement('tr');
      tr.id = 'row-' + idx;
      tr.dataset.index = idx;
      if (CNCApp.State.selectedIndices.has(idx)) tr.classList.add('selected');
      if (CNCApp.State.activePointIndex === idx) tr.classList.add('active-focus');
      if (!p.active) tr.classList.add('inactive-row');

      tr.innerHTML = `
        <td class="drag-handle" draggable="${isReadOnly ? 'false' : 'true'}" title="${isReadOnly ? 'Заклучено додека машината работи' : 'Повлечи за прередување'}">☰</td>
        <td data-field="active" title="Десен клик за опции"><input type="checkbox" ${p.active ? 'checked' : ''} ${disAttr} onchange="CNCApp.Table.updateField(${idx}, 'active', this.checked)"></td>
        <td>${idx + 1}</td>
        <td><input type="number" step="${step}" value="${p.x.toFixed(3)}" ${disAttr} onchange="CNCApp.Table.updateField(${idx}, 'x', parseFloat(parseFloat(this.value).toFixed(3)))"></td>
        <td><input type="number" step="${step}" value="${p.y.toFixed(3)}" ${disAttr} onchange="CNCApp.Table.updateField(${idx}, 'y', parseFloat(parseFloat(this.value).toFixed(3)))"></td>
        <td><input type="number" value="${Math.round(p.speed)}" ${disAttr} onchange="CNCApp.Table.updateField(${idx}, 'speed', Math.round(parseFloat(this.value) || 1000))"></td>
        <td data-field="lower" title="Десен клик за опции"><input type="checkbox" ${p.lower ? 'checked' : ''} ${disAttr} onchange="CNCApp.Table.updateField(${idx}, 'lower', this.checked)"></td>
        <td data-field="valveStart" title="Десен клик за опции"><input type="checkbox" ${p.valveStart ? 'checked' : ''} ${disAttr} onchange="CNCApp.Table.updateField(${idx}, 'valveStart', this.checked)"></td>
        <td><input type="number" value="${p.time !== '' ? Math.round(p.time) : ''}" placeholder="" style="width:42px" ${disAttr} onchange="CNCApp.Table.updateField(${idx}, 'time', this.value !== '' ? Math.round(parseFloat(this.value)) : '')"></td>
        <td data-field="valveStop" title="Десен клик за опции"><input type="checkbox" ${p.valveStop ? 'checked' : ''} ${disAttr} onchange="CNCApp.Table.updateField(${idx}, 'valveStop', this.checked)"></td>
        <td data-field="raise" title="Десен клик за опции"><input type="checkbox" ${p.raise ? 'checked' : ''} ${disAttr} onchange="CNCApp.Table.updateField(${idx}, 'raise', this.checked)"></td>
        <td>
          <select ${disAttr} onchange="CNCApp.Table.updateField(${idx}, 'dispenser', parseInt(this.value))">
            ${CNCApp.State.machine.dispensers.map(d => `<option value="${d.id}" ${p.dispenser === d.id ? 'selected' : ''}>${d.name}</option>`).join('')}
          </select>
        </td>
        <td><input type="text" value="${p.group1}" ${disAttr} onchange="CNCApp.Table.updateField(${idx}, 'group1', this.value)"></td>
        <td><input type="text" value="${p.group2}" ${disAttr} onchange="CNCApp.Table.updateField(${idx}, 'group2', this.value)"></td>
      `;

      const handle = tr.querySelector('.drag-handle');
      handle.addEventListener('dragstart', (e) => {
        if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) {
          e.preventDefault();
          return;
        }
        CNCApp.Table.dragSourceIndex = idx;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', idx);
      });

      tr.addEventListener('dragover', (e) => {
        e.preventDefault();
        tr.classList.add('drag-over');
      });

      tr.addEventListener('dragleave', () => {
        tr.classList.remove('drag-over');
      });

      tr.addEventListener('drop', (e) => {
        e.preventDefault();
        tr.classList.remove('drag-over');
        const fromIdx = CNCApp.Table.dragSourceIndex;
        const toIdx = idx;
        if (fromIdx !== null && fromIdx !== toIdx) {
          CNCApp.Table.moveRow(fromIdx, toIdx);
        }
      });

      tr.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.classList.contains('drag-handle')) return;

        if (e.shiftKey && CNCApp.State.lastSelectedRowIndex !== null) {
          const start = Math.min(CNCApp.State.lastSelectedRowIndex, idx);
          const end = Math.max(CNCApp.State.lastSelectedRowIndex, idx);
          if (!e.ctrlKey) CNCApp.State.selectedIndices.clear();
          for (let r = start; r <= end; r++) {
            CNCApp.State.selectedIndices.add(r);
          }
        } else {
          if (!e.ctrlKey) CNCApp.State.selectedIndices.clear();
          CNCApp.State.selectedIndices.add(idx);
          CNCApp.State.lastSelectedRowIndex = idx;
        }

        CNCApp.State.activePointIndex = idx;
        CNCApp.Table.render();
        CNCApp.Canvas.render();
      });

      tb.appendChild(tr);
    });

    CNCApp.GCode.updateCycleTime();
    CNCApp.Table.updateGroupDropdown();
  },

  moveRow: function(fromIdx, toIdx) {
    if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) return;
    const moved = CNCApp.State.points.splice(fromIdx, 1)[0];
    CNCApp.State.points.splice(toIdx, 0, moved);

    CNCApp.State.selectedIndices.clear();
    CNCApp.State.selectedIndices.add(toIdx);
    CNCApp.State.activePointIndex = toIdx;
    CNCApp.State.lastSelectedRowIndex = toIdx;

    CNCApp.State.snapshot();
    this.render();
    CNCApp.Canvas.render();
    this.scrollToRow(toIdx);
  },

  moveSelectedUp: function() {
    if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) return;
    const sel = Array.from(CNCApp.State.selectedIndices).sort((a, b) => a - b);
    if (sel.length === 0 || sel[0] === 0) return;

    sel.forEach(idx => {
      const temp = CNCApp.State.points[idx - 1];
      CNCApp.State.points[idx - 1] = CNCApp.State.points[idx];
      CNCApp.State.points[idx] = temp;
    });

    const newSel = new Set(sel.map(i => i - 1));
    CNCApp.State.selectedIndices = newSel;
    if (CNCApp.State.activePointIndex !== null && CNCApp.State.activePointIndex > 0) {
      CNCApp.State.activePointIndex--;
    }

    CNCApp.State.snapshot();
    this.render();
    CNCApp.Canvas.render();
    this.scrollToRow(Array.from(newSel)[0]);
  },

  moveSelectedDown: function() {
    if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) return;
    const sel = Array.from(CNCApp.State.selectedIndices).sort((a, b) => b - a);
    if (sel.length === 0 || sel[0] >= CNCApp.State.points.length - 1) return;

    sel.forEach(idx => {
      const temp = CNCApp.State.points[idx + 1];
      CNCApp.State.points[idx + 1] = CNCApp.State.points[idx];
      CNCApp.State.points[idx] = temp;
    });

    const newSel = new Set(sel.map(i => i + 1));
    CNCApp.State.selectedIndices = newSel;
    if (CNCApp.State.activePointIndex !== null && CNCApp.State.activePointIndex < CNCApp.State.points.length - 1) {
      CNCApp.State.activePointIndex++;
    }

    CNCApp.State.snapshot();
    this.render();
    CNCApp.Canvas.render();
    this.scrollToRow(Array.from(newSel)[0]);
  },

  updateField: function(idx, field, val) {
    if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) {
      this.render();
      return;
    }
    if (field === 'active') {
      this.enforceActiveSafety(idx, val);
      CNCApp.State.points[idx][field] = val;
      this.enforceDispenserSafety();
      this.render();
    } else {
      if (field === 'speed' && CNCApp.State.selectedIndices.has(idx) && CNCApp.State.selectedIndices.size > 1) {
        // Кога се менува брзината на една од селектираните точки, автоматски се ажурираат сите селектирани точки!
        CNCApp.State.selectedIndices.forEach(sIdx => {
          if (CNCApp.State.points[sIdx]) CNCApp.State.points[sIdx].speed = val;
        });
        this.render();
      } else {
        CNCApp.State.points[idx][field] = val;
        if (field === 'dispenser') {
          this.enforceDispenserSafety();
          this.render();
        }
      }
    }
    CNCApp.State.snapshot();
    CNCApp.Canvas.render();
    CNCApp.GCode.updateCycleTime();
    if (field === 'group1' || field === 'group2') {
      CNCApp.Table.updateGroupDropdown();
    }
  },

  updateRow: function(idx) {
    const tr = document.getElementById('row-' + idx);
    if (!tr) return;
    const inputs = tr.querySelectorAll('input');
    inputs[1].value = CNCApp.State.points[idx].x.toFixed(3);
    inputs[2].value = CNCApp.State.points[idx].y.toFixed(3);
  },

  scrollToRow: function(idx) {
    const tr = document.getElementById('row-' + idx);
    if (tr) tr.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },

  insertNewPointAt: function(x, y) {
    if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) return;
    let refPt = null;
    let targetIdx = CNCApp.State.points.length;

    if (CNCApp.State.activePointIndex !== null && CNCApp.State.activePointIndex < CNCApp.State.points.length) {
      refPt = CNCApp.State.points[CNCApp.State.activePointIndex];
      targetIdx = CNCApp.State.activePointIndex + 1;
    } else if (CNCApp.State.selectedIndices.size > 0) {
      const selArr = Array.from(CNCApp.State.selectedIndices).sort((a, b) => a - b);
      const lastSel = selArr[selArr.length - 1];
      refPt = CNCApp.State.points[lastSel];
      targetIdx = lastSel + 1;
    } else if (CNCApp.State.points.length > 0) {
      refPt = CNCApp.State.points[CNCApp.State.points.length - 1];
      targetIdx = CNCApp.State.points.length;
    }

    const pt = CNCApp.State.createPoint(x, y, refPt);

    if (targetIdx < CNCApp.State.points.length) {
      CNCApp.State.points.splice(targetIdx, 0, pt);
    } else {
      CNCApp.State.points.push(pt);
    }

    CNCApp.State.activePointIndex = targetIdx;
    CNCApp.State.selectedIndices.clear();
    CNCApp.State.selectedIndices.add(targetIdx);
    CNCApp.State.lastSelectedRowIndex = targetIdx;
    CNCApp.State.snapshot();
    this.render();
    CNCApp.Canvas.render();
    this.scrollToRow(targetIdx);
  },

  updateGroupDropdown: function() {
    const sel = document.getElementById('selByGroup');
    if (!sel) return;
    const curVal = sel.value;
    const groups = new Set();
    CNCApp.State.points.forEach(p => {
      if (p.group1 && p.group1.trim()) groups.add(p.group1.trim());
      if (p.group2 && p.group2.trim()) groups.add(p.group2.trim());
    });

    sel.innerHTML = '<option value="">-- Избери група --</option>';
    if (groups.size === 0) {
      sel.innerHTML = '<option value="">-- Нема групи --</option>';
    } else {
      Array.from(groups).sort().forEach(g => {
        sel.innerHTML += `<option value="${g}">${g}</option>`;
      });
    }
    sel.value = curVal;
  },

  enforceActiveSafety: function(idx, newActiveVal) {
    const pts = CNCApp.State.points;
    if (!pts || !pts[idx]) return;
    const cur = pts[idx];

    if (!newActiveVal) {
      // 1. ДЕАКТИВАЦИЈА: Точката се исклучува од циклусот во G-кодот.
      // Доколку оваа точка затвораше вентил или ја креваше главата (крај на линија или капка):
      if (cur.raise || cur.valveStop) {
        // Најди ја најблиската претходна АКТИВНА точка и префрли ги Боја стоп и Горе
        for (let i = idx - 1; i >= 0; i--) {
          if (pts[i].active) {
            pts[i].valveStop = true;
            pts[i].raise = true;
            break;
          }
        }
      }

      // Доколку оваа точка ја спушташе главата или отвораше вентил (почеток на линија):
      if (cur.lower || cur.valveStart) {
        // Најди ја најблиската следна АКТИВНА точка и активирај Доле и Боја старт
        for (let i = idx + 1; i < pts.length; i++) {
          if (pts[i].active) {
            pts[i].lower = true;
            pts[i].valveStart = true;
            break;
          }
        }
      }
    } else {
      // 2. РЕАКТИВАЦИЈА: Точката повторно се вклучува во програмата.
      // Ако оваа точка има Боја стоп и Горе, а претходната точка беше средна линиска точка,
      // врати ја претходната точка во континуирано движење без непотребно кревање/затворање.
      if (cur.raise || cur.valveStop) {
        for (let i = idx - 1; i >= 0; i--) {
          if (pts[i].active) {
            if (pts[i].dispenser === cur.dispenser && (pts[i].time === '' || pts[i].time === 0)) {
              pts[i].valveStop = false;
              pts[i].raise = false;
            }
            break;
          }
        }
      }
    }
  },

  enforceDispenserSafety: function() {
    const pts = CNCApp.State.points;
    if (!pts || pts.length < 2) return false;
    let modified = false;

    for (let i = 0; i < pts.length - 1; i++) {
      const cur = pts[i];
      const next = pts[i + 1];
      if (cur.dispenser !== next.dispenser) {
        if (!cur.raise) {
          cur.raise = true;
          modified = true;
        }
        if (!cur.valveStop) {
          cur.valveStop = true;
          modified = true;
        }
      }
    }
    return modified;
  },

  bindContextMenu: function() {
    const table = document.getElementById('pointsTable');
    if (!table || this._contextMenuBound) return;
    this._contextMenuBound = true;

    // Клик на заглавието на колоната Брзина
    const speedHeader = table.querySelector('th[data-field="speed"]');
    if (speedHeader) {
      speedHeader.addEventListener('click', (e) => {
        e.preventDefault();
        if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) return;
        CNCApp.Table.promptBulkSpeed();
      });
    }

    table.addEventListener('contextmenu', (e) => {
      if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) return;
      const cell = e.target.closest('[data-field]');
      if (!cell) return;

      const field = cell.dataset.field;
      if (!field) return;

      e.preventDefault();
      e.stopPropagation();

      const tr = cell.closest('tr');
      if (tr && tr.dataset && tr.dataset.index !== undefined) {
        const rowIdx = parseInt(tr.dataset.index);
        if (CNCApp.State.selectedIndices.size === 0 || !CNCApp.State.selectedIndices.has(rowIdx)) {
          CNCApp.State.selectedIndices.add(rowIdx);
          CNCApp.State.activePointIndex = rowIdx;
          CNCApp.Table.render();
          CNCApp.Canvas.render();
        }
      }

      CNCApp.Table.showContextMenu(e.clientX, e.clientY, field);
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#tableContextMenu')) {
        CNCApp.Table.closeContextMenu();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') CNCApp.Table.closeContextMenu();
    });
  },

  showContextMenu: function(x, y, field) {
    this.closeContextMenu();

    const fieldNames = {
      active: 'Акт (Активно во G-код)',
      lower: 'Доле (Спушти главата)',
      valveStart: 'Боја ст. (Отвори вентил)',
      valveStop: 'Боја стп. (Затвори вентил)',
      raise: 'Горе (Крени главата)',
      speed: 'Брзина (Feedrate F)'
    };

    const title = fieldNames[field] || field;
    const selCount = CNCApp.State.selectedIndices.size;
    if (selCount === 0) return;

    const menu = document.createElement('div');
    menu.id = 'tableContextMenu';
    menu.className = 'table-context-menu';
    menu.style.left = Math.min(x, window.innerWidth - 250) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - 200) + 'px';

    if (field === 'speed') {
      menu.innerHTML = `
        <div class="context-menu-header">⚡ Брзина (Feedrate) - ${selCount} точки</div>
        <div class="context-menu-item" id="ctxSelectIntermediate">
          <span style="color:#059669;font-weight:bold;">⚡</span> Селектирај само меѓуточки во линија
        </div>
        <div class="context-menu-item" id="ctxSetSpeed">
          <span style="color:#2563eb;font-weight:bold;">✏️</span> Постави брзина за селектираните...
        </div>
        <div class="context-menu-item" id="ctxSpeedPlus10">
          <span style="color:#10b981;font-weight:bold;">▲</span> Зголеми за +10%
        </div>
        <div class="context-menu-item" id="ctxSpeedMinus10">
          <span style="color:#ef4444;font-weight:bold;">▼</span> Намали за -10%
        </div>
      `;

      document.body.appendChild(menu);

      document.getElementById('ctxSelectIntermediate').onclick = (e) => {
        e.stopPropagation();
        CNCApp.Table.selectIntermediatePoints();
        CNCApp.Table.closeContextMenu();
      };

      document.getElementById('ctxSetSpeed').onclick = (e) => {
        e.stopPropagation();
        CNCApp.Table.closeContextMenu();
        CNCApp.Table.promptBulkSpeed();
      };

      document.getElementById('ctxSpeedPlus10').onclick = (e) => {
        e.stopPropagation();
        CNCApp.Table.scaleSpeed(1.10);
        CNCApp.Table.closeContextMenu();
      };

      document.getElementById('ctxSpeedMinus10').onclick = (e) => {
        e.stopPropagation();
        CNCApp.Table.scaleSpeed(0.90);
        CNCApp.Table.closeContextMenu();
      };
      return;
    }

    menu.innerHTML = `
      <div class="context-menu-header">📋 ${title} (${selCount} селектирани)</div>
      <div class="context-menu-item" id="ctxCheckAll">
        <span style="color:#10b981;font-weight:bold;">✔</span> Чекирај за сите (${selCount})
      </div>
      <div class="context-menu-item" id="ctxUncheckAll">
        <span style="color:#ef4444;font-weight:bold;">✖</span> Одчекирај за сите (${selCount})
      </div>
      <div class="context-menu-item" id="ctxToggleAll">
        <span style="color:#2563eb;font-weight:bold;">🔄</span> Инвертирај состојба
      </div>
    `;

    document.body.appendChild(menu);

    document.getElementById('ctxCheckAll').onclick = (e) => {
      e.stopPropagation();
      CNCApp.Table.bulkSetCheckbox(field, true);
      CNCApp.Table.closeContextMenu();
    };

    document.getElementById('ctxUncheckAll').onclick = (e) => {
      e.stopPropagation();
      CNCApp.Table.bulkSetCheckbox(field, false);
      CNCApp.Table.closeContextMenu();
    };

    document.getElementById('ctxToggleAll').onclick = (e) => {
      e.stopPropagation();
      CNCApp.Table.bulkToggleCheckbox(field);
      CNCApp.Table.closeContextMenu();
    };
  },

  closeContextMenu: function() {
    const existing = document.getElementById('tableContextMenu');
    if (existing) existing.remove();
  },

  bulkSetCheckbox: function(field, val) {
    if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) return;
    const sel = CNCApp.State.selectedIndices;
    if (sel.size === 0) return;
    sel.forEach(idx => {
      if (CNCApp.State.points[idx]) {
        if (field === 'active' && CNCApp.State.points[idx].active !== val) {
          this.enforceActiveSafety(idx, val);
        }
        CNCApp.State.points[idx][field] = val;
      }
    });
    this.enforceDispenserSafety();
    CNCApp.State.snapshot();
    this.render();
    CNCApp.Canvas.render();
    CNCApp.GCode.updateCycleTime();
  },

  bulkToggleCheckbox: function(field) {
    if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) return;
    const sel = CNCApp.State.selectedIndices;
    if (sel.size === 0) return;
    sel.forEach(idx => {
      if (CNCApp.State.points[idx]) {
        const nextVal = !CNCApp.State.points[idx][field];
        if (field === 'active') {
          this.enforceActiveSafety(idx, nextVal);
        }
        CNCApp.State.points[idx][field] = nextVal;
      }
    });
    this.enforceDispenserSafety();
    CNCApp.State.snapshot();
    this.render();
    CNCApp.Canvas.render();
    CNCApp.GCode.updateCycleTime();
  },

  // БРЗО СЕЛЕКТИРАЊЕ НА МЕЃУТОЧКИ ВО ЛИНИЈА (Точки што не влијаат на диспензерот и дизната)
  selectIntermediatePoints: function() {
    const pts = CNCApp.State.points;
    if (!pts || pts.length === 0) return;

    // Точката НЕ влијае на диспензерот и дизната ако нема команда за спуштање, кревање или отворање/затворање вентил:
    function isIntermediate(p) {
      return p.active && !p.lower && !p.valveStart && !p.valveStop && !p.raise;
    }

    const currentSel = Array.from(CNCApp.State.selectedIndices).sort((a, b) => a - b);
    const newSel = new Set();

    if (currentSel.length > 1) {
      // 1. Корисникот веќе има селектирано линија или опсег од точки:
      // Филтрирај и задржи ги САМО меѓуточките во рамките на овој селектиран блок!
      currentSel.forEach(idx => {
        if (isIntermediate(pts[idx])) {
          newSel.add(idx);
        }
      });

      // Доколку беа избрани само почетната и крајната точка (без меѓуточките), селектирај ги меѓуточките помеѓу нив:
      if (newSel.size === 0) {
        const start = currentSel[0];
        const end = currentSel[currentSel.length - 1];
        for (let i = start; i <= end; i++) {
          if (isIntermediate(pts[i])) newSel.add(i);
        }
      }
    } else if (currentSel.length === 1 || (CNCApp.State.activePointIndex !== null && CNCApp.State.activePointIndex >= 0)) {
      // 2. Корисникот кликнал на една точка во линија:
      // Автоматски препознај ја целата непрекината линија на која ѝ припаѓа таа точка
      const targetIdx = currentSel.length === 1 ? currentSel[0] : CNCApp.State.activePointIndex;
      const targetDisp = pts[targetIdx].dispenser;

      let lineStart = targetIdx;
      while (lineStart > 0 && pts[lineStart - 1].dispenser === targetDisp && !pts[lineStart - 1].raise && !pts[lineStart - 1].valveStop) {
        lineStart--;
        if (pts[lineStart].lower || pts[lineStart].valveStart) break;
      }

      let lineEnd = targetIdx;
      while (lineEnd < pts.length - 1 && pts[lineEnd].dispenser === targetDisp && !pts[lineEnd].raise && !pts[lineEnd].valveStop) {
        lineEnd++;
        if (pts[lineEnd].raise || pts[lineEnd].valveStop) break;
      }

      for (let i = lineStart; i <= lineEnd; i++) {
        if (isIntermediate(pts[i])) newSel.add(i);
      }
    } else {
      // 3. Ништо не е селектирано: селектирај ги сите меѓуточки во сите линии низ табелата
      pts.forEach((p, idx) => {
        if (isIntermediate(p)) newSel.add(idx);
      });
    }

    if (newSel.size > 0) {
      CNCApp.State.selectedIndices = newSel;
      const firstIdx = Array.from(newSel)[0];
      CNCApp.State.activePointIndex = firstIdx;
      CNCApp.State.lastSelectedRowIndex = firstIdx;
      this.render();
      CNCApp.Canvas.render();
      this.scrollToRow(firstIdx);
    } else {
      alert("ℹ️ Не се пронајдени меѓуточки (точки без Доле/Горе/Вентил) во избраната селекција.");
    }
  },

  // ГРУПНО ПОСТАВУВАЊЕ НА БРЗИНА (F)
  promptBulkSpeed: function() {
    if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) return;
    const sel = CNCApp.State.selectedIndices;
    if (sel.size === 0) {
      this.selectIntermediatePoints();
    }
    if (CNCApp.State.selectedIndices.size === 0) return;

    const firstSel = Array.from(CNCApp.State.selectedIndices)[0];
    const curSpeed = Math.round(CNCApp.State.points[firstSel]?.speed || 1000);
    const valStr = prompt(`Внесете нова брзина (Feedrate F) за ${CNCApp.State.selectedIndices.size} селектирани точки:`, curSpeed);
    if (valStr === null) return;
    const newSpeed = Math.round(parseFloat(valStr));
    if (isNaN(newSpeed) || newSpeed <= 0) {
      alert("Внесете валидна позитивна вредност за брзина.");
      return;
    }

    CNCApp.State.selectedIndices.forEach(idx => {
      if (CNCApp.State.points[idx]) {
        CNCApp.State.points[idx].speed = newSpeed;
      }
    });

    CNCApp.State.snapshot();
    this.render();
    CNCApp.Canvas.render();
    CNCApp.GCode.updateCycleTime();
  },

  scaleSpeed: function(factor) {
    if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) return;
    const sel = CNCApp.State.selectedIndices;
    if (sel.size === 0) return;
    sel.forEach(idx => {
      const p = CNCApp.State.points[idx];
      if (p && p.speed > 0) {
        p.speed = Math.max(50, Math.round(p.speed * factor));
      }
    });
    CNCApp.State.snapshot();
    this.render();
    CNCApp.Canvas.render();
    CNCApp.GCode.updateCycleTime();
  }
};