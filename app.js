/* ============================================================
   app.js — Orquestador de UI de FlowMotion
   Conecta controles, motor (FlowEngine), grabador (FlowRecorder),
   parser (FlowPrompt) y el proveedor de IA (FlowAI).
   ============================================================ */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // --- Elementos ---
  const els = {
    prompt: $("prompt"),
    promptChips: $("promptChips"),
    dropzone: $("dropzone"),
    dropzoneInner: $("dropzoneInner"),
    fileInput: $("fileInput"),
    previewThumb: $("previewThumb"),
    sampleBtn: $("sampleBtn"),
    duration: $("duration"),
    aspect: $("aspect"),
    intensity: $("intensity"),
    intensityVal: $("intensityVal"),
    style: $("style"),
    generateBtn: $("generateBtn"),
    previewBtn: $("previewBtn"),
    progressWrap: $("progressWrap"),
    progressBar: $("progressBar"),
    progressLabel: $("progressLabel"),
    canvas: $("canvas"),
    canvasHolder: $("canvasHolder"),
    emptyState: $("emptyState"),
    resultVideo: $("resultVideo"),
    replayBtn: $("replayBtn"),
    downloadBtn: $("downloadBtn"),
    stageFoot: $("stageFoot"),
    stageMeta: $("stageMeta"),
    galleryGrid: $("galleryGrid"),
    galleryEmpty: $("galleryEmpty"),
    modalOverlay: $("modalOverlay"),
    modalContent: $("modalContent"),
    modalClose: $("modalClose"),
    toast: $("toast"),
    helpBtn: $("helpBtn"),
    aiConnectBtn: $("aiConnectBtn"),
    videoTab: $("videoTab"),
    tabs: document.querySelectorAll(".tab"),
  };

  const engine = new FlowEngine(els.canvas);
  let currentImage = null;   // HTMLImageElement
  let currentImageDataUrl = null;
  let busy = false;
  const clips = [];          // {url, prompt, thumb}

  // ---------- Utilidades ----------
  function toast(msg, ms) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { els.toast.hidden = true; }, ms || 2600);
  }

  function setProgress(p, label) {
    els.progressWrap.hidden = false;
    els.progressBar.style.width = Math.round(p * 100) + "%";
    if (label) els.progressLabel.textContent = label;
  }
  function hideProgress() { els.progressWrap.hidden = true; els.progressBar.style.width = "0%"; }

  function updateAspect() {
    const a = els.aspect.value;
    engine.setAspect(a);
    els.canvasHolder.style.aspectRatio = a.replace(":", " / ");
  }

  function buildConfig() {
    return FlowPrompt.parsePrompt(els.prompt.value, {
      intensity: parseInt(els.intensity.value, 10),
      duration: parseInt(els.duration.value, 10),
      style: els.style.value,
    });
  }

  function canGenerate() { return !!currentImage && !busy; }
  function refreshButtons() {
    els.generateBtn.disabled = !canGenerate();
    els.previewBtn.disabled = !canGenerate();
  }

  function showTab(name) {
    els.tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === name));
    const showVideo = name === "video";
    els.resultVideo.hidden = !showVideo;
    els.canvasHolder.style.display = showVideo ? "none" : "grid";
  }

  // ---------- Carga de imagen ----------
  function loadImageFromDataUrl(dataUrl) {
    const img = new Image();
    img.onload = () => {
      currentImage = img;
      currentImageDataUrl = dataUrl;
      engine.setImage(img);
      updateAspect();
      els.emptyState.style.display = "none";
      els.previewThumb.src = dataUrl;
      els.previewThumb.hidden = false;
      els.dropzoneInner.style.display = "none";
      refreshButtons();
      // primer frame estático
      engine.setConfig(buildConfig());
      engine.renderFrame(0);
      showTab("preview");
      toast("Imagen cargada. ¡Escribe un prompt y genera!");
    };
    img.onerror = () => toast("No se pudo cargar la imagen.");
    img.src = dataUrl;
  }

  function handleFile(file) {
    if (!file || !file.type.startsWith("image/")) { toast("Selecciona un archivo de imagen."); return; }
    const reader = new FileReader();
    reader.onload = (e) => loadImageFromDataUrl(e.target.result);
    reader.readAsDataURL(file);
  }

  // Imagen de ejemplo generada por código (degradado + formas) — sin red.
  function makeSampleImage() {
    const c = document.createElement("canvas");
    c.width = 1280; c.height = 720;
    const x = c.getContext("2d");
    // cielo
    const sky = x.createLinearGradient(0, 0, 0, 720);
    sky.addColorStop(0, "#1a2a6c");
    sky.addColorStop(0.5, "#b21f66");
    sky.addColorStop(1, "#fdbb2d");
    x.fillStyle = sky; x.fillRect(0, 0, 1280, 720);
    // sol
    const sun = x.createRadialGradient(900, 300, 20, 900, 300, 180);
    sun.addColorStop(0, "rgba(255,250,220,1)");
    sun.addColorStop(1, "rgba(255,220,150,0)");
    x.fillStyle = sun; x.beginPath(); x.arc(900, 300, 180, 0, Math.PI * 2); x.fill();
    // montañas (capas)
    function mountains(baseY, color) {
      x.fillStyle = color; x.beginPath(); x.moveTo(0, 720);
      for (let i = 0; i <= 1280; i += 40) {
        const y = baseY + Math.sin(i * 0.01) * 40 + Math.random() * 20;
        x.lineTo(i, y);
      }
      x.lineTo(1280, 720); x.closePath(); x.fill();
    }
    mountains(460, "#3a1c5a");
    mountains(540, "#241238");
    mountains(620, "#120a1e");
    // reflejo agua
    x.fillStyle = "rgba(255,255,255,0.05)";
    for (let i = 0; i < 40; i++) x.fillRect(Math.random() * 1280, 640 + Math.random() * 80, Math.random() * 120, 2);
    return c.toDataURL("image/jpeg", 0.92);
  }

  // ---------- Preview en tiempo real ----------
  function doPreview() {
    if (!canGenerate()) return;
    engine.setConfig(buildConfig());
    engine.loop = true;
    showTab("preview");
    engine.play();
    els.stageMeta.textContent = FlowPrompt.describe(engine.cfg);
    toast("Previsualización en bucle. Pulsa 'Generar video' para exportar.");
  }

  // ---------- Generación (export a video) ----------
  async function doGenerate() {
    if (!canGenerate()) return;
    busy = true; refreshButtons();
    engine.stop();
    const cfg = buildConfig();
    engine.setConfig(cfg);
    els.stageMeta.textContent = FlowPrompt.describe(cfg);

    // Ruta IA real (si está configurada) — opcional.
    if (window.FlowAI && FlowAI.isEnabled()) {
      try {
        setProgress(0.05, "Generando con IA remota…");
        const out = await FlowAI.generateWithAI({
          prompt: els.prompt.value, imageDataUrl: currentImageDataUrl,
          duration: cfg.duration, aspect: els.aspect.value, style: cfg.styleKey,
        }, (p, s) => setProgress(p, s));
        finishWithVideo(out.url, null);
        toast("Video generado con IA (" + out.provider + ").");
      } catch (err) {
        toast("IA remota falló, usando motor local: " + err.message, 4000);
        await renderLocally(cfg);
      } finally { busy = false; refreshButtons(); hideProgress(); }
      return;
    }

    // Ruta local (por defecto)
    await renderLocally(cfg);
    busy = false; refreshButtons(); hideProgress();
  }

  async function renderLocally(cfg) {
    setProgress(0.02, "Renderizando frames…");
    try {
      const result = await FlowRecorder.record(engine, {
        fps: cfg.fps,
        onProgress: (p) => setProgress(p * 0.98, "Renderizando… " + Math.round(p * 100) + "%"),
      });
      setProgress(1, "Finalizando…");
      finishWithVideo(result.url, result.blob);
      toast("¡Video listo! Ya puedes descargarlo.");
    } catch (err) {
      console.error(err);
      toast("Error al grabar: " + err.message, 4000);
    }
  }

  function finishWithVideo(url, blob) {
    els.resultVideo.src = url;
    els.resultVideo.hidden = false;
    els.resultVideo.loop = true;
    els.resultVideo.play().catch(() => {});
    els.downloadBtn.href = url;
    els.stageFoot.hidden = false;
    els.videoTab.disabled = false;
    showTab("video");
    addClip(url);
  }

  // ---------- Galería ----------
  function addClip(url) {
    clips.unshift({ url, prompt: els.prompt.value || "Sin prompt" });
    els.galleryEmpty.style.display = "none";
    renderGallery();
  }
  function renderGallery() {
    // Limpia (conservando el nodo vacío)
    [...els.galleryGrid.querySelectorAll(".gallery-item")].forEach(n => n.remove());
    clips.forEach((clip) => {
      const item = document.createElement("div");
      item.className = "gallery-item";
      const v = document.createElement("video");
      v.src = clip.url; v.muted = true; v.loop = true; v.playsInline = true;
      v.addEventListener("mouseenter", () => v.play().catch(() => {}));
      v.addEventListener("mouseleave", () => v.pause());
      const label = document.createElement("div");
      label.className = "gi-label";
      label.textContent = clip.prompt;
      item.appendChild(v); item.appendChild(label);
      item.addEventListener("click", () => {
        els.resultVideo.src = clip.url;
        els.videoTab.disabled = false;
        els.stageFoot.hidden = false;
        els.downloadBtn.href = clip.url;
        showTab("video");
        els.resultVideo.play().catch(() => {});
      });
      els.galleryGrid.appendChild(item);
    });
  }

  // ---------- Modales ----------
  function openModal(html) {
    els.modalContent.innerHTML = html;
    els.modalOverlay.hidden = false;
    els.modalOverlay.style.display = "grid";
  }
  function closeModal() {
    els.modalOverlay.hidden = true;
    els.modalOverlay.style.display = "none";
  }

  const HELP_HTML = `
    <h2>Cómo funciona FlowMotion</h2>
    <p>FlowMotion convierte una imagen fija en un clip de video animado, guiándose por tu <b>prompt</b>. Todo ocurre en tu navegador, sin subir nada a ningún servidor.</p>
    <h3>Pasos</h3>
    <ol>
      <li>Sube una imagen (o usa la de ejemplo).</li>
      <li>Escribe un prompt describiendo el movimiento y el ambiente.</li>
      <li>Ajusta duración, formato, intensidad y estilo.</li>
      <li>Pulsa <b>Previsualizar</b> para ver el bucle, o <b>Generar video</b> para exportar un archivo descargable.</li>
    </ol>
    <h3>Palabras clave que entiende el prompt</h3>
    <p><code>zoom in</code>, <code>zoom out</code>, <code>paneo izquierda/derecha</code>, <code>parallax</code>, <code>rotar</code>, <code>cámara en mano</code>, <code>partículas</code>, <code>lluvia</code>, <code>niebla</code>, <code>light leak</code>, <code>lento</code>, <code>rápido</code>, <code>atardecer</code>, <code>noche</code>, <code>vibrante</code>, <code>onírico</code>…</p>
    <h3>Nota sobre IA generativa real</h3>
    <p>Este entorno no tiene acceso a internet, así que el movimiento se sintetiza con un motor cinematográfico local (Canvas). Para usar un modelo de IA real (Veo, Runway, Replicate…), pulsa <b>Conectar IA real</b>.</p>`;

  const AI_HTML = `
    <h2>Conectar un modelo de IA real</h2>
    <p>Por seguridad, la clave API <b>nunca</b> debe ir en el navegador. Necesitas un pequeño backend que guarde la clave y haga de proxy.</p>
    <h3>1. Configura el proveedor</h3>
    <p>Desde la consola del navegador:</p>
    <pre><code>FlowAI.configure({
  enabled: true,
  provider: "replicate", // o "veo", "runway", "custom"
  endpoint: "https://tu-backend.com/generate"
});</code></pre>
    <h3>2. Backend de ejemplo (Node/Express + Replicate)</h3>
    <pre><code>app.post("/generate", async (req, res) =&gt; {
  const { prompt, image, duration } = req.body;
  const r = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.REPLICATE_API_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      version: "&lt;MODEL_VERSION_ID&gt;",
      input: { prompt, input_image: image, num_frames: duration * 25 },
    }),
  });
  const job = await r.json();
  res.json({ jobId: job.id });
});</code></pre>
    <p>Cuando esté activo, el botón <b>Generar video</b> enrutará al modelo real automáticamente y caerá al motor local si algo falla.</p>`;

  // ---------- Eventos ----------
  function bind() {
    // chips
    els.promptChips.addEventListener("click", (e) => {
      const btn = e.target.closest(".chip");
      if (!btn) return;
      const add = btn.dataset.add;
      els.prompt.value = els.prompt.value ? (els.prompt.value.replace(/\s*$/, "") + ", " + add) : add;
      els.prompt.focus();
    });

    // dropzone
    els.dropzone.addEventListener("click", () => els.fileInput.click());
    els.dropzone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") els.fileInput.click(); });
    els.fileInput.addEventListener("change", (e) => handleFile(e.target.files[0]));
    ["dragenter", "dragover"].forEach(ev =>
      els.dropzone.addEventListener(ev, (e) => { e.preventDefault(); els.dropzone.classList.add("drag"); }));
    ["dragleave", "drop"].forEach(ev =>
      els.dropzone.addEventListener(ev, (e) => { e.preventDefault(); els.dropzone.classList.remove("drag"); }));
    els.dropzone.addEventListener("drop", (e) => {
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleFile(f);
    });

    els.sampleBtn.addEventListener("click", () => loadImageFromDataUrl(makeSampleImage()));

    // controles
    els.intensity.addEventListener("input", () => {
      els.intensityVal.textContent = els.intensity.value;
      if (currentImage) { engine.setConfig(buildConfig()); if (!engine.raf) engine.renderFrame(0); }
    });
    els.aspect.addEventListener("change", () => {
      updateAspect();
      if (currentImage) { engine.setConfig(buildConfig()); engine.renderFrame(0); }
    });
    [els.style, els.duration].forEach(el => el.addEventListener("change", () => {
      if (currentImage) { engine.setConfig(buildConfig()); if (!engine.raf) engine.renderFrame(0); }
    }));

    els.previewBtn.addEventListener("click", doPreview);
    els.generateBtn.addEventListener("click", doGenerate);
    els.replayBtn.addEventListener("click", () => { els.resultVideo.currentTime = 0; els.resultVideo.play(); });

    // tabs
    els.tabs.forEach(t => t.addEventListener("click", () => {
      if (t.disabled) return;
      showTab(t.dataset.tab);
      if (t.dataset.tab === "preview" && currentImage) { engine.loop = true; engine.play(); }
      else engine.stop();
    }));

    // modales
    els.helpBtn.addEventListener("click", () => openModal(HELP_HTML));
    els.aiConnectBtn.addEventListener("click", () => openModal(AI_HTML));
    els.modalClose.addEventListener("click", closeModal);
    els.modalOverlay.addEventListener("click", (e) => { if (e.target === els.modalOverlay) closeModal(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
  }

  // ---------- Init ----------
  function init() {
    closeModal();          // asegura que el modal esté oculto al arrancar
    els.stageFoot.hidden = true;
    els.resultVideo.hidden = true;
    bind();
    updateAspect();
    // Comprobación de capacidades
    if (typeof MediaRecorder === "undefined" || !els.canvas.captureStream) {
      $("engineBadge").textContent = "Aviso: este navegador no soporta exportar video";
      toast("Tu navegador no soporta MediaRecorder. Usa Chrome/Firefox/Edge.", 5000);
    }
    // primer render vacío
    engine.renderFrame(0);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
