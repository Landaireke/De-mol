// Among Us class edition – browser
(() => {
  const M = window.AUMAP, { drawSperm, drawBody } = window.SPR;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cv = $("#cv"), ctx = cv.getContext("2d");

  /* ---------- ticket ---------- */
  let ticket = (location.hash.match(/t=([^&]+)/) || [])[1];
  if (ticket) { ticket = decodeURIComponent(ticket); try { sessionStorage.setItem("au_t", ticket); } catch {} history.replaceState(null, "", location.pathname); }
  else { try { ticket = sessionStorage.getItem("au_t"); } catch {} }
  function fatal(t) { $("#fatalTxt").textContent = t; $("#fatal").classList.remove("hidden"); }
  if (!ticket) { fatal("Open Among Us from the Smartschool Reveal extension (Games → 🚀 Among Us)."); return; }

  const sock = io({ auth: { t: ticket }, transports: ["websocket", "polling"] });
  sock.on("fatal", fatal);
  sock.on("connect_error", () => toast("Connecting…"));
  sock.on("toast", toast);

  /* ---------- toestand ---------- */
  let S = null, prevPh = null, corr = -1, ejShown = null;
  const me = { x: M.TABLE.x, y: M.TABLE.y + 100, f: 1, walk: false };
  const others = new Map();
  let overlay = null; // "task" | "map" | "chat"? (chat blokkeert beweging alleen als het invoerveld focus heeft)
  let lastSend = 0, chatSeen = 0;

  sock.on("s", (s) => {
    const ph = s.ph;
    if (s.me.corr !== corr) { corr = s.me.corr; me.x = s.me.x; me.y = s.me.y; }
    for (const p of s.pl) {
      if (p.me || p.u === s.me.u) continue;
      let o = others.get(p.u);
      if (!o) { o = { x: p.x, y: p.y }; others.set(p.u, o); }
      o.tx = p.x; o.ty = p.y; o.f = p.f; o.w = p.w; o.p = p;
      if (p.x == null) o.x = null; else if (o.x == null) { o.x = p.x; o.y = p.y; }
    }
    for (const u of others.keys()) if (!s.pl.some((p) => p.u === u)) others.delete(u);
    const old = S; S = s;
    if (ph !== prevPh) onPhase(prevPh, ph, old);
    prevPh = ph;
    hud();
  });
  sock.on("killed", (d) => { closeTask(); splash(`<div id="kWrap"></div><div class="slam" style="font-size:clamp(28px,6vw,64px)">YOU WERE KILLED</div><p class="sub">You are a ghost now. Finish your tasks to help your crew!</p>`, "killed", 3200, () => FX.killAnim($("#kWrap"), M.COLORS[d.k], M.COLORS[d.v])); });
  sock.on("kills", (d) => { splash(`<div id="kWrap"></div>`, "killed", 1700, () => FX.killAnim($("#kWrap"), M.COLORS[d.k], M.COLORS[d.v])); });

  function onPhase(a, b, old) {
    closeTask();
    if (b === "reveal") {
      const imp = S.me.role === "imp";
      const team = S.pl.filter((p) => p.g && (imp ? p.imp : true));
      splash(`<p>${imp ? "" : `There ${S.impCount > 1 ? "are" : "is"} <b style="color:#ff3b4e">${S.impCount} Impostor${S.impCount > 1 ? "s" : ""}</b> among us`}</p><h1>${imp ? "IMPOSTOR" : "CREWMATE"}</h1><p class="sub">${imp ? "Kill the crew without getting caught." : "Finish your tasks and find the Impostor."}</p>
        <div class="row">${team.map((p, i) => `<div class="bounce" style="animation-delay:${0.3 + i * 0.12}s"><canvas class="rv" data-c="${p.c}" width="110" height="110"></canvas><div>${esc(p.n)}</div></div>`).join("")}</div>`, imp ? "imp" : "crew", 4800, () => (FX.sfx.reveal(), document.querySelectorAll(".rv")).forEach((c) => fig(c, +c.dataset.c)));
    }
    if (b === "meeting" && S.mt) {
      const body = !!S.mt.body;
      splash(body
        ? `<div class="sp-rays"></div><canvas id="spM" width="260" height="170"></canvas><div class="slam">DEAD BODY REPORTED</div><p class="sub">${esc(S.mt.caller)} found ${esc(S.mt.body)}</p>`
        : `<div class="sp-beams"></div><div class="slam">EMERGENCY MEETING!</div><canvas id="spM" width="240" height="170"></canvas><p class="sub">📣 ${esc(S.mt.caller)} pressed the button</p>`,
        "alarmsp", 2600, () => { body ? FX.sfx.body() : FX.sfx.alarm(); fig("#spM", body ? S.mt.bodyC : S.mt.callerC, { dead: body }); });
      voteSel = null; meetChatOpen = false; $("#mChatPanel").classList.add("hidden");
    }
    if (b === "eject" && S.eject) { FX.sfx.eject(); showEject(S.eject); }
    if (b === "over") {
      const won = S.winner === (S.me.role === "imp" ? "imp" : "crew");
      if (S.me.inGame) (won ? FX.sfx.win : FX.sfx.lose)();
      const winners = S.pl.filter((p) => p.g && (S.winner === "imp" ? p.imp : !p.imp));
      splash(`<h1 style="color:${won ? "#6cf" : "#ff3b4e"}">${S.me.inGame ? (won ? "VICTORY" : "DEFEAT") : "GAME OVER"}</h1><p>${S.winner === "imp" ? "Impostors win" : "Crewmates win"}${S.why ? ` · ${esc(S.why)}` : ""}</p>
        <div class="row">${winners.map((p) => `<div><canvas class="rv" data-c="${p.c}" width="110" height="110"></canvas><div>${esc(p.n)}</div></div>`).join("")}</div>
        <div class="btnrow" id="overBtns"></div>`, "", 0, () => { document.querySelectorAll(".rv").forEach((c) => fig(c, +c.dataset.c)); overButtons(); });
    }
    if (b === "lobby") closeSplash();
  }
  function overButtons() {
    const b = $("#overBtns"); if (!b || !S) return;
    b.innerHTML = S.host ? `<button class="btn2" id="oAgain">🔁 Play again</button><button class="btn2" id="oLobby">Back to lobby</button>` : `<small>Waiting for the host…</small><button class="btn2" id="oClose">Close</button>`;
    $("#oAgain")?.addEventListener("click", () => sock.emit("start"));
    $("#oLobby")?.addEventListener("click", () => sock.emit("lobby"));
    $("#oClose")?.addEventListener("click", closeSplash);
  }

  /* ---------- schermen ---------- */
  let splashT = null;
  function splash(html, cls, ms, after) {
    clearTimeout(splashT);
    const el = $("#splash"); el.className = "ov splash " + (cls || ""); el.innerHTML = html; el.classList.remove("hidden");
    after && after();
    if (ms) splashT = setTimeout(closeSplash, ms);
  }
  function closeSplash() { clearTimeout(splashT); $("#splash").classList.add("hidden"); $("#splash").innerHTML = ""; }
  function fig(sel, c, opt = {}) {
    const el = typeof sel === "string" ? $(sel) : sel; if (!el) return;
    const c2 = el.getContext("2d"), t0 = performance.now();
    const loop = () => {
      if (!el.isConnected) return;
      c2.clearRect(0, 0, el.width, el.height);
      const s = Math.min(el.width / 110, el.height / 70);
      if (opt.dead) drawBody(c2, el.width / 2, el.height * 0.6, M.COLORS[c], 0);
      else drawSperm(c2, el.width / 2 + 20 * s, el.height * 0.82, M.COLORS[c], 1, (performance.now() - t0) / 1000, true, { scale: s });
      requestAnimationFrame(loop);
    };
    loop();
  }
  function showEject(e) {
    const txt = e.skip ? "No one was ejected. (Skipped)" : `${e.name} was ${e.imp ? "" : "not "}an Impostor.`;
    const sub = `${e.left} Impostor${e.left === 1 ? "" : "s"} remain${e.left === 1 ? "s" : ""}.`;
    let stars = ""; for (let i = 0; i < 70; i++) stars += `<i style="top:${Math.random() * 100}%;left:${Math.random() * 110}%;animation-duration:${2 + Math.random() * 4}s;opacity:${0.3 + Math.random() * 0.7}"></i>`;
    splash(`<div class="stars">${stars}</div>${e.skip ? "" : `<canvas class="ejectfig" id="spE" width="140" height="110"></canvas>`}<div class="ejecttxt" id="ejT"></div><p style="position:relative;z-index:2;color:#bbb" id="ejS"></p>`, "", 6800, () => {
      if (!e.skip) fig("#spE", e.color);
      let i = 0; const it = setInterval(() => { const el = $("#ejT"); if (!el) return clearInterval(it); el.textContent = txt.slice(0, ++i); if (i >= txt.length) { clearInterval(it); setTimeout(() => { const s2 = $("#ejS"); if (s2) s2.textContent = sub; }, 500); } }, 55);
    });
  }
  let toastT = null;
  function toast(t) { const el = $("#msg"); el.textContent = t; el.classList.remove("hidden"); clearTimeout(toastT); toastT = setTimeout(() => el.classList.add("hidden"), 2500); }

  /* ---------- HUD ---------- */
  const playing = () => S && S.me.inGame && (S.ph === "play");
  const near = (p, r) => Math.hypot(p.x - me.x, p.y - me.y) <= r;
  function myTaskHere() { if (!S || S.me.role !== "crew") return null; return S.me.tasks.find((t) => !t.done && near(M.TASKS[t.id], 110)); }
  function useTarget() {
    if (!playing()) return null;
    const t = myTaskHere(); if (t) return { k: "task", id: t.id };
    if (S.me.alive && S.sab && near(M.FIX[S.sab], 120)) return { k: "fix" };
    if (S.me.alive && !S.sab && S.me.meet > 0 && near(M.TABLE, 150)) return { k: "emergency" };
    return null;
  }
  const bodyNear = () => playing() && S.me.alive && S.bodies.some((b) => near(b, 150));
  const killTarget = () => playing() && S.me.role === "imp" && S.me.alive ? [...others.values()].filter((o) => o.p && o.p.g && o.p.a && !o.p.imp && o.x != null && near(o, 110)).sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0] : null;
  const ventNear = () => playing() && S.me.role === "imp" && S.me.alive && Object.values(M.VENTS).some((v) => near(v, 80));

  function hud() {
    const s = S, ph = s.ph, inPlay = s.me.inGame && (ph === "play" || ph === "reveal" || ph === "eject");
    $("#top").classList.toggle("hidden", !inPlay);
    $("#prog").style.width = Math.round(s.prog * 100) + "%";
    if (inPlay) {
      $("#tasks").innerHTML = s.me.role === "imp"
        ? `<div class="imp">🔪 Sabotage and kill everyone. Fake tasks:</div>` + ["Fix Wiring", "Submit Scan", "Fuel Engines"].map((t) => `<div class="imp">${t}</div>`).join("")
        : s.me.tasks.map((t) => `<div class="${t.done ? "done" : ""}">${M.ROOMS[t.id].n}: ${M.TASKS[t.id].n}${t.done ? " ✓" : ""}</div>`).join("") + (s.me.alive ? "" : `<div style="color:#9cf">👻 You are dead. Finish your tasks to help your crew!</div>`);
    }
    const lob = ph === "lobby" || (ph !== "over" && !s.me.inGame);
    $("#lobbyBar").classList.toggle("hidden", !lob);
    if (lob) {
      $("#lbTitle").textContent = ph === "lobby" ? "Lobby" : "Game in progress";
      $("#lbSub").textContent = `Class ${s.cls} · ${s.n} player${s.n === 1 ? "" : "s"}`;
      const taken = new Set(s.pl.filter((p) => p.u !== s.me.u).map((p) => p.c));
      if (ph === "lobby") {
        const sig = s.me.c + "|" + [...taken].join();
        if ($("#colors").dataset.sig !== sig) { $("#colors").dataset.sig = sig; $("#colors").innerHTML = M.COLORS.map((c, i) => `<button style="background:${c}" data-col="${i}" class="${i === s.me.c ? "on" : ""} ${taken.has(i) ? "taken" : ""}" title="${M.COLOR_N[i]}"></button>`).join(""); }
      } else $("#colors").innerHTML = "";
      $("#bStart").classList.toggle("hidden", !(s.host && ph === "lobby"));
      $("#bStart").disabled = s.n < 4;
      $("#lbHint").textContent = ph !== "lobby" ? "A game is in progress. You will join the next round." : s.host ? (s.n < 4 ? `${4 - s.n} more player${4 - s.n === 1 ? "" : "s"} needed.` : "Everyone ready? Press START.") : "Waiting for the host to start…";
    }
    const chatOk = ph === "lobby" || ph === "over" || !s.me.inGame;
    $("#bChat").classList.toggle("hidden", !chatOk);
    if (!chatOk) $("#chat").classList.add("hidden");
    $("#bMap").classList.toggle("hidden", !inPlay);
    // alarm
    const al = $("#alarm");
    if (ph === "play" && s.sab) { al.classList.remove("hidden"); al.textContent = s.sab === "reactor" ? `☢️ REACTOR MELTDOWN in ${s.sabLeft}s · fix it in Reactor` : "💡 LIGHTS ARE OFF · fix them in Electrical"; }
    else al.classList.add("hidden");
    document.body.classList.toggle("redalert", ph === "play" && s.sab === "reactor");
    // knoppen
    const acts = ph === "play" && s.me.inGame;
    $("#acts").classList.toggle("hidden", !acts);
    if (acts) {
      const imp = s.me.role === "imp" && s.me.alive;
      ["#aSab", "#aVent", "#aKill"].forEach((id) => $(id).classList.toggle("hidden", !imp));
      $("#aUse").disabled = !useTarget();
      $("#aReport").disabled = !bodyNear();
      $("#aReport").classList.toggle("hidden", !s.me.alive);
      if (imp) {
        $("#aKill").disabled = s.me.kill > 0 || !killTarget();
        $("#killCd").textContent = s.me.kill > 0 ? s.me.kill : "";
        $("#aVent").disabled = !ventNear();
        $("#aSab").disabled = !!s.sab || s.sabIn > 0;
        $("#aSab").querySelector("span").textContent = s.sabIn > 0 && !s.sab ? `SABOTAGE ${s.sabIn}` : "SABOTAGE";
      }
    } else $("#sabMenu").classList.add("hidden");
    // chat
    const list = s.chat;
    const inMeet = ph === "meeting" || ph === "results";
    if (inMeet) meetingUI(); else $("#meet").classList.add("hidden");
    renderChat(inMeet ? $("#mChat") : $("#chatList"), list);
    const lid = list.length ? list[list.length - 1].id : 0;
    if (inMeet) { if (lid > meetSeen) { if (meetSeen && list[list.length - 1].u !== s.me.u) FX.sfx.chat(); if (!meetChatOpen) $("#mChatDot").classList.remove("hidden"); else meetSeen = lid; } if (meetChatOpen) meetSeen = lid; }
    const lastId = list.length ? list[list.length - 1].id : 0;
    if ($("#chat").classList.contains("hidden") && lastId > chatSeen && !inMeet) $("#chatDot").classList.remove("hidden");
    if (!$("#chat").classList.contains("hidden") || inMeet) { chatSeen = lastId; $("#chatDot").classList.add("hidden"); }
    $("#stick").classList.toggle("hidden", !("ontouchstart" in window) || !(ph === "lobby" || ph === "play" || ph === "over"));
  }
  function renderChat(box, list) {
    const sig = list.map((c) => c.id).join();
    if (box.dataset.sig === sig) return; box.dataset.sig = sig;
    const atB = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    box.innerHTML = list.map((c) => c.c < 0 ? `<div class="cm sys"><div>${esc(c.b)}</div></div>` : `<div class="cm ${c.ghost ? "ghost" : ""} ${S && c.u === S.me.u ? "mine" : ""}"><canvas width="34" height="34" data-c="${c.c}"></canvas><div><b style="color:${M.COLORS[c.c]};text-shadow:0 0 1px #000">${esc(c.n)}</b>${esc(c.b)}</div></div>`).join("") || `<div class="cm sys"><div>No messages yet.</div></div>`;
    box.querySelectorAll("canvas[data-c]").forEach((c) => { const x = c.getContext("2d"); drawSperm(x, 24, 32, M.COLORS[+c.dataset.c], 1, 0, false, { scale: 0.55 }); });
    if (atB || true) box.scrollTop = box.scrollHeight;
  }

  /* ---------- meeting ---------- */
  let voteSel = null, meetChatOpen = false, meetSeen = 0, lastTick = -1, prevDisc = 0;
  function meetingUI() {
    const s = S, mt = s.mt; if (!mt) return;
    $("#meet").classList.remove("hidden");
    const res = s.ph === "results" ? s.res : null;
    const canVote = !res && s.me.inGame && s.me.alive && !s.me.vote && mt.disc === 0;
    if (prevDisc > 0 && mt.disc === 0 && meetChatOpen) setMeetChat(false); // voting starts: show the plates
    prevDisc = mt.disc;
    const secs = res ? s.left : mt.disc > 0 ? mt.disc : mt.end;
    $("#mTimer").textContent = res ? `Proceeding in: ${s.left}s` : mt.disc > 0 ? `Voting begins in: ${mt.disc}s` : `Voting ends in: ${mt.end}s`;
    if (!res && secs <= 5 && secs !== lastTick) { lastTick = secs; FX.sfx.tick(); }
    const sig = JSON.stringify([s.pl.map((p) => [p.u, p.a, p.v]), s.me.vote, voteSel, canVote, !!res]);
    if ($("#mGrid").dataset.sig !== sig) {
      $("#mGrid").dataset.sig = sig;
      const ps = s.pl.filter((p) => p.g).sort((a, b) => (b.a - a.a));
      $("#mGrid").innerHTML = ps.map((p, i) => {
        const mine = p.u === s.me.u, dots = res ? (res.votes[p.u] || []) : [];
        return `<button class="pc ${p.a ? "" : "dead"} ${mine ? "me" : ""} ${voteSel === p.u ? "sel" : ""}" style="animation-delay:${i * 0.05}s" data-pv="${esc(p.u)}" ${canVote && p.a && !mine ? "" : "disabled"}>
          <canvas width="54" height="50" data-c="${p.c}" data-d="${p.a ? "" : 1}"></canvas>
          ${mt.callerU === p.u ? `<span class="meg">📣</span>` : ""}
          <span class="nm" style="${p.imp && !mine ? "color:#c0001a" : ""}">${esc(p.n)}</span>
          ${p.v && !res ? `<span class="vt">I VOTED</span>` : ""}
          ${res ? `<span class="vdots">${dots.map((c, k) => `<i style="background:${M.COLORS[c]};animation-delay:${0.4 + k * 0.25}s"></i>`).join("")}</span>` : ""}
          ${voteSel === p.u && canVote ? `<span class="ok"><span class="y" data-yes="${esc(p.u)}">✔</span><span class="n" data-no>✖</span></span>` : ""}</button>`;
      }).join("");
      $("#mGrid").querySelectorAll("canvas").forEach((c) => { const x = c.getContext("2d"); if (c.dataset.d) drawBody(x, 27, 32, M.COLORS[+c.dataset.c], 0); else drawSperm(x, 36, 46, M.COLORS[+c.dataset.c], 1, 0, false, { scale: 0.75 }); });
      $("#mSkip").disabled = !canVote; $("#mSkip").classList.toggle("sel", voteSel === "skip");
      $("#mSkip").innerHTML = voteSel === "skip" && canVote ? `SKIP VOTE? <span data-yes="skip" style="color:#2bbf47">✔</span> <span data-no style="color:#e3132b">✖</span>` : "SKIP VOTE";
      $("#mSkipVotes").innerHTML = res ? res.skips.map((c, k) => `<i style="background:${M.COLORS[c]};animation-delay:${0.4 + k * 0.25}s"></i>`).join("") : "";
    }
    $("#mInfo").textContent = res ? "" : !s.me.inGame ? "You are spectating." : !s.me.alive ? "👻 Ghosts can't vote." : s.me.vote ? "✅ You voted." : mt.disc > 0 ? "Discuss!" : "Click a player to vote.";
    $("#mIn").disabled = !(s.me.inGame && s.me.alive) || !!res;
    $("#mIn").placeholder = $("#mIn").disabled ? "You can't talk right now." : "Type here…";
  }
  function setMeetChat(on) {
    meetChatOpen = on; $("#mChatPanel").classList.toggle("hidden", !on);
    if (on) { $("#mChatDot").classList.add("hidden"); const l = S?.chat || []; meetSeen = l.length ? l[l.length - 1].id : meetSeen; const b = $("#mChat"); b.scrollTop = b.scrollHeight; if (!$("#mIn").disabled) $("#mIn").focus(); }
  }
  $("#mChatBtn").addEventListener("click", () => setMeetChat(!meetChatOpen));
  $("#mChatX").addEventListener("click", () => setMeetChat(false));
  function castVote(u) { sock.emit("vote", u); voteSel = null; FX.sfx.vote(); $("#mGrid").dataset.sig = ""; }
  $("#mGrid").addEventListener("click", (e) => {
    const y = e.target.closest("[data-yes]"); if (y) return castVote(y.dataset.yes);
    if (e.target.closest("[data-no]")) { voteSel = null; $("#mGrid").dataset.sig = ""; return meetingUI(); }
    const b = e.target.closest("[data-pv]"); if (!b || b.disabled) return;
    voteSel = b.dataset.pv; FX.sfx.tick(); $("#mGrid").dataset.sig = ""; meetingUI();
  });
  $("#mSkip").addEventListener("click", (e) => {
    if (e.target.closest("[data-yes]")) return castVote("skip");
    if (e.target.closest("[data-no]")) { voteSel = null; $("#mGrid").dataset.sig = ""; return meetingUI(); }
    voteSel = "skip"; $("#mGrid").dataset.sig = ""; meetingUI();
  });
  $("#mForm").addEventListener("submit", (e) => { e.preventDefault(); const v = $("#mIn").value.trim(); if (v) sock.emit("chat", v); $("#mIn").value = ""; });

  /* ---------- knoppen ---------- */
  $("#colors").addEventListener("click", (e) => { const b = e.target.closest("[data-col]"); if (b && !b.classList.contains("taken")) sock.emit("color", +b.dataset.col); });
  $("#bStart").addEventListener("click", () => sock.emit("start"));
  $("#bChat").addEventListener("click", () => { $("#chat").classList.toggle("hidden"); hud(); if (!$("#chat").classList.contains("hidden")) $("#chatIn").focus(); });
  $("#chatX").addEventListener("click", () => $("#chat").classList.add("hidden"));
  $("#chatForm").addEventListener("submit", (e) => { e.preventDefault(); const v = $("#chatIn").value.trim(); if (v) sock.emit("chat", v); $("#chatIn").value = ""; });
  $("#bMap").addEventListener("click", toggleMap);
  $("#mapX").addEventListener("click", toggleMap);
  function doUse() { const u = useTarget(); if (!u) return; if (u.k === "task") openTask(u.id); else if (u.k === "fix") sock.emit("fix"); else if (u.k === "emergency") sock.emit("emergency"); }
  $("#aUse").addEventListener("click", doUse);
  $("#aReport").addEventListener("click", () => sock.emit("report"));
  $("#aKill").addEventListener("click", () => { sendPos(true); sock.emit("kill"); });
  $("#aVent").addEventListener("click", () => { sendPos(true); sock.emit("vent"); });
  $("#aSab").addEventListener("click", () => $("#sabMenu").classList.toggle("hidden"));
  $("#sabMenu").addEventListener("click", (e) => { const b = e.target.closest("[data-sab]"); if (!b) return; sock.emit("sab", b.dataset.sab); $("#sabMenu").classList.add("hidden"); });
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") { if (e.key === "Escape") e.target.blur(); return; }
    const k = e.key.toLowerCase();
    if (k === "e" || k === " ") { e.preventDefault(); doUse(); }
    else if (k === "r" && !$("#aReport").disabled) sock.emit("report");
    else if (k === "a" && S?.me.role === "imp" && !$("#aKill").disabled) { sendPos(true); sock.emit("kill"); }
    else if (k === "f" && S?.me.role === "imp" && !$("#aVent").disabled) { sendPos(true); sock.emit("vent"); }
    else if (k === "m" && !$("#bMap").classList.contains("hidden")) toggleMap();
    else if (k === "c" && !$("#bChat").classList.contains("hidden")) { e.preventDefault(); $("#chat").classList.remove("hidden"); $("#chatIn").focus(); }
    else if (k === "escape") { setMeetChat(false); closeTask(); $("#mapOv").classList.add("hidden"); $("#sabMenu").classList.add("hidden"); $("#chat").classList.add("hidden"); }
  });

  /* ---------- kaart ---------- */
  function toggleMap() { $("#mapOv").classList.toggle("hidden"); drawMiniMap(); }
  function drawMiniMap() {
    const c = $("#mapCv"), x = c.getContext("2d"), k = c.width / M.W;
    x.clearRect(0, 0, c.width, c.height); x.save(); x.scale(k, k);
    x.fillStyle = "#3b6db3"; M.WALK.forEach((r) => x.fillRect(r[0], r[1], r[2], r[3]));
    x.fillStyle = "#fff"; x.font = "bold 40px sans-serif"; x.textAlign = "center";
    for (const r of Object.values(M.ROOMS)) x.fillText(r.n, r.x + r.w / 2, r.y + r.h / 2);
    if (S?.me.role === "crew") for (const t of S.me.tasks) if (!t.done) { const p = M.TASKS[t.id]; x.fillStyle = "#ffe14d"; x.beginPath(); x.arc(p.x, p.y, 22, 0, 7); x.fill(); }
    if (S?.sab) { const f = M.FIX[S.sab]; x.fillStyle = "#ff3b4e"; x.beginPath(); x.arc(f.x, f.y, 30, 0, 7); x.fill(); }
    x.fillStyle = M.COLORS[S?.me.c || 0]; x.strokeStyle = "#000"; x.lineWidth = 8; x.beginPath(); x.arc(me.x, me.y - 20, 30, 0, 7); x.fill(); x.stroke();
    x.restore();
  }

  /* ---------- opdrachten ---------- */
  let taskId = null;
  function closeTask() { taskId = null; $("#taskOv").classList.add("hidden"); $("#taskBody").innerHTML = ""; }
  $("#taskX").addEventListener("click", closeTask);
  function openTask(id) {
    taskId = id; const T = M.TASKS[id], B = $("#taskBody");
    $("#taskTitle").textContent = `${M.ROOMS[id].n}: ${T.n}`; $("#taskOv").classList.remove("hidden");
    const finish = () => { FX.sfx.task(); B.innerHTML = `<div class="tok">✅ Task complete!</div>`; sendPos(true); sock.emit("task", id); setTimeout(() => { if (taskId === id) closeTask(); }, 800); };
    if (T.t === "code") {
      const code = String(Math.floor(10000 + Math.random() * 90000)); let typed = "";
      const draw = () => { B.innerHTML = `<div class="tcode">${code}</div><div class="tdisp">${typed.padEnd(5, "_")}</div><div class="keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9, "⌫", 0, "OK"].map((k) => `<button data-k="${k}">${k}</button>`).join("")}</div>`; };
      draw();
      B.onclick = (e) => { const k = e.target.closest("[data-k]")?.dataset.k; if (k == null) return; if (k === "⌫") typed = typed.slice(0, -1); else if (k === "OK") { if (typed === code) return finish(); typed = ""; } else if (typed.length < 5) typed += k; draw(); if (typed === code) finish(); };
    } else if (T.t === "draden") {
      const C = ["#ff3b4e", "#3d8bff", "#ffe14d", "#ff7ad9"], L = [...C].sort(() => Math.random() - 0.5), R = [...C].sort(() => Math.random() - 0.5), ok = new Set(); let sel = null;
      const draw = () => { B.innerHTML = `<p>Connect the wires of the same color.</p><div class="wires"><div>${L.map((c) => `<button class="wire ${ok.has(c) ? "ok" : ""} ${sel === c ? "sel" : ""}" data-l="${c}" style="background:${c}"></button>`).join("")}</div><div>${R.map((c) => `<button class="wire ${ok.has(c) ? "ok" : ""}" data-r="${c}" style="background:${c}"></button>`).join("")}</div></div>`; };
      draw();
      B.onclick = (e) => { const l = e.target.closest("[data-l]"), r = e.target.closest("[data-r]"); if (l && !ok.has(l.dataset.l)) sel = l.dataset.l; else if (r && sel) { if (r.dataset.r === sel) ok.add(sel); sel = null; } draw(); if (ok.size === 4) finish(); };
    } else if (T.t === "scan") {
      B.innerHTML = `<p>Step onto the scanner…</p><div class="tbar"><i id="tb"></i></div><button class="hold" id="tgo">START SCAN</button>`;
      $("#tgo").onclick = (e) => { e.target.disabled = true; e.target.textContent = "Scanning…"; let p = 0; const it = setInterval(() => { if (taskId !== id) return clearInterval(it); p += 2.5; const b = $("#tb"); if (b) b.style.width = p + "%"; if (p >= 100) { clearInterval(it); finish(); } }, 100); };
    } else if (T.t === "kisten") {
      const n = [1, 2, 3, 4, 5, 6].sort(() => Math.random() - 0.5); let next = 1;
      const draw = () => { B.innerHTML = `<p>Tap the crates from 1 to 6.</p><div class="boxes">${n.map((x) => `<button class="${x < next ? "ok" : ""}" data-b="${x}">${x < next ? "✔" : x}</button>`).join("")}</div>`; };
      draw();
      B.onclick = (e) => { const b = e.target.closest("[data-b]"); if (!b) return; const v = +b.dataset.b; if (v === next) next++; else if (v >= next) next = 1; draw(); if (next > 6) finish(); };
    } else {
      B.innerHTML = `<p>Hold the button until the bar is full.</p><div class="tbar"><i id="tb"></i></div><button class="hold" id="th">HOLD</button>`;
      let p = 0, it = null; const b = $("#th"), bar = () => { const x = $("#tb"); if (x) x.style.width = p + "%"; };
      const stop = () => { clearInterval(it); it = null; if (p < 100) { p = 0; bar(); } };
      b.addEventListener("pointerdown", () => { if (it) return; it = setInterval(() => { if (taskId !== id) return stop(); p += 4; bar(); if (p >= 100) { clearInterval(it); it = null; finish(); } }, 100); });
      ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => b.addEventListener(ev, stop));
    }
  }

  /* ---------- besturing ---------- */
  const keys = new Set();
  addEventListener("keydown", (e) => { if (e.target.tagName !== "INPUT") keys.add(e.key.toLowerCase()); });
  addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
  addEventListener("blur", () => keys.clear());
  let ptr = null; // muis/tik ingedrukt houden = naar die plek lopen
  cv.addEventListener("pointerdown", (e) => { ptr = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); $("#sabMenu").classList.add("hidden"); });
  cv.addEventListener("pointermove", (e) => { if (ptr) ptr = { x: e.clientX, y: e.clientY }; });
  cv.addEventListener("pointerup", () => (ptr = null));
  cv.addEventListener("pointercancel", () => (ptr = null));
  let stickV = null;
  const st = $("#stick"), knob = st.querySelector("i");
  st.addEventListener("pointerdown", (e) => { st.setPointerCapture(e.pointerId); moveStick(e); });
  st.addEventListener("pointermove", (e) => { if (e.buttons || e.pointerType === "touch") moveStick(e); });
  const endStick = () => { stickV = null; knob.style.transform = ""; };
  st.addEventListener("pointerup", endStick); st.addEventListener("pointercancel", endStick);
  function moveStick(e) { const r = st.getBoundingClientRect(); let dx = e.clientX - r.left - r.width / 2, dy = e.clientY - r.top - r.height / 2; const l = Math.hypot(dx, dy), m = 45; if (l > m) { dx *= m / l; dy *= m / l; } knob.style.transform = `translate(${dx}px,${dy}px)`; stickV = l > 8 ? { x: dx / m, y: dy / m } : null; }

  function canMove() {
    if (!S || !$("#taskOv").classList.contains("hidden") || !$("#mapOv").classList.contains("hidden")) return false;
    if (document.activeElement?.tagName === "INPUT") return false;
    if (!$("#splash").classList.contains("hidden") && S.ph !== "over") return false;
    return S.ph === "lobby" || S.ph === "over" || (S.ph === "play" && S.me.inGame);
  }
  function sendPos(force) {
    const t = performance.now();
    if (!force && t - lastSend < 66) return;
    lastSend = t; sock.volatile.emit("mv", { x: Math.round(me.x * 10) / 10, y: Math.round(me.y * 10) / 10, f: me.f });
  }

  /* ---------- tekenen ---------- */
  let W = 0, H = 0, DPR = 1;
  function resize() { DPR = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight; cv.width = W * DPR; cv.height = H * DPR; }
  addEventListener("resize", resize); resize();
  const stars = Array.from({ length: 160 }, () => ({ x: Math.random(), y: Math.random(), s: Math.random() * 1.6 + 0.3 }));
  let lt = performance.now();
  function frame(t) {
    const dt = Math.min(0.05, (t - lt) / 1000); lt = t; const ts = t / 1000;
    const scale = Math.min(1.25, Math.max(0.6, Math.min(W / 1000, H / 640)));
    // beweging
    me.walk = false;
    if (canMove()) {
      let vx = 0, vy = 0;
      if (keys.has("q") || keys.has("arrowleft")) vx -= 1;
      if (keys.has("d") || keys.has("arrowright")) vx += 1;
      if (keys.has("z") || keys.has("arrowup")) vy -= 1;
      if (keys.has("s") || keys.has("arrowdown")) vy += 1;
      if (stickV) { vx = stickV.x; vy = stickV.y; }
      else if (ptr && !vx && !vy) { const dx = ptr.x - W / 2, dy = ptr.y - (H / 2 - 20 * scale); const l = Math.hypot(dx, dy); if (l > 18) { vx = dx / l; vy = dy / l; } }
      const l = Math.hypot(vx, vy);
      if (l > 0) {
        if (l > 1) { vx /= l; vy /= l; }
        const ghost = S.me.inGame && !S.me.alive && S.ph === "play";
        const sp = M.SPEED * (ghost ? 1.25 : 1) * dt;
        const nx = me.x + vx * sp, ny = me.y + vy * sp;
        const ok = (x, y) => x > 0 && x < M.W && y > 0 && y < M.H && (ghost || M.walkable(x, y));
        if (ok(nx, me.y)) me.x = nx;
        if (ok(me.x, ny)) me.y = ny;
        if (vx) me.f = vx < 0 ? -1 : 1;
        me.walk = true; sendPos();
      } else if (performance.now() - lastSend > 1000) sendPos(true);
    }
    for (const o of others.values()) if (o.tx != null) { const k = Math.min(1, dt * 12); o.x += (o.tx - o.x) * k; o.y += (o.ty - o.y) * k; }

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = "#04050c"; ctx.fillRect(0, 0, W, H);
    for (const s of stars) { ctx.fillStyle = `rgba(255,255,255,${0.3 + s.s / 3})`; ctx.fillRect(((s.x * W - me.x * 0.05) % W + W) % W, ((s.y * H - me.y * 0.05) % H + H) % H, s.s, s.s); }
    if (!S) { requestAnimationFrame(frame); return; }
    ctx.setTransform(DPR * scale, 0, 0, DPR * scale, DPR * (W / 2 - me.x * scale), DPR * (H / 2 - me.y * scale));
    drawShip(ts);
    // lichamen
    for (const b of S.bodies || []) drawBody(ctx, b.x, b.y, M.COLORS[b.c], ts);
    // spelers (gesorteerd op y)
    const myGhost = S.me.inGame && !S.me.alive && S.ph === "play";
    const list = [];
    for (const o of others.values()) { if (o.x == null || !o.p) continue; if (o.p.g && !o.p.a && S.ph === "play" && !myGhost) continue; if (S.ph === "play" && o.p.g !== S.me.inGame) continue; list.push({ x: o.x, y: o.y, c: o.p.c, f: o.f, w: o.w, n: o.p.n, ghost: o.p.g && !o.p.a && S.ph === "play", imp: o.p.imp }); }
    list.push({ x: me.x, y: me.y, c: S.me.c, f: me.f, w: me.walk, n: "", ghost: myGhost, mine: true });
    list.sort((a, b) => a.y - b.y);
    for (const p of list) {
      if (S.ph === "play" && !S.me.inGame) continue;
      drawSperm(ctx, p.x, p.y, M.COLORS[p.c], p.f, ts + p.x * 0.01, p.w, { ghost: p.ghost });
      const nm = p.mine ? (playing() ? "" : "you") : p.n;
      if (nm) { ctx.font = "bold 15px Trebuchet MS, sans-serif"; ctx.textAlign = "center"; ctx.lineWidth = 4; ctx.strokeStyle = "#000"; ctx.strokeText(nm, p.x, p.y - 50); ctx.fillStyle = p.imp ? "#ff4d5e" : "#fff"; ctx.fillText(nm, p.x, p.y - 50); }
    }
    // duisternis
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (S.ph === "play" && S.me.inGame && !myGhost) {
      const r = S.vis * scale, cx = W / 2, cy = H / 2 - 20 * scale;
      const g = ctx.createRadialGradient(cx, cy, r * 0.55, cx, cy, r);
      g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.93)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    if (S.ph === "play" && S.me.inGame && !$("#acts").classList.contains("hidden")) {
      // knoppen live bijwerken (afstanden veranderen per frame)
      if ((t | 0) % 6 === 0) { $("#aUse").disabled = !useTarget(); $("#aReport").disabled = !bodyNear(); if (S.me.role === "imp" && S.me.alive) { $("#aKill").disabled = S.me.kill > 0 || !killTarget(); $("#aVent").disabled = !ventNear(); } }
    }
    if (!$("#mapOv").classList.contains("hidden") && (t | 0) % 10 === 0) drawMiniMap();
    requestAnimationFrame(frame);
  }
  function drawShip(ts) {
    // muren: dikke rand rond elke vloer, daarna vloeren erover → één samenhangend schip
    ctx.lineJoin = "round"; ctx.strokeStyle = "#151827"; ctx.lineWidth = 30;
    for (const r of M.WALK) ctx.strokeRect(r[0], r[1], r[2], r[3]);
    ctx.strokeStyle = "#2c3150"; ctx.lineWidth = 18;
    for (const r of M.WALK) ctx.strokeRect(r[0], r[1], r[2], r[3]);
    for (const r of M.HALLS) { ctx.fillStyle = "#3a3f58"; ctx.fillRect(r[0] + 1, r[1] + 1, r[2] - 2, r[3] - 2); }
    for (const r of Object.values(M.ROOMS)) { ctx.fillStyle = r.c; ctx.fillRect(r.x, r.y, r.w, r.h); }
    for (const r of Object.values(M.ROOMS)) {
      ctx.strokeStyle = "rgba(255,255,255,.05)"; ctx.lineWidth = 2;
      for (let x = r.x + 40; x < r.x + r.w; x += 40) { ctx.beginPath(); ctx.moveTo(x, r.y); ctx.lineTo(x, r.y + r.h); ctx.stroke(); }
      for (let y = r.y + 40; y < r.y + r.h; y += 40) { ctx.beginPath(); ctx.moveTo(r.x, y); ctx.lineTo(r.x + r.w, y); ctx.stroke(); }
      ctx.fillStyle = "rgba(255,255,255,.16)"; ctx.font = "bold 30px Trebuchet MS, sans-serif"; ctx.textAlign = "center"; ctx.fillText(r.n.toUpperCase(), r.x + r.w / 2, r.y + 40);
    }
    // tafel met noodknop
    const T = M.TABLE;
    ctx.fillStyle = "#8a93b3"; ctx.strokeStyle = "#1a1d2b"; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(T.x, T.y, 62, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#c7cde0"; ctx.beginPath(); ctx.arc(T.x, T.y, 22, 0, 7); ctx.fill();
    ctx.fillStyle = "#e3132b"; ctx.beginPath(); ctx.arc(T.x, T.y - 3, 14, 0, 7); ctx.fill(); ctx.stroke();
    // koekers
    for (const v of Object.values(M.VENTS)) { ctx.fillStyle = "#23262f"; ctx.fillRect(v.x - 26, v.y - 16, 52, 32); ctx.strokeStyle = "#6a7088"; ctx.lineWidth = 3; ctx.strokeRect(v.x - 26, v.y - 16, 52, 32); for (let i = -18; i <= 18; i += 9) { ctx.beginPath(); ctx.moveTo(v.x + i, v.y - 12); ctx.lineTo(v.x + i, v.y + 12); ctx.stroke(); } }
    // reparatiepanelen
    for (const [k, f] of Object.entries(M.FIX)) { const on = S.sab === k && S.ph === "play"; ctx.fillStyle = on ? (Math.sin(ts * 8) > 0 ? "#ff2d4a" : "#7a0012") : "#4b5470"; ctx.fillRect(f.x - 20, f.y - 26, 40, 40); ctx.strokeStyle = "#111"; ctx.lineWidth = 3; ctx.strokeRect(f.x - 20, f.y - 26, 40, 40); ctx.fillStyle = "#cfe"; ctx.fillRect(f.x - 12, f.y - 18, 24, 10); }
    // opdrachten: elk station + geel lichtje voor jouw open opdrachten
    for (const [k, p] of Object.entries(M.TASKS)) {
      ctx.fillStyle = "#5c6788"; ctx.fillRect(p.x - 18, p.y - 24, 36, 32); ctx.strokeStyle = "#111"; ctx.lineWidth = 3; ctx.strokeRect(p.x - 18, p.y - 24, 36, 32);
      ctx.fillStyle = "#9ef"; ctx.fillRect(p.x - 12, p.y - 18, 24, 12);
      const mine = S.me.role === "crew" && S.me.tasks.some((t) => t.id === k && !t.done) && S.ph === "play";
      if (mine) { ctx.strokeStyle = `rgba(255,225,77,${0.55 + Math.sin(ts * 5) * 0.4})`; ctx.lineWidth = 5; ctx.strokeRect(p.x - 23, p.y - 29, 46, 42); ctx.fillStyle = "#ffe14d"; ctx.font = "bold 24px sans-serif"; ctx.textAlign = "center"; ctx.fillText("!", p.x, p.y - 34 + Math.sin(ts * 4) * 3); }
    }
  }
  requestAnimationFrame(frame);
})();
