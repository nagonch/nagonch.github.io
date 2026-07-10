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
  var savedScroll = 0;
  var zoomable = (typeof CSS !== 'undefined') && CSS.supports && CSS.supports('zoom', '0.5');

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
    '<button id="pres-exit" aria-label="Exit presentation" title="Exit (Esc)">&#10005;</button>';
  document.body.appendChild(controls);

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

  function show(i) {
    current = (i + order.length) % order.length;
    clearReveal();
    groups[order[current]].forEach(reveal);
    applyHides();
    document.getElementById('pres-counter').textContent = (current + 1) + ' / ' + order.length;
    if (presenting) history.replaceState(null, '', '#present-' + (current + 1));
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
      case 'Escape':
        exit(); break;
    }
  });

  // Deep link: #present opens presentation mode, #present-7 opens slide 7.
  var hash = location.hash.match(/^#present(?:-(\d+))?$/);
  if (hash) {
    enter();
    if (hash[1]) show(Math.min(order.length, Math.max(1, parseInt(hash[1], 10))) - 1);
  }
});
