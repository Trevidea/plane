import type { IRosterPlayer, IRosterPlayerPayload } from "@plane/types";
import { ROSTER_HEADER_MAP } from "../constants/roster.constants";

export const IMPORT_FIELDS = [
  ["player_name", "Full name"],
  ["first_name", "First name"],
  ["last_name", "Last name"],
  ["email", "Email (optional)"],
  ["jersey_number", "Jersey #"],
  ["position", "Position"],
  ["class_year", "Grad year / Class"],
  ["height", "Height"],
  ["weight", "Weight"],
  ["status", "Status"],
  ["notes", "Notes"],
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number][0];
export type RosterMapping = Record<string, ImportField | "">;
const normalize = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
const headerKey = (value: string) => normalize(value).replace(/[^a-z0-9]/g, "");

export const suggestRosterMapping = (headers: string[]): RosterMapping => {
  const aliases: Record<string, readonly string[]> = {
    ...ROSTER_HEADER_MAP,
    player_name: [...ROSTER_HEADER_MAP.player_name, "full name", "athlete name"],
    first_name: ["first name", "first", "given name"],
    last_name: ["last name", "last", "surname", "family name"],
    class_year: [...ROSTER_HEADER_MAP.class_year, "grad year", "graduation year", "graduating class", "class of"],
  };
  const used = new Set<string>();
  return Object.fromEntries(
    headers.map((header) => {
      const field = Object.keys(aliases).find(
        (key) => !used.has(key) && aliases[key].some((alias) => headerKey(alias) === headerKey(header))
      ) as ImportField | undefined;
      if (field) used.add(field);
      return [header, field ?? ""];
    })
  );
};

export const getMappingErrors = (mapping: RosterMapping): string[] => {
  const fields = Object.values(mapping).filter(Boolean);
  const errors: string[] = [];
  if (!fields.includes("player_name") && !(fields.includes("first_name") && fields.includes("last_name")))
    errors.push("Map a full name column, or both first name and last name columns.");
  if (new Set(fields).size !== fields.length) errors.push("Each roster field can only be mapped once.");
  if (fields.includes("player_name") && (fields.includes("first_name") || fields.includes("last_name")))
    errors.push("Use either full name or first and last name; set the other columns to Don't import.");
  return errors;
};

export const mapRosterColumns = (rows: Record<string, unknown>[], mapping: RosterMapping): IRosterPlayerPayload[] =>
  rows.map((row) => {
    const values: Partial<Record<ImportField, string>> = {};
    Object.entries(mapping).forEach(([column, field]) => {
      if (field) values[field] = String(row[column] ?? "").trim();
    });
    const { first_name, last_name, ...payload } = values;
    return {
      ...payload,
      player_name: values.player_name ?? [first_name, last_name].filter(Boolean).join(" "),
      email: normalize(values.email) || null,
      status: (!values.status || normalize(values.status) === "injured"
        ? "active"
        : normalize(values.status)) as IRosterPlayerPayload["status"],
    };
  });

export const validateRosterImport = (
  rows: IRosterPlayerPayload[],
  existing: Pick<
    IRosterPlayer,
    "player_name" | "email" | "jersey_number" | "class_year" | "status" | "account_email" | "user"
  >[],
  excluded = new Set<number>()
): { errors: string[]; warnings: string[] }[] =>
  rows.map((row, index) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (excluded.has(index)) return { errors, warnings };
    if (!row.player_name.trim()) errors.push("Player name is required.");
    const limits = {
      player_name: 255,
      email: 254,
      jersey_number: 20,
      position: 50,
      height: 50,
      weight: 50,
      class_year: 50,
    };
    Object.entries(limits).forEach(([field, limit]) => {
      if (String(row[field as keyof IRosterPlayerPayload] ?? "").trim().length > limit)
        errors.push(
          `${IMPORT_FIELDS.find(([key]) => key === field)?.[1] ?? field} must be ${limit} characters or fewer.`
        );
    });
    const email = normalize(row.email);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Enter a valid email address.");
    if (row.status && !["active", "inactive"].includes(row.status)) errors.push("Status must be active or inactive.");
    const otherRows = rows.filter((_, i) => i !== index && !excluded.has(i));
    const roster = existing.filter((player) => player.status !== "removed");
    if (email && otherRows.some((other) => normalize(other.email) === email))
      errors.push("Duplicate email in this file.");
    if (
      email &&
      roster.some(
        (other) => normalize(other.email) === email || (other.user && normalize(other.account_email) === email)
      )
    )
      errors.push("Email already exists on this roster.");
    const jersey = normalize(row.jersey_number);
    if (jersey && row.status !== "inactive") {
      if (otherRows.some((other) => other.status !== "inactive" && normalize(other.jersey_number) === jersey))
        errors.push("Jersey number is repeated in this file.");
      if (roster.some((other) => other.status !== "inactive" && normalize(other.jersey_number) === jersey))
        errors.push("Jersey number already exists on this roster.");
    }
    const sameIdentity = (other: { player_name: string; class_year?: string | null }) =>
      normalize(row.player_name) &&
      normalize(row.class_year) &&
      normalize(other.player_name) === normalize(row.player_name) &&
      normalize(other.class_year) === normalize(row.class_year);
    if (otherRows.some(sameIdentity) || roster.some(sameIdentity))
      warnings.push("Possible duplicate: same name and grad year. Check before importing.");
    return { errors, warnings };
  });
