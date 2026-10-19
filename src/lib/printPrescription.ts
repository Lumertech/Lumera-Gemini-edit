/**
 * Paper Rx print isolation.
 * The signed-Rx modal is a fixed overlay, so window.print() was capturing that
 * dialog. Copy the letterhead into a body-level print root, hide chrome, then print.
 */

export const RX_PRINT_ROOT_ID = "rx-print-root";
export const RX_DOCUMENT_SELECTOR = "[data-rx-document]";

/** Join only the parts that have text. Empty phone, web, or email fields drop out. */
export function joinPresent(parts: Array<string | null | undefined>, separator = " · "): string {
  return parts.map((part) => String(part ?? "").trim()).filter(Boolean).join(separator);
}

/** Drop print sections the doctor left blank, including an unset risk level. */
export function omitEmptyPrintSections(root: ParentNode) {
  root.querySelectorAll("[data-rx-has-content='false']").forEach((node) => node.remove());
  root.querySelectorAll("[data-rx-section-group]").forEach((node) => {
    if (!(node.textContent || "").trim()) node.remove();
  });
}

const CHROME_SELECTOR = "[data-print-chrome], [data-rx-modal], [role='status']";

type ChromeSnapshot = {
  el: HTMLElement;
  hidden: boolean;
  ariaHidden: string | null;
};

const chromeSnapshots = new WeakMap<Document, ChromeSnapshot[]>();

function isHtmlElement(node: Node | null, doc: Document): node is HTMLElement {
  const Html = doc.defaultView?.HTMLElement;
  return Boolean(Html && node instanceof Html);
}

function fieldNodes(root: ParentNode): Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> {
  return [...root.querySelectorAll("input, textarea, select")] as Array<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >;
}

function copyControlValues(source: HTMLElement, clone: HTMLElement) {
  const from = fieldNodes(source);
  const to = fieldNodes(clone);
  from.forEach((el, index) => {
    const dest = to[index];
    if (!dest) return;
    dest.value = el.value;
  });
}

function freezeEditableFields(root: HTMLElement, doc: Document) {
  root.querySelectorAll("textarea").forEach((el) => {
    const p = doc.createElement("p");
    p.textContent = el.value;
    el.replaceWith(p);
  });
  root.querySelectorAll("input").forEach((el) => {
    const input = el as HTMLInputElement;
    const type = (input.type || "text").toLowerCase();
    if (type === "hidden" || type === "checkbox" || type === "radio" || type === "button" || type === "submit") {
      input.remove();
      return;
    }
    const span = doc.createElement("span");
    span.textContent = input.value;
    input.replaceWith(span);
  });
  root.querySelectorAll("select").forEach((el) => {
    const select = el as HTMLSelectElement;
    const span = doc.createElement("span");
    const chosen = select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null;
    span.textContent = chosen?.textContent || select.value;
    select.replaceWith(span);
  });
}

function printableClone(source: HTMLElement, doc: Document): HTMLElement {
  const clone = source.cloneNode(true) as HTMLElement;
  copyControlValues(source, clone);
  clone.querySelectorAll(".no-print").forEach((node) => node.remove());
  freezeEditableFields(clone, doc);
  clone.querySelectorAll("button, [data-print-chrome], [data-rx-modal]").forEach((node) => node.remove());
  omitEmptyPrintSections(clone);
  return clone;
}

function hideChrome(doc: Document) {
  if (chromeSnapshots.has(doc)) return;
  const snapshot: ChromeSnapshot[] = [];
  doc.querySelectorAll(CHROME_SELECTOR).forEach((node) => {
    if (!isHtmlElement(node, doc)) return;
    if (node.closest(`#${RX_PRINT_ROOT_ID}`)) return;
    snapshot.push({
      el: node,
      hidden: node.hidden,
      ariaHidden: node.getAttribute("aria-hidden"),
    });
    node.hidden = true;
    node.setAttribute("aria-hidden", "true");
  });
  chromeSnapshots.set(doc, snapshot);
}

function restoreChrome(doc: Document) {
  const snapshot = chromeSnapshots.get(doc);
  if (!snapshot) return;
  for (const row of snapshot) {
    row.el.hidden = row.hidden;
    if (row.ariaHidden == null) row.el.removeAttribute("aria-hidden");
    else row.el.setAttribute("aria-hidden", row.ariaHidden);
  }
  chromeSnapshots.delete(doc);
}

export function finishPrescriptionPrint(doc: Document) {
  doc.getElementById(RX_PRINT_ROOT_ID)?.remove();
  doc.body.classList.remove("printing-rx");
  restoreChrome(doc);
}

/** Build the print root and hide the modal, nav chrome, and toasts. Does not call print. */
export function preparePrescriptionPrint(doc: Document): boolean {
  if (doc.body.classList.contains("printing-rx") && doc.getElementById(RX_PRINT_ROOT_ID)) return true;
  const source = doc.querySelector(RX_DOCUMENT_SELECTOR);
  if (!isHtmlElement(source, doc)) return false;

  const clone = printableClone(source, doc);
  hideChrome(doc);
  doc.getElementById(RX_PRINT_ROOT_ID)?.remove();

  const root = doc.createElement("div");
  root.id = RX_PRINT_ROOT_ID;
  root.setAttribute("data-rx-print-root", "true");
  root.appendChild(clone);
  doc.body.appendChild(root);
  doc.body.classList.add("printing-rx");
  return true;
}

export function waitForPrintAssets(root: ParentNode, doc: Document): Promise<void> {
  const fonts = (doc as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
  const fontReady = fonts?.ready ? fonts.ready.catch(() => undefined) : Promise.resolve();
  const images = [...root.querySelectorAll("img")];
  const imageReady = Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          const done = () => resolve();
          img.addEventListener("load", done, { once: true });
          img.addEventListener("error", done, { once: true });
        })
    )
  );
  return Promise.all([fontReady, imageReady]).then(() => undefined);
}

export async function printPrescriptionDocument(doc: Document = document): Promise<boolean> {
  if (!preparePrescriptionPrint(doc)) return false;
  const root = doc.getElementById(RX_PRINT_ROOT_ID);
  if (root) await waitForPrintAssets(root, doc);
  const win = doc.defaultView;
  try {
    win?.print();
  } catch (err) {
    finishPrescriptionPrint(doc);
    throw err;
  }
  return true;
}

/** Browser print (Ctrl/Cmd+P) uses the same root while the Rx writer is mounted. */
export function installPrescriptionPrintHooks(doc: Document): () => void {
  const win = doc.defaultView;
  if (!win) return () => {};
  const onBefore = () => {
    preparePrescriptionPrint(doc);
  };
  const onAfter = () => {
    finishPrescriptionPrint(doc);
  };
  win.addEventListener("beforeprint", onBefore);
  win.addEventListener("afterprint", onAfter);
  return () => {
    win.removeEventListener("beforeprint", onBefore);
    win.removeEventListener("afterprint", onAfter);
    finishPrescriptionPrint(doc);
  };
}
