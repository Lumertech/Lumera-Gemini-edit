import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApiRouter } from "./api.ts";
import { getDb, initDatabase } from "./db.ts";
import { jsonRequest, startTestServer } from "./test-http.ts";
import { DEMO_PASSWORD } from "../src/lib/demoAccounts.ts";
import { listTenantPatientsByPhone } from "./clinical.ts";
import {
  extractTargetProfileFromQuery,
  findRegisteredPatient,
  findRegisteredPatientsByPhone,
  processBotActionOrQuery,
} from "./whatsapp.ts";
import { bookWhatsAppAppointment } from "./whatsapp-calendar-booking.ts";

describe("Shared-mobile multi-profile recognition (Pets, Children, Family & Friends across API & WhatsApp)", () => {
  let port = 0;
  let close: (() => Promise<void>) | undefined;

  before(async () => {
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = "test-jwt-secret-shared-mobile-household";
    }
    try {
      getDb();
    } catch {
      initDatabase();
    }
    const server = await startTestServer((app) => {
      app.use("/api", createApiRouter());
    });
    port = server.port;
    close = server.close;
  });

  after(async () => {
    await close?.();
  });

  async function login(email: string) {
    const res = await jsonRequest(port, "POST", "/api/auth/login", {
      email,
      password: DEMO_PASSWORD,
      skipOtp: true,
    });
    assert.equal(res.status, 200, `Login failed for ${email}`);
    const token = String(res.json.token || "");
    return {
      token,
      auth: { Authorization: `Bearer ${token}` },
      user: res.json.user as { id: string; tenantId: string; role: string },
    };
  }

  it("allows 1 mobile number to register multiple pets, multiple children, and family/friends without overwriting", async () => {
    const vet = await login("veterinary@lumera.me");
    const stamp = Date.now().toString().slice(-5);
    const sharedOwnerPhone = `+91 97654 ${stamp}`;

    // 1. Register Pet #1 (Bruno Jr.) and Pet #2 (Mochi Jr.) on the exact same owner phone
    const pet1Res = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      {
        name: "Bruno Jr",
        age: 3,
        gender: "Male",
        phone: sharedOwnerPhone,
        species: "dog",
        breed: "Labrador",
        ownerName: "Rohan Mehta",
        relationshipToHolder: "Pet",
        primaryContactName: "Rohan Mehta",
      },
      vet.auth
    );
    assert.equal(pet1Res.status, 201);
    const pet1 = pet1Res.json.patient as { id: string; uhid: string; name: string; relationshipToHolder: string };
    assert.equal(pet1.relationshipToHolder, "Pet");

    const pet2Res = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      {
        name: "Mochi Jr",
        age: 1,
        gender: "Female",
        phone: sharedOwnerPhone,
        species: "cat",
        breed: "Persian",
        ownerName: "Rohan Mehta",
        relationshipToHolder: "Pet",
        primaryContactName: "Rohan Mehta",
      },
      vet.auth
    );
    assert.equal(pet2Res.status, 201);
    const pet2 = pet2Res.json.patient as { id: string; uhid: string; name: string };
    assert.notEqual(pet1.id, pet2.id, "2nd pet on same mobile must receive a distinct id");
    assert.notEqual(pet1.uhid, pet2.uhid, "2nd pet on same mobile must receive a distinct UHID");

    // Re-posting exact same name + species without createNewMember reuses existing chart
    const pet1Repeat = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      {
        name: "Bruno Jr",
        age: 3,
        gender: "Male",
        phone: sharedOwnerPhone,
        species: "dog",
        breed: "Labrador",
      },
      vet.auth
    );
    assert.equal((pet1Repeat.json.patient as { id: string }).id, pet1.id);

    const byPhone = await jsonRequest(
      port,
      "GET",
      `/api/patients/by-phone?phone=${encodeURIComponent(sharedOwnerPhone)}`,
      undefined,
      vet.auth
    );
    assert.equal(byPhone.status, 200);
    assert.equal(byPhone.json.count, 2);
    assert.equal(byPhone.json.sharedMobile, true);
    assert.equal(byPhone.json.primaryHolderName, "Rohan Mehta");

    // 2. Register 2 Sibling Children under 1 Parent Mobile in Pediatrics
    const pedia = await login("pediatrics@lumera.me");
    const sharedParentPhone = `+91 97653 ${stamp}`;

    const child1 = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      {
        name: "Aarav Kapoor",
        age: 6,
        gender: "Male",
        phone: sharedParentPhone,
        relationshipToHolder: "Child",
        primaryContactName: "Pooja Kapoor",
      },
      pedia.auth
    );
    const child2 = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      {
        name: "Anaya Kapoor",
        age: 2,
        gender: "Female",
        phone: sharedParentPhone,
        relationshipToHolder: "Child",
        primaryContactName: "Pooja Kapoor",
      },
      pedia.auth
    );
    assert.equal(child1.status, 201);
    assert.equal(child2.status, 201);
    assert.notEqual(
      (child1.json.patient as { id: string }).id,
      (child2.json.patient as { id: string }).id,
      "2nd child on parent's mobile must not overwrite 1st child"
    );

    const household = await jsonRequest(
      port,
      "GET",
      `/api/patients/household?patientId=${encodeURIComponent((child1.json.patient as { id: string }).id)}`,
      undefined,
      pedia.auth
    );
    assert.equal(household.status, 200);
    assert.equal(((household.json.patients || []) as unknown[]).length, 2);

    // 3. Register Self + Family Member + Friend on 1 Mobile in GP Clinic + PATCH relationship
    const gp = await login("doctor@lumera.me");
    const sharedFamilyPhone = `+91 97652 ${stamp}`;
    const selfRes = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      { name: "Devendra Joshi", age: 42, gender: "Male", phone: sharedFamilyPhone, relationshipToHolder: "Self" },
      gp.auth
    );
    const friendRes = await jsonRequest(
      port,
      "POST",
      "/api/patients",
      {
        name: "Karan Malhotra",
        age: 40,
        gender: "Male",
        phone: sharedFamilyPhone,
        relationshipToHolder: "Friend / Caregiver",
        primaryContactName: "Devendra Joshi",
        createNewMember: true,
      },
      gp.auth
    );
    assert.equal(selfRes.status, 201);
    assert.equal(friendRes.status, 201);
    const friendId = (friendRes.json.patient as { id: string }).id;
    assert.notEqual((selfRes.json.patient as { id: string }).id, friendId);

    const patchRes = await jsonRequest(
      port,
      "PATCH",
      `/api/patients/${friendId}`,
      { relationshipToHolder: "Family Member", primaryContactName: "Devendra Joshi" },
      gp.auth
    );
    assert.equal(patchRes.status, 200);
    assert.equal((patchRes.json.patient as { relationshipToHolder: string }).relationshipToHolder, "Family Member");

    // 4. Patient portal login sees shared-mobile household profiles for own verified phone ONLY
    const patLogin = await login("patient@lumera.me");
    const ownHousehold = await jsonRequest(port, "GET", "/api/patients/household", undefined, patLogin.auth);
    assert.equal(ownHousehold.status, 200);
    const ownNames = new Set(((ownHousehold.json.patients || []) as Array<{ name: string }>).map((p) => p.name));
    assert.ok(ownNames.has("Rajiv Saxena"));
    assert.ok(ownNames.has("Kamla Saxena"), "Seeded mother profile on Rajiv's phone should appear in household");
    assert.ok(ownNames.has("Amitabh Verma"), "Seeded friend profile on Rajiv's phone should appear in household");

    const crossPhoneDenied = await jsonRequest(
      port,
      "GET",
      `/api/patients/household?phone=${encodeURIComponent("+91 98400 12003")}`,
      undefined,
      patLogin.auth
    );
    assert.equal(crossPhoneDenied.status, 403);
  });

  it("WhatsApp receptionist bot prompts multi-pet picker, routes named pet bookings, and creates new friend/pet profiles in EN, HI & MR", async () => {
    const db = getDb();
    const vetTenant = "tenant-demo-veterinary";
    const rahulPhone = "+91 98201 44550";

    // Backwards-compatible findRegisteredPatient vs multi-profile findRegisteredPatientsByPhone
    const single = findRegisteredPatient(db, rahulPhone, vetTenant);
    assert.ok(single?.id, "findRegisteredPatient must remain backwards-compatible");
    const allRahul = findRegisteredPatientsByPhone(db, rahulPhone, vetTenant);
    assert.ok(allRahul.length >= 3, `Expected >= 3 profiles on Rahul's mobile, got ${allRahul.length}`);

    // Clear transient picker tags on Rahul's seeded conversation before testing interactive bot turns
    db.prepare("UPDATE whatsapp_conversations SET tags = '[]', preferred_language = 'en' WHERE tenant_id = ? AND patient_phone = ?").run(
      vetTenant,
      rahulPhone
    );

    // 1. Ambiguous "📅 Book Appointment" on multi-pet phone prompts localized picker (English)
    const promptEn = await processBotActionOrQuery(
      "📅 Book Appointment",
      rahulPhone,
      "Rahul Verma",
      {},
      db,
      { tenantId: vetTenant }
    );
    assert.match(promptEn.content, /Bruno/);
    assert.match(promptEn.content, /Mochi/);
    assert.ok(Array.isArray(promptEn.buttons) && promptEn.buttons.length >= 2);
    for (const btn of promptEn.buttons!) {
      assert.ok(btn.length <= 20, `WhatsApp button label exceeds 20 chars: "${btn}"`);
    }

    // 2. Selecting "Mochi" on the next turn books directly for Mochi (vet-pat-mochi) without overwriting Bruno!
    const pickMochi = await processBotActionOrQuery(
      "Mochi",
      rahulPhone,
      "Rahul Verma",
      {},
      db,
      { tenantId: vetTenant }
    );
    assert.match(pickMochi.content, /Mochi/);
    assert.match(pickMochi.content, /Confirmed|Appointment/i);
    const mochiApt = db
      .prepare("SELECT patient_id, patient_name FROM appointments WHERE tenant_id = ? AND patient_id = 'vet-pat-mochi' ORDER BY created_at DESC LIMIT 1")
      .get(vetTenant) as { patient_id: string; patient_name: string } | undefined;
    assert.equal(mochiApt?.patient_id, "vet-pat-mochi");

    // 3. Direct named query ("Book appointment for Coco") skips ambiguity and books Coco directly
    db.prepare("UPDATE whatsapp_conversations SET tags = '[]' WHERE tenant_id = ? AND patient_phone = ?").run(
      vetTenant,
      rahulPhone
    );
    const directCoco = await processBotActionOrQuery(
      "Book appointment for Coco",
      rahulPhone,
      "Rahul Verma",
      {},
      db,
      { tenantId: vetTenant }
    );
    assert.match(directCoco.content, /Coco/);
    assert.match(directCoco.content, /Confirmed|Appointment/i);

    // 4. Ambiguous multi-pet picker in Hindi & Marathi (<= 20 UTF-16 chars, zero Latin letters)
    db.prepare("UPDATE whatsapp_conversations SET tags = '[]', preferred_language = 'hi' WHERE tenant_id = ? AND patient_phone = ?").run(
      vetTenant,
      rahulPhone
    );
    const promptHi = await processBotActionOrQuery(
      "अपॉइंटमेंट बुक करें",
      rahulPhone,
      "Rahul Verma",
      {},
      db,
      { tenantId: vetTenant }
    );
    assert.match(promptHi.content, /प्रोफ़ाइल|किसके/);
    assert.ok(promptHi.buttons?.every((b) => b.length <= 20 && !/[A-Za-z]/.test(b)));

    db.prepare("UPDATE whatsapp_conversations SET tags = '[]', preferred_language = 'mr' WHERE tenant_id = ? AND patient_phone = ?").run(
      vetTenant,
      rahulPhone
    );
    const promptMr = await processBotActionOrQuery(
      "अपॉइंटमेंट बुक करा",
      rahulPhone,
      "Rahul Verma",
      {},
      db,
      { tenantId: vetTenant }
    );
    assert.match(promptMr.content, /प्रोफाइल|कोणासाठी/);
    assert.ok(promptMr.buttons?.every((b) => b.length <= 20 && !/[A-Za-z]/.test(b)));

    // 5. Explicit new friend / pet extraction & booking in English, Hindi, and Marathi
    constgpCheck: {
      const gpTenant = "tenant-demo-individual";
      const rajivPhone = "+91 98111 01061";
      const gpProfiles = findRegisteredPatientsByPhone(db, rajivPhone, gpTenant);

      const enFriend = extractTargetProfileFromQuery("Book appointment for my friend Karan", gpProfiles);
      assert.equal(enFriend.newMember?.name, "Karan");
      assert.equal(enFriend.newMember?.relationshipToHolder, "Friend / Caregiver");

      const hiFriend = extractTargetProfileFromQuery("मेरे दोस्त रोहन के लिए अपॉइंटमेंट बुक करें", gpProfiles);
      assert.ok(hiFriend.newMember?.name);
      assert.equal(hiFriend.newMember?.relationshipToHolder, "Friend / Caregiver");

      const mrPet = extractTargetProfileFromQuery("माझ्या कुत्र्यासाठी शेरू अपॉइंटमेंट बुक करा", allRahul);
      assert.ok(mrPet.newMember?.name);
      assert.equal(mrPet.newMember?.relationshipToHolder, "Pet");

      // Live WhatsApp booking for a brand-new friend on Rajiv's phone creates a distinct chart
      const beforeCount = listTenantPatientsByPhone(gpTenant, rajivPhone).length;
      db.prepare("UPDATE whatsapp_conversations SET tags = '[]', preferred_language = 'en' WHERE tenant_id = ? AND patient_phone = ?").run(
        gpTenant,
        rajivPhone
      );
      const bookedFriend = bookWhatsAppAppointment({
        tenantId: gpTenant,
        patientPhone: rajivPhone,
        patientName: "Siddharth Rao",
        createNewMember: true,
        relationshipToHolder: "Friend / Caregiver",
        primaryContactName: "Rajiv Saxena",
      });
      assert.equal(bookedFriend.patient.name, "Siddharth Rao");
      assert.notEqual(bookedFriend.patient.id, "ind-pat-rajiv");
      assert.equal(bookedFriend.appointment.patientId, bookedFriend.patient.id);
      const afterCount = listTenantPatientsByPhone(gpTenant, rajivPhone).length;
      assert.equal(afterCount, beforeCount + 1, "Booking for friend on shared phone must add a separate patient row");
      break constgpCheck;
    }
  });
});
