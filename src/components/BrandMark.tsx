import React from "react";
import {
  PRODUCT_LOGO_ALT,
  PRODUCT_LOGO_SRC,
  PRODUCT_NAME,
  PRODUCT_TAGLINE,
} from "../brand";

const MARK_SIZE = {
  sm: "h-7 w-7",
  md: "h-10 w-10",
  lg: "h-12 w-12",
} as const;

export type BrandMarkSize = keyof typeof MARK_SIZE;

export interface BrandMarkProps {
  size?: BrandMarkSize;
  showWordmark?: boolean;
  showTagline?: boolean;
  layout?: "row" | "stack";
  className?: string;
  wordmarkClassName?: string;
  taglineClassName?: string;
}

/**
 * Canonical product mark: the same SVG used as the favicon, plus the display name "Lumera".
 * The asset is a white four-pointed Sparkles star on a purple→indigo→blue rounded tile.
 * Do not wrap this in a second gradient tile — the asset already is the tile.
 */
export const BrandMark: React.FC<BrandMarkProps> = ({
  size = "md",
  showWordmark = true,
  showTagline = false,
  layout = "row",
  className = "",
  wordmarkClassName = "font-extrabold text-lg tracking-tight text-white",
  taglineClassName = "text-[10px] uppercase font-bold tracking-wider text-purple-400 block -mt-0.5 leading-tight",
}) => {
  const stacked = layout === "stack";
  return (
    <span
      data-testid="product-brand-mark"
      data-brand-logo={PRODUCT_LOGO_SRC}
      data-brand-name={PRODUCT_NAME}
      className={`inline-flex min-w-0 ${stacked ? "flex-col items-center text-center gap-2" : "items-center gap-2.5 sm:gap-3"} ${className}`}
    >
      <img
        src={PRODUCT_LOGO_SRC}
        alt={PRODUCT_LOGO_ALT}
        className={`${MARK_SIZE[size]} shrink-0 rounded-xl object-contain shadow-lg shadow-purple-500/30`}
      />
      {showWordmark && (
        <span className={stacked ? "" : "text-left min-w-0"}>
          <span className={`block ${wordmarkClassName}`}>{PRODUCT_NAME}</span>
          {showTagline && <span className={taglineClassName}>{PRODUCT_TAGLINE}</span>}
        </span>
      )}
    </span>
  );
};
