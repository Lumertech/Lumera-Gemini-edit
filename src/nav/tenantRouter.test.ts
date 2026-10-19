import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, Link, RouterProvider, useLocation } from "react-router-dom";
import { parseWorkspaceScreen } from "./tenantRoutes.ts";

function ScreenProbe() {
  const { pathname } = useLocation();
  const parts = pathname.split("/").filter(Boolean);
  const parsed = parseWorkspaceScreen(parts[2] || "", parts[3] ? decodeURIComponent(parts[3]) : "");
  return React.createElement(
    "div",
    null,
    React.createElement(Link, { to: "/w/physiodoctor-practice/opd" }, "OPD"),
    React.createElement(
      "p",
      { "data-testid": "screen" },
      parsed.screen
    ),
    React.createElement("p", { "data-testid": "record" }, parsed.recordId),
    React.createElement("p", { "data-testid": "view" }, parsed.appView)
  );
}

function markup(router: ReturnType<typeof createMemoryRouter>): string {
  return renderToStaticMarkup(React.createElement(RouterProvider, { router }));
}

describe("workspace router deep links", () => {
  it("renders the patient record from a deep URL with no previous screen", () => {
    const router = createMemoryRouter([{ path: "*", Component: ScreenProbe }], {
      initialEntries: ["/w/physiodoctor-practice/patients/pat-123"],
    });
    const html = markup(router);
    assert.match(html, /patients/);
    assert.match(html, /pat-123/);
    assert.equal(router.state.location.pathname, "/w/physiodoctor-practice/patients/pat-123");
  });

  it("reloads invoice detail from /invoices/:id and restores it on back", async () => {
    const path = "/w/malhotra-individual-practice/invoices/inv-194b83";
    const router = createMemoryRouter([{ path: "*", Component: ScreenProbe }], {
      initialEntries: [path],
    });
    const first = markup(router);
    assert.match(first, /data-testid="screen">invoices/);
    assert.match(first, /data-testid="view">billing/);
    assert.match(first, /inv-194b83/);
    assert.equal(router.state.location.pathname, path);

    const reloaded = createMemoryRouter([{ path: "*", Component: ScreenProbe }], {
      initialEntries: [router.state.location.pathname],
    });
    const again = markup(reloaded);
    assert.match(again, /data-testid="screen">invoices/);
    assert.match(again, /data-testid="view">billing/);
    assert.match(again, /inv-194b83/);

    await reloaded.navigate("/w/malhotra-individual-practice/opd");
    assert.equal(reloaded.state.location.pathname, "/w/malhotra-individual-practice/opd");
    await reloaded.navigate(-1);
    assert.equal(reloaded.state.historyAction, "POP");
    assert.equal(reloaded.state.location.pathname, path);
    assert.match(markup(reloaded), /inv-194b83/);
    assert.match(markup(reloaded), /data-testid="view">billing/);
  });

  it("renders the visit from rx/:visitId on first load", () => {
    const router = createMemoryRouter([{ path: "*", Component: ScreenProbe }], {
      initialEntries: ["/w/physiodoctor-practice/rx/visit-42"],
    });
    const html = markup(router);
    assert.match(html, /data-testid="screen">rx</);
    assert.match(html, /visit-42/);
  });

  it("pushes a nav target and browser back restores the record", async () => {
    const router = createMemoryRouter([{ path: "*", Component: ScreenProbe }], {
      initialEntries: ["/w/physiodoctor-practice/patients/pat-123"],
    });
    assert.match(markup(router), /pat-123/);
    await router.navigate("/w/physiodoctor-practice/reception");
    assert.equal(router.state.historyAction, "PUSH");
    assert.equal(router.state.location.pathname, "/w/physiodoctor-practice/reception");
    assert.match(markup(router), /reception/);
    await router.navigate("/w/physiodoctor-practice/opd");
    await router.navigate(-1);
    assert.equal(router.state.historyAction, "POP");
    assert.equal(router.state.location.pathname, "/w/physiodoctor-practice/reception");
    await router.navigate(-1);
    assert.equal(router.state.location.pathname, "/w/physiodoctor-practice/patients/pat-123");
    assert.match(markup(router), /pat-123/);
  });
});
