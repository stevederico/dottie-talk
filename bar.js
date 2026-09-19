/**
 * Install the Omarchy bar widget. Icon stays hidden until HTTP writes state.
 */

import { execFile } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MARKER = '# dottie-talk';
const PLUGIN_ID = 'sd.dottie-talk';
const CLI = fileURLToPath(new URL('./cli.js', import.meta.url));
const SOURCE = fileURLToPath(new URL('./plugin/sd.dottie-talk', import.meta.url));

export function pluginSourceDir() {
  return SOURCE;
}

export function pluginDestDir() {
  return process.env.DOTTIE_TALK_PLUGIN_DIR
    || path.join(os.homedir(), '.config', 'omarchy', 'plugins', PLUGIN_ID);
}

export function talkBinPath() {
  return process.env.DOTTIE_TALK_BIN
    || path.join(os.homedir(), '.local', 'bin', 'dottie-talk');
}

export function shellConfigPath() {
  return process.env.DOTTIE_TALK_SHELL_JSON
    || path.join(os.homedir(), '.config', 'omarchy', 'shell.json');
}

export function talkBinScript() {
  return `#!/bin/sh\n${MARKER}\nexec ${shellQuote(process.execPath)} ${shellQuote(CLI)} "$@"\n`;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function barHasWidget(shell, id = PLUGIN_ID) {
  const layout = shell && shell.bar && shell.bar.layout ? shell.bar.layout : {};
  for (const section of ['left', 'center', 'right']) {
    const items = layout[section] || [];
    if (items.some((w) => w && w.id === id)) return true;
  }
  return false;
}

export function barPutArgs(shell) {
  if (barHasWidget(shell, 'sd.dottie-omarchy')) {
    return [PLUGIN_ID, '--before', 'sd.dottie-omarchy'];
  }
  if (barHasWidget(shell, 'omarchy.audio')) {
    return [PLUGIN_ID, '--after', 'omarchy.audio'];
  }
  return [PLUGIN_ID, '--section', 'right'];
}

function omarchyEnv() {
  const extra = '/usr/share/omarchy/bin';
  return { ...process.env, PATH: `${extra}:${process.env.PATH || '/usr/bin'}` };
}

function loadShell() {
  const file = shellConfigPath();
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8') || '{}');
  } catch {
    return {};
  }
}

export function writeTalkBin() {
  const dest = talkBinPath();
  mkdirSync(path.dirname(dest), { recursive: true });
  if (existsSync(dest)) {
    try {
      const body = readFileSync(dest, 'utf8');
      if (!body.includes(MARKER)) return dest;
    } catch { /* replace ours */ }
  }
  writeFileSync(dest, talkBinScript());
  chmodSync(dest, 0o755);
  return dest;
}

export function linkPlugin() {
  const dest = pluginDestDir();
  const src = path.resolve(pluginSourceDir());
  mkdirSync(path.dirname(dest), { recursive: true });
  try {
    const st = lstatSync(dest);
    if (st.isSymbolicLink()) {
      const cur = path.resolve(path.dirname(dest), readlinkSync(dest));
      if (cur === src) return dest;
      unlinkSync(dest);
    } else {
      return dest;
    }
  } catch { /* missing */ }
  symlinkSync(src, dest);
  return dest;
}

export async function installBar({ execFileFn = execFileAsync } = {}) {
  const bin = writeTalkBin();
  const plugin = linkPlugin();
  const shell = loadShell();
  let onBar = barHasWidget(shell);
  if (!onBar) {
    try {
      await execFileFn('omarchy-bar', ['put', ...barPutArgs(shell)], {
        timeout: 8000,
        encoding: 'utf8',
        env: omarchyEnv(),
      });
      onBar = true;
    } catch { /* no omarchy on this host */ }
  }
  try {
    await execFileFn('omarchy-shell', ['shell', 'rescanPlugins'], {
      timeout: 4000,
      encoding: 'utf8',
      env: omarchyEnv(),
    });
  } catch { /* ok */ }
  return { bin, plugin, onBar, id: PLUGIN_ID };
}

export async function uninstallBar({ execFileFn = execFileAsync } = {}) {
  try {
    await execFileFn('omarchy-plugin-disable', [PLUGIN_ID], {
      timeout: 8000,
      encoding: 'utf8',
      env: omarchyEnv(),
    });
  } catch { /* ok */ }
  return { id: PLUGIN_ID, onBar: false };
}
