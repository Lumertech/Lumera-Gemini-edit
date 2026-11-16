import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { AuthProvider } from "../auth/AuthContext.tsx";
import { LandingPage } from "../components/LandingPage.tsx";
import {
  PROSPECT_ADVERT_HEADING,
  PROSPECT_LANDSCAPE_SRC,
  PROSPECT_PORTRAIT_SRC,
  PROSPECT_POSTER_SRC,
  PROSPECT_VIDEO_LABEL,
  prospectAdvertSrc,
  readProspectPortraitPreference,
} from "../components/ProspectAdvert.tsx";
import { NavigationProvider } from "../nav/NavigationContext.tsx";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function renderLanding(): string {
  return renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      { initialEntries: ["/"] },
      React.createElement(
        AuthProvider,
        null,
        React.createElement(NavigationProvider, null, React.createElement(LandingPage))
      )
    )
  );
}

function videoTag(html: string): string {
  const start = html.indexOf("<video");
  assert.ok(start >= 0, "landing video element missing");
  const end = html.indexOf("</video>", start);
  assert.ok(end > start, "landing video element not closed");
  return html.slice(start, end);
}

/** Opening tag of the box that reserves the cut. The video must not size this box. */
function frameTag(html: string): string {
  const start = html.indexOf('data-testid="landing-prospect-frame"');
  assert.ok(start >= 0, "prospect frame missing");
  const videoAt = html.indexOf("<video", start);
  assert.ok(videoAt > start, "frame does not wrap the video");
  return html.slice(start, videoAt);
}

function topLevelAtoms(filePath: string): { type: string; offset: number }[] {
  const data = fs.readFileSync(filePath);
  const atoms: { type: string; offset: number }[] = [];
  let i = 0;
  while (i + 8 <= data.length) {
    let size = data.readUInt32BE(i);
    const type = data.toString("latin1", i + 4, i + 8);
    if (size === 1) {
      size = Number(data.readBigUInt64BE(i + 8));
    }
    if (size < 8) break;
    atoms.push({ type, offset: i });
    i += size;
  }
  return atoms;
}

