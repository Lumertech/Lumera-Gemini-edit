import { Router, type Request, type Response } from "express";
import multer from "multer";
import { requireAuth } from "./auth.ts";
import { mapInvoice } from "./db.ts";
import { denyUnlessPrescriber, PATIENT_RECORD_ROLES } from "./patient-access.ts";
import { reportCaughtError } from "./error-tracker.ts";
import {
  createExpense,
  createItem,
  createRefund,
  createVendor,
  dayCloseReport,
  deleteDayClose,
  deleteExpense,
  deleteItem,
  deletePriceLock,
  deleteRefund,
  deleteVendor,
  expenseReceipt,
  giveVaccine,
  listExpenses,
  listVaccines,
  monthExport,
  recordClinicUpi,
  saveAccountsSettings,
  saveDayClose,
  stockIn,
  stockSnapshot,
  upsertPriceLock,
  useConsumable,
  accountsError,
} from "./accounts.ts";

/** Settings, price locks, and deletes. */
export const ACCOUNTS_ADMIN_ROLES = ["CLINIC_ADMIN", "polyclinic_admin"] as const;
/**
 * Day close, stock-in, expenses, clinic UPI, and refunds.
 * The doctor is included so a solo clinic can close the day on the same desk.
 */
export const ACCOUNTS_DESK_ROLES = ["receptionist", "doctor", "CLINIC_ADMIN", "polyclinic_admin"] as const;
const READ_ROLES = PATIENT_RECORD_ROLES;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

function gate(req: Request, res: Response, roles: readonly string[]): string | null {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  if (!roles.includes(req.user.role)) {
    res.status(403).json({ error: "Insufficient permissions", code: "ROLE_DENIED" });
    return null;
  }
  const tenantId = String(req.user.tenantId || "").trim();
  if (!tenantId) {
    res.status(400).json({ error: "No tenant associated with this account." });
    return null;
  }
  return tenantId;
}

function actorOf(req: Request): { id: string; name: string } {
  return { id: req.user?.id || "", name: req.user?.name || "" };
}

function sendErr(res: Response, err: unknown, where: string) {
  const status = typeof err === "object" && err && "status" in err ? Number((err as { status: number }).status) : 500;
  const message = err instanceof Error ? err.message : "Request failed";
  if (!status || status >= 500) reportCaughtError(err, where);
  res.status(status || 500).json({ error: message });
}

