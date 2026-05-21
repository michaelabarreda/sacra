// ============================================================
// SACRA — Shape Physics Animation
// sacra-animation.js
//
// Depends on: Matter.js (must be loaded before this script)
// ============================================================

(function () {
  'use strict';

  if (typeof Matter === 'undefined') {
    console.warn('Sacra animation: Matter.js not found. Load it before sacra-animation.js.');
    return;
  }

  // ─── CONFIG ───────────────────────────────────────────────────────────────
  // All tweakable values live here. The only section you should ever edit.
  const CONFIG = {

    // ── Appearance ──────────────────────────────────────────────────────────
    shapeColor:   '#C4603A',  // Terracotta. Also update SVG stroke colors below.
    shapeOpacity: 0.18,       // 0–1. How visible the shapes are.
    strokeWidth:  2.5,        // px. Only applies to geometric fallback shapes.

    // ── Shape display size ───────────────────────────────────────────────────
    shapeSize: 130,           // px. All three shapes scale relative to this.

    // ── SVG file URLs ────────────────────────────────────────────────────────
    // Upload the three SVG files (from shapes/ folder) to Webflow Assets,
    // then paste the asset URLs here. Leave empty to use geometric placeholders.
    svgUrls: {
      triangle:  'https://cdn.prod.website-files.com/6a0b67fec95a279e00155660/6a0eeffa08de0a82cfc2384c_triangle.svg',
      circle:    'https://cdn.prod.website-files.com/6a0b67fec95a279e00155660/6a0eeffa7d199a7856e077b8_circle.svg',
      rectangle: 'https://cdn.prod.website-files.com/6a0b67fec95a279e00155660/6a0eeffadf316c5684a9a66c_rectangle.svg',
    },

    // ── Physics ──────────────────────────────────────────────────────────────
    gravity:      1.2,    // How fast shapes fall. Higher = heavier gravity.
    groundFriction: 0.8,  // How much the ground slows shapes. 0 = frictionless.
    wallFriction:   0.2,
    airFriction:    0.012,

    // Bounciness per shape (0 = no bounce, 1 = full bounce)
    restitution: {
      triangle:  0.35,
      circle:    0.58,    // Circle bounces most
      rectangle: 0.22,    // Rectangle is most stable
    },

    // Mass per shape. Heavier = less affected by nudges and scroll.
    density: {
      triangle:  0.002,
      circle:    0.0015,
      rectangle: 0.003,
    },

    // ── Organic idle motion ──────────────────────────────────────────────────
    idleForceInterval: 3500,   // ms between random nudges. Higher = lazier.
    idleForceStrength: 0.0025, // How strong the nudge is. Higher = more active.

    // ── Scroll bounce ────────────────────────────────────────────────────────
    scrollBounceMultiplier: 0.009, // How much a scroll event launches shapes.
    scrollBounceMax:        0.28,  // Caps the launch force on fast scrolls.

    // ── Contact section → shapes start drifting toward tower zone ────────────
    contactThreshold:  0.65,   // 0–1. What fraction of page scroll triggers drift.
    attractStrength:   0.0006, // How strongly shapes are pulled toward tower zone.

    // ── Tower assembly ────────────────────────────────────────────────────────
    towerThreshold:    0.92,   // 0–1. Page scroll % that triggers tower lock-in.
    towerRight:        72,     // px from right edge of viewport.
    towerBottom:       28,     // px above the ground line.
    towerStagger:      220,    // ms between each shape locking into place.

  };

  // ─── PHASE ────────────────────────────────────────────────────────────────
  const PHASE = { WAITING: 0, FALLING: 1, IDLE: 2, TOWER: 3 };
  let phase = PHASE.WAITING;

  // ─── GLOBALS ──────────────────────────────────────────────────────────────
  let engine, world, runner;
  let canvas, ctx;
  let vw, vh;
  let groundBody, wallL, wallR;
  let triBod, cirBod, recBod;
  let triImg, cirImg, recImg;
  let idleTimer = null;
  let lastScrollY = 0;
  let towerTargets = {};
  let towerLocked = { tri: false, cir: false, rec: false };

  // ─── VIEWPORT ─────────────────────────────────────────────────────────────
  // Uses visualViewport on iOS Safari for accurate height (avoids address-bar jump).
  function getViewport() {
    const vv = window.visualViewport;
    return {
      w: vv ? vv.width  : window.innerWidth,
      h: vv ? vv.height : window.innerHeight,
    };
  }

  // ─── CANVAS SETUP ─────────────────────────────────────────────────────────
  function setupCanvas() {
    canvas = document.createElement('canvas');
    canvas.id = 'sacra-physics-canvas';
    canvas.style.cssText = [
      'position:fixed',
      'top:0',
      'left:0',
      'width:100%',
      'height:100%',
      'pointer-events:none',  // clicks pass through to page
      'z-index:1',            // above page background, below content (set content z-index:2+)
    ].join(';');
    document.body.prepend(canvas);
    ctx = canvas.getContext('2d');
    resizeCanvas();
  }

  function resizeCanvas() {
    const vp = getViewport();
    vw = vp.w;
    vh = vp.h;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = vw * dpr;
    canvas.height = vh * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ─── MATTER.JS SETUP ──────────────────────────────────────────────────────
  function setupPhysics() {
    engine = Matter.Engine.create({
      gravity: { x: 0, y: CONFIG.gravity },
    });
    world  = engine.world;
    runner = Matter.Runner.create();

    createBoundaries();
    createShapeBodies();

    Matter.Runner.run(runner, engine);
  }

  function createBoundaries() {
    const thick = 60;
    groundBody = Matter.Bodies.rectangle(vw / 2, vh + thick / 2, vw * 4, thick, {
      isStatic: true,
      friction: CONFIG.groundFriction,
      label: 'ground',
    });
    wallL = Matter.Bodies.rectangle(-thick / 2, vh / 2, thick, vh * 4, {
      isStatic: true, friction: CONFIG.wallFriction, label: 'wallL',
    });
    wallR = Matter.Bodies.rectangle(vw + thick / 2, vh / 2, thick, vh * 4, {
      isStatic: true, friction: CONFIG.wallFriction, label: 'wallR',
    });
    Matter.World.add(world, [groundBody, wallL, wallR]);
  }

  function createShapeBodies() {
    const s = CONFIG.shapeSize;

    // Start positions: above viewport so they fall into frame
    const startY = {
      tri: -s * 2.0,
      cir: -s * 3.2,
      rec: -s * 1.5,
    };

    // Triangle — convex polygon, flat base down
    triBod = Matter.Bodies.fromVertices(
      vw * 0.22, startY.tri,
      [{ x: 0, y: -s * 0.5 }, { x: s * 0.52, y: s * 0.5 }, { x: -s * 0.52, y: s * 0.5 }],
      {
        restitution: CONFIG.restitution.triangle,
        friction:    CONFIG.groundFriction,
        frictionAir: CONFIG.airFriction,
        density:     CONFIG.density.triangle,
        label: 'triangle',
      }
    );

    // Circle
    cirBod = Matter.Bodies.circle(
      vw * 0.5, startY.cir, s * 0.5,
      {
        restitution: CONFIG.restitution.circle,
        friction:    CONFIG.groundFriction * 0.35,
        frictionAir: CONFIG.airFriction,
        density:     CONFIG.density.circle,
        label: 'circle',
      }
    );

    // Rectangle (vertical — taller than wide)
    recBod = Matter.Bodies.rectangle(
      vw * 0.73, startY.rec, s * 0.72, s * 1.28,
      {
        restitution: CONFIG.restitution.rectangle,
        friction:    CONFIG.groundFriction * 1.2,
        frictionAir: CONFIG.airFriction,
        density:     CONFIG.density.rectangle,
        label: 'rectangle',
      }
    );

    // Hold static until first interaction
    Matter.Body.setStatic(triBod, true);
    Matter.Body.setStatic(cirBod, true);
    Matter.Body.setStatic(recBod, true);

    Matter.World.add(world, [triBod, cirBod, recBod]);
  }

  // ─── SVG IMAGE LOADING ────────────────────────────────────────────────────
  function loadImages() {
    function load(url, onDone) {
      if (!url) { onDone(null); return; }
      const img = new Image();
      img.onload  = () => onDone(img);
      img.onerror = () => onDone(null);
      img.src = url;
    }
    load(CONFIG.svgUrls.triangle,  img => { triImg = img; });
    load(CONFIG.svgUrls.circle,    img => { cirImg = img; });
    load(CONFIG.svgUrls.rectangle, img => { recImg = img; });
  }

  // ─── RENDER LOOP ──────────────────────────────────────────────────────────
  function startRenderLoop() {
    function loop() {
      requestAnimationFrame(loop);
      if (phase === PHASE.WAITING) return;
      ctx.clearRect(0, 0, vw, vh);
      if (phase === PHASE.TOWER) {
        easeShapesToTower();
      } else {
        applyContactAttraction();
      }
      drawBody(triBod, 'triangle',  triImg);
      drawBody(cirBod, 'circle',    cirImg);
      drawBody(recBod, 'rectangle', recImg);
    }
    requestAnimationFrame(loop);
  }

  // ─── DRAWING ──────────────────────────────────────────────────────────────
  function drawBody(body, type, img) {
    const p = body.position;
    const a = body.angle;
    const s = CONFIG.shapeSize;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(a);
    ctx.globalAlpha  = CONFIG.shapeOpacity;
    ctx.strokeStyle  = CONFIG.shapeColor;
    ctx.fillStyle    = 'transparent';
    ctx.lineWidth    = CONFIG.strokeWidth;
    ctx.lineCap      = 'round';
    ctx.lineJoin     = 'round';

    if (img && img.complete && img.naturalWidth > 0) {
      // Actual hand-drawn SVG (pre-colored Terracotta)
      const ratio = img.naturalHeight / img.naturalWidth;
      const w = s, h = s * ratio;
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
    } else {
      // Geometric fallback — draws while SVGs load or if URLs are empty
      ctx.beginPath();
      if (type === 'triangle') {
        ctx.moveTo(0, -s * 0.5);
        ctx.lineTo( s * 0.52,  s * 0.5);
        ctx.lineTo(-s * 0.52,  s * 0.5);
        ctx.closePath();
      } else if (type === 'circle') {
        ctx.arc(0, 0, s * 0.5, 0, Math.PI * 2);
      } else {
        // Vertical rectangle
        const w = s * 0.72, h = s * 1.28;
        ctx.rect(-w / 2, -h / 2, w, h);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  // ─── FIRST INTERACTION → SHAPES FALL ──────────────────────────────────────
  function onFirstInteraction() {
    if (phase !== PHASE.WAITING) return;
    phase = PHASE.FALLING;

    Matter.Body.setStatic(triBod, false);
    Matter.Body.setStatic(cirBod, false);
    Matter.Body.setStatic(recBod, false);

    // Stagger release slightly so they don't all collide at once
    setTimeout(() => Matter.Body.applyForce(triBod, triBod.position, {  x:  0.003, y: 0 }), 0);
    setTimeout(() => Matter.Body.applyForce(cirBod, cirBod.position, {  x: -0.001, y: 0 }), 120);
    setTimeout(() => Matter.Body.applyForce(recBod, recBod.position, {  x:  0.002, y: 0 }), 60);

    // Transition to IDLE after shapes have had time to land
    setTimeout(() => {
      if (phase === PHASE.FALLING) {
        phase = PHASE.IDLE;
        startIdleMotion();
      }
    }, 2800);

    document.removeEventListener('mousemove', onFirstInteraction);
    document.removeEventListener('touchstart', onFirstInteraction);
  }

  // ─── ORGANIC IDLE MOTION ──────────────────────────────────────────────────
  function startIdleMotion() {
    function nudge() {
      if (phase !== PHASE.IDLE) return;
      const str = CONFIG.idleForceStrength;
      [triBod, cirBod, recBod].forEach(body => {
        const angle = Math.random() * Math.PI * 2;
        const mag   = str * (0.4 + Math.random() * 0.6);
        Matter.Body.applyForce(body, body.position, {
          x:  Math.cos(angle) * mag,
          y: -Math.abs(Math.sin(angle) * mag * 0.4), // slight upward bias
        });
      });
      idleTimer = setTimeout(nudge, CONFIG.idleForceInterval + Math.random() * 2000);
    }
    idleTimer = setTimeout(nudge, CONFIG.idleForceInterval);
  }

  // ─── SCROLL HANDLING ──────────────────────────────────────────────────────
  function onScroll() {
    if (phase === PHASE.WAITING || phase === PHASE.TOWER) return;

    const scrollY   = window.scrollY || window.pageYOffset;
    const delta     = scrollY - lastScrollY;
    lastScrollY     = scrollY;

    // Bounce shapes on scroll
    if (Math.abs(delta) > 3) {
      const force = Math.min(
        Math.abs(delta) * CONFIG.scrollBounceMultiplier,
        CONFIG.scrollBounceMax
      );
      [triBod, cirBod, recBod].forEach(body => {
        Matter.Body.applyForce(body, body.position, {
          x: (Math.random() - 0.5) * force * 0.25,
          y: -force,
        });
      });
    }

    // Check if tower assembly should trigger
    const maxScroll = document.body.scrollHeight - vh;
    if (maxScroll > 0) {
      const progress = scrollY / maxScroll;
      if (progress >= CONFIG.towerThreshold && phase !== PHASE.TOWER) {
        triggerTowerAssembly();
      }
    }
  }

  // ─── CONTACT SECTION DRIFT ────────────────────────────────────────────────
  function applyContactAttraction() {
    const scrollY   = window.scrollY || window.pageYOffset;
    const maxScroll = document.body.scrollHeight - vh;
    if (maxScroll <= 0) return;

    const progress = scrollY / maxScroll;
    if (progress < CONFIG.contactThreshold) return;

    // Shapes drift toward the bottom-right (where the tower will form)
    const targetX = vw - CONFIG.towerRight;
    const targetY = vh - 90;
    const str = CONFIG.attractStrength;

    [triBod, cirBod, recBod].forEach(body => {
      Matter.Body.applyForce(body, body.position, {
        x: (targetX - body.position.x) * str,
        y: (targetY - body.position.y) * str * 0.3,
      });
    });
  }

  // ─── TOWER ASSEMBLY ───────────────────────────────────────────────────────
  function triggerTowerAssembly() {
    phase = PHASE.TOWER;
    if (idleTimer) clearTimeout(idleTimer);

    const s   = CONFIG.shapeSize;
    const cx  = vw - CONFIG.towerRight;
    const gnd = vh - CONFIG.towerBottom;

    // Tower stack bottom → top: triangle base, rectangle middle, circle top
    towerTargets = {
      tri: { x: cx, y: gnd - s * 0.52,                                  angle: 0 },
      rec: { x: cx, y: gnd - s * 0.52 - s * 0.64 - s * 0.1,            angle: 0 },
      cir: { x: cx, y: gnd - s * 0.52 - s * 1.28 - s * 0.5 - s * 0.1,  angle: 0 },
    };

    // Lock each shape into its target with a stagger
    [
      { body: triBod, key: 'tri', delay: 0 },
      { body: recBod, key: 'rec', delay: CONFIG.towerStagger },
      { body: cirBod, key: 'cir', delay: CONFIG.towerStagger * 2 },
    ].forEach(({ body, key, delay }) => {
      setTimeout(() => {
        Matter.Body.setStatic(body, true);
        Matter.Body.setPosition(body, { x: towerTargets[key].x, y: towerTargets[key].y });
        Matter.Body.setAngle(body, 0);
        towerLocked[key] = true;
      }, delay + 500); // 500ms easing window before hard lock
    });
  }

  // Smooth easing toward tower targets before each shape locks
  function easeShapesToTower() {
    const ease = 0.07;

    function easeBody(body, target, locked) {
      if (locked) return;
      Matter.Body.setPosition(body, {
        x: body.position.x + (target.x - body.position.x) * ease,
        y: body.position.y + (target.y - body.position.y) * ease,
      });
      Matter.Body.setAngle(body, body.angle + (target.angle - body.angle) * ease);
    }

    easeBody(triBod, towerTargets.tri, towerLocked.tri);
    easeBody(recBod, towerTargets.rec, towerLocked.rec);
    easeBody(cirBod, towerTargets.cir, towerLocked.cir);
  }

  // ─── RESIZE (including iOS address-bar show/hide) ─────────────────────────
  function onResize() {
    const vp = getViewport();
    vw = vp.w;
    vh = vp.h;
    resizeCanvas();

    if (groundBody) Matter.Body.setPosition(groundBody, { x: vw / 2,      y: vh + 30 });
    if (wallR)      Matter.Body.setPosition(wallR,      { x: vw + 25,     y: vh / 2  });
    if (wallL)      Matter.Body.setPosition(wallL,      { x: -25,         y: vh / 2  });
  }

  // ─── INIT ─────────────────────────────────────────────────────────────────
  function init() {
    setupCanvas();
    setupPhysics();
    loadImages();
    startRenderLoop();

    document.addEventListener('mousemove', onFirstInteraction);
    document.addEventListener('touchstart', onFirstInteraction, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', onResize);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
