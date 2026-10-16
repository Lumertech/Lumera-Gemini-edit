declare module "recharts/es6/component/Tooltip.js" {
  export const defaultTooltipProps: {
    formatter?: (
      value: unknown,
      name?: unknown,
      item?: { unit?: unknown; dataKey?: unknown; name?: unknown },
      index?: number,
      payload?: unknown
    ) => string | number;
  };
}