describe("landing prospect advert", () => {
  it("renders the video section on the landing page", () => {
    const prev = globalThis.window;
    // Node has no window. The first paint must be the desktop cut, with one src.
    delete (globalThis as { window?: unknown }).window;
    try {
      const html = renderLanding();
      const sectionStart = html.indexOf('data-testid="landing-prospect-video"');
      assert.ok(sectionStart >= 0, "landing video section missing");
      assert.ok(sectionStart < html.indexOf("animate-marquee"), "video section should sit above the language ticker");
      assert.match(html, new RegExp(PROSPECT_ADVERT_HEADING));
      assert.match(html, /56-second prospect advert/);
      assert.match(html, /aria-labelledby="prospect-advert-heading"/);
      const frame = frameTag(html);
      assert.match(frame, /aspect-ratio:16 \/ 9/);
      const video = videoTag(html);
      assert.match(video, new RegExp(`aria-label="${PROSPECT_VIDEO_LABEL.replace(/[.]/g, "\\.")}"`));
      assert.match(video, /controls=""/);
      assert.match(video, /playsinline=""/i);
      assert.match(video, /preload="metadata"/);
      assert.match(video, new RegExp(`poster="${PROSPECT_POSTER_SRC}"`));
      assert.match(video, new RegExp(`src="${PROSPECT_LANDSCAPE_SRC}"`));
      assert.match(video, /data-prospect-cut="landscape"/);
      assert.match(video, /absolute inset-0 h-full w-full/);
      assert.equal(/aspect-ratio/.test(video), false);
      assert.equal(video.includes(PROSPECT_PORTRAIT_SRC), false);
      assert.equal(/autoplay/i.test(video), false);
      assert.equal(/<track\b/i.test(html), false);
      assert.equal(prospectAdvertSrc(false), PROSPECT_LANDSCAPE_SRC);
      assert.equal(prospectAdvertSrc(true), PROSPECT_PORTRAIT_SRC);
      assert.equal(readProspectPortraitPreference(undefined), false);
      assert.equal(
        readProspectPortraitPreference(() => ({ matches: true })),
        true
      );
      assert.equal(
        readProspectPortraitPreference(() => ({ matches: false })),
        false
      );
    } finally {
      if (prev === undefined) delete (globalThis as { window?: unknown }).window;
      else (globalThis as { window?: unknown }).window = prev;
    }
  });

  it("selects the vertical cut for a phone-width viewport", () => {
    const prev = globalThis.window;
    (globalThis as { window?: unknown }).window = {
      matchMedia(query: string) {
        return {
          matches: query.includes("max-width"),
          media: query,
          addEventListener() {},
          removeEventListener() {},
        };
      },
    };
    try {
      const html = renderLanding();
      const frame = frameTag(html);
      assert.match(frame, /aspect-ratio:9 \/ 16/);
      assert.match(frame, /min\(100%, calc\(78dvh \* 9 \/ 16\)\)/);
      const video = videoTag(html);
      assert.match(video, new RegExp(`src="${PROSPECT_PORTRAIT_SRC}"`));
      assert.match(video, /data-prospect-cut="portrait"/);
      assert.match(video, /absolute inset-0 h-full w-full/);
      assert.match(video, /playsinline=""/i);
      assert.equal(/aspect-ratio/.test(video), false);
      assert.equal(video.includes(PROSPECT_LANDSCAPE_SRC), false);
      assert.equal(/autoplay/i.test(video), false);
    } finally {
      if (prev === undefined) delete (globalThis as { window?: unknown }).window;
      else (globalThis as { window?: unknown }).window = prev;
    }
  });

  it("does not reference either video from any page other than the landing advert", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "dist") continue;
          walk(full);
          continue;
        }
        if (!/\.(tsx|ts|html|css)$/.test(entry.name)) continue;
        const rel = path.relative(root, full).split(path.sep).join("/");
        if (rel === "src/components/ProspectAdvert.tsx") continue;
        if (rel === "src/pages/landing-prospect-video.test.ts") continue;
        const text = fs.readFileSync(full, "utf8");
        if (text.includes("lumera-prospect-") || text.includes("lumera-poster-16x9")) hits.push(rel);
      }
    };
    walk(path.join(root, "src"));
    const indexHtml = read("index.html");
    assert.equal(indexHtml.includes("lumera-prospect-"), false);
    assert.equal(indexHtml.includes("lumera-poster-16x9"), false);
    assert.deepEqual(hits, []);

    const landing = read("src/components/LandingPage.tsx");
    assert.match(landing, /<ProspectAdvert \/>/);
    const importers: string[] = [];
    const walkImports = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkImports(full);
          continue;
        }
        if (!entry.name.endsWith(".tsx") && !entry.name.endsWith(".ts")) continue;
        const rel = path.relative(root, full).split(path.sep).join("/");
        if (rel === "src/components/ProspectAdvert.tsx") continue;
        if (rel === "src/pages/landing-prospect-video.test.ts") continue;
        const text = fs.readFileSync(full, "utf8");
        if (text.includes("ProspectAdvert")) importers.push(rel);
      }
    };
    walkImports(path.join(root, "src"));
    assert.deepEqual(importers, ["src/components/LandingPage.tsx"]);
  });

  it("ships faststart H.264 advert files through public/ and the image build", () => {
    for (const rel of [
      "public/media/lumera-prospect-16x9.mp4",
      "public/media/lumera-prospect-9x16.mp4",
    ]) {
      const atoms = topLevelAtoms(path.join(root, rel));
      const moov = atoms.find((atom) => atom.type === "moov");
      const mdat = atoms.find((atom) => atom.type === "mdat");
      assert.ok(moov && mdat, `${rel} missing moov/mdat`);
      assert.ok(moov.offset < mdat.offset, `${rel} is not faststart`);
      assert.ok(fs.statSync(path.join(root, rel)).size > 1_000_000, rel);
    }
    assert.ok(fs.statSync(path.join(root, "public/media/lumera-poster-16x9.jpg")).size > 10_000);

    const docker = read("Dockerfile");
    const ignore = read(".dockerignore");
    assert.ok(docker.indexOf("COPY public ./public") < docker.indexOf("RUN npm run build"));
    assert.match(docker, /COPY --from=build \/app\/dist \.\/dist/);
    assert.equal(ignore.includes("public"), false);
    assert.equal(/\.mp4/.test(ignore), false);
    assert.match(read("cloudbuild.yaml"), /docker[\s\S]*build[\s\S]*-t/);
  });
});
