export const OFFICE_IDS = ["downtown-manhattan", "newark-nj"] as const;

export type OfficeId = (typeof OFFICE_IDS)[number];

export type Office = Readonly<{
  id: OfficeId;
  name: string;
  travelMinutesToOtherOffice: number;
}>;

export const OFFICES: readonly Office[] = [
  { id: "downtown-manhattan", name: "Downtown Manhattan", travelMinutesToOtherOffice: 35 },
  { id: "newark-nj", name: "Newark, NJ", travelMinutesToOtherOffice: 35 }
];

const designatedOfficeIds: Readonly<Record<string, OfficeId>> = {
  alex: "downtown-manhattan",
  sam: "downtown-manhattan",
  maya: "newark-nj"
};

const legacyOfficeIds: Readonly<Record<string, OfficeId>> = {
  "new-york-hq": "downtown-manhattan",
  "san-francisco-studio": "newark-nj"
};

export function officeById(id: OfficeId): Office {
  const office = OFFICES.find((candidate) => candidate.id === id);
  if (!office) throw new Error("Unknown office.");
  return office;
}

export function designatedOfficeFor(personId: string): Office {
  return officeById(designatedOfficeIds[personId] ?? "downtown-manhattan");
}

export function migrateOfficeId(value: unknown): unknown {
  return typeof value === "string" ? legacyOfficeIds[value] ?? value : value;
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
