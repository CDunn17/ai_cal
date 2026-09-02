export const OFFICE_IDS = ["new-york-hq", "san-francisco-studio"] as const;

export type OfficeId = (typeof OFFICE_IDS)[number];

export type Office = Readonly<{
  id: OfficeId;
  name: string;
  travelMinutesToOtherOffice: number;
}>;

export const OFFICES: readonly Office[] = [
  { id: "new-york-hq", name: "New York HQ", travelMinutesToOtherOffice: 330 },
  { id: "san-francisco-studio", name: "San Francisco Studio", travelMinutesToOtherOffice: 330 }
];

const designatedOfficeIds: Readonly<Record<string, OfficeId>> = {
  alex: "new-york-hq",
  sam: "new-york-hq",
  maya: "san-francisco-studio"
};

export function officeById(id: OfficeId): Office {
  const office = OFFICES.find((candidate) => candidate.id === id);
  if (!office) throw new Error("Unknown office.");
  return office;
}

export function designatedOfficeFor(personId: string): Office {
  return officeById(designatedOfficeIds[personId] ?? "new-york-hq");
}

export function travelMinutesBetween(from: OfficeId, to: OfficeId): number {
  return from === to ? 0 : officeById(from).travelMinutesToOtherOffice;
}

export function formatTravelMinutes(minutes: number): string {
  if (minutes < 60) return minutes + " min";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? hours + " hr" : hours + " hr " + remainder + " min";
}
