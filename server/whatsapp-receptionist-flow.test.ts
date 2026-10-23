import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { getDb, initDatabase } from "./db.ts";
import { processBotActionOrQuery } from "./whatsapp.ts";

describe("WhatsApp Receptionist Agent Workflow Tests (+919999973271)", () => {
  const patientPhone = "+919999973271";
  const tenantId = "tenant-lumera-main";

  before(() => {
    try {
      getDb();
    } catch {
      initDatabase();
    }

    const db = getDb();
    // Ensure test patient exists
    try {
      db.prepare(`
        INSERT OR IGNORE INTO patients (id, tenant_id, uhid, name, age, gender, phone, created_at)
        VALUES ('pat-test-999', ?, 'LUM-999-732', 'Test Patient', 35, 'Male', ?, datetime('now'))
      `).run(tenantId, patientPhone);
    } catch {
      /* ignore */
    }

    // Ensure a test prescription exists for prescription testing
    try {
      db.prepare(`
        INSERT OR REPLACE INTO prescriptions (
          id, tenant_id, rx_number, patient_id, patient_name, patient_phone, patient_uhid,
          doctor_id, doctor_name, doctor_specialty, doctor_reg_number, date, diagnosis,
          medicines, lab_tests, advice, follow_up_date, created_at
        ) VALUES (
          'rx-test-999', ?, 'RX-2026-999', 'pat-test-999', 'Test Patient', ?, 'LUM-999-732',
          'doc-siddharth', 'Dr. Siddharth Verma', 'Physiotherapy & Rehab', 'DMC-54321',
          date('now'), 'Lumbar Spondylosis',
          '[{"drugName":"Tab Ultracet","dosage":"325mg","frequency":"1-0-1","timing":"After Meals"},{"drugName":"Tab Neurobion Forte","dosage":"1 tab","frequency":"0-1-0","timing":"After Lunch"}]',
          '["MRI Lumbar Spine"]', '["Core strengthening exercises"]',
          date('now', '+7 days'), datetime('now')
        )
      `).run(tenantId, patientPhone);
    } catch {
      /* ignore */
    }
  });

  it("1. Responds to intake greeting with 24/7 receptionist services and basic choices", async () => {
    const db = getDb();
    const reply = await processBotActionOrQuery(
      "Hi, I need help",
      patientPhone,
      "Test Patient",
      {},
      db,
      { tenantId }
    );

    assert.ok(reply, "Should return a receptionist reply");
    assert.match(reply.content, /automated AI Clinic Receptionist|AI Receptionist|Welcome/i);
    assert.ok(Array.isArray(reply.buttons), "Should provide quick action buttons");
    assert.ok(reply.buttons.some(b => b.includes("Book") || b.includes("Schedule")));
  });

  it("2. Responds to doctor schedule / OPD timings inquiry with doctor roster and fees", async () => {
    const db = getDb();
    const reply = await processBotActionOrQuery(
      "What are the doctor timings and schedule?",
      patientPhone,
      "Test Patient",
      {},
      db,
      { tenantId }
    );

    assert.ok(reply, "Should return a roster reply");
    assert.match(reply.content, /OPD Roster|Timings|Room/i);
    assert.ok(Array.isArray(reply.buttons));
    assert.ok(reply.buttons.length > 0);
  });

  it("3. Books an appointment for requested doctor and confirms token slot", async () => {
    const db = getDb();
    const reply = await processBotActionOrQuery(
      "Book Dr. Siddharth",
      patientPhone,
      "Test Patient",
      {},
      db,
      { tenantId }
    );

    assert.ok(reply, "Should return booking confirmation");
    assert.match(reply.content, /Appointment Confirmed|Existing Active Booking/i);
    assert.match(reply.content, /Token/i);
    assert.ok(Array.isArray(reply.buttons));
    assert.ok(reply.buttons.some(b => b.includes("Queue") || b.includes("Cancel")));
  });

  it("4. Sends prescription and active medications with PDF download link", async () => {
    const db = getDb();
    const reply = await processBotActionOrQuery(
      "Please send my prescription",
      patientPhone,
      "Test Patient",
      {},
      db,
      { tenantId }
    );

    assert.ok(reply, "Should return prescription details");
    assert.match(reply.content, /Prescription Record Found|RX-2026-999/i);
    assert.match(reply.content, /Ultracet/i);
    assert.ok(reply.media, "Should include prescription PDF media");
    assert.match(String((reply.media as any).url), /\/api\/emr\/prescription\//);
  });

  it("5. Provides follow-up consultation reminder and next visit date", async () => {
    const db = getDb();
    const reply = await processBotActionOrQuery(
      "When is my follow-up reminder?",
      patientPhone,
      "Test Patient",
      {},
      db,
      { tenantId }
    );

    assert.ok(reply, "Should return follow-up details");
    assert.match(reply.content, /Follow-Up Consultation Schedule|Recommended Follow-Up/i);
    assert.match(reply.content, /24 hours prior/i);
    assert.ok(Array.isArray(reply.buttons));
    assert.ok(reply.buttons.some(b => b.includes("Follow-Up Slot") || b.includes("Book")));
  });

  it("6. Asks for Name, Age, and Symptoms before offering slots on booking inquiry", async () => {
    const db = getDb();
    const reply = await processBotActionOrQuery(
      "I want an appointment",
      patientPhone,
      "Test Patient",
      {},
      db,
      { tenantId }
    );

    assert.ok(reply, "Should return an intake prompt");
    assert.match(reply.content, /Pre-Consultation Intake|Patient Name|Age|issue or symptoms/i);
    assert.ok(Array.isArray(reply.buttons));
    assert.ok(reply.buttons.some(b => b.includes("Skip")));
  });

  it("7. Parses patient intake (name, age, issue), recommends matching specialist, and offers slots", async () => {
    const db = getDb();
    const fakeConv = { id: "conv-test-intake", tags: '["awaiting_intake"]' };
    const reply = await processBotActionOrQuery(
      "Ravee, 42, severe back pain and stiffness",
      patientPhone,
      "Test Patient",
      fakeConv,
      db,
      { tenantId }
    );

    assert.ok(reply, "Should process intake and return slots");
    assert.match(reply.content, /Available OPD Consultation Slots/i);
    assert.match(reply.content, /Dr\. Siddharth Verma|Physiotherapy/i);
    assert.ok(Array.isArray(reply.buttons));
    assert.ok(reply.buttons.some(b => b.includes("Book")));
  });

  it("8. Offers available slots even when patient omits info or sends Skip", async () => {
    const db = getDb();
    const fakeConv = { id: "conv-test-skip", tags: '["awaiting_intake"]' };
    const reply = await processBotActionOrQuery(
      "Skip",
      patientPhone,
      "Test Patient",
      fakeConv,
      db,
      { tenantId }
    );

    assert.ok(reply, "Should still return available slots when skipped");
    assert.match(reply.content, /Available OPD Consultation Slots/i);
    assert.ok(Array.isArray(reply.buttons));
    assert.ok(reply.buttons.some(b => b.includes("Book")));
  });

  it("9. Greets registered patient recognized from DB by first name (e.g. Ravee)", async () => {
    const db = getDb();
    // Update or ensure registered patient with name 'Ravee' exists for patientPhone
    db.prepare("UPDATE patients SET name = 'Ravee' WHERE phone = ?").run(patientPhone);

    const reply = await processBotActionOrQuery(
      "Hi",
      patientPhone,
      "Patient (+919999973271)",
      {},
      db,
      { tenantId }
    );

    assert.ok(reply);
    assert.match(reply.content, /Hello Ravee!/);
    assert.match(reply.content, /Welcome to/);
    assert.match(reply.content, /How may I help you today\?/);
    assert.ok(Array.isArray(reply.buttons));
  });

  it("10. Greets unregistered/new user with introduction (Thank you for contacting...)", async () => {
    const db = getDb();
    const newPhone = "+919888800000";

    const reply = await processBotActionOrQuery(
      "Hi",
      newPhone,
      `Patient (${newPhone})`,
      {},
      db,
      { tenantId }
    );

    assert.ok(reply);
    assert.match(reply.content, /Hello! 🙏 Thank you for contacting/i);
    assert.match(reply.content, /how may I help you today\?/i);
    assert.doesNotMatch(reply.content, /Patient \(/);
    assert.ok(Array.isArray(reply.buttons));
  });

  it("11. Provides contextual response for clinic location and directions", async () => {
    const db = getDb();
    const reply = await processBotActionOrQuery(
      "Where is the clinic located?",
      patientPhone,
      "Ravee",
      {},
      db,
      { tenantId }
    );

    assert.ok(reply);
    assert.match(reply.content, /Location & Directions/i);
    assert.match(reply.content, /Address/i);
    assert.match(reply.content, /Google Maps/i);
    assert.ok(Array.isArray(reply.buttons));
  });

  it("12. Provides contextual response for clinic timings and consultation fees", async () => {
    const db = getDb();
    const timingReply = await processBotActionOrQuery(
      "What are the working hours?",
      patientPhone,
      "Ravee",
      {},
      db,
      { tenantId }
    );
    assert.ok(timingReply);
    assert.match(timingReply.content, /Working & OPD Hours/i);

    const feeReply = await processBotActionOrQuery(
      "What is the consultation fee?",
      patientPhone,
      "Ravee",
      {},
      db,
      { tenantId }
    );
    assert.ok(feeReply);
    assert.match(feeReply.content, /Consultation Fee Schedule/i);
    assert.match(feeReply.content, /UPI/i);
  });

  it("13. Provides contextual response for insurance/TPA and emergency", async () => {
    const db = getDb();
    const insuranceReply = await processBotActionOrQuery(
      "Do you support Star Health insurance?",
      patientPhone,
      "Ravee",
      {},
      db,
      { tenantId }
    );
    assert.ok(insuranceReply);
    assert.match(insuranceReply.content, /Insurance & Cashless Desk/i);
    assert.match(insuranceReply.content, /TPA Support/i);

    const emergencyReply = await processBotActionOrQuery(
      "Emergency, need urgent ambulance",
      patientPhone,
      "Ravee",
      {},
      db,
      { tenantId }
    );
    assert.ok(emergencyReply);
    assert.match(emergencyReply.content, /EMERGENCY MEDICAL NOTICE/i);
    assert.match(emergencyReply.content, /108|112/);
  });

  it("14. Fallback states bot does not have answer to specific question and provides capability list", async () => {
    const db = getDb();
    // A specific query with no medical/clinical match
    const reply = await processBotActionOrQuery(
      "Can I park a helicopter on the roof?",
      patientPhone,
      "Ravee",
      {},
      db,
      { tenantId }
    );

    assert.ok(reply);
    assert.match(reply.content, /I do not have an answer to that specific question right now/i);
    assert.match(reply.content, /Here is what I can help you with 24\/7/i);
    assert.match(reply.content, /Doctor Appointments/i);
    assert.match(reply.content, /Doctor Schedule/i);
    assert.match(reply.content, /Prescriptions/i);
    assert.ok(Array.isArray(reply.buttons));
  });

  it("15. Fallback for new user does not leak placeholder name and lists capabilities", async () => {
    const db = getDb();
    const newPhone = "+919888800000";

    const reply = await processBotActionOrQuery(
      "Can I park a helicopter on the roof?",
      newPhone,
      `Patient (${newPhone})`,
      {},
      db,
      { tenantId }
    );

    assert.ok(reply);
    assert.match(reply.content, /Hello! 🙏 I do not have an answer to that specific question right now/i);
    assert.match(reply.content, /Here is what I can help you with 24\/7/i);
    assert.doesNotMatch(reply.content, /Patient \(/);
    assert.ok(Array.isArray(reply.buttons));
  });
});

