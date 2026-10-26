/*
 * StickerBottle: cycles sticker PNGs onto the clean bottle photo, one at a time, forever.
 *
 * Usage:
 *   <div id="hero-bottle"></div>
 *   <script src="sticker-bottle.js"></script>
 *   <script>
 *     StickerBottle.mount(document.getElementById('hero-bottle'), {
 *       base: 'base.jpg',
 *       stickers: ['stickers/one.png', 'stickers/two.png', ...]   // transparent PNGs
 *     });
 *   </script>
 *
 * Each sticker is wrapped around the bottle's curve, shaded to match the bottle's lighting,
 * given the bottle's surface texture, pressed on, held, then lifted off.
 */
(function () {
  'use strict';

  var DEFAULTS = {
    // Geometry of base.jpg (image pixels). Only change if you swap the photo.
    imageW: 1519, imageH: 1036,
    cx: 602, cy: 450,          // where the sticker's center sits on the bottle
    radius: 292,               // bottle radius at that height
    tilt: -2.5,                // bottle lean, degrees
    curve: 9,                  // how much the sticker's edges rise with the camera angle
    area: 192000,              // target sticker area so every design looks a similar size
    maxW: 546, maxH: 546,
    // Timing (ms). One sticker = `each` ms including its entrance and exit.
    each: 5000, enter: 700, exit: 500,
    shuffle: false,
    startAt: 0,                // ms into the cycle to begin (e.g. `enter` = first sticker already pressed on)
    onChange: null             // function(index, src) called when a new sticker starts
  };

  function easeOutBack(t) { var c = 1.4; t -= 1; return 1 + (c + 1) * t * t * t + c * t * t; }
  function easeInCubic(t) { return t * t * t; }
  function easeInOut(t) { return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function loadImage(src) {
    return new Promise(function (res) {
      var im = new Image();
      im.crossOrigin = 'anonymous';   // lets the files live on a CDN that sends CORS headers
      im.decoding = 'async';
      im.onload = function () { res(im); };
      im.onerror = function () { console.warn('StickerBottle: could not load', src); res(null); };
      im.src = src;
    });
  }

  function canvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    return c;
  }

  function mount(el, options) {
    var o = {}, k;
    for (k in DEFAULTS) o[k] = DEFAULTS[k];
    for (k in options || {}) o[k] = options[k];

    var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var main = canvas(o.imageW, o.imageH);
    main.style.cssText = 'display:block;width:100%;height:auto;aspect-ratio:' + o.imageW + '/' + o.imageH;
    main.setAttribute('role', 'img');
    main.setAttribute('aria-label', options.label || 'Water bottle showing a rotating selection of stickers');
    el.appendChild(main);
    var ctx = main.getContext('2d');

    // Working region around the sticker spot, in image pixels.
    var RW = 760, RH = 760, RX = o.cx - RW / 2, RY = o.cy - RH / 2;
    var base = null, texture = null, lightMap = null, glareMap = null, stickers = [], order = [], scale = 1;
    var layer = null, lctx = null;

    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = Math.round(el.clientWidth * dpr) || o.imageW;
      scale = w / o.imageW;
      main.width = w; main.height = Math.round(o.imageH * scale);
      layer = canvas(RW * scale, RH * scale); lctx = layer.getContext('2d');
    }

    // High-pass of the bottle surface (grey 128 = flat) to press into each sticker.
    function buildTexture() {
      var c = canvas(RW, RH), x = c.getContext('2d');
      x.drawImage(base, -RX, -RY);
      var small = canvas(RW / 5, RH / 5), sx = small.getContext('2d');
      sx.imageSmoothingQuality = 'high';
      sx.drawImage(c, 0, 0, small.width, small.height);
      var blur = canvas(RW, RH), bx = blur.getContext('2d');
      bx.imageSmoothingQuality = 'high';
      bx.drawImage(small, 0, 0, RW, RH);
      var a = x.getImageData(0, 0, RW, RH), b = bx.getImageData(0, 0, RW, RH), d = a.data, e = b.data;
      for (var i = 0; i < d.length; i += 4) {
        var l1 = d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11;
        var l2 = e[i] * .3 + e[i + 1] * .59 + e[i + 2] * .11;
        var v = clamp(128 + (l1 - l2) * 3.2, 0, 255);
        d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
      }
      x.putImageData(a, 0, 0);
      // Lighting and glare maps sampled from the photo itself, so each sticker is lit
      // exactly like the bottle around it: brighter where the bottle catches light,
      // dimmer in the shadowed middle, with a soft rim on the far side.
      var lm = canvas(RW, RH), gm = canvas(RW, RH);
      var li = bx.createImageData(RW, RH), gi = bx.createImageData(RW, RH), l = li.data, gl = gi.data;
      for (var j = 0; j < e.length; j += 4) {
        var lum = e[j] * .3 + e[j + 1] * .59 + e[j + 2] * .11;
        var m = 255 * (.82 + .2 * clamp((lum - 22) / 42, 0, 1));
        l[j] = m; l[j + 1] = m * .995; l[j + 2] = m * .985; l[j + 3] = 255;   // a touch of room warmth
        var gv = 255 * .55 * clamp((lum - 42) / 60, 0, 1);
        gl[j] = gl[j + 1] = gl[j + 2] = gv; gl[j + 3] = 255;
      }
      lm.getContext('2d').putImageData(li, 0, 0);
      gm.getContext('2d').putImageData(gi, 0, 0);
      lightMap = lm; glareMap = gm;
      return c;
    }

    // Wrap a flat sticker around the cylinder and shade it. Returns {img, w, h} in image pixels.
    function prepare(im) {
      var ar = im.naturalWidth / im.naturalHeight;
      var w = Math.sqrt(o.area * ar), h = w / ar;
      var f = Math.min(1, o.maxW / w, o.maxH / h); w *= f; h *= f;
      var R = o.radius, cs = 2;                       // cache at 2x for sharpness
      var W2 = 2 * R * Math.sin(w / (2 * R));        // on-screen width after wrapping
      var H2 = h + o.curve;
      var c = canvas(W2 * cs, H2 * cs), x = c.getContext('2d');
      x.imageSmoothingQuality = 'high';
      var cols = Math.ceil(W2 * cs), sw = im.naturalWidth;
      for (var i = 0; i < cols; i++) {
        var px = (i + .5) / cs - W2 / 2;              // screen x from sticker center
        var s = R * Math.asin(clamp(px / R, -1, 1));  // arc length on the bottle
        var u = (s / w + .5) * sw;
        var du = sw / w * (R / Math.sqrt(Math.max(1, R * R - px * px))) / cs;
        var lift = o.curve * (1 - Math.cos(s / R)) / (1 - Math.cos(w / 2 / R) || 1);
        x.drawImage(im, clamp(u - du / 2, 0, sw - du), 0, Math.max(du, .01), im.naturalHeight,
          i, (o.curve - lift) * cs, 1.6, h * cs);
      }
      // Curvature falloff: vinyl turning away from the camera reflects a little less light,
      // and the laminate catches a faint broad gloss across its face.
      x.globalCompositeOperation = 'source-atop';
      var g = x.createLinearGradient(0, 0, c.width, 0);
      g.addColorStop(0, 'rgba(0,0,0,.16)');
      g.addColorStop(.18, 'rgba(0,0,0,.04)');
      g.addColorStop(.5, 'rgba(0,0,0,0)');
      g.addColorStop(.82, 'rgba(0,0,0,.05)');
      g.addColorStop(1, 'rgba(0,0,0,.2)');
      x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
      var gl = x.createLinearGradient(0, 0, c.width * .6, c.height);
      gl.addColorStop(0, 'rgba(255,255,255,.07)');
      gl.addColorStop(.5, 'rgba(255,255,255,0)');
      x.fillStyle = gl; x.fillRect(0, 0, c.width, c.height);
      x.globalCompositeOperation = 'source-over';
      return { img: c, w: W2, h: H2 };
    }

    function tiltFor(i) { return Math.sin(i * 12.9898 + 4.1) * 3.5; }

    function drawSticker(st, i, t) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, main.width, main.height);
      ctx.drawImage(base, 0, 0, main.width, main.height);
      if (!st) return;

      var lift = 0, alpha = 1, sheen = -1;
      var holdStart = o.enter, exitStart = o.each - o.exit;
      if (t < o.enter) {
        var p = t / o.enter;
        lift = 1 - easeOutBack(p);
        alpha = clamp(p * 2.2, 0, 1);
      } else if (t > exitStart) {
        var q = (t - exitStart) / o.exit;
        lift = easeInCubic(q);
        alpha = 1 - easeInOut(q);
      } else if (t - holdStart < 1100) {
        sheen = (t - holdStart) / 1100;
      }
      if (reduced) { lift = 0; sheen = -1; }

      var L = Math.max(lift, 0), dir = i % 2 ? 1 : -1;
      var sc = 1 + .16 * lift, rot = (o.tilt + tiltFor(i) + dir * 7 * L) * Math.PI / 180;
      var lx = (o.cx - RX) * scale, ly = (o.cy - RY - 26 * L) * scale;

      function place(c) {
        c.setTransform(scale, 0, 0, scale, 0, 0);
        c.translate(lx / scale, ly / scale); c.rotate(rot); c.scale(sc, sc);
        c.drawImage(st.img, -st.w / 2, -st.h / 2, st.w, st.h);
      }
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.globalCompositeOperation = 'source-over';
      lctx.clearRect(0, 0, layer.width, layer.height);
      place(lctx);
      // Surface texture shows through the vinyl once it is pressed down.
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.globalCompositeOperation = 'overlay';
      lctx.globalAlpha = .38 * (1 - clamp(L, 0, 1));
      lctx.drawImage(texture, 0, 0, layer.width, layer.height);
      lctx.globalAlpha = 1;
      // The photo's own light falloff and glare, fixed to the bottle.
      lctx.globalCompositeOperation = 'multiply';
      lctx.drawImage(lightMap, 0, 0, layer.width, layer.height);
      lctx.globalCompositeOperation = 'screen';
      lctx.drawImage(glareMap, 0, 0, layer.width, layer.height);
      if (sheen >= 0) {
        lctx.globalCompositeOperation = 'screen';
        var sx = (lx / scale - st.w * .9 + sheen * st.w * 1.8) * scale;
        var g = lctx.createLinearGradient(sx - 60 * scale, 0, sx + 60 * scale, 40 * scale);
        var a = Math.sin(sheen * Math.PI) * .22;
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(.5, 'rgba(255,255,255,' + a.toFixed(3) + ')');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        lctx.fillStyle = g; lctx.fillRect(0, 0, layer.width, layer.height);
      }
      lctx.globalCompositeOperation = 'destination-in';
      place(lctx);
      lctx.globalCompositeOperation = 'source-over';

      // Shadow grows as the sticker lifts away from the bottle.
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = 'rgba(0,0,0,' + (.5 - .18 * L).toFixed(3) + ')';
      ctx.shadowBlur = (5 + 34 * L) * scale;
      ctx.shadowOffsetX = (2 + 16 * L) * scale;
      ctx.shadowOffsetY = (3 + 30 * L) * scale;
      ctx.drawImage(layer, RX * scale, RY * scale);
      ctx.restore();
    }

    var start = 0, last = 0, elapsed = +o.startAt || 0, current = -1, raf = 0;
    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (!last) last = now;
      elapsed += Math.min(now - last, 100);   // no jump after a background tab
      last = now;
      if (!order.length) return drawSticker(null);
      var n = Math.floor(elapsed / o.each), idx = order[n % order.length];
      if (n !== current) {
        current = n;
        if (o.shuffle && n % order.length === 0 && n > 0) shuffle(order);
        if (o.onChange) o.onChange(idx, stickers[idx].src);
      }
      drawSticker(stickers[idx], idx, elapsed % o.each);
    }

    function shuffle(a) {
      for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    }

    resize();
    if (window.ResizeObserver) new ResizeObserver(function () {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (Math.round(el.clientWidth * dpr) !== main.width) resize();
    }).observe(el);

    loadImage(o.base).then(function (im) {
      base = im; if (!base) return;
      texture = buildTexture();
      if (!o.startAt) drawSticker(null);   // with startAt, keep the container's pre-rendered fallback until the first sticker is ready
      return Promise.all(o.stickers.map(loadImage));
    }).then(function (ims) {
      if (!ims) return;
      ims.forEach(function (im, i) {
        if (im) { var p = prepare(im); p.src = o.stickers[i]; stickers.push(p); }
      });
      order = stickers.map(function (_, i) { return i; });
      if (o.shuffle) shuffle(order);
      raf = requestAnimationFrame(frame);
    });

    return {
      stop: function () { cancelAnimationFrame(raf); },
      canvas: main
    };
  }

  window.StickerBottle = { mount: mount };
})();
