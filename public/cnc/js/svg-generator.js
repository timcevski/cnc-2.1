window.CNCApp = window.CNCApp || {};

CNCApp.SvgGenerator = {
  currentSvgString: null,
  parsedShapes: [],
  detectedFillColors: [],
  detectedStrokeColors: [],
  colorMapping: new Map(), // hexColor -> dispenserId (0 means Ignore / Do not fill)
  svgBounds: { minX: 0, minY: 0, width: 100, height: 100 },
  detectedPhysicalWidthMm: null,
  detectedPhysicalHeightMm: null,

  // Примерни вградени SVG шаблони за брзо тестирање
  sampleSvgs: {
    star: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <polygon points="50,5 64,36 98,36 70,57 81,91 50,70 19,91 30,57 2,36 36,36" 
           fill="#2563eb" stroke="#1d4ed8" stroke-width="1.5" />
  <circle cx="50" cy="50" r="14" fill="#dc2626" stroke="#991b1b" stroke-width="1" />
</svg>`,

    flower3Color: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
  <circle cx="60" cy="60" r="14" fill="#d97706" />
  <path d="M 60 46 C 45 20, 75 20, 60 46 Z" fill="#2563eb" />
  <path d="M 74 60 C 100 45, 100 75, 74 60 Z" fill="#2563eb" />
  <path d="M 60 74 C 75 100, 45 100, 60 74 Z" fill="#2563eb" />
  <path d="M 46 60 C 20 75, 20 45, 46 60 Z" fill="#2563eb" />
  <circle cx="85" cy="35" r="7" fill="#059669" />
  <circle cx="85" cy="85" r="7" fill="#059669" />
  <circle cx="35" cy="85" r="7" fill="#059669" />
  <circle cx="35" cy="35" r="7" fill="#059669" />
</svg>`,

    channelsAndPockets: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40" width="60mm" height="40mm">
  <!-- Тест канали широк 1.2мм и езерца со стеснување -->
  <path d="M 10 10 L 50 10 L 50 12 L 10 12 Z" fill="#2563eb" />
  <path d="M 10 18 C 10 14, 18 14, 18 18 C 18 20, 15 21, 15 24 C 15 27, 18 28, 18 32 C 18 36, 10 36, 10 32 C 10 28, 13 27, 13 24 C 13 21, 10 20, 10 18 Z" fill="#059669" />
  <path d="M 25 18 L 45 18 L 45 32 L 43 32 L 43 20 L 36 20 L 36 32 L 34 32 L 34 20 L 27 20 L 27 32 L 25 32 Z" fill="#dc2626" />
</svg>`
  },

  // Отворање на модалот за автоматско генерирање
  openModal: function(initialSvgText) {
    if (CNCApp.Machine && typeof CNCApp.Machine.isBusy === 'function' && CNCApp.Machine.isBusy()) {
      var msg = '⚠️ ПРЕДУПРЕДУВАЊЕ ЗА СТАБИЛНОСТ (Windows XP / Mach3):\n\nМашината активно извршува програма! Тешката растерска пресметка за SVG патека може привремено да го оптовари процесорот.\n\n';
      if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) {
        msg += 'Исто така, тековниот таб моментално работи и е заклучен (можете само да прегледувате или прво префрлете се во ➕ Нов таб).\n\n';
      }
      msg += 'Дали сте сигурни дека сакате да го отворите SVG генераторот сега?';
      if (!confirm(msg)) return;
    }

    const modal = document.getElementById('svgGeneratorModal');
    if (!modal) return;

    if (initialSvgText) {
      this.currentSvgString = initialSvgText;
    } else if (CNCApp.State.svgData) {
      this.currentSvgString = CNCApp.State.svgData;
    } else {
      this.currentSvgString = this.sampleSvgs.channelsAndPockets;
    }

    this.parseAndAnalyze(this.currentSvgString);
    this.updateModalUI();
    modal.style.display = 'flex';
  },

  closeModal: function() {
    const modal = document.getElementById('svgGeneratorModal');
    if (modal) modal.style.display = 'none';
  },

  // Конверзија на димензија од текст во милиметри (mm, cm, in, pt, px)
  parseDimensionToMm: function(dimStr, defaultDpi = 96) {
    if (!dimStr) return null;
    const s = String(dimStr).trim().toLowerCase();
    if (s.endsWith('mm')) return parseFloat(s);
    if (s.endsWith('cm')) return parseFloat(s) * 10;
    if (s.endsWith('in')) return parseFloat(s) * 25.4;
    if (s.endsWith('pt')) return parseFloat(s) * (25.4 / 72);
    if (s.endsWith('px')) return parseFloat(s) * (25.4 / defaultDpi);
    const n = parseFloat(s);
    return isNaN(n) ? null : n * (25.4 / defaultDpi);
  },

  // Парсирање на SVG во прегледни векторски форми со препознавање на CSS стилови и класи
  parseAndAnalyze: function(svgText) {
    this.currentSvgString = svgText;
    this.parsedShapes = [];
    this.detectedFillColors = [];
    this.detectedStrokeColors = [];
    this.colorMapping.clear();
    this.detectedPhysicalWidthMm = null;
    this.detectedPhysicalHeightMm = null;

    if (!svgText || !svgText.trim()) return;

    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    if (!svgEl) return;

    // 1. Екстракција на CSS класи од <style> ознаки (на пр. во CorelDRAW .fil1 {fill:#D2D4D5})
    const cssRules = {};
    const styleTags = doc.querySelectorAll('style');
    styleTags.forEach(st => {
      const txt = st.textContent || '';
      const regex = /\.([a-zA-Z0-9_-]+)\s*\{([^}]+)\}/g;
      let match;
      while ((match = regex.exec(txt)) !== null) {
        const clsName = match[1];
        const decls = match[2];
        cssRules[clsName] = cssRules[clsName] || {};
        decls.split(';').forEach(d => {
          const parts = d.split(':');
          if (parts.length === 2) {
            const k = parts[0].trim().toLowerCase();
            const v = parts[1].trim();
            cssRules[clsName][k] = v;
          }
        });
      }
    });

    // 2. Пресметка на физички димензии и viewBox
    const rawW = svgEl.getAttribute('width');
    const rawH = svgEl.getAttribute('height');
    const parsedW_mm = this.parseDimensionToMm(rawW);
    const parsedH_mm = this.parseDimensionToMm(rawH);

    let vb = svgEl.getAttribute('viewBox');
    let minX = 0, minY = 0, vbWidth = 100, vbHeight = 100;
    if (vb) {
      const parts = vb.trim().split(/[\s,]+/).map(parseFloat);
      if (parts.length === 4) {
        minX = parts[0];
        minY = parts[1];
        vbWidth = parts[2];
        vbHeight = parts[3];
      }
    } else if (parsedW_mm && parsedH_mm) {
      vbWidth = parsedW_mm;
      vbHeight = parsedH_mm;
    }

    this.svgBounds = { minX, minY, width: vbWidth, height: vbHeight };

    if (parsedW_mm && parsedW_mm > 0) {
      this.detectedPhysicalWidthMm = parseFloat(parsedW_mm.toFixed(3));
      this.detectedPhysicalHeightMm = parsedH_mm ? parseFloat(parsedH_mm.toFixed(3)) : parseFloat(((parsedW_mm * vbHeight) / vbWidth).toFixed(3));
    } else {
      this.detectedPhysicalWidthMm = Math.round(vbWidth);
      this.detectedPhysicalHeightMm = Math.round(vbHeight);
    }

    // 3. Пребарување на сите геометриски облици
    const selectors = ['path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse'];
    const nodes = svgEl.querySelectorAll(selectors.join(','));

    const fillSet = new Set();
    const strokeSet = new Set();

    nodes.forEach((node, nodeIdx) => {
      // Идентификувај стил според атрибути, CSS класа или inline style
      let fillVal = node.getAttribute('fill');
      let strokeVal = node.getAttribute('stroke');

      const classAttr = node.getAttribute('class') || '';
      const classes = classAttr.split(/\s+/).filter(Boolean);
      for (let cls of classes) {
        if (cssRules[cls]) {
          if (!fillVal && cssRules[cls].fill) fillVal = cssRules[cls].fill;
          if (!strokeVal && cssRules[cls].stroke) strokeVal = cssRules[cls].stroke;
        }
      }

      if (node.style) {
        if (!fillVal && node.style.fill) fillVal = node.style.fill;
        if (!strokeVal && node.style.stroke) strokeVal = node.style.stroke;
      }

      // Нормализација
      const isFillNone = !fillVal || fillVal === 'none' || fillVal === 'transparent';
      const isStrokeNone = !strokeVal || strokeVal === 'none' || strokeVal === 'transparent';

      const normFill = isFillNone ? null : this.normalizeColorToHex(fillVal);
      const normStroke = isStrokeNone ? null : this.normalizeColorToHex(strokeVal);

      if (normFill) fillSet.add(normFill);
      if (normStroke) strokeSet.add(normStroke);

      const dStrings = this.convertNodeToPathStrings(node);
      dStrings.forEach(d => {
        if (d && d.trim().length > 1) {
          this.parsedShapes.push({
            d: d.trim(),
            fillColor: normFill,
            strokeColor: normStroke,
            nodeType: node.tagName.toLowerCase(),
            elementIndex: nodeIdx
          });
        }
      });
    });

    this.detectedFillColors = Array.from(fillSet);
    this.detectedStrokeColors = Array.from(strokeSet);

    // Автоматско мапирање на секоја откриена боја на полнење со најсоодветен диспензер
    this.detectedFillColors.forEach(hex => {
      // Ако е чиста бела боја (#ffffff) и е единечен правоаголник/позадина, стави на Ignore (0)
      if (hex === '#ffffff') {
        this.colorMapping.set(hex, 0); // 0 = Ignore
      } else {
        const matchedDisp = this.findClosestDispenser(hex);
        this.colorMapping.set(hex, matchedDisp.id);
      }
    });

    // Доколку нема бои за полнење, мапирај ги боите на линии
    if (this.detectedFillColors.length === 0) {
      this.detectedStrokeColors.forEach(hex => {
        const matchedDisp = this.findClosestDispenser(hex);
        this.colorMapping.set(hex, matchedDisp.id);
      });
    }
  },

  // Нормализација на боја во чист #rrggbb формат
  normalizeColorToHex: function(colorStr) {
    if (!colorStr) return null;
    const c = colorStr.trim().toLowerCase();
    if (c === 'none' || c === 'transparent') return null;

    if (c.startsWith('#')) {
      if (c.length === 4) {
        return '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
      }
      return c.substring(0, 7);
    }

    try {
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.fillStyle = c;
      return ctx.fillStyle;
    } catch (e) {
      return null;
    }
  },

  // Наоѓање најблизок диспензер според боја
  findClosestDispenser: function(hexColor) {
    const dispensers = CNCApp.State.machine.dispensers || [];
    if (dispensers.length === 0) return { id: 1, name: 'Боја 1' };

    const rgb1 = this.hexToRgb(hexColor);
    let bestDist = Infinity;
    let bestDisp = dispensers[0];

    dispensers.forEach(d => {
      const rgb2 = this.hexToRgb(d.color);
      const dist = Math.hypot(rgb1.r - rgb2.r, rgb1.g - rgb2.g, rgb1.b - rgb2.b);
      if (dist < bestDist) {
        bestDist = dist;
        bestDisp = d;
      }
    });

    return bestDisp;
  },

  hexToRgb: function(hex) {
    let clean = (hex || '#000000').replace('#', '');
    if (clean.length === 3) {
      clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
    }
    const num = parseInt(clean, 16);
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  },

  // Претворање на кој било SVG облик во 'd' за path
  convertNodeToPathStrings: function(node) {
    const tag = node.tagName.toLowerCase();

    if (tag === 'path') {
      const d = (node.getAttribute('d') || '').trim();
      return d ? [d] : [];
    }

    if (tag === 'line') {
      const x1 = node.getAttribute('x1') || 0;
      const y1 = node.getAttribute('y1') || 0;
      const x2 = node.getAttribute('x2') || 0;
      const y2 = node.getAttribute('y2') || 0;
      return [`M ${x1} ${y1} L ${x2} ${y2}`];
    }

    if (tag === 'polyline' || tag === 'polygon') {
      const rawPoints = (node.getAttribute('points') || '').trim();
      const coords = rawPoints.split(/[\s,]+/).map(parseFloat).filter(n => !isNaN(n));
      if (coords.length < 4) return [];

      let d = `M ${coords[0]} ${coords[1]}`;
      for (let i = 2; i < coords.length; i += 2) {
        d += ` L ${coords[i]} ${coords[i + 1]}`;
      }
      if (tag === 'polygon') d += ' Z';
      return [d];
    }

    if (tag === 'rect') {
      const x = parseFloat(node.getAttribute('x') || 0);
      const y = parseFloat(node.getAttribute('y') || 0);
      const w = parseFloat(node.getAttribute('width') || 0);
      const h = parseFloat(node.getAttribute('height') || 0);
      return [`M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`];
    }

    if (tag === 'circle') {
      const cx = parseFloat(node.getAttribute('cx') || 0);
      const cy = parseFloat(node.getAttribute('cy') || 0);
      const r = parseFloat(node.getAttribute('r') || 0);
      if (r <= 0) return [];
      return [`M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy}`];
    }

    if (tag === 'ellipse') {
      const cx = parseFloat(node.getAttribute('cx') || 0);
      const cy = parseFloat(node.getAttribute('cy') || 0);
      const rx = parseFloat(node.getAttribute('rx') || 0);
      const ry = parseFloat(node.getAttribute('ry') || 0);
      if (rx <= 0 || ry <= 0) return [];
      return [`M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy}`];
    }

    return [];
  },

  // Ажурирање на корисничкиот интерфејс во модалот
  updateModalUI: function() {
    const previewBox = document.getElementById('svgGenPreviewSvg');
    const colorMappingList = document.getElementById('svgGenColorList');
    const statsLabel = document.getElementById('svgGenStats');
    const targetWidthInp = document.getElementById('svgGenTargetWidth');

    if (previewBox) {
      previewBox.innerHTML = this.currentSvgString || '<div style="color:#94a3b8;padding:20px;">Нема вчитано SVG</div>';
    }

    // Автоматско пополнување на физичката ширина од SVG (на пример 59.96mm)
    if (targetWidthInp) {
      if (this.detectedPhysicalWidthMm && this.detectedPhysicalWidthMm > 0) {
        targetWidthInp.value = this.detectedPhysicalWidthMm;
      } else {
        const detectedW = this.svgBounds ? Math.round(this.svgBounds.width) : 50;
        targetWidthInp.value = Math.min(Math.max(detectedW, 20), 150);
      }
    }

    const fillsCount = this.detectedFillColors.length;
    const strokesCount = this.detectedStrokeColors.length;

    if (statsLabel) {
      let dimText = this.detectedPhysicalWidthMm ? `${this.detectedPhysicalWidthMm} × ${this.detectedPhysicalHeightMm} mm` : `${Math.round(this.svgBounds.width)} × ${Math.round(this.svgBounds.height)} pt`;
      statsLabel.innerText = `Димензии: ${dimText} | Полиња за полнење: ${fillsCount} | Линии: ${strokesCount}`;
    }

    // Список на бои со селектор за диспензер
    if (colorMappingList) {
      colorMappingList.innerHTML = '';
      const colorsToShow = fillsCount > 0 ? this.detectedFillColors : this.detectedStrokeColors;

      if (colorsToShow.length === 0) {
        colorMappingList.innerHTML = '<span style="color:#64748b;font-size:11px;">Не се детектирани бои. Ќе се користи Боја 1.</span>';
      } else {
        const dispensers = CNCApp.State.machine.dispensers || [];
        colorsToShow.forEach(hex => {
          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.alignItems = 'center';
          row.style.gap = '8px';
          row.style.marginBottom = '5px';
          row.style.padding = '4px 6px';
          row.style.background = '#ffffff';
          row.style.borderRadius = '4px';
          row.style.border = '1px solid #e2e8f0';

          const currentDispId = this.colorMapping.get(hex) ?? 1;

          let dispOptions = `<option value="0" ${currentDispId === 0 ? 'selected' : ''}>🚫 Игнорирај (Не пополнувај)</option>`;
          dispOptions += dispensers.map(d => 
            `<option value="${d.id}" ${d.id === currentDispId ? 'selected' : ''}>${d.name} (${d.color})</option>`
          ).join('');

          row.innerHTML = `
            <span style="display:inline-block;width:18px;height:18px;border-radius:4px;background:${hex};border:1px solid #94a3b8;box-shadow:0 1px 2px rgba(0,0,0,0.15);"></span>
            <span style="font-family:monospace;font-size:11px;min-width:65px;font-weight:600;color:#1e293b;">${hex}</span>
            <span style="font-size:11px;color:#64748b;">➔ Диспензер:</span>
            <select class="inp inp-sm" style="flex:1;">
              ${dispOptions}
            </select>
          `;

          const sel = row.querySelector('select');
          sel.onchange = (e) => {
            this.colorMapping.set(hex, parseInt(e.target.value));
          };

          colorMappingList.appendChild(row);
        });
      }
    }
  },

  // =========================================================================
  // ЕВКЛИДОВА ТРАНСФОРМАЦИЈА НА РАСТОЈАНИЕ (2D EUCLIDEAN DISTANCE TRANSFORM)
  // Прецизен Meijster алгоритам со O(W*H) линеарна сложеност за наоѓање на клиренс
  // =========================================================================
  computeEDT: function(binaryGrid, w, h) {
    const inf = 1e9;
    const d1 = new Float32Array(w * h);

    // Фаза 1: 1D по колони (од горе надолу и од долу нагоре)
    for (let x = 0; x < w; x++) {
      let dist = inf;
      for (let y = 0; y < h; y++) {
        dist = binaryGrid[y * w + x] === 0 ? 0 : dist + 1;
        d1[y * w + x] = dist;
      }
      dist = inf;
      for (let y = h - 1; y >= 0; y--) {
        dist = binaryGrid[y * w + x] === 0 ? 0 : dist + 1;
        if (dist < d1[y * w + x]) d1[y * w + x] = dist;
      }
    }

    // Фаза 2: Хоризонтална параболична обвивка
    const dt = new Float32Array(w * h);
    const s = new Float32Array(w);
    const t = new Int32Array(w);

    for (let y = 0; y < h; y++) {
      const rowOffset = y * w;
      let q = 0;
      s[0] = -inf;
      t[0] = 0;

      for (let u = 1; u < w; u++) {
        const f_u = d1[rowOffset + u] * d1[rowOffset + u];
        while (q >= 0) {
          const t_q = t[q];
          const f_t = d1[rowOffset + t_q] * d1[rowOffset + t_q];
          const sep = (f_u - f_t + u * u - t_q * t_q) / (2.0 * (u - t_q));
          if (sep <= s[q]) {
            q--;
          } else {
            q++;
            t[q] = u;
            s[q] = sep;
            break;
          }
        }
        if (q < 0) {
          q = 0;
          t[0] = u;
          s[0] = -inf;
        }
      }

      for (let u = w - 1; u >= 0; u--) {
        while (q > 0 && s[q] > u) q--;
        const t_q = t[q];
        const d1Val = d1[rowOffset + t_q];
        dt[rowOffset + u] = Math.sqrt(d1Val * d1Val + (u - t_q) * (u - t_q));
      }
    }

    return dt;
  },

  // =========================================================================
  // АВТОМАТСКИ ТЕЖИШТА И КАНАЛИ (POLE OF INACCESSIBILITY / MEDIAL AXIS SAMPLER)
  // Наоѓа локални максимуми на езерца и сртови на канали, подалеку од ѕидовите
  // =========================================================================
  samplePocketMedialAxis: function(pathsForColor, options) {
    const {
      targetWidthMm = 60,
      targetHeightMm = 40,
      stepMm = 2.0,
      minClearanceMm = 0.18,
      tipMarginMm = 0.8,
      invertY = true,
      offsetX = 0,
      offsetY = 0,
      canvasResolution = 20, // 20 пиксели по mm = резолуција од 0.05 mm
      enableRdp = true,
      rdpToleranceMm = 0.08,
      acuteTipDwellMs = 30
    } = options;

    const bounds = this.svgBounds;
    const canvasW = Math.max(10, Math.ceil(targetWidthMm * canvasResolution));
    const canvasH = Math.max(10, Math.ceil(targetHeightMm * canvasResolution));

    // Создади офскрин канвас за брза расеризација на векторските форми од таа боја
    const offCanvas = document.createElement('canvas');
    offCanvas.width = canvasW;
    offCanvas.height = canvasH;
    const ctx = offCanvas.getContext('2d');
    if (!ctx) return [];

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Скалирање од SVG viewBox кон физичките пиксели на офскрин канвасот
    ctx.save();
    const scaleX = canvasW / bounds.width;
    const scaleY = canvasH / bounds.height;
    ctx.scale(scaleX, scaleY);
    ctx.translate(-bounds.minX, -bounds.minY);

    ctx.fillStyle = '#000000';
    for (let pObj of pathsForColor) {
      try {
        const p2d = new Path2D(pObj.d);
        ctx.fill(p2d, 'evenodd');
      } catch (e) {
        // Доколку некој прелистувач не поддржува одреден path2d
      }
    }
    ctx.restore();

    // Екстракција на бинарна маска (1 = внатре во полето за полнење, 0 = надвор)
    const imgData = ctx.getImageData(0, 0, canvasW, canvasH);
    const pixels = imgData.data;
    const binaryGrid = new Uint8Array(canvasW * canvasH);

    for (let i = 0; i < pixels.length; i += 4) {
      // Црните пиксели се внатрешност на полето
      if (pixels[i] < 128 && pixels[i + 3] > 128) {
        binaryGrid[i / 4] = 1;
      }
    }

    // 1. Сегментација на површината во посебни физички езерца (Connected Components Islanding)
    const islandGrid = new Int32Array(canvasW * canvasH);
    let nextIslandId = 1;
    const islandMeta = new Map();

    const dx8 = [-1, 0, 1, -1, 1, -1, 0, 1];
    const dy8 = [-1, -1, -1, 0, 0, 1, 1, 1];

    for (let y = 0; y < canvasH; y++) {
      const row = y * canvasW;
      for (let x = 0; x < canvasW; x++) {
        const idx = row + x;
        if (binaryGrid[idx] === 1 && islandGrid[idx] === 0) {
          const currentId = nextIslandId++;
          let count = 0;
          let minX = x, maxX = x, minY = y, maxY = y;

          const queue = [idx];
          islandGrid[idx] = currentId;
          let qHead = 0;

          while (qHead < queue.length) {
            const curr = queue[qHead++];
            count++;
            const cx = curr % canvasW;
            const cy = Math.floor(curr / canvasW);

            if (cx < minX) minX = cx;
            if (cx > maxX) maxX = cx;
            if (cy < minY) minY = cy;
            if (cy > maxY) maxY = cy;

            for (let k = 0; k < 8; k++) {
              const nx = cx + dx8[k];
              const ny = cy + dy8[k];
              if (nx >= 0 && nx < canvasW && ny >= 0 && ny < canvasH) {
                const nIdx = ny * canvasW + nx;
                if (binaryGrid[nIdx] === 1 && islandGrid[nIdx] === 0) {
                  islandGrid[nIdx] = currentId;
                  queue.push(nIdx);
                }
              }
            }
          }

          islandMeta.set(currentId, {
            id: currentId,
            minX: minX,
            maxX: maxX,
            minY: minY,
            maxY: maxY,
            pixelCount: count,
            centerX: (minX + maxX) / 2,
            centerY: (minY + maxY) / 2
          });
        }
      }
    }

    // Пресметај го точното растојание до најблискиот раб за секој пиксел
    const edt = this.computeEDT(binaryGrid, canvasW, canvasH);

    // За секој остров, го наоѓаме најдлабокиот пиксел (Pole of Inaccessibility / локален максимум на клиренс)
    for (let y = 0; y < canvasH; y++) {
      const row = y * canvasW;
      for (let x = 0; x < canvasW; x++) {
        const iId = islandGrid[row + x];
        if (iId > 0) {
          const d = edt[row + x];
          const meta = islandMeta.get(iId);
          if (meta && (!meta.peakD || d > meta.peakD)) {
            meta.peakD = d;
            meta.peakX = x;
            meta.peakY = y;
          }
        }
      }
    }

    // Параметри за филтрирање
    const minClearancePx = minClearanceMm * canvasResolution;
    const tipMarginPx = (tipMarginMm || 0.8) * canvasResolution;
    const probeR = Math.max(3, Math.round(1.2 * canvasResolution)); // 24 px при 20 px/mm (~1.2mm)
    const probeRSq = probeR * probeR;

    const candidates = [];

    // Преглед на пикселите: екстракција на сртови (Medial Ridge) и пресметка на казна за слепи завршетоци (Tips)
    for (let y = 2; y < canvasH - 2; y++) {
      const row = y * canvasW;
      for (let x = 2; x < canvasW - 2; x++) {
        const d = edt[row + x];
        if (d < minClearancePx) continue;

        const iId = islandGrid[row + x] || 1;
        const iMeta = islandMeta.get(iId);

        // 1. Проверка дали пикселот лежи на сртот на каналот (Ridge peak)
        const isRidge = (
          (d >= edt[row + x - 1] && d >= edt[row + x + 1]) ||
          (d >= edt[(y - 1) * canvasW + x] && d >= edt[(y + 1) * canvasW + x]) ||
          (d >= edt[(y - 1) * canvasW + x - 1] && d >= edt[(y + 1) * canvasW + x + 1]) ||
          (d >= edt[(y - 1) * canvasW + x + 1] && d >= edt[(y + 1) * canvasW + x - 1])
        );

        // Дај предност на пикселите што се на самиот срт на каналот
        if (!isRidge && d < minClearancePx * 1.4) continue;

        // 2. Локален тест за слеп завршеток (Tip / Dead-End probe)
        let sumDx = 0, sumDy = 0, count = 0;
        const yStart = Math.max(0, y - probeR);
        const yEnd = Math.min(canvasH - 1, y + probeR);
        for (let py = yStart; py <= yEnd; py++) {
          const dy = py - y;
          const maxDx = Math.floor(Math.sqrt(probeRSq - dy * dy));
          const pRow = py * canvasW;
          const xStart = Math.max(0, x - maxDx);
          const xEnd = Math.min(canvasW - 1, x + maxDx);
          for (let px = xStart; px <= xEnd; px++) {
            if (binaryGrid[pRow + px] === 1) {
              sumDx += (px - x);
              sumDy += dy;
              count++;
            }
          }
        }

        const meanDx = count > 0 ? (sumDx / count) : 0;
        const meanDy = count > 0 ? (sumDy / count) : 0;
        const offsetDist = Math.hypot(meanDx, meanDy);

        // Не применувај казна за tipMargin врз мали езерца или врз остри шпицови/краци (каде што формата се стеснува во остар агол)
        const isSmallIsland = (iMeta && iMeta.pixelCount < 80);
        const isNarrowTip = (d < 0.7 * canvasResolution && offsetDist > probeR * 0.3);
        if (!isSmallIsland && !isNarrowTip && offsetDist > probeR * 0.35 && d < tipMarginPx) {
          continue;
        }

        // Приоритетен скор: висок скор за центрирани точки во внатрешноста на каналот
        const tipPenalty = (!isSmallIsland && !isNarrowTip) ? (offsetDist / probeR) * (canvasResolution * 0.5) : 0;
        const score = d - tipPenalty + (isRidge ? 2.5 : 0.0);

        candidates.push({ x, y, d, score, islandId: iId });
      }
    }

    // Сортирај ги кандидатите според највисок приоритетен скор (средина на канал наместо врв)
    candidates.sort((a, b) => b.score - a.score);

    // Просторно селектирање (Poisson-Disk) со задолжително зачувување на секое мало езерце
    const stepPx = Math.max(1, stepMm * canvasResolution);
    const gridCell = stepPx;
    const gridW = Math.ceil(canvasW / gridCell);
    const gridH = Math.ceil(canvasH / gridCell);
    const spatialGrid = new Map();

    const selectedPoints = [];

    // 1. Прво: Секое валидно езерце ГАРАНТИРАНО го добива својот централен врв (Pole of Inaccessibility)
    islandMeta.forEach(meta => {
      if (meta.peakD >= minClearancePx) {
        selectedPoints.push({
          x: meta.peakX,
          y: meta.peakY,
          d: meta.peakD,
          islandId: meta.id,
          islandPixelCount: meta.pixelCount,
          isPeak: true
        });
        const gx = Math.floor(meta.peakX / gridCell);
        const gy = Math.floor(meta.peakY / gridCell);
        const key = gy * gridW + gx;
        if (!spatialGrid.has(key)) spatialGrid.set(key, []);
        spatialGrid.get(key).push({ x: meta.peakX, y: meta.peakY, islandId: meta.id });
      }
    });

    // 2. Второ: Дополни со дополнителни капки по сртовите за поголеми канали
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const gx = Math.floor(c.x / gridCell);
      const gy = Math.floor(c.y / gridCell);

      let tooClose = false;
      for (let dx = -1; dx <= 1 && !tooClose; dx++) {
        for (let dy = -1; dy <= 1 && !tooClose; dy++) {
          const key = (gy + dy) * gridW + (gx + dx);
          const list = spatialGrid.get(key);
          if (list) {
            for (let j = 0; j < list.length; j++) {
              const p = list[j];
              // ВАЖНО: Супресијата по чекор важи САМО за точки во истото езерце!
              // Точка од едно езерце НИКОГАШ не смее да потисне соседно мало езерце!
              if (p.islandId === c.islandId) {
                const distSq = (c.x - p.x) * (c.x - p.x) + (c.y - p.y) * (c.y - p.y);
                if (distSq < stepPx * stepPx) {
                  tooClose = true;
                  break;
                }
              }
            }
          }
        }
      }

      if (!tooClose) {
        selectedPoints.push({
          x: c.x,
          y: c.y,
          d: c.d,
          islandId: c.islandId,
          islandPixelCount: islandMeta.get(c.islandId)?.pixelCount || 40
        });
        const key = gy * gridW + gx;
        if (!spatialGrid.has(key)) spatialGrid.set(key, []);
        spatialGrid.get(key).push({ x: c.x, y: c.y, islandId: c.islandId });
      }
    }

    if (selectedPoints.length === 0) return [];

    // 3. Вороној-Ллојд Релаксација кон тежиште на сегментот (Centroidal Voronoi Relaxation)
    const relaxRadius = Math.round(stepPx * 0.95);
    const relaxRadiusSq = relaxRadius * relaxRadius;

    for (let iter = 0; iter < 2; iter++) {
      for (let i = 0; i < selectedPoints.length; i++) {
        const pt = selectedPoints[i];
        if (pt.isPeak) continue; // Главниот врв на езерцето останува строго на најдлабокиот пиксел

        let sumX = 0, sumY = 0, cnt = 0;
        const xMin = Math.max(0, pt.x - relaxRadius);
        const xMax = Math.min(canvasW - 1, pt.x + relaxRadius);
        const yMin = Math.max(0, pt.y - relaxRadius);
        const yMax = Math.min(canvasH - 1, pt.y + relaxRadius);

        for (let py = yMin; py <= yMax; py++) {
          const rowP = py * canvasW;
          const dy = py - pt.y;
          for (let px = xMin; px <= xMax; px++) {
            if (binaryGrid[rowP + px] !== 1) continue;
            if (islandGrid[rowP + px] !== pt.islandId) continue; // Релаксација исклучиво во рамките на истото езерце
            const dx = px - pt.x;
            const dSq = dx * dx + dy * dy;
            if (dSq > relaxRadiusSq) continue;

            let closestDistSq = dSq;
            let isClosest = true;
            for (let j = 0; j < selectedPoints.length; j++) {
              if (i === j) continue;
              const other = selectedPoints[j];
              if (other.islandId !== pt.islandId) continue;
              const odx = px - other.x;
              const ody = py - other.y;
              const otherDistSq = odx * odx + ody * ody;
              if (otherDistSq < closestDistSq) {
                isClosest = false;
                break;
              }
            }

            if (isClosest) {
              sumX += px;
              sumY += py;
              cnt++;
            }
          }
        }

        if (cnt > 5) {
          const targetCx = Math.round(sumX / cnt);
          const targetCy = Math.round(sumY / cnt);

          let bestX = targetCx;
          let bestY = targetCy;
          let bestD = edt[targetCy * canvasW + targetCx] || 0;

          for (let sy = Math.max(1, targetCy - 6); sy <= Math.min(canvasH - 2, targetCy + 6); sy++) {
            const sRow = sy * canvasW;
            for (let sx = Math.max(1, targetCx - 6); sx <= Math.min(canvasW - 2, targetCx + 6); sx++) {
              if (binaryGrid[sRow + sx] === 1 && islandGrid[sRow + sx] === pt.islandId) {
                const sD = edt[sRow + sx];
                if (sD > bestD) {
                  bestD = sD;
                  bestX = sx;
                  bestY = sy;
                }
              }
            }
          }

          // Не дозволувај точката да се приближи кон ѕид (да се смали нејзиниот клиренс)
          if (bestD >= minClearancePx && bestD >= pt.d * 0.85) {
            pt.x = bestX;
            pt.y = bestY;
            pt.d = bestD;
          }
        }
      }
    }

    // Претвори пиксели во реални CNC милиметри
    const mmPoints = selectedPoints.map(sp => {
      const normX = sp.x / canvasResolution;
      let normY = sp.y / canvasResolution;
      if (invertY) {
        normY = targetHeightMm - normY;
      }
      return {
        x: parseFloat((normX + offsetX).toFixed(3)),
        y: parseFloat((normY + offsetY).toFixed(3)),
        clearance: parseFloat((sp.d / canvasResolution).toFixed(3)),
        islandId: sp.islandId || 1,
        islandPixelCount: sp.islandPixelCount || 40,
        isPeak: sp.isPeak,
        px: sp.x,
        py: sp.y
      };
    });

    // Оптимизација на патеката по езерца (Pocket Islanding & Sweep):
    // 1. Групирање на точките по езерце (секое езерце се завршува 100% без прекин)
    const pointsByIsland = new Map();
    for (let pt of mmPoints) {
      const iId = pt.islandId || 1;
      if (!pointsByIsland.has(iId)) {
        pointsByIsland.set(iId, []);
      }
      pointsByIsland.get(iId).push(pt);
    }

    const islandList = [];
    pointsByIsland.forEach((pts, iId) => {
      let sumX = 0, sumY = 0;
      pts.forEach(p => { sumX += p.x; sumY += p.y; });
      islandList.push({
        id: iId,
        points: pts,
        avgX: sumX / pts.length,
        avgY: sumY / pts.length
      });
    });

    // 4. Детекција на непрекината линија (Raymarching проверка низ бинарната маска)
    // Гарантира дека линијата лежи 100% во обоениот дел од истото езерце и не го сече белиот ѕид
    function isLineSegmentClear(x1, y1, x2, y2, targetIslandId, minWallDist = 1.0) {
      const dist = Math.hypot(x2 - x1, y2 - y1);
      const steps = Math.max(4, Math.ceil(dist * 1.5));
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        const cx = Math.round(x1 + t * (x2 - x1));
        const cy = Math.round(y1 + t * (y2 - y1));
        if (cx < 0 || cx >= canvasW || cy < 0 || cy >= canvasH) return false;
        const idx = cy * canvasW + cx;
        // Мора да биде во внатрешноста на обоената површина (1) и да нема премин преку бел ѕид (0)
        if (binaryGrid[idx] !== 1) return false;
        if (targetIslandId && islandGrid && islandGrid[idx] !== targetIslandId) return false;
        if (minWallDist > 0 && edt[idx] < minWallDist) return false;
      }
      return true;
    }

    // Помошна функција за наоѓање аголна точка (Corner Waypoint) на колено/свиок:
    // Кога линијата меѓу pA и pB би пресекла внатрешен агол (Image 1), наоѓа медијална точка C на сртот
    function findCornerWaypoint(pA, pB, islandId) {
      let bestCand = null;
      let bestCost = Infinity;

      const minX = Math.min(pA.px, pB.px) - 30;
      const maxX = Math.max(pA.px, pB.px) + 30;
      const minY = Math.min(pA.py, pB.py) - 30;
      const maxY = Math.max(pA.py, pB.py) + 30;

      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        if (c.islandId !== islandId) continue;
        if (c.d < minClearancePx) continue;
        if (c.x < minX || c.x > maxX || c.y < minY || c.y > maxY) continue;

        // Мора да има непрекината видливост од pA до C и од C до pB низ каналот
        if (!isLineSegmentClear(pA.px, pA.py, c.x, c.y, islandId, 1.0)) continue;
        if (!isLineSegmentClear(c.x, c.y, pB.px, pB.py, islandId, 1.0)) continue;

        const d1 = Math.hypot(c.x - pA.px, c.y - pA.py);
        const d2 = Math.hypot(pB.px - c.x, pB.py - c.y);
        const detour = d1 + d2;
        const cost = detour - (c.d * 0.4);

        if (cost < bestCost) {
          bestCost = cost;
          bestCand = c;
        }
      }

      if (!bestCand) return null;

      const normX = bestCand.x / canvasResolution;
      let normY = bestCand.y / canvasResolution;
      if (invertY) {
        normY = targetHeightMm - normY;
      }

      return {
        x: parseFloat((normX + offsetX).toFixed(3)),
        y: parseFloat((normY + offsetY).toFixed(3)),
        clearance: parseFloat((bestCand.d / canvasResolution).toFixed(3)),
        islandId: islandId,
        islandPixelCount: pA.islandPixelCount || 40,
        isCornerWaypoint: true,
        islandIndex: pA.islandIndex,
        px: bestCand.x,
        py: bestCand.y
      };
    }

    // Редослед на езерца: подредување со приоритет по X оската (лево кон десно) за мирно и прегледно движење
    const rawOrdered = [];
    let currentHeadX = 0;
    let currentHeadY = invertY ? targetHeightMm : 0;
    let islandOrderNum = 1;

    while (islandList.length > 0) {
      let bestIslandIdx = 0;
      let bestIslandCost = Infinity;

      for (let i = 0; i < islandList.length; i++) {
        const isl = islandList[i];
        let minEntryDist = Infinity;
        for (let p of isl.points) {
          const dx = p.x - currentHeadX;
          const dy = (p.y - currentHeadY) * 1.35; // Благо фаворизирање на X-движење пред нагло скокање горе-долу
          const cost = Math.hypot(dx, dy);
          if (cost < minEntryDist) minEntryDist = cost;
        }
        if (minEntryDist < bestIslandCost) {
          bestIslandCost = minEntryDist;
          bestIslandIdx = i;
        }
      }

      const activeIsland = islandList.splice(bestIslandIdx, 1)[0];
      const unvisitedPts = [...activeIsland.points];

      // Најди почетна точка во ова езерце најблиску до тековната глава
      unvisitedPts.sort((a, b) => {
        const da = Math.hypot(a.x - currentHeadX, a.y - currentHeadY);
        const db = Math.hypot(b.x - currentHeadX, b.y - currentHeadY);
        return da - db;
      });

      let currPt = unvisitedPts.shift();
      currPt.islandIndex = islandOrderNum;
      rawOrdered.push(currPt);
      currentHeadX = currPt.x;
      currentHeadY = currPt.y;

      // Сите преостанати точки во ова езерце се решаваат со Visibility-Aware Nearest Neighbor
      // ВАЖНО: Приоритет имаат точки со директна линија на видливост (Line-of-Sight) во каналот.
      // Ова спречува дијагонално прескокнување преку ѕид/шуплина кон спротивен крак (Image 2)!
      while (unvisitedPts.length > 0) {
        let bestIdx = -1;
        let bestDist = Infinity;

        // Прв премин: барај точка со чиста видливост низ каналот
        for (let j = 0; j < unvisitedPts.length; j++) {
          const cand = unvisitedPts[j];
          if (isLineSegmentClear(currPt.px, currPt.py, cand.px, cand.py, activeIsland.id, 0.8)) {
            const d = Math.hypot(currPt.x - cand.x, currPt.y - cand.y);
            if (d < bestDist) {
              bestDist = d;
              bestIdx = j;
            }
          }
        }

        // Втор премин: ако ниедна точка нема директна видливост (пр. зад свиок), земи најблиска
        if (bestIdx === -1) {
          bestDist = Infinity;
          for (let j = 0; j < unvisitedPts.length; j++) {
            const cand = unvisitedPts[j];
            const d = Math.hypot(currPt.x - cand.x, currPt.y - cand.y);
            if (d < bestDist) {
              bestDist = d;
              bestIdx = j;
            }
          }
        }

        currPt = unvisitedPts.splice(bestIdx, 1)[0];
        currPt.islandIndex = islandOrderNum;
        rawOrdered.push(currPt);
        currentHeadX = currPt.x;
        currentHeadY = currPt.y;
      }

      islandOrderNum++;
    }

    // Вметнување на аголни точки (Corner Waypoints) на сите свиоци/колена каде линијата би сечела раб (Image 1)
    const ordered = [];
    for (let i = 0; i < rawOrdered.length; i++) {
      ordered.push(rawOrdered[i]);
      if (i < rawOrdered.length - 1) {
        const p1 = rawOrdered[i];
        const p2 = rawOrdered[i + 1];
        if (p1.islandIndex === p2.islandIndex) {
          // Ако правиот сегмент меѓу p1 и p2 сече внатрешен раб на коленото, вметни медијална аголна точка
          if (!isLineSegmentClear(p1.px, p1.py, p2.px, p2.py, p1.islandId, 1.0)) {
            const cornerWp = findCornerWaypoint(p1, p2, p1.islandId);
            if (cornerWp) {
              ordered.push(cornerWp);
            }
          }
        }
      }
    }

    // Означување на поврзани континуирани сегменти (Непрекината линија)
    for (let i = 0; i < ordered.length - 1; i++) {
      const pCurr = ordered[i];
      const pNext = ordered[i + 1];

      if (pCurr.islandIndex === pNext.islandIndex) {
        const dMm = Math.hypot(pNext.x - pCurr.x, pNext.y - pCurr.y);
        if (dMm <= stepMm * 2.5 && isLineSegmentClear(pCurr.px, pCurr.py, pNext.px, pNext.py, pCurr.islandId, 0.8)) {
          pCurr.connectedNext = true;
          pNext.connectedPrev = true;
        }
      }
    }

    // 5. Полигонална Ramer-Douglas-Peucker (RDP) редукција за прави краци и темиња:
    // Ги препознава правилните прави сегменти (пр. краците на ѕвездата или прави линии)
    // и ги редуцира сите меѓуточки до 2 клучни темиња (почеток и шпиц/врв), доколку отклонот е < rdpToleranceMm (0.08mm)
    const simplified = [];

    if (!enableRdp) {
      simplified.push(...ordered);
    } else {
      let chainStart = 0;
      while (chainStart < ordered.length) {
        let chainEnd = chainStart;
        while (chainEnd < ordered.length - 1 && 
               ordered[chainEnd].connectedNext && 
               ordered[chainEnd + 1].islandIndex === ordered[chainEnd].islandIndex) {
          chainEnd++;
        }

        const chain = ordered.slice(chainStart, chainEnd + 1);
        if (chain.length <= 2) {
          chain.forEach(pt => simplified.push(pt));
        } else {
          function rdp(pts, eps) {
            if (pts.length <= 2) return pts;
            const pFirst = pts[0];
            const pLast = pts[pts.length - 1];
            const lineLen = Math.hypot(pLast.x - pFirst.x, pLast.y - pFirst.y);
            let dMax = 0;
            let idxMax = 0;

            for (let k = 1; k < pts.length - 1; k++) {
              const pt = pts[k];
              let d = 0;
              if (lineLen < 0.0001) {
                d = Math.hypot(pt.x - pFirst.x, pt.y - pFirst.y);
              } else {
                d = Math.abs((pLast.y - pFirst.y) * pt.x - (pLast.x - pFirst.x) * pt.y + pLast.x * pFirst.y - pLast.y * pFirst.x) / lineLen;
              }
              if (d > dMax) {
                dMax = d;
                idxMax = k;
              }
            }

            const hasCornerWp = pts.slice(1, pts.length - 1).some(p => p.isCornerWaypoint || p.isPeak);
            if (!hasCornerWp && dMax <= eps && isLineSegmentClear(pFirst.px, pFirst.py, pLast.px, pLast.py, pFirst.islandId, 1.0)) {
              pFirst.connectedNext = true;
              pLast.connectedPrev = true;
              return [pFirst, pLast];
            }

            if (idxMax === 0) return [pFirst, pLast];

            const leftPart = rdp(pts.slice(0, idxMax + 1), eps);
            const rightPart = rdp(pts.slice(idxMax), eps);
            return leftPart.slice(0, leftPart.length - 1).concat(rightPart);
          }

          const rdpSimplified = rdp(chain, rdpToleranceMm);

          for (let k = 0; k < rdpSimplified.length; k++) {
            if (k > 0) rdpSimplified[k].connectedPrev = true;
            if (k < rdpSimplified.length - 1) rdpSimplified[k].connectedNext = true;
            simplified.push(rdpSimplified[k]);
          }
        }
        chainStart = chainEnd + 1;
      }
    }

    // 6. Детекција на остри агли (Acute Corners / Tips < 73°):
    // За секоја точка во синџирот, го пресметува аголот меѓу векторот на влез и излез.
    // На остри шпицови каде дизната врти нагло (dot < -0.3), се бележи isAcuteCorner за да добие 30ms задршка со отворен вентил.
    // ВАЖНО: Точките ОСТАНУВААТ СТРОГО на пресметаната медијална оска со безбеден клиренс од ѕидот.
    // НИТУ ЕДНА ТОЧКА НЕ СЕ ПОМЕСТУВА КОН ЅИДОТ за да се избегне секаков ризик од судир!
    for (let i = 1; i < simplified.length - 1; i++) {
      const pPrev = simplified[i - 1];
      const pCurr = simplified[i];
      const pNext = simplified[i + 1];

      if (pCurr.connectedPrev && pCurr.connectedNext && pPrev.islandIndex === pCurr.islandIndex && pCurr.islandIndex === pNext.islandIndex) {
        const v1x = pCurr.x - pPrev.x;
        const v1y = pCurr.y - pPrev.y;
        const v2x = pNext.x - pCurr.x;
        const v2y = pNext.y - pCurr.y;
        const l1 = Math.hypot(v1x, v1y);
        const l2 = Math.hypot(v2x, v2y);

        if (l1 > 0.05 && l2 > 0.05) {
          const u1x = v1x / l1;
          const u1y = v1y / l1;
          const u2x = v2x / l2;
          const u2y = v2y / l2;
          const dot = u1x * u2x + u1y * u2y;

          // Ако dot < -0.3, аголот на завртување е > 107° (остар шпиц на кракот < 73°)
          if (dot < -0.3) {
            pCurr.isAcuteCorner = true;
          }
          if (l1 >= 4.0 || l2 >= 4.0) {
            pCurr.isLongStraightSegment = true;
          }
        }
      }
    }

    // 7. Пресметка на низок премин (In-Cavity Skim) меѓу точки во иста шуплина:
    // Дизната останува долу без Z-подигнување доколку движењето е во рамки на истото езерце
    // или ако директната линија помеѓу двете точки не пресекува надворешен ѕид
    for (let i = 0; i < simplified.length - 1; i++) {
      const pA = simplified[i];
      const pB = simplified[i + 1];
      const dist = Math.hypot(pB.x - pA.x, pB.y - pA.y);
      const samePocket = (pA.islandIndex === pB.islandIndex);
      const clearLine = isLineSegmentClear(pA.px, pA.py, pB.px, pB.py);
      pA.canInCavitySkimToNext = (samePocket && dist <= 5.0) || (clearLine && dist <= 15.0);
    }

    // 8. ЗАДОЛЖИТЕЛНА БЕЗБЕДНОСНА ГАРАНЦИЈА ЗА КЛИРЕНС (Strict Wall Clearance Safety):
    // Гарантира дека ниту една генерирана точка никогаш не го допира или надминува безбедносниот клиренс од ѕидот!
    for (let pt of simplified) {
      const d = edt[pt.py * canvasW + pt.px];
      if (d < minClearancePx) {
        let bestPx = pt.px, bestPy = pt.py, bestD = d;
        let found = false;
        for (let r = 1; r <= 15 && !found; r++) {
          for (let dy = -r; dy <= r && !found; dy++) {
            for (let dx = -r; dx <= r && !found; dx++) {
              const nx = pt.px + dx;
              const ny = pt.py + dy;
              if (nx >= 0 && nx < canvasW && ny >= 0 && ny < canvasH) {
                const nIdx = ny * canvasW + nx;
                if (binaryGrid[nIdx] === 1 && islandGrid[nIdx] === pt.islandId) {
                  const nd = edt[nIdx];
                  if (nd >= minClearancePx) {
                    bestPx = nx;
                    bestPy = ny;
                    bestD = nd;
                    found = true;
                  }
                }
              }
            }
          }
        }
        pt.px = bestPx;
        pt.py = bestPy;
        const normX = bestPx / canvasResolution;
        let normY = bestPy / canvasResolution;
        if (invertY) normY = targetHeightMm - normY;
        pt.x = parseFloat((normX + offsetX).toFixed(3));
        pt.y = parseFloat((normY + offsetY).toFixed(3));
        pt.clearance = parseFloat((bestD / canvasResolution).toFixed(3));
      }
    }

    return simplified;
  },

  // =========================================================================
  // ГЛАВНА ФУНКЦИЈА: ГЕНЕРИРАЊЕ НА ТОЧКИ СО ИЗБРАНИОТ РЕЖИМ
  // =========================================================================
  generatePoints: function(options) {
    const {
      mode = 'pockets',         // 'pockets' (тежишта и канали), 'lines' (контури), 'dots' (капки по раб)
      stepMm = 2.0,             // Чекор за точки (мм)
      targetWidthMm = 60,       // Физичка ширина во мм
      invertY = true,           // Инверзија на Y оска за CNC
      offsetX = 0,              // Офсет X (мм)
      offsetY = 0,              // Офсет Y (мм)
      speed = 650,              // Работна брзина на дозирање линија F mm/min (стандардно 650)
      travelNearSpeed = 1200,   // Брзина меѓу блиски езерца F mm/min (стандардно 1200)
      travelFarSpeed = 5000,    // Брзина долг премин / измена на алат F mm/min
      minClearanceMm = 0.18,    // Безбедно растојание од ѕид (мм)
      tipMarginMm = 0.8,        // Оддалеченост од слепи завршетоци / врвови (мм)
      dropTimeMs = 50,          // Време за капка (ms, стандардно 50)
      acuteTipDwellMs = 30,     // Време за задршка на остри шпицови/краци (ms, стандардно 30)
      enableRdp = true,         // Полигонална Ramer-Douglas-Peucker редукција за прави краци
      rdpToleranceMm = 0.08,    // Толеранција за права линија (мм)
      depthMm = 1.0,            // Длабочина на езерце/гравура во mm (стандардно 1.0)
      flowRateQ = 16.5,         // Проток / дебит на боја во mm3/s (калибрирано од реален пример: 16.5)
      useCapillary = true,      // Капиларно напојување на тесни канали
      groupByDispenser = true   // Групирање по боја
    } = options;

    if (!this.parsedShapes || this.parsedShapes.length === 0) {
      alert("⚠️ Нема детектирани векторски патеки во овој SVG фајл.");
      return [];
    }

    const bounds = this.svgBounds || { minX: 0, minY: 0, width: 100, height: 100 };
    const targetHeightMm = parseFloat(((targetWidthMm * bounds.height) / bounds.width).toFixed(3));

    // =========================================================================
    // РЕЖИМ 1: ТЕЖИШТА НА ПОЛИЊА И КАНАЛИ (MEDIAL AXIS POCKET SAMPLER) - ПРЕПОРАЧАН
    // =========================================================================
    if (mode === 'pockets') {
      const finalPoints = [];

      // Групирај ги формите според нивната боја на полнење (САМО облици со вистинска боја)
      const shapesByFill = new Map();
      this.parsedShapes.forEach(shape => {
        if (!shape.fillColor) return; // ИГНОРИРАЈ СЕ ШТО НЕМА ВИСТИНСКА БОЈА НА ПОЛНЕЊЕ!
        const fill = shape.fillColor;
        if (!shapesByFill.has(fill)) shapesByFill.set(fill, []);
        shapesByFill.get(fill).push(shape);
      });

      // Сортирај по доделен диспензер за минимални промени на алат
      const sortedFills = Array.from(shapesByFill.keys()).sort((a, b) => {
        const dispA = this.colorMapping.get(a) ?? 1;
        const dispB = this.colorMapping.get(b) ?? 1;
        return dispA - dispB;
      });

      sortedFills.forEach((fillHex, groupIdx) => {
        const dispId = this.colorMapping.get(fillHex) ?? 1;
        if (dispId <= 0) return; // Игнорирана боја

        const shapes = shapesByFill.get(fillHex);
        const sampledPoints = this.samplePocketMedialAxis(shapes, {
          targetWidthMm,
          targetHeightMm,
          stepMm,
          minClearanceMm,
          tipMarginMm,
          invertY,
          offsetX,
          offsetY,
          canvasResolution: 20,
          enableRdp,
          rdpToleranceMm,
          acuteTipDwellMs
        });

        sampledPoints.forEach((sp, pIdx) => {
          const ptObj = CNCApp.State.createPoint(sp.x, sp.y);
          ptObj.dispenser = dispId;
          ptObj.clearance = sp.clearance;
          
          // Група 1: само чист број на полето/островот, Група 2: празно според барањето
          ptObj.group1 = '' + (sp.islandIndex || (groupIdx + 1));
          ptObj.group2 = '';

          // Пневматика за континуирана линија наспроти единечна капка:
          const isConnPrev = !!sp.connectedPrev;
          const isConnNext = !!sp.connectedNext;

          // Волуметриско пресметување на капка за ова езерце / тесен канал:
          const islandAreaMm2 = (sp.islandPixelCount || 40) / 400; // 20px/mm -> 400 px^2/mm^2
          const islandVolMm3 = islandAreaMm2 * (depthMm || 1.0);
          const calcDwellMs = Math.round((islandVolMm3 / (flowRateQ || 16.5)) * 1000);
          const calculatedDropTime = Math.max(50, Math.min(150, Math.round(calcDwellMs / 10) * 10));

          // 1. Проверка за низок премин (In-Cavity Skim) кон следна точка без Z-кревање:
          const prevPtObj = finalPoints.length > 0 ? finalPoints[finalPoints.length - 1] : null;
          const canSkimToNext = (pIdx < sampledPoints.length - 1) && !!sp.canInCavitySkimToNext;
          const wasPrevSkimmedDown = prevPtObj && !prevPtObj.raise;

          if (isConnPrev && isConnNext) {
            // Средина на континуирана линија: дизната е веќе долу, вентилот веќе отворен
            ptObj.lower = false;
            ptObj.valveStart = false;
            // АКУТЕН ШПИЦ: 30ms задршка со отворен вентил за бојата да го исполни остриот врв (како точки 5, 7, 9, 11 на ѕвездата)
            if (sp.isAcuteCorner) {
              ptObj.time = acuteTipDwellMs || 30;
            } else {
              ptObj.time = '';
            }
            ptObj.valveStop = false;
            ptObj.raise = false;
            // Долг прав крак на полигон вози со висока континуирана брзина (до 1000)
            ptObj.speed = sp.isLongStraightSegment ? Math.max(speed, 1000) : speed;
          } else if (!isConnPrev && isConnNext) {
            // Почеток на континуирана линија:
            ptObj.lower = !wasPrevSkimmedDown;
            ptObj.valveStart = true;
            // 2. Капиларен бафер на почеток на линија (како точка 44):
            // ако линијата тргнува до тесен канал/капилар, испушта почетен бафер од 50ms пред движење
            ptObj.time = (sp.clearance <= 0.45 || (sp.islandPixelCount && sp.islandPixelCount < 120)) ? 50 : '';
            ptObj.valveStop = false;
            ptObj.raise = false;
            ptObj.speed = sp.isLongStraightSegment ? Math.max(speed, 1000) : speed;
          } else if (isConnPrev && !isConnNext) {
            // Крај на континуирана линија:
            ptObj.lower = false;
            ptObj.valveStart = false;
            // 3. Капиларен бафер на крај на линија (како точка 72):
            // 100ms пауза со отворен вентил пред подигнување за да се наполни слепиот капилар
            ptObj.time = (sp.clearance <= 0.50 || (sp.islandPixelCount && sp.islandPixelCount < 180)) ? 100 : '';
            ptObj.valveStop = true;
            ptObj.raise = !canSkimToNext;
            ptObj.speed = sp.isLongStraightSegment ? Math.max(speed, 1000) : speed;
          } else {
            // Единечна точка / капка (неповрзана со линија):
            ptObj.lower = !wasPrevSkimmedDown;
            ptObj.valveStart = true;

            // 4. Импулсна микро-капка за тесни грла (како точка 41):
            if (sp.clearance <= 0.28) {
              ptObj.time = ''; // Импулсна микро-капка преку латенција на вентил
            } else {
              ptObj.time = useCapillary ? calculatedDropTime : dropTimeMs;
            }

            ptObj.valveStop = true;
            ptObj.raise = !canSkimToNext;
          }

          // Динамичка работна брзина според ширината на каналот (Волуметриско правило F = 60 * Q / W)
          if (!ptObj.speed) {
            const channelWidthMm = Math.max(0.8, (sp.clearance || 0.8) * 2);
            const idealSpeed = Math.round((60 * (flowRateQ || 16.5)) / channelWidthMm);
            ptObj.speed = Math.max(550, Math.min(950, idealSpeed));
          }

          finalPoints.push(ptObj);
        });
      });

      if (finalPoints.length === 0) {
        alert("⚠️ Не беа пронајдени затворени полиња со доволна ширина за дозирање со овие параметри.");
        return [];
      }

      // Пресметка на динамички брзини (F) за секоја точка според правилата:
      // 1. Прва точка и измена на диспензер / алат: брз премин (travelFarSpeed, 5000)
      // 2. Движење во воздух со подигната дизна (prev.raise == true):
      //    - ако растојанието е поголемо (>10mm): travelFarSpeed (5000)
      //    - ако е пократко (<=10mm): travelNearSpeed (1200)
      // 3. Низок премин во празнина со затворен вентил (дизната е долу!): брз премин (1000-1200)
      // 4. Континуирано дозирање со спуштена дизна: се задржува пресметаната брзина на линија
      finalPoints.forEach((p, idx) => {
        if (idx === 0) {
          p.speed = travelFarSpeed;
          return;
        }
        const prev = finalPoints[idx - 1];
        const dist = Math.hypot(p.x - prev.x, p.y - prev.y);

        if (p.dispenser !== prev.dispenser) {
          p.speed = travelFarSpeed;
        } else if (prev.raise) {
          // Дизната беше подигната на претходната точка: ова е воздушен премин (Air travel / Rapid)
          p.speed = (dist > 10.0) ? travelFarSpeed : travelNearSpeed;
        } else if (prev.valveStop && p.valveStart) {
          // Низок премин во празнина со затворен вентил: брз лизгачки премин (1000-1200) без Z-кревање
          p.speed = Math.max(1000, travelNearSpeed);
        } else {
          // Дизната е спуштена: континуирано дозирање линија
          if (!p.speed) p.speed = speed;
        }
      });

      // Безбедност: последната точка секогаш ја подигнува дизната горе
      if (finalPoints.length > 0) {
        finalPoints[finalPoints.length - 1].raise = true;
      }

      return finalPoints;
    }

    // =========================================================================
    // РЕЖИМ 2 И 3: КОНТУРНИ ЛИНИИ ИЛИ КАПКИ ПО РАБОВИ
    // =========================================================================
    let tempSvg = document.getElementById('__temp_svg_sampler__');
    if (!tempSvg) {
      tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      tempSvg.id = '__temp_svg_sampler__';
      tempSvg.style.position = 'absolute';
      tempSvg.style.width = '0';
      tempSvg.style.height = '0';
      tempSvg.style.visibility = 'hidden';
      document.body.appendChild(tempSvg);
    }
    tempSvg.innerHTML = '';

    let scaleRatio = targetWidthMm / bounds.width;
    const rawSegments = [];

    this.parsedShapes.forEach((item, elemIdx) => {
      const activeColor = item.fillColor || item.strokeColor || '#2563eb';
      const dispId = this.colorMapping.get(activeColor) ?? 1;
      if (dispId <= 0) return;

      const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathEl.setAttribute('d', item.d);
      tempSvg.appendChild(pathEl);

      try {
        const totalLen = pathEl.getTotalLength();
        if (totalLen <= 0.001) return;

        const stepInSvg = Math.max(0.2, stepMm / scaleRatio);
        const numSteps = Math.max(1, Math.round(totalLen / stepInSvg));
        const actualStep = totalLen / numSteps;

        const pts = [];
        for (let i = 0; i <= numSteps; i++) {
          const dist = i === numSteps ? totalLen : i * actualStep;
          const pt = pathEl.getPointAtLength(dist);
          pts.push({ x: pt.x, y: pt.y });
        }

        if (pts.length > 0) {
          rawSegments.push({
            dispenser: dispId,
            points: pts,
            originalColor: activeColor,
            segmentId: elemIdx + 1
          });
        }
      } catch (err) {
        // грешка при семплирање на контура
      } finally {
        tempSvg.removeChild(pathEl);
      }
    });

    if (rawSegments.length === 0) {
      alert("⚠️ Не можеше да се извлечат точки од контурите на овој SVG.");
      return [];
    }

    let orderedSegments = rawSegments;
    if (groupByDispenser) {
      orderedSegments = [...rawSegments].sort((a, b) => a.dispenser - b.dispenser);
    }

    const finalPoints = [];

    orderedSegments.forEach((seg) => {
      const pts = seg.points;
      const totalInSeg = pts.length;

      pts.forEach((p, pIdx) => {
        const normX = (p.x - bounds.minX) * scaleRatio;
        let normY = (p.y - bounds.minY) * scaleRatio;
        if (invertY) normY = targetHeightMm - normY;

        const worldX = parseFloat((normX + offsetX).toFixed(3));
        const worldY = parseFloat((normY + offsetY).toFixed(3));

        const ptObj = CNCApp.State.createPoint(worldX, worldY);
        ptObj.dispenser = seg.dispenser;
        ptObj.speed = speed;
        ptObj.group1 = '' + seg.segmentId;
        ptObj.group2 = '';

        if (mode === 'lines') {
          if (pIdx === 0) {
            ptObj.lower = true;
            ptObj.valveStart = true;
            ptObj.valveStop = false;
            ptObj.raise = false;
            ptObj.time = '';
          } else if (pIdx === totalInSeg - 1) {
            ptObj.lower = false;
            ptObj.valveStart = false;
            ptObj.valveStop = true;
            ptObj.raise = true;
            ptObj.time = '';
          } else {
            ptObj.lower = false;
            ptObj.valveStart = false;
            ptObj.valveStop = false;
            ptObj.raise = false;
            ptObj.time = '';
          }
        } else {
          ptObj.lower = true;
          ptObj.valveStart = true;
          ptObj.time = dropTimeMs;
          ptObj.valveStop = true;
          ptObj.raise = true;
        }

        finalPoints.push(ptObj);
      });
    });

    return finalPoints;
  },

  // Примена на новогенерираната патека врз проектот
  applyToProject: function(replaceExisting = true) {
    if (CNCApp.State.isActiveTabReadOnly && CNCApp.State.isActiveTabReadOnly()) {
      alert('⛔ Овој таб моментално работи на машината и е заклучен за промени! Отворете нов таб (➕ Нов таб) за да ја зачувате генерираната патека.');
      return;
    }
    const mode = document.querySelector('input[name="svgGenMode"]:checked')?.value || 'pockets';
    const stepMm = parseFloat(document.getElementById('svgGenStep')?.value) || 2.0;
    const targetWidthMm = parseFloat(document.getElementById('svgGenTargetWidth')?.value) || (this.detectedPhysicalWidthMm || 60);
    const invertY = document.getElementById('svgGenInvertY')?.checked ?? true;
    const offsetX = parseFloat(document.getElementById('svgGenOffsetX')?.value) || 0;
    const offsetY = parseFloat(document.getElementById('svgGenOffsetY')?.value) || 0;
    const speed = Math.round(parseFloat(document.getElementById('svgGenSpeed')?.value) || 650);
    const travelNearSpeed = Math.round(parseFloat(document.getElementById('svgGenTravelNearSpeed')?.value) || 1200);
    const travelFarSpeed = Math.round(parseFloat(document.getElementById('svgGenTravelFarSpeed')?.value) || 5000);
    const minClearanceMm = parseFloat(document.getElementById('svgGenMinClearance')?.value) || 0.18;
    const tipMarginMm = parseFloat(document.getElementById('svgGenTipMargin')?.value) || 0.8;
    const dropTime = Math.round(parseFloat(document.getElementById('svgGenDropTime')?.value) || 50);
    const acuteTipDwell = Math.round(parseFloat(document.getElementById('svgGenAcuteTipDwell')?.value) || 30);
    const enableRdp = document.getElementById('svgGenRdpSimplify')?.checked ?? true;
    const depthMm = parseFloat(document.getElementById('svgGenDepth')?.value) || 1.0;
    const flowRateQ = parseFloat(document.getElementById('svgGenFlowRate')?.value) || 16.5;
    const useCapillary = document.getElementById('svgGenCapillary')?.checked ?? true;
    const groupByColor = document.getElementById('svgGenGroupByColor')?.checked ?? true;

    const newPoints = this.generatePoints({
      mode,
      stepMm,
      targetWidthMm,
      invertY,
      offsetX,
      offsetY,
      speed,
      travelNearSpeed,
      travelFarSpeed,
      minClearanceMm,
      tipMarginMm,
      dropTimeMs: dropTime,
      acuteTipDwellMs: acuteTipDwell,
      enableRdp,
      depthMm,
      flowRateQ,
      useCapillary,
      groupByDispenser: groupByColor
    });

    if (newPoints.length === 0) return;

    if (replaceExisting) {
      CNCApp.State.points = newPoints;
    } else {
      CNCApp.State.points = CNCApp.State.points.concat(newPoints);
    }

    // Постави го и SVG-то во позадина на платното за совршено поклопување
    if (this.currentSvgString && CNCApp.Parser) {
      CNCApp.Parser.loadSvgContent(this.currentSvgString);
    }

    CNCApp.Table.enforceDispenserSafety();
    CNCApp.State.selectedIndices.clear();
    CNCApp.State.activePointIndex = 0;
    CNCApp.State.selectedIndices.add(0);
    CNCApp.State.snapshot();
    CNCApp.Table.render();
    CNCApp.Canvas.resetView();
    CNCApp.GCode.updateCycleTime();

    this.closeModal();

    let modeTitle = '🎯 Тежишта на полиња и оски на канали (Полнење)';
    if (mode === 'lines') modeTitle = '📏 Контури (Линии)';
    if (mode === 'dots') modeTitle = '⚪ Капки по контури';

    alert(`🎉 Успешно се генерирани ${newPoints.length} точки од SVG фајлот!\n\n` +
          `• Режим: ${modeTitle}\n` +
          `• Чекор: ${stepMm} mm\n` +
          `• Ширина на модел: ${targetWidthMm} mm\n` +
          `• Време за циклус: ${document.getElementById('cycleTimeDisplay').innerText}`);
  }
};
