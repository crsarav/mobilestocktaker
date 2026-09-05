# Product Requirements Document: Mobile Visual Stock Taker PWA

## 1. Project Overview
A lightweight, zero-backend Progressive Web App (PWA) designed for mobile browsers. It allows warehouse operators to snap inventory photos, run automated client-side object detection (TensorFlow.js) with human-in-the-loop quantity verification, and push the verified photo and count directly to WhatsApp via the native Web Share API. 

## 2. Core Technical Architecture
* **Platform:** Vercel (Static hosting, HTTPS required for camera/share).
* **Frontend:** Static HTML5, CSS3, Vanilla JavaScript (Single Page App).
* **Vision Inference:** TensorFlow.js + COCO-SSD (runs 100% locally).
* **Handoff Mechanism:** Native `navigator.share` (bundles Image File + Text Caption), falling back to `wa.me` text link.
* **PWA capabilities:** Service Worker (`sw.js`) for offline caching and `manifest.json` for home-screen installation.

## 3. Project File Structure
```text
/
├── public/
│   ├── master-icon.svg
│   ├── icon-192.png  (Generated from SVG)
│   └── icon-512.png  (Generated from SVG)
├── index.html
├── manifest.json
├── sw.js
└── vercel.json