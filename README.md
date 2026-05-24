# OpenCode Chatbot

**Chatbot minimalista y simple** impulsado por [OpenCode AI](https://opencode.ai) como backend.

- ✅ Solo **4 archivos**
- ✅ Listo para subir a GitHub
- ✅ Despliegue instantáneo en **Railway** (un clic)
- ✅ Streaming en tiempo real
- ✅ Soporte de sesiones (contexto entre mensajes)
- ✅ Interfaz moderna y responsive (Tailwind + vanilla JS)

---

## 🚀 Despliegue en Railway (recomendado)

1. Haz fork o sube este repo a GitHub
2. Ve a [Railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Railway detecta `package.json` y ejecuta `npm install && npm start` automáticamente
4. **Obligatorio**: agrega las variables de entorno de tu proveedor de IA:

   | Variable                | Ejemplo                     | Proveedor recomendado      |
   |-------------------------|-----------------------------|----------------------------|
   | `ANTHROPIC_API_KEY`     | `sk-ant-...`                | Claude (mejor calidad)     |
   | `OPENAI_API_KEY`        | `sk-...`                    | GPT-4o / o3                |
   | `OPENCODE_API_KEY`      | (desde opencode.ai)         | OpenCode hosted (fácil)    |

5. ¡Listo! Tu chatbot estará vivo en < 30 segundos.

> **Nota**: La primera vez OpenCode puede tardar un poco mientras descarga modelos/LSP. Las siguientes son instantáneas.

---

## 💻 Uso local

```bash
npm install
npm start
```

Abre http://localhost:3000

---

## Cómo funciona

- `server.js` levanta un Express mínimo
- Al recibir un mensaje hace `spawn` del binario de `opencode-ai`
- Usa `opencode run --format json` + streaming de eventos
- El frontend (`index.html`) consume SSE y renderiza en vivo
- Las sesiones de OpenCode se mantienen en el filesystem del servidor (mientras el contenedor viva)

---

## Personalización

Edita en `server.js`:

```js
const SYSTEM_PROMPT = `...`
```

Cambia el prompt del sistema para darle la personalidad que quieras (periodista, programador, humor, etc).

---

## Estructura (mínima por diseño)

```
.
├── .gitignore
├── index.html      # UI completa (Tailwind CDN + JS)
├── package.json
├── README.md
└── server.js       # Backend Express + opencode spawn
```

Sin build, sin TypeScript, sin bases de datos, sin monorepo.

---

## Variables de entorno útiles

```env
PORT=3000
ANTHROPIC_API_KEY=...
OPENCODE_DISABLE_AUTOUPDATE=1
```

---

Hecho con ❤️ para tener algo **increíblemente simple** pero funcional usando el poder de OpenCode.

¿Quieres agregar historial persistente, autenticación o multi-usuario? Avísame y lo extendemos manteniendo la filosofía de pocos archivos.
