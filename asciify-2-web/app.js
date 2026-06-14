const SIZE_ONE_LINE_WIDTH = 9019;
const SIZE_ONE_ACTUAL_POINTS = 2.25;
const GLYPH_HEIGHT = 58;
const FOREGROUND_WEIGHT = 4;
const BEAM_WIDTHS = {
  1: 5,
  5: 10,
  8: 20,
  11: 30,
  15: 40,
  20: 40,
};

const form = document.querySelector("#convert-form");
const imageInput = document.querySelector("#image-input");
const dropZone = document.querySelector("#drop-zone");
const fileLabel = document.querySelector("#file-label");
const fontSizeSelect = document.querySelector("#font-size");
const fontHint = document.querySelector("#font-hint");
const convertButton = document.querySelector("#convert-button");
const cancelButton = document.querySelector("#cancel-button");
const previewShell = document.querySelector("#preview-shell");
const imagePreview = document.querySelector("#image-preview");
const progressShell = document.querySelector("#progress-shell");
const statusText = document.querySelector("#status-text");
const progressLabel = document.querySelector("#progress-label");
const progress = document.querySelector("#progress");
const errorMessage = document.querySelector("#error-message");
const resultSection = document.querySelector("#result-section");
const resultSummary = document.querySelector("#result-summary");
const asciiOutput = document.querySelector("#ascii-output");
const copyButton = document.querySelector("#copy-button");

let selectedFile = null;
let previewUrl = null;
let activeRun = null;
let outputText = "";
const calibrationCache = new Map();

const fontHints = {
  1: "Size 1 creates very dense output and can take a minute or more.",
  5: "Size 5 creates dense output and may take around a minute.",
  8: "Size 8 usually takes tens of seconds.",
  11: "Size 11 usually takes several seconds and is a good default.",
  15: "Size 15 usually finishes quickly.",
  20: "Size 20 produces the smallest, fastest result.",
};

fontSizeSelect.addEventListener("change", () => {
  fontHint.textContent = fontHints[fontSizeSelect.value];
});

imageInput.addEventListener("change", () => {
  setSelectedFile(imageInput.files[0] || null);
});

for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
  });
}

dropZone.addEventListener("drop", (event) => {
  const [file] = event.dataTransfer.files;
  if (file) {
    setSelectedFile(file);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedFile || activeRun) {
    return;
  }

  setError("");
  resultSection.hidden = true;
  outputText = "";
  setBusy(true);

  const run = {
    cancelled: false,
    workers: [],
    startedAt: performance.now(),
  };
  activeRun = run;

  try {
    const fontSize = Number(fontSizeSelect.value);
    setStatus("Loading calibration...", 0, 1);
    const calibration = await loadCalibration(fontSize);
    assertActive(run);

    setStatus("Preparing image...", 0, 1);
    const source = await loadSourceImage(selectedFile);
    assertActive(run);

    const numLines = Math.max(
      1,
      Math.round((source.height * calibration.lineWidth) / (source.width * GLYPH_HEIGHT)),
    );

    const lines = await convertImage({
      calibration,
      source,
      numLines,
      beamWidth: BEAM_WIDTHS[fontSize],
      run,
    });
    assertActive(run);

    outputText = `${lines.join("\n")}\n`;
    asciiOutput.textContent = outputText;
    asciiOutput.style.fontSize = fontSize === 1 ? "2.25pt" : `${fontSize}pt`;

    const elapsed = (performance.now() - run.startedAt) / 1000;
    const characters = lines.reduce((sum, line) => sum + line.length, 0);
    resultSummary.textContent =
      `${numLines} lines, ${characters.toLocaleString()} characters, ` +
      `${formatDuration(elapsed)}.`;
    resultSection.hidden = false;
    resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
    setStatus("Complete.", numLines, numLines);
  } catch (error) {
    if (error.name !== "AbortError") {
      console.error(error);
      setError(error.message || "The conversion failed.");
    }
  } finally {
    terminateWorkers(run);
    if (activeRun === run) {
      activeRun = null;
      setBusy(false);
    }
  }
});

cancelButton.addEventListener("click", () => {
  if (!activeRun) {
    return;
  }
  const run = activeRun;
  run.cancelled = true;
  terminateWorkers(run);
  if (run.reject) {
    run.reject(new DOMException("Conversion cancelled.", "AbortError"));
  }
  activeRun = null;
  setBusy(false);
  setStatus("Conversion cancelled.", 0, 1);
});

copyButton.addEventListener("click", async () => {
  if (!outputText) {
    return;
  }

  try {
    await navigator.clipboard.writeText(outputText);
    copyButton.textContent = "Copied";
    window.setTimeout(() => {
      copyButton.textContent = "Copy to clipboard";
    }, 1800);
  } catch {
    const range = document.createRange();
    range.selectNodeContents(asciiOutput);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    copyButton.textContent = "Selected text";
  }
});

function setSelectedFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    selectedFile = null;
    convertButton.disabled = true;
    setError(file ? "Please choose an image file." : "");
    return;
  }

  selectedFile = file;
  fileLabel.textContent = file.name;
  setError("");
  convertButton.disabled = Boolean(activeRun);

  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
  }
  previewUrl = URL.createObjectURL(file);
  imagePreview.src = previewUrl;
  previewShell.hidden = false;
}

function setBusy(busy) {
  convertButton.disabled = busy || !selectedFile;
  fontSizeSelect.disabled = busy;
  imageInput.disabled = busy;
  cancelButton.hidden = !busy;
  progressShell.hidden = !busy && !statusText.textContent;
}

function setStatus(message, value, max) {
  statusText.textContent = message;
  progress.max = Math.max(1, max);
  progress.value = value;
  progressLabel.textContent = max > 1 ? `${value}/${max} rows` : "";
  progressShell.hidden = false;
}

function setError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = !message;
}

function assertActive(run) {
  if (run.cancelled || activeRun !== run) {
    throw new DOMException("Conversion cancelled.", "AbortError");
  }
}

async function loadCalibration(fontSize) {
  if (calibrationCache.has(fontSize)) {
    return calibrationCache.get(fontSize);
  }
  const response = await fetch(`calibration/${fontSize}.json`);
  if (!response.ok) {
    throw new Error(`Could not load the size ${fontSize} calibration.`);
  }
  const calibration = await response.json();
  calibrationCache.set(fontSize, calibration);
  return calibration;
}

async function loadSourceImage(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { canvas, width: canvas.width, height: canvas.height };
}

async function convertImage({ calibration, source, numLines, beamWidth, run }) {
  const workerCount = Math.min(
    numLines,
    8,
    Math.max(1, (navigator.hardwareConcurrency || 4) - 1),
  );
  const results = new Array(numLines);
  let nextLine = 0;
  let completed = 0;

  const stripCanvas = document.createElement("canvas");
  stripCanvas.width = calibration.lineWidth;
  stripCanvas.height = calibration.glyphHeight;
  const stripContext = stripCanvas.getContext("2d", {
    alpha: false,
    willReadFrequently: true,
  });
  stripContext.imageSmoothingEnabled = true;
  stripContext.imageSmoothingQuality = "high";

  setStatus(`Searching with ${workerCount} parallel workers...`, 0, numLines);

  return new Promise((resolve, reject) => {
    run.reject = reject;

    const dispatch = (worker) => {
      if (run.cancelled) {
        return;
      }
      if (nextLine >= numLines) {
        if (completed === numLines) {
          resolve(results);
        }
        return;
      }

      const lineIndex = nextLine++;
      const target = renderStrip(
        source,
        stripContext,
        calibration.lineWidth,
        calibration.glyphHeight,
        lineIndex,
        numLines,
      );
      worker.postMessage({ type: "search", lineIndex, target }, [target.buffer]);
    };

    for (let index = 0; index < workerCount; index++) {
      const worker = new Worker("worker.js");
      run.workers.push(worker);

      worker.addEventListener("message", (event) => {
        const message = event.data;
        if (message.type === "ready") {
          dispatch(worker);
          return;
        }
        if (message.type === "result") {
          results[message.lineIndex] = message.text;
          completed++;
          setStatus("Searching rows...", completed, numLines);
          dispatch(worker);
        }
      });

      worker.addEventListener("error", (event) => {
        reject(new Error(event.message || "A search worker failed."));
      });

      worker.postMessage({
        type: "init",
        calibration,
        beamWidth,
        foregroundWeight: FOREGROUND_WEIGHT,
      });
    }
  });
}

function renderStrip(source, context, width, height, lineIndex, numLines) {
  const top = Math.round((source.height * lineIndex) / numLines);
  let bottom = Math.round((source.height * (lineIndex + 1)) / numLines);
  if (bottom <= top) {
    bottom = Math.min(source.height, top + 1);
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(
    source.canvas,
    0,
    top,
    source.width,
    bottom - top,
    0,
    0,
    width,
    height,
  );

  const rgba = context.getImageData(0, 0, width, height).data;
  const gray = new Uint8Array(width * height);
  for (let sourceIndex = 0, targetIndex = 0; sourceIndex < rgba.length; sourceIndex += 4) {
    gray[targetIndex++] = Math.round(
      0.299 * rgba[sourceIndex] +
      0.587 * rgba[sourceIndex + 1] +
      0.114 * rgba[sourceIndex + 2],
    );
  }
  return gray;
}

function terminateWorkers(run) {
  for (const worker of run.workers) {
    worker.terminate();
  }
  run.workers.length = 0;
}

function formatDuration(seconds) {
  if (seconds < 60) {
    return `${seconds.toFixed(1)} seconds`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

setBusy(false);
