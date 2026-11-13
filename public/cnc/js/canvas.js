window.CNCApp = window.CNCApp || {};

CNCApp.Canvas = {
  canvas: null,
  ctx: null,
  scale: 15,
  panX: 50,
  panY: 50,
  isDragging: false,
  isPanning: false,
  isBoxSelecting: false,
  draggedIndex: null,
  dragStartMouse: { x: 0, y: 0 },
  dragStartPoints: new Map(),
  startX: 0,
  startY: 0,
  boxStartX: 0,
  boxStartY: 0,
  boxCurX: 0,
  boxCurY: 0,

  init: function() {
    this.canvas = document.getElementById('mainCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.resize();

    window.addEventListener('resize', () => { this.resize(); this.render(); });
    this.panY = this.canvas.height - 50;

    this.bindEvents();
    this.render();
  },

  resize: function() {
    const wrap = document.getElementById('canvasWrapper');
    this.canvas.width = wrap.clientWidth;
    this.canvas.height = wrap.clientHeight;
  },

  resetView: function() {
    this.resize();
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (w <= 0 || h <= 0) return;

    let minX = 0;
    let minY = 0;
    let maxX = 40;
    let maxY = 40;

    const pts = CNCApp.State.points;
    if (pts && pts.length > 0) {
      pts.forEach(p => {
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
      });
    }

    if (CNCApp.State.svgImage) {
      const sw = (CNCApp.State.svgImage.width || 100) / 3.7795;
      const sh = (CNCApp.State.svgImage.height || 100) / 3.7795;
      if (sw > maxX) maxX = sw;
      if (sh > maxY) maxY = sh;
    }

    const spanX = (maxX - minX) || 40;
    const spanY = (maxY - minY) || 40;
    const paddingPx = 50;

    const availW = Math.max(50, w - paddingPx * 2);
    const availH = Math.max(50, h - paddingPx * 2);

    const scaleX = availW / spanX;
    const scaleY = availH / spanY;
    this.scale = Math.min(scaleX, scaleY);
    if (this.scale <= 0.05) this.scale = 0.05;
    if (this.scale > 80) this.scale = 80;

    const drawnW = spanX * this.scale;
    const drawnH = spanY * this.scale;

    this.panX = paddingPx + (availW - drawnW) / 2 - (minX * this.scale);
    this.panY = h - (paddingPx + (availH - drawnH) / 2) + (minY * this.scale);

    this.render();
  },

  worldToScreen: function(wx, wy) {
    return {
      x: this.panX + wx * this.scale,
      y: this.panY - wy * this.scale
    };
  },

  screenToWorld: function(sx, sy) {
    return {
      x: (sx - this.panX) / this.scale,
      y: (this.panY - sy) / this.scale
    };
  },

  bindEvents: function() {
    const c = this.canvas;
    const coordLbl = document.getElementById('coordDisplay');

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      const mouse = this.screenToWorld(e.offsetX, e.offsetY);
      this.scale *= zoomFactor;
      this.panX = e.offsetX - mouse.x * this.scale;
      this.panY = e.offsetY + mouse.y * this.scale;
      this.render();
    });

    c.addEventListener('mousedown', (e) => {
      if (e.button === 1 || e.spaceKey) {
        this.isPanning = true;
        this.startX = e.clientX - this.panX;
        this.startY = e.clientY - this.panY;
        return;
      }

      if (e.button === 0) {
        const mouse = this.screenToWorld(e.offsetX, e.offsetY);
        const idx = this.findHitPoint(mouse.x, mouse.y);
        const isReadOnly = CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly();

        if (CNCApp.State.isAddMode) {
          if (isReadOnly) {
            alert('🔒 Овој таб моментално работи на машината и не може да се додаваат точки во него.');
            return;
          }
          CNCApp.Table.insertNewPointAt(mouse.x, mouse.y);
          return;
        }

        if (CNCApp.Machine && CNCApp.Machine.isMoveToClickMode) {
          CNCApp.Machine.moveDispenserToModelPoint(mouse.x, mouse.y);
          return;
        }

        if (idx !== null) {
          CNCApp.State.activePointIndex = idx;
          if (!e.ctrlKey && !e.shiftKey && !CNCApp.State.selectedIndices.has(idx)) {
            CNCApp.State.selectedIndices.clear();
          }
          CNCApp.State.selectedIndices.add(idx);

          if (!isReadOnly) {
            this.isDragging = true;
            this.draggedIndex = idx;
            this.dragStartMouse = { x: mouse.x, y: mouse.y };
            this.dragStartPoints.clear();
            CNCApp.State.selectedIndices.forEach(sIdx => {
              const p = CNCApp.State.points[sIdx];
              this.dragStartPoints.set(sIdx, { x: p.x, y: p.y });
            });
          }

          CNCApp.Table.render();
          CNCApp.Table.scrollToRow(idx);
          this.render();
        } else {
          this.isBoxSelecting = true;
          this.isAdditiveSelection = e.shiftKey || e.ctrlKey;
          this.boxStartX = e.offsetX;
          this.boxStartY = e.offsetY;
          this.boxCurX = e.offsetX;
          this.boxCurY = e.offsetY;
          if (!e.ctrlKey && !e.shiftKey) {
            CNCApp.State.selectedIndices.clear();
          }
          this.render();
        }
      }
    });

    window.addEventListener('mousemove', (e) => {
      const rect = c.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      if (sx >= 0 && sx <= c.width && sy >= 0 && sy <= c.height) {
        const w = this.screenToWorld(sx, sy);
        coordLbl.innerText = 'X: ' + w.x.toFixed(3) + ', Y: ' + w.y.toFixed(3);
      }

      if (this.isPanning) {
        this.panX = e.clientX - this.startX;
        this.panY = e.clientY - this.startY;
        this.render();
      } else if (this.isDragging && this.dragStartPoints.size > 0) {
        const curMouse = this.screenToWorld(sx, sy);
        const dx = curMouse.x - this.dragStartMouse.x;
        const dy = curMouse.y - this.dragStartMouse.y;

        this.dragStartPoints.forEach((initPos, sIdx) => {
          const pt = CNCApp.State.points[sIdx];
          pt.x = parseFloat((initPos.x + dx).toFixed(3));
          pt.y = parseFloat((initPos.y + dy).toFixed(3));
          CNCApp.Table.updateRow(sIdx);
        });
        this.render();
      } else if (this.isBoxSelecting) {
        this.boxCurX = sx;
        this.boxCurY = sy;
        this.render();
      }
    });

    window.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.draggedIndex = null;
        this.dragStartPoints.clear();
        CNCApp.State.snapshot();
      }
      if (this.isBoxSelecting) {
        this.isBoxSelecting = false;
        this.finishBoxSelect();
        this.render();
      }
      this.isPanning = false;
    });
  },

  finishBoxSelect: function() {
    const x1 = Math.min(this.boxStartX, this.boxCurX);
    const x2 = Math.max(this.boxStartX, this.boxCurX);
    const y1 = Math.min(this.boxStartY, this.boxCurY);
    const y2 = Math.max(this.boxStartY, this.boxCurY);

    if (Math.abs(x2 - x1) > 4 || Math.abs(y2 - y1) > 4) {
      CNCApp.State.points.forEach((p, idx) => {
        if (CNCApp.State.shadedDispensers && CNCApp.State.shadedDispensers.has(p.dispenser)) {
          return;
        }
        const sp = this.worldToScreen(p.x, p.y);
        if (sp.x >= x1 && sp.x <= x2 && sp.y >= y1 && sp.y <= y2) {
          CNCApp.State.selectedIndices.add(idx);
        }
      });
      CNCApp.Table.render();
    }
  },

  findHitPoint: function(wx, wy) {
    const threshold = 8 / this.scale;
    for (let i = CNCApp.State.points.length - 1; i >= 0; i--) {
      const p = CNCApp.State.points[i];
      if (CNCApp.State.shadedDispensers && CNCApp.State.shadedDispensers.has(p.dispenser)) {
        continue;
      }
      const dist = Math.hypot(p.x - wx, p.y - wy);
      if (dist <= threshold) return i;
    }
    return null;
  },

  render: function() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (this.canvas) {
      if (CNCApp.State.isAddMode || (CNCApp.Machine && CNCApp.Machine.isMoveToClickMode)) {
        this.canvas.style.cursor = 'crosshair';
      } else {
        this.canvas.style.cursor = '';
      }
    }

    this.drawGrid(5);
    this.drawReachableBoundary();

    if (CNCApp.State.svgImage && CNCApp.State.showSvg !== false) {
      const pos = this.worldToScreen(0, 0);
      const img = CNCApp.State.svgImage;
      const sw = (img.width || 100) * (this.scale / 3.7795);
      const sh = (img.height || 100) * (this.scale / 3.7795);
      ctx.globalAlpha = 0.45;
      ctx.drawImage(img, pos.x, pos.y - sh, sw, sh);
      ctx.globalAlpha = 1.0;
    }

    const pts = CNCApp.State.points;
    const activeVisiblePts = [];
    pts.forEach((p, idx) => {
      if (!p.active) return;
      if (CNCApp.State.shadedDispensers && CNCApp.State.shadedDispensers.has(p.dispenser)) return;
      activeVisiblePts.push({ p, idx, sp: this.worldToScreen(p.x, p.y) });
    });

    if (activeVisiblePts.length > 1) {
      // 1. Главна линија на патеката
      ctx.beginPath();
      ctx.strokeStyle = "#94a3b8";
      ctx.lineWidth = 1.2;
      ctx.moveTo(activeVisiblePts[0].sp.x, activeVisiblePts[0].sp.y);
      for (let i = 1; i < activeVisiblePts.length; i++) {
        ctx.lineTo(activeVisiblePts[i].sp.x, activeVisiblePts[i].sp.y);
      }
      ctx.stroke();

      // 2. Дискретни насочни стрелки на секој сегмент
      ctx.fillStyle = "#64748b";
      const arrowLength = 6.5;
      const arrowWidth = 3.5;

      for (let i = 0; i < activeVisiblePts.length - 1; i++) {
        const p1 = activeVisiblePts[i].sp;
        const p2 = activeVisiblePts[i + 1].sp;
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dist = Math.hypot(dx, dy);

        // Прикажи стрелка само ако сегментот е доволно долг (барем 14px на екран)
        if (dist >= 14) {
          const angle = Math.atan2(dy, dx);
          const midX = (p1.x + p2.x) / 2;
          const midY = (p1.y + p2.y) / 2;

          ctx.save();
          ctx.translate(midX, midY);
          ctx.rotate(angle);
          ctx.beginPath();
          ctx.moveTo(arrowLength * 0.5, 0); // Врв на стрелката
          ctx.lineTo(-arrowLength * 0.5, -arrowWidth);
          ctx.lineTo(-arrowLength * 0.25, 0);
          ctx.lineTo(-arrowLength * 0.5, arrowWidth);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
    }

    pts.forEach((p, idx) => {
      const sp = this.worldToScreen(p.x, p.y);
      const isSel = CNCApp.State.selectedIndices.has(idx);
      const isAct = CNCApp.State.activePointIndex === idx;
      const isShaded = CNCApp.State.shadedDispensers && CNCApp.State.shadedDispensers.has(p.dispenser);

      const disp = CNCApp.State.machine.dispensers.find(d => d.id === p.dispenser) || { color: '#2563eb' };
      ctx.fillStyle = disp.color;

      ctx.beginPath();
      ctx.arc(sp.x, sp.y, isSel ? 6 : 4, 0, Math.PI * 2);

      if (isShaded) {
        ctx.globalAlpha = 0.12;
      } else {
        ctx.globalAlpha = p.active ? 1.0 : 0.35;
      }
      ctx.fill();
      ctx.globalAlpha = 1.0;

      // Приказ на безбедносен радиус (клиренс до ѕид) за автоматски пресметани точки
      if (CNCApp.State.showClearanceRings && p.clearance && p.clearance > 0 && !isShaded) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, p.clearance * this.scale, 0, Math.PI * 2);
        ctx.strokeStyle = isSel ? "rgba(37, 99, 235, 0.75)" : "rgba(16, 185, 129, 0.35)";
        ctx.lineWidth = isSel ? 1.5 : 1;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.restore();
      }

      if (!isShaded) {
        if (isSel) {
          ctx.strokeStyle = "#0f172a";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        if (isAct) {
          ctx.strokeStyle = "#2563eb";
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, 10, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else {
        ctx.strokeStyle = "#cbd5e1";
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.25;
        ctx.stroke();
        ctx.globalAlpha = 1.0;
      }
    });

    // 3. Дискретни ознаки (беџови) за редните броеви: Селектирана, Претходна и Следна активна точка
    let targetIdx = CNCApp.State.activePointIndex;
    if (targetIdx === null || targetIdx === undefined || !pts[targetIdx]) {
      if (CNCApp.State.selectedIndices && CNCApp.State.selectedIndices.size > 0) {
        targetIdx = Array.from(CNCApp.State.selectedIndices)[0];
      }
    }

    if (targetIdx !== null && targetIdx !== undefined && pts[targetIdx]) {
      // Најди ја најблиската претходна активна точка
      let prevActiveIdx = null;
      for (let i = targetIdx - 1; i >= 0; i--) {
        if (pts[i].active && (!CNCApp.State.shadedDispensers || !CNCApp.State.shadedDispensers.has(pts[i].dispenser))) {
          prevActiveIdx = i;
          break;
        }
      }

      // Најди ја најблиската следна активна точка
      let nextActiveIdx = null;
      for (let i = targetIdx + 1; i < pts.length; i++) {
        if (pts[i].active && (!CNCApp.State.shadedDispensers || !CNCApp.State.shadedDispensers.has(pts[i].dispenser))) {
          nextActiveIdx = i;
          break;
        }
      }

      const drawBadge = (screenPos, text, type) => {
        ctx.save();
        ctx.font = (type === 'curr') ? "bold 10px sans-serif" : "9px sans-serif";
        const textWidth = ctx.measureText(text).width;
        const bW = textWidth + 8;
        const bH = (type === 'curr') ? 16 : 14;
        const bX = Math.round(screenPos.x - bW / 2);
        const bY = Math.round(screenPos.y - ((type === 'curr') ? 22 : 18));

        // Позадина на беџот
        if (type === 'curr') {
          ctx.fillStyle = "#0f172a";
          ctx.strokeStyle = "#3b82f6";
          ctx.lineWidth = 1.5;
        } else {
          ctx.fillStyle = "rgba(248, 250, 252, 0.95)";
          ctx.strokeStyle = "#94a3b8";
          ctx.lineWidth = 1;
        }

        const r = 3;
        ctx.beginPath();
        ctx.moveTo(bX + r, bY);
        ctx.arcTo(bX + bW, bY, bX + bW, bY + bH, r);
        ctx.arcTo(bX + bW, bY + bH, bX, bY + bH, r);
        ctx.arcTo(bX, bY + bH, bX, bY, r);
        ctx.arcTo(bX, bY, bX + bW, bY, r);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = (type === 'curr') ? "#ffffff" : "#334155";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, screenPos.x, bY + bH / 2);
        ctx.restore();
      };

      if (prevActiveIdx !== null) {
        const spPrev = this.worldToScreen(pts[prevActiveIdx].x, pts[prevActiveIdx].y);
        drawBadge(spPrev, `⬅ ${prevActiveIdx + 1}`, 'prev');
      }

      if (nextActiveIdx !== null) {
        const spNext = this.worldToScreen(pts[nextActiveIdx].x, pts[nextActiveIdx].y);
        drawBadge(spNext, `${nextActiveIdx + 1} ➡`, 'next');
      }

      const spCurr = this.worldToScreen(pts[targetIdx].x, pts[targetIdx].y);
      drawBadge(spCurr, `[ ${targetIdx + 1} ]`, 'curr');
    }

    if (this.isBoxSelecting) {
      const bx = Math.min(this.boxStartX, this.boxCurX);
      const by = Math.min(this.boxStartY, this.boxCurY);
      const bw = Math.abs(this.boxCurX - this.boxStartX);
      const bh = Math.abs(this.boxCurY - this.boxStartY);

      if (this.isAdditiveSelection) {
        ctx.fillStyle = "rgba(16, 185, 129, 0.18)";
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = "#059669";
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(bx, by, bw, bh);
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = "rgba(37, 99, 235, 0.15)";
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = "#2563eb";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(bx, by, bw, bh);
        ctx.setLineDash([]);
      }
    }

    // 4. Жива позиција на дизната од поврзаната машина (2D Симулатор / Mach3, со поддршка за повеќе спуштени диспензери)
    if (CNCApp.Machine && typeof CNCApp.Machine.isConnected === 'function' && CNCApp.Machine.isConnected()) {
      const mBusy = typeof CNCApp.Machine.isBusy === 'function' && CNCApp.Machine.isBusy();
      const activeTabId = CNCApp.Tabs ? CNCApp.Tabs.activeTabId : null;
      const showHeadHere = mBusy
        ? (!activeTabId || !CNCApp.Machine.runningTabId || activeTabId === CNCApp.Machine.runningTabId)
        : true;

      if (showHeadHere) {
        const mc = CNCApp.Machine.coords || {};
        const dispList = (CNCApp.State.machine && Array.isArray(CNCApp.State.machine.dispensers))
          ? CNCApp.State.machine.dispensers
          : [];
        const loweredArr = Array.isArray(mc.loweredDispensers) ? mc.loweredDispensers : [];
        const hasAnyLowered = loweredArr.length > 0;
        const isValve = !!mc.valveOpen;

        let refDispId = mc.activeDispenserId || 1;
        if (!mBusy && typeof CNCApp.Machine.getSelectedPanelDispenser === 'function') {
          refDispId = CNCApp.Machine.getSelectedPanelDispenser().id;
        }
        const dispObj = dispList.find(d => d.id === refDispId) || { id: refDispId, offsetX: 0, offsetY: 0 };
        const modelX = (mc.x || 0) - (dispObj.offsetX || 0);
        const modelY = (mc.y || 0) - (dispObj.offsetY || 0);
        const headSp = this.worldToScreen(modelX, modelY);

        const refLowered = loweredArr.indexOf(refDispId) !== -1;
        const headColor = (isValve && hasAnyLowered)
          ? '#ef4444'
          : (refLowered ? '#f59e0b' : (isValve ? '#dc2626' : '#059669'));

        ctx.save();
        ctx.beginPath();
        ctx.arc(headSp.x, headSp.y, isValve ? 11 : 9, 0, Math.PI * 2);
        ctx.fillStyle = isValve
          ? 'rgba(239, 68, 68, 0.22)'
          : (refLowered ? 'rgba(245, 158, 11, 0.20)' : 'rgba(16, 185, 129, 0.14)');
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = headColor;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(headSp.x - 14, headSp.y);
        ctx.lineTo(headSp.x + 14, headSp.y);
        ctx.moveTo(headSp.x, headSp.y - 14);
        ctx.lineTo(headSp.x, headSp.y + 14);
        ctx.lineWidth = 1.3;
        ctx.stroke();

        ctx.font = 'bold 9.5px sans-serif';
        ctx.fillStyle = headColor;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        const statusSuffix = (refLowered ? ' ⬇' : '') + (isValve ? ' ●' : '');
        ctx.fillText('Д' + refDispId + statusSuffix, headSp.x + 11, headSp.y - 9);
        ctx.restore();

        for (let li = 0; li < loweredArr.length; li++) {
          const lowId = loweredArr[li];
          if (lowId === refDispId) continue;
          const lowDisp = dispList.find(d => d.id === lowId);
          if (!lowDisp) continue;
          const lmX = (mc.x || 0) - (lowDisp.offsetX || 0);
          const lmY = (mc.y || 0) - (lowDisp.offsetY || 0);
          const lowSp = this.worldToScreen(lmX, lmY);

          ctx.save();
          ctx.beginPath();
          ctx.arc(lowSp.x, lowSp.y, 7, 0, Math.PI * 2);
          ctx.fillStyle = isValve ? 'rgba(239, 68, 68, 0.22)' : 'rgba(245, 158, 11, 0.22)';
          ctx.fill();
          ctx.lineWidth = 1.6;
          ctx.strokeStyle = isValve ? '#ef4444' : '#f59e0b';
          ctx.stroke();

          ctx.font = 'bold 9px sans-serif';
          ctx.fillStyle = isValve ? '#dc2626' : '#d97706';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'bottom';
          ctx.fillText('Д' + lowId + ' ⬇' + (isValve ? ' ●' : ''), lowSp.x + 8, lowSp.y - 6);
          ctx.restore();
        }
      }
    }
  },

  drawReachableBoundary: function() {
    if (!CNCApp.State || !CNCApp.State.machine) return;
    const m = CNCApp.State.machine;
    const lim = (CNCApp.Machine && typeof CNCApp.Machine.getLimits === 'function')
      ? CNCApp.Machine.getLimits()
      : {
          minX: (typeof m.minX === 'number') ? m.minX : -5,
          maxX: (typeof m.maxX === 'number') ? m.maxX : 350,
          minY: (typeof m.minY === 'number') ? m.minY : -5,
          maxY: (typeof m.maxY === 'number') ? m.maxY : 300
        };

    const dispList = Array.isArray(m.dispensers) ? m.dispensers : [];
    let disp = dispList[0] || { id: 1, offsetX: 0, offsetY: 0 };
    if (CNCApp.Machine && typeof CNCApp.Machine.getSelectedPanelDispenser === 'function') {
      const mBusy = typeof CNCApp.Machine.isBusy === 'function' && CNCApp.Machine.isBusy();
      if (mBusy && CNCApp.Machine.coords && CNCApp.Machine.coords.activeDispenserId) {
        disp = dispList.find(d => d.id === CNCApp.Machine.coords.activeDispenserId) || disp;
      } else {
        disp = CNCApp.Machine.getSelectedPanelDispenser();
      }
    }

    const reachMinX = lim.minX - (disp.offsetX || 0);
    const reachMaxX = lim.maxX - (disp.offsetX || 0);
    const reachMinY = lim.minY - (disp.offsetY || 0);
    const reachMaxY = lim.maxY - (disp.offsetY || 0);

    const tl = this.worldToScreen(reachMinX, reachMaxY);
    const br = this.worldToScreen(reachMaxX, reachMinY);
    const bw = br.x - tl.x;
    const bh = br.y - tl.y;
    if (bw <= 2 || bh <= 2) return;

    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const isMoveMode = !!(CNCApp.Machine && CNCApp.Machine.isMoveToClickMode);

    ctx.save();
    ctx.beginPath();
    ctx.rect(tl.x, tl.y, bw, bh);
    ctx.strokeStyle = isMoveMode ? 'rgba(2, 132, 199, 0.72)' : 'rgba(100, 116, 139, 0.42)';
    ctx.lineWidth = isMoveMode ? 1.5 : 1.1;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    if (br.x > 0 && br.y > 0 && tl.x < cw && tl.y < ch) {
      const lbl = 'Дофат Д' + disp.id + ' ([' + reachMinX.toFixed(1) + '..' + reachMaxX.toFixed(1) + '], [' + reachMinY.toFixed(1) + '..' + reachMaxY.toFixed(1) + '])';
      const lblX = Math.max(6, Math.min(cw - 210, tl.x + 6));
      const lblY = (tl.y >= 4 && tl.y <= ch - 20) ? (tl.y + 4) : 6;
      ctx.font = '600 9.5px sans-serif';
      ctx.fillStyle = isMoveMode ? 'rgba(3, 105, 161, 0.85)' : 'rgba(71, 85, 105, 0.72)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(lbl, lblX, lblY);
    }
    ctx.restore();
  },

  drawGrid: function(stepMm) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;

    const start = this.screenToWorld(0, h);
    const end = this.screenToWorld(w, 0);

    const minX = Math.floor(start.x / stepMm) * stepMm;
    const maxX = Math.ceil(end.x / stepMm) * stepMm;
    const minY = Math.floor(start.y / stepMm) * stepMm;
    const maxY = Math.ceil(end.y / stepMm) * stepMm;

    ctx.beginPath();
    for (let x = minX; x <= maxX; x += stepMm) {
      const sx = this.worldToScreen(x, 0).x;
      ctx.moveTo(sx, 0); ctx.lineTo(sx, h);
    }
    for (let y = minY; y <= maxY; y += stepMm) {
      const sy = this.worldToScreen(0, y).y;
      ctx.moveTo(0, sy); ctx.lineTo(w, sy);
    }
    ctx.stroke();

    const zero = this.worldToScreen(0, 0);
    ctx.strokeStyle = "#64748b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(zero.x, 0); ctx.lineTo(zero.x, h);
    ctx.moveTo(0, zero.y); ctx.lineTo(w, zero.y);
    ctx.stroke();
  }
};