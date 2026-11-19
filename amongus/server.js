// Among Us klasversie: realtime server. Elke klas heeft één lobby; inloggen gebeurt met een ticket uit de Smartschool Reveal-database.
const express = require("express");
const http = require("http");
const crypto = require("crypto");
const path = require("path");
const { Server } = require("socket.io");
const M = require("./public/map.js");

const SECRET = process.env.AU_SECRET || "";
const PORT = process.env.PORT || 3000;
const app = express();
app.get("/health", (_q, r) => r.send("ok"));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "5m" }));
const srv = http.createServer(app);
const io = new Server(srv, { cors: { origin: "*" }, pingInterval: 10000, pingTimeout: 20000 });

/* ---------- ticket ---------- */
function verify(t) {
  if (!SECRET || typeof t !== "string" || !t.includes(".")) return null;
  const [body, sig] = t.split(".");
  const exp = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  const a = Buffer.from(sig || ""), b = Buffer.from(exp);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!p.u || !p.c || p.exp * 1000 < Date.now()) return null;
    return p;
  } catch { return null; }
}

/* ---------- spelregels ---------- */
const KILL_CD = 22000, SAB_CD = 30000, REACTOR_T = 45000, DISC_T = 30000, VOTE_T = 60000, EJECT_T = 7000, REVEAL_T = 5000;
const KILL_R = 120, USE_R = 120, REPORT_R = 160, VENT_R = 85, TABLE_R = 170;
const lobbies = new Map();
const now = () => Date.now();
const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, n);

function lobby(code, name) {
  let L = lobbies.get(code);
  if (!L) {
    L = { code, name, phase: "lobby", players: new Map(), host: null, chat: [], log: [], meeting: null, eject: null, sab: null, sabEnd: 0, sabAt: 0, until: 0, winner: null, splash: null, seq: 0 };
    lobbies.set(code, L);
  }
  return L;
}
const inGame = (L) => [...L.players.values()].filter((p) => p.inGame);
const alive = (L) => inGame(L).filter((p) => p.alive);
function freeColor(L) { const used = new Set([...L.players.values()].map((p) => p.color)); for (let i = 0; i < M.COLORS.length; i++) if (!used.has(i)) return i; return Math.floor(Math.random() * M.COLORS.length); }
function gather(L) {
  const ps = [...L.players.values()];
  ps.forEach((p, i) => { const a = (i / Math.max(ps.length, 1)) * Math.PI * 2; p.x = M.TABLE.x + Math.cos(a) * 130; p.y = M.TABLE.y + 30 + Math.sin(a) * 95; p.lastMove = now(); p.posT = now(); p.corr = (p.corr || 0) + 1; });
}
function say(L, text) { L.log.push(text); if (L.log.length > 30) L.log.shift(); }
function chat(L, p, body, sys) { L.chat.push({ id: ++L.seq, n: sys ? "" : p.name, c: sys ? -1 : p.color, b: body, m: L.phase === "meeting" ? L.meeting.no : 0, ghost: p && !p.alive && L.phase !== "lobby" && L.phase !== "over" }); if (L.chat.length > 80) L.chat.shift(); }

