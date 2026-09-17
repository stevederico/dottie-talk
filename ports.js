/**
 * Local voice ports — package-owned (standalone).
 * Consumers that share a machine with Dottie.app should keep these numbers.
 */
export const PORTS = Object.freeze({
  TTS_PORT: 1314,
  STT_PORT: 1315,
  TALK_HTTP_PORT: 1320,
});
