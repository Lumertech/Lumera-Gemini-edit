import React, { useEffect, useState } from "react";
import { Play } from "lucide-react";

/** Desktop and tablet. Served from Vite `public/media` → Cloud Run `dist/media`. */
export const PROSPECT_LANDSCAPE_SRC = "/media/lumera-prospect-16x9.mp4";
/** Phones. Same pipeline as the landscape cut. */
export const PROSPECT_PORTRAIT_SRC = "/media/lumera-prospect-9x16.mp4";
export const PROSPECT_POSTER_SRC = "/media/lumera-poster-16x9.jpg";

/** Widths 360–414 match. Tailwind `sm` (640px) and up stay on the 16:9 cut. */
export const PROSPECT_PHONE_MEDIA_QUERY = "(max-width: 639px)";

export const PROSPECT_ADVERT_HEADING = "See Lumera in 60 seconds";

/** Accessible name for the player. No captions file was provided. */
export const PROSPECT_VIDEO_LABEL =
  "See Lumera in 60 seconds. A 56-second prospect advert for Lumera.";

export function prospectAdvertSrc(portrait: boolean): string {
  return portrait ? PROSPECT_PORTRAIT_SRC : PROSPECT_LANDSCAPE_SRC;
}

type MatchMediaFn = (query: string) => { matches: boolean };

/** Portrait only when the phone query matches. Missing matchMedia stays on 16:9. */
export function readProspectPortraitPreference(matchMediaImpl: MatchMediaFn | undefined): boolean {
  if (!matchMediaImpl) return false;
  return matchMediaImpl(PROSPECT_PHONE_MEDIA_QUERY).matches;
}

function browserMatchMedia(): MatchMediaFn | undefined {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
  return (query: string) => window.matchMedia(query);
}

/**
 * One native player. The active cut is the only `src`, so a phone does not
 * request the landscape file and other routes never mount this tree.
 * No autoplay: a muted autoplay would still pull the whole ~12 MB file.
 */
export const ProspectAdvert: React.FC = () => {
  const [portrait, setPortrait] = useState(() => readProspectPortraitPreference(browserMatchMedia()));

  useEffect(() => {
    const matchMediaImpl = browserMatchMedia();
    if (!matchMediaImpl || typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia(PROSPECT_PHONE_MEDIA_QUERY);
    const apply = () => setPortrait(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  const src = prospectAdvertSrc(portrait);

  return (
    <section
      id="prospect-advert"
      data-testid="landing-prospect-video"
      aria-labelledby="prospect-advert-heading"
      className="mt-10 w-full min-w-0 max-w-4xl mx-auto overflow-x-hidden"
    >
      <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-indigo-500/20 border border-indigo-400/30 text-xs font-semibold text-indigo-200 mb-3">
        <Play className="w-3.5 h-3.5" aria-hidden="true" />
        <span>56-second prospect advert</span>
      </div>
      <h2
        id="prospect-advert-heading"
        className="font-manrope text-2xl sm:text-3xl font-extrabold text-white"
      >
        {PROSPECT_ADVERT_HEADING}
      </h2>
      <p className="mt-2 text-sm text-slate-400">Press play to watch. Sound stays off until you start it.</p>
      <div className="mt-5 flex w-full min-w-0 max-w-full justify-center overflow-hidden rounded-2xl border border-white/10 bg-black shadow-xl shadow-indigo-950/40">
        <video
          key={src}
          data-testid="landing-prospect-player"
          data-prospect-cut={portrait ? "portrait" : "landscape"}
          className={
            portrait
              ? "mx-auto block h-auto w-auto min-w-0 max-h-[78dvh] max-w-full bg-black object-contain"
              : "block h-auto w-full min-w-0 max-w-full bg-black object-contain"
          }
          style={{ aspectRatio: portrait ? "9 / 16" : "16 / 9" }}
          controls
          playsInline
          preload="metadata"
          poster={PROSPECT_POSTER_SRC}
          title={PROSPECT_VIDEO_LABEL}
          aria-label={PROSPECT_VIDEO_LABEL}
          src={src}
        />
      </div>
    </section>
  );
};