function start(L) {
  const ps = [...L.players.values()];
  const n = ps.length, k = n >= 9 ? 3 : n >= 7 ? 2 : 1;
  const order = ps.slice().sort(() => Math.random() - 0.5);
  const keys = Object.keys(M.TASKS);
  order.forEach((p, i) => {
    p.inGame = true; p.alive = true; p.role = i < k ? "imp" : "crew"; p.vote = null; p.body = null; p.meetings = 1; p.killAt = now() + 10000;
    p.tasks = keys.slice().sort(() => Math.random() - 0.5).slice(0, 5).map((id) => ({ id, done: false }));
  });
  L.chat = L.chat.filter(() => false); L.log = []; L.sab = null; L.sabAt = now() - SAB_CD + 12000; L.winner = null; L.meetingNo = 0; L.eject = null;
  gather(L);
  L.phase = "reveal"; L.until = now() + REVEAL_T; L.impCount = k;
  say(L, "🚀 Het schip vertrekt!");
}
function checkWin(L) {
  const g = inGame(L); if (!g.length) return null;
  const i = g.filter((p) => p.alive && p.role === "imp").length, c = g.filter((p) => p.alive && p.role === "crew").length;
  if (i === 0) return "crew";
  if (i >= c) return "imp";
  const t = g.filter((p) => p.role === "crew").flatMap((p) => p.tasks);
  if (t.length && t.every((x) => x.done)) return "crew";
  return null;
}
function over(L, w, why) { L.phase = "over"; L.winner = w; L.sab = null; L.why = why || ""; say(L, w === "crew" ? "🎉 De bemanning wint!" : "🔪 De verraders winnen!"); }
function meeting(L, caller, body) {
  L.meetingNo = (L.meetingNo || 0) + 1;
  L.meeting = { no: L.meetingNo, caller: caller.name, callerC: caller.color, body: body ? body.name : null, bodyC: body ? body.color : null, disc: now() + DISC_T + 2500, end: now() + DISC_T + VOTE_T + 2500 };
  L.sab = null; L.phase = "meeting";
  inGame(L).forEach((p) => { p.vote = null; });
  say(L, body ? `📣 ${caller.name} vond het lichaam van ${body.name}!` : `🚨 ${caller.name} drukte op de noodknop!`);
}
function resolveMeeting(L) {
  const al = alive(L), tally = new Map(); let skip = 0;
  al.forEach((p) => { if (p.vote === "skip" || !p.vote) { if (p.vote === "skip") skip++; return; } tally.set(p.vote, (tally.get(p.vote) || 0) + 1); });
  let max = 0, who = null, tie = false;
  for (const [u, c] of tally) { if (c > max) { max = c; who = u; tie = false; } else if (c === max) tie = true; }
  const votes = {}; al.forEach((p) => { if (p.vote) (votes[p.vote] = votes[p.vote] || []).push(p.color); });
  let ej = { skip: true, votes };
  if (who && !tie && max > skip) {
    const v = L.players.get(who);
    if (v) { v.alive = false; v.body = null; ej = { name: v.name, color: v.color, imp: v.role === "imp", votes }; say(L, `${v.name} is de ruimte in gestuurd.`); }
  } else say(L, "Niemand is de ruimte in gestuurd.");
  ej.left = inGame(L).filter((p) => p.alive && p.role === "imp").length;
  inGame(L).forEach((p) => { p.body = null; p.vote = null; p.killAt = now() + KILL_CD + EJECT_T; });
  gather(L);
  L.eject = ej; L.phase = "eject"; L.until = now() + EJECT_T; L.meeting = null;
}

/* ---------- lus ---------- */
setInterval(() => {
  for (const L of lobbies.values()) {
    const t = now();
    // weggevallen spelers
    for (const p of L.players.values()) if (!p.sock && t - p.goneAt > (L.phase === "lobby" || L.phase === "over" ? 8000 : 60000)) {
      L.players.delete(p.uid);
      if (L.phase !== "lobby" && L.phase !== "over" && p.inGame && p.alive) { p.alive = false; say(L, `🚪 ${p.name} heeft het schip verlaten.`); }
    }
    if (!L.players.size) { lobbies.delete(L.code); continue; }
    if (!L.players.has(L.host)) L.host = L.players.keys().next().value;
    if (L.phase === "reveal" && t >= L.until) L.phase = "play";
    if (L.phase === "play") {
      if (L.sab === "reactor" && t >= L.sabEnd) over(L, "imp", "De reactor is gesmolten!");
      else { const w = checkWin(L); if (w) over(L, w); }
    }
    if (L.phase === "meeting" && (t >= L.meeting.end || alive(L).every((p) => p.vote))) resolveMeeting(L);
    if (L.phase === "eject" && t >= L.until) { const w = checkWin(L); if (w) over(L, w); else L.phase = "play"; }
    snapshot(L);
  }
}, 66);

