// Spermacel-figuurtjes: glanzend kopje (nep-3D met verlopen) en een kronkelende staart.
(function (g) {
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16); let r = n >> 16, gr = (n >> 8) & 255, b = n & 255;
    const f = (v) => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k))));
    return `rgb(${f(r)},${f(gr)},${f(b)})`;
  }
  // x,y = grondpunt (midden onder), f = kijkrichting (1 rechts, -1 links), t = tijd in s
  function drawSperm(ctx, x, y, col, f, t, walking, opt = {}) {
    const ghost = !!opt.ghost, s = opt.scale || 1;
    ctx.save();
    ctx.translate(x, y); ctx.scale(s, s);
    if (ghost) ctx.globalAlpha *= 0.45;
    const bob = walking ? Math.abs(Math.sin(t * 11)) * 3 : Math.sin(t * 2) * 1.2;
    const hy = -24 - bob;
    // schaduw
    if (!ghost) { ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.beginPath(); ctx.ellipse(0, 0, 18, 6, 0, 0, Math.PI * 2); ctx.fill(); }
    // staart: van achter het kopje, golvend
    const sp = walking ? 16 : 5, amp = walking ? 7 : 4, L = 52;
    const pts = [];
    for (let i = 0; i <= 18; i++) {
      const u = i / 18;
      pts.push([-f * (12 + u * L), hy + 8 + u * 6 + Math.sin(u * 9 - t * sp) * amp * (0.3 + u)]);
    }
    ctx.lineCap = "round";
    for (let i = 0; i < pts.length - 1; i++) {
      const u = i / (pts.length - 1);
      ctx.strokeStyle = shade(col, -0.25 + u * 0.15); ctx.lineWidth = 8 * (1 - u) + 1.5;
      ctx.beginPath(); ctx.moveTo(pts[i][0], pts[i][1]); ctx.lineTo(pts[i + 1][0], pts[i + 1][1]); ctx.stroke();
    }
    // middenstuk
    ctx.fillStyle = shade(col, -0.15);
    ctx.beginPath(); ctx.ellipse(-f * 13, hy + 7, 8, 6, 0, 0, Math.PI * 2); ctx.fill();
    // kopje met 3D-verloop
    const gr = ctx.createRadialGradient(f * -5, hy - 9, 3, 0, hy, 24);
    gr.addColorStop(0, shade(col, 0.55)); gr.addColorStop(0.45, col); gr.addColorStop(1, shade(col, -0.45));
    ctx.fillStyle = gr; ctx.strokeStyle = "rgba(0,0,0,.55)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(f * 3, hy, 19, 16, f * -0.15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // glimlicht
    ctx.fillStyle = "rgba(255,255,255,.55)"; ctx.beginPath(); ctx.ellipse(f * -3, hy - 8, 6, 3, -0.4, 0, Math.PI * 2); ctx.fill();
    // oogjes
    const ex = f * 9;
    if (opt.dead) {
      ctx.strokeStyle = "#111"; ctx.lineWidth = 2.2;
      for (const dx of [-5, 5]) { ctx.beginPath(); ctx.moveTo(ex + dx - 3, hy - 4); ctx.lineTo(ex + dx + 3, hy + 2); ctx.moveTo(ex + dx + 3, hy - 4); ctx.lineTo(ex + dx - 3, hy + 2); ctx.stroke(); }
    } else {
      for (const dx of [-5, 5]) {
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.ellipse(ex + dx, hy - 2, 4, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#111"; ctx.beginPath(); ctx.arc(ex + dx + f * 1.5, hy - 1.5, 2.2, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }
  // lichaam op de vloer
  function drawBody(ctx, x, y, col, t) {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = "rgba(230,230,255,.18)"; ctx.beginPath(); ctx.ellipse(0, 2, 40, 13, 0, 0, Math.PI * 2); ctx.fill();
    ctx.rotate(Math.PI / 2.3);
    drawSperm(ctx, 0, 18, col, 1, 0, false, { dead: true });
    ctx.restore();
  }
  g.SPR = { drawSperm, drawBody, shade };
})(window);
