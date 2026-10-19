import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, it } from "node:test";
import { AuthProvider } from "../../auth/AuthContext.tsx";
import { NavigationProvider } from "../../nav/NavigationContext.tsx";
import { AdminMetaTechProvider } from "./AdminMetaTechProvider.tsx";

describe("AdminMetaTechProvider App Review status", () => {
  it("renders APPROVED in green with a check icon", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(
          AuthProvider,
          null,
          React.createElement(NavigationProvider, null, React.createElement(AdminMetaTechProvider))
        )
      )
    );
    const start = html.indexOf("App Review status");
    const end = html.indexOf("Connected Clinic WABAs");
    assert.ok(start >= 0 && end > start, "App Review status tile missing from the status grid");
    const tile = html.slice(start, end);
    assert.match(tile, /APPROVED/);
    assert.match(tile, /text-emerald-300/);
    assert.match(tile, /lucide-circle-check/);
    assert.match(tile, /m9 12 2 2 4-4/);
    assert.equal(/text-amber-300/.test(tile), false);
    assert.equal(/lucide-circle-alert/.test(tile), false);
  });
});