function snapshot(L) {
  const t = now();
  const all = [...L.players.values()];
  const g = inGame(L), crewTasks = g.filter((p) => p.role === "crew").flatMap((p) => p.tasks);
  const prog = crewTasks.length ? crewTasks.filter((x) => x.done).length / crewTasks.length : 0;
  for (const me of all) {
    if (!me.sock) continue;
    const playing = me.inGame && L.phase !== "lobby";
    const ghost = playing && !me.alive;
    const vis = !playing || ghost || L.phase !== "play" ? 1e9 : me.role === "imp" ? 430 : L.sab === "lights" ? 115 : 300;
    const pl = all.map((p) => {
      const see = p === me || L.phase === "lobby" || L.phase === "over" || (p.inGame === me.inGame && (p.alive || ghost) && Math.hypot(p.x - me.x, p.y - me.y) <= vis + 40);
      return {
        u: p.uid, n: p.name, c: p.color, h: p.uid === L.host, g: p.inGame, a: p.alive !== false,
        x: see ? Math.round(p.x) : null, y: see ? Math.round(p.y) : null, f: p.f || 1, w: see && t - (p.lastMove || 0) < 150,
        imp: L.phase === "over" || (playing && me.role === "imp" && p.role === "imp") || undefined,
        v: L.phase === "meeting" && p.alive ? !!p.vote : undefined,
        vent: p.venting || undefined,
      };
    });
    const bodies = L.phase === "play" ? g.filter((p) => p.body && Math.hypot(p.body.x - me.x, p.body.y - me.y) <= vis + 40).map((p) => ({ x: p.body.x, y: p.body.y, c: p.color, n: p.name })) : [];
    me.sock.volatile.emit("s", {
      ph: L.phase, cls: L.name, host: L.host === me.uid, n: all.length, vis, prog, sab: L.sab, sabLeft: L.sab === "reactor" ? Math.max(0, Math.ceil((L.sabEnd - t) / 1000)) : null,
      sabIn: Math.max(0, Math.ceil((L.sabAt + SAB_CD - t) / 1000)), left: L.until ? Math.max(0, Math.ceil((L.until - t) / 1000)) : 0,
      me: { u: me.uid, x: me.x, y: me.y, c: me.color, role: playing ? me.role : null, alive: me.alive !== false, inGame: !!me.inGame, tasks: playing && me.role === "crew" ? me.tasks : [], kill: Math.max(0, Math.ceil((me.killAt - t) / 1000)), meet: me.meetings, vote: me.vote, corr: me.corr || 0 },
      pl, bodies, winner: L.winner, why: L.why, eject: L.phase === "eject" ? L.eject : null, impCount: L.impCount,
      mt: L.meeting ? { ...L.meeting, disc: Math.max(0, Math.ceil((L.meeting.disc - t) / 1000)), end: Math.max(0, Math.ceil((L.meeting.end - t) / 1000)) } : null,
      chat: L.chat.filter((c) => (L.phase === "meeting" ? c.m === L.meeting.no : c.m === 0) && (!c.ghost || ghost || L.phase === "lobby" || L.phase === "over")).slice(-40),
      log: L.log.slice(-6),
    });
  }
}

