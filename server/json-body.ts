import type { NextFunction, Request, Response } from "express";
import express from "express";

/** Every JSON route except ambient transcription. Do not raise this. */
export const GLOBAL_JSON_BODY_LIMIT = "10mb";

/**
 * Base64 of an 8MB clip is about 11.2MB, plus the JSON envelope.
 * Only POST /api/gemini/transcribe may accept that. The route then 413s past 8MB decoded.
 */
export const TRANSCRIBE_JSON_BODY_LIMIT = "11.5mb";

export const MAX_TRANSCRIBE_AUDIO_BYTES = 8 * 1024 * 1024;

export function maxTranscribeBase64Chars(): number {
  return Math.ceil(MAX_TRANSCRIBE_AUDIO_BYTES / 3) * 4;
}

export function isAmbientTranscribePost(req: Request): boolean {
  if (req.method !== "POST") return false;
  const path = String(req.originalUrl || req.url || "").split("?")[0];
  return path === "/api/gemini/transcribe";
}

function rememberRawBody(req: Request, _res: Response, buf: Buffer): void {
  (req as Request & { rawBody?: Buffer }).rawBody = buf;
}

function jsonParser(limit: string) {
  return express.json({ limit, verify: rememberRawBody });
}

/** Global parser. Skips ambient transcription so that route can use its own limit. */
export function globalJsonParser() {
  const parser = jsonParser(GLOBAL_JSON_BODY_LIMIT);
  return (req: Request, res: Response, next: NextFunction) => {
    if (isAmbientTranscribePost(req)) return next();
    return parser(req, res, next);
  };
}

export function transcribeJsonParser() {
  return jsonParser(TRANSCRIBE_JSON_BODY_LIMIT);
}
