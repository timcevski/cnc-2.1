window.CNCApp = window.CNCApp || {};

CNCApp.GCode = {
  telemetry: { totalSec: 0, travelSec: 0, dwellSec: 0, totalDistMm: 0 },

  formatCoord: function(val) {
    let str = (typeof val === 'number') ? val.toFixed(3) : parseFloat(val).toFixed(3);
    if (CNCApp.State.machine.decimalSeparator === ',') {
      str = str.replace('.', ',');
    }
    return str;
  },

  generate: function(startIndex) {
    const pts = CNCApp.State.points;
    const m = CNCApp.State.machine;
    const isSec = m.timeUnit === 's';
    let lines = [];

    if (CNCApp.State.header) lines.push(CNCApp.State.header);

    const startFromIdx = (typeof startIndex === 'number' && startIndex >= 0 && startIndex < pts.length) ? startIndex : 0;
    let currentDispenser = null;

    if (startFromIdx > 0) {
      // Најди ја претходната активна точка (N-1)
      let prevActiveIdx = -1;
      for (let i = startFromIdx - 1; i >= 0; i--) {
        if (pts[i] && pts[i].active) {
          prevActiveIdx = i;
          break;
        }
      }

      const targetPt = pts[startFromIdx];

      if (prevActiveIdx !== -1 && targetPt && targetPt.active) {
        const prevPt = pts[prevActiveIdx];

        // Анализирај ја историската состојба на диспензерот и вентилот до prevActiveIdx
        let stateDispenser = null;
        let isLowered = false;
        let isValveOpen = false;

        for (let i = 0; i <= prevActiveIdx; i++) {
          const p = pts[i];
          if (!p.active) continue;
          const disp = m.dispensers.find(d => d.id === p.dispenser) || m.dispensers[0];
          if (stateDispenser && stateDispenser.id !== disp.id) {
            isValveOpen = false;
            isLowered = false;
          }
          stateDispenser = disp;
          if (p.lower) isLowered = true;
          if (p.valveStart) isValveOpen = true;
          if (p.valveStop) isValveOpen = false;
          if (p.raise) isLowered = false;
        }

        const prevDisp = stateDispenser || (m.dispensers.find(d => d.id === prevPt.dispenser) || m.dispensers[0]);
        const prevMx = this.formatCoord(prevPt.x + (prevDisp.offsetX || 0));
        const prevMy = this.formatCoord(prevPt.y + (prevDisp.offsetY || 0));

        const targetDisp = m.dispensers.find(d => d.id === targetPt.dispenser) || m.dispensers[0];
        const targetMx = this.formatCoord(targetPt.x + (targetDisp.offsetX || 0));
        const targetMy = this.formatCoord(targetPt.y + (targetDisp.offsetY || 0));
        const targetSpd = Math.round(targetPt.speed || 1000);

        lines.push(`; === ПОЧНИ ОД ТУКА (Ред #${startFromIdx + 1}) ===`);
        // Безбедно затворање вентил и кревање пред почетното придвижување
        lines.push(m.valveCloseCmd);
        lines.push(prevDisp.raiseCmd);
        const rDelay = isSec ? (m.systemDelayRaise / 1000).toFixed(3) : Math.round(m.systemDelayRaise);
        const rDelayStr = isSec && m.decimalSeparator === ',' ? String(rDelay).replace('.', ',') : String(rDelay);
        lines.push(`G4 P${rDelayStr}`);

        // 1. Позиционирање над претходната точка N-1 со подигнат диспензер
        lines.push(`G1 X${prevMx} Y${prevMy} F${m.moveClickSpeed || 3000} ;Безбедно позиционирање над N-1 (#${prevActiveIdx + 1})`);

        // Дали целната точка е дел од активна линија?
        const isPartOfActiveLine = (isLowered || !targetPt.lower) && (prevDisp.id === targetDisp.id);

        if (isPartOfActiveLine) {
          // Случај А (Линија): Спуштање на диспензерот на позиција N-1
          lines.push(prevDisp.lowerCmd + ` ;Спуштање цилиндар на N-1 пред движење`);
          const lDelay = isSec ? (m.systemDelayLower / 1000).toFixed(3) : Math.round(m.systemDelayLower);
          const lDelayStr = isSec && m.decimalSeparator === ',' ? String(lDelay).replace('.', ',') : String(lDelay);
          lines.push(`G4 P${lDelayStr}`);

          // Работно движење кон целната точка N
          lines.push(`G1 X${targetMx} Y${targetMy} F${targetSpd} ;ID:${startFromIdx + 1} G1:${targetPt.group1 || ''} G2:${targetPt.group2 || ''}`);

          // Пристигнување на точката N: отворање вентил
          lines.push(m.valveOpenCmd + ` ;Отворање вентил точно над точка #${startFromIdx + 1}`);

          // Извршување на останатите операции на точката N доколку се дефинирани
          const dwell = parseFloat(targetPt.time);
          if (!isNaN(dwell) && dwell > 0) {
            if (isSec) {
              let dVal = (dwell / 1000).toFixed(3);
              if (m.decimalSeparator === ',') dVal = dVal.replace('.', ',');
              lines.push(`G4 P${dVal}`);
            } else {
              lines.push(`G4 P${Math.round(dwell)}`);
            }
          }
          if (targetPt.valveStop) {
            lines.push(m.valveCloseCmd);
          }
          if (targetPt.raise) {
            lines.push(targetDisp.raiseCmd);
            lines.push(`G4 P${rDelayStr}`);
          }
        } else {
          // Случај Б (Самостојна капка или почеток на нова независна линија):
          // Движење подигнат од N-1 до целната точка N
          lines.push(`G1 X${targetMx} Y${targetMy} F${targetSpd} ;ID:${startFromIdx + 1} G1:${targetPt.group1 || ''} G2:${targetPt.group2 || ''}`);

          // Целосен нормален циклус на самата точка N
          if (targetPt.lower) {
            lines.push(targetDisp.lowerCmd);
            const lDelay = isSec ? (m.systemDelayLower / 1000).toFixed(3) : Math.round(m.systemDelayLower);
            const lDelayStr = isSec && m.decimalSeparator === ',' ? String(lDelay).replace('.', ',') : String(lDelay);
            lines.push(`G4 P${lDelayStr}`);
          }
          if (targetPt.valveStart) {
            lines.push(m.valveOpenCmd);
          }
          const dwell = parseFloat(targetPt.time);
          if (!isNaN(dwell) && dwell > 0) {
            if (isSec) {
              let dVal = (dwell / 1000).toFixed(3);
              if (m.decimalSeparator === ',') dVal = dVal.replace('.', ',');
              lines.push(`G4 P${dVal}`);
            } else {
              lines.push(`G4 P${Math.round(dwell)}`);
            }
          }
          if (targetPt.valveStop) {
            lines.push(m.valveCloseCmd);
          }
          if (targetPt.raise) {
            lines.push(targetDisp.raiseCmd);
            lines.push(`G4 P${rDelayStr}`);
          }
        }

        currentDispenser = targetDisp;
      }
    }

    // Редовен циклус за преостанатите точки
    const loopStartIndex = (startFromIdx > 0) ? (startFromIdx + 1) : 0;

    for (let idx = loopStartIndex; idx < pts.length; idx++) {
      const p = pts[idx];
      if (!p.active) continue;

      const disp = m.dispensers.find(d => d.id === p.dispenser) || m.dispensers[0];
      
      if (currentDispenser && currentDispenser.id !== disp.id) {
        lines.push(m.valveCloseCmd);
        lines.push(currentDispenser.raiseCmd);
        const rDelay = isSec ? (m.systemDelayRaise / 1000).toFixed(3) : Math.round(m.systemDelayRaise);
        const rDelayStr = isSec && m.decimalSeparator === ',' ? String(rDelay).replace('.', ',') : String(rDelay);
        lines.push(`G4 P${rDelayStr}`);
      }
      currentDispenser = disp;

      const mx = this.formatCoord(p.x + (disp.offsetX || 0));
      const my = this.formatCoord(p.y + (disp.offsetY || 0));
      const spd = Math.round(p.speed || 1000);

      lines.push(`G1 X${mx} Y${my} F${spd} ;ID:${idx + 1} G1:${p.group1 || ''} G2:${p.group2 || ''}`);

      if (p.lower) {
        lines.push(disp.lowerCmd);
        const lDelay = isSec ? (m.systemDelayLower / 1000).toFixed(3) : Math.round(m.systemDelayLower);
        const lDelayStr = isSec && m.decimalSeparator === ',' ? String(lDelay).replace('.', ',') : String(lDelay);
        lines.push(`G4 P${lDelayStr}`);
      }

      if (p.valveStart) {
        lines.push(m.valveOpenCmd);
      }

      const dwell = parseFloat(p.time);
      if (!isNaN(dwell) && dwell > 0) {
        if (isSec) {
          let dVal = (dwell / 1000).toFixed(3);
          if (m.decimalSeparator === ',') dVal = dVal.replace('.', ',');
          lines.push(`G4 P${dVal}`);
        } else {
          lines.push(`G4 P${Math.round(dwell)}`);
        }
      }

      if (p.valveStop) {
        lines.push(m.valveCloseCmd);
      }

      if (p.raise) {
        lines.push(disp.raiseCmd);
        const rDelay = isSec ? (m.systemDelayRaise / 1000).toFixed(3) : Math.round(m.systemDelayRaise);
        const rDelayStr = isSec && m.decimalSeparator === ',' ? String(rDelay).replace('.', ',') : String(rDelay);
        lines.push(`G4 P${rDelayStr}`);
      }
    }

    if (CNCApp.State.footer) {
      const footerLines = CNCApp.State.footer.split(/[\r\n;]+/).map(s => s.trim()).filter(Boolean);
      footerLines.forEach(fl => lines.push(fl));
    }

    return lines.join('\r\n');
  },

  updateCycleTime: function() {
    const pts = CNCApp.State.points.filter(p => p.active);
    const m = CNCApp.State.machine;
    const mLatencySec = (m.mCommandLatency || 120) / 1000;

    let totalSec = 0, travelSec = 0, dwellSec = 0, totalDistMm = 0;
    let lastPhysX = 0, lastPhysY = 0;
    let currentDisp = null;

    pts.forEach((p, idx) => {
      const disp = m.dispensers.find(d => d.id === p.dispenser) || m.dispensers[0];
      
      const physX = p.x + (disp.offsetX || 0);
      const physY = p.y + (disp.offsetY || 0);

      if (currentDisp && currentDisp.id !== disp.id) {
        dwellSec += (m.systemDelayRaise / 1000) + (mLatencySec * 2);
      }
      currentDisp = disp;

      const dist = Math.hypot(physX - lastPhysX, physY - lastPhysY);
      totalDistMm += dist;

      const feedMmSec = (p.speed || 1000) / 60;
      const pureTravel = dist / feedMmSec;
      const stopAndGoPenalty = dist > 0.01 ? 0.35 : 0;
      travelSec += pureTravel + stopAndGoPenalty;

      if (p.lower) {
        dwellSec += (m.systemDelayLower / 1000) + mLatencySec;
      }
      if (p.valveStart) {
        dwellSec += mLatencySec;
      }
      const t = parseFloat(p.time);
      if (!isNaN(t) && t > 0) {
        dwellSec += t / 1000;
      }
      if (p.valveStop) {
        dwellSec += mLatencySec;
      }
      if (p.raise) {
        dwellSec += (m.systemDelayRaise / 1000) + mLatencySec;
      }

      lastPhysX = physX;
      lastPhysY = physY;
    });

    totalSec = travelSec + dwellSec;
    this.telemetry = { totalSec, travelSec, dwellSec, totalDistMm };

    const min = Math.floor(totalSec / 60);
    const sec = Math.round(totalSec % 60);
    const meters = (totalDistMm / 1000).toFixed(2);

    document.getElementById('cycleTimeDisplay').innerText = `Време: ~${min}м ${sec}с`;
    document.getElementById('cycleSubDisplay').innerText = `Патека: ${meters}m`;
  }
};