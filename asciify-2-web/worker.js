let glyphs = [];
let advances = null;
let pairAdvances = null;
let glyphCount = 0;
let glyphHeight = 0;
let lineWidth = 0;
let beamWidth = 0;
let foregroundWeight = 0;
let minGlyphWidth = 0;
let colorMode = false;
let paletteLevels = 6;
let protocolVersion = 0;

self.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type === "init") {
    initialize(message);
    self.postMessage({ type: "ready", protocolVersion });
    return;
  }
  if (message.type === "search") {
    const result = colorMode
      ? colorBeamSearch(message.target, message.lineIndex)
      : monochromeBeamSearch(message.target, message.lineIndex);
    self.postMessage({ type: "result", ...result });
  }
});

function initialize({
  calibration,
  beamWidth: requestedBeamWidth,
  foregroundWeight: weight,
  colorMode: requestedColorMode,
  paletteLevels: requestedPaletteLevels,
  protocolVersion: requestedProtocolVersion,
}) {
  glyphHeight = calibration.glyphHeight;
  lineWidth = calibration.lineWidth;
  beamWidth = requestedBeamWidth;
  foregroundWeight = weight;
  colorMode = requestedColorMode;
  paletteLevels = requestedPaletteLevels;
  protocolVersion = requestedProtocolVersion;
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

function monochromeBeamSearch(target, lineIndex) {
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
    colors: null,
    score: 1 - bestDistance,
  };
}

function colorBeamSearch(target, lineIndex) {
  const pixelCount = lineWidth * glyphHeight;
  const errorWeights = new Float32Array(pixelCount);
  const whiteSuffixError = new Float64Array(lineWidth + 1);
  let totalWeight = 0;

  for (let index = 0; index < pixelCount; index++) {
    const offset = index * 3;
    const luminance =
      0.299 * target[offset] + 0.587 * target[offset + 1] + 0.114 * target[offset + 2];
    const weight = 1 + foregroundWeight * (1 - luminance / 255);
    errorWeights[index] = weight;
    totalWeight += weight;
  }

  for (let x = lineWidth - 1; x >= 0; x--) {
    let columnError = 0;
    for (let y = 0; y < glyphHeight; y++) {
      const index = y * lineWidth + x;
      const offset = index * 3;
      const red = 255 - target[offset];
      const green = 255 - target[offset + 1];
      const blue = 255 - target[offset + 2];
      columnError += (red * red + green * green + blue * blue) * errorWeights[index];
    }
    whiteSuffixError[x] = whiteSuffixError[x + 1] + columnError;
  }

  const denominator = totalWeight * 3 * 255 * 255;
  const segmentEvaluationCache = new Map();

  const segmentEvaluation = (glyphIndex, x, width) => {
    const key = glyphIndex * 268435456 + x * 16384 + width;
    const cached = segmentEvaluationCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const glyph = glyphs[glyphIndex];
    const numerator = [0, 0, 0];
    let colorDenominator = 0;
    for (let y = 0; y < glyphHeight; y++) {
      const targetRow = y * lineWidth + x;
      const glyphRow = y * glyph.width;
      for (let offset = 0; offset < width; offset++) {
        const glyphPixel = offset < glyph.width ? glyph.pixels[glyphRow + offset] : 255;
        const targetIndex = targetRow + offset;
        const alpha = 1 - glyphPixel / 255;
        const weight = errorWeights[targetIndex];
        colorDenominator += alpha * alpha * weight;
        const rgbIndex = targetIndex * 3;
        for (let channel = 0; channel < 3; channel++) {
          const desired = target[rgbIndex + channel] / 255 - (1 - alpha);
          numerator[channel] += alpha * desired * weight;
        }
      }
    }

    const step = 255 / (paletteLevels - 1);
    const color = numerator.map((value) => {
      const ideal = colorDenominator > 1e-12 ? value / colorDenominator : 0;
      const normalized = Math.max(0, Math.min(1, ideal));
      return Math.round(Math.round(normalized * (paletteLevels - 1)) * step);
    });

    let error = 0;
    for (let y = 0; y < glyphHeight; y++) {
      const targetRow = y * lineWidth + x;
      const glyphRow = y * glyph.width;
      for (let offset = 0; offset < width; offset++) {
        const glyphPixel = offset < glyph.width ? glyph.pixels[glyphRow + offset] : 255;
        const alpha = 1 - glyphPixel / 255;
        const targetIndex = targetRow + offset;
        const rgbIndex = targetIndex * 3;
        for (let channel = 0; channel < 3; channel++) {
          const rendered = 255 * (1 - alpha) + color[channel] * alpha;
          const difference = target[rgbIndex + channel] - rendered;
          error += difference * difference * errorWeights[targetIndex];
        }
      }
    }

    const result = { error, color };
    segmentEvaluationCache.set(key, result);
    return result;
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
      segmentEvaluation(state.last, start, end - start).error +
      whiteSuffixError[end]
    ) / denominator;
  };

  let beam = [{ text: "", colors: [], width: 0, errorSum: 0, last: -1 }];
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
            colors: [],
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
        const segment = segmentEvaluation(state.last, start, end - start);
        const nextState = {
          text: state.text + glyphs[next].char,
          colors: state.colors.concat([segment.color]),
          width: newWidth,
          errorSum: state.errorSum + segment.error,
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

  const text = bestState.text.replace(/ +$/, "");
  let colors = bestState.colors;
  if (bestState.last >= 0) {
    const start = pythonRound(bestState.width);
    const end = pythonRound(bestState.width + advances[bestState.last]);
    colors = colors.concat([segmentEvaluation(bestState.last, start, end - start).color]);
  }
  return {
    lineIndex,
    text,
    colors: colors.slice(0, text.length),
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
