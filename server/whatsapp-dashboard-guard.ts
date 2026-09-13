/**
 * Mount-time auth + tenant isolation for dashboard WhatsApp routes.
 *
 * createWhatsAppRouter() still registers the handlers in whatsapp.ts.
 * This wrapper:
 *  - applies requireAuth + requireRole(...CLINICIAN_ROLES) (same as requireClinicWhatsApp)
 *  - serves tenant-scoped conversation/message/outbound GETs
 *  - overwrites client-supplied tenantId once req.user exists (emr-action / send)
 *  - 404s cross-tenant conversation mutations
 *
 * Meta webhooks stay on /api/meta and /meta — they are not on this router.
 * Prescription / lab-report PDFs stay public.
 */
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import {
  clinicTenantId,
  getTenantConversation,
  listTenantConversations,
  listTenantOutboundEvents,
  requireClinicWhatsApp,
  stampWhatsAppTenant,
} from "./whatsapp-scope.ts";

function serializeConversation(c: Record<string, unknown>) {
  return {
    id: c.id,
    patientPhone: c.patient_phone,
    patientName: c.patient_name,
    patientId: c.patient_id,
    uhid: c.uhid,
    handoverMode: c.handover_mode,
    assignedStaff: c.assigned_staff,
    tags: JSON.parse((c.tags as string) || "[]"),
    preferredLanguage: c.preferred_language || "en",
    unreadCount: Number(c.unread_count || 0),
    lastMessage: c.last_message,
    lastMessageTime: c.last_message_time,
    updatedAt: c.updated_at,
  };
}

function isPublicPdf(path: string): boolean {
  return path.startsWith("/prescription/") || path.startsWith("/lab-report/");
}

function isDashboardPath(path: string): boolean {
  if (isPublicPdf(path)) return false;
  const prefixes = [
    "/conversations",
    "/messages",
    "/send",
    "/emr-action",
    "/voice-process",
    "/translate",
    "/send-rx",
    "/outbound/trigger",
    "/outbound-trigger",
    "/outbound/events",
    "/outbound-events",
    "/reminders/run",
  ];
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function runChain(handlers: RequestHandler[], req: Request, res: Response, next: NextFunction) {
  let i = 0;
  const go = (err?: unknown) => {
    if (err) return next(err as Error);
    const h = handlers[i++];
    if (!h) return next();
    try {
      h(req, res, go);
    } catch (caught) {
      next(caught as Error);
    }
  };
  go();
}

function conversationIdFromPath(path: string, req: Request): string {
  const fromParams = String(req.params.id || req.params.conversationId || "").trim();
  if (fromParams) return fromParams;
  const fromBody = String((req.body as { conversationId?: string } | undefined)?.conversationId || "").trim();
  if (fromBody) return fromBody;
  const fromQuery = String(req.query.conversationId || "").trim();
  if (fromQuery) return fromQuery;
  const conv = path.match(/^\/conversations\/([^/]+)/);
  if (conv?.[1] && !["handover", "assign", "tags"].includes(conv[1])) return conv[1];
  const msgs = path.match(/^\/messages\/([^/]+)/);
  return msgs?.[1] || "";
}

function stampSessionTenant(req: Request) {
  const tenantId = clinicTenantId(req);
  if (!tenantId) return;
  if (req.body && typeof req.body === "object") {
    (req.body as { tenantId?: string }).tenantId = tenantId;
    const payload = (req.body as { payload?: { tenantId?: string } }).payload;
    if (payload && typeof payload === "object") payload.tenantId = tenantId;
  }
}

export function protectWhatsAppDashboard(inner: Router): Router {
  const outer = Router();

  outer.use((req: Request, res: Response, next: NextFunction) => {
    const path = String(req.path || "").split("?")[0];
    if (!isDashboardPath(path)) return next();
    runChain(requireClinicWhatsApp, req, res, next);
  });

  outer.get("/conversations", (req: Request, res: Response) => {
    const tenantId = clinicTenantId(req);
    if (!tenantId) return res.json({ conversations: [] });
    const rows = listTenantConversations(tenantId);
    res.json({ conversations: rows.map(serializeConversation) });
  });

  outer.get("/conversations/:id", (req: Request, res: Response) => {
    const tenantId = clinicTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "No tenant associated with this account." });
    const c = getTenantConversation(tenantId, String(req.params.id));
    if (!c) return res.status(404).json({ error: "Conversation not found" });
    res.json({ conversation: serializeConversation(c) });
  });

  outer.get("/messages", (req: Request, res: Response) => {
    const tenantId = clinicTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "No tenant associated with this account." });
    const convId = String(req.query.conversationId || "").trim();
    if (convId) {
      const conv = getTenantConversation(tenantId, convId);
      if (!conv) return res.status(404).json({ error: "Conversation not found" });
    }
    nextInner(inner, req, res);
  });

  outer.get("/messages/:conversationId", (req: Request, res: Response) => {
    const tenantId = clinicTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "No tenant associated with this account." });
    const conv = getTenantConversation(tenantId, String(req.params.conversationId || "").trim());
    if (!conv) return res.status(404).json({ error: "Conversation not found" });
    nextInner(inner, req, res);
  });

  outer.get("/outbound/events", (req: Request, res: Response) => {
    const tenantId = clinicTenantId(req);
    if (!tenantId) return res.json({ events: [] });
    res.json({ events: listTenantOutboundEvents(tenantId) });
  });

  outer.get("/outbound-events", (req: Request, res: Response) => {
    const tenantId = clinicTenantId(req);
    if (!tenantId) return res.json({ events: [] });
    res.json({ events: listTenantOutboundEvents(tenantId) });
  });

  outer.use((req: Request, res: Response, next: NextFunction) => {
    const path = String(req.path || "").split("?")[0];
    if (!isDashboardPath(path)) return next();
    stampSessionTenant(req);

    const tenantId = clinicTenantId(req);
    const convId = conversationIdFromPath(path, req);
    const needsConv =
      /^\/conversations\/[^/]+\/(handover|assign|tags)$/.test(path) ||
      /^\/messages\/[^/]+$/.test(path) ||
      (path === "/messages" && Boolean(convId));
    if (needsConv && convId && tenantId) {
      const conv = getTenantConversation(tenantId, convId);
      if (!conv) return res.status(404).json({ error: "Conversation not found" });
    }

    if (req.method === "POST" && path === "/send" && tenantId) {
      const origStatus = res.status.bind(res);
      (res as Response & { status: (code: number) => Response }).status = (code: number) => {
        const chain = origStatus(code);
        const origJson = chain.json.bind(chain);
        chain.json = (body: unknown) => {
          const convIdSent = String(
            (body as { sentMessage?: { conversationId?: string } } | null)?.sentMessage?.conversationId || ""
          );
          if (convIdSent) stampWhatsAppTenant("whatsapp_conversations", convIdSent, tenantId);
          return origJson(body);
        };
        return chain;
      };
    }

    next();
  });

  outer.use(inner);
  return outer;
}

function nextInner(inner: Router, req: Request, res: Response) {
  inner(req, res, () => {
    if (!res.headersSent) res.status(404).json({ error: "Not found" });
  });
}
