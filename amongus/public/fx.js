// Effects: synthesized sounds (no audio files) and the kill animation.
(function (g) {
  let ac = null;
  const A = () => { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === "suspended") ac.resume(); } catch {} return ac; };
  addEventListener("pointerdown", A, { once: true }); addEventListener("keydown", A, { once: true });
  function tone(f, d, type = "sine", v = 0.15, t0 = 0, f2) {
    const a = A(); if (!a) return; const t = a.currentTime + t0;
    const o = a.createOscillator(), gn = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
    gn.gain.setValueAtTime(v, t); gn.gain.exponentialRampToValueAtTime(0.001, t + d);
    o.connect(gn).connect(a.destination); o.start(t); o.stop(t + d + 0.02);
  }
  function noise(d, v = 0.2, t0 = 0, hp = 800) {
    const a = A(); if (!a) return; const t = a.currentTime + t0;
    const b = a.createBuffer(1, a.sampleRate * d, a.sampleRate), ch = b.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / ch.length);
    const s = a.createBufferSource(), gn = a.createGain(), fl = a.createBiquadFilter();
    fl.type = "highpass"; fl.frequency.value = hp; s.buffer = b; gn.gain.value = v;
    s.connect(fl).connect(gn).connect(a.destination); s.start(t);
  }
  const sfx = {
    kill() { noise(0.25, 0.35, 0, 1500); tone(180, 0.35, "sawtooth", 0.2, 0.02, 40); tone(90, 0.5, "sine", 0.3, 0.05, 30); },
    alarm() { for (let i = 0; i < 3; i++) tone(520, 0.32, "square", 0.08, i * 0.4, 880); },
    body() { tone(140, 0.6, "sawtooth", 0.15, 0, 60); noise(0.4, 0.2, 0, 300); tone(660, 0.18, "square", 0.07, 0.15); tone(500, 0.3, "square", 0.07, 0.35); },
    vote() { tone(880, 0.07, "square", 0.06); tone(1320, 0.09, "square", 0.05, 0.06); },
    chat() { tone(1200, 0.06, "sine", 0.08); tone(1600, 0.06, "sine", 0.06, 0.05); },
    task() { [660, 880, 1320].forEach((f, i) => tone(f, 0.18, "triangle", 0.1, i * 0.08)); },
    reveal() { [220, 277, 330].forEach((f) => tone(f, 1.6, "sawtooth", 0.05)); tone(55, 1.8, "sine", 0.25, 0, 40); },
    eject() { noise(1.6, 0.12, 0, 200); tone(300, 1.5, "sine", 0.05, 0.2, 80); },
    win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.4, "triangle", 0.12, i * 0.15)); },
    lose() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.45, "sawtooth", 0.08, i * 0.18)); },
    tick() { tone(1000, 0.04, "square", 0.04); },
  };

  // Kill animation on a canvas inside el. k = killer color, v = victim color.
  function killAnim(el, k, v, done) {
    const cv = document.createElement("canvas"), W = Math.min(innerWidth, 900), H = Math.min(innerHeight * 0.6, 420);
    cv.width = W; cv.height = H; cv.className = "killcv"; el.appendChild(cv);
    const c = cv.getContext("2d"), t0 = performance.now(), D = 2.2;
    const { drawSperm, drawBody } = g.SPR;
    sfx.kill();
    (function loop() {
      const t = (performance.now() - t0) / 1000;
      if (!cv.isConnected) return;
      c.clearRect(0, 0, W, H);
      // red slashes in the background
      c.save(); c.translate(W / 2, H / 2); c.rotate(-0.25);
      const p = Math.min(1, t / 0.35);
      c.fillStyle = "#6b0010"; c.fillRect(-W, -H * 0.32 * p, W * 2, H * 0.64 * p);
      c.fillStyle = "#a3001a"; c.fillRect(-W, -H * 0.18 * p, W * 2, H * 0.36 * p);
      c.restore();
      const shake = t > 0.45 && t < 0.8 ? (Math.random() - 0.5) * 18 : 0;
      c.save(); c.translate(shake, shake * 0.6);
      const gy = H * 0.68, s = H / 150;
      // killer dashes in from the left and whips its tail
      const kx = t < 0.45 ? -80 + (W * 0.42 + 80) * (t / 0.45) ** 2 : W * 0.42 - Math.max(0, t - 0.8) * 40;
      drawSperm(c, kx, gy, k, 1, t * 3, t < 0.9, { scale: s });
      // victim gets knocked away, spins and lands
      if (t < 0.45) drawSperm(c, W * 0.62, gy, v, -1, t, false, { scale: s });
      else if (t < 1.2) {
        const u = (t - 0.45) / 0.75;
        c.save(); c.translate(W * 0.62 + u * W * 0.18, gy - Math.sin(u * Math.PI) * H * 0.35); c.rotate(u * 9);
        drawSperm(c, 0, 20 * s, v, -1, t, false, { scale: s, dead: true }); c.restore();
      } else { c.save(); c.translate(W * 0.8, gy); c.scale(s, s); drawBody(c, 0, 0, v, t); c.restore(); }
      // impact flash
      if (t > 0.42 && t < 0.62) { c.fillStyle = `rgba(255,255,255,${1 - (t - 0.42) / 0.2})`; c.fillRect(-20, -20, W + 40, H + 40); }
      c.restore();
      if (t < D) requestAnimationFrame(loop); else done && done();
    })();
  }
  g.FX = { sfx, killAnim };
})(window);
