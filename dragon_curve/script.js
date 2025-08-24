/*
 * Dragon Curve Explorer (updated for fine-grained angle & 3D twist control)
 *
 * Changes:
 * - Sliders & numeric inputs for Angle and Twist accept 0.01° increments.
 * - UI readouts show two decimals for Angle and Twist.
 * - Fine nudging on numeric inputs with keyboard & mouse wheel:
 *     ArrowUp/Down or wheel = ±1.00°
 *     Alt/Option (or Meta)  = ±0.10°
 *     Shift                  = ±0.01°
 */

// Wait until the DOM is ready before running any logic
window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('draw-canvas');
  const ctx = canvas.getContext('2d');

  // Get UI elements
  const iterationInput = document.getElementById('iteration');
  const angleInput = document.getElementById('angle');
  const twistInput = document.getElementById('twist');
  const extrudeInput = document.getElementById('extrude');
  // Additional numeric inputs for exact values
  const iterationNumber = document.getElementById('iteration-number');
  const angleNumber = document.getElementById('angle-number');
  const twistNumber = document.getElementById('twist-number');
  const extrudeNumber = document.getElementById('extrude-number');
  // Animation speed controls
  const speedInput = document.getElementById('speed');
  const speedNumber = document.getElementById('speed-number');
  const speedValueSpan = document.getElementById('speed-value');
  // Colour controls
  const colorStartInput = document.getElementById('color-start');
  const colorEndInput = document.getElementById('color-end');
  const gradientInput = document.getElementById('enable-gradient');
  const rainbowInput = document.getElementById('rainbow');
  const enable3dInput = document.getElementById('enable3d');
  const darkModeInput = document.getElementById('dark-mode');
  const iterationValue = document.getElementById('iteration-value');
  const angleValue = document.getElementById('angle-value');
  const twistValue = document.getElementById('twist-value');
  const extrudeValue = document.getElementById('extrude-value');
  const resetBtn = document.getElementById('reset-view');
  const animateBtn = document.getElementById('animate-btn');
  const cancelBtn = document.getElementById('cancel-btn');
  const homeBtn = document.getElementById('home-btn');

  // --- Finer granularity for angle & twist sliders/inputs ---
  for (const el of [angleInput, angleNumber, twistInput, twistNumber]) {
    el.step = '0.01';           // allow hundredths of a degree
    if (!el.min) el.min = '-360';
    if (!el.max) el.max = '360';
  }

  // State variables for the current fractal
  let currentString = '';
  let currentPoints2D = [];
  let currentPoints3D = [];
  // Track progress of line-by-line animation. A value >= 0 means the
  // animation is in progress and only the first `animationProgress`
  // segments should be drawn. When not animating the value is -1.
  let animationProgress = -1;

  // Animation state: whether an animation is currently running.
  let isAnimating = false;
  // Current animation timer (setTimeout identifier) so that it can be cancelled.
  let animationTimer = null;
  // Animation speed (segments per second). Default 60 for ~60 fps.
  let animationSpeed = 60;
  // Colour settings: start and end colours in hex (e.g., '#3366cc').
  let startColor = '#3366cc';
  let endColor = '#3366cc';
  // Whether gradient is enabled. If false, startColor is used for all segments.
  let useGradient = false;
  // Whether rainbow colouring is enabled. When true, colours cycle through
  // the hue spectrum from beginning to end of the curve.
  let useRainbow = false;
  // Cache for already computed L-system strings to avoid recomputation
  const lSystemCache = {};

  // Canvas sizing: handle high DPI displays by scaling the drawing context
  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  window.addEventListener('resize', resizeCanvas);

  // --- L-system generation ---
  /**
   * Generate the dragon curve L-system string for a given number of
   * iterations. The rules used are:
   * F → F+G
   * G → F−G
   * We start with the axiom "F". Plus and minus characters denote
   * left and right turns.
   *
   * Results are cached so that repeated calls with the same iteration
   * count are fast.
   * @param {number} n Number of iterations
   * @returns {string} The resulting L-system string
   */
  function generateLSystem(n) {
    if (lSystemCache[n]) return lSystemCache[n];
    let str = 'F';
    for (let i = 0; i < n; i++) {
      let next = '';
      for (const ch of str) {
        if (ch === 'F') next += 'F+G';
        else if (ch === 'G') next += 'F-G';
        else next += ch;
      }
      str = next;
    }
    lSystemCache[n] = str;
    return str;
  }

  /**
   * Convert an L-system string into an array of 2D points. The turtle
   * starts at (0,0) facing along the positive x-axis. Each F or G step
   * moves the turtle forward by one unit. Plus rotates left by the
   * specified angle, minus rotates right by the angle.
   * @param {string} str L-system string
   * @param {number} angleDeg Turning angle in degrees
   * @returns {Array<[number, number]>} Array of 2D points
   */
  function get2DPoints(str, angleDeg) {
    const angleRad = (angleDeg * Math.PI) / 180;
    let x = 0;
    let y = 0;
    let direction = 0; // radians; 0 → positive x direction
    const points = [];
    points.push([x, y]);
    for (const ch of str) {
      if (ch === 'F' || ch === 'G') {
        x += Math.cos(direction);
        y += Math.sin(direction);
        points.push([x, y]);
      } else if (ch === '+') {
        direction += angleRad;
      } else if (ch === '-') {
        direction -= angleRad;
      }
    }
    return points;
  }

  /**
   * Convert an L-system string into an array of 3D points. A simple
   * orientation matrix is maintained and updated on each turn. The rules
   * for updating orientation for '+' and '−' are:
   *   orientation = orientation * Rz(angle) * Rx(twist)
   *   orientation = orientation * Rz(−angle) * Rx(twist)
   * Each step forward translates by one unit along the current local
   * forward (x) axis and an optional constant along the global z-axis.
   * @param {string} str L-system string
   * @param {number} angleDeg Turn angle around z axis, in degrees
   * @param {number} twistDeg Twist applied around the local x axis, in degrees
   * @param {number} extrude Amount to add along global z per segment
   * @returns {Array<[number, number, number]>} Array of 3D points
   */
  function get3DPoints(str, angleDeg, twistDeg, extrude) {
    const angleRad = (angleDeg * Math.PI) / 180;
    const twistRad = (twistDeg * Math.PI) / 180;
    // Precompute rotation matrices for plus and minus turns
    // Rz rotates around z axis; Rx rotates around x axis
    function getRotationZ(angle) {
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      return [
        [c, -s, 0],
        [s, c, 0],
        [0, 0, 1],
      ];
    }
    function getRotationX(angle) {
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      return [
        [1, 0, 0],
        [0, c, -s],
        [0, s, c],
      ];
    }
    // Multiply two 3x3 matrices A * B
    function matMul(A, B) {
      const result = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ];
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          let sum = 0;
          for (let k = 0; k < 3; k++) sum += A[i][k] * B[k][j];
          result[i][j] = sum;
        }
      }
      return result;
    }
    // Multiply matrix by vector
    function applyMat(mat, vec) {
      return [
        mat[0][0] * vec[0] + mat[0][1] * vec[1] + mat[0][2] * vec[2],
        mat[1][0] * vec[0] + mat[1][1] * vec[1] + mat[1][2] * vec[2],
        mat[2][0] * vec[0] + mat[2][1] * vec[1] + mat[2][2] * vec[2],
      ];
    }
    const plusRot = matMul(getRotationZ(angleRad), getRotationX(twistRad));
    const minusRot = matMul(getRotationZ(-angleRad), getRotationX(twistRad));
    // Current orientation starts as identity matrix
    let orientation = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    let x = 0;
    let y = 0;
    let z = 0;
    const points = [];
    points.push([x, y, z]);
    for (const ch of str) {
      if (ch === 'F' || ch === 'G') {
        // Move forward one unit in local x direction
        const dir = applyMat(orientation, [1, 0, 0]);
        x += dir[0];
        y += dir[1];
        z += dir[2];
        // Apply extrude along global z
        z += extrude;
        points.push([x, y, z]);
      } else if (ch === '+') {
        orientation = matMul(orientation, plusRot);
      } else if (ch === '-') {
        orientation = matMul(orientation, minusRot);
      }
    }
    return points;
  }

  // --- 3D viewer state ---
  let viewCenter = { x: 0, y: 0, z: 0 };
  let boundingRadius = 1;
  let rotX = 0; // rotation around X axis (pitch)
  let rotY = 0; // rotation around Y axis (yaw)
  let userZoom = 1;
  let baseZoom = 1;
  let cameraDist = 1;

  // Compute the current 3D rotation matrix from rotX and rotY
  function getViewRotation() {
    const cx = Math.cos(rotX);
    const sx = Math.sin(rotX);
    const cy = Math.cos(rotY);
    const sy = Math.sin(rotY);
    // Rotation around X followed by rotation around Y
    return [
      [cy, 0, sy],
      [sx * sy, cx, -sx * cy],
      [-cx * sy, sx, cx * cy],
    ];
  }

  /**
   * Project a 3D point into 2D screen coordinates using a simple
   * perspective projection. Takes into account current view rotation,
   * the view centre, zoom and camera distance.
   * @param {[number, number, number]} pt 3D point
   * @returns {{x: number, y: number, z: number, valid: boolean}}
   */
  function project3D(pt) {
    // Translate relative to view centre
    const dx = pt[0] - viewCenter.x;
    const dy = pt[1] - viewCenter.y;
    const dz = pt[2] - viewCenter.z;
    const R = getViewRotation();
    // Apply rotation
    const rx = R[0][0] * dx + R[0][1] * dy + R[0][2] * dz;
    const ry = R[1][0] * dx + R[1][1] * dy + R[1][2] * dz;
    const rz = R[2][0] * dx + R[2][1] * dy + R[2][2] * dz;
    // Perspective projection
    const denom = cameraDist - rz;
    // If the point is behind the camera, skip drawing it
    const valid = denom > 0.001;
    const factor = (baseZoom * userZoom) / denom;
    const x2d = canvas.clientWidth / 2 + rx * factor;
    const y2d = canvas.clientHeight / 2 - ry * factor;
    return { x: x2d, y: y2d, z: rz, valid };
  }

  // Utility functions for colour manipulation
  function hexToRgb(hex) {
    // Remove leading '#'
    const h = hex.replace('#', '');
    const bigint = parseInt(h, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return [r, g, b];
  }
  function rgbToHex(r, g, b) {
    const toHex = (c) => {
      const hex = c.toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    return '#' + toHex(r) + toHex(g) + toHex(b);
  }

  // Convert HSL to RGB. h in [0,360), s and l in [0,1]
  function hslToRgb(h, s, l) {
    h = (h % 360) / 360;
    let r, g, b;
    if (s === 0) {
      r = g = b = l; // achromatic
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  // Redraw everything based on current state
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Determine whether to draw 2D or 3D
    if (!enable3dInput.checked) {
      // 2D drawing
      if (!currentPoints2D || currentPoints2D.length < 2) return;
      // Compute bounds for scaling and centering
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y] of currentPoints2D) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      const wBound = maxX - minX || 1;
      const hBound = maxY - minY || 1;
      const expandX = wBound * 0.05;
      const expandY = hBound * 0.05;
      const adjMinX = minX - expandX;
      const adjMaxX = maxX + expandX;
      const adjMinY = minY - expandY;
      const adjMaxY = maxY + expandY;
      const adjW = adjMaxX - adjMinX;
      const adjH = adjMaxY - adjMinY;
      const margin = 20;
      const availW = canvas.clientWidth - 2 * margin;
      const availH = canvas.clientHeight - 2 * margin;
      const scale = Math.min(availW / adjW, availH / adjH);
      const offsetX = margin + (availW - adjW * scale) / 2;
      const offsetY = margin + (availH - adjH * scale) / 2;
      // Precompute colour interpolation values
      const totalSegments = currentPoints2D.length - 1;
      const maxSegment = animationProgress >= 0 ? Math.min(animationProgress, totalSegments) : totalSegments;
      const startRGB = hexToRgb(startColor);
      const endRGB = hexToRgb(endColor);
      const diffR = endRGB[0] - startRGB[0];
      const diffG = endRGB[1] - startRGB[1];
      const diffB = endRGB[2] - startRGB[2];
      for (let i = 0; i < maxSegment; i++) {
        const [x1, y1] = currentPoints2D[i];
        const [x2, y2] = currentPoints2D[i + 1];
        const px1 = offsetX + (x1 - adjMinX) * scale;
        const py1 = offsetY + (y1 - adjMinY) * scale;
        const px2 = offsetX + (x2 - adjMinX) * scale;
        const py2 = offsetY + (y2 - adjMinY) * scale;
        // Determine colour for this segment
        let r, g, b;
        if (useRainbow && totalSegments > 0) {
          const t = i / totalSegments;
          const h = 360 * t;
          [r, g, b] = hslToRgb(h, 1, 0.5);
        } else if (useGradient && totalSegments > 0) {
          const t = i / totalSegments;
          r = Math.round(startRGB[0] + diffR * t);
          g = Math.round(startRGB[1] + diffG * t);
          b = Math.round(startRGB[2] + diffB * t);
        } else {
          r = startRGB[0];
          g = startRGB[1];
          b = startRGB[2];
        }
        ctx.strokeStyle = `rgb(${r},${g},${b})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px1, py1);
        ctx.lineTo(px2, py2);
        ctx.stroke();
      }
    } else {
      // 3D drawing
      if (!currentPoints3D || currentPoints3D.length < 2) return;
      const totalSegments = currentPoints3D.length - 1;
      const maxSegment = animationProgress >= 0 ? Math.min(animationProgress, totalSegments) : totalSegments;
      const startRGB3 = hexToRgb(startColor);
      const endRGB3 = hexToRgb(endColor);
      const diffR3 = endRGB3[0] - startRGB3[0];
      const diffG3 = endRGB3[1] - startRGB3[1];
      const diffB3 = endRGB3[2] - startRGB3[2];
      for (let i = 0; i < maxSegment; i++) {
        const p1 = project3D(currentPoints3D[i]);
        const p2 = project3D(currentPoints3D[i + 1]);
        if (!p1.valid || !p2.valid) continue;
        // Determine colour for this segment
        let r, g, b;
        if (useRainbow && totalSegments > 0) {
          const t = i / totalSegments;
          const h = 360 * t;
          [r, g, b] = hslToRgb(h, 1, 0.5);
        } else if (useGradient && totalSegments > 0) {
          const t = i / totalSegments;
          r = Math.round(startRGB3[0] + diffR3 * t);
          g = Math.round(startRGB3[1] + diffG3 * t);
          b = Math.round(startRGB3[2] + diffB3 * t);
        } else {
          r = startRGB3[0];
          g = startRGB3[1];
          b = startRGB3[2];
        }
        // Adjust line width based on depth for a simple depth cue (closer = thicker)
        const depth = (p1.z + p2.z) / 2;
        const weight = Math.max(0.3, 1 - depth / (2 * boundingRadius));
        ctx.lineWidth = weight;
        ctx.strokeStyle = `rgb(${r},${g},${b})`;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
    }
  }

  // Compute bounding sphere and centre for current 3D points
  function compute3DBounds({ preserveView = false } = {}) {
    if (!currentPoints3D || currentPoints3D.length === 0) {
      viewCenter = { x: 0, y: 0, z: 0 };
      boundingRadius = 1;
      return;
    }

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const [x, y, z] of currentPoints3D) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    viewCenter = {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      z: (minZ + maxZ) / 2,
    };

    const dx = maxX - minX;
    const dy = maxY - minY;
    const dz = maxZ - minZ;
    boundingRadius = Math.sqrt(dx * dx + dy * dy + dz * dz) / 2;

    // Choose a reasonable camera distance and compute a zoom that fills ~90% of the shorter canvas side.
    const shorterSide = Math.min(canvas.clientWidth, canvas.clientHeight);
    const fillFrac = 0.9;                // fill ~90% of the shorter side
    cameraDist = 3 * boundingRadius;     // closer camera so things appear larger
    baseZoom = cameraDist * (fillFrac * shorterSide) / (2 * boundingRadius);

    if (!preserveView) {
      // Only reset these when explicitly asked (e.g., first load, toggle 3D, or Reset View)
      userZoom = 1;
      rotX = 0;
      rotY = 0;
    }
  }

  // Called whenever a parameter is changed or on first load
  function updateFractal() {
    const iterations = parseInt(iterationInput.value, 10);
    const angleDeg = parseFloat(angleInput.value);
    const twistDeg = parseFloat(twistInput.value);
    const extrude = parseFloat(extrudeInput.value);
    // Update displayed values (angle & twist to two decimals)
    iterationValue.textContent = iterations;
    angleValue.textContent = isNaN(angleDeg) ? '0.00' : angleDeg.toFixed(2);
    twistValue.textContent = isNaN(twistDeg) ? '0.00' : twistDeg.toFixed(2);
    extrudeValue.textContent = isNaN(extrude) ? '0.0' : extrude.toFixed(1);
    // Keep number inputs in sync with sliders
    iterationNumber.value = `${iterations}`;
    angleNumber.value = isNaN(angleDeg) ? '0.00' : angleDeg.toFixed(2);
    twistNumber.value = isNaN(twistDeg) ? '0.00' : twistDeg.toFixed(2);
    extrudeNumber.value = isNaN(extrude) ? '0.0' : extrude.toFixed(1);
    // Update speed display
    const spd = parseInt(speedInput.value, 10);
    speedNumber.value = spd;
    speedValueSpan.textContent = spd;
    animationSpeed = spd;
    // Update colour settings
    startColor = colorStartInput.value;
    endColor = colorEndInput.value;
    useGradient = gradientInput.checked;
    useRainbow = rainbowInput.checked;
    // Generate the L-system string
    currentString = generateLSystem(iterations);
    currentPoints2D = get2DPoints(currentString, angleDeg);
    currentPoints3D = get3DPoints(currentString, angleDeg, twistDeg, extrude);
    if (enable3dInput.checked) {
      // Recompute bounds but keep current rotation/zoom so the view doesn’t “snap back”
      compute3DBounds({ preserveView: true });
    }
    // Redraw only if not animating
    if (!isAnimating) {
      draw();
    }
  }

  // Attach input listeners
  iterationInput.addEventListener('input', updateFractal);
  angleInput.addEventListener('input', updateFractal);
  twistInput.addEventListener('input', updateFractal);
  extrudeInput.addEventListener('input', updateFractal);

  // Keep number inputs in sync with sliders and update fractal
  iterationNumber.addEventListener('change', () => {
    let val = parseInt(iterationNumber.value, 10);
    if (isNaN(val)) return;
    val = Math.max(parseInt(iterationInput.min), Math.min(parseInt(iterationInput.max), val));
    iterationInput.value = `${val}`;
    updateFractal();
  });
  iterationInput.addEventListener('input', () => {
    iterationNumber.value = iterationInput.value;
  });

  angleNumber.addEventListener('change', () => {
    let val = parseFloat(angleNumber.value);
    if (isNaN(val)) return;
    val = Math.max(parseFloat(angleInput.min), Math.min(parseFloat(angleInput.max), val));
    angleInput.value = val.toFixed(2);
    updateFractal();
  });
  angleInput.addEventListener('input', () => {
    angleNumber.value = parseFloat(angleInput.value).toFixed(2);
  });

  twistNumber.addEventListener('change', () => {
    let val = parseFloat(twistNumber.value);
    if (isNaN(val)) return;
    val = Math.max(parseFloat(twistInput.min), Math.min(parseFloat(twistInput.max), val));
    twistInput.value = val.toFixed(2);
    updateFractal();
  });
  twistInput.addEventListener('input', () => {
    twistNumber.value = parseFloat(twistInput.value).toFixed(2);
  });

  extrudeNumber.addEventListener('change', () => {
    let val = parseFloat(extrudeNumber.value);
    if (isNaN(val)) return;
    val = Math.max(parseFloat(extrudeInput.min), Math.min(parseFloat(extrudeInput.max), val));
    extrudeInput.value = val;
    updateFractal();
  });
  extrudeInput.addEventListener('input', () => {
    extrudeNumber.value = extrudeInput.value;
  });

  // Speed controls
  speedInput.addEventListener('input', () => {
    const val = parseInt(speedInput.value, 10);
    speedNumber.value = val;
    speedValueSpan.textContent = val;
    animationSpeed = val;
  });
  speedNumber.addEventListener('change', () => {
    let val = parseInt(speedNumber.value, 10);
    if (isNaN(val)) return;
    val = Math.max(parseInt(speedInput.min), Math.min(parseInt(speedInput.max), val));
    speedInput.value = val;
    speedValueSpan.textContent = val;
    animationSpeed = val;
  });

  // Colour pickers and gradient toggle
  colorStartInput.addEventListener('input', () => {
    startColor = colorStartInput.value;
    if (!isAnimating) draw();
  });
  colorEndInput.addEventListener('input', () => {
    endColor = colorEndInput.value;
    if (!isAnimating) draw();
  });
  gradientInput.addEventListener('change', () => {
    useGradient = gradientInput.checked;
    if (!isAnimating) draw();
  });

  // Rainbow toggle
  rainbowInput.addEventListener('change', () => {
    useRainbow = rainbowInput.checked;
    // If rainbow is enabled, we ignore gradient for drawing
    if (!isAnimating) draw();
  });

  // Home button navigates back to the site's home page
  homeBtn.addEventListener('click', () => {
    // Navigate relative to this page. Assumes this page is in a subdirectory
    window.location.href = '../index.html';
  });
  enable3dInput.addEventListener('change', () => {
    // When toggling mode we need to recompute 3D bounds if switching to 3D
    if (enable3dInput.checked) {
      compute3DBounds({ preserveView: false });
    }
    draw();
  });

  // Dark mode toggle
  darkModeInput.addEventListener('change', () => {
    document.body.classList.toggle('dark', darkModeInput.checked);
    draw();
  });

  // Reset view button resets rotation and zoom in 3D mode
  resetBtn.addEventListener('click', () => {
    if (enable3dInput.checked) {
      rotX = 0;
      rotY = 0;
      userZoom = 1;
      draw();
    }
  });

  // --- Fine nudge handlers for precise angle/twist control ---
  // Normal = 1.00°, Alt/Meta = 0.10°, Shift = 0.01°
  function computeNudgeStep(mod) {
    if (mod.shiftKey) return 0.01;
    if (mod.altKey || mod.metaKey) return 0.1;
    return 1.0;
  }
  function clamp(val, min, max) {
    return Math.min(max, Math.max(min, val));
  }
  function nudge(el, dir, mod) {
    const step = computeNudgeStep(mod);
    const cur = parseFloat(el.value || '0') || 0;
    const min = parseFloat(el.min ?? '-360');
    const max = parseFloat(el.max ?? '360');
    const next = clamp(cur + dir * step, min, max);
    // Keep two decimals for angle/twist
    el.value = next.toFixed(2);
    // Use 'change' to reuse existing sync logic
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Apply to numeric inputs (and optionally sliders) for Angle & Twist
  for (const el of [angleNumber, twistNumber]) {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        nudge(el, e.key === 'ArrowUp' ? +1 : -1, e);
      }
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      nudge(el, e.deltaY < 0 ? +1 : -1, e);
    }, { passive: false });
  }
  // Optional: enable wheel nudging on sliders too
  for (const el of [angleInput, twistInput]) {
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      nudge(el, e.deltaY < 0 ? +1 : -1, e);
    }, { passive: false });
  }

  // Mouse interaction for 3D rotation and zoom
  let isDragging = false;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener('mousedown', (e) => {
    if (!enable3dInput.checked) return;
    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener('mousemove', (e) => {
    if (!enable3dInput.checked || !isDragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    // Sensitivity scaling: rotate 360° when dragging across width/height
    rotY += (dx / canvas.clientWidth) * 2 * Math.PI;
    rotX += (dy / canvas.clientHeight) * 2 * Math.PI;
    // Clamp rotX to avoid flipping over completely
    const limit = Math.PI / 2 - 0.01;
    if (rotX > limit) rotX = limit;
    if (rotX < -limit) rotX = -limit;
    draw();
  });
  window.addEventListener('mouseup', () => {
    isDragging = false;
  });
  // Prevent default dragging behaviour on the canvas
  canvas.addEventListener('dragstart', (e) => e.preventDefault());
  // Zoom with mouse wheel
  canvas.addEventListener('wheel', (e) => {
    if (!enable3dInput.checked) return;
    e.preventDefault();
    const delta = e.deltaY;
    const factor = Math.exp(-delta * 0.001);
    userZoom *= factor;
    // Clamp zoom to prevent degeneracy
    userZoom = Math.max(0.1, Math.min(10, userZoom));
    draw();
  }, { passive: false });

  // Initial setup
  resizeCanvas();
  updateFractal();

  // Animation logic with cancel and speed control
  animateBtn.addEventListener('click', () => {
    // Do nothing if already animating
    if (isAnimating) return;
    // Capture parameter values
    const targetIterations = parseInt(iterationInput.value, 10);
    const angleDeg = parseFloat(angleInput.value);
    const twistDeg = parseFloat(twistInput.value);
    const extrude = parseFloat(extrudeInput.value);
    const use3D = enable3dInput.checked;
    // Generate the full curve once for the target iteration
    const finalString = generateLSystem(targetIterations);
    currentPoints2D = get2DPoints(finalString, angleDeg);
    currentPoints3D = get3DPoints(finalString, angleDeg, twistDeg, extrude);
    if (use3D) {
      compute3DBounds();
    }
    // Set up animation state
    isAnimating = true;
    animationProgress = 0;
    // Hide animate button and show cancel button
    animateBtn.style.display = 'none';
    cancelBtn.style.display = 'inline-block';
    // Disable parameter controls to prevent changes mid-animation
    const controlsToDisable = [iterationInput, iterationNumber, angleInput, angleNumber, twistInput, twistNumber, extrudeInput, extrudeNumber, speedInput, speedNumber, enable3dInput, darkModeInput, colorStartInput, colorEndInput, gradientInput, rainbowInput];
    for (const ctrl of controlsToDisable) {
      ctrl.disabled = true;
    }
    // Display the target iteration in the label
    iterationValue.textContent = targetIterations;
    // Recursive function to draw segments at a rate determined by animationSpeed
    function animateSegment() {
      if (!isAnimating) return; // Stop if cancelled
      draw();
      animationProgress++;
      const totalSegments = (use3D ? currentPoints3D.length : currentPoints2D.length) - 1;
      if (animationProgress <= totalSegments) {
        const interval = 1000 / animationSpeed;
        animationTimer = setTimeout(animateSegment, interval);
      } else {
        // Animation finished
        isAnimating = false;
        animationProgress = -1;
        // Restore controls
        animateBtn.style.display = 'inline-block';
        cancelBtn.style.display = 'none';
        for (const ctrl of controlsToDisable) {
          ctrl.disabled = false;
        }
        updateFractal();
      }
    }
    // Kick off the animation
    animateSegment();
  });

  // Cancel button stops the ongoing animation and restores controls
  cancelBtn.addEventListener('click', () => {
    if (!isAnimating) return;
    isAnimating = false;
    // Clear any pending timer
    if (animationTimer) {
      clearTimeout(animationTimer);
      animationTimer = null;
    }
    animationProgress = -1;
    // Restore controls
    animateBtn.style.display = 'inline-block';
    cancelBtn.style.display = 'none';
    const controlsToDisable = [iterationInput, iterationNumber, angleInput, angleNumber, twistInput, twistNumber, extrudeInput, extrudeNumber, speedInput, speedNumber, enable3dInput, darkModeInput, colorStartInput, colorEndInput, gradientInput, rainbowInput];
    for (const ctrl of controlsToDisable) {
      ctrl.disabled = false;
    }
    // Recalculate and draw full fractal
    updateFractal();
  });
});
