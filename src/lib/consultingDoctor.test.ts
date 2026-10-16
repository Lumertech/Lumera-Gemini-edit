import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Doctor } from "../types";
import { resolveConsultingDoctor } from "./consultingDoctor";

function doctor(id: string, name: string, fee = 700): Doctor {
  return {
    id,
    userId: `user-${id}`,
    name,
    qualification: "MBBS",
    regNumber: "REG",
    specialty: "General Medicine",
    experienceYears: 4,
    consultationFee: fee,
    opdRoom: "1",
    availableDays: ["Mon"],
    opdTiming: "09:00-13:00",
    phone: "",
    email: "",
    hprId: "",
    active: true,
    slotDurationMinutes: 15,
    rxTemplate: "classic",
  };
}

describe("consulting doctor resolution", () => {
  const ananya = doctor("doc-ananya", "Dr. Ananya Sen", 800);
  const meera = doctor("doc-meera", "Dr. Meera Iyer", 900);

  it("uses the visit doctor from the roster, then the appointment name", () => {
    const matched = resolveConsultingDoctor({
      appointment: { doctorId: "doc-ananya", doctorName: "Someone Else", consultationFee: 1 },
      doctors: [meera, ananya],
    });
    assert.equal(matched.doctor?.id, "doc-ananya");
    assert.equal(matched.doctor?.name, "Dr. Ananya Sen");
    assert.equal(matched.doctor?.consultationFee, 800);
    assert.equal(matched.needsChoice, false);

    const named = resolveConsultingDoctor({
      appointment: { doctorId: "missing", doctorName: "Dr. Ananya Sen", consultationFee: 650, specialty: "Pediatrics" },
      doctors: [meera],
    });
    assert.equal(named.doctor?.id, "");
    assert.equal(named.doctor?.name, "Dr. Ananya Sen");
    assert.equal(named.doctor?.consultationFee, 650);
    assert.equal(named.doctor?.specialty, "Pediatrics");
  });

  it("uses the only clinic doctor when there is no visit, and asks when there are several", () => {
    const only = resolveConsultingDoctor({ appointment: null, doctors: [ananya] });
    assert.equal(only.doctor?.id, "doc-ananya");
    assert.equal(only.needsChoice, false);

    const several = resolveConsultingDoctor({ appointment: null, doctors: [ananya, meera] });
    assert.equal(several.doctor, null);
    assert.equal(several.needsChoice, true);
    assert.equal(several.canChoose, true);

    const picked = resolveConsultingDoctor({
      appointment: null,
      doctors: [ananya, meera],
      selectedDoctorId: "doc-meera",
    });
    assert.equal(picked.doctor?.name, "Dr. Meera Iyer");
    assert.equal(picked.needsChoice, false);
    assert.equal(picked.canChoose, true);
  });
});
