let glyphs = [];
let advances = null;
let pairAdvances = null;
let glyphCount = 0;
let glyphHeight = 0;
let lineWidth = 0;
let beamWidth = 0;
let foregroundWeight = 0;
let minGlyphWidth = 0;

self.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type === "init") {
    initialize(message);
    self.postMessage({ type: "ready" });
    return;
  }
  if (message.type === "search") {
    const result = beamSearch(message.target, message.lineIndex);
    self.postMessage({ type: "result", ...result });
  }
});

function initialize({ calibration, beamWidth: requestedBeamWidth, foregroundWeight: weight }) {
  glyphHeight = calibration.glyphHeight;
  lineWidth = calibration.lineWidth;
  beamWidth = requestedBeamWidth;
  foregroundWeight = weight;
  advances = Float64Array.from(calibration.advances);
  pairAdvances = Float64Array.from(calibration.pairAdvances);
  glyphs = calibration.glyphs.map((glyph) => ({
    char: glyph.char,
    width: glyph.width,
    pixels: decodeBase64(glyph.pixels),
  }));
  glyphCount = glyphs.length;
  minGlyphWidth = Math.min(...glyphs.map((glyph) => glyph.width));
}

function beamSearch(target, lineIndex) {
  const errorWeights = new Float32Array(target.length);
  const whiteSuffixError = new Float64Array(lineWidth + 1);
  let totalWeight = 0;

  for (let index = 0; index < target.length; index++) {
    const weight = 1 + foregroundWeight * (1 - target[index] / 255);
    errorWeights[index] = weight;
    totalWeight += weight;
  }

  for (let x = lineWidth - 1; x >= 0; x--) {
    let columnError = 0;
    for (let y = 0; y < glyphHeight; y++) {
      const index = y * lineWidth + x;
      columnError += (255 - target[index]) * errorWeights[index];
    }
    whiteSuffixError[x] = whiteSuffixError[x + 1] + columnError;
  }

  const denominator = totalWeight * 255;
  const segmentErrorCache = new Map();

  const segmentError = (glyphIndex, x, width) => {
    const key = glyphIndex * 268435456 + x * 16384 + width;
    const cached = segmentErrorCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const glyph = glyphs[glyphIndex];
    let error = 0;
    for (let y = 0; y < glyphHeight; y++) {
      const targetRow = y * lineWidth + x;
      const glyphRow = y * glyph.width;
      for (let offset = 0; offset < width; offset++) {
        const glyphPixel = offset < glyph.width ? glyph.pixels[glyphRow + offset] : 255;
        const targetIndex = targetRow + offset;
        error += Math.abs(target[targetIndex] - glyphPixel) * errorWeights[targetIndex];
      }
    }
    segmentErrorCache.set(key, error);
    return error;
  };

  const finalDistance = (state) => {
    if (state.last < 0) {
      return whiteSuffixError[0] / denominator;
    }
    const start = pythonRound(state.width);
    const end = pythonRound(state.width + advances[state.last]);
    if (end > lineWidth) {
      return Infinity;
    }
    return (
      state.errorSum +
      segmentError(state.last, start, end - start) +
      whiteSuffixError[end]
    ) / denominator;
  };

  let beam = [{ text: "", width: 0, errorSum: 0, last: -1 }];
  let bestState = beam[0];
  let bestDistance = finalDistance(bestState);
  const maxChars = Math.ceil(lineWidth / minGlyphWidth);

  for (let characterIndex = 0; characterIndex < maxChars; characterIndex++) {
    const expanded = [];

    for (const state of beam) {
      for (let next = 0; next < glyphCount; next++) {
        if (state.last < 0) {
          const nextState = {
            text: glyphs[next].char,
            width: 0,
            errorSum: 0,
            last: next,
          };
          nextState.distance = finalDistance(nextState);
          expanded.push(nextState);
          continue;
        }

        const pairAdvance = pairAdvances[state.last * glyphCount + next];
        const advance = pairAdvance >= 0 ? pairAdvance : advances[state.last];
        const newWidth = state.width + advance;
        if (pythonRound(newWidth + advances[next]) > lineWidth) {
          continue;
        }

        const start = pythonRound(state.width);
        const end = pythonRound(newWidth);
        const nextState = {
          text: state.text + glyphs[next].char,
          width: newWidth,
          errorSum: state.errorSum + segmentError(state.last, start, end - start),
          last: next,
        };
        nextState.distance = finalDistance(nextState);
        expanded.push(nextState);
      }
    }

    if (expanded.length === 0) {
      break;
    }

    expanded.sort(compareStates);
    beam = expanded.slice(0, beamWidth);

    for (const state of beam) {
      if (state.distance < bestDistance) {
        bestState = state;
        bestDistance = state.distance;
      }
    }
  }

  return {
    lineIndex,
    text: bestState.text.replace(/ +$/, ""),
    score: 1 - bestDistance,
  };
}

function compareStates(left, right) {
  if (left.distance !== right.distance) {
    return left.distance - right.distance;
  }
  if (left.errorSum !== right.errorSum) {
    return left.errorSum - right.errorSum;
  }
  if (left.text < right.text) {
    return -1;
  }
  if (left.text > right.text) {
    return 1;
  }
  return 0;
}

function pythonRound(value) {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction < 0.5) {
    return floor;
  }
  if (fraction > 0.5) {
    return floor + 1;
  }
  return floor % 2 === 0 ? floor : floor + 1;
}

function decodeBase64(encoded) {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
