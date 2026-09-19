/**
 * dottie-talk config — ~/.config/dottie-talk/config.json
 * keys.enabled is off by default. DOTTIE_TALK_KEYS=on|off overrides.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_KEYS = Object.freeze({
  enabled: false,
  speak: 'SUPER + SHIFT + S',
  stop: 'ESCAPE',
  dictate: '',
  voice: '',
});

export function configPath() {
  if (process.env.DOTTIE_TALK_CONFIG) return process.env.DOTTIE_TALK_CONFIG;
  return path.join(os.homedir(), '.config', 'dottie-talk', 'config.json');
}

export function defaultConfig() {
  return { keys: { ...DEFAULT_KEYS } };
}

function parseKeys(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const keys = { ...DEFAULT_KEYS };
  keys.enabled = Boolean(src.enabled);
  for (const name of ['speak', 'stop', 'dictate', 'voice']) {
    if (typeof src[name] === 'string') keys[name] = src[name].trim();
  }
  return keys;
}

function envKeysOverride(enabled) {
  const raw = (process.env.DOTTIE_TALK_KEYS || '').trim().toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'on') return true;
  if (raw === '0' || raw === 'false' || raw === 'off') return false;
  return enabled;
}

export function loadConfig() {
  const file = configPath();
  let parsed = {};
  if (existsSync(file)) {
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8') || '{}');
    } catch {
      parsed = {};
    }
  }
  const keys = parseKeys(parsed.keys);
  keys.enabled = envKeysOverride(keys.enabled);
  return { keys };
}

export function saveConfig(cfg) {
  const file = configPath();
  mkdirSync(path.dirname(file), { recursive: true });
  const next = { keys: parseKeys(cfg && cfg.keys) };
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  return loadConfig();
}

export function setKeysEnabled(enabled) {
  const current = loadConfig();
  current.keys.enabled = Boolean(enabled);
  const file = configPath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ keys: current.keys }, null, 2)}\n`);
  return loadConfig();
}
