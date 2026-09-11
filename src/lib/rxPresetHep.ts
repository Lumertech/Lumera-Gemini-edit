import type { PrescribedExercise } from "../types";

export function clonePresetExercises(
  exercises: PrescribedExercise[] | undefined | null,
  stamp = Date.now()
): PrescribedExercise[] {
  if (!exercises?.length) return [];
  return exercises.map((exercise, index) => ({
    ...exercise,
    id: `hep-${stamp}-${index}`,
  }));
}

export function presetHepToastMessage(count: number): string {
  const noun = count === 1 ? "Exercise" : "Exercises";
  return `Preset Applied: ${count} ${noun} Added to HEP`;
}
