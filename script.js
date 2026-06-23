// ═══════════════════════════════════════════
// Space Shooter — Game Logic
// ═══════════════════════════════════════════

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = 600, H = 800;
canvas.width = W;
canvas.height = H;

// ─── DOM refs ─────────────────────────────
const scoreEl = document.getElementById('score');
const waveEl = document.getElementById('wave');
const msgEl = document.getElementById('msg');
const livesEl = document.getElementById('lives');
const powerupsEl = document.getElementById('powerups');
const highscoreDisplay = document.getElementById('highscore-display');
const highscoreText = document.getElementById('highscore-text');

// ─── Game State ───────────────────────────
const START_LIVES = 3;
const I_FRAMES = 90; // invincibility frames after a hit
const POWERUP_DURATION = 480; // ~8s @ 60fps

let ship = { x: W / 2, y: H - 80, w: 40, h: 30, speed: 6, lives: START_LIVES, iframes: 0 };
let bullets = [];
let enemies = [];
let particles = [];
let powerups = []; // active (in-flight) power-up pickups
let stars = [];
let score = 0;
let highscore = 0;
let wave = 1;
let gameOver = false;
let gameStarted = false;
let paused = false;
let shooting = false;
let shootCooldown = 0;
const keys = {};
let enemySpeed = 1.5;
let spawnTimer = 0;
let spawnRate = 60;

// Active power-up timers (frames remaining, 0 = inactive)
const activePowers = { rapid: 0, spread: 0, shield: 0 };

// Screen shake
let shake = 0;

// ─── High Score (localStorage) ────────────
function loadHighscore() {
  try {
    highscore = parseInt(localStorage.getItem('space-shooter-highscore')) || 0;
  } catch {
    highscore = 0;
  }
  updateHighscoreDisplay();
}

function saveHighscore() {
  if (score > highscore) {
    highscore = score;
    try {
      localStorage.setItem('space-shooter-highscore', highscore);
    } catch { /* storage blocked */ }
  }
  updateHighscoreDisplay();
}

function updateHighscoreDisplay() {
  if (highscore > 0) {
    highscoreDisplay.classList.remove('hidden');
    highscoreText.textContent = highscore;
  }
}

// ─── Sound (WebAudio, lazy-init) ──────────
let audioCtx = null;
let soundOn = true;
function initAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch { audioCtx = null; }
}
function sfx(type) {
  if (!soundOn || !audioCtx) return;
  const now = audioCtx.currentTime;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.connect(g); g.connect(audioCtx.destination);
  const presets = {
    shoot:   { type: 'square',   f0: 880, f1: 440, dur: 0.08, vol: 0.06 },
    hit:     { type: 'square',   f0: 220, f1: 110, dur: 0.06, vol: 0.08 },
    explode: { type: 'sawtooth', f0: 200, f1: 40,  dur: 0.30, vol: 0.12 },
    power:   { type: 'triangle', f0: 440, f1: 1320, dur: 0.25, vol: 0.10 },
    wave:    { type: 'triangle', f0: 660, f1: 990, dur: 0.30, vol: 0.10 },
    over:    { type: 'sawtooth', f0: 300, f1: 60,  dur: 0.60, vol: 0.14 }
  };
  const p = presets[type] || presets.shoot;
  o.type = p.type;
  o.frequency.setValueAtTime(p.f0, now);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, p.f1), now + p.dur);
  g.gain.setValueAtTime(p.vol, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + p.dur);
  o.start(now);
  o.stop(now + p.dur + 0.02);
}

// ─── Starfield Background ─────────────────
for (let i = 0; i < 100; i++) {
  stars.push({
    x: Math.random() * W,
    y: Math.random() * H,
    s: Math.random() * 2 + 0.5,
    speed: Math.random() * 1 + 0.3
  });
}

