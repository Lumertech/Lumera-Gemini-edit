import { useEffect } from "react";
import { PRODUCT_DESCRIPTION, PRODUCT_DOCUMENT_TITLE, PRODUCT_NAME } from "../brand";
import type { Surface } from "../nav/surfaces";

const CANONICAL_ORIGIN = "https://www.mylumera.in";

export interface RouteSeoMetadata {
  title: string;
  description: string;
  canonicalUrl: string;
  robots: string;
}

const POLICY_TITLES: Record<string, string> = {
  "privacy-policy": `Privacy Policy · ${PRODUCT_NAME}`,
  "terms-of-service": `Terms of Service · ${PRODUCT_NAME}`,
  "data-deletion-instructions": `Data Deletion Instructions · ${PRODUCT_NAME}`,
  "government-data-request-policy": `Government Data Request Policy · ${PRODUCT_NAME}`,
  "refund-policy": `Refund Policy · ${PRODUCT_NAME}`,
  security: `Security & Privacy Statement · ${PRODUCT_NAME}`,
};

export function resolveRouteSeo(opts: {
  surface: Surface;
  pathname: string;
  search?: string;
  policySlug?: string;
}): RouteSeoMetadata {
  const cleanPath = (opts.pathname.split("?")[0] || "/").replace(/\/+$/, "").toLowerCase() || "/";
  const search = String(opts.search || "");
  const hasAuthRedirectParam = /(?:^|[?&])next=/.test(search);

  if (
    opts.surface === "app" ||
    opts.surface === "admin" ||
    opts.surface === "portal" ||
    opts.surface === "onboarding" ||
    cleanPath.startsWith("/app") ||
    cleanPath.startsWith("/admin") ||
    cleanPath.startsWith("/portal") ||
    cleanPath.startsWith("/w/") ||
    cleanPath === "/w"
  ) {
    return {
      title: PRODUCT_DOCUMENT_TITLE,
      description: PRODUCT_DESCRIPTION,
      canonicalUrl: `${CANONICAL_ORIGIN}/`,
      robots: "noindex, nofollow",
    };
  }

  if (opts.surface === "pricing" || cleanPath === "/pricing") {
    return {
      title: `Pricing · ${PRODUCT_NAME}`,
      description:
        "Transparent INR pricing for individual doctors and multi-doctor polyclinics in India. Start a 30-day free trial with no card required.",
      canonicalUrl: `${CANONICAL_ORIGIN}/pricing`,
      robots: "index, follow",
    };
  }

  if (opts.surface === "login") {
    const isSignup = cleanPath === "/signup" || cleanPath === "/register";
    return {
      title: isSignup ? `Start 30-Day Free Trial · ${PRODUCT_NAME}` : `Sign In · ${PRODUCT_NAME}`,
      description: isSignup
        ? "Create your clinic workspace on Lumera. Start a 30-day free trial with ambient clinical scribing, Smart Rx Studio, OPD token queue, and WhatsApp patient communication."
        : "Sign in to your Lumera clinic workspace to access OPD queue, Smart Rx Studio, ambient clinical scribe, appointments, and billing.",
      canonicalUrl: `${CANONICAL_ORIGIN}${isSignup ? "/signup" : "/login"}`,
      robots: hasAuthRedirectParam ? "noindex, nofollow" : "index, follow",
    };
  }

  if (opts.surface === "legal" || opts.surface === "policy") {
    const slug = opts.policySlug || cleanPath.replace(/^\//, "") || "privacy-policy";
    const canonicalSlug =
      slug === "privacy"
        ? "privacy-policy"
        : slug === "terms"
          ? "terms-of-service"
          : slug === "data-deletion"
            ? "data-deletion-instructions"
            : slug === "government" || slug === "government-requests"
              ? "government-data-request-policy"
              : slug;
    return {
      title: POLICY_TITLES[canonicalSlug] || `Legal & Privacy · ${PRODUCT_NAME}`,
      description: `${PRODUCT_NAME} legal, privacy, data protection, and WhatsApp Business Platform policy documentation.`,
      canonicalUrl: `${CANONICAL_ORIGIN}/${canonicalSlug}`,
      robots: "index, follow",
    };
  }

  return {
    title: PRODUCT_DOCUMENT_TITLE,
    description: PRODUCT_DESCRIPTION,
    canonicalUrl: `${CANONICAL_ORIGIN}/`,
    robots: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1",
  };
}

function upsertMetaByName(name: string, content: string): void {
  if (typeof document === "undefined") return;
  let el = document.head.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertMetaByProperty(property: string, content: string): void {
  if (typeof document === "undefined") return;
  let el = document.head.querySelector(`meta[property="${property}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("property", property);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertCanonicalLink(href: string): void {
  if (typeof document === "undefined") return;
  let link = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", "canonical");
    document.head.appendChild(link);
  }
  link.setAttribute("href", href);
}

export function useDocumentSeo(opts: {
  surface: Surface;
  pathname: string;
  search?: string;
  policySlug?: string;
}): void {
  useEffect(() => {
    const seo = resolveRouteSeo(opts);
    document.title = seo.title;
    upsertMetaByName("description", seo.description);
    upsertMetaByName("robots", seo.robots);
    upsertCanonicalLink(seo.canonicalUrl);
    upsertMetaByProperty("og:title", seo.title);
    upsertMetaByProperty("og:description", seo.description);
    upsertMetaByProperty("og:url", seo.canonicalUrl);
  }, [opts.surface, opts.pathname, opts.search, opts.policySlug]);
}

