/* ============================================================
   ai-provider.js — Punto de integración con IA de video REAL
   ------------------------------------------------------------
   El motor local (engine.js) anima la imagen sin red. Cuando
   tengas acceso a internet + una API key, puedes enrutar la
   generación a un modelo real (Google Veo, Runway, Replicate,
   Kling, Luma...) implementando `generateWithAI` más abajo.

   IMPORTANTE (seguridad): NUNCA pongas claves API en el
   frontend en producción. Usa un backend/proxy que guarde la
   clave como variable de entorno. Aquí se muestra el contrato
   y un ejemplo de llamada a un backend propio.
   ============================================================ */
(function (global) {
  "use strict";

  const state = {
    enabled: false,
    provider: "local",   // 'local' | 'replicate' | 'veo' | 'runway' | 'custom'
    endpoint: "",        // URL de TU backend proxy (no la API directa)
  };

  function configure(cfg) { Object.assign(state, cfg); }
  function isEnabled() { return state.enabled && state.provider !== "local"; }
  function getState() { return Object.assign({}, state); }

  /**
   * Genera un video con un modelo de IA real a través de TU backend.
   * @param {object} params { prompt, imageDataUrl, duration, aspect, style }
   * @param {function} onProgress (0..1, statusText)
   * @returns {Promise<{url, blob?, provider}>}
   *
   * El backend debe:
   *   1. Recibir { prompt, image, duration, aspect }.
   *   2. Llamar al proveedor (image-to-video) con la API key del servidor.
   *   3. Hacer polling del job hasta completar.
   *   4. Devolver { videoUrl } (o el binario del video).
   */
  async function generateWithAI(params, onProgress) {
    if (!isEnabled()) throw new Error("Proveedor de IA no configurado. Usando motor local.");
    onProgress && onProgress(0.05, "Enviando solicitud al backend…");

    const res = await fetch(state.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: state.provider,
        prompt: params.prompt,
        image: params.imageDataUrl, // el backend la sube al proveedor
        duration: params.duration,
        aspect: params.aspect,
        style: params.style,
      }),
    });
    if (!res.ok) throw new Error("El backend devolvió " + res.status);

    // Ejemplo de polling si el backend expone { jobId } y /status
    const data = await res.json();
    if (data.videoUrl) {
      onProgress && onProgress(1, "Listo");
      return { url: data.videoUrl, provider: state.provider };
    }
    if (data.jobId) {
      return await pollJob(data.jobId, onProgress);
    }
    throw new Error("Respuesta inesperada del backend.");
  }

  async function pollJob(jobId, onProgress) {
    const statusUrl = state.endpoint.replace(/\/generate$/, "") + "/status/" + jobId;
    for (let i = 0; i < 120; i++) {
      await sleep(2500);
      const r = await fetch(statusUrl);
      const s = await r.json();
      onProgress && onProgress(Math.min(0.95, 0.1 + i * 0.02), s.status || "Procesando…");
      if (s.status === "succeeded" && s.videoUrl) {
        onProgress && onProgress(1, "Listo");
        return { url: s.videoUrl, provider: state.provider };
      }
      if (s.status === "failed") throw new Error("La generación falló en el proveedor.");
    }
    throw new Error("Tiempo de espera agotado.");
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /* ---------------------------------------------------------
     EJEMPLO de backend (Node/Express) para Replicate — pégalo
     en tu servidor. Requiere REPLICATE_API_TOKEN en el entorno.
     Documentado aquí como referencia; NO se ejecuta en el front.
     ---------------------------------------------------------
     app.post("/generate", async (req, res) => {
       const { prompt, image, duration } = req.body;
       const r = await fetch("https://api.replicate.com/v1/predictions", {
         method: "POST",
         headers: {
           Authorization: "Bearer " + process.env.REPLICATE_API_TOKEN,
           "Content-Type": "application/json",
         },
         body: JSON.stringify({
           // Modelo image-to-video, p.ej. stable-video-diffusion o kling
           version: "<MODEL_VERSION_ID>",
           input: { prompt, input_image: image, num_frames: duration * 25 },
         }),
       });
       const job = await r.json();
       res.json({ jobId: job.id });
     });
     --------------------------------------------------------- */

  global.FlowAI = { configure, isEnabled, getState, generateWithAI };
})(window);