/* ---------- verbindingen ---------- */
io.on("connection", (sock) => {
  const tk = verify(sock.handshake.auth?.t);
  if (!tk) { sock.emit("fatal", "Je ticket is ongeldig of verlopen. Open het spel opnieuw vanuit de extensie."); return sock.disconnect(true); }
  const L = lobby(tk.c, clean(tk.cn || tk.c, 40));
  let p = L.players.get(tk.u);
  if (p) { if (p.sock && p.sock !== sock) { p.sock.emit("fatal", "Je speelt al in een ander venster."); p.sock.disconnect(true); } }
  else {
    p = { uid: tk.u, name: clean(tk.n, 20) || "Speler", color: freeColor(L), x: M.TABLE.x, y: M.TABLE.y + 120, f: 1, inGame: false, alive: true, tasks: [], meetings: 1, killAt: 0 };
    if (L.phase === "lobby") { gather(L); }
    L.players.set(p.uid, p);
    if (!L.host) L.host = p.uid;
    if (L.phase === "lobby") chat(L, null, `${p.name} is binnengekomen.`, true);
  }
  p.sock = sock; p.goneAt = 0; p.posT = now();
  const ctx = () => ({ playing: p.inGame && L.phase === "play" });

  sock.on("mv", (d) => {
    if (!d || typeof d.x !== "number" || typeof d.y !== "number") return;
    const free = L.phase === "lobby" || L.phase === "over" || (L.phase === "play" && p.inGame);
    if (!free || (!p.inGame && L.phase !== "lobby" && L.phase !== "over")) return;
    const t = now(), dt = Math.min(1, (t - (p.posT || t)) / 1000);
    const ghost = p.inGame && !p.alive && L.phase === "play";
    const ok = Math.hypot(d.x - p.x, d.y - p.y) <= M.SPEED * (ghost ? 1.3 : 1) * dt * 1.6 + 25 && d.x >= 0 && d.x <= M.W && d.y >= 0 && d.y <= M.H && (ghost || M.walkable(d.x, d.y));
    if (ok) { if (Math.hypot(d.x - p.x, d.y - p.y) > 0.5) p.lastMove = t; p.x = d.x; p.y = d.y; p.f = d.f < 0 ? -1 : 1; p.posT = t; }
    else { p.posT = t; p.corr = (p.corr || 0) + 1; }
  });
  sock.on("color", (c) => { if (L.phase !== "lobby" && L.phase !== "over") return; c = +c; if (!(c >= 0 && c < M.COLORS.length)) return; if ([...L.players.values()].some((q) => q !== p && q.color === c)) return; p.color = c; });
  sock.on("start", () => {
    if (L.host !== p.uid || (L.phase !== "lobby" && L.phase !== "over")) return;
    if (L.players.size < 4) return sock.emit("toast", "Je hebt minstens 4 spelers nodig.");
    start(L);
  });
  sock.on("lobby", () => { if (L.host !== p.uid || L.phase !== "over") return; L.phase = "lobby"; L.players.forEach((q) => { q.inGame = false; q.alive = true; q.role = null; }); gather(L); L.chat = []; });
  sock.on("task", (id) => {
    if (!ctx().playing || p.role !== "crew") return;
    const tk2 = M.TASKS[id], my = p.tasks.find((x) => x.id === id);
    if (!tk2 || !my || Math.hypot(p.x - tk2.x, p.y - tk2.y) > USE_R + 30) return;
    my.done = true;
  });
  sock.on("kill", () => {
    if (!ctx().playing || p.role !== "imp" || !p.alive || now() < p.killAt) return;
    const v = alive(L).filter((q) => q.role === "crew" && Math.hypot(q.x - p.x, q.y - p.y) <= KILL_R).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
    if (!v) return;
    v.alive = false; v.body = { x: v.x, y: v.y }; p.x = v.x; p.y = v.y; p.killAt = now() + KILL_CD; p.corr = (p.corr || 0) + 1;
    v.sock?.emit("killed", { c: p.color });
  });
  sock.on("report", () => {
    if (!ctx().playing || !p.alive) return;
    const b = inGame(L).find((q) => q.body && Math.hypot(q.body.x - p.x, q.body.y - p.y) <= REPORT_R);
    if (b) meeting(L, p, b);
  });
  sock.on("emergency", () => {
    if (!ctx().playing || !p.alive || p.meetings <= 0 || L.sab) return;
    if (Math.hypot(p.x - M.TABLE.x, p.y - M.TABLE.y) > TABLE_R) return;
    p.meetings--; meeting(L, p, null);
  });
  sock.on("vent", () => {
    if (!ctx().playing || p.role !== "imp" || !p.alive) return;
    const k = Object.keys(M.VENTS).find((k2) => Math.hypot(M.VENTS[k2].x - p.x, M.VENTS[k2].y - p.y) <= VENT_R);
    if (!k) return;
    const to = M.VENTS[M.VENTS[k].to];
    p.x = to.x; p.y = to.y + 34; p.posT = now(); p.corr = (p.corr || 0) + 1;
  });
  sock.on("sab", (kind) => {
    if (!ctx().playing || p.role !== "imp" || !p.alive || L.sab || now() < L.sabAt + SAB_CD) return;
    if (kind !== "reactor" && kind !== "lights") return;
    L.sab = kind; L.sabAt = now(); L.sabEnd = now() + REACTOR_T;
  });
  sock.on("fix", () => {
    if (!ctx().playing || !p.alive || !L.sab) return;
    const f = M.FIX[L.sab];
    if (Math.hypot(p.x - f.x, p.y - f.y) <= USE_R + 30) { L.sab = null; L.sabAt = Math.max(L.sabAt, now() - SAB_CD + 10000); }
  });
  sock.on("vote", (u) => {
    if (L.phase !== "meeting" || !p.inGame || !p.alive || p.vote || now() < L.meeting.disc) return;
    if (u === "skip" || (L.players.get(u)?.alive && L.players.get(u)?.inGame)) p.vote = u;
  });
  sock.on("chat", (b) => {
    b = clean(b, 160); if (!b) return;
    if (L.phase === "play" || L.phase === "reveal" || L.phase === "eject") return;
    if (L.phase === "meeting" && (!p.inGame || !p.alive)) return;
    const t = now(); p.chatT = (p.chatT || []).filter((x) => t - x < 8000); if (p.chatT.length >= 5) return; p.chatT.push(t);
    chat(L, p, b);
  });
  sock.on("disconnect", () => { if (p.sock === sock) { p.sock = null; p.goneAt = now(); } });
});

srv.listen(PORT, () => console.log("Among Us klasversie op poort " + PORT));
