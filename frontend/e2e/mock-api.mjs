// Tiny stand-in for the real backend + image CDN, used ONLY by the offline end-to-end test.
//   node mock-api.mjs 4000   -> fake /api/v1 (exams, a pack, one timed mock, attempt start/answers/submit)
//   node mock-api.mjs 4001   -> fake image CDN (CORS enabled, like cdn.sscprephub.in should be)
// It is a REAL HTTP server (not page.route) on purpose: the service worker's own requests must hit a real network
// that can then be cut with context.setOffline(true), exactly like a phone losing signal.
import http from "node:http";

const PORT = Number(process.argv[2] || 4000);
const CDN = "http://127.0.0.1:4001";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

const PACK_Q = Array.from({ length: 10 }, (_, i) => ({
  id: `q${i}`,
  questionText: `Pack question ${i}?`,
  options: ["A", "B", "C", "D"].map((k) => ({ key: k, text: `Option ${k}` })),
  correctAnswer: "A",
  explanation: "Because A.",
  questionImageUrl: i < 2 ? `${CDN}/img/q${i}.png` : null,
}));
const PAPER = {
  title: "Mock 1",
  durationMinutes: 30,
  sections: [
    {
      name: "Maths",
      questions: Array.from({ length: 5 }, (_, i) => ({
        id: `m${i}`,
        questionNo: i + 1,
        questionText: `Mock question ${i}?`,
        options: ["A", "B", "C", "D"].map((k) => ({ key: k, text: `Opt ${k}` })),
        marks: 2,
        negativeMarks: 0.5,
      })),
    },
  ],
};
const LOG = [];

function send(res, code, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  res.writeHead(code, { "Content-Length": buf.length, ...headers });
  res.end(buf);
}

http
  .createServer((req, res) => {
    const cors = {
      "Access-Control-Allow-Origin": req.headers.origin || "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    };
    const json = { ...cors, "Content-Type": "application/json" };
    const path = (req.url || "").split("?")[0];
    if (req.method === "OPTIONS") return send(res, 204, "", cors);

    if (path.startsWith("/img/")) return send(res, 200, PNG, { ...cors, "Content-Type": "image/png" });
    if (path.endsWith("/_log")) return send(res, 200, LOG, json);
    if (path.endsWith("/_reset")) {
      LOG.length = 0;
      return send(res, 200, { ok: true }, json);
    }

    if (req.method === "GET") {
      if (path.endsWith("/bank/meta")) return send(res, 200, { exams: [{ id: "e1", name: "SSC CGL", count: 50 }], subjects: [{ id: "s1", name: "Maths", count: 50 }] }, json);
      if (path.endsWith("/bank/set")) return send(res, 200, { questions: PACK_Q }, json);
      if (path.endsWith("/api/v1/tests")) return send(res, 200, [{ id: "T1", title: "Mock 1", durationMinutes: 30, totalQuestions: 5, totalMarks: 10 }], json);
      if (path.includes("/tests/paper/")) return send(res, 200, PAPER, json);
      if (path.includes("/tests/pattern/")) return send(res, 200, {}, json);
      if (path.endsWith("/remaining")) return send(res, 200, { serverNow: Date.now(), remainingSeconds: 1700 }, json);
      return send(res, 200, {}, json);
    }

    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString();
      LOG.push({ m: req.method, p: path, b: raw.slice(0, 4000) });
      if (path.endsWith("/attempts/start")) {
        const now = Date.now();
        return send(res, 200, { id: "att1", serverNow: now, startedAt: new Date(now).toISOString(), expiresAt: new Date(now + 1800000).toISOString(), answers: [] }, json);
      }
      return send(res, 200, { ok: true }, json);
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`mock ${PORT} ready`));