// ─── Input Handling ───────────────────────
window.addEventListener('keydown', (e) => {
  const k = e.key;
  keys[k] = true;
  if (k === ' ') { e.preventDefault(); shooting = true; }
  if (k === 'p' || k === 'P') togglePause();
  if (k === 'm' || k === 'M') { soundOn = !soundOn; }
  wakeAudio(); // ponytail: wakeAudio() already wraps these two lines
  if (!gameStarted && !gameOver && !paused) gameStarted = true;
  if (gameOver && k.toLowerCase() === 'r') resetGame();
});

window.addEventListener('keyup', (e) => {
  keys[e.key] = false;
  if (e.key === ' ') shooting = false;
});

// ─── Responsive canvas scaling ───────────
// Internal resolution stays 600x800; CSS scales to fit the viewport.
function resizeCanvas() {
  const aspect = W / H;
  const maxW = window.innerWidth;
  const maxH = window.innerHeight;
  let w = maxW, h = w / aspect;
  if (h > maxH) { h = maxH; w = h * aspect; }
  // Use device pixels for crispness on hi-dpi, capped to the 600x800 buffer
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
}
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', resizeCanvas);

// ─── Mobile button controls ──────────────
// Hold-to-act state, driven by on-screen buttons (touch + mouse).
const mobile = { up: false, down: false, left: false, right: false, fire: false };

function wakeAudio() {
  if (!audioCtx) initAudio();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

// Bind a control button: set a flag while pressed, support multi-touch.
function bindHold(el, key) {
  const press = (e) => {
    e.preventDefault();
    el.classList.add('active');
    mobile[key] = true;
    wakeAudio();
    if (!gameStarted && !gameOver) gameStarted = true;
  };
  const release = (e) => {
    if (e) e.preventDefault();
    el.classList.remove('active');
    mobile[key] = false;
  };
  el.addEventListener('touchstart', press, { passive: false });
  el.addEventListener('touchend', release, { passive: false });
  el.addEventListener('touchcancel', release, { passive: false });
  el.addEventListener('mousedown', press);
  el.addEventListener('mouseup', release);
  el.addEventListener('mouseleave', release);
  // Prevent the browser from treating button taps as a click / scrolling
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

bindHold(document.getElementById('dpad-up'), 'up');
bindHold(document.getElementById('dpad-down'), 'down');
bindHold(document.getElementById('dpad-left'), 'left');
bindHold(document.getElementById('dpad-right'), 'right');
bindHold(document.getElementById('fire-btn'), 'fire');

// Pause button (tap toggle, not hold)
const pauseBtn = document.getElementById('pause-btn');
pauseBtn.addEventListener('click', (e) => {
  e.preventDefault();
  wakeAudio();
  if (!gameStarted && !gameOver) { gameStarted = true; return; }
  if (gameOver) { resetGame(); return; }
  togglePause();
});

// Tap on the canvas to start / restart (no longer moves the ship)
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  wakeAudio();
  if (!gameStarted && !gameOver) { gameStarted = true; return; }
  if (gameOver) { resetGame(); return; }
}, { passive: false });
canvas.addEventListener('click', () => {
  if (!gameStarted && !gameOver) gameStarted = true;
  else if (gameOver) resetGame();
});

// ─── Pause ────────────────────────────────
function togglePause() {
  if (!gameStarted || gameOver) return;
  paused = !paused;
  if (paused) {
    msgEl.innerHTML =
      '<div class="text-glow text-5xl font-bold mb-4">PAUSED</div>' +
      '<div class="text-base text-gray-500">Press <span class="text-white font-bold">P</span> to resume</div>';
  } else {
    msgEl.innerHTML = '';
  }
}

// ─── Spawn Enemy ──────────────────────────
function spawnEnemy() {
  const x = Math.random() * (W - 40) + 20;
  const r = Math.random();
  let type;
  // tank enemies appear from wave 2, chance grows with wave
  const tankChance = 0.05 + Math.min(0.15, wave * 0.01);
  if (r < 0.15) type = 'fast';
  else if (r < 0.15 + tankChance) type = 'tank';
  else type = 'normal';

  const base = {
    x, y: -30, type,
    w: 30, h: 25,
    speed: enemySpeed,
    hp: 1 + Math.floor(wave / 3),
    drift: Math.random() * Math.PI * 2
  };
  if (type === 'fast') { base.speed *= 2.5; base.hp = 1; }
  if (type === 'tank') { base.w = 46; base.h = 38; base.speed *= 0.6; base.hp = 3 + Math.floor(wave / 2); }
  enemies.push(base);
}

