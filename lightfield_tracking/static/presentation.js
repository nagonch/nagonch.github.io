// Presentation mode: step through the page one fragment at a time, fullscreen.
// Slides are declared with data-pres="<id>" on existing elements; elements
// sharing an id appear on the same slide. Nothing in the DOM is moved, so
// every interactive widget keeps working inside its slide.
document.addEventListener('DOMContentLoaded', function () {
  var marked = Array.prototype.slice.call(document.querySelectorAll('[data-pres]'));
  if (marked.length === 0) return;

  var order = [];
  var groups = {};
  marked.forEach(function (el) {
    var key = el.getAttribute('data-pres');
    if (!groups[key]) { groups[key] = []; order.push(key); }
    groups[key].push(el);
  });

  var current = 0;
  var presenting = false;
  var bulletMode = false;
  var savedScroll = 0;
  var zoomable = (typeof CSS !== 'undefined') && CSS.supports && CSS.supports('zoom', '0.5');

  // Bullet mode: per-slide summaries shown in place of the page prose.
  // Keyed by data-pres id; slides without an entry keep their prose.
  var BULLETS = {
    teaser: [
      'Mirror-like objects defeat appearance-based trackers — the reflections move, and the trackers follow them',
      'Our idea: turn the reflections themselves into a pose cue',
      'Each light field frame → geometry + diffuse albedo + the environment map it reflects',
      'Pose refined by relighting the object and descending the photometric residual',
      'Yellow outline = estimated pose — flip through the methods, baselines drift, ours stays locked on'
    ],
    abstract: [
      'Existing trackers assume stable appearance — breaks on reflective surfaces that mirror the environment',
      'Light field tracker, no pre-captured object model: depth robust to reflections → point cloud + normals',
      'View-dependent appearance split into diffuse albedo + environment map = relightable surface light field',
      'Track by relighting under the recovered map and optimizing pose on the photometric loss',
      'New multi-reflectivity dataset; only method that holds accuracy on fully reflective objects'
    ],
    signal: [
      'Classical tracking: a moving point is identified by its color — true only for matte (Lambertian) surfaces',
      'A reflective point, moved and re-illuminated, changes its angular color distribution',
      'Flatland toy: monocular color → shallow dip; raw EPIs → ignore re-illumination',
      'Only EPIs relit under the environment map drive the loss to zero at the true translation',
      'The reflection itself carries the motion'
    ],
    method: [
      'Per frame: segment → reflection-robust depth → points + normals; every point observed from all subviews',
      'Dichromatic model fit splits appearance: per-point diffuse albedo + one shared environment map',
      'Coarse alignment: feature match on the diffuse colors — reflections removed',
      'Refine: transform → relight under the accumulated map → render → descend the photometric residual',
      'Moving object mirrors new parts of the scene → map fills in → signal sharpens over the sequence'
    ],
    dataset: [
      'YCBInEOAT re-rendered as light fields — baseline-compatible, reflectivity controllable',
      '8 sequences, 4 YCB objects, 2 geometry variants (original mesh + cube isolating reflectance from shape)',
      'Per frame: 5 × 5 grid of 640 × 480 subviews at 5 mm baseline + masks, GT depth, 6D pose, calibration',
      'Four reflectivity levels r ∈ {0.0, 0.5, 0.7, 1.0} — geometry, lighting, pose identical across levels',
      'Paired simulated RGB-D sensor depth (active stereo) — collapses on shiny surfaces'
    ],
    explorer: [
      'Every sequence at 4 reflectivity levels × 2 geometries, in RGB and simulated sensor depth',
      'Watch the sensor depth collapse into holes and outliers as r grows',
      'Cube variant: same trajectory, reflectance isolated from shape'
    ],
    refviews: [
      'Calibrated reference views for every object — FoundationPose-compatible',
      'All reflectivity levels, both depth modes, ground truth masks'
    ],
    results: [
      'Every method: all 8 sequences × all 4 reflectivity levels',
      'Baselines: central subview + simulated sensor depth; ours: full light field + its own depth estimate',
      'Diffuse surfaces: trail only FoundationPose and BundleSDF — which rely on pre-captured models',
      'Full reflectivity: best on every metric, largest gain in rotation'
    ],
    plot: [
      'Tracking accuracy vs. reflectivity r, averaged over the 8 sequences',
      'Ours (red) stays flat on the objects — every baseline falls off with reflectivity',
      'Planar cube: severely underconstrained, advantage does not hold'
    ],
    representation: [
      'Recovered in a single feed-forward pass from one light field capture',
      'Columns: recovered geometry, diffuse–environment decomposition, relit render',
      'Estimated depth, r = 0.7'
    ],
    ablations: [
      'Remove one component at a time; differences clearest at high reflectivity',
      'Predicted masks ≈ ground truth masks',
      'No refinement / no separation → accuracy degrades on reflective objects',
      'Sensor depth in place of light field depth — the most damaging change'
    ],
    supp: [
      'Environment map fills in as motion exposes new reflection directions → approaches the GT panorama',
      'Reflection separation: clean under GT depth; normal noise blurs the map, leaks reflections into diffuse',
      'With clean depth the baselines barely degrade → their collapse is depth corruption, not appearance'
    ]
  };

  // --- chrome -------------------------------------------------------------
  var launch = document.createElement('button');
  launch.id = 'pres-launch';
  launch.innerHTML = '&#9654;&nbsp; Present';
  launch.title = 'Presentation mode (P)';
  document.body.appendChild(launch);

  var controls = document.createElement('div');
  controls.id = 'pres-controls';
  controls.innerHTML =
    '<button id="pres-prev" aria-label="Previous slide" title="Previous (←)">&#10094;</button>' +
    '<span id="pres-counter"></span>' +
    '<button id="pres-next" aria-label="Next slide" title="Next (→)">&#10095;</button>' +
    '<button id="pres-bullets-toggle" aria-label="Toggle bullet summaries" title="Bullet summaries (B)">&#8801;</button>' +
    '<button id="pres-exit" aria-label="Exit presentation" title="Exit (Esc)">&#10005;</button>';
  document.body.appendChild(controls);

  var bulletPanel = document.createElement('div');
  bulletPanel.id = 'pres-bullets';

  // --- reveal machinery ---------------------------------------------------
  function clearReveal() {
    ['pres-path', 'pres-show', 'pres-hide'].forEach(function (cls) {
      Array.prototype.forEach.call(document.querySelectorAll('.' + cls), function (el) {
        el.classList.remove(cls);
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-pres-zoom]'), function (el) {
      el.style.zoom = '';
      el.style.transform = '';
      el.style.transformOrigin = '';
      el.removeAttribute('data-pres-zoom');
    });
  }

  function reveal(el) {
    el.classList.add('pres-show');
    var node = el.parentElement;
    while (node && node !== document.body) {
      node.classList.add('pres-path');
      node = node.parentElement;
    }
  }

  function applyHides() {
    Array.prototype.forEach.call(document.querySelectorAll('.pres-path'), function (anc) {
      Array.prototype.forEach.call(anc.children, function (child) {
        if (child.classList.contains('pres-path') || child.classList.contains('pres-show')) return;
        // Keep the section heading for context on split-out slides.
        if (child.matches && child.matches('h2.title')) return;
        child.classList.add('pres-hide');
      });
    });
  }

  function activeSection() {
    var kids = document.body.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].classList.contains('pres-path') || kids[i].classList.contains('pres-show')) {
        return kids[i];
      }
    }
    return null;
  }

  // Scale the slide's inner container down (never up) so it fits the screen.
  function fit() {
    if (!presenting) return;
    var sect = activeSection();
    if (!sect) return;
    var inner = sect.querySelector(':scope > .container, :scope > .hero-body') || sect.firstElementChild;
    if (!inner) return;
    inner.setAttribute('data-pres-zoom', '1');
    inner.style.zoom = '';
    inner.style.transform = '';
    var rect = inner.getBoundingClientRect();
    if (!rect.height) return;
    var availW = window.innerWidth - 48;
    var availH = window.innerHeight - 64;
    var s = Math.min(1, availW / rect.width, availH / rect.height);
    if (s >= 0.995) return;
    if (zoomable) {
      inner.style.zoom = s;
    } else {
      inner.style.transformOrigin = 'center center';
      inner.style.transform = 'scale(' + s + ')';
    }
  }

  function scheduleFit() {
    requestAnimationFrame(fit);
    setTimeout(fit, 250);
    setTimeout(fit, 900);
  }

  function watchMedia() {
    var sect = activeSection();
    if (!sect) return;
    Array.prototype.forEach.call(sect.querySelectorAll('img'), function (img) {
      if (!img.complete) img.addEventListener('load', scheduleFit, { once: true });
    });
    Array.prototype.forEach.call(sect.querySelectorAll('video'), function (v) {
      if (v.readyState < 1) v.addEventListener('loadedmetadata', scheduleFit, { once: true });
    });
  }

  // Swap the slide's prose for its bullet summary. Prose elements get the
  // (per-show, self-cleaning) pres-hide class; the panel is inserted where
  // the first prose block sat, so it inherits the page layout.
  function applyBullets() {
    bulletPanel.remove();
    var items = bulletMode && BULLETS[order[current]];
    if (!items) return;
    bulletPanel.innerHTML = '<ul>' + items.map(function (b) {
      return '<li>' + b + '</li>';
    }).join('') + '</ul>';
    var sect = activeSection();
    if (!sect) return;
    var prose = [];
    groups[order[current]].forEach(function (el) {
      if (el.matches('.content, h2.subtitle, .figure-caption')) prose.push(el);
      prose = prose.concat(Array.prototype.slice.call(
        el.querySelectorAll('.content, h2.subtitle, .figure-caption')));
    });
    prose.forEach(function (el) { el.classList.add('pres-hide'); });
    if (prose.length) {
      prose[0].parentElement.insertBefore(bulletPanel, prose[0]);
    } else {
      var h2 = sect.querySelector('h2.title');
      if (h2) h2.parentElement.insertBefore(bulletPanel, h2.nextSibling);
      else sect.insertBefore(bulletPanel, sect.firstChild);
    }
  }

  function show(i) {
    current = (i + order.length) % order.length;
    clearReveal();
    groups[order[current]].forEach(reveal);
    applyHides();
    applyBullets();
    document.getElementById('pres-counter').textContent = (current + 1) + ' / ' + order.length;
    document.getElementById('pres-bullets-toggle').classList.toggle('is-active', bulletMode);
    if (presenting) {
      history.replaceState(null, '', '#present-' + (current + 1) + (bulletMode ? 'b' : ''));
    }
    scheduleFit();
    watchMedia();
  }

  // Start from the slide closest to the current scroll position.
  function nearestSlide() {
    var best = 0;
    var bestDist = Infinity;
    order.forEach(function (key, i) {
      var top = groups[key][0].getBoundingClientRect().top;
      var dist = Math.abs(top);
      if (dist < bestDist) { bestDist = dist; best = i; }
    });
    return best;
  }

  function enter() {
    if (presenting) return;
    presenting = true;
    savedScroll = window.scrollY;
    var start = nearestSlide();
    document.body.classList.add('presenting');
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(function () {});
    }
    show(start);
  }

  function exit() {
    if (!presenting) return;
    presenting = false;
    document.body.classList.remove('presenting');
    bulletPanel.remove();
    clearReveal();
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(function () {});
    }
    history.replaceState(null, '', location.pathname + location.search);
    window.scrollTo(0, savedScroll);
  }

  // --- wiring ---------------------------------------------------------------
  launch.addEventListener('click', enter);
  document.getElementById('pres-prev').addEventListener('click', function () { show(current - 1); });
  document.getElementById('pres-next').addEventListener('click', function () { show(current + 1); });
  document.getElementById('pres-exit').addEventListener('click', exit);
  document.getElementById('pres-bullets-toggle').addEventListener('click', function () {
    bulletMode = !bulletMode;
    this.blur();
    show(current);
  });

  document.addEventListener('fullscreenchange', function () {
    if (!document.fullscreenElement && presenting) exit();
  });

  window.addEventListener('resize', function () { if (presenting) scheduleFit(); });

  document.addEventListener('keydown', function (e) {
    // Let form controls and widget buttons keep their keys (range sliders
    // consume arrows, buttons consume space/enter).
    var t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT|BUTTON|VIDEO)$/.test(t.tagName)) return;
    if (!presenting) {
      if (e.key === 'p' || e.key === 'P') { enter(); e.preventDefault(); }
      return;
    }
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case 'PageDown':
      case ' ':
        show(current + 1); e.preventDefault(); break;
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
        show(current - 1); e.preventDefault(); break;
      case 'Home':
        show(0); e.preventDefault(); break;
      case 'End':
        show(order.length - 1); e.preventDefault(); break;
      case 'b':
      case 'B':
        bulletMode = !bulletMode;
        show(current);
        e.preventDefault();
        break;
      case 'Escape':
        exit(); break;
    }
  });

  // Deep link: #present opens presentation mode, #present-7 opens slide 7,
  // a trailing "b" (#present-7b) opens it in bullet mode.
  var hash = location.hash.match(/^#present(?:-(\d+))?(b)?$/);
  if (hash) {
    bulletMode = !!hash[2];
    enter();
    if (hash[1]) show(Math.min(order.length, Math.max(1, parseInt(hash[1], 10))) - 1);
  }
});
