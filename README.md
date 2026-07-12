# FlowMotion 🎬 — AI Video Studio

Una página estilo **Google Flow** para **animar imágenes** y **generar videos a partir de prompts**, que funciona **100% en el navegador** y **sin dependencias externas** (no requiere `npm install` ni conexión a internet).

![status](https://img.shields.io/badge/deps-0-brightgreen) ![runtime](https://img.shields.io/badge/runtime-browser-blue)

---

## ✨ Qué hace

- Sube una imagen (o usa la de ejemplo generada por código).
- Escribe un **prompt** describiendo el movimiento y la atmósfera.
- FlowMotion interpreta el prompt y anima la imagen con efectos cinematográficos.
- **Previsualiza** en bucle en tiempo real.
- **Genera y descarga** un archivo de video real (`.webm`) con `MediaRecorder`.

### Efectos del motor local

| Categoría | Efectos |
|-----------|---------|
| Cámara | Ken Burns (zoom in/out), paneo, tilt, rotación sutil, camera shake (handheld) |
| Profundidad | Parallax por capas (fondo desenfocado + sujeto con máscara radial) |
| Atmósfera | Niebla animada, partículas (polvo/bokeh, nieve), lluvia, light leaks, bloom |
| Grading | Contraste, saturación, calidez/frialdad, viñeta, grano de película |
| Estilos | Cinemático, Onírico, Vívido, Noir B/N, Vintage |

---

## 🚀 Cómo ejecutarlo

No hay build. Solo necesitas servir la carpeta con cualquier servidor estático.

```bash
# Opción A: Python (incluido en la mayoría de sistemas)
python3 -m http.server 8000

# Opción B: Node
npx serve .    # (requiere red para instalar) — o cualquier server estático
```

Luego abre `http://localhost:8000` en Chrome, Edge o Firefox.

> **Nota:** funciona mejor servido por HTTP. Abrirlo con `file://` puede limitar algunas APIs del navegador.

---

## 🧠 Palabras clave del prompt

El parser (`prompt.js`) reconoce español e inglés. Ejemplos:

- Movimiento: `zoom in`, `zoom out`, `acercar`, `alejar`, `paneo izquierda/derecha`, `tilt arriba/abajo`, `rotar`, `parallax`, `cámara en mano`, `temblor`
- Atmósfera: `partículas`, `polvo`, `bokeh`, `nieve`, `lluvia`, `niebla`, `humo`, `light leak`, `destello`
- Ritmo: `lento`, `cinematográfico`, `rápido`, `dinámico`
- Color: `atardecer`, `cálido`, `dorado`, `noche`, `frío`, `azul`, `vibrante`, `onírico`

Ejemplo de prompt:
> `zoom lento cinematográfico, parallax con profundidad, partículas flotando, atardecer cálido, niebla suave`

---

## 🎥 Conectar un modelo de IA generativa real (opcional)

El sandbox de este proyecto **no tiene internet**, por eso el movimiento se sintetiza localmente. Cuando quieras usar un modelo real de *image-to-video* (Google **Veo**, **Runway**, **Replicate**, **Kling**, **Luma**), la arquitectura ya está lista.

> ⚠️ **Seguridad:** nunca pongas la API key en el frontend. Usa un backend/proxy con la clave en variables de entorno.

### 1. Activa el proveedor (consola del navegador)

```js
FlowAI.configure({
  enabled: true,
  provider: "replicate",              // "veo" | "runway" | "custom"
  endpoint: "https://tu-backend.com/generate",
});
```

### 2. Backend de ejemplo (Node/Express + Replicate)

```js
import express from "express";
const app = express();
app.use(express.json({ limit: "25mb" }));

app.post("/generate", async (req, res) => {
  const { prompt, image, duration } = req.body;
  const r = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.REPLICATE_API_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      version: "<MODEL_VERSION_ID>",          // p.ej. stable-video-diffusion
      input: { prompt, input_image: image, num_frames: duration * 25 },
    }),
  });
  const job = await r.json();
  res.json({ jobId: job.id });                 // el front hace polling a /status/:id
});

app.listen(3000);
```

Con esto, el botón **Generar video** enruta automáticamente al modelo real y, si falla, cae de vuelta al motor local.

---

## 📁 Estructura

```
index.html        Estructura y layout (3 paneles estilo Flow)
styles.css        Tema oscuro cinematográfico
prompt.js         Prompt → configuración de animación
engine.js         Motor de render en Canvas (efectos)
recorder.js       Exportación a video (MediaRecorder)
ai-provider.js    Integración opcional con IA real
app.js            Orquestación de la interfaz
```

---

## ⚠️ Limitaciones honestas

- El motor local **anima** una imagen (movimiento de cámara + efectos); **no inventa** contenido nuevo entre frames como lo hace un modelo generativo (Veo/Sora). Para eso, conecta un proveedor real (ver arriba).
- El formato de exportación es **WebM** (VP9/VP8). Para MP4/H.264 garantizado, usa un backend con `ffmpeg` o un navegador que soporte `video/mp4` en MediaRecorder.
- Requiere un navegador con `MediaRecorder` y `canvas.captureStream` (Chrome, Edge, Firefox).
