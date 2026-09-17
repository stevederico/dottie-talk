#!/usr/bin/env node
/** Start koko on :1314 and keep process alive for talk-keys / other clients. */
import { ensureTtsRunning, stopBins } from './bin_supervise.js';

ensureTtsRunning()
  .then(() => {
    process.stderr.write('[dottie-talk] TTS ready on 127.0.0.1:1314\n');
    const shutdown = () => {
      stopBins();
      process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  })
  .catch((err) => {
    process.stderr.write(`[dottie-talk] TTS failed: ${err.message}\n`);
    process.exit(1);
  });
