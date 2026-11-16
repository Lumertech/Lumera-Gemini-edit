import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { buildImmunizationPrintHtml } from "./immunizationPrint.ts";
import {
  IAP_HIGH_RISK_NOTES,
  IMMUNIZATION_CATALOG_VERSION,
  IMMUNIZATION_SCHEDULES,
  PEDIATRIC_SCHEDULE_CONTRASTS,
  addDaysIso,
  applyScheduleEdits,
  canonicalSex,
  canonicalSpecies,
  computeImmunizationChart,
  parseTemplateDueAge,
} from "./immunizationSchedules.ts";
import { vaccineDueReminderHook } from "./vaccineDueReminderHook.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function antigens(id: keyof typeof IMMUNIZATION_SCHEDULES): string[] {
  return IMMUNIZATION_SCHEDULES[id].doses.map((dose) => dose.antigen);
}

function dose(
  chart: { doses: Array<{ code: string; occurrenceKey: string; status: string; catchUp: boolean; dueOn?: string; catchUpNote?: string; doseLabel?: string }> },
  key: string
) {
  const found = chart.doses.find((item) => item.occurrenceKey === key || item.code === key);
  assert.ok(found, `missing ${key}`);
  return found;
}

describe("immunization schedule catalog", () => {
  it("versions the catalog and cites IAP, UIP, and WSAVA", () => {
    assert.equal(IMMUNIZATION_CATALOG_VERSION, "2026.11.1");
    assert.match(IMMUNIZATION_SCHEDULES.pediatric_iap.citation, /10\.1007\/s13312-024-3104-5/);
    assert.match(IMMUNIZATION_SCHEDULES.pediatric_iap.citation, /indianpediatrics\.net/);
    assert.match(IMMUNIZATION_SCHEDULES.pediatric_uip.citation, /mohfw\.gov\.in/);
    assert.match(IMMUNIZATION_SCHEDULES.canine.citation, /WSAVA/i);
    assert.match(IMMUNIZATION_SCHEDULES.feline.citation, /WSAVA/i);
    const doc = fs.readFileSync(path.join(root, "docs/immunization-schedules.md"), "utf8");
    assert.match(doc, /IAP-ACVIP 2023/);
    assert.match(doc, /Routine Immunization Manual for Health Workers, 2024/);
    assert.match(doc, /annual/i);
    const source = fs.readFileSync(path.join(root, "src/lib/immunizationSchedules.ts"), "utf8");
    assert.match(source, /indianpediatrics\.net\/feb2024\/113\.pdf/);
    assert.match(source, /RI_Manual_For_Health_Workers\.pdf/);
    assert.match(source, /WSAVA-Vaccination-guidelines-2024\.pdf/);
  });

  it("covers the IAP 2023 antigens from birth to adolescence and keeps UIP separate", () => {
    const iap = antigens("pediatric_iap").join(" | ");
    for (const name of ["BCG", "OPV", "Hepatitis B", "DTwP/DTaP", "IPV", "Hib", "PCV", "Rotavirus", "Influenza", "Typhoid conjugate", "MMR", "Hepatitis A", "Varicella", "HPV", "Tdap", "Td", "Japanese Encephalitis"]) {
      assert.match(iap, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.equal(IMMUNIZATION_SCHEDULES.pediatric_iap.doses.some((item) => item.code === "tcv" && /no booster|does not recommend a typhoid booster/i.test(item.notes || "")), true);
    const uip = antigens("pediatric_uip").join(" | ");
    assert.match(uip, /Pentavalent/);
    assert.match(uip, /bOPV/);
    assert.match(uip, /fIPV/);
    assert.match(uip, /\bMR\b/);
    assert.match(uip, /\bTd\b/);
    assert.equal(/HPV|Varicella|Typhoid/.test(uip), false);
    assert.equal(IMMUNIZATION_SCHEDULES.pediatric_uip.doses.some((item) => item.antigen === "MMR"), false);
  });

  it("schedules DHPPiL and annual rabies for dogs, and FVRCP for cats", () => {
    const dog = antigens("canine").join(" | ");
    assert.match(dog, /DHPPiL/);
    assert.match(dog, /Anti-rabies/);
    assert.match(dog, /Leptospirosis/);
    assert.equal(IMMUNIZATION_SCHEDULES.canine.doses.find((item) => item.code === "rabies-annual")?.recurringEveryDays, 365);
    assert.equal(IMMUNIZATION_SCHEDULES.canine.doses.find((item) => item.code === "dap-triennial")?.recurringEveryDays, 365 * 3);
    const cat = antigens("feline").join(" | ");
    assert.match(cat, /FVRCP/);
    assert.match(cat, /Anti-rabies/);
    assert.equal(IMMUNIZATION_SCHEDULES.canine.species, "dog");
    assert.equal(IMMUNIZATION_SCHEDULES.feline.species, "cat");
    assert.equal(IMMUNIZATION_SCHEDULES.canine.doses.some((item) => item.code === "deworm-puppy" && item.optional), true);
  });
});

describe("immunization chart computation", () => {
  it("marks a birth dose due, a late BCG as catch-up, and rotavirus closed after the window", () => {
    const birth = computeImmunizationChart({
      dateOfBirth: "2024-01-01",
      today: "2024-01-01",
      schedule: IMMUNIZATION_SCHEDULES.pediatric_iap,
      endemicJe: false,
      includeOptional: true,
    });
    assert.equal(birth.ok, true);
    if (!birth.ok) return;
    assert.equal(dose(birth, "bcg").status, "due");
    assert.equal(dose(birth, "bcg").catchUp, false);
    assert.equal(dose(birth, "dtwp-1").status, "upcoming");
    assert.equal(birth.doses.some((item) => item.antigen === "Japanese Encephalitis"), false);

    const late = computeImmunizationChart({
      dateOfBirth: "2024-01-01",
      today: "2024-02-15",
      schedule: IMMUNIZATION_SCHEDULES.pediatric_iap,
      includeOptional: true,
    });
    assert.equal(late.ok, true);
    if (!late.ok) return;
    const bcg = dose(late, "bcg");
    assert.equal(bcg.status, "overdue");
    assert.equal(bcg.catchUp, true);
    assert.equal(dose(late, "dtwp-1").status, "due");

    const older = computeImmunizationChart({
      dateOfBirth: "2024-01-01",
      today: "2026-01-01",
      schedule: IMMUNIZATION_SCHEDULES.pediatric_iap,
      includeOptional: false,
    });
    assert.equal(older.ok, true);
    if (!older.ok) return;
    assert.equal(dose(older, "rv-1").status, "not_indicated");
    assert.equal(dose(older, "rv-2").status, "not_indicated");
    assert.equal(older.doses.some((item) => item.code === "hepa-2"), false);
    assert.equal(older.doses.some((item) => item.code === "hepa-1"), true);
    const je = computeImmunizationChart({
      dateOfBirth: "2024-01-01",
      today: "2024-01-01",
      schedule: IMMUNIZATION_SCHEDULES.pediatric_iap,
      endemicJe: true,
    });
    assert.equal(je.ok, true);
    if (!je.ok) return;
    assert.equal(je.doses.some((item) => item.code === "je-1"), true);
  });

  it("keeps a recorded dose as given and a contraindication with its reason", () => {
    const chart = computeImmunizationChart({
      dateOfBirth: "2024-01-01",
      today: "2024-06-01",
      schedule: IMMUNIZATION_SCHEDULES.pediatric_iap,
      records: [
        {
          id: "rec-1",
          occurrenceKey: "bcg",
          status: "given",
          givenOn: "2024-01-01",
          brand: "Serum BCG",
          batchNo: "B1",
          givenByName: "Nurse Rao",
          stockAdministrationId: "vx-1",
        },
        {
          id: "rec-2",
          occurrenceKey: "opv-0",
          status: "contraindicated",
          reason: "Immunodeficiency",
        },
      ],
    });
    assert.equal(chart.ok, true);
    if (!chart.ok) return;
    const bcg = chart.doses.find((item) => item.code === "bcg");
    assert.equal(bcg?.status, "given");
    assert.equal(bcg?.brand, "Serum BCG");
    assert.equal(bcg?.batchNo, "B1");
    assert.equal(bcg?.stockAdministrationId, "vx-1");
    assert.equal(bcg?.catchUp, false);
    const opv = chart.doses.find((item) => item.code === "opv-0");
    assert.equal(opv?.status, "contraindicated");
    assert.equal(opv?.reason, "Immunodeficiency");
  });

  it("places dog and cat boosters and hides deworming when the clinic turns optional rows off", () => {
    const dog = computeImmunizationChart({
      dateOfBirth: "2024-01-01",
      today: "2024-04-01",
      schedule: IMMUNIZATION_SCHEDULES.canine,
      includeOptional: true,
    });
    assert.equal(dog.ok, true);
    if (!dog.ok) return;
    assert.equal(dose(dog, "dhppil-1").status, "overdue");
    assert.equal(dose(dog, "dhppil-1").catchUp, true);
    assert.equal(dose(dog, "rabies-1").status, "due");
    assert.equal(dog.doses.some((item) => item.code === "deworm-puppy"), true);
    const hidden = computeImmunizationChart({
      dateOfBirth: "2024-01-01",
      today: "2024-04-01",
      schedule: IMMUNIZATION_SCHEDULES.canine,
      includeOptional: false,
    });
    assert.equal(hidden.ok, true);
    if (!hidden.ok) return;
    assert.equal(hidden.doses.some((item) => item.antigen === "Deworming"), false);
    const cat = computeImmunizationChart({
      dateOfBirth: "2024-01-01",
      today: "2025-06-01",
      schedule: IMMUNIZATION_SCHEDULES.feline,
      includeOptional: false,
    });
    assert.equal(cat.ok, true);
    if (!cat.ok) return;
    assert.equal(cat.doses.some((item) => item.code === "fvrcp-1"), true);
    assert.equal(cat.doses.some((item) => item.occurrenceKey.startsWith("rabies-annual@")), true);
  });

  it("applies a clinic edit without rewriting the cited catalog", () => {
    const edited = applyScheduleEdits(
      IMMUNIZATION_SCHEDULES.pediatric_iap.doses,
      [{ scheduleId: "pediatric_iap", code: "bcg", dueAgeDays: 3 }, { scheduleId: "pediatric_iap", code: "opv-0", disabled: true }],
      "pediatric_iap"
    );
    assert.equal(edited.find((item) => item.code === "bcg")?.dueAgeDays, 3);
    assert.equal(edited.some((item) => item.code === "opv-0"), false);
    assert.equal(IMMUNIZATION_SCHEDULES.pediatric_iap.doses.find((item) => item.code === "bcg")?.dueAgeDays, 0);
    const chart = computeImmunizationChart({
      dateOfBirth: "2024-01-01",
      today: "2024-01-01",
      schedule: IMMUNIZATION_SCHEDULES.pediatric_iap,
      edits: [{ scheduleId: "pediatric_iap", code: "bcg", dueAgeDays: 3 }],
    });
    assert.equal(chart.ok, true);
    if (!chart.ok) return;
    assert.equal(dose(chart, "bcg").status, "upcoming");
    assert.equal(dose(chart, "bcg").dueOn, "2024-01-04");
  });

  it("refuses a chart when the date of birth is missing or in the future", () => {
    const missing = computeImmunizationChart({
      dateOfBirth: "",
      today: "2024-01-01",
      schedule: IMMUNIZATION_SCHEDULES.pediatric_iap,
    });
    assert.equal(missing.ok, false);
    const future = computeImmunizationChart({
      dateOfBirth: "2024-02-01",
      today: "2024-01-01",
      schedule: IMMUNIZATION_SCHEDULES.pediatric_iap,
    });
    assert.equal(future.ok, false);
  });
});

describe("due-dose WhatsApp hook and printable letterhead", () => {
  it("stays disabled and does not name a send", () => {
    const hook = vaccineDueReminderHook();
    assert.equal(hook.enabled, false);
    assert.equal(hook.sent, false);
    assert.match(hook.reason, /No approved WhatsApp template/);
    assert.ok(hook.reviewedTemplates.includes("appointment_reminder_v1"));
    assert.ok(hook.reviewedTemplates.includes("follow_up_consultation_reminder"));
    const source = fs.readFileSync(path.join(root, "src/lib/vaccineDueReminderHook.ts"), "utf8");
    assert.doesNotMatch(source, /graph-whatsapp|sendAppointmentReminder|fetch\(/);
    const server = fs.readFileSync(path.join(root, "server/immunization.ts"), "utf8");
    assert.doesNotMatch(server, /graph-whatsapp|sendAppointmentReminder/);
  });

  it("prints the clinic letterhead, the dose, and escaped text", () => {
    const html = buildImmunizationPrintHtml(
      { clinicName: "Asha <Clinic>", address: "12 Lake Road", city: "Pune", phone: "+91 20 0000", regId: "MH-1" },
      {
        patientName: "Meera",
        uhid: "LUM-1",
        dateOfBirth: "2024-01-01",
        scheduleTitle: "IAP-ACVIP 2023 (recommended)",
        scheduleVersion: "iap-acvip-2023",
        citation: "IAP-ACVIP 2023",
        doses: [
          {
            occurrenceKey: "bcg",
            code: "bcg",
            antigen: "BCG",
            doseLabel: "Birth dose",
            dueOn: "2024-01-01",
            dueAgeDays: 0,
            status: "given",
            catchUp: false,
            catchUpNote: "",
            notes: "",
            optional: false,
            endemicOnly: false,
            givenOn: "2024-01-01",
            brand: "Serum",
            batchNo: "B1",
            givenByName: "Dr Rao",
            reason: "",
            recordId: "imm-1",
            stockAdministrationId: "",
          },
        ],
      }
    );
    assert.match(html, /Asha &lt;Clinic&gt;/);
    assert.match(html, /12 Lake Road/);
    assert.match(html, /MH-1/);
    assert.match(html, /BCG/);
    assert.match(html, /Serum/);
    assert.match(html, /Schedules are reminders only/);
    assert.match(html, /IAP-ACVIP 2023/);
  });
});

describe("template due age", () => {
  it("does not treat a blank field as a birth dose", () => {
    assert.equal(parseTemplateDueAge("").ok, false);
    assert.equal(parseTemplateDueAge("   ").ok, false);
    const zero = parseTemplateDueAge("0");
    assert.equal(zero.ok, true);
    if (zero.ok) assert.equal(zero.days, 0);
    const three = parseTemplateDueAge("3");
    assert.equal(three.ok, true);
    if (three.ok) assert.equal(three.days, 3);
    assert.equal(parseTemplateDueAge("3.5").ok, false);
  });
});

describe("IAP 2025 and UIP age boundaries", () => {
  const dob = "2010-01-01";
  const at = (years: number) => addDaysIso(dob, years * 365);

  function chart(years: number, schedule: "pediatric_iap" | "pediatric_uip", extra: { sex?: "" | "female" | "male"; records?: Parameters<typeof computeImmunizationChart>[0]["records"] } = {}) {
    return computeImmunizationChart({
      dateOfBirth: dob,
      today: at(years),
      schedule: IMMUNIZATION_SCHEDULES[schedule],
      includeOptional: true,
      sex: extra.sex,
      records: extra.records,
    });
  }

  it("cites the 2025 edition and keeps the 2023 table in the file", () => {
    assert.match(IMMUNIZATION_SCHEDULES.pediatric_iap.citation, /10\.1007\/s13312-026-00311-w/);
    assert.match(IMMUNIZATION_SCHEDULES.pediatric_iap.citation, /may2026\/311\.pdf/);
    assert.equal(IMMUNIZATION_SCHEDULES.pediatric_iap.version, "iap-acvip-2025");
    const source = fs.readFileSync(path.join(root, "src/lib/immunizationSchedules.ts"), "utf8");
    assert.match(source, /indianpediatrics\.net\/may2026\/311\.pdf/);
    assert.match(source, /10\.1007\/s13312-026-00311-w/);
    const doc = fs.readFileSync(path.join(root, "docs/immunization-schedules.md"), "utf8");
    assert.match(doc, /IAP-ACVIP 2025/);
    assert.match(doc, /Td at 10 and 16 years/);
    assert.equal(PEDIATRIC_SCHEDULE_CONTRASTS.some((item) => item.topic === "10 years" && /Tdap/.test(item.iap) && /Td at 10/.test(item.uip)), true);
    assert.equal(PEDIATRIC_SCHEDULE_CONTRASTS.some((item) => item.topic === "16 years"), true);
    assert.match(IAP_HIGH_RISK_NOTES.map((item) => item.title).join(" "), /Meningococcal/);
    assert.match(IAP_HIGH_RISK_NOTES.map((item) => item.text).join(" "), /stops at 5 years/);
    assert.match(IAP_HIGH_RISK_NOTES.map((item) => item.text).join(" "), /18 years and beyond/);
  });

  it("keeps routine influenza stopped at 5 years and typhoid as a single dose", () => {
    const ten = chart(10, "pediatric_iap", { sex: "female" });
    assert.equal(ten.ok, true);
    if (!ten.ok) return;
    const flu = ten.doses.filter((item) => item.antigen === "Influenza");
    assert.ok(flu.length > 0);
    assert.equal(flu.every((item) => item.status === "not_indicated"), true);
    const typhoid = ten.doses.filter((item) => item.antigen === "Typhoid conjugate");
    assert.equal(typhoid.length, 1);
    assert.equal(typhoid[0].code, "tcv");
    assert.equal(typhoid[0].status, "overdue");
    assert.equal(typhoid[0].catchUp, true);
    assert.equal(IMMUNIZATION_SCHEDULES.pediatric_iap.doses.some((item) => /typhoid booster/i.test(item.code)), false);
  });

  it("marks Tdap due at 10 and 12 years, catch-up after that, and Td due at 16 and 18", () => {
    const ten = chart(10, "pediatric_iap", { sex: "female" });
    const twelve = chart(12, "pediatric_iap", { sex: "male" });
    const sixteen = chart(16, "pediatric_iap", { sex: "female" });
    const eighteen = chart(18, "pediatric_iap", { sex: "female" });
    for (const result of [ten, twelve, sixteen, eighteen]) assert.equal(result.ok, true);
    if (!ten.ok || !twelve.ok || !sixteen.ok || !eighteen.ok) return;
    assert.equal(dose(ten, "tdap").status, "due");
    assert.equal(dose(ten, "tdap").catchUp, false);
    assert.equal(dose(ten, "td").status, "upcoming");
    assert.equal(dose(twelve, "tdap").status, "due");
    assert.equal(dose(twelve, "tdap").catchUp, false);
    const afterTwelve = computeImmunizationChart({
      dateOfBirth: dob,
      today: addDaysIso(dob, 13 * 365),
      schedule: IMMUNIZATION_SCHEDULES.pediatric_iap,
      sex: "female",
    });
    assert.equal(afterTwelve.ok, true);
    if (!afterTwelve.ok) return;
    assert.equal(dose(afterTwelve, "tdap").status, "overdue");
    assert.equal(dose(afterTwelve, "tdap").catchUp, true);
    assert.equal(dose(sixteen, "tdap").status, "overdue");
    assert.equal(dose(sixteen, "tdap").catchUp, true);
    assert.equal(dose(sixteen, "td").status, "due");
    assert.equal(dose(sixteen, "td").catchUp, false);
    assert.equal(dose(eighteen, "td").status, "due");
    assert.equal(dose(eighteen, "td").catchUp, false);
    assert.equal(dose(eighteen, "tdap").status, "overdue");
    assert.equal(dose(eighteen, "tdap").catchUp, true);
    const dayAfterEighteen = computeImmunizationChart({
      dateOfBirth: dob,
      today: addDaysIso(dob, 18 * 365 + 1),
      schedule: IMMUNIZATION_SCHEDULES.pediatric_iap,
      sex: "female",
    });
    assert.equal(dayAfterEighteen.ok, true);
    if (!dayAfterEighteen.ok) return;
    assert.equal(dose(dayAfterEighteen, "td").status, "due");
    assert.equal(dose(dayAfterEighteen, "td").catchUp, false);
    assert.equal(dose(dayAfterEighteen, "tdap").status, "overdue");
    const pastChart = computeImmunizationChart({
      dateOfBirth: dob,
      today: addDaysIso(dob, 19 * 365),
      schedule: IMMUNIZATION_SCHEDULES.pediatric_iap,
      sex: "female",
    });
    assert.equal(pastChart.ok, true);
    if (!pastChart.ok) return;
    assert.equal(dose(pastChart, "td").status, "not_indicated");
    assert.equal(dose(pastChart, "tdap").status, "not_indicated");
  });

  it("marks UIP Td due at 10 and 16 years and catch-up when the 10-year dose was missed", () => {
    const ten = chart(10, "pediatric_uip");
    const twelve = chart(12, "pediatric_uip");
    const sixteen = chart(16, "pediatric_uip");
    const eighteen = chart(18, "pediatric_uip");
    for (const result of [ten, twelve, sixteen, eighteen]) assert.equal(result.ok, true);
    if (!ten.ok || !twelve.ok || !sixteen.ok || !eighteen.ok) return;
    assert.equal(dose(ten, "td-10").status, "due");
    assert.equal(dose(ten, "td-16").status, "upcoming");
    assert.equal(dose(twelve, "td-10").status, "overdue");
    assert.equal(dose(twelve, "td-10").catchUp, true);
    assert.equal(dose(sixteen, "td-16").status, "due");
    assert.equal(dose(sixteen, "td-10").status, "overdue");
    assert.equal(dose(eighteen, "td-16").status, "due");
    assert.equal(/HPV|Varicella|Typhoid/.test(eighteen.doses.map((item) => item.antigen).join(" ")), false);
  });

  it("uses the sex-specific HPV series and switches to three doses after the 15th birthday", () => {
    const girl = chart(10, "pediatric_iap", { sex: "female" });
    const boy = chart(12, "pediatric_iap", { sex: "male" });
    const unknown = chart(10, "pediatric_iap", { sex: "" });
    assert.equal(girl.ok && boy.ok && unknown.ok, true);
    if (!girl.ok || !boy.ok || !unknown.ok) return;
    assert.equal(dose(girl, "hpv-1").status, "due");
    assert.equal(dose(girl, "hpv-1").doseLabel, "Single dose (immunocompetent girls)");
    assert.equal(girl.doses.some((item) => item.code === "hpv-2"), false);
    assert.equal(girl.doses.some((item) => item.code.startsWith("hpv-15")), false);
    assert.equal(dose(boy, "hpv-1").status, "due");
    assert.equal(dose(boy, "hpv-1").doseLabel, "Dose 1 (boys, 9 up to 15 years)");
    assert.equal(dose(boy, "hpv-2").status, "upcoming");
    assert.match(dose(boy, "hpv-2").catchUpNote || "", /5 months|6 months/i);
    assert.equal(unknown.doses.some((item) => item.code === "hpv-1"), true);
    assert.equal(unknown.doses.some((item) => item.code === "hpv-2"), true);

    const olderGirl = chart(16, "pediatric_iap", { sex: "female" });
    assert.equal(olderGirl.ok, true);
    if (!olderGirl.ok) return;
    assert.equal(dose(olderGirl, "hpv-1").status, "not_indicated");
    assert.equal(dose(olderGirl, "hpv-15-1").status, "overdue");
    assert.equal(dose(olderGirl, "hpv-15-1").catchUp, true);
    assert.equal(dose(olderGirl, "hpv-15-2").status, "upcoming");
    assert.equal(dose(olderGirl, "hpv-15-2").dueOn, addDaysIso(at(16), 60));
    assert.equal(dose(olderGirl, "hpv-15-3").status, "upcoming");
    assert.equal(dose(olderGirl, "hpv-15-3").dueOn, addDaysIso(at(16), 180));
    assert.ok((dose(olderGirl, "hpv-15-3").dueOn || "") > at(16));

    const startedLate = chart(16, "pediatric_iap", {
      sex: "female",
      records: [{ occurrenceKey: "hpv-15-1", status: "given", givenOn: at(16) }],
    });
    assert.equal(startedLate.ok, true);
    if (!startedLate.ok) return;
    assert.equal(dose(startedLate, "hpv-15-2").dueOn, addDaysIso(at(16), 60));
    assert.equal(dose(startedLate, "hpv-15-3").dueOn, addDaysIso(at(16), 180));
    assert.equal(dose(startedLate, "hpv-15-3").status, "upcoming");

    const doseOneOnly = computeImmunizationChart({
      dateOfBirth: dob,
      today: addDaysIso(at(15), 190),
      schedule: IMMUNIZATION_SCHEDULES.pediatric_iap,
      sex: "female",
      records: [{ occurrenceKey: "hpv-15-1", status: "given", givenOn: at(15) }],
    });
    assert.equal(doseOneOnly.ok, true);
    if (!doseOneOnly.ok) return;
    assert.equal(dose(doseOneOnly, "hpv-15-2").status, "overdue");
    assert.equal(dose(doseOneOnly, "hpv-15-3").status, "upcoming");
    assert.equal(dose(doseOneOnly, "hpv-15-3").catchUp, false);
    assert.ok((dose(doseOneOnly, "hpv-15-3").dueOn || "") > addDaysIso(at(15), 190));

    const bothGiven = computeImmunizationChart({
      dateOfBirth: dob,
      today: addDaysIso(at(15), 180),
      schedule: IMMUNIZATION_SCHEDULES.pediatric_iap,
      sex: "female",
      records: [
        { occurrenceKey: "hpv-15-1", status: "given", givenOn: at(15) },
        { occurrenceKey: "hpv-15-2", status: "given", givenOn: addDaysIso(at(15), 60) },
      ],
    });
    assert.equal(bothGiven.ok, true);
    if (!bothGiven.ok) return;
    assert.equal(dose(bothGiven, "hpv-15-3").status, "due");
    assert.equal(dose(bothGiven, "hpv-15-3").dueOn, addDaysIso(at(15), 180));

    const started = chart(16, "pediatric_iap", {
      sex: "female",
      records: [
        { occurrenceKey: "hpv-1", status: "given", givenOn: at(10) },
        { occurrenceKey: "hpv-2", status: "given", givenOn: addDaysIso(at(10), 180) },
      ],
    });
    assert.equal(started.ok, true);
    if (!started.ok) return;
    assert.equal(dose(started, "hpv-1").status, "given");
    assert.equal(dose(started, "hpv-2").status, "given");
    assert.equal(started.doses.some((item) => item.code.startsWith("hpv-15")), false);

    const boyLate = computeImmunizationChart({
      dateOfBirth: dob,
      today: at(15),
      schedule: IMMUNIZATION_SCHEDULES.pediatric_iap,
      sex: "male",
      records: [{ occurrenceKey: "hpv-1", status: "given", givenOn: at(14) }],
    });
    assert.equal(boyLate.ok, true);
    if (!boyLate.ok) return;
    assert.equal(dose(boyLate, "hpv-1").status, "given");
    assert.equal(boyLate.doses.some((item) => item.code.startsWith("hpv-15")), false);
    const second = dose(boyLate, "hpv-2");
    assert.equal(second.status, "due");
    assert.equal(second.dueOn, addDaysIso(at(14), 180));
  });

  it("waits 4 weeks for varicella dose 2 when catch-up starts after 12 years", () => {
    const teen = chart(13, "pediatric_iap", { sex: "female" });
    assert.equal(teen.ok, true);
    if (!teen.ok) return;
    assert.equal(dose(teen, "vari-1").status, "overdue");
    assert.equal(dose(teen, "vari-1").catchUp, true);
    assert.equal(dose(teen, "vari-2").status, "upcoming");
    assert.match(dose(teen, "vari-2").catchUpNote || "", /4 weeks/);
    const given = chart(13, "pediatric_iap", {
      sex: "female",
      records: [{ occurrenceKey: "vari-1", status: "given", givenOn: at(13) }],
    });
    assert.equal(given.ok, true);
    if (!given.ok) return;
    assert.equal(dose(given, "vari-2").dueOn, addDaysIso(at(13), 28));
    assert.equal(dose(given, "vari-2").status, "upcoming");
  });

  it("prints both schedule labels and the high-risk notes", () => {
    const html = buildImmunizationPrintHtml(
      { clinicName: "Asha Clinic", address: "12 Lake Road", city: "Pune", phone: "", regId: "" },
      {
        patientName: "Meera",
        dateOfBirth: dob,
        scheduleTitle: "IAP-ACVIP 2025 (recommended)",
        scheduleVersion: "iap-acvip-2025",
        citation: IMMUNIZATION_SCHEDULES.pediatric_iap.citation,
        doses: [],
        contrasts: PEDIATRIC_SCHEDULE_CONTRASTS,
        advisories: IAP_HIGH_RISK_NOTES,
      }
    );
    assert.match(html, /Where IAP and UIP differ/);
    assert.match(html, /<span class="label">IAP<\/span>/);
    assert.match(html, /<span class="label">UIP<\/span>/);
    assert.match(html, /Meningococcal/);
    assert.match(html, /10\.1007\/s13312-026-00311-w/);
    assert.match(html, /Schedules are reminders only/);
  });
});

describe("species normalization", () => {
  it("maps dog and cat aliases and leaves people blank", () => {
    assert.equal(canonicalSpecies("Dog"), "dog");
    assert.equal(canonicalSpecies("puppy"), "dog");
    assert.equal(canonicalSpecies("Kitten"), "cat");
    assert.equal(canonicalSpecies(""), "");
    assert.equal(canonicalSpecies("human"), "human");
    assert.equal(canonicalSpecies("rabbit"), "other");
  });

  it("maps female and male and leaves other blank", () => {
    assert.equal(canonicalSex("Female"), "female");
    assert.equal(canonicalSex("boy"), "male");
    assert.equal(canonicalSex("Other"), "");
    assert.equal(canonicalSex(""), "");
  });
});
