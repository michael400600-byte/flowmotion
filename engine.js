/* ============================================================
   engine.js — FlowMotion animation engine
   Renderiza una imagen animada en un <canvas> a partir de un
   plan de movimiento (cfg de FlowPrompt). Soporta:
   - Ken Burns (zoom in/out + pan + tilt)
   - Parallax con separación de capas por profundidad simulada
   - Rotación / orbit sutil
   - Camera shake (handheld)
   - Partículas (polvo/bokeh, nieve, lluvia)
   - Niebla animada, light leaks, bloom
   - Color grading (contraste, saturación, calidez, viñeta, grano)
   ============================================================ */
(function (global) {
  "use strict";

  function FlowEngine(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.img = null;
    this.cfg = null;
    this.raf = null;
    this.startTime = 0;
    this.duration = 5;
    this.loop = true;
    this.onFrame = null;      // (progress 0..1) => void
    this.onEnd = null;
    this.particles = [];
    this.leaks = [];
    this.fogOffset = 0;
    this._grainCanvas = null;
    this._depthReady = false;
  }

  FlowEngine.prototype.setImage = function (img) {
    this.img = img;
    this._buildDepthLayers();
  };

  // Ajusta el tamaño del canvas según el aspect ratio elegido.
  FlowEngine.prototype.setAspect = function (aspect) {
    const map = { "16:9": [1280, 720], "9:16": [720, 1280], "1:1": [900, 900], "4:5": [864, 1080] };
    const dims = map[aspect] || map["16:9"];
    this.canvas.width = dims[0];
    this.canvas.height = dims[1];
  };

  FlowEngine.prototype.setConfig = function (cfg) {
    this.cfg = cfg;
    this.duration = cfg.duration;
    this._initParticles();
    this._initLeaks();
    this._buildGrain();
  };

  // ---- Capas de profundidad simuladas para parallax ----
  // Genera 2 versiones: fondo (blur) y "sujeto" (máscara radial central nítida).
  FlowEngine.prototype._buildDepthLayers = function () {
    if (!this.img) return;
    const w = this.img.naturalWidth || this.img.width;
    const h = this.img.naturalHeight || this.img.height;

    // Capa de fondo con leve desenfoque
    const bg = document.createElement("canvas");
    bg.width = w; bg.height = h;
    const bctx = bg.getContext("2d");
    bctx.filter = "blur(6px)";
    bctx.drawImage(this.img, 0, 0, w, h);
    bctx.filter = "none";

    // Capa "sujeto": copia nítida con máscara radial (centro visible)
    const fg = document.createElement("canvas");
    fg.width = w; fg.height = h;
    const fctx = fg.getContext("2d");
    fctx.drawImage(this.img, 0, 0, w, h);
    const grad = fctx.createRadialGradient(w / 2, h * 0.52, Math.min(w, h) * 0.15, w / 2, h * 0.52, Math.max(w, h) * 0.62);
    grad.addColorStop(0, "rgba(0,0,0,1)");
    grad.addColorStop(0.7, "rgba(0,0,0,1)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    fctx.globalCompositeOperation = "destination-in";
    fctx.fillStyle = grad;
    fctx.fillRect(0, 0, w, h);
    fctx.globalCompositeOperation = "source-over";

    this._bgLayer = bg;
    this._fgLayer = fg;
    this._depthReady = true;
  };

  FlowEngine.prototype._initParticles = function () {
    this.particles = [];
    const density = this.cfg ? this.cfg.particles : 0;
    if (density <= 0) return;
    const count = Math.round(60 * density);
    const type = this.cfg.particleType;
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: Math.random(), y: Math.random(),
        r: type === "rain" ? (Math.random() * 1.2 + 0.4) : (Math.random() * 2.6 + 0.6),
        spd: Math.random() * 0.5 + 0.2,
        drift: (Math.random() - 0.5) * 0.4,
        a: Math.random() * 0.6 + 0.25,
        tw: Math.random() * Math.PI * 2, // twinkle phase
      });
    }
  };

  FlowEngine.prototype._initLeaks = function () {
    this.leaks = [];
    const amt = this.cfg ? this.cfg.lightLeak : 0;
    if (amt <= 0) return;
    const colors = [
      [255, 150, 60], [255, 90, 156], [124, 92, 255], [18, 194, 233],
    ];
    const n = 2 + Math.round(amt * 2);
    for (let i = 0; i < n; i++) {
      this.leaks.push({
        x: Math.random(), y: Math.random(),
        r: Math.random() * 0.4 + 0.3,
        col: colors[i % colors.length],
        phase: Math.random() * Math.PI * 2,
        spd: Math.random() * 0.4 + 0.2,
      });
    }
  };

  // Textura de grano pre-renderizada
  FlowEngine.prototype._buildGrain = function () {
    const size = 128;
    const c = document.createElement("canvas");
    c.width = size; c.height = size;
    const ctx = c.getContext("2d");
    const id = ctx.createImageData(size, size);
    for (let i = 0; i < id.data.length; i += 4) {
      const v = Math.random() * 255;
      id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
      id.data[i + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    this._grainCanvas = c;
  };

  // ---- easing suave (ease-in-out) para el movimiento de cámara ----
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  /**
   * Dibuja un único frame para el progreso p (0..1).
   * Este método es la base tanto de la preview como de la grabación.
   */
  FlowEngine.prototype.renderFrame = function (p) {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const cfg = this.cfg;
    if (!this.img || !cfg) { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); return; }

    const e = easeInOut(p);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    // --- Cálculo de transform de cámara (Ken Burns) ---
    const baseScale = coverScale(this.img, W, H);
    const zoomDelta = cfg.zoomAmount * (cfg.zoomDir >= 0 ? 1 : -1);
    // Si zoom out, empezamos "acercados" y salimos.
    const zoomStart = cfg.zoomDir < 0 ? 1 + cfg.zoomAmount : 1;
    const zoomNow = zoomStart + zoomDelta * e;
    const scale = baseScale * zoomNow * 1.06; // 1.06 = margen para pan

    const panX = cfg.panX * W * (e - 0.5) * 2;
    const panY = cfg.panY * H * (e - 0.5) * 2;
    const rot = cfg.rotate * Math.sin(p * Math.PI) ;

    // Camera shake (handheld)
    let shx = 0, shy = 0;
    if (cfg.shake > 0) {
      const s = cfg.shake * 10;
      shx = (Math.sin(p * 60) + Math.sin(p * 137)) * s;
      shy = (Math.cos(p * 51) + Math.sin(p * 90)) * s;
    }

    const iw = (this.img.naturalWidth || this.img.width);
    const ih = (this.img.naturalHeight || this.img.height);

    // --- Parallax: fondo se mueve menos, sujeto más ---
    if (cfg.parallax > 0.05 && this._depthReady) {
      // fondo
      this._drawLayer(this._bgLayer, iw, ih, W, H, scale * 1.02,
        panX * 0.4 + shx * 0.5, panY * 0.4 + shy * 0.5, rot);
      // sujeto (se mueve un poco más para dar sensación de profundidad)
      const pf = 1 + cfg.parallax * 0.06;
      this._drawLayer(this._fgLayer, iw, ih, W, H, scale * pf,
        panX * 1.25 + shx, panY * 1.25 + shy, rot);
    } else {
      this._drawLayer(this.img, iw, ih, W, H, scale, panX + shx, panY + shy, rot);
    }

    // --- Niebla animada ---
    if (cfg.fog > 0.05) this._drawFog(ctx, W, H, p, cfg.fog);

    // --- Partículas ---
    if (this.particles.length) this._drawParticles(ctx, W, H, p, cfg);

    // --- Light leaks / bloom ---
    if (this.leaks.length) this._drawLeaks(ctx, W, H, p);

    // --- Color grading ---
    this._applyGrade(ctx, W, H, cfg.grade, p);

    if (this.onFrame) this.onFrame(p);
  };

  FlowEngine.prototype._drawLayer = function (src, iw, ih, W, H, scale, ox, oy, rot) {
    const ctx = this.ctx;
    const dw = iw * scale, dh = ih * scale;
    ctx.save();
    ctx.translate(W / 2 + ox, H / 2 + oy);
    if (rot) ctx.rotate(rot);
    ctx.drawImage(src, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  };

  FlowEngine.prototype._drawFog = function (ctx, W, H, p, amt) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const off = p * W * 0.4;
    for (let i = 0; i < 3; i++) {
      const g = ctx.createRadialGradient(
        (W * (0.3 + i * 0.25) + off) % (W * 1.3) - W * 0.15, H * (0.4 + 0.2 * Math.sin(p * 3 + i)),
        0,
        (W * (0.3 + i * 0.25) + off) % (W * 1.3) - W * 0.15, H * (0.4 + 0.2 * Math.sin(p * 3 + i)),
        W * 0.5
      );
      const a = amt * 0.10;
      g.addColorStop(0, `rgba(200,210,230,${a})`);
      g.addColorStop(1, "rgba(200,210,230,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  };

  FlowEngine.prototype._drawParticles = function (ctx, W, H, p, cfg) {
    const type = cfg.particleType;
    ctx.save();
    for (const pt of this.particles) {
      // movimiento
      let y = (pt.y + p * pt.spd * (type === "rain" ? 2.2 : 0.5)) % 1;
      let x = (pt.x + Math.sin(p * 2 + pt.tw) * pt.drift * 0.05 + 1) % 1;
      const px = x * W, py = y * H;
      if (type === "rain") {
        ctx.strokeStyle = `rgba(180,200,230,${pt.a * 0.7})`;
        ctx.lineWidth = pt.r;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - 2, py + 12 + pt.r * 6);
        ctx.stroke();
      } else {
        const tw = 0.5 + 0.5 * Math.sin(p * 6 + pt.tw);
        ctx.globalCompositeOperation = "screen";
        const g = ctx.createRadialGradient(px, py, 0, px, py, pt.r * 4);
        g.addColorStop(0, `rgba(255,245,220,${pt.a * tw})`);
        g.addColorStop(1, "rgba(255,245,220,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, pt.r * 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  };

  FlowEngine.prototype._drawLeaks = function (ctx, W, H, p) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (const l of this.leaks) {
      const cx = (l.x + Math.sin(p * l.spd * 2 + l.phase) * 0.1) * W;
      const cy = (l.y + Math.cos(p * l.spd * 1.5 + l.phase) * 0.1) * H;
      const rad = l.r * Math.max(W, H) * (0.8 + 0.2 * Math.sin(p * 3 + l.phase));
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      const [r, gg, b] = l.col;
      const a = 0.12 + 0.06 * Math.sin(p * 4 + l.phase);
      g.addColorStop(0, `rgba(${r},${gg},${b},${a})`);
      g.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  };

  FlowEngine.prototype._applyGrade = function (ctx, W, H, grade, p) {
    if (!grade) return;

    // Viñeta
    if (grade.vignette > 0) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, `rgba(0,0,0,${grade.vignette * 0.7})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    // Calidez / frialdad (overlay de color)
    if (grade.warmth) {
      ctx.save();
      ctx.globalCompositeOperation = "overlay";
      if (grade.warmth > 0) ctx.fillStyle = `rgba(255,170,90,${Math.min(0.5, grade.warmth)})`;
      else ctx.fillStyle = `rgba(90,150,255,${Math.min(0.5, -grade.warmth)})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // Bloom (halo suave de luces)
    if (grade.bloom > 0.05) {
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = grade.bloom * 0.18;
      // reusa el propio canvas escalado como glow rápido
      ctx.drawImage(this.canvas, -W * 0.02, -H * 0.02, W * 1.04, H * 1.04);
      ctx.restore();
    }

    // Grano de película
    if (grade.grain > 0.02 && this._grainCanvas) {
      ctx.save();
      ctx.globalAlpha = grade.grain * 0.5;
      ctx.globalCompositeOperation = "overlay";
      const gs = 128;
      const ox = Math.floor(Math.random() * gs);
      const oy = Math.floor(Math.random() * gs);
      for (let y = -oy; y < H; y += gs)
        for (let x = -ox; x < W; x += gs)
          ctx.drawImage(this._grainCanvas, x, y);
      ctx.restore();
    }
  };

  // ---- Loop en tiempo real (preview) ----
  FlowEngine.prototype.play = function () {
    this.stop();
    this.startTime = performance.now();
    const step = (now) => {
      const elapsed = (now - this.startTime) / 1000 * (this.cfg ? this.cfg.speed : 1);
      let p = elapsed / this.duration;
      if (p >= 1) {
        if (this.loop) { this.startTime = now; p = 0; }
        else { this.renderFrame(1); if (this.onEnd) this.onEnd(); return; }
      }
      this.renderFrame(Math.min(p, 1));
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  };

  FlowEngine.prototype.stop = function () {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; }
  };

  // Utilidad: escala tipo "cover"
  function coverScale(img, W, H) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    return Math.max(W / iw, H / ih);
  }

  global.FlowEngine = FlowEngine;
})(window);
