/* ============================================================
   prompt.js — Prompt → Animation config
   Interpreta el texto del prompt (ES/EN) y produce un objeto
   de configuración que el motor de animación entiende.
   ============================================================ */
(function (global) {
  "use strict";

  // Diccionario de palabras clave -> ajustes.
  // Cada entrada suma/ajusta propiedades del "motion plan".
  const KEYWORDS = [
    // --- Zoom ---
    { re: /(zoom.?in|acerc|acercando|dolly ?in|push ?in|primer plano)/i, apply: p => { p.zoom = 1; p.zoomAmt += 0.22; } },
    { re: /(zoom.?out|alejar|alejando|dolly ?out|pull ?back|plano general)/i, apply: p => { p.zoom = -1; p.zoomAmt += 0.20; } },
    // "zoom" genérico (sin dirección) => zoom in suave por defecto
    { re: /\bzoom\b/i, apply: p => { if (p.zoom === 0) { p.zoom = 1; p.zoomAmt += 0.18; } } },

    // --- Pan ---
    { re: /(paneo|pan\b|barrido).*(izquierda|left)/i, apply: p => { p.panX = -1; } },
    { re: /(paneo|pan\b|barrido).*(derecha|right)/i, apply: p => { p.panX = 1; } },
    { re: /(paneo|pan\b|barrido|lateral)/i, apply: p => { if (p.panX === 0) p.panX = 1; } },
    { re: /(arriba|up|hacia arriba|tilt ?up)/i, apply: p => { p.panY = -1; } },
    { re: /(abajo|down|hacia abajo|tilt ?down)/i, apply: p => { p.panY = 1; } },

    // --- Parallax / depth ---
    { re: /(parallax|profundidad|depth|3d|tridimensional|capas)/i, apply: p => { p.parallax += 0.6; } },

    // --- Rotation / orbit ---
    { re: /(rotar|rotación|gira|orbit|orbital|vuelta)/i, apply: p => { p.rotate += 0.5; } },

    // --- Camera shake / handheld ---
    { re: /(temblor|shake|camara en mano|cámara en mano|handheld|acción|action|nervios)/i, apply: p => { p.shake += 0.7; } },

    // --- Particles ---
    { re: /(part[ií]cula|polvo|dust|nieve|snow|chispa|spark|luci[eé]rnaga|bokeh|magic)/i, apply: p => { p.particles += 0.8; } },
    { re: /(lluvia|rain)/i, apply: p => { p.particles += 0.6; p.particleType = "rain"; } },

    // --- Fog / mist ---
    { re: /(niebla|neblina|fog|mist|humo|smoke|bruma)/i, apply: p => { p.fog += 0.7; } },

    // --- Light leaks / flares ---
    { re: /(light ?leak|destello|flare|reflejo|brillo|glow|luz suave)/i, apply: p => { p.lightLeak += 0.7; } },

    // --- Pace ---
    { re: /(lento|slow|suave|tranquilo|calm|cinematográf|cinematic|elegante)/i, apply: p => { p.speed *= 0.7; } },
    { re: /(r[aá]pido|fast|din[aá]mico|dynamic|energético|energetic|frenético)/i, apply: p => { p.speed *= 1.5; } },

    // --- Mood / grade hints (bias only; explicit style select wins) ---
    { re: /(atardecer|sunset|c[aá]lido|warm|dorado|golden)/i, apply: p => { p.warm += 0.4; } },
    { re: /(frío|cold|azul|blue|noche|night|luna)/i, apply: p => { p.cool += 0.4; } },
    { re: /(vibrante|vivid|saturado|colorido)/i, apply: p => { p.saturate += 0.4; } },
    { re: /(sue[ñn]o|dream|onírico|etéreo|ensue[ñn]o)/i, apply: p => { p.bloom += 0.5; p.fog += 0.2; } },
  ];

  // Estilos visuales (grading base). El selector de estilo del UI aplica esto.
  const STYLES = {
    cinematic: { contrast: 1.12, saturate: 1.05, brightness: 1.0, warmth: 0.06, vignette: 0.55, grain: 0.12, bloom: 0.2 },
    dreamy:    { contrast: 0.95, saturate: 1.1,  brightness: 1.08, warmth: 0.12, vignette: 0.35, grain: 0.05, bloom: 0.6 },
    vivid:     { contrast: 1.2,  saturate: 1.45, brightness: 1.05, warmth: 0.0,  vignette: 0.3,  grain: 0.06, bloom: 0.25 },
    noir:      { contrast: 1.35, saturate: 0.0,  brightness: 0.98, warmth: 0.0,  vignette: 0.7,  grain: 0.22, bloom: 0.15 },
    vintage:   { contrast: 1.05, saturate: 0.85, brightness: 1.02, warmth: 0.22, vignette: 0.6,  grain: 0.28, bloom: 0.2 },
  };

  /**
   * Analiza el prompt y devuelve un plan de movimiento normalizado.
   * @param {string} text
   * @param {object} opts { intensity 0..100, duration seconds, style key }
   */
  function parsePrompt(text, opts) {
    opts = opts || {};
    const intensity = (typeof opts.intensity === "number" ? opts.intensity : 55) / 100;

    // Plan base
    const p = {
      zoom: 0, zoomAmt: 0.0,
      panX: 0, panY: 0,
      parallax: 0, rotate: 0, shake: 0,
      particles: 0, particleType: "dust", fog: 0, lightLeak: 0,
      speed: 1, warm: 0, cool: 0, saturate: 0, bloom: 0,
    };

    const t = (text || "").toLowerCase();
    let matched = 0;
    KEYWORDS.forEach(k => { if (k.re.test(t)) { k.apply(p); matched++; } });

    // Si no hubo casi nada, aplicamos un movimiento cinematográfico por defecto.
    if (matched === 0) { p.zoom = 1; p.zoomAmt = 0.16; p.panX = 0.4; p.parallax = 0.3; }

    // Zoom por defecto si se pidió movimiento pero no zoom explícito
    if (p.zoom === 0 && p.panX === 0 && p.panY === 0 && p.parallax === 0) {
      p.zoom = 1; p.zoomAmt = 0.14;
    }
    if (p.zoomAmt === 0 && p.zoom !== 0) p.zoomAmt = 0.16;

    // Escala por intensidad (0..1 -> factor 0.4..1.6)
    const iScale = 0.4 + intensity * 1.2;
    const cfg = {
      zoomDir: p.zoom,                                   // -1, 0, 1
      zoomAmount: clamp(p.zoomAmt * iScale, 0, 0.6),     // fracción de escala extra
      panX: clamp(p.panX * (0.06 + 0.10 * intensity), -0.22, 0.22),
      panY: clamp(p.panY * (0.06 + 0.10 * intensity), -0.22, 0.22),
      parallax: clamp(p.parallax * iScale, 0, 1),
      rotate: clamp(p.rotate * (0.02 + 0.03 * intensity), 0, 0.12),
      shake: clamp(p.shake * intensity, 0, 1),
      particles: clamp(p.particles * (0.5 + intensity), 0, 1.5),
      particleType: p.particleType,
      fog: clamp(p.fog * (0.5 + intensity * 0.8), 0, 1),
      lightLeak: clamp(p.lightLeak, 0, 1),
      speed: clamp(p.speed, 0.4, 2.2),
      duration: clamp(opts.duration || 5, 1, 20),
      fps: 30,
      grade: buildGrade(opts.style, p),
      styleKey: opts.style || "cinematic",
      matchedKeywords: matched,
    };
    return cfg;
  }

  function buildGrade(styleKey, p) {
    const base = Object.assign({}, STYLES[styleKey] || STYLES.cinematic);
    // Sesgos por palabras del prompt
    base.warmth += (p.warm - p.cool) * 0.25;
    base.saturate *= (1 + p.saturate * 0.3);
    base.bloom = Math.min(1, base.bloom + p.bloom * 0.5);
    return base;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // Descripción legible del plan (para mostrar en UI)
  function describe(cfg) {
    const parts = [];
    if (cfg.zoomDir > 0) parts.push("zoom in");
    else if (cfg.zoomDir < 0) parts.push("zoom out");
    if (cfg.panX > 0.01) parts.push("paneo →");
    else if (cfg.panX < -0.01) parts.push("paneo ←");
    if (cfg.panY < -0.01) parts.push("tilt ↑");
    else if (cfg.panY > 0.01) parts.push("tilt ↓");
    if (cfg.parallax > 0.05) parts.push("parallax");
    if (cfg.shake > 0.05) parts.push("cámara en mano");
    if (cfg.particles > 0.05) parts.push(cfg.particleType === "rain" ? "lluvia" : "partículas");
    if (cfg.fog > 0.05) parts.push("niebla");
    if (cfg.lightLeak > 0.05) parts.push("light leak");
    parts.push(cfg.styleKey);
    return parts.join(" · ");
  }

  global.FlowPrompt = { parsePrompt, describe, STYLES };
})(window);
