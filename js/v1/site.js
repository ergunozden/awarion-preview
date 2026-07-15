/* v1 shared page systems: infinite tickers (auto-scroll + drag) and
   in-view reveal animations. Loaded on every page via includes.html.
   Animations respect prefers-reduced-motion and the ?noanim debug param. */
(function () {
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var noanim = location.search.indexOf("noanim") !== -1;

  /* ---- infinite ticker: JS auto-scroll + pointer drag, seamless wrap ----
     markup contract: .ticker-mask > .ticker-track holding TWO identical
     copies of the content, so wrapping at half the track width is invisible. */
  function initTicker(track, speed) {
    track.classList.add("ticker-js");
    var x = 0, dragging = false, px = 0, half = 0, last = performance.now();
    var auto = reduced ? 0 : speed;
    function measure() { half = track.scrollWidth / 2; }
    measure();
    window.addEventListener("resize", measure, { passive: true });
    // late-loading images change the track width - re-measure once settled
    window.addEventListener("load", measure);
    function wrap() {
      if (half <= 0) return;
      while (x > 0) x -= half;
      while (x < -half) x += half;
    }
    function apply() { track.style.transform = "translateX(" + x + "px)"; }
    function frame(now) {
      var dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (!dragging && auto && !document.hidden) { x -= auto * dt; wrap(); apply(); }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    track.addEventListener("dragstart", function (e) { e.preventDefault(); });
    track.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      dragging = true; px = e.clientX;
      track.setPointerCapture(e.pointerId);
      track.classList.add("ticker-dragging");
    });
    track.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      x += e.clientX - px; px = e.clientX; wrap(); apply();
    });
    function up() { dragging = false; track.classList.remove("ticker-dragging"); }
    track.addEventListener("pointerup", up);
    track.addEventListener("pointercancel", up);
  }

  /* ---- in-view reveal: content blocks rise + fade in document order.
     Auto-targets text/images/CTAs outside the self-animating systems
     (hero timeline, tickers, testimonial deck). Opt out with .no-reveal. */
  function initReveal() {
    if (!window.gsap || reduced || noanim) return;
    var EXCLUDE =
      "#v1-hero, #v1-nav, #page-wipe, .ticker-mask, #testimonialsWrapper, " +
      "table, footer, .no-reveal";
    var els = Array.prototype.filter.call(
      document.querySelectorAll("h1,h2,h3,p,img,a.btn-cta,a.btn-subtle,.reveal"),
      function (el) { return !el.closest(EXCLUDE); }
    );
    if (!els.length) return;
    gsap.set(els, { y: 24, autoAlpha: 0 });

    var queue = [], scheduled = false, firstBatch = true;
    function flush() {
      scheduled = false;
      var batch = queue; queue = [];
      batch.sort(function (a, b) {
        return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });
      gsap.to(batch, {
        y: 0,
        autoAlpha: 1,
        duration: 0.7,
        ease: "power3.out",
        stagger: 0.08,
        // the page wipe is still revealing on first paint - let it lead
        delay: firstBatch ? 0.35 : 0,
        overwrite: true,
        // release transform so CSS hover lifts (.btn-cta) work afterwards
        clearProps: "transform",
      });
      firstBatch = false;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        queue.push(en.target);
      });
      if (queue.length && !scheduled) {
        scheduled = true;
        requestAnimationFrame(flush);
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ---- content hub tag rail: drag-to-scroll ---- */
  function initTagRails() {
    document.querySelectorAll(".tag-rail").forEach(function (rail) {
      var down = false, moved = false, sx = 0, sl = 0;
      // edge fades only where content is actually hidden
      function fades() {
        rail.classList.toggle("fade-left", rail.scrollLeft > 2);
        rail.classList.toggle(
          "fade-right",
          rail.scrollLeft < rail.scrollWidth - rail.clientWidth - 2
        );
      }
      fades();
      rail.addEventListener("scroll", fades, { passive: true });
      window.addEventListener("resize", fades, { passive: true });
      // NOTE: no preventDefault / pointer capture on pointerdown - both
      // suppress the click event and break the tab filters. Text selection
      // is already blocked by user-select:none in CSS; the drag only
      // engages (and captures) after real movement.
      rail.addEventListener("dragstart", function (e) { e.preventDefault(); });
      rail.addEventListener("pointerdown", function (e) {
        down = true; moved = false; sx = e.clientX; sl = rail.scrollLeft;
      });
      rail.addEventListener("pointermove", function (e) {
        if (!down) return;
        var dx = e.clientX - sx;
        if (!moved && Math.abs(dx) > 4) {
          moved = true;
          rail.classList.add("dragging");
          rail.setPointerCapture(e.pointerId);
        }
        if (moved) rail.scrollLeft = sl - dx;
      });
      function up() { down = false; rail.classList.remove("dragging"); }
      rail.addEventListener("pointerup", up);
      rail.addEventListener("pointercancel", up);
      // swallow the click that ends a drag so a tab isn't accidentally selected
      rail.addEventListener("click", function (e) {
        if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; }
      }, true);
    });
  }

  /* ---- stat count-ups: [data-countup] elements animate their number
     the first time they scroll into view (e.g. "81%" counts 0 -> 81) ---- */
  function initCountUps() {
    var els = document.querySelectorAll("[data-countup]");
    if (!els.length) return;
    if (reduced || noanim || !("IntersectionObserver" in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        var el = en.target;
        var m = el.textContent.match(/([\d.,]+)/);
        if (!m) return;
        var target = parseFloat(m[1].replace(/,/g, ""));
        var prefix = el.textContent.slice(0, m.index);
        var suffix = el.textContent.slice(m.index + m[1].length);
        var t0 = null, DUR = 1300;
        function step(t) {
          if (!t0) t0 = t;
          var p = Math.min(1, (t - t0) / DUR);
          var e = 1 - Math.pow(1 - p, 3);
          el.textContent = prefix + Math.round(target * e) + suffix;
          if (p < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
      });
    }, { threshold: 0.4 });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ---- smooth scroll (Lenis, loaded by includes) ---- */
  function initSmoothScroll() {
    if (!window.Lenis || reduced || noanim) return;
    var lenis = new Lenis({
      lerp: 0.085,
      wheelMultiplier: 1,
      smoothWheel: true,
    });
    function raf(t) { lenis.raf(t); requestAnimationFrame(raf); }
    requestAnimationFrame(raf);
  }

  function boot() {
    document.querySelectorAll(".ticker-track").forEach(function (track) {
      initTicker(track, track.classList.contains("ticker-track--ads") ? 30 : 40);
    });
    initReveal();
    initTagRails();
    initCountUps();
    initSmoothScroll();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
