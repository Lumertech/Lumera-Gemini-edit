import { Router, type Request, type Response } from "express";
import { getDb } from "./db.ts";
import { requireAuth } from "./auth.ts";
import { reportCaughtError } from "./error-tracker.ts";
import { isRxLanguage } from "../src/lib/rxDirections.ts";
import { approveTranslation, buildTranslation, readTranslation, saveTranslation } from "./rx-translation.ts";
import { CERTIFICATE_KINDS, issueCertificate, type CertificateKind } from "./clinic-certificate.ts";
import { carePlanForPatient, listGrowth, recordGrowth, recordImmunization, tenantPatient } from "./after-visit-care.ts";
import { bookTeleconsultAppointment, appendTeleconsultSignal, listTeleconsultSignals } from "./teleconsult.ts";
import { deliverPatientNotice } from "./patient-visit-delivery.ts";
import { isWithinCustomerServiceWindow } from "./graph-whatsapp.ts";
import { approvedPatientTemplateName } from "./patient-whatsapp-templates.ts";
import { choosePatientOutbound } from "./patient-visit-messages.ts";
import { claimVisitNotice, mintPatientVisitLink, patientLinkUrl } from "./patient-visit-token.ts";

const STAFF = new Set(["doctor", "receptionist", "CLINIC_ADMIN", "polyclinic_admin"]);
const PRESCRIBER = new Set(["doctor", "CLINIC_ADMIN", "polyclinic_admin"]);

function tenantId(req: Request): string {
  return String(req.user?.tenantId || "").trim();
}

function fail(res: Response, err: unknown, label: string): void {
  const status = typeof err === "object" && err && "status" in err ? Number((err as { status: number }).status) : 500;
  const message = err instanceof Error ? err.message : "Request failed";
  if (!status || status >= 500) reportCaughtError(err, label);
  res.status(status || 500).json({ error: status >= 500 ? "Request failed" : message });
}

