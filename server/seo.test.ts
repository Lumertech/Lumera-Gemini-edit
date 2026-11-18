import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { startTestServer } from "./test-http.ts";
import {
  attachPublicSeoRoutes,
  CANONICAL_PUBLIC_ORIGIN,
  GOOGLE_SITE_VERIFICATION_FILE,
  GOOGLE_SITE_VERIFICATION_META_TOKEN,
  PUBLIC_SITEMAP_ENTRIES,
  renderRobotsTxt,
  renderSitemapXml,
} from "./seo.ts";
import { renderPolicyDocumentHtml } from "./policy-html.ts";
import { renderPricingDocumentHtml, renderRefundPolicyHtml } from "./pricing-html.ts";
import { resolveRouteSeo } from "../src/lib/seo.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("SEO & Google Search Console readiness", () => {
  it("serves robots.txt, sitemap.xml, manifest.webmanifest, and Google site verification file", async () => {
    const server = await startTestServer((app) => {
      attachPublicSeoRoutes(app);
    });
    try {
      const robotsRes = await fetch(`http://127.0.0.1:${server.port}/robots.txt`);
      assert.equal(robotsRes.status, 200);
      assert.match(robotsRes.headers.get("content-type") || "", /text\/plain/);
      const robots = await robotsRes.text();
      assert.match(robots, /User-agent: \*/);
      assert.match(robots, /Allow: \/pricing/);
      assert.match(robots, /Disallow: \/api\//);
      assert.match(robots, /Disallow: \/app/);
      assert.match(robots, /Disallow: \/admin/);
      assert.match(robots, /Sitemap: https:\/\/www\.mylumera\.in\/sitemap\.xml/);

      const sitemapRes = await fetch(`http://127.0.0.1:${server.port}/sitemap.xml`);
      assert.equal(sitemapRes.status, 200);
      assert.match(sitemapRes.headers.get("content-type") || "", /application\/xml/);
      const sitemap = await sitemapRes.text();
      assert.match(sitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
      for (const entry of PUBLIC_SITEMAP_ENTRIES) {
        const expectedLoc =
          entry.path === "/" ? `${CANONICAL_PUBLIC_ORIGIN}/` : `${CANONICAL_PUBLIC_ORIGIN}${entry.path}`;
        assert.ok(sitemap.includes(`<loc>${expectedLoc}</loc>`), `missing ${expectedLoc} in sitemap.xml`);
      }

      const verifyRes = await fetch(`http://127.0.0.1:${server.port}/${GOOGLE_SITE_VERIFICATION_FILE}`);
      assert.equal(verifyRes.status, 200);
      assert.equal(await verifyRes.text(), `google-site-verification: ${GOOGLE_SITE_VERIFICATION_FILE}`);

      const manifestRes = await fetch(`http://127.0.0.1:${server.port}/manifest.webmanifest`);
      assert.equal(manifestRes.status, 200);
      const manifest = (await manifestRes.json()) as { short_name: string; start_url: string };
      assert.equal(manifest.short_name, "Lumera");
      assert.equal(manifest.start_url, "/");
    } finally {
      await server.close();
    }
  });

  it("ships canonical URL, Google verification meta, OG image, JSON-LD, and crawlable noscript in index.html", () => {
    const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
    assert.match(indexHtml, /<link rel="canonical" href="https:\/\/www\.mylumera\.in\/"\s*\/>/);
    assert.ok(
      indexHtml.includes(`<meta name="google-site-verification" content="${GOOGLE_SITE_VERIFICATION_META_TOKEN}" />`),
      "missing google-site-verification meta tag"
    );
    assert.match(indexHtml, /<meta property="og:image" content="https:\/\/www\.mylumera\.in\/og-image\.png"\s*\/>/);
    assert.match(indexHtml, /<meta property="og:url" content="https:\/\/www\.mylumera\.in\/"\s*\/>/);
    assert.match(indexHtml, /<script type="application\/ld\+json">/);
    const ldJsonMatch = indexHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(ldJsonMatch, "JSON-LD script missing");
    const parsed = JSON.parse(ldJsonMatch[1]) as { "@graph": Array<{ "@type": string }> };
    const types = parsed["@graph"].map((item) => item["@type"]);
    assert.deepEqual(types, ["Organization", "WebSite", "SoftwareApplication"]);
    assert.match(indexHtml, /<noscript>[\s\S]*<h1>Lumera — Enterprise Clinical &amp; Practice Suite<\/h1>/);
    assert.ok(fs.existsSync(path.join(root, "public", "og-image.png")), "public/og-image.png must exist");
    assert.ok(fs.statSync(path.join(root, "public", "og-image.png")).size > 10000);
  });

  it("emits accurate route-specific canonical URLs on SSR policy and pricing documents", () => {
    const termsHtml = renderPolicyDocumentHtml("Terms of Service", "Body", "2026-11-16", {
      routePath: "/terms-of-service",
    });
    assert.match(termsHtml, /<link rel="canonical" href="https:\/\/www\.mylumera\.in\/terms-of-service">/);
    assert.match(termsHtml, /<meta property="og:url" content="https:\/\/www\.mylumera\.in\/terms-of-service">/);
    assert.match(termsHtml, /<meta name="robots" content="index, follow">/);

    const notFoundHtml = renderPolicyDocumentHtml("Not found", "Missing", undefined, {
      routePath: "/privacy-policy",
      noindex: true,
    });
    assert.match(notFoundHtml, /<meta name="robots" content="noindex, nofollow">/);

    const pricingHtml = renderPricingDocumentHtml();
    assert.match(pricingHtml, /<link rel="canonical" href="https:\/\/www\.mylumera\.in\/pricing">/);
    assert.match(pricingHtml, /<meta property="og:url" content="https:\/\/www\.mylumera\.in\/pricing">/);

    const refundHtml = renderRefundPolicyHtml();
    assert.match(refundHtml, /<link rel="canonical" href="https:\/\/www\.mylumera\.in\/refund-policy">/);
    assert.match(refundHtml, /<meta name="description" content="/);
  });

  it("marks protected app/admin/redirect routes as noindex and public routes as indexable", () => {
    assert.equal(resolveRouteSeo({ surface: "landing", pathname: "/" }).robots.startsWith("index, follow"), true);
    assert.equal(resolveRouteSeo({ surface: "pricing", pathname: "/pricing" }).canonicalUrl, "https://www.mylumera.in/pricing");
    assert.equal(resolveRouteSeo({ surface: "login", pathname: "/signup" }).canonicalUrl, "https://www.mylumera.in/signup");
    assert.equal(resolveRouteSeo({ surface: "login", pathname: "/login", search: "?next=%2Fapp" }).robots, "noindex, nofollow");
    assert.equal(resolveRouteSeo({ surface: "app", pathname: "/app/rx" }).robots, "noindex, nofollow");
    assert.equal(resolveRouteSeo({ surface: "admin", pathname: "/admin/users" }).robots, "noindex, nofollow");
    assert.match(renderRobotsTxt("https://www.mylumera.in"), /Sitemap: https:\/\/www\.mylumera\.in\/sitemap\.xml/);
    assert.match(renderSitemapXml("https://www.mylumera.in", "2026-11-16"), /<lastmod>2026-11-16<\/lastmod>/);
  });

  it("routes both landing Try for free CTAs directly to the Sign In page instead of /pricing", () => {
    const landing = fs.readFileSync(path.join(root, "src/components/LandingPage.tsx"), "utf8");
    const heroMatch = landing.match(/<Link[\s\S]{0,220}data-testid="landing-try-free"/);
    const bannerMatch = landing.match(/<Link[\s\S]{0,220}data-testid="landing-try-free-banner"/);
    assert.ok(heroMatch, "hero landing-try-free must be a router Link");
    assert.ok(bannerMatch, "banner landing-try-free-banner must be a router Link");
    assert.match(heroMatch[0], /surfaceToPath\("login",\s*\{\s*loginNext:\s*"app",\s*loginMode:\s*"signin"\s*\}\)/);
    assert.match(bannerMatch[0], /surfaceToPath\("login",\s*\{\s*loginNext:\s*"app",\s*loginMode:\s*"signin"\s*\}\)/);
  });
});