// ─── Particles ────────────────────────────
function spawnParticles(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 3 + 1;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      decay: Math.random() * 0.03 + 0.02,
      color,
      size: Math.random() * 3 + 1
    });
  }
}

// ─── Power-ups ────────────────────────────
const POWER_TYPES = ['rapid', 'spread', 'shield'];
const POWER_COLORS = { rapid: '#0f0', spread: '#f0f', shield: '#0ff' };
const POWER_LABELS = { rapid: 'RAPID', spread: 'SPREAD', shield: 'SHIELD' };

function maybeDropPowerup(x, y) {
  if (Math.random() < 0.09) {
    const type = POWER_TYPES[Math.floor(Math.random() * POWER_TYPES.length)];
    powerups.push({ x, y, type, w: 22, h: 22, vy: 1.6, spin: 0 });
  }
}

function applyPowerup(type) {
  activePowers[type] = POWERUP_DURATION;
  sfx('power');
  // shield gives an immediate absorb charge; show as persistent until consumed
}

// ─── Reset Game ───────────────────────────
function resetGame() {
  ship = { x: W / 2, y: H - 80, w: 40, h: 30, speed: 6, lives: START_LIVES, iframes: 0 };
  bullets = [];
  enemies = [];
  particles = [];
  powerups = [];
  score = 0;
  wave = 1;
  gameOver = false;
  gameStarted = true;
  paused = false;
  enemySpeed = 1.5;
  spawnRate = 60;
  spawnTimer = 0;
  shake = 0;
  activePowers.rapid = 0;
  activePowers.spread = 0;
  activePowers.shield = 0;
  shootCooldown = 0;
  mobile.up = mobile.down = mobile.left = mobile.right = mobile.fire = false;
  document.querySelectorAll('.mc-btn.active').forEach((b) => b.classList.remove('active'));
  msgEl.innerHTML = '';
  waveEl.textContent = 'Wave 1';
  scoreEl.textContent = '0';
  renderLives();
  renderPowerups();
}

// ─── Collision Detection ──────────────────
function rectCollide(a, b) {
  return (
    a.x - a.w / 2 < b.x + b.w / 2 &&
    a.x + a.w / 2 > b.x - b.w / 2 &&
    a.y - a.h / 2 < b.y + b.h / 2 &&
    a.y + a.h / 2 > b.y - b.h / 2
  );
}

// ─── UI: Lives + Power-ups ────────────────
function shipIconSVG() {
  // tiny cyan ship glyph
  return '<svg width="20" height="16" viewBox="-15 -14 30 28" style="filter:drop-shadow(0 0 4px #0ff)">' +
    '<polygon points="0,-12 -11,10 -5,7 0,9 5,7 11,10" fill="#0cf" stroke="#0ff" stroke-width="1.5"/></svg>';
}
function renderLives() {
  let html = '';
  for (let i = 0; i < ship.lives; i++) html += shipIconSVG();
  livesEl.innerHTML = html;
}
function renderPowerups() {
  let html = '';
  for (const t of POWER_TYPES) {
    const frames = activePowers[t];
    if (frames > 0) {
      const secs = Math.ceil(frames / 60);
      const color = POWER_COLORS[t];
      const persist = t === 'shield' ? '' : ` ${secs}s`;
      html += `<div class="px-2 py-1 rounded text-xs font-bold tracking-wider" ` +
        `style="color:${color};border:1px solid ${color};text-shadow:0 0 6px ${color};background:rgba(0,0,0,0.4)">` +
        `${POWER_LABELS[t]}${persist}</div>`;
    }
  }
  powerupsEl.innerHTML = html;
}

