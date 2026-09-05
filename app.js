(() => {
  "use strict";

  const TESS_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
  const ZXING_URL = "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js";
  const BOX_COLORS = ["#0666EB", "#6D3CFF", "#0EA5E9", "#16A34A", "#F59E0B"];
  const IGNORE_CLASSES = new Set([
    "person",
    "cat",
    "dog",
    "horse",
    "sheep",
    "cow",
    "bird",
    "chair",
    "couch",
    "bed",
    "dining table",
    "tv",
    "laptop",
    "keyboard",
    "mouse",
    "remote",
    "cell phone",
  ]);
  const OCR_STOP = new Set([
    "net",
    "wt",
    "oz",
    "lb",
    "ct",
    "the",
    "and",
    "with",
    "for",
    "of",
    "a",
    "to",
    "in",
  ]);

  const els = {
    app: document.getElementById("app"),
    location: document.getElementById("location"),
    homeTotal: document.getElementById("homeTotal"),
    statusPill: document.getElementById("statusPill"),
    installBtn: document.getElementById("installBtn"),
    quickSnap: document.getElementById("quickSnap"),
    quickGallery: document.getElementById("quickGallery"),
    quickAdd: document.getElementById("quickAdd"),
    quickSend: document.getElementById("quickSend"),
    emptyState: document.getElementById("emptyState"),
    latestCard: document.getElementById("latestCard"),
    latestThumb: document.getElementById("latestThumb"),
    latestTitle: document.getElementById("latestTitle"),
    latestMeta: document.getElementById("latestMeta"),
    homeView: document.getElementById("homeView"),
    captureView: document.getElementById("captureView"),
    reviewView: document.getElementById("reviewView"),
    preview: document.getElementById("preview"),
    cameraHint: document.getElementById("cameraHint"),
    detectBusy: document.getElementById("detectBusy"),
    closeCameraBtn: document.getElementById("closeCameraBtn"),
    galleryBtn: document.getElementById("galleryBtn"),
    shutterBtn: document.getElementById("shutterBtn"),
    fileInput: document.getElementById("fileInput"),
    overlay: document.getElementById("overlay"),
    lines: document.getElementById("lines"),
    totalCount: document.getElementById("totalCount"),
    customLabel: document.getElementById("customLabel"),
    customQty: document.getElementById("customQty"),
    addItemBtn: document.getElementById("addItemBtn"),
    retakeBtn: document.getElementById("retakeBtn"),
    shareBtn: document.getElementById("shareBtn"),
    tabbar: document.getElementById("tabbar"),
    tabSend: document.getElementById("tabSend"),
    toast: document.getElementById("toast"),
    busyTitle: document.getElementById("busyTitle"),
    busyHint: document.getElementById("busyHint"),
  };

  const state = {
    stream: null,
    model: null,
    photo: null,
    detections: [],
    lines: [],
    installEvent: null,
    thumbUrl: "",
    ocrWorker: null,
    scannedName: "",
    ocrPending: false,
    ocrToken: 0,
    visionApi: false,
  };

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => els.toast.classList.remove("show"), 2800);
  }

  function setStatus(kind, text) {
    els.statusPill.textContent = text;
    els.statusPill.classList.toggle("error", kind === "error");
  }

  function showView(name) {
    els.homeView.classList.toggle("active", name === "home");
    els.captureView.classList.toggle("active", name === "capture");
    els.reviewView.classList.toggle("active", name === "review");
    els.app.classList.toggle("camera-open", name === "capture");
    els.tabbar.querySelectorAll("[data-view]").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.view === name);
    });
    if (name === "capture") startCamera();
    else stopCamera();
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === "1") {
          resolve();
          return;
        }
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)));
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => {
        script.dataset.loaded = "1";
        resolve();
      };
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });
  }

  async function warmup() {
    try {
      const res = await fetch("/api/identify");
      const json = await res.json();
      state.visionApi = Boolean(json.configured);
    } catch (error) {
      state.visionApi = false;
    }
    if (state.visionApi) setStatus("ready", "Vision ready");
    else setStatus("error", "Add API key");
    loadZxing().catch((error) => console.error(error));
  }

  async function loadOcr() {
    if (state.ocrWorker) return state.ocrWorker;
    await loadScript(TESS_URL);
    state.ocrWorker = await window.Tesseract.createWorker("eng");
    return state.ocrWorker;
  }

  async function loadZxing() {
    if (window.ZXing) return window.ZXing;
    await loadScript(ZXING_URL);
    return window.ZXing;
  }

  function photoToOcrCanvas(photo) {
    const maxEdge = 1400;
    const scale = Math.min(1, maxEdge / Math.max(photo.width, photo.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(photo.width * scale));
    canvas.height = Math.max(1, Math.round(photo.height * scale));
    canvas.getContext("2d").drawImage(photo, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function rotateCanvas(src, quarterTurns) {
    const turns = ((quarterTurns % 4) + 4) % 4;
    if (turns === 0) return src;
    const canvas = document.createElement("canvas");
    canvas.width = turns % 2 ? src.height : src.width;
    canvas.height = turns % 2 ? src.width : src.height;
    const ctx = canvas.getContext("2d");
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((turns * Math.PI) / 2);
    ctx.drawImage(src, -src.width / 2, -src.height / 2);
    return canvas;
  }

  function preprocessCanvas(src, crop) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (crop) {
      const width = src.width * 0.72;
      const height = src.height * 0.52;
      const x = (src.width - width) / 2;
      const y = src.height * 0.14;
      canvas.width = Math.max(1, Math.round(width));
      canvas.height = Math.max(1, Math.round(height));
      ctx.drawImage(src, x, y, width, height, 0, 0, canvas.width, canvas.height);
    } else {
      canvas.width = src.width;
      canvas.height = src.height;
      ctx.drawImage(src, 0, 0);
    }

    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = image.data;
    let sum = 0;
    const count = pixels.length / 4;
    for (let i = 0; i < pixels.length; i += 4) {
      const gray = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      pixels[i] = pixels[i + 1] = pixels[i + 2] = gray;
      sum += gray;
    }
    const mean = sum / count;
    for (let i = 0; i < pixels.length; i += 4) {
      let value = (pixels[i] - mean) * 1.7 + 140;
      if (value < 55) value = 0;
      else if (value > 210) value = 255;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = value;
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  function barcodeRegions(src) {
    const regions = [src];
    const strips = [
      [src.width * 0.62, 0, src.width * 0.38, src.height],
      [0, src.height * 0.62, src.width, src.height * 0.38],
    ];
    strips.forEach(([x, y, width, height]) => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width));
      canvas.height = Math.max(1, Math.round(height));
      canvas.getContext("2d").drawImage(src, x, y, width, height, 0, 0, canvas.width, canvas.height);
      regions.push(canvas);
    });
    return regions;
  }

  async function decodeNativeBarcode(canvas) {
    if (!("BarcodeDetector" in window)) return "";
    try {
      const detector = new window.BarcodeDetector({
        formats: ["upc_a", "upc_e", "ean_13", "ean_8", "code_128", "code_39", "qr_code"],
      });
      const codes = await detector.detect(canvas);
      return String(codes[0]?.rawValue || "").replace(/\s/g, "");
    } catch (error) {
      return "";
    }
  }

  async function decodeZxingCanvas(canvas) {
    const ZXing = await loadZxing();
    if (!ZXing) return "";
    try {
      if (ZXing.BrowserMultiFormatReader) {
        const reader = new ZXing.BrowserMultiFormatReader();
        const result = await reader.decodeFromCanvas(canvas);
        return String(result?.getText?.() || result?.text || "").replace(/\s/g, "");
      }
      const source = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
      const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(source));
      const reader = new ZXing.MultiFormatReader();
      const result = reader.decode(bitmap);
      return String(result?.getText?.() || result?.text || "").replace(/\s/g, "");
    } catch (error) {
      return "";
    }
  }

  async function decodeBarcode(photo) {
    const base = photoToOcrCanvas(photo);
    for (let turn = 0; turn < 4; turn++) {
      const rotated = rotateCanvas(base, turn);
      for (const region of barcodeRegions(rotated)) {
        const nativeCode = await decodeNativeBarcode(region);
        if (nativeCode.length >= 8) return nativeCode;
        const zxingCode = await decodeZxingCanvas(region);
        if (zxingCode.length >= 8) return zxingCode;
      }
    }
    return "";
  }

  function cleanProductTitle(title) {
    return titleCase(
      String(title || "")
        .split(/[|,]/)[0]
        .replace(/\s+/g, " ")
        .trim()
    ).slice(0, 52);
  }

  async function lookupBarcodeName(code) {
    const digits = String(code).replace(/\D/g, "");
    if (digits.length < 8) return "";
    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${digits}.json`);
      if (res.ok) {
        const json = await res.json();
        if (json.status === 1 && json.product) {
          const product = json.product;
          const name = product.product_name_en || product.product_name || "";
          const brand = product.brands ? String(product.brands).split(",")[0].trim() : "";
          if (name && brand && !name.toLowerCase().includes(brand.toLowerCase())) {
            return cleanProductTitle(`${brand} ${name}`);
          }
          return cleanProductTitle(name || brand);
        }
      }
    } catch (error) {
      console.error(error);
    }
    return "";
  }

  function cleanPhrase(value) {
    return String(value || "")
      .replace(/[^A-Za-z0-9 &'’+.-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function scoreProductName(raw) {
    const cleaned = cleanPhrase(raw);
    if (!cleaned) return { name: "", score: 0 };
    if (/usps|priority mail|postage|united states postal|click n ship|net wt|pouches/i.test(cleaned)) {
      return { name: "", score: 0 };
    }
    const words = cleaned.split(" ").filter(Boolean);
    const letters = (word) => word.replace(/[^A-Za-z]/g, "");
    const long = words.filter((word) => letters(word).length >= 4);
    const tiny = words.filter((word) => letters(word).length <= 2);
    if (!long.length) return { name: "", score: 0 };

    let score = long.length * 14 + Math.min(cleaned.length, 28);
    if (words.length >= 2 && words.length <= 5) score += 12;
    if (/chocolate|chip|cookie|cracker|cereal|snack|candy|famous|amos/i.test(cleaned)) score += 16;
    score -= tiny.length * 10;
    if (tiny.length && tiny.length >= words.length - 1) score -= 20;
    return { name: titleCase(cleaned).slice(0, 48).trim(), score };
  }

  function phrasesFromOcr(data) {
    const phrases = [];
    (data.lines || []).forEach((line) => {
      if ((line.confidence || 0) >= 50) phrases.push(line.text);
    });
    const words = (data.words || [])
      .filter((word) => (word.confidence || 0) >= 62)
      .map((word) => {
        const bbox = word.bbox || {};
        return {
          text: String(word.text || "").replace(/[^\w&'+.-]/g, ""),
          y: bbox.y0 || 0,
          x: bbox.x0 || 0,
          h: (bbox.y1 || 0) - (bbox.y0 || 0),
        };
      })
      .filter((word) => word.text.length >= 2 && /[A-Za-z]/.test(word.text))
      .filter((word) => !OCR_STOP.has(word.text.toLowerCase()))
      .sort((a, b) => a.y - b.y || a.x - b.x);

    const grouped = [];
    words.forEach((word) => {
      const last = grouped[grouped.length - 1];
      if (last && Math.abs(word.y - last.y) < Math.max(14, last.h * 0.65)) {
        last.words.push(word);
        last.y = (last.y + word.y) / 2;
      } else {
        grouped.push({ y: word.y, h: word.h, words: [word] });
      }
    });
    grouped.forEach((line) => {
      phrases.push(
        line.words
          .sort((a, b) => a.x - b.x)
          .map((word) => word.text)
          .join(" ")
      );
    });
    String(data.text || "")
      .split(/\n+/)
      .forEach((line) => phrases.push(line));
    return phrases;
  }

  function pickProductName(data, bonus) {
    const ranked = phrasesFromOcr(data)
      .map((phrase) => scoreProductName(phrase))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);
    if (!ranked.length) return { name: "", score: 0 };

    const top = ranked[0];
    const second = ranked[1];
    if (
      second &&
      top.name.split(" ").length <= 2 &&
      second.name.split(" ").length <= 2 &&
      top.name.toLowerCase() !== second.name.toLowerCase() &&
      !top.name.toLowerCase().includes(second.name.toLowerCase())
    ) {
      const combo = scoreProductName(`${top.name} ${second.name}`);
      combo.score += bonus;
      if (combo.score >= top.score + bonus) return combo;
    }
    return { name: top.name, score: top.score + bonus };
  }

  async function recognizeWithMode(worker, canvas, mode) {
    await worker.setParameters({ tessedit_pageseg_mode: String(mode) });
    const { data } = await worker.recognize(canvas);
    return data;
  }

  async function readLabelOcr(photo) {
    const worker = await loadOcr();
    const base = photoToOcrCanvas(photo);
    let best = { name: "", score: 0 };
    for (let turn = 0; turn < 4; turn++) {
      const rotated = rotateCanvas(base, turn);
      const ranked = pickProductName(await recognizeWithMode(worker, preprocessCanvas(rotated, true), 6), 0);
      if (ranked.score > best.score) best = ranked;
      if (best.score >= 24) break;
    }
    return best.score >= 18 ? best.name : "";
  }

  async function readLabel(photo) {
    const code = await decodeBarcode(photo);
    if (code) {
      const catalogName = await lookupBarcodeName(code);
      if (catalogName) return catalogName;
    }
    return readLabelOcr(photo);
  }

  function applyItems(items, source) {
    const lines = (items || [])
      .map((item) => ({
        id: nextId(),
        label: String(item.name || "").trim(),
        count: Math.max(1, Math.round(Number(item.count) || 1)),
        source,
      }))
      .filter((item) => item.label);
    if (!lines.length) return false;
    state.lines = lines;
    state.scannedName = lines[0].label;
    els.customLabel.value = lines[0].label;
    els.customLabel.placeholder = "Item name";
    els.customQty.value = String(lines[0].count);
    state.ocrPending = false;
    renderLines();
    return true;
  }

  async function blobToJpegBase64(blob) {
    const bitmap = await createImageBitmap(blob);
    const maxEdge = 1600;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const jpeg = await canvasToBlob(canvas);
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(jpeg);
    });
    return dataUrl.replace(/^data:image\/\w+;base64,/, "");
  }

  async function identifyWithApi(blob) {
    const image = await blobToJpegBase64(blob);
    const response = await fetch("/api/identify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image }),
    });
    if (response.status === 503) return { status: "missing_key" };
    if (response.status === 404) return { status: "missing_route" };
    if (!response.ok) return { status: "error" };
    const payload = await response.json();
    return { status: "ok", items: Array.isArray(payload.items) ? payload.items : [] };
  }

  function applyScannedName(name) {
    els.customLabel.placeholder = "Item name";
    if (!name) {
      renderLines();
      return;
    }
    if (!els.customLabel.value.trim()) els.customLabel.value = name;
    if (!state.lines.length) {
      applyItems([{ name, count: 1 }], "scan");
      return;
    }
    state.lines.forEach((line) => {
      if (line.source === "auto") {
        line.label = name;
        line.source = "scan";
      }
    });
    renderLines();
  }

  async function startCamera() {
    if (state.stream) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      els.cameraHint.textContent = "Camera unavailable — use Gallery";
      return;
    }
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 1920 },
        },
      });
      els.preview.srcObject = state.stream;
      els.cameraHint.textContent = "Include every product you want counted";
    } catch (error) {
      console.error(error);
      els.cameraHint.textContent = "Camera blocked — use Gallery";
    }
  }

  function stopCamera() {
    if (!state.stream) return;
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
    els.preview.srcObject = null;
  }

  function titleCase(value) {
    return value.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function nextId() {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function groupLines(detections) {
    const grouped = new Map();
    detections
      .filter((det) => !IGNORE_CLASSES.has(det.class))
      .forEach((det) => {
        const key = det.class;
        const current = grouped.get(key) || {
          id: nextId(),
          label: titleCase(det.class),
          count: 0,
          source: "auto",
        };
        current.count += 1;
        grouped.set(key, current);
      });
    return Array.from(grouped.values());
  }

  function total() {
    return state.lines.reduce((sum, line) => sum + Number(line.count || 0), 0);
  }

  function locationLabel() {
    return els.location.value.trim() || "No location";
  }

  function refreshSummary() {
    const count = total();
    els.homeTotal.textContent = String(count);
    els.totalCount.textContent = String(count);
    const hasCount = count > 0 || Boolean(state.photo);
    els.emptyState.hidden = hasCount;
    els.latestCard.hidden = !hasCount;
    els.latestTitle.textContent = `${count} item${count === 1 ? "" : "s"}`;
    els.latestMeta.textContent = locationLabel();
    els.latestThumb.hidden = !state.thumbUrl;
    if (state.thumbUrl) els.latestThumb.src = state.thumbUrl;
  }

  function renderLines() {
    els.lines.innerHTML = "";
    if (!state.lines.length) {
      const empty = document.createElement("article");
      empty.className = "card empty";
      empty.innerHTML = state.ocrPending
        ? "<h2>Identifying…</h2><p>Reading the barcode, then the package label.</p>"
        : "<h2>No items yet</h2><p>Add a line or snap a photo to detect stock.</p>";
      els.lines.appendChild(empty);
      refreshSummary();
      return;
    }

    state.lines.forEach((line) => {
      const row = document.createElement("div");
      row.className = "line";

      const mark = document.createElement("div");
      mark.className = "line-mark";
      mark.textContent = (line.label || "?").slice(0, 1).toUpperCase();

      const mid = document.createElement("div");
      const name = document.createElement("input");
      name.type = "text";
      name.value = line.label;
      name.setAttribute("aria-label", "Item name");
      name.addEventListener("input", () => {
        line.label = name.value;
        mark.textContent = (line.label || "?").slice(0, 1).toUpperCase();
        refreshSummary();
      });
      const source = document.createElement("span");
      source.className = "source";
      source.textContent =
        line.source === "scan" ? "Scanned" : line.source === "auto" ? "Detected" : "Added";
      mid.append(name, source);

      const stepper = document.createElement("div");
      stepper.className = "stepper";
      const minus = document.createElement("button");
      minus.type = "button";
      minus.textContent = "−";
      minus.setAttribute("aria-label", "Decrease quantity");
      const output = document.createElement("output");
      output.textContent = String(line.count);
      const plus = document.createElement("button");
      plus.type = "button";
      plus.textContent = "+";
      plus.setAttribute("aria-label", "Increase quantity");
      minus.addEventListener("click", () => {
        line.count = Math.max(0, line.count - 1);
        if (line.count === 0) {
          state.lines = state.lines.filter((item) => item.id !== line.id);
        }
        renderLines();
      });
      plus.addEventListener("click", () => {
        line.count += 1;
        renderLines();
      });
      stepper.append(minus, output, plus);

      row.append(mark, mid, stepper);
      els.lines.appendChild(row);
    });
    refreshSummary();
  }

  function drawOverlay() {
    if (!state.photo) return;
    const canvas = els.overlay;
    const ctx = canvas.getContext("2d");
    const photo = state.photo;
    canvas.width = photo.width;
    canvas.height = photo.height;
    ctx.drawImage(photo, 0, 0);
    state.detections.forEach((det, index) => {
      const [x, y, width, height] = det.bbox;
      const color = BOX_COLORS[index % BOX_COLORS.length];
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(3, Math.round(photo.width / 240));
      ctx.strokeRect(x, y, width, height);
      const label = `${titleCase(det.class)} ${Math.round(det.score * 100)}%`;
      ctx.font = `${Math.max(16, Math.round(photo.width / 32))}px Inter, sans-serif`;
      const pad = 6;
      const textWidth = ctx.measureText(label).width;
      ctx.fillStyle = "rgba(11,13,18,0.82)";
      ctx.fillRect(x, Math.max(0, y - 28), textWidth + pad * 2, 26);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, x + pad, Math.max(18, y - 10));
    });
    state.thumbUrl = canvas.toDataURL("image/jpeg", 0.7);
  }

  async function canvasToBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.86));
  }

  async function captureFromVideo() {
    const video = els.preview;
    if (!video.videoWidth) {
      toast("Camera is not ready yet.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    const blob = await canvasToBlob(canvas);
    await processPhoto(blob);
  }

  async function processPhoto(blob) {
    els.detectBusy.classList.add("show");
    els.shutterBtn.disabled = true;
    if (els.busyTitle) els.busyTitle.textContent = "Identifying";
    if (els.busyHint) els.busyHint.textContent = "Finding every product in the photo";
    const token = ++state.ocrToken;
    try {
      state.photo = await createImageBitmap(blob);
      state.detections = [];
      state.lines = [];
      state.scannedName = "";
      els.customLabel.value = "";
      state.ocrPending = true;
      els.customLabel.placeholder = "Identifying…";
      drawOverlay();
      renderLines();
      showView("review");
    } catch (error) {
      console.error(error);
      toast("Could not open this photo. Try another angle.");
      return;
    } finally {
      els.detectBusy.classList.remove("show");
      els.shutterBtn.disabled = false;
    }

    try {
      const result = await identifyWithApi(blob);
      if (token !== state.ocrToken) return;
      if (result.status === "ok" && applyItems(result.items, "scan")) return;
      if (result.status === "missing_key") {
        state.ocrPending = false;
        els.customLabel.placeholder = "Item name";
        renderLines();
        toast("Add GEMINI_API_KEY in Vercel, then redeploy.");
        return;
      }
      if (result.status === "missing_route") {
        toast("Vision API is not deployed. Redeploy the latest commit.");
      } else if (result.status === "ok") {
        toast("No products found. Try a closer photo of one SKU.");
      } else {
        toast("Vision lookup failed. Try again or enter items manually.");
      }
    } catch (error) {
      console.error(error);
      toast("Vision lookup failed. Try again or enter items manually.");
    }

    try {
      const name = await lookupBarcodeName((await decodeBarcode(state.photo)) || "");
      if (token !== state.ocrToken) return;
      state.ocrPending = false;
      applyScannedName(name);
    } catch (error) {
      console.error(error);
      if (token !== state.ocrToken) return;
      state.ocrPending = false;
      els.customLabel.placeholder = "Item name";
      renderLines();
    }
  }

  function caption() {
    const when = new Date().toLocaleString();
    const rows = state.lines
      .filter((line) => line.count > 0 && line.label.trim())
      .map((line) => `• ${line.label.trim()} × ${line.count}`)
      .join("\n");
    return [
      "STOCKTAKER COUNT",
      `Location: ${locationLabel()}`,
      `Total: ${total()}`,
      "",
      rows || "• No line items",
      "",
      `Verified: ${when}`,
    ].join("\n");
  }

  async function shareToWhatsApp() {
    if (!total()) {
      toast("Add a count before sending.");
      return;
    }
    const text = caption();
    const payload = { text, title: "StockTaker count" };
    if (els.overlay.width) {
      const blob = await canvasToBlob(els.overlay);
      payload.files = [new File([blob], "stocktaker-count.jpg", { type: "image/jpeg" })];
    }

    try {
      if (navigator.share && navigator.canShare?.(payload)) {
        await navigator.share(payload);
        return;
      }
      if (navigator.share) {
        await navigator.share({ text, title: payload.title });
        return;
      }
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.error(error);
    }

    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  }

  function openGallery() {
    els.fileInput.click();
  }

  function restoreLocation() {
    const saved = localStorage.getItem("stocktaker.location");
    if (saved) els.location.value = saved;
  }

  els.location.addEventListener("change", () => {
    localStorage.setItem("stocktaker.location", els.location.value.trim());
    refreshSummary();
  });

  els.quickSnap.addEventListener("click", () => showView("capture"));
  els.quickGallery.addEventListener("click", () => {
    showView("capture");
    openGallery();
  });
  els.quickAdd.addEventListener("click", () => {
    showView("review");
    els.customLabel.focus();
  });
  els.quickSend.addEventListener("click", shareToWhatsApp);
  els.tabSend.addEventListener("click", shareToWhatsApp);

  els.shutterBtn.addEventListener("click", captureFromVideo);
  els.galleryBtn.addEventListener("click", openGallery);
  els.closeCameraBtn.addEventListener("click", () => showView("home"));
  els.fileInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await processPhoto(file);
  });

  els.retakeBtn.addEventListener("click", () => showView("capture"));
  els.addItemBtn.addEventListener("click", () => {
    const label = els.customLabel.value.trim();
    const count = Math.max(1, Number(els.customQty.value || 1));
    if (!label) {
      els.customLabel.focus();
      return;
    }
    state.lines.push({ id: nextId(), label, count, source: "manual" });
    els.customLabel.value = "";
    els.customQty.value = "1";
    renderLines();
  });
  els.shareBtn.addEventListener("click", shareToWhatsApp);

  els.tabbar.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-view]");
    if (!tab) return;
    showView(tab.dataset.view);
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installEvent = event;
    els.installBtn.hidden = false;
  });

  els.installBtn.addEventListener("click", async () => {
    if (!state.installEvent) return;
    state.installEvent.prompt();
    await state.installEvent.userChoice;
    state.installEvent = null;
    els.installBtn.hidden = true;
  });

  if ("serviceWorker" in navigator && window.isSecureContext) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch((error) => console.error(error));
    });
  }

  restoreLocation();
  renderLines();
  warmup();
})();