export function registerAfterVisitRoutes(api: Router): void {
  api.post("/rx-language/draft", requireAuth, async (req, res) => {
    const clinic = tenantId(req);
    if (!clinic) return res.status(401).json({ error: "Sign in required" });
    if (!PRESCRIBER.has(String(req.user?.role || ""))) return res.status(403).json({ error: "Insufficient permissions", code: "ROLE_DENIED" });
    const language = String(req.body?.language || "");
    const prescriptionId = String(req.body?.prescriptionId || req.body?.prescription_id || "").trim();
    if (!isRxLanguage(language) || language === "en") return res.status(400).json({ error: "Choose Hindi or Marathi." });
    if (!prescriptionId) return res.status(400).json({ error: "prescriptionId is required" });
    try {
      const rx = getDb()
        .prepare("SELECT id, medicines, advice FROM prescriptions WHERE id = ? AND tenant_id = ?")
        .get(prescriptionId, clinic) as { id: string; medicines: string; advice: string } | undefined;
      if (!rx) return res.status(404).json({ error: "Prescription not found" });
      const medicines = JSON.parse(rx.medicines || "[]");
      const advice = JSON.parse(rx.advice || "[]");
      const translation = await buildTranslation({
        language,
        medicines: Array.isArray(medicines) ? medicines : [],
        advice: Array.isArray(advice) ? advice.map((item) => String(item)) : [],
      });
      saveTranslation(getDb(), { tenantId: clinic, prescriptionId, language, translation, status: "draft" });
      res.json({ ok: true, status: "draft", model: translation.model, translation: readTranslation(getDb(), clinic, prescriptionId, language) });
    } catch (err) {
      fail(res, err, "rx-language.draft");
    }
  });

  api.post("/rx-language/:prescriptionId/approve", requireAuth, (req, res) => {
    const clinic = tenantId(req);
    if (!clinic) return res.status(401).json({ error: "Sign in required" });
    if (!PRESCRIBER.has(String(req.user?.role || ""))) return res.status(403).json({ error: "Insufficient permissions", code: "ROLE_DENIED" });
    const language = String(req.body?.language || "");
    if (!approveTranslation(getDb(), clinic, req.params.prescriptionId, language)) {
      return res.status(404).json({ error: "No draft translation to approve" });
    }
    res.json({ ok: true, status: "approved" });
  });

  api.post("/certificates", requireAuth, async (req, res) => {
    const clinic = tenantId(req);
    if (!clinic) return res.status(401).json({ error: "Sign in required" });
    if (!STAFF.has(String(req.user?.role || ""))) return res.status(403).json({ error: "Insufficient permissions", code: "ROLE_DENIED" });
    const kind = String(req.body?.kind || "") as CertificateKind;
    if (!CERTIFICATE_KINDS.includes(kind)) return res.status(400).json({ error: "kind must be medical or fitness" });
    try {
      const patient = tenantPatient(getDb(), clinic, String(req.body?.patientId || ""));
      if (!patient) return res.status(404).json({ error: "Patient not found" });
      const issued = await issueCertificate(getDb(), {
        tenantId: clinic,
        patientId: patient.id,
        appointmentId: String(req.body?.appointmentId || ""),
        kind,
        patientName: patient.name,
        age: Number(patient.age || 0),
        gender: patient.gender,
        date: String(req.body?.date || new Date().toISOString().slice(0, 10)),
        diagnosis: String(req.body?.diagnosis || ""),
        purpose: String(req.body?.purpose || ""),
        doctorName: String(req.body?.doctorName || req.user?.name || "Doctor"),
      });
      res.status(201).json({ ok: true, certificate: issued });
    } catch (err) {
      fail(res, err, "certificates.issue");
    }
  });

  api.get("/certificates/:id/file", requireAuth, (req, res) => {
    const clinic = tenantId(req);
    if (!clinic) return res.status(401).json({ error: "Sign in required" });
    if (!STAFF.has(String(req.user?.role || ""))) return res.status(403).json({ error: "Insufficient permissions", code: "ROLE_DENIED" });
    const row = getDb()
      .prepare("SELECT pdf_base64, title FROM clinic_certificates WHERE id = ? AND tenant_id = ?")
      .get(req.params.id, clinic) as { pdf_base64?: string; title?: string } | undefined;
    if (!row?.pdf_base64) return res.status(404).json({ error: "Certificate not found" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${row.title || "certificate"}.pdf"`);
    res.send(Buffer.from(row.pdf_base64, "base64"));
  });

  api.get("/patients/:id/care-plan", requireAuth, (req, res) => {
    const clinic = tenantId(req);
    if (!clinic) return res.status(401).json({ error: "Sign in required" });
    if (!STAFF.has(String(req.user?.role || ""))) return res.status(403).json({ error: "Insufficient permissions", code: "ROLE_DENIED" });
    try {
      res.json({ ok: true, plan: carePlanForPatient(getDb(), clinic, req.params.id) });
    } catch (err) {
      fail(res, err, "care-plan");
    }
  });

  api.post("/patients/:id/immunizations", requireAuth, (req, res) => {
    const clinic = tenantId(req);
    if (!clinic) return res.status(401).json({ error: "Sign in required" });
    if (!STAFF.has(String(req.user?.role || ""))) return res.status(403).json({ error: "Insufficient permissions", code: "ROLE_DENIED" });
    if (!tenantPatient(getDb(), clinic, req.params.id)) return res.status(404).json({ error: "Patient not found" });
    try {
      recordImmunization(getDb(), clinic, req.params.id, String(req.body?.doseCode || ""), String(req.body?.givenOn || ""));
      res.status(201).json({ ok: true, plan: carePlanForPatient(getDb(), clinic, req.params.id) });
    } catch (err) {
      fail(res, err, "immunizations");
    }
  });

  api.post("/patients/:id/care-reminder", requireAuth, async (req, res) => {
    const clinic = tenantId(req);
    if (!clinic) return res.status(401).json({ error: "Sign in required" });
    if (!STAFF.has(String(req.user?.role || ""))) return res.status(403).json({ error: "Insufficient permissions", code: "ROLE_DENIED" });
    try {
      const patient = tenantPatient(getDb(), clinic, req.params.id);
      if (!patient) return res.status(404).json({ error: "Patient not found" });
      const plan = carePlanForPatient(getDb(), clinic, req.params.id);
      const clinicRow = getDb().prepare("SELECT name FROM tenants WHERE id = ?").get(clinic) as { name?: string } | undefined;
      const clinicName = String(clinicRow?.name || "your clinic");
      const doctorName = String(req.body?.doctorName || req.user?.name || "your doctor");
      const lines = [
        `*${clinicName}*`,
        `Care reminder from *${doctorName}*`,
        plan.followUpDate ? `Next visit: ${plan.followUpDate}` : "Next visit: not scheduled",
      ];
      if (plan.vaccines) {
        const overdue = plan.vaccines.overdue.map((dose) => dose.name);
        const due = plan.vaccines.due.map((dose) => dose.name);
        if (overdue.length) lines.push(`Overdue vaccines: ${overdue.join(", ")}`);
        if (due.length) lines.push(`Due vaccines: ${due.join(", ")}`);
      }
      const phone = String(patient.phone || "");
      const minted = phone
        ? mintPatientVisitLink(getDb(), { tenantId: clinic, patientId: patient.id, phone })
        : null;
      if (minted) lines.push(patientLinkUrl(minted.id), `Code: ${minted.otp}`);
      const inWindow = phone ? isWithinCustomerServiceWindow(getDb() as never, clinic, phone) : false;
      const approved = approvedPatientTemplateName(getDb(), clinic, "clinic_care_reminder");
      const mode = choosePatientOutbound(inWindow, approved);
      if (!claimVisitNotice(getDb(), clinic, `care:${patient.id}:${new Date().toISOString().slice(0, 10)}`, "care_reminder")) {
        return res.json({ ok: true, status: "skipped", mode: "none" });
      }
      const result = await deliverPatientNotice({
        db: getDb(),
        tenantId: clinic,
        phone,
        name: patient.name,
        eventType: "care_reminder",
        mode,
        textBody: lines.join("\n"),
        templateName: mode === "freeform" ? undefined : "clinic_care_reminder",
        templateParameters: mode === "template" ? [clinicName, doctorName] : undefined,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      fail(res, err, "care-reminder");
    }
  });

  api.get("/patients/:id/growth", requireAuth, (req, res) => {
    const clinic = tenantId(req);
    if (!clinic) return res.status(401).json({ error: "Sign in required" });
    if (!STAFF.has(String(req.user?.role || ""))) return res.status(403).json({ error: "Insufficient permissions", code: "ROLE_DENIED" });
    try {
      res.json({ ok: true, points: listGrowth(getDb(), clinic, req.params.id) });
    } catch (err) {
      fail(res, err, "growth.list");
    }
  });

  api.post("/patients/:id/growth", requireAuth, (req, res) => {
    const clinic = tenantId(req);
    if (!clinic) return res.status(401).json({ error: "Sign in required" });
    if (!STAFF.has(String(req.user?.role || ""))) return res.status(403).json({ error: "Insufficient permissions", code: "ROLE_DENIED" });
    try {
      const point = recordGrowth(getDb(), clinic, req.params.id, {
        recordedOn: req.body?.recordedOn,
        heightCm: Number(req.body?.heightCm),
        weightKg: Number(req.body?.weightKg),
        headCm: Number(req.body?.headCm),
      });
      res.status(201).json({ ok: true, point });
    } catch (err) {
      fail(res, err, "growth.record");
    }
  });

  api.post("/teleconsult", requireAuth, async (req, res) => {
    const clinic = tenantId(req);
    if (!clinic) return res.status(401).json({ error: "Sign in required" });
    if (!STAFF.has(String(req.user?.role || ""))) return res.status(403).json({ error: "Insufficient permissions", code: "ROLE_DENIED" });
    try {
      const booked = bookTeleconsultAppointment(getDb(), {
        tenantId: clinic,
        patientId: String(req.body?.patientId || ""),
        doctorId: String(req.body?.doctorId || ""),
        date: String(req.body?.date || ""),
        timeSlot: String(req.body?.timeSlot || ""),
      });
      const patient = tenantPatient(getDb(), clinic, String(req.body?.patientId || ""));
      const clinicRow = getDb().prepare("SELECT name FROM tenants WHERE id = ?").get(clinic) as { name?: string } | undefined;
      let delivery: { status: string; mode: string } | null = null;
      if (patient?.phone) {
        const minted = mintPatientVisitLink(getDb(), {
          tenantId: clinic,
          patientId: patient.id,
          appointmentId: booked.id,
          phone: patient.phone,
        });
        const clinicName = String(clinicRow?.name || "your clinic");
        const text = [
          `*${clinicName}*`,
          `Video visit with *${booked.doctorName}* on ${booked.date} at ${booked.timeSlot}.`,
          `Fee: recorded on this visit like a clinic consult.`,
          minted ? patientLinkUrl(minted.id) : "",
          minted ? `Code: ${minted.otp}` : "",
        ]
          .filter(Boolean)
          .join("\n");
        const inWindow = isWithinCustomerServiceWindow(getDb() as never, clinic, patient.phone);
        const approved = approvedPatientTemplateName(getDb(), clinic, "clinic_teleconsult_join");
        const mode = choosePatientOutbound(inWindow, approved);
        delivery = await deliverPatientNotice({
          db: getDb(),
          tenantId: clinic,
          phone: patient.phone,
          name: patient.name,
          eventType: "teleconsult_join",
          mode,
          textBody: text,
          templateName: mode === "freeform" ? undefined : "clinic_teleconsult_join",
          templateParameters: mode === "template" ? [clinicName, booked.doctorName] : undefined,
        });
      }
      res.status(201).json({ ok: true, appointment: booked, delivery });
    } catch (err) {
      fail(res, err, "teleconsult.book");
    }
  });

  api.post("/teleconsult/:appointmentId/signal", requireAuth, (req, res) => {
    const clinic = tenantId(req);
    if (!clinic) return res.status(401).json({ error: "Sign in required" });
    if (!STAFF.has(String(req.user?.role || ""))) return res.status(403).json({ error: "Insufficient permissions", code: "ROLE_DENIED" });
    try {
      const saved = appendTeleconsultSignal(getDb(), {
        tenantId: clinic,
        appointmentId: req.params.appointmentId,
        senderRole: "doctor",
        kind: String(req.body?.kind || ""),
        payload: String(req.body?.payload || ""),
      });
      res.status(201).json({ ok: true, signal: saved });
    } catch (err) {
      fail(res, err, "teleconsult.signal");
    }
  });

  api.get("/teleconsult/:appointmentId/signals", requireAuth, (req, res) => {
    const clinic = tenantId(req);
    if (!clinic) return res.status(401).json({ error: "Sign in required" });
    if (!STAFF.has(String(req.user?.role || ""))) return res.status(403).json({ error: "Insufficient permissions", code: "ROLE_DENIED" });
    const visit = getDb()
      .prepare("SELECT id FROM appointments WHERE id = ? AND tenant_id = ? AND type = 'Teleconsult'")
      .get(req.params.appointmentId, clinic);
    if (!visit) return res.status(404).json({ error: "Video visit not found" });
    res.json({
      ok: true,
      signals: listTeleconsultSignals(getDb(), clinic, req.params.appointmentId, String(req.query.after || "")),
      productionNote:
        "Video uses in-browser WebRTC. Production needs HTTPS and a self-hosted TURN server. Signaling on this server expires after two hours.",
    });
  });
}
