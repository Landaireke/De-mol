// Kaart van het schip (eigen ontwerp). Gedeeld door server en browser.
(function (g) {
  const ROOMS = {
    motor:   { n: "Motor",      x: 80,   y: 120, w: 280, h: 260, c: "#3c4566" },
    medisch: { n: "Medisch",    x: 450,  y: 100, w: 260, h: 240, c: "#355a63" },
    kombuis: { n: "Kombuis",    x: 800,  y: 80,  w: 400, h: 340, c: "#4a4f6e" },
    brug:    { n: "Brug",       x: 1620, y: 250, w: 300, h: 320, c: "#3b4f73" },
    reactor: { n: "Reactor",    x: 80,   y: 480, w: 240, h: 300, c: "#5a3f55" },
    elektra: { n: "Elektra",    x: 450,  y: 820, w: 300, h: 240, c: "#5a5538" },
    opslag:  { n: "Opslag",     x: 850,  y: 700, w: 320, h: 300, c: "#4d4a3f" },
    sluis:   { n: "Luchtsluis", x: 1300, y: 750, w: 260, h: 240, c: "#3f5250" },
  };
  const HALLS = [
    [700, 190, 110, 90], [350, 190, 110, 90], [170, 370, 100, 120], [170, 770, 100, 200], [170, 880, 290, 90],
    [740, 880, 120, 90], [960, 410, 90, 300], [1160, 820, 150, 90], [1190, 290, 440, 90], [1650, 560, 90, 330], [1500, 800, 240, 90],
  ];
  const WALK = Object.values(ROOMS).map((r) => [r.x, r.y, r.w, r.h]).concat(HALLS);
  const TASKS = {
    brug:    { x: 1880, y: 300, t: "code",   n: "Koers invoeren" },
    elektra: { x: 520,  y: 850, t: "draden", n: "Draden verbinden" },
    medisch: { x: 620,  y: 300, t: "scan",   n: "Lichaamsscan" },
    opslag:  { x: 1120, y: 740, t: "kisten", n: "Kisten sorteren" },
    motor:   { x: 120,  y: 160, t: "houd",   n: "Brandstof tanken" },
    reactor: { x: 120,  y: 520, t: "code",   n: "Reactor starten" },
    sluis:   { x: 1520, y: 950, t: "houd",   n: "Druk regelen" },
    kombuis: { x: 1150, y: 120, t: "kisten", n: "Afval sorteren" },
  };
  const VENTS = {
    elektra: { x: 700, y: 1020, to: "medisch" }, medisch: { x: 680, y: 140, to: "elektra" },
    reactor: { x: 260, y: 520, to: "sluis" },    sluis:   { x: 1340, y: 790, to: "reactor" },
    brug:    { x: 1660, y: 530, to: "opslag" },  opslag:  { x: 880, y: 970, to: "brug" },
  };
  const TABLE = { x: 1000, y: 250 };
  const FIX = { reactor: { x: 280, y: 700, n: "Reactor" }, lights: { x: 720, y: 850, n: "Lichtpaneel" } };
  const W = 2000, H = 1100;
  const COLORS = ["#ff4d5e", "#3d8bff", "#2ecc71", "#ff7ad9", "#ff9f1c", "#ffe14d", "#55556a", "#f2f2f2", "#9b5de5", "#b5651d", "#2ee6e6", "#b8ff3d"];
  const COLOR_N = ["Rood", "Blauw", "Groen", "Roze", "Oranje", "Geel", "Grijs", "Wit", "Paars", "Bruin", "Cyaan", "Limoen"];
  const inside = (x, y) => WALK.some((r) => x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3]);
  const walkable = (x, y) => inside(x - 11, y - 6) && inside(x + 11, y - 6) && inside(x - 11, y + 6) && inside(x + 11, y + 6);
  const roomAt = (x, y) => { for (const [k, r] of Object.entries(ROOMS)) if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return k; return null; };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const M = { ROOMS, HALLS, WALK, TASKS, VENTS, TABLE, FIX, W, H, COLORS, COLOR_N, walkable, roomAt, dist, SPEED: 230 };
  if (typeof module !== "undefined" && module.exports) module.exports = M; else g.AUMAP = M;
})(typeof window !== "undefined" ? window : globalThis);
