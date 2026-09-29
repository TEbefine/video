#!/usr/bin/env node
/**
 * Build composition script for HyperFrames.
 * 
 * Usage:
 *   node scripts/build-compositions.mjs [lang]
 *   Example: node scripts/build-compositions.mjs th
 * 
 * Reads locales.json, measures generated audio durations via ffprobe,
 * replaces {{tokens}} in templates/index.html, and writes root index.html.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";

const lang = (process.argv[2] || "en").toLowerCase();
const baseDir = resolve(import.meta.dirname, "..");

const LOCALES_PATH = join(baseDir, "locales.json");
const TEMPLATE_PATH = join(baseDir, "templates", "index.html");
const OUTPUT_PATH = join(baseDir, "index.html");

if (!existsSync(LOCALES_PATH)) {
  console.error(`✗ locales.json not found at: ${LOCALES_PATH}`);
  process.exit(1);
}

const locales = JSON.parse(readFileSync(LOCALES_PATH, "utf-8"));
if (!locales[lang]) {
  console.error(`✗ Language "${lang}" not found in locales.json. Available: ${Object.keys(locales).join(", ")}`);
  process.exit(1);
}

const langData = locales[lang];

// ── Audio Duration Measurement ───────────────────────────────────────────────
function getAudioDuration(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    const stdout = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}"`,
      { encoding: "utf-8" }
    );
    const dur = parseFloat(stdout.trim());
    return isNaN(dur) ? null : Number(dur.toFixed(3));
  } catch (err) {
    return null;
  }
}

const SCENE_KEYS = ["01_hook", "02_intern", "03_formula", "04_cta"];
const DEFAULT_DURS = [6.0, 7.5, 9.5, 6.0];

const voDurations = [];
for (let i = 1; i <= 4; i++) {
  const mp3Path = join(baseDir, "assets", "audio", lang, `scene_0${i}.mp3`);
  const measured = getAudioDuration(mp3Path);
  if (measured !== null) {
    voDurations.push(measured);
  } else {
    const fallback = DEFAULT_DURS[i - 1];
    console.warn(`  ⚠️  Audio file not found: ${mp3Path} -> Using default ${fallback}s`);
    voDurations.push(fallback);
  }
}

// Pacing buffers between scenes
const SCENE_HOLD = 0.55; // Beat after speech before scene cuts
const CTA_TAIL = 1.80;   // Scene 4 holds longer to allow CTA to be absorbed

const sceneDurations = voDurations.map((vo, idx) => {
  const hold = idx === 3 ? CTA_TAIL : SCENE_HOLD;
  return Number((vo + hold).toFixed(3));
});

const sceneStarts = [0];
for (let i = 1; i < 4; i++) {
  sceneStarts.push(Number((sceneStarts[i - 1] + sceneDurations[i - 1]).toFixed(3)));
}

const totalDuration = Number((sceneStarts[3] + sceneDurations[3]).toFixed(3));
const fps = 60;
const totalFrames = Math.round(totalDuration * fps);

// ── Flatten Tokens ───────────────────────────────────────────────────────────
const tokens = {
  lang,
  fps: String(fps),
  total_duration: totalDuration.toFixed(3),
  total_frames: String(totalFrames),
  font_serif: lang === "th" 
    ? "'Noto Serif Thai', 'Libre Baskerville', Georgia, serif" 
    : "'Libre Baskerville', 'Noto Serif Thai', Georgia, serif",
  font_sans: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  font_family: lang === "th" 
    ? "'Noto Serif Thai', 'Libre Baskerville', Georgia, serif" 
    : "'Libre Baskerville', 'Noto Serif Thai', Georgia, serif",
  plate_01: "assets/plate_01.webp",
};

// Add per-scene timing tokens
for (let i = 0; i < 4; i++) {
  const idx = i + 1;
  const start = sceneStarts[i];
  const dur = sceneDurations[i];
  const vo = voDurations[i];
  const end = Number((start + dur).toFixed(3));
  
  tokens[`scene${idx}_start`] = start.toFixed(3);
  tokens[`scene${idx}_dur`] = dur.toFixed(3);
  tokens[`scene${idx}_end`] = end.toFixed(3);
  tokens[`vo${idx}_dur`] = vo.toFixed(3);
}

// Add content tokens from locales.json
for (const sceneKey of SCENE_KEYS) {
  const data = langData[sceneKey] || {};
  const prefix = sceneKey.replace(/^\d+_/, ""); // e.g. "hook", "intern", "formula", "cta"
  
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") {
      // Allow both {{01_hook_badge}} and {{hook_badge}}
      tokens[`${sceneKey}_${key}`] = value;
      tokens[`${prefix}_${key}`] = value;
    }
  }
}

// ── Replace in Template ──────────────────────────────────────────────────────
if (!existsSync(TEMPLATE_PATH)) {
  console.error(`✗ Template not found at: ${TEMPLATE_PATH}`);
  process.exit(1);
}

const templateContent = readFileSync(TEMPLATE_PATH, "utf-8");

const missingTokens = new Set();
const rendered = templateContent.replace(/\{\{([\w.-]+)\}\}/g, (match, key) => {
  if (key in tokens) {
    return tokens[key];
  }
  missingTokens.add(key);
  return match;
});

if (missingTokens.size > 0) {
  console.error(`✗ Missing token values for: ${[...missingTokens].join(", ")}`);
  process.exit(1);
}

// Double check for malformed tokens
const remaining = rendered.match(/\{\{[^}]+\}\}/g);
if (remaining) {
  console.error(`✗ Malformed tokens remaining: ${[...new Set(remaining)].join(", ")}`);
  process.exit(1);
}

writeFileSync(OUTPUT_PATH, rendered, "utf-8");

// Sync duration in hyperframes.json if present
const HYPERFRAMES_CONFIG = join(baseDir, "hyperframes.json");
if (existsSync(HYPERFRAMES_CONFIG)) {
  try {
    const config = JSON.parse(readFileSync(HYPERFRAMES_CONFIG, "utf-8"));
    config.duration = totalDuration;
    writeFileSync(HYPERFRAMES_CONFIG, JSON.stringify(config, null, 2) + "\n", "utf-8");
  } catch (e) {
    // Ignore config update error
  }
}

console.log(`\n🎉 Successfully built composition:`);
console.log(`   Output: ${OUTPUT_PATH}`);
console.log(`   Language: [${lang.toUpperCase()}]`);
console.log(`   Audio durations: [ ${voDurations.map(d => d.toFixed(2) + "s").join(", ")} ]`);
console.log(`   Scene durations: [ ${sceneDurations.map(d => d.toFixed(2) + "s").join(", ")} ]`);
console.log(`   Scene starts:    [ ${sceneStarts.map(s => s.toFixed(2) + "s").join(", ")} ]`);
console.log(`   Total runtime:   ${totalDuration.toFixed(2)}s (${totalFrames} frames @ 60fps)\n`);
