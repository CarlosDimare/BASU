const express = require("express");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(express.json({ limit: "1mb" }));

const localBinName = process.platform === "win32" ? "opencode.cmd" : "opencode";
const LOCAL_BIN = path.resolve(__dirname, "node_modules", ".bin", localBinName);
const OPENCODE = fs.existsSync(LOCAL_BIN) ? LOCAL_BIN : "opencode";

const GH_OWNER = "CarlosDimare";
const GH_REPO = "BASU";
const MEM_PATH = "memoria.json";

const SYSTEM_PROMPT = `Sos un asistente de clase, breve como un telegrama y con el humor sutil de Les Luthiers.
- Respondé en español, máximo 3 oraciones. Si preguntan la hora, decila y nada más.
- Clase: sin vueltas, sin marketing, sin falsa amabilidad de manual.
- Humor: ironía fina, juegos de palabra, como si un integrante de Les Luthiers respondiera consultas técnicas.
- Sin relleno, sin disculpas, sin emojis. La brevedad es alma del ingenio.`;

async function ghGet(path) {
  const t = process.env.GITHUB_TOKEN;
  if (!t) return null;
  try {
    const r = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`,
      { headers: { Authorization: `token ${t}`, Accept: "application/vnd.github.v3.raw" } });
    if (!r.ok) return null;
    return r.text();
  } catch { return null; }
}

async function ghPut(path, content, msg) {
  const t = process.env.GITHUB_TOKEN;
  if (!t) return;
  try {
    const r = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`,
      { method: "PUT",
        headers: { Authorization: `token ${t}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg || "chatbot memory",
          content: Buffer.from(content).toString("base64") }) });
    if (!r.ok) console.error("ghPut error", await r.text());
  } catch (e) { console.error("ghPut", e.message); }
}

async function loadMemory() {
  const raw = await ghGet(MEM_PATH);
  if (!raw) return [];
  try { const d = JSON.parse(raw); return Array.isArray(d) ? d.slice(-30) : []; }
  catch { return []; }
}

async function saveExchange(userMsg, botMsg) {
  const hist = await loadMemory();
  hist.push({ u: userMsg, b: botMsg, ts: new Date().toISOString() });
  await ghPut(MEM_PATH, JSON.stringify(hist, null, 2), "memoria");
}

async function buildMessage(message, isNewSession, systemPrompt) {
  const now = new Date().toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires", dateStyle: "full", timeStyle: "short",
  });
  let hist = "";
  if (isNewSession) {
    const mem = await loadMemory();
    if (mem.length > 0) {
      hist = "\n\n[HISTORIAL RECIENTE]\n" + mem.map(e =>
        `usuario: ${e.u}\nasistente: ${e.b}`
      ).join("\n") + "\n";
    }
  }
  const base = isNewSession
    ? `[INSTRUCCIONES DEL SISTEMA]\n${systemPrompt}${hist}\n\nFecha y hora actual: ${now}`
    : `Fecha y hora actual: ${now}`;
  return `${base}\n\n${message}`;
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
  const userMsg = message.trim();
  const fullMessage = await buildMessage(userMsg, isNewSession, promptToUse);
  let botResponse = "";

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
          botResponse += event.part.text;
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
    } else if (botResponse.trim()) {
      saveExchange(userMsg, botResponse.trim());
    }
    res.write(sse({ type: "done" }));
    res.end();
  });

  res.on("close", () => { try { proc.kill(); } catch (e) {} });
});

app.post("/save", async (req, res) => {
  const { path, content, message } = req.body || {};
  if (!path || !content) return res.status(400).json({ error: "path y content requeridos" });
  if (!process.env.GITHUB_TOKEN) return res.status(500).json({ error: "GITHUB_TOKEN no configurado" });
  await ghPut(path, content, message || "chatbot save");
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 OpenCode Chatbot listo en http://localhost:${PORT}`);
  console.log(`   Usando bin: ${OPENCODE}`);
});
