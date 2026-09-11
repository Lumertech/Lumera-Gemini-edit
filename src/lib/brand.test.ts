import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  LEGAL_ENTITY_NAME,
  PRODUCT_DESCRIPTION,
  PRODUCT_DOCUMENT_TITLE,
  PRODUCT_LOGO_SRC,
  PRODUCT_NAME,
  PRODUCT_TAGLINE,
} from "../brand.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const landing = read("src/components/LandingPage.tsx");
const login = read("src/pages/LoginPage.tsx");
const policy = read("src/pages/PolicyPage.tsx");
const app = read("src/App.tsx");
const brandMark = read("src/components/BrandMark.tsx");
const indexHtml = read("index.html");
const logoSvg = read("public/lumera-logo.svg");

describe("product brand SSOT (founder P0)", () => {
  it("locks the display name to Lumera and the legal entity to Lumera Solutions LLP", () => {
    assert.equal(PRODUCT_NAME, "Lumera");
    assert.equal(LEGAL_ENTITY_NAME, "Lumera Solutions LLP");
    assert.equal(PRODUCT_LOGO_SRC, "/lumera-logo.svg");
    assert.equal(PRODUCT_DOCUMENT_TITLE, "Lumera — Enterprise Clinical & Practice Suite");
    assert.match(PRODUCT_DESCRIPTION, /^Lumera — /);
    assert.doesNotMatch(PRODUCT_NAME, /Health/);
    assert.doesNotMatch(PRODUCT_DOCUMENT_TITLE, /Lumera Health/);
    assert.doesNotMatch(PRODUCT_TAGLINE, /Health/);
  });

  it("uses one SVG mark for favicon, apple-touch, and the BrandMark component", () => {
    assert.match(indexHtml, /rel="icon"[^>]+href="\/lumera-logo\.svg"/);
    assert.match(indexHtml, /rel="apple-touch-icon"[^>]+href="\/lumera-logo\.svg"/);
    assert.match(brandMark, /PRODUCT_LOGO_SRC/);
    assert.match(brandMark, /data-testid="product-brand-mark"/);
    assert.match(brandMark, /data-brand-logo=\{PRODUCT_LOGO_SRC\}/);
    assert.match(brandMark, /data-brand-name=\{PRODUCT_NAME\}/);
    assert.match(logoSvg, /<svg/);
    assert.doesNotMatch(indexHtml, /Lumera Health/);
    assert.match(indexHtml, /<title>Lumera — Enterprise Clinical & Practice Suite<\/title>/);
  });

  it("uses the restored Sparkles four-point star on a purple→indigo→blue tile (not the medical-cross mark)", () => {
    assert.match(logoSvg, /four-pointed star/);
    assert.match(logoSvg, /from-purple-500 via-indigo-600 to-blue-600/);
    assert.match(logoSvg, /#A855F7/i);
    assert.match(logoSvg, /#4F46E5/i);
    assert.match(logoSvg, /#2563EB/i);
    assert.match(
      logoSvg,
      /M11\.017 2\.814a1 1 0 0 1 1\.966 0l1\.051 5\.558/,
    );
    assert.doesNotMatch(logoSvg, /Vertical Beam|Horizontal Beam|Medical Cross/i);
    assert.doesNotMatch(logoSvg, /<rect[^>]+x="27"[^>]+y="14"[^>]+width="10"[^>]+height="36"/);
    assert.doesNotMatch(logoSvg, /<rect[^>]+x="14"[^>]+y="27"[^>]+width="36"[^>]+height="10"/);
    assert.doesNotMatch(logoSvg, /L35\.5 28\.5 L44 32/);
  });

  it("renders the same BrandMark on landing, sign-in/register, policy, and public boot splash", () => {
    for (const [label, src] of [
      ["landing", landing],
      ["login", login],
      ["policy", policy],
      ["app splash", app],
    ] as const) {
      assert.match(src, /<BrandMark/, `${label} must render BrandMark`);
      assert.doesNotMatch(src, /Lumera Health/, `${label} must not show Lumera Health`);
    }
    assert.match(login, /showTagline/);
    assert.doesNotMatch(landing, /Sparkles className="w-6 h-6 text-white"/);
    assert.doesNotMatch(landing, /s\.logoUrl \?/);
    assert.match(landing, /LEGAL_ENTITY_NAME/);
    assert.match(landing, /Welcome to \{PRODUCT_NAME\}/);
    assert.match(policy, /data-testid="policy-back"/);
    assert.match(policy, /to="\/"/);
    assert.doesNotMatch(policy, /explicitPublic:\s*true/);
  });

  it("keeps document title and metadata on the product name Lumera", () => {
    const main = read("src/main.tsx");
    const metadata = read("metadata.json");
    assert.match(main, /PRODUCT_DOCUMENT_TITLE/);
    assert.match(main, /document\.title = PRODUCT_DOCUMENT_TITLE/);
    assert.match(metadata, /"name": "Lumera — Enterprise Clinical & Practice Suite"/);
    assert.doesNotMatch(metadata, /Lumera Health/);
  });
});
