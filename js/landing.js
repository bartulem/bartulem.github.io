/**
 * Landing-page animation for bartulem.github.io.
 *
 * Draws a slowly drifting wireframe globe behind the identity block, marks the
 * three cities of the biography (Split, Trondheim, Princeton), and lets a point
 * of light travel between them in chronological order. The city under the
 * light, or under the visitor's cursor or keyboard focus, is highlighted.
 *
 * Below the identity block a recording of two tracked mice and the spectrogram
 * of their vocalisations plays in a loop (a <video> element with a caption,
 * placed by layout(); it is not drawn on the canvas).
 *
 * The globe is dim by default and brightens under a "spotlight" that follows
 * both the travelling light and the visitor's cursor.
 *
 * The three field words under the name take turns changing: a word fades to
 * the background colour and another word from a pool of keywords takes its place.
 *
 * Requires the global LAND_RINGS array defined in js/land.js. Has no other
 * dependencies.
 */
(function () {
  'use strict';

  /* ----------------------------------------------------------------------
     Configuration
     ---------------------------------------------------------------------- */

  /** Degrees-to-radians conversion factor. */
  const DEG = Math.PI / 180;

  /**
   * The three cities, in chronological order.
   *
   * key   : matches the data-city attribute of the label button in index.html
   * lon   : longitude in degrees (east positive)
   * lat   : latitude in degrees (north positive)
   * color : accent colour of the city and its chapter, as [r, g, b]
   */
  const CITIES = [
    {
      key: 'split',
      lon: 16.44,
      lat: 43.51,
      color: [217, 217, 217]
    },
    {
      key: 'trondheim',
      lon: 10.40,
      lat: 63.43,
      color: [0, 80, 158]
    },
    {
      key: 'princeton',
      lon: -74.66,
      lat: 40.35,
      color: [231, 117, 0]
    }
  ];

  /**
   * Timeline of the travelling light, as consecutive segments (seconds).
   *
   * type 'dwell'  : the light rests on city `city`, which is highlighted
   * type 'travel' : the light moves along arc `arc` (0: Split -> Trondheim,
   *                 1: Trondheim -> Princeton); no city is highlighted
   * type 'gap'    : the light fades out at Princeton and back in at Split
   */
  const TIMELINE = [
    { type: 'dwell', city: 0, duration: 4.0 },
    { type: 'travel', arc: 0, duration: 2.5 },
    { type: 'dwell', city: 1, duration: 4.0 },
    { type: 'travel', arc: 1, duration: 3.5 },
    { type: 'dwell', city: 2, duration: 5.0 },
    { type: 'gap', duration: 1.6 }
  ];

  /** Total duration of one pass through TIMELINE (seconds). */
  const TIMELINE_TOTAL = TIMELINE.reduce(function (sum, segment) { return sum + segment.duration; }, 0);

  /** Resting view centre of the globe (degrees); all three cities sit in the upper half. */
  const VIEW_LON = -28;
  const VIEW_LAT = 19;

  /** Width-to-height ratio of the video of the two mice (files/mice_usv_dark.mp4). */
  const VIDEO_ASPECT = 874 / 600;

  /** Base text colour used for coastlines and neutral strokes, as "r, g, b". */
  const INK = '214, 210, 201';

  /* ----------------------------------------------------------------------
     DOM handles and state
     ---------------------------------------------------------------------- */

  const hero = document.getElementById('hero');
  const canvas = document.getElementById('globe');
  const identity = hero.querySelector('.identity');
  const vocalVideo = document.getElementById('vocal-video');
  const videoCaption = document.getElementById('video-caption');
  const cityButtons = CITIES.map(function (city) {
    return hero.querySelector('.city[data-city="' + city.key + '"]');
  });

  const ctx = canvas.getContext('2d');

  /** Off-screen layer holding the full-brightness globe (disc, graticule, coastlines). */
  const globeLayer = document.createElement('canvas');
  const globeCtx = globeLayer.getContext('2d');

  /** Off-screen layer holding the globe masked by the spotlights. */
  const spotLayer = document.createElement('canvas');
  const spotCtx = spotLayer.getContext('2d');

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Geometry of the hero, refreshed by layout(). All values in CSS pixels. */
  const view = {
    width: 0,          // hero width
    height: 0,         // hero height
    dpr: 1,            // device pixel ratio used for the canvases (capped at 2)
    cx: 0,             // globe centre x
    cy: 0,             // globe centre y
    radius: 0,         // globe radius
    lon0: VIEW_LON * DEG,   // current view centre longitude (radians)
    lat0: VIEW_LAT * DEG,   // current view centre latitude (radians)
    sinLat0: 0,        // sine of lat0, cached per frame
    cosLat0: 1,        // cosine of lat0, cached per frame
    buttonSizes: []    // [width, height] of each city button
  };

  /** Interaction and animation state. */
  const state = {
    clock: reducedMotion ? 3.2 : 0,   // animation time (seconds)
    lastStamp: 0,                     // timestamp of the previous frame (ms)
    running: false,                   // whether the animation loop is scheduled
    visible: true,                    // whether the hero is on screen
    hovered: -1,                      // city index under the cursor / keyboard focus, or -1
    pointer: { x: 0, y: 0, inside: false, sx: 0, sy: 0 }   // cursor position and smoothed parallax
  };

  /* ----------------------------------------------------------------------
     Small helpers
     ---------------------------------------------------------------------- */

  /**
   * Clamp a number to a closed interval.
   *
   * @param {number} value - Number to clamp.
   * @param {number} low - Lower bound.
   * @param {number} high - Upper bound.
   * @returns {number} The clamped value.
   */
  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  /**
   * Smoothstep easing on the unit interval.
   *
   * @param {number} u - Input, clamped to [0, 1].
   * @returns {number} Eased value in [0, 1] with zero slope at both ends.
   */
  function ease(u) {
    const c = clamp(u, 0, 1);
    return c * c * (3 - 2 * c);
  }

  /**
   * Build an rgba() colour string from an [r, g, b] triplet and an opacity.
   *
   * @param {number[]} color - Colour as [r, g, b], each 0..255.
   * @param {number} alpha - Opacity, 0..1.
   * @returns {string} CSS rgba() string.
   */
  function rgba(color, alpha) {
    return 'rgba(' + color[0] + ', ' + color[1] + ', ' + color[2] + ', ' + alpha + ')';
  }

  /* ----------------------------------------------------------------------
     Globe geometry
     ---------------------------------------------------------------------- */

  /**
   * Coastline rings prepared for fast projection.
   *
   * Each entry holds three Float32Arrays of equal length: longitude (radians),
   * cosine of latitude and sine of latitude of every point of the ring.
   */
  const land = LAND_RINGS.map(function (ring) {
    const count = ring.length / 2;
    const lon = new Float32Array(count);
    const cosLat = new Float32Array(count);
    const sinLat = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const latitude = ring[2 * i + 1] / 10 * DEG;
      lon[i] = ring[2 * i] / 10 * DEG;
      cosLat[i] = Math.cos(latitude);
      sinLat[i] = Math.sin(latitude);
    }
    return { lon: lon, cosLat: cosLat, sinLat: sinLat };
  });

  /**
   * Orthographic projection of a point on the unit sphere onto the screen.
   *
   * Uses the current view centre (view.lon0, view.lat0) and globe placement
   * (view.cx, view.cy, view.radius). Writes into the shared `projected` object
   * to avoid allocating in the inner loops.
   *
   * @param {number} lon - Longitude in radians.
   * @param {number} cosLat - Cosine of the latitude.
   * @param {number} sinLat - Sine of the latitude.
   * @returns {{x: number, y: number, depth: number}} Screen position in CSS
   *     pixels and depth (> 0 when the point is on the visible hemisphere).
   */
  function project(lon, cosLat, sinLat) {
    const dLon = lon - view.lon0;
    const cosD = Math.cos(dLon);
    projected.x = view.cx + view.radius * cosLat * Math.sin(dLon);
    projected.y = view.cy - view.radius * (view.cosLat0 * sinLat - view.sinLat0 * cosLat * cosD);
    projected.depth = view.sinLat0 * sinLat + view.cosLat0 * cosLat * cosD;
    return projected;
  }

  /** Shared result object of project(). */
  const projected = { x: 0, y: 0, depth: 0 };

  /**
   * Project a point given by longitude and latitude in radians.
   *
   * @param {number} lon - Longitude in radians.
   * @param {number} lat - Latitude in radians.
   * @returns {{x: number, y: number, depth: number}} See project().
   */
  function projectLonLat(lon, lat) {
    return project(lon, Math.cos(lat), Math.sin(lat));
  }

  /**
   * Sample the great-circle path between two cities.
   *
   * @param {{lon: number, lat: number}} from - Start city (degrees).
   * @param {{lon: number, lat: number}} to - End city (degrees).
   * @param {number} steps - Number of intervals; the result has steps + 1 points.
   * @returns {number[][]} Points along the arc as [longitude, latitude] in radians.
   */
  function greatCircle(from, to, steps) {
    const a = unitVector(from.lon * DEG, from.lat * DEG);
    const b = unitVector(to.lon * DEG, to.lat * DEG);
    const omega = Math.acos(clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1));
    const points = [];
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const wa = Math.sin((1 - u) * omega) / Math.sin(omega);
      const wb = Math.sin(u * omega) / Math.sin(omega);
      const x = wa * a[0] + wb * b[0];
      const y = wa * a[1] + wb * b[1];
      const z = wa * a[2] + wb * b[2];
      points.push([Math.atan2(y, x), Math.asin(clamp(z, -1, 1))]);
    }
    return points;
  }

  /**
   * Unit vector of a point on the sphere.
   *
   * @param {number} lon - Longitude in radians.
   * @param {number} lat - Latitude in radians.
   * @returns {number[]} Cartesian [x, y, z] with z towards the north pole.
   */
  function unitVector(lon, lat) {
    return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  }

  /** Number of intervals used to sample each travel arc. */
  const ARC_STEPS = 48;

  /** The two travel arcs: Split -> Trondheim and Trondheim -> Princeton. */
  const ARCS = [
    greatCircle(CITIES[0], CITIES[1], ARC_STEPS),
    greatCircle(CITIES[1], CITIES[2], ARC_STEPS)
  ];

  /* ----------------------------------------------------------------------
     Layout
     ---------------------------------------------------------------------- */

  /**
   * Measure the hero and place the globe, the video and its caption.
   *
   * Called on load and whenever the hero is resized. Resizes the three
   * canvases to the device pixel ratio (capped at 2 to bound the fill cost).
   *
   * @returns {void}
   */
  function layout() {
    const rect = hero.getBoundingClientRect();
    view.width = rect.width;
    view.height = rect.height;
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);

    [canvas, globeLayer, spotLayer].forEach(function (layer) {
      layer.width = Math.round(view.width * view.dpr);
      layer.height = Math.round(view.height * view.dpr);
    });

    view.cx = view.width / 2;
    view.cy = view.height / 2;
    // On narrow screens the globe is allowed to overflow sideways so that it stays legible.
    const widthShare = view.width < 700 ? 0.62 : 0.46;
    view.radius = Math.min(view.height * 0.44, view.width * widthShare);

    // The video sits directly under the identity block and its caption under the
    // video; together they use the room left above the scroll cue.
    const idRect = identity.getBoundingClientRect();
    const videoTop = idRect.bottom - rect.top + 14;
    const captionRoom = videoCaption.offsetHeight + 8;
    let videoHeight = clamp(view.height - videoTop - captionRoom - 52, 90, 280);
    let videoWidth = videoHeight * VIDEO_ASPECT;
    if (videoWidth > view.width * 0.94) {
      videoWidth = view.width * 0.94;
      videoHeight = videoWidth / VIDEO_ASPECT;
    }
    vocalVideo.style.top = videoTop + 'px';
    vocalVideo.style.width = videoWidth + 'px';
    vocalVideo.style.height = videoHeight + 'px';
    videoCaption.style.top = (videoTop + videoHeight + 6) + 'px';

    view.buttonSizes = cityButtons.map(function (button) {
      return [button.offsetWidth, button.offsetHeight];
    });
  }

  /* ----------------------------------------------------------------------
     Timeline of the travelling light
     ---------------------------------------------------------------------- */

  /**
   * Evaluate the timeline of the travelling light at a given time.
   *
   * @param {number} time - Animation time in seconds.
   * @returns {{city: number, lon: number, lat: number, alpha: number, arc: number, progress: number}}
   *     city     : index of the city whose chapter the timeline shows, or -1
   *     lon, lat : position of the light in radians
   *     alpha    : brightness of the light, 0..1
   *     arc      : index of the arc being travelled, or -1
   *     progress : eased progress along that arc, 0..1
   */
  function evaluateTimeline(time) {
    let local = time % TIMELINE_TOTAL;
    for (let i = 0; i < TIMELINE.length; i++) {
      const segment = TIMELINE[i];
      if (local < segment.duration) {
        const u = local / segment.duration;
        if (segment.type === 'dwell') {
          const city = CITIES[segment.city];
          return { city: segment.city, lon: city.lon * DEG, lat: city.lat * DEG, alpha: 1, arc: -1, progress: 0 };
        }
        if (segment.type === 'travel') {
          const progress = ease(u);
          const arc = ARCS[segment.arc];
          const position = progress * ARC_STEPS;
          const index = Math.min(Math.floor(position), ARC_STEPS - 1);
          const frac = position - index;
          return {
            city: -1,
            lon: arc[index][0] + (arc[index + 1][0] - arc[index][0]) * frac,
            lat: arc[index][1] + (arc[index + 1][1] - arc[index][1]) * frac,
            alpha: 1,
            arc: segment.arc,
            progress: progress
          };
        }
        // 'gap': fade out at the last city during the first half, fade in at the first city after.
        const city = u < 0.5 ? CITIES[CITIES.length - 1] : CITIES[0];
        return { city: -1, lon: city.lon * DEG, lat: city.lat * DEG, alpha: Math.abs(2 * u - 1), arc: -1, progress: 0 };
      }
      local -= segment.duration;
    }
    return { city: -1, lon: CITIES[0].lon * DEG, lat: CITIES[0].lat * DEG, alpha: 0, arc: -1, progress: 0 };
  }

  /* ----------------------------------------------------------------------
     Drawing: globe
     ---------------------------------------------------------------------- */

  /**
   * Draw the full-brightness globe (disc, graticule, coastlines) into globeLayer.
   *
   * @returns {void}
   */
  function drawGlobeLayer() {
    const g = globeCtx;
    g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    g.clearRect(0, 0, view.width, view.height);

    // Disc and rim.
    const glow = g.createRadialGradient(view.cx, view.cy, 0, view.cx, view.cy, view.radius);
    glow.addColorStop(0, 'rgba(95, 176, 220, 0.10)');
    glow.addColorStop(1, 'rgba(95, 176, 220, 0.02)');
    g.fillStyle = glow;
    g.beginPath();
    g.arc(view.cx, view.cy, view.radius, 0, 2 * Math.PI);
    g.fill();
    g.strokeStyle = 'rgba(' + INK + ', 0.45)';
    g.lineWidth = 1;
    g.stroke();

    // Graticule: meridians and parallels every 30 degrees, sampled every 5 degrees.
    g.beginPath();
    for (let lonDeg = -180; lonDeg < 180; lonDeg += 30) {
      let drawing = false;
      for (let latDeg = -90; latDeg <= 90; latDeg += 5) {
        const p = projectLonLat(lonDeg * DEG, latDeg * DEG);
        if (p.depth > 0) {
          if (drawing) { g.lineTo(p.x, p.y); } else { g.moveTo(p.x, p.y); }
          drawing = true;
        } else {
          drawing = false;
        }
      }
    }
    for (let latDeg = -60; latDeg <= 60; latDeg += 30) {
      let drawing = false;
      for (let lonDeg = -180; lonDeg <= 180; lonDeg += 5) {
        const p = projectLonLat(lonDeg * DEG, latDeg * DEG);
        if (p.depth > 0) {
          if (drawing) { g.lineTo(p.x, p.y); } else { g.moveTo(p.x, p.y); }
          drawing = true;
        } else {
          drawing = false;
        }
      }
    }
    g.strokeStyle = 'rgba(' + INK + ', 0.16)';
    g.lineWidth = 0.5;
    g.stroke();

    // Coastlines: only segments whose both ends are on the visible hemisphere.
    g.beginPath();
    for (let r = 0; r < land.length; r++) {
      const ring = land[r];
      let drawing = false;
      for (let i = 0; i < ring.lon.length; i++) {
        const p = project(ring.lon[i], ring.cosLat[i], ring.sinLat[i]);
        if (p.depth > 0) {
          if (drawing) { g.lineTo(p.x, p.y); } else { g.moveTo(p.x, p.y); }
          drawing = true;
        } else {
          drawing = false;
        }
      }
    }
    g.strokeStyle = 'rgba(' + INK + ', 0.95)';
    g.lineWidth = 0.9;
    g.lineJoin = 'round';
    g.stroke();
  }

  /**
   * Composite the globe onto the main canvas: dim everywhere, bright under the spotlights.
   *
   * @param {{x: number, y: number, radius: number, alpha: number}[]} spots -
   *     Spotlights in CSS pixels; alpha is the peak brightness, 0..1.
   * @returns {void}
   */
  function compositeGlobe(spots) {
    // Dim base.
    ctx.globalAlpha = 0.26;
    ctx.drawImage(globeLayer, 0, 0, view.width, view.height);
    ctx.globalAlpha = 1;

    // Spotlight mask, then keep only the globe pixels inside it.
    const s = spotCtx;
    s.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    s.globalCompositeOperation = 'source-over';
    s.clearRect(0, 0, view.width, view.height);
    for (let i = 0; i < spots.length; i++) {
      const spot = spots[i];
      if (spot.alpha <= 0.01) { continue; }
      const gradient = s.createRadialGradient(spot.x, spot.y, 0, spot.x, spot.y, spot.radius);
      gradient.addColorStop(0, 'rgba(255, 255, 255, ' + spot.alpha + ')');
      gradient.addColorStop(0.5, 'rgba(255, 255, 255, ' + (spot.alpha * 0.45) + ')');
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
      s.fillStyle = gradient;
      s.fillRect(spot.x - spot.radius, spot.y - spot.radius, 2 * spot.radius, 2 * spot.radius);
    }
    s.globalCompositeOperation = 'source-in';
    s.drawImage(globeLayer, 0, 0, view.width, view.height);

    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(spotLayer, 0, 0, view.width, view.height);
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Draw the two travel arcs, the travelling light and the city markers,
   * and move the city label buttons onto their markers.
   *
   * @param {object} light - Result of evaluateTimeline().
   * @param {number} active - Index of the active city, or -1.
   * @returns {{x: number, y: number}} Screen position of the travelling light.
   */
  function drawRoutes(light, active) {
    // Faint dashed arcs, with a bright trail on the part already travelled.
    for (let a = 0; a < ARCS.length; a++) {
      const arc = ARCS[a];
      ctx.beginPath();
      for (let i = 0; i <= ARC_STEPS; i++) {
        const p = projectLonLat(arc[i][0], arc[i][1]);
        if (i === 0) { ctx.moveTo(p.x, p.y); } else { ctx.lineTo(p.x, p.y); }
      }
      ctx.setLineDash([2, 5]);
      ctx.strokeStyle = 'rgba(' + INK + ', 0.38)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);

      if (light.arc === a) {
        const last = light.progress * ARC_STEPS;
        const first = Math.max(0, last - ARC_STEPS * 0.45);
        ctx.beginPath();
        let started = false;
        for (let i = Math.ceil(first); i <= Math.floor(last); i++) {
          const p = projectLonLat(arc[i][0], arc[i][1]);
          if (started) { ctx.lineTo(p.x, p.y); } else { ctx.moveTo(p.x, p.y); }
          started = true;
        }
        const head = projectLonLat(light.lon, light.lat);
        if (started) { ctx.lineTo(head.x, head.y); }
        ctx.strokeStyle = 'rgba(245, 236, 208, 0.75)';
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
    }

    // City markers and label buttons.
    for (let c = 0; c < CITIES.length; c++) {
      const city = CITIES[c];
      const p = projectLonLat(city.lon * DEG, city.lat * DEG);
      const x = p.x;
      const y = p.y;
      const isActive = c === active;

      if (isActive) {
        // Expanding ring, repeating every 2 seconds.
        const phase = (state.clock % 2) / 2;
        ctx.beginPath();
        ctx.arc(x, y, 5 + 13 * phase, 0, 2 * Math.PI);
        ctx.strokeStyle = rgba(city.color, 0.6 * (1 - phase));
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      const halo = ctx.createRadialGradient(x, y, 0, x, y, 12);
      halo.addColorStop(0, rgba(city.color, isActive ? 0.55 : 0.3));
      halo.addColorStop(1, rgba(city.color, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(x - 12, y - 12, 24, 24);
      ctx.beginPath();
      ctx.arc(x, y, isActive ? 3.4 : 2.6, 0, 2 * Math.PI);
      ctx.fillStyle = rgba(city.color, 1);
      ctx.fill();

      // The button's bottom padding covers the marker, so marker and label are one target.
      const size = view.buttonSizes[c];
      const button = cityButtons[c];
      // Centred over the marker, but kept inside the page so that a long note is not cut off.
      const buttonX = clamp(x - size[0] / 2, 4, Math.max(4, view.width - size[0] - 4));
      button.style.transform = 'translate(' + buttonX.toFixed(1) + 'px, ' + (y - size[1] + 12).toFixed(1) + 'px)';
      button.classList.toggle('active', isActive);
    }

    // Travelling light.
    const head = projectLonLat(light.lon, light.lat);
    const hx = head.x;
    const hy = head.y;
    if (light.alpha > 0.01 && light.arc >= 0) {
      const flare = ctx.createRadialGradient(hx, hy, 0, hx, hy, 16);
      flare.addColorStop(0, 'rgba(250, 240, 210, ' + (0.9 * light.alpha) + ')');
      flare.addColorStop(0.25, 'rgba(250, 240, 210, ' + (0.35 * light.alpha) + ')');
      flare.addColorStop(1, 'rgba(250, 240, 210, 0)');
      ctx.fillStyle = flare;
      ctx.fillRect(hx - 16, hy - 16, 32, 32);
    }
    return { x: hx, y: hy };
  }

  /* ----------------------------------------------------------------------
     Video
     ---------------------------------------------------------------------- */

  /**
   * Play or pause the video of the two mice.
   *
   * The video loops while the landing screen is visible and is paused when it
   * is scrolled away or the tab is hidden. With reduced motion it is never
   * started, so it stays on its first frame.
   *
   * @param {boolean} shouldPlay - Whether the video should be playing.
   * @returns {void}
   */
  function setVideoPlaying(shouldPlay) {
    if (reducedMotion) { return; }
    if (shouldPlay && vocalVideo.paused) {
      const started = vocalVideo.play();
      // Browsers may refuse to start playback (for example in data-saver mode); the first frame still shows.
      if (started !== undefined) { started.catch(function () {}); }
    } else if (!shouldPlay && !vocalVideo.paused) {
      vocalVideo.pause();
    }
  }

  /* ----------------------------------------------------------------------
     Rotating field words
     ---------------------------------------------------------------------- */

  /** Time between two changes of the same field word (milliseconds). */
  const FIELD_INTERVAL = 6000;

  /** Delay between the changes of neighbouring field words, so that they take turns (milliseconds). */
  const FIELD_STAGGER = 2000;

  /** Time a word takes to fade to the background colour before it is replaced (milliseconds). */
  const FIELD_FADE = 900;

  /** Time the faded new word waits, while the line re-centres, before it takes its colour (milliseconds). */
  const FIELD_SETTLE = 350;

  /**
   * Change one of the three field words under the name into another word.
   *
   * The new word is drawn at random from the pool, skipping the words the
   * line currently shows and any word that would make the line wider than the
   * page allows. The change has three steps: the old word's colour fades to
   * almost the background colour; the new word is put in its place, still
   * faded, and the slot's width eases to the new word's width so that the line
   * re-centres smoothly; then the new word's colour comes up. A slot that must
   * grow starts growing during the first step, so that the new word never
   * reaches into its neighbours.
   *
   * @param {Element} slot - The field word's outer <span class="field">.
   * @param {Element[]} slots - All three slots.
   * @param {string[]} pool - All words that may be shown.
   * @param {Element} ruler - Hidden element in the same type style, used to measure words.
   * @returns {void}
   */
  function changeField(slot, slots, pool, ruler) {
    const inner = slot.firstElementChild;
    const line = slot.parentElement;
    const shown = slots.map(function (other) { return other.dataset.word; });
    const room = view.width * 0.92 - (line.getBoundingClientRect().width - slot.getBoundingClientRect().width);
    const candidates = pool.filter(function (word) {
      if (shown.indexOf(word) !== -1) { return false; }
      ruler.textContent = word;
      return ruler.getBoundingClientRect().width <= room;
    });
    if (candidates.length === 0) { return; }
    const word = candidates[Math.floor(Math.random() * candidates.length)];
    ruler.textContent = word;
    const width = ruler.getBoundingClientRect().width;

    slot.dataset.word = word;
    const current = slot.getBoundingClientRect().width;
    slot.style.width = current + 'px';   // pin the current width so that it can ease
    inner.classList.add('dim');
    window.setTimeout(function () {
      if (width > current) { slot.style.width = width + 'px'; }
    }, FIELD_FADE - FIELD_SETTLE);
    window.setTimeout(function () {
      inner.textContent = word;
      slot.style.width = width + 'px';
    }, FIELD_FADE);
    window.setTimeout(function () {
      inner.classList.remove('dim');
    }, FIELD_FADE + FIELD_SETTLE);
  }

  /**
   * Start rotating the three field words under the name.
   *
   * The pool is the (visually hidden) list #keywords in index.html, so that
   * list is the one place to edit the words. Each slot changes every
   * FIELD_INTERVAL milliseconds, the three slots FIELD_STAGGER apart (so one
   * word changes every two seconds), and nothing changes while the landing
   * screen is out of view. With reduced
   * motion the line keeps its original three words.
   *
   * @returns {void}
   */
  function startFields() {
    if (reducedMotion) { return; }
    const slots = Array.prototype.slice.call(document.querySelectorAll('#fields .field'));
    const pool = Array.prototype.slice.call(document.querySelectorAll('#keywords li')).map(function (item) {
      return item.textContent.trim();
    });
    const ruler = document.createElement('span');
    ruler.className = 'field-ruler';
    ruler.setAttribute('aria-hidden', 'true');
    document.getElementById('fields').appendChild(ruler);

    slots.forEach(function (slot, index) {
      slot.dataset.word = slot.textContent.trim();
      window.setTimeout(function () {
        window.setInterval(function () {
          if (!state.visible || document.hidden) { return; }
          changeField(slot, slots, pool, ruler);
        }, FIELD_INTERVAL);
      }, index * FIELD_STAGGER);
    });
  }

  /* ----------------------------------------------------------------------
     Frame
     ---------------------------------------------------------------------- */

  /**
   * Render one frame at the current animation time.
   *
   * @param {number} dt - Time since the previous frame in seconds (used to ease
   *     the cursor parallax).
   * @returns {void}
   */
  function render(dt) {
    const time = state.clock;
    const pointer = state.pointer;

    // View centre: slow drift plus a little parallax from the cursor.
    const targetX = pointer.inside ? (pointer.x / view.width - 0.5) * 2 : 0;
    const targetY = pointer.inside ? (pointer.y / view.height - 0.5) * 2 : 0;
    const follow = reducedMotion ? 1 : clamp(dt * 3, 0, 1);
    pointer.sx += (targetX - pointer.sx) * follow;
    pointer.sy += (targetY - pointer.sy) * follow;
    view.lon0 = (VIEW_LON + 5 * Math.sin(time * 0.12) - 4 * pointer.sx) * DEG;
    view.lat0 = (VIEW_LAT + 1.5 * Math.sin(time * 0.09) + 3 * pointer.sy) * DEG;
    view.sinLat0 = Math.sin(view.lat0);
    view.cosLat0 = Math.cos(view.lat0);

    const light = reducedMotion
      ? { city: -1, lon: CITIES[2].lon * DEG, lat: CITIES[2].lat * DEG, alpha: 0, arc: -1, progress: 0 }
      : evaluateTimeline(time);
    let active = light.city;
    if (state.hovered >= 0) { active = state.hovered; }

    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, view.width, view.height);

    drawGlobeLayer();

    const lightPosition = projectLonLat(light.lon, light.lat);
    const spots = [
      { x: lightPosition.x, y: lightPosition.y, radius: view.radius * 0.6, alpha: 0.75 * light.alpha }
    ];
    if (active >= 0 && active !== light.city) {
      const p = projectLonLat(CITIES[active].lon * DEG, CITIES[active].lat * DEG);
      spots.push({ x: p.x, y: p.y, radius: view.radius * 0.6, alpha: 0.75 });
    }
    if (pointer.inside) {
      spots.push({ x: pointer.x, y: pointer.y, radius: 230, alpha: 0.85 });
    }
    if (reducedMotion && spots.length === 1) {
      // Without motion nothing would ever light up, so show the whole globe a little brighter.
      spots.push({ x: view.cx, y: view.cy, radius: view.radius * 1.4, alpha: 0.5 });
    }
    compositeGlobe(spots);
    drawRoutes(light, active);

  }

  /**
   * Animation loop callback: advance the clock, render, and reschedule.
   *
   * @param {number} stamp - Timestamp supplied by requestAnimationFrame (ms).
   * @returns {void}
   */
  function frame(stamp) {
    if (!state.running) { return; }
    const dt = state.lastStamp === 0 ? 0 : Math.min((stamp - state.lastStamp) / 1000, 0.05);
    state.lastStamp = stamp;
    state.clock += dt;
    render(dt);
    window.requestAnimationFrame(frame);
  }

  /**
   * Start or stop the animation loop according to visibility.
   *
   * With reduced motion the loop never runs; a single frame is rendered instead.
   *
   * @returns {void}
   */
  function updateRunning() {
    if (reducedMotion) {
      render(1);
      return;
    }
    const shouldRun = state.visible && !document.hidden;
    setVideoPlaying(shouldRun);
    if (shouldRun && !state.running) {
      state.running = true;
      state.lastStamp = 0;
      window.requestAnimationFrame(frame);
    } else if (!shouldRun) {
      state.running = false;
    }
  }

  /* ----------------------------------------------------------------------
     Events
     ---------------------------------------------------------------------- */

  hero.addEventListener('pointermove', function (event) {
    if (event.pointerType === 'touch') { return; }
    const rect = hero.getBoundingClientRect();
    state.pointer.x = event.clientX - rect.left;
    state.pointer.y = event.clientY - rect.top;
    state.pointer.inside = true;
    if (reducedMotion) { render(1); }
  });

  hero.addEventListener('pointerleave', function () {
    state.pointer.inside = false;
    if (reducedMotion) { render(1); }
  });

  cityButtons.forEach(function (button, index) {
    button.addEventListener('pointerenter', function (event) {
      if (event.pointerType === 'touch') { return; }
      state.hovered = index;
      if (reducedMotion) { render(1); }
    });
    button.addEventListener('pointerleave', function () {
      state.hovered = -1;
      if (reducedMotion) { render(1); }
    });
    button.addEventListener('focus', function () {
      state.hovered = index;
      if (reducedMotion) { render(1); }
    });
    button.addEventListener('blur', function () {
      state.hovered = -1;
      if (reducedMotion) { render(1); }
    });
  });

  window.addEventListener('resize', function () {
    layout();
    if (reducedMotion) { render(1); }
  });

  document.addEventListener('visibilitychange', updateRunning);

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      state.visible = entries[0].isIntersecting;
      updateRunning();
    }).observe(hero);
  }

  /* ----------------------------------------------------------------------
     Start
     ---------------------------------------------------------------------- */

  layout();
  startFields();
  updateRunning();
  // Fonts can change the identity block's height after first layout.
  window.addEventListener('load', layout);
})();
