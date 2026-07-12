/* ============================================================
   recorder.js — Exporta la animación del canvas a un video real
   Usa canvas.captureStream() + MediaRecorder (WebM/VP9/VP8).
   Renderiza frame a frame sincronizado con el reloj de grabación
   para obtener una duración precisa.
   ============================================================ */
(function (global) {
  "use strict";

  // Detecta el mejor mimeType soportado por el navegador.
  function pickMime() {
    const candidates = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
      "video/mp4;codecs=h264", // Safari reciente
      "video/mp4",
    ];
    for (const c of candidates) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
    }
    return "";
  }

  /**
   * Graba la animación.
   * @param {FlowEngine} engine  — motor ya configurado (setImage/setConfig/setAspect)
   * @param {object} opts { onProgress(0..1), fps }
   * @returns {Promise<{blob, url, mime, duration}>}
   */
  function record(engine, opts) {
    opts = opts || {};
    return new Promise((resolve, reject) => {
      if (typeof MediaRecorder === "undefined") {
        reject(new Error("MediaRecorder no está disponible en este navegador."));
        return;
      }
      const fps = opts.fps || (engine.cfg && engine.cfg.fps) || 30;
      const duration = engine.duration || 5;
      const totalFrames = Math.max(1, Math.round(duration * fps));
      const mime = pickMime();

      const stream = engine.canvas.captureStream(fps);
      let recorder;
      try {
        recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : undefined);
      } catch (err) {
        reject(err);
        return;
      }

      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
      recorder.onerror = (e) => reject(e.error || new Error("Error de grabación"));
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mime || "video/webm" });
        const url = URL.createObjectURL(blob);
        resolve({ blob, url, mime: mime || "video/webm", duration });
      };

      // Pausamos el loop en tiempo real; controlamos los frames manualmente.
      engine.stop();
      recorder.start();

      let frame = 0;
      // Damos tiempo al captureStream a "engancharse" antes de dibujar.
      const track = stream.getVideoTracks()[0];

      const drawNext = () => {
        const p = frame / (totalFrames - 1 || 1);
        engine.renderFrame(Math.min(p, 1));
        if (opts.onProgress) opts.onProgress(Math.min(p, 1));

        // Fuerza la captura del frame actual si el API existe (mejora precisión)
        if (track && typeof track.requestFrame === "function") {
          track.requestFrame();
        }
        frame++;
        if (frame >= totalFrames) {
          // Un pequeño respiro para capturar el último frame y cerrar.
          setTimeout(() => { try { recorder.stop(); } catch (e) { reject(e); } }, 120);
          return;
        }
        // Ritmo ~ real para que captureStream muestree bien.
        setTimeout(drawNext, 1000 / fps);
      };

      // arranque
      setTimeout(drawNext, 60);
    });
  }

  global.FlowRecorder = { record, pickMime };
})(window);
