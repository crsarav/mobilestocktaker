(() => {
  "use strict";

  const TFJS_URL = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js";
  const COCO_URL = "https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js";
  const TESS_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
  const MIN_SCORE = 0.5;
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

  async function loadModel() {
    setStatus("loading", "Loading vision");
    try {
      await loadScript(TFJS_URL);
      await loadScript(COCO_URL);
      state.model = await window.cocoSsd.load();
      setStatus("ready", "On-device ready");
      loadOcr().catch((error) => console.error(error));
    } catch (error) {
      console.error(error);
      setStatus("error", "Manual count only");
      toast("Vision model unavailable. You can still count manually.");
    }
  }

  async function loadOcr() {
    if (state.ocrWorker) return state.ocrWorker;
    await loadScript(TESS_URL);
    const worker = await window.Tesseract.createWorker("eng");
    await worker.setParameters({
      tessedit_pageseg_mode: "11",
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 &'-+.",
    });
    state.ocrWorker = worker;
    return worker;
  }

  function photoToOcrCanvas(photo) {
    const maxEdge = 1280;
    const scale = Math.min(1, maxEdge / Math.max(photo.width, photo.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(photo.width * scale));
    canvas.height = Math.max(1, Math.round(photo.height * scale));
    canvas.getContext("2d").drawImage(photo, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function productNameFromText(text) {
    const lines = String(text || "")
      .split(/\n+/)
      .map((line) => line.replace(/[^A-Za-z0-9 &'’+.-]/g, " ").replace(/\s+/g, " ").trim())
      .filter((line) => line.length >= 3)
      .filter((line) => /[A-Za-z]{3,}/.test(line))
      .filter((line) => !/^\d+$/.test(line));
    if (!lines.length) return "";
    return titleCase(lines.slice(0, 3).join(" ")).slice(0, 48).trim();
  }

  function productNameFromOcr(data) {
    const words = (data.words || [])
      .filter((word) => (word.confidence || 0) >= 58)
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
      .filter((word) => !OCR_STOP.has(word.text.toLowerCase()));

    if (!words.length) return productNameFromText(data.text);

    const maxH = Math.max(...words.map((word) => word.h), 1);
    const prominent = words.filter((word) => word.h >= maxH * 0.4);
    const use = prominent.length ? prominent : words;
    use.sort((a, b) => a.y - b.y || a.x - b.x);

    const parts = [];
    const seen = new Set();
    for (const word of use) {
      const key = word.text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push(word.text);
      if (parts.join(" ").length > 42) break;
    }

    const name = titleCase(parts.join(" ").replace(/\s+/g, " ").trim());
    return name || productNameFromText(data.text);
  }

  async function readLabel(photo) {
    const worker = await loadOcr();
    const { data } = await worker.recognize(photoToOcrCanvas(photo));
    return productNameFromOcr(data);
  }

  function applyScannedName(name) {
    els.customLabel.placeholder = "Item name";
    if (!name) {
      renderLines();
      return;
    }
    state.scannedName = name;
    if (!els.customLabel.value.trim()) els.customLabel.value = name;
    if (!state.lines.length) {
      state.lines.push({ id: nextId(), label: name, count: 1, source: "scan" });
    } else {
      state.lines.forEach((line) => {
        if (line.source === "auto") {
          line.label = name;
          line.source = "scan";
        }
      });
    }
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
      els.cameraHint.textContent = "Keep items in frame";
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
        ? "<h2>Reading label…</h2><p>Scanning package text on this device.</p>"
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
    if (els.busyTitle) els.busyTitle.textContent = "Counting";
    if (els.busyHint) els.busyHint.textContent = "On-device object detection";
    const token = ++state.ocrToken;
    try {
      state.photo = await createImageBitmap(blob);
      state.detections = [];
      state.scannedName = "";
      els.customLabel.value = "";
      if (state.model) {
        const detections = await state.model.detect(state.photo);
        state.detections = detections.filter((det) => det.score >= MIN_SCORE);
      }
      state.lines = groupLines(state.detections);
      state.ocrPending = true;
      els.customLabel.placeholder = "Reading label…";
      drawOverlay();
      renderLines();
      showView("review");
    } catch (error) {
      console.error(error);
      toast("Could not count this photo. Try another angle.");
      return;
    } finally {
      els.detectBusy.classList.remove("show");
      els.shutterBtn.disabled = false;
    }

    try {
      const name = await readLabel(state.photo);
      if (token !== state.ocrToken) return;
      state.ocrPending = false;
      applyScannedName(name);
      if (!name) toast("Could not read a label. Type the item name.");
    } catch (error) {
      console.error(error);
      if (token !== state.ocrToken) return;
      state.ocrPending = false;
      els.customLabel.placeholder = "Item name";
      renderLines();
      toast("Could not read a label. Type the item name.");
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
  loadModel();
})();