export function createAccountsRouter(): Router {
  const api = Router();

  api.get("/accounts/settings", requireAuth, (req, res) => {
    const tenantId = gate(req, res, READ_ROLES);
    if (!tenantId) return;
    try {
      res.json(stockSnapshot(tenantId).settings);
    } catch (err) {
      sendErr(res, err, "accounts.settings");
    }
  });

  api.patch("/accounts/settings", requireAuth, (req, res) => {
    const tenantId = gate(req, res, ACCOUNTS_ADMIN_ROLES);
    if (!tenantId) return;
    try {
      res.json(saveAccountsSettings(tenantId, Number(req.body?.nearExpiryDays ?? req.body?.near_expiry_days)));
    } catch (err) {
      sendErr(res, err, "accounts.settings.save");
    }
  });

  api.get("/accounts/vendors", requireAuth, (req, res) => {
    const tenantId = gate(req, res, READ_ROLES);
    if (!tenantId) return;
    res.json({ vendors: stockSnapshot(tenantId).vendors });
  });

  api.post("/accounts/vendors", requireAuth, (req, res) => {
    const tenantId = gate(req, res, ACCOUNTS_ADMIN_ROLES);
    if (!tenantId) return;
    try {
      res.status(201).json({ vendor: createVendor(tenantId, req.body || {}) });
    } catch (err) {
      sendErr(res, err, "accounts.vendor");
    }
  });

  api.delete("/accounts/vendors/:id", requireAuth, (req, res) => {
    const tenantId = gate(req, res, ACCOUNTS_ADMIN_ROLES);
    if (!tenantId) return;
    try {
      deleteVendor(tenantId, req.params.id);
      res.json({ ok: true });
    } catch (err) {
      sendErr(res, err, "accounts.vendor.delete");
    }
  });

  api.get("/accounts/items", requireAuth, (req, res) => {
    const tenantId = gate(req, res, READ_ROLES);
    if (!tenantId) return;
    res.json({ items: stockSnapshot(tenantId).items });
  });

  api.post("/accounts/items", requireAuth, (req, res) => {
    const tenantId = gate(req, res, ACCOUNTS_ADMIN_ROLES);
    if (!tenantId) return;
    try {
      res.status(201).json({ item: createItem(tenantId, req.body || {}) });
    } catch (err) {
      sendErr(res, err, "accounts.item");
    }
  });

  api.delete("/accounts/items/:id", requireAuth, (req, res) => {
    const tenantId = gate(req, res, ACCOUNTS_ADMIN_ROLES);
    if (!tenantId) return;
    try {
      deleteItem(tenantId, req.params.id);
      res.json({ ok: true });
    } catch (err) {
      sendErr(res, err, "accounts.item.delete");
    }
  });

  api.get("/accounts/price-locks", requireAuth, (req, res) => {
    const tenantId = gate(req, res, READ_ROLES);
    if (!tenantId) return;
    res.json({ locks: stockSnapshot(tenantId).locks });
  });

  api.post("/accounts/price-locks", requireAuth, (req, res) => {
    const tenantId = gate(req, res, ACCOUNTS_ADMIN_ROLES);
    if (!tenantId) return;
    try {
      res.status(201).json({ lock: upsertPriceLock(tenantId, req.body || {}) });
    } catch (err) {
      sendErr(res, err, "accounts.lock");
    }
  });

  api.delete("/accounts/price-locks/:id", requireAuth, (req, res) => {
    const tenantId = gate(req, res, ACCOUNTS_ADMIN_ROLES);
    if (!tenantId) return;
    try {
      deletePriceLock(tenantId, req.params.id);
      res.json({ ok: true });
    } catch (err) {
      sendErr(res, err, "accounts.lock.delete");
    }
  });

  api.get("/accounts/stock", requireAuth, (req, res) => {
    const tenantId = gate(req, res, READ_ROLES);
    if (!tenantId) return;
    try {
      res.json(stockSnapshot(tenantId));
    } catch (err) {
      sendErr(res, err, "accounts.stock");
    }
  });

  api.post("/accounts/stock-in", requireAuth, (req, res) => {
    const tenantId = gate(req, res, ACCOUNTS_DESK_ROLES);
    if (!tenantId) return;
    try {
      res.status(201).json(stockIn(tenantId, req.body || {}, actorOf(req)));
    } catch (err) {
      sendErr(res, err, "accounts.stockIn");
    }
  });

  api.post("/accounts/use", requireAuth, (req, res) => {
    if (!denyUnlessPrescriber(req, res)) return;
    const tenantId = gate(req, res, READ_ROLES);
    if (!tenantId) return;
    try {
      res.status(201).json(useConsumable(tenantId, req.body || {}, actorOf(req)));
    } catch (err) {
      sendErr(res, err, "accounts.use");
    }
  });

  api.post("/accounts/vaccines", requireAuth, (req, res) => {
    if (!denyUnlessPrescriber(req, res)) return;
    const tenantId = gate(req, res, READ_ROLES);
    if (!tenantId) return;
    try {
      res.status(201).json({ administration: giveVaccine(tenantId, req.body || {}, actorOf(req)) });
    } catch (err) {
      sendErr(res, err, "accounts.vaccine");
    }
  });

  api.get("/accounts/vaccines", requireAuth, (req, res) => {
    const tenantId = gate(req, res, READ_ROLES);
    if (!tenantId) return;
    try {
      res.json({ administrations: listVaccines(tenantId, String(req.query.patientId || "").trim()) });
    } catch (err) {
      sendErr(res, err, "accounts.vaccines");
    }
  });

  api.get("/accounts/expenses", requireAuth, (req, res) => {
    const tenantId = gate(req, res, READ_ROLES);
    if (!tenantId) return;
    const month = String(req.query.month || "").trim();
    res.json({ expenses: listExpenses(tenantId, month || undefined) });
  });

  api.post("/accounts/expenses", requireAuth, (req, res) => {
    const tenantId = gate(req, res, ACCOUNTS_DESK_ROLES);
    if (!tenantId) return;
    const contentType = String(req.headers["content-type"] || "");
    const finish = async (file?: Express.Multer.File) => {
      try {
        const expense = await createExpense(tenantId, req.body || {}, actorOf(req), file ? {
          originalname: file.originalname,
          mimetype: file.mimetype,
          buffer: file.buffer,
        } : null);
        res.status(201).json({ expense });
      } catch (err) {
        sendErr(res, err, "accounts.expense");
      }
    };
    if (contentType.includes("multipart/form-data")) {
      upload.single("receipt")(req, res, (err) => {
        if (err) {
          sendErr(res, accountsError(400, err instanceof Error ? err.message : "Upload failed"), "accounts.expense.upload");
          return;
        }
        void finish(req.file);
      });
      return;
    }
    void finish();
  });

  api.get("/accounts/expenses/:id/receipt", requireAuth, async (req, res) => {
    const tenantId = gate(req, res, READ_ROLES);
    if (!tenantId) return;
    try {
      const receipt = await expenseReceipt(tenantId, req.params.id);
      res.setHeader("Content-Type", receipt.mime);
      res.setHeader("Content-Disposition", `attachment; filename="${receipt.filename.replace(/"/g, "")}"`);
      res.send(receipt.bytes);
    } catch (err) {
      sendErr(res, err, "accounts.receipt");
    }
  });

  api.delete("/accounts/expenses/:id", requireAuth, async (req, res) => {
    const tenantId = gate(req, res, ACCOUNTS_ADMIN_ROLES);
    if (!tenantId) return;
    try {
      await deleteExpense(tenantId, req.params.id);
      res.json({ ok: true });
    } catch (err) {
      sendErr(res, err, "accounts.expense.delete");
    }
  });

  api.get("/accounts/day-close", requireAuth, (req, res) => {
    const tenantId = gate(req, res, READ_ROLES);
    if (!tenantId) return;
    try {
      res.json(dayCloseReport(tenantId, String(req.query.date || "")));
    } catch (err) {
      sendErr(res, err, "accounts.dayClose");
    }
  });

  api.post("/accounts/day-close", requireAuth, (req, res) => {
    const tenantId = gate(req, res, ACCOUNTS_DESK_ROLES);
    if (!tenantId) return;
    try {
      res.status(201).json(saveDayClose(tenantId, req.body || {}, actorOf(req)));
    } catch (err) {
      sendErr(res, err, "accounts.dayClose.save");
    }
  });

  api.delete("/accounts/day-close", requireAuth, (req, res) => {
    const tenantId = gate(req, res, ACCOUNTS_ADMIN_ROLES);
    if (!tenantId) return;
    try {
      deleteDayClose(tenantId, String(req.query.date || ""));
      res.json({ ok: true });
    } catch (err) {
      sendErr(res, err, "accounts.dayClose.delete");
    }
  });

  api.post("/accounts/refunds", requireAuth, (req, res) => {
    const tenantId = gate(req, res, ACCOUNTS_DESK_ROLES);
    if (!tenantId) return;
    try {
      res.status(201).json({ refund: createRefund(tenantId, req.body || {}, actorOf(req)) });
    } catch (err) {
      sendErr(res, err, "accounts.refund");
    }
  });

  api.delete("/accounts/refunds/:id", requireAuth, (req, res) => {
    const tenantId = gate(req, res, ACCOUNTS_ADMIN_ROLES);
    if (!tenantId) return;
    try {
      deleteRefund(tenantId, req.params.id);
      res.json({ ok: true });
    } catch (err) {
      sendErr(res, err, "accounts.refund.delete");
    }
  });

  api.post("/accounts/collections/upi", requireAuth, (req, res) => {
    const tenantId = gate(req, res, ACCOUNTS_DESK_ROLES);
    if (!tenantId) return;
    try {
      const row = recordClinicUpi(tenantId, String(req.body?.invoiceId || req.body?.invoice_id || ""), actorOf(req));
      res.status(201).json({ invoice: mapInvoice(row) });
    } catch (err) {
      sendErr(res, err, "accounts.upi");
    }
  });

  api.get("/accounts/export", requireAuth, (req, res) => {
    const tenantId = gate(req, res, READ_ROLES);
    if (!tenantId) return;
    try {
      const format = String(req.query.format || "csv").toLowerCase() === "xlsx" ? "xlsx" : "csv";
      const file = monthExport(tenantId, String(req.query.month || ""), format);
      res.setHeader("Content-Type", file.mime);
      res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
      res.send(file.body);
    } catch (err) {
      sendErr(res, err, "accounts.export");
    }
  });

  return api;
}