// ─── Draw Ship ────────────────────────────
function drawShip() {
  // Blink during invincibility
  if (ship.iframes > 0 && Math.floor(ship.iframes / 6) % 2 === 0) return;

  const { x, y } = ship;
  ctx.save();
  ctx.translate(x, y);

  // Engine glow (flickers randomly)
  const flicker = Math.random() * 10;
  const grd = ctx.createLinearGradient(0, 15, 0, 30);
  grd.addColorStop(0, '#0ff');
  grd.addColorStop(1, 'transparent');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.moveTo(-10, 15);
  ctx.lineTo(0, 25 + flicker);
  ctx.lineTo(10, 15);
  ctx.fill();

  // Shield aura
  if (activePowers.shield > 0) {
    ctx.strokeStyle = `rgba(0,255,255,${0.4 + 0.3 * Math.sin(Date.now() / 120)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Ship body
  ctx.fillStyle = '#0cf';
  ctx.beginPath();
  ctx.moveTo(0, -18);
  ctx.lineTo(-14, 14);
  ctx.lineTo(-6, 10);
  ctx.lineTo(0, 12);
  ctx.lineTo(6, 10);
  ctx.lineTo(14, 14);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#0ff';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Cockpit
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(0, -3, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// ─── Draw Enemy ───────────────────────────
function drawEnemy(e) {
  ctx.save();
  ctx.translate(e.x, e.y);
  const scale = e.type === 'tank' ? 1.5 : 1;
  ctx.scale(scale, scale);

  let fill, stroke;
  if (e.type === 'fast') { fill = '#f44'; stroke = '#f88'; }
  else if (e.type === 'tank') { fill = '#a3f'; stroke = '#d6f'; }
  else { fill = '#f84'; stroke = '#fa0'; }

  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(0, 14);
  ctx.lineTo(-12, -6);
  ctx.lineTo(-7, -12);
  ctx.lineTo(0, -4);
  ctx.lineTo(7, -12);
  ctx.lineTo(12, -6);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Tank armor plates
  if (e.type === 'tank') {
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-8, -2); ctx.lineTo(8, -2);
    ctx.stroke();
  }

  // Eyes
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(-4, 2, 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(4, 2, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.arc(-4, 3, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(4, 3, 1.5, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}

// ─── Draw Power-up Pickup ─────────────────
function drawPowerup(p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.spin);
  const c = POWER_COLORS[p.type];
  ctx.shadowColor = c;
  ctx.shadowBlur = 12;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.strokeStyle = c;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(-p.w / 2, -p.h / 2, p.w, p.h);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.rotate(-p.spin); // un-rotate text
  ctx.fillStyle = c;
  ctx.font = 'bold 11px "Share Tech Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const letter = p.type[0].toUpperCase();
  ctx.fillText(letter, 0, 1);
  ctx.restore();
}

// ─── Fire Bullets ─────────────────────────
function fire() {
  const cooldown = activePowers.rapid > 0 ? 6 : 12;
  if (shootCooldown > 0) return;
  const BW = 4, BH = 12;
  if (activePowers.spread > 0) {
    bullets.push({ x: ship.x, y: ship.y - 20, vx: 0, vy: -8, w: BW, h: BH });
    bullets.push({ x: ship.x - 8, y: ship.y - 14, vx: -2.2, vy: -7.6, w: BW, h: BH });
    bullets.push({ x: ship.x + 8, y: ship.y - 14, vx: 2.2, vy: -7.6, w: BW, h: BH });
  } else {
    bullets.push({ x: ship.x, y: ship.y - 20, vx: 0, vy: -8, w: BW, h: BH });
  }
  shootCooldown = cooldown;
  sfx('shoot');
}

// ─── Damage player ────────────────────────
function damagePlayer() {
  if (ship.iframes > 0) return;
  if (activePowers.shield > 0) {
    activePowers.shield = 0;
    spawnParticles(ship.x, ship.y, '#0ff', 25);
    shake = 8;
    sfx('hit');
    renderPowerups();
    return;
  }
  ship.lives--;
  ship.iframes = I_FRAMES;
  shake = 14;
  spawnParticles(ship.x, ship.y, '#f44', 25);
  sfx('hit');
  renderLives();
  if (ship.lives <= 0) endGame();
}

function endGame() {
  gameOver = true;
  spawnParticles(ship.x, ship.y, '#f44', 40);
  spawnParticles(ship.x, ship.y, '#ff0', 20);
  shake = 22;
  saveHighscore();
  sfx('over');
  msgEl.innerHTML =
    '<div class="text-glow text-5xl font-bold mb-4">GAME OVER</div>' +
    '<div class="text-lg text-gray-300 mb-1">Score: <span class="text-cyan-400 font-bold">' + score + '</span></div>' +
    '<div class="text-lg text-gray-300 mb-4">Wave: <span class="text-fuchsia-400 font-bold">' + wave + '</span></div>' +
    '<div class="text-base text-gray-500">Press <span class="text-white font-bold">R</span> to restart</div>';
}

// ─── Update Loop ──────────────────────────
function update() {
  // Decay screen shake always (so it stops after death/pause too)
  if (shake > 0) shake = Math.max(0, shake - 0.8);
  if (!gameStarted || gameOver || paused) return;

  // Ship movement (keyboard + mobile buttons)
  if (keys['ArrowLeft'] || keys['a'] || keys['A'] || mobile.left) ship.x -= ship.speed;
  if (keys['ArrowRight'] || keys['d'] || keys['D'] || mobile.right) ship.x += ship.speed;
  if (keys['ArrowUp'] || keys['w'] || keys['W'] || mobile.up) ship.y -= ship.speed;
  if (keys['ArrowDown'] || keys['s'] || keys['S'] || mobile.down) ship.y += ship.speed;
  ship.x = Math.max(ship.w / 2, Math.min(W - ship.w / 2, ship.x));
  ship.y = Math.max(ship.h / 2, Math.min(H - ship.h / 2, ship.y));

  // Invincibility countdown
  if (ship.iframes > 0) ship.iframes--;

  // Power-up timers
  let powerChanged = false;
  for (const t of POWER_TYPES) {
    if (activePowers[t] > 0 && t !== 'shield') {
      activePowers[t]--;
      if (activePowers[t] === 0) powerChanged = true;
    }
  }
  if (powerChanged) renderPowerups();

  // Shooting (keyboard space or mobile fire button)
  if (shootCooldown > 0) shootCooldown--;
  if (shooting || mobile.fire) fire();

  // Move bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx; b.y += b.vy;
    if (b.y < -10 || b.x < -10 || b.x > W + 10) bullets.splice(i, 1);
  }

  // Spawn enemies
  spawnTimer++;
  if (spawnTimer >= spawnRate) {
    spawnTimer = 0;
    spawnEnemy();
    if (Math.random() < 0.3) spawnEnemy();
  }

  // Move enemies + collision with ship
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    e.y += e.speed;
    e.x += Math.sin(e.y * 0.03 + e.drift) * 0.5; // sine-wave drift
    // keep tanks roughly on screen horizontally
    if (e.x < e.w / 2) e.x = e.w / 2;
    if (e.x > W - e.w / 2) e.x = W - e.w / 2;

    if (e.y > H + 40) { enemies.splice(i, 1); continue; }

    if (rectCollide(ship, e)) {
      damagePlayer();
      // enemy is destroyed on collision too
      spawnParticles(e.x, e.y, e.type === 'fast' ? '#f44' : e.type === 'tank' ? '#a3f' : '#f84', 15);
      enemies.splice(i, 1);
    }
  }

  // Move power-up pickups + collision with ship
  for (let i = powerups.length - 1; i >= 0; i--) {
    const p = powerups[i];
    p.y += p.vy;
    p.spin += 0.05;
    if (p.y > H + 30) { powerups.splice(i, 1); continue; }
    if (rectCollide(ship, p)) {
      applyPowerup(p.type);
      renderPowerups();
      powerups.splice(i, 1);
    }
  }

  // Bullet-enemy collisions
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    let hit = false;
    for (let j = enemies.length - 1; j >= 0; j--) {
      const e = enemies[j];
      if (rectCollide(b, e)) { // ponytail: e already carries x/y/w/h
        e.hp--;
        hit = true;
        sfx('hit');
        if (e.hp <= 0) {
          const col = e.type === 'fast' ? '#f44' : e.type === 'tank' ? '#a3f' : '#f84';
          spawnParticles(e.x, e.y, col, e.type === 'tank' ? 25 : 15);
          score += e.type === 'fast' ? 150 : e.type === 'tank' ? 300 : 100;
          maybeDropPowerup(e.x, e.y);
          shake = Math.max(shake, e.type === 'tank' ? 6 : 2);
          sfx('explode');
          enemies.splice(j, 1);
        }
        break;
      }
    }
    if (hit) bullets.splice(i, 1);
  }

  // Wave progression
  if (score >= wave * 500) {
    wave++;
    enemySpeed += 0.4;
    spawnRate = Math.max(15, spawnRate - 8);
    waveEl.textContent = 'Wave ' + wave;
    sfx('wave');
    shake = Math.max(shake, 4);

    // Celebration particles
    for (let i = 0; i < 20; i++) {
      particles.push({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 4,
        vy: (Math.random() - 0.5) * 4,
        life: 1,
        decay: 0.02,
        color: '#0ff',
        size: 4
      });
    }
  }

  // Update particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life -= p.decay;
    if (p.life <= 0) particles.splice(i, 1);
  }

  // Scroll stars
  for (const s of stars) {
    s.y += s.speed;
    if (s.y > H) { s.y = 0; s.x = Math.random() * W; }
  }

  // Update score display
  scoreEl.textContent = score;
}

// ─── Draw Loop ────────────────────────────
function draw() {
  ctx.save();

  // Screen shake offset
  if (shake > 0) {
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  }

  // Background
  ctx.fillStyle = '#0a0a1a';
  ctx.fillRect(-shake, -shake, W + shake * 2, H + shake * 2);

  // Stars
  for (const s of stars) {
    ctx.fillStyle = `rgba(255,255,255,${s.s * 0.4})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.s, 0, Math.PI * 2);
    ctx.fill();
  }

  // Grid lines (retro feel)
  ctx.strokeStyle = 'rgba(20,20,40,0.3)';
  ctx.lineWidth = 0.5;
  for (let y = 0; y < H; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  // Particles
  // ponytail: every particle color is a hex; the rgba branch was dead (and never set alpha)
  for (const p of particles) {
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Power-up pickups
  for (const p of powerups) drawPowerup(p);

  // Enemies
  for (const e of enemies) drawEnemy(e);

  // Bullets
  ctx.fillStyle = '#ff0';
  ctx.shadowColor = '#ff0';
  ctx.shadowBlur = 6;
  for (const b of bullets) {
    ctx.fillRect(b.x - 2, b.y - 6, 4, 12);
  }
  ctx.shadowBlur = 0;

  // Ship (visible on start screen & during play; hidden on death)
  if (!gameOver) drawShip();

  ctx.restore();
}

// ─── Game Loop ────────────────────────────
function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

// ─── Start Screen ─────────────────────────
msgEl.innerHTML =
  '<div class="text-glow text-6xl font-bold mb-6 tracking-wider">SPACE SHOOTER</div>' +
  '<div class="text-lg text-gray-300 mb-1"><span class="text-cyan-400">Arrow keys</span> / <span class="text-cyan-400">WASD</span> to move</div>' +
  '<div class="text-lg text-gray-300 mb-1"><span class="text-yellow-400">Space</span> to shoot &nbsp;·&nbsp; <span class="text-cyan-400">P</span> pause &nbsp;·&nbsp; <span class="text-cyan-400">M</span> mute</div>' +
  '<div class="text-base text-gray-400 mb-6">Grab power-ups: <span style="color:#0f0">Rapid</span> · <span style="color:#f0f">Spread</span> · <span style="color:#0ff">Shield</span></div>' +
  '<div class="text-base text-gray-500 animate-pulse">Press any key or tap to start</div>';

// ─── Init ─────────────────────────────────
resizeCanvas();
loadHighscore();
renderLives();
loop();
