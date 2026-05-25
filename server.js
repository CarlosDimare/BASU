const express = require("express");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(express.json({ limit: "1mb" }));

// Resolve opencode binary (works after npm install, cross platform)
const localBinName = process.platform === "win32" ? "opencode.cmd" : "opencode";
const LOCAL_BIN = path.resolve(__dirname, "node_modules", ".bin", localBinName);
const OPENCODE = fs.existsSync(LOCAL_BIN) ? LOCAL_BIN : "opencode";

const SYSTEM_PROMPT = `Sos un asistente de clase, breve como un telegrama y con el humor sutil de Les Luthiers.
- Respondé en español, máximo 3 oraciones. Si preguntan la hora, decila y nada más.
- Clase: sin vueltas, sin marketing, sin falsa amabilidad de manual.
- Humor: ironía fina, juegos de palabra, como si un integrante de Les Luthiers respondiera consultas técnicas.
- Sin relleno, sin disculpas, sin emojis. La brevedad es alma del ingenio.`;

function buildMessage(message, isNewSession, systemPrompt) {
  const now = new Date().toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    dateStyle: "full",
    timeStyle: "short",
  });
  if (isNewSession) {
    return `[INSTRUCCIONES DEL SISTEMA]\n${systemPrompt}\n\nFecha y hora actual: ${now}\n\n[PREGUNTA DEL USUARIO]\n${message}`;
  }
  return `[Fecha y hora actual: ${now}]\n\n${message}`;
}

function sse(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});
app.use("/manifest.json", (req, res) => res.sendFile(path.join(__dirname, "manifest.json")));
app.use("/sw.js", (req, res) => res.sendFile(path.join(__dirname, "sw.js")));
app.use("/icon.svg", (req, res) => res.sendFile(path.join(__dirname, "icon.svg")));

app.post("/chat", async (req, res) => {
  const { message, session_id, system_prompt } = req.body || {};
  if (!message || !message.trim()) {
    res.status(400).json({ error: "Mensaje vacío" });
    return;
  }

  const isNewSession = !session_id;
  const promptToUse = system_prompt || SYSTEM_PROMPT;
  const fullMessage = buildMessage(message.trim(), isNewSession, promptToUse);

  const args = ["run", "--format", "json"];
  if (session_id) args.push("--session", session_id);
  args.push(fullMessage);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let proc;
  try {
    proc = spawn(OPENCODE, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        OPENCODE_DISABLE_AUTOUPDATE: "1",
        OPENCODE_DISABLE_PRUNE: "1",
      },
    });
  } catch (err) {
    res.write(sse({ type: "error", message: "No se pudo iniciar opencode: " + String(err) }));
    res.end();
    return;
  }

  let stderrBuf = "";
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk) => {
    const lines = chunk.split("\n");
    for (let line of lines) {
      line = line.trim();
      if (!line) continue;
      try {
        const event = JSON.parse(line);
        if (event.sessionID) {
          res.write(sse({ type: "session", session_id: event.sessionID }));
        }
        if (event.type === "text" && event.part && event.part.text) {
          res.write(sse({ type: "text", text: event.part.text }));
        }
        if (event.type === "step_start") {
          res.write(sse({ type: "status", status: "..." }));
        }
      } catch (e) {
        // Not JSON or partial, ignore
      }
    }
  });

  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (d) => { stderrBuf += d; });

  proc.on("close", (code) => {
    if (code !== 0 && stderrBuf.includes("Session not found")) {
      res.write(sse({ type: "error", message: "SESSION_EXPIRED" }));
    } else if (code !== 0 && stderrBuf.trim()) {
      res.write(sse({ type: "error", message: stderrBuf.trim().slice(0, 200) }));
    }
    res.write(sse({ type: "done" }));
    res.end();
  });

  res.on("close", () => { try { proc.kill(); } catch (e) {} });
});

app.post("/save", async (req, res) => {
  const { path, content, message } = req.body || {};
  if (!path || !content) return res.status(400).json({ error: "path y content requeridos" });

  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ error: "GITHUB_TOKEN no configurado" });

  try {
    const r = await fetch(
      `https://api.github.com/repos/CarlosDimare/BASU/contents/${path}`,
      { method: "PUT",
        headers: { Authorization: `token ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: message || "chatbot update",
          content: Buffer.from(content).toString("base64") }) }
    );
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 OpenCode Chatbot listo en http://localhost:${PORT}`);
  console.log(`   Usando bin: ${OPENCODE}`);
});
