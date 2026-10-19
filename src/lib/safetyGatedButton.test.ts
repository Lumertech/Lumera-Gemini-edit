import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import { SafetyGatedButton } from "../components/SafetyGatedButton.tsx";

describe("safety-gated WhatsApp actions", () => {
  it("renders the send control disabled while the safety gate is closed", () => {
    const closed = renderToStaticMarkup(
      createElement(SafetyGatedButton, { blocked: true, onClick: () => undefined }, "Send WhatsApp")
    );
    assert.match(closed, /disabled=""/);
    assert.match(closed, /data-safety-gated="closed"/);
    assert.match(closed, /Send WhatsApp/);

    const direct = renderToStaticMarkup(
      createElement(
        SafetyGatedButton,
        { blocked: true, disabled: false, onClick: () => undefined },
        "1-Click Send via WhatsApp"
      )
    );
    assert.match(direct, /disabled=""/);
    assert.match(direct, /1-Click Send via WhatsApp/);

    const open = renderToStaticMarkup(
      createElement(SafetyGatedButton, { blocked: false, onClick: () => undefined }, "Send WhatsApp")
    );
    assert.equal(open.includes("disabled"), false);
    assert.match(open, /data-safety-gated="open"/);
  });
});
