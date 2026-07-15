/* Awarion real-time network data - PoC data layer.
   Source order: live endpoint -> sessionStorage cache -> simulated feed.
   To go live, set window.AWARION_RT_ENDPOINT = "https://..." before this
   script loads. Expected JSON shape:
   { "screens_online": 332, "screens_total": 340,
     "impressions_today": 1284503, "availability_pct": 97.6 } */
(function () {
  "use strict";

  var ENDPOINT = window.AWARION_RT_ENDPOINT || null;
  var POLL_MS = 8000;
  var CACHE_KEY = "awarion-rt-snapshot";
  var CACHE_TTL_MS = 60000;
  var FETCH_TIMEOUT_MS = 4000;

  var subscribers = [];
  var current = null;

  /* ---------- cache ---------- */
  function readCache() {
    try {
      var raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var entry = JSON.parse(raw);
      if (Date.now() - entry.t > CACHE_TTL_MS) return null;
      return entry.d;
    } catch (e) { return null; }
  }
  function writeCache(data) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), d: data }));
    } catch (e) { /* storage full or blocked - cache is optional */ }
  }

  /* ---------- simulated feed (deterministic, clock-driven) ---------- */
  var TOTAL_SCREENS = 340;
  function dayFraction(now) {
    var tz = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).format(now).split(":");
    var mins = parseInt(tz[0], 10) * 60 + parseInt(tz[1], 10);
    return mins / 1440;
  }
  function simulate() {
    var now = new Date();
    var f = dayFraction(now);
    // screens wander slowly between 326 and 338 on a ~20 min cycle
    var cycle = Math.sin((now.getTime() / 60000 / 20) * 2 * Math.PI);
    var online = Math.round(332 + cycle * 6);
    // impressions accumulate on an S-curve: slow overnight, busy 08:00-22:00
    var activity = Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, (f - 0.25) / 0.7))));
    var target = 1900000; // plausible daily total for a 300+ screen network
    var accumulated = Math.round(target * (0.06 + 0.94 * easedProgress(f)) * (0.97 + 0.03 * activity));
    return {
      screens_online: online,
      screens_total: TOTAL_SCREENS,
      impressions_today: accumulated,
      availability_pct: Math.round((online / TOTAL_SCREENS) * 1000) / 10
    };
  }
  function easedProgress(f) {
    // fraction of the daily impression total delivered by day-fraction f
    if (f < 0.25) return f * 0.12;                       // 00:00-06:00 trickle
    if (f < 0.92) return 0.03 + (f - 0.25) / 0.67 * 0.9; // 06:00-22:00 main ramp
    return 0.93 + (f - 0.92) / 0.08 * 0.07;              // late evening tail
  }

  /* ---------- live fetch with timeout ---------- */
  function fetchLive() {
    if (!ENDPOINT || typeof fetch !== "function") return Promise.reject();
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctrl && setTimeout(function () { ctrl.abort(); }, FETCH_TIMEOUT_MS);
    return fetch(ENDPOINT, ctrl ? { signal: ctrl.signal } : undefined)
      .then(function (r) {
        if (timer) clearTimeout(timer);
        if (!r.ok) throw new Error("rt http " + r.status);
        return r.json();
      })
      .then(function (d) {
        if (typeof d.screens_online !== "number") throw new Error("rt shape");
        return d;
      });
  }

  /* ---------- feed loop ---------- */
  function publish(data) {
    current = data;
    for (var i = 0; i < subscribers.length; i++) subscribers[i](data);
  }
  function refresh() {
    fetchLive()
      .then(function (d) { writeCache(d); publish(d); })
      .catch(function () {
        publish(readCache() || simulate());
      });
  }

  window.AwarionRealtime = {
    subscribe: function (cb) {
      subscribers.push(cb);
      if (current) cb(current);
    },
    now: function () { return current; }
  };

  refresh();
  setInterval(refresh, POLL_MS);

  /* ---------- animated counters ----------
     <el data-rt="impressions_today" data-rt-decimals="0" data-rt-suffix="%">
     Counts up on first reveal, then tweens between feed updates. */
  var REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var counters = [];

  function fmt(v, decimals) {
    return v.toLocaleString("en-US", {
      minimumFractionDigits: decimals, maximumFractionDigits: decimals
    });
  }

  function Counter(el) {
    this.el = el;
    this.key = el.getAttribute("data-rt");
    this.decimals = parseInt(el.getAttribute("data-rt-decimals") || "0", 10);
    this.suffix = el.getAttribute("data-rt-suffix") || "";
    this.shown = 0;
    this.targetV = null;
    this.revealed = false;
    this.anim = null;
  }
  Counter.prototype.set = function (v) {
    this.targetV = v;
    if (this.revealed) this.tween(this.shown, v, this.shown === 0 ? 900 : 600);
  };
  Counter.prototype.reveal = function () {
    this.revealed = true;
    if (this.targetV !== null) this.tween(0, this.targetV, 900);
  };
  Counter.prototype.tween = function (from, to, dur) {
    var self = this;
    if (REDUCED || from === to) { self.render(to); return; }
    if (self.anim) cancelAnimationFrame(self.anim);
    var t0 = null; // anchor to the rAF clock, not performance.now()
    self.anim = requestAnimationFrame(function step(t) {
      if (t0 === null) t0 = t;
      var p = Math.min(1, (t - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3); // ease-out cubic
      self.render(from + (to - from) * e);
      if (p < 1) self.anim = requestAnimationFrame(step);
    });
  };
  Counter.prototype.render = function (v) {
    this.shown = v;
    this.el.textContent = fmt(this.decimals ? v : Math.round(v), this.decimals) + this.suffix;
  };

  function initCounters() {
    var els = document.querySelectorAll("[data-rt]");
    if (!els.length) return;
    for (var i = 0; i < els.length; i++) counters.push(new Counter(els[i]));

    window.AwarionRealtime.subscribe(function (d) {
      for (var i = 0; i < counters.length; i++) {
        var v = d[counters[i].key];
        if (typeof v === "number") counters[i].set(v);
      }
    });

    if ("IntersectionObserver" in window && !REDUCED) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          io.unobserve(en.target);
          for (var i = 0; i < counters.length; i++) {
            if (counters[i].el === en.target) counters[i].reveal();
          }
        });
      }, { threshold: 0.4 });
      counters.forEach(function (c) { io.observe(c.el); });
    } else {
      counters.forEach(function (c) { c.reveal(); });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initCounters);
  } else {
    initCounters();
  }
})();
