"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { AlertTriangle, Check, FileSpreadsheet, Upload, X } from "lucide-react";
import { Button } from "@plane/propel/button";
import type { IRosterPlayerPayload } from "@plane/types";
import { cn, CustomMenu, EModalPosition, EModalWidth, Input, ModalCore } from "@plane/ui";
import { useRoster } from "../store/roster-context";
import {
  getMappingErrors,
  IMPORT_FIELDS,
  mapRosterColumns,
  suggestRosterMapping,
  validateRosterImport,
} from "../utils/roster-import-review";
import type { ImportField, RosterMapping } from "../utils/roster-import-review";

const inputClass =
  "rounded-md border border-custom-border-200 bg-custom-background-100 px-2.5 py-2 text-sm text-custom-text-100 focus:border-custom-primary-100 focus:outline-none disabled:opacity-50";
const ImportFieldDropdown = ({
  value,
  label,
  ariaLabel,
  options,
  onChange,
  disabled = false,
  hasError = false,
}: {
  value: string;
  label: string;
  ariaLabel: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  hasError?: boolean;
}) => (
  <CustomMenu
    label={<span className="min-w-0 truncate">{label}</span>}
    ariaLabel={`${ariaLabel}: ${label}`}
    className="w-full"
    buttonClassName={cn(
      "w-full justify-between rounded-md border border-custom-border-200 bg-custom-background-100 px-2.5 py-2 text-sm text-custom-text-100",
      hasError && "!border-amber-500/70"
    )}
    optionsClassName="min-w-52 max-w-[calc(100vw-2rem)]"
    menuItemsClassName="z-50"
    maxHeight="rg"
    placement="bottom-end"
    portalElement={typeof document !== "undefined" ? document.body : null}
    closeOnSelect
    disabled={disabled}
  >
    {options.map((option) => (
      <CustomMenu.MenuItem
        key={option.value}
        onClick={() => onChange(option.value)}
        className="flex items-center justify-between gap-3"
      >
        <span className="truncate">{option.label}</span>
        {option.value === value && <Check className="size-3.5 shrink-0 text-custom-primary-100" aria-hidden="true" />}
      </CustomMenu.MenuItem>
    ))}
  </CustomMenu>
);

const reviewFields: { key: keyof IRosterPlayerPayload; label: string }[] = [
  { key: "player_name", label: "Player name" },
  { key: "jersey_number", label: "Jersey #" },
  { key: "position", label: "Position" },
  { key: "class_year", label: "Grad year / Class" },
  { key: "email", label: "Email" },
  { key: "status", label: "Status" },
  { key: "height", label: "Height" },
  { key: "weight", label: "Weight" },
  { key: "notes", label: "Notes" },
];

type Filter = "all" | "ready" | "warning" | "error" | "excluded";

export const ImportRosterModal = observer(({ isOpen, onClose }: { isOpen?: boolean; onClose?: () => void }) => {
  const {
    isImportRosterModalOpen,
    isSubmitting,
    closeImportRosterModal,
    importPlayers,
    pendingImportFile,
    setPendingImportFile,
    allPlayers,
    canManage,
  } = useRoster();
  const modalOpen = isOpen ?? isImportRosterModalOpen;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const parseVersion = useRef(0);
  const [step, setStep] = useState(1);
  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<RosterMapping>({});
  const [rows, setRows] = useState<IRosterPlayerPayload[]>([]);
  const [excluded, setExcluded] = useState(new Set<number>());
  const [differentPeople, setDifferentPeople] = useState(new Set<number>());
  const [filter, setFilter] = useState<Filter>("all");
  const [parseError, setParseError] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const reset = useCallback(() => {
    parseVersion.current += 1;
    setStep(1);
    setFileName("");
    setRawRows([]);
    setHeaders([]);
    setMapping({});
    setRows([]);
    setExcluded(new Set());
    setDifferentPeople(new Set());
    setFilter("all");
    setParseError("");
    setIsParsing(false);
    setIsDragging(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);
  const handleClose = () => {
    if (isSubmitting) return;
    reset();
    (onClose ?? closeImportRosterModal)();
  };

  useEffect(() => {
    if (!modalOpen) reset();
    return () => {
      parseVersion.current += 1;
    };
  }, [modalOpen, reset]);

  const parseFile = useCallback(
    async (file: File) => {
      reset();
      const version = ++parseVersion.current;
      setFileName(file.name);
      setIsParsing(true);
      try {
        if (!/\.(csv|xlsx)$/i.test(file.name)) throw new Error("Choose a .csv or .xlsx file.");
        const xlsxModule = await import("xlsx");
        const XLSX = "default" in xlsxModule ? xlsxModule.default : xlsxModule;
        const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!sheet) throw new Error("The file does not contain a readable sheet.");
        const grid = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "", raw: false });
        const firstRow = grid.findIndex((row) => row.some((value) => String(value).trim()));
        if (firstRow < 0) throw new Error("The selected file is empty.");
        const columns = grid[firstRow].map((value, index) => String(value).trim() || `Column ${index + 1}`);
        if (new Set(columns).size !== columns.length)
          throw new Error("Column headers must be unique. Rename duplicate headers and choose the file again.");
        const data = grid
          .slice(firstRow + 1)
          .filter((row) => row.some((value) => String(value).trim()))
          .map((row) => Object.fromEntries(columns.map((column, index) => [column, row[index] ?? ""])));
        if (!data.length) throw new Error("No player rows were found below the header row.");
        if (version !== parseVersion.current) return;
        setHeaders(columns);
        setRawRows(data);
        setMapping(suggestRosterMapping(columns));
      } catch (error) {
        if (version === parseVersion.current)
          setParseError(error instanceof Error ? error.message : "The file could not be read.");
      } finally {
        if (version === parseVersion.current) setIsParsing(false);
      }
    },
    [reset]
  );

  useEffect(() => {
    if (modalOpen && pendingImportFile) {
      void parseFile(pendingImportFile);
      setPendingImportFile(null);
    }
  }, [modalOpen, pendingImportFile, parseFile, setPendingImportFile]);

  const validation = validateRosterImport(rows, allPlayers, excluded);
  const visibleReviewFields = reviewFields.filter(
    (field) =>
      ["player_name", "jersey_number", "position", "class_year", "email"].includes(field.key) ||
      Object.values(mapping).includes(field.key as ImportField)
  );
  const hasDuplicate = (index: number) =>
    validation[index].warnings.length > 0 ||
    validation[index].errors.some((error) => /duplicate|repeated|already exists/i.test(error));
  const mappingErrors = getMappingErrors(mapping);
  const includedCount = rows.length - excluded.size;
  const errorCount = validation.filter((result) => result.errors.length).length;
  const warningCount = validation.filter(
    (result, index) => hasDuplicate(index) && (result.errors.length > 0 || !differentPeople.has(index))
  ).length;
  const readyCount = validation.filter(
    (result, index) =>
      !excluded.has(index) && !result.errors.length && (!result.warnings.length || differentPeople.has(index))
  ).length;
  const unresolvedDuplicates = validation.filter(
    (result, index) => result.warnings.length > 0 && !excluded.has(index) && !differentPeople.has(index)
  ).length;
  const canImport = canManage && includedCount > 0 && errorCount === 0 && unresolvedDuplicates === 0 && !isSubmitting;
  const showRow = (index: number) =>
    filter === "all" ||
    (filter === "excluded"
      ? excluded.has(index)
      : !excluded.has(index) &&
        (filter === "error"
          ? validation[index].errors.length > 0
          : filter === "warning"
            ? hasDuplicate(index) && (validation[index].errors.length > 0 || !differentPeople.has(index))
            : !validation[index].errors.length && (!validation[index].warnings.length || differentPeople.has(index))));
  const summary: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "All rows", count: rows.length },
    { key: "ready", label: "Ready to import", count: readyCount },
    { key: "warning", label: "Duplicates to review", count: warningCount },
    { key: "error", label: "Need a fix", count: errorCount },
    { key: "excluded", label: "Excluded", count: excluded.size },
  ];

  return (
    <ModalCore
      isOpen={modalOpen}
      handleClose={handleClose}
      position={EModalPosition.TOP}
      width={EModalWidth.XXXXL}
      className="lg:max-w-6xl"
    >
      <div className="flex items-start justify-between gap-4 border-b border-custom-border-200 px-6 py-5">
        <div>
          <h3 className="text-lg font-semibold text-custom-text-100">Import roster</h3>
          <p className="mt-1 text-sm text-custom-text-300">
            Upload your file, map its columns, then review every player.
          </p>
        </div>
        <button
          type="button"
          aria-label="Close import roster modal"
          onClick={handleClose}
          disabled={isSubmitting}
          className="rounded p-1.5 text-custom-text-300 disabled:opacity-50"
        >
          <X className="size-4" />
        </button>
      </div>
      <ol className="flex gap-3 border-b border-custom-border-200 px-6 py-4" aria-label="Import progress">
        {["Upload file", "Map columns", "Review and import"].map((label, index) => (
          <li
            key={label}
            aria-current={step === index + 1 ? "step" : undefined}
            className={cn(
              "flex flex-1 items-center gap-2 text-xs sm:text-sm",
              step === index + 1 ? "font-semibold text-custom-text-100" : "text-custom-text-300"
            )}
          >
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs",
                step >= index + 1
                  ? "border-custom-primary-100 bg-custom-primary-100/10 text-custom-primary-100"
                  : "border-custom-border-200"
              )}
            >
              {step > index + 1 ? <Check className="size-3.5" /> : index + 1}
            </span>
            {label}
          </li>
        ))}
      </ol>
      <div className="max-h-[65vh] space-y-4 overflow-y-auto p-6">
        {step === 1 && (
          <>
            <div
              onDragOver={(event) => {
                event.preventDefault();
                if (!isSubmitting) setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                const file = event.dataTransfer.files[0];
                if (file && !isSubmitting) void parseFile(file);
              }}
              className={cn(
                "flex flex-col items-center rounded-xl border border-dashed px-5 py-9 text-center",
                isDragging
                  ? "border-custom-primary-100 bg-custom-primary-100/10"
                  : "border-custom-border-300 bg-custom-background-90"
              )}
            >
              <Upload className="mb-3 size-7 text-custom-text-300" />
              <h4 className="font-medium text-custom-text-100">Drop a CSV or Excel file here</h4>
              <p className="mt-1 text-sm text-custom-text-300">
                Use the first sheet, with column names in the first row.
              </p>
              <input
                aria-label="Roster file"
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx"
                className="hidden"
                disabled={isSubmitting}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) void parseFile(file);
                  event.currentTarget.value = "";
                }}
              />
              <Button
                variant="neutral-primary"
                size="sm"
                className="mt-4"
                onClick={() => fileInputRef.current?.click()}
                disabled={isSubmitting}
              >
                Choose file
              </Button>
              <a
                href="/templates/roster-template.xlsx"
                download
                className="mt-3 text-sm text-custom-primary-100 hover:underline"
              >
                Download roster template
              </a>
            </div>
            {fileName && (
              <div className="flex items-center gap-3 rounded-lg border border-custom-border-200 p-4">
                <FileSpreadsheet className="size-5 text-custom-text-300" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-custom-text-100">{fileName}</p>
                  <p className="mt-1 text-xs text-custom-text-300">
                    {isParsing ? "Reading file…" : `${rawRows.length} rows · ${headers.length} columns`}
                  </p>
                </div>
                <button type="button" aria-label="Remove file" onClick={reset} disabled={isSubmitting}>
                  <X className="size-4 text-custom-text-300" />
                </button>
              </div>
            )}
            {parseError && (
              <p role="alert" className="text-sm text-red-500">
                {parseError}
              </p>
            )}
            {!!rawRows.length && (
              <p className="rounded-lg bg-custom-background-90 p-3 text-sm text-custom-text-200">
                Recognized columns have been mapped for you. Check them on the next step.
              </p>
            )}
            <p className="text-xs leading-5 text-custom-text-300">
              Email is optional. Players use the team link to sign in or register, then wait for admin or coach approval
              before their account is linked to this program. Other email addresses may receive an invitation.
            </p>
          </>
        )}
        {step === 2 && (
          <>
            <p className="text-sm text-custom-text-300">
              Choose what each column contains. Map a full name, or both first and last name. Skip any columns you do
              not need.
            </p>
            <div className="overflow-x-auto rounded-lg border border-custom-border-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-custom-background-90 text-xs text-custom-text-300">
                  <tr>
                    <th className="p-3">Column in your file</th>
                    <th className="p-3">Example</th>
                    <th className="p-3">Roster field</th>
                  </tr>
                </thead>
                <tbody>
                  {headers.map((column) => (
                    <tr key={column} className="border-t border-custom-border-200">
                      <td className="p-3 font-medium text-custom-text-100">{column}</td>
                      <td className="max-w-48 truncate p-3 text-custom-text-300">
                        {String(rawRows.find((row) => row[column])?.[column] ?? "—")}
                      </td>
                      <td className="p-3">
                        <ImportFieldDropdown
                          value={mapping[column] ?? ""}
                          label={IMPORT_FIELDS.find(([key]) => key === mapping[column])?.[1] || "Don't import"}
                          ariaLabel={`Field for ${column}`}
                          options={[
                            { value: "", label: "Don't import" },
                            ...IMPORT_FIELDS.map(([value, label]) => ({ value, label })),
                          ]}
                          onChange={(field) =>
                            setMapping((current) => ({ ...current, [column]: field as ImportField | "" }))
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {mappingErrors.map((error) => (
              <p key={error} role="alert" className="text-sm text-red-500">
                {error}
              </p>
            ))}
            <p className="rounded-lg bg-custom-background-90 p-3 text-xs leading-5 text-custom-text-300">
              Grad year helps identify possible duplicate roster entries. Name and grad year are a review hint; they do
              not confirm an account match.
            </p>
          </>
        )}
        {step === 3 && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {summary.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  aria-pressed={filter === item.key}
                  onClick={() => setFilter(item.key)}
                  className={cn(
                    "rounded-lg border p-3 text-left",
                    filter === item.key
                      ? "border-custom-primary-100 bg-custom-primary-100/5"
                      : "border-custom-border-200"
                  )}
                >
                  <span
                    className={cn(
                      "block text-2xl font-semibold tabular-nums",
                      item.key === "error" && item.count
                        ? "text-red-500"
                        : item.key === "warning" && item.count
                          ? "text-amber-600"
                          : "text-custom-text-100"
                    )}
                  >
                    {item.count}
                  </span>
                  <span className="text-xs text-custom-text-300">{item.label}</span>
                </button>
              ))}
            </div>
            <p className="text-xs text-custom-text-300">
              Edit any cell to resolve issues. Excluded rows will not be imported. Review possible duplicates before
              continuing.
            </p>
            <div className="max-h-[46vh] overflow-y-auto rounded-lg border border-custom-border-200">
              <table className="w-full table-fixed text-left text-sm" aria-label="Roster import review">
                <thead className="sticky top-0 z-[1] bg-custom-background-90 text-xs text-custom-text-300">
                  <tr>
                    <th className="px-4 py-3 font-medium">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          Players · {rows.length} row{rows.length === 1 ? "" : "s"}
                        </span>
                        <span className="max-w-full truncate font-normal text-custom-text-400">{fileName}</span>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    if (!showRow(index)) return null;
                    const result = validation[index];
                    const isExcluded = excluded.has(index);
                    const needsReview =
                      !isExcluded &&
                      (result.errors.length > 0 || (result.warnings.length > 0 && !differentPeople.has(index)));
                    const renderField = (field: (typeof reviewFields)[number]) => {
                      const fieldWord =
                        field.key === "player_name"
                          ? "name"
                          : field.key === "jersey_number"
                            ? "jersey"
                            : field.key === "class_year"
                              ? "grad year"
                              : field.key;
                      const fieldErrors = result.errors.filter((error) => error.toLowerCase().includes(fieldWord));
                      const fieldId = `roster-import-field-${index}-${field.key}`;
                      const change = (value: string) => {
                        setDifferentPeople(new Set());
                        setRows((current) =>
                          current.map((item, i) => (i === index ? { ...item, [field.key]: value } : item))
                        );
                      };
                      return (
                        <div
                          key={field.key}
                          className={cn("min-w-0 space-y-1", field.key === "notes" && "sm:col-span-2 lg:col-span-3")}
                        >
                          <label htmlFor={fieldId} className="block text-[11px] font-medium text-custom-text-300">
                            {field.label}
                          </label>
                          {field.key === "status" ? (
                            <ImportFieldDropdown
                              value={row.status ?? "active"}
                              label={
                                row.status === "inactive"
                                  ? "Inactive"
                                  : row.status === "active"
                                    ? "Active"
                                    : row.status || "Active"
                              }
                              ariaLabel={`Status for row ${index + 2}`}
                              options={[
                                ...(row.status && !["active", "inactive"].includes(row.status)
                                  ? [{ value: row.status, label: row.status }]
                                  : []),
                                { value: "active", label: "Active" },
                                { value: "inactive", label: "Inactive" },
                              ]}
                              disabled={isSubmitting || isExcluded}
                              hasError={fieldErrors.length > 0}
                              onChange={change}
                            />
                          ) : (
                            <Input
                              id={fieldId}
                              inputSize="xs"
                              aria-label={`${field.label} for row ${index + 2}`}
                              value={row[field.key] ?? ""}
                              disabled={isSubmitting || isExcluded}
                              aria-invalid={fieldErrors.length > 0}
                              aria-describedby={
                                fieldErrors.length ? `${fieldId}-error` : `roster-import-review-${index}`
                              }
                              className={cn(
                                inputClass,
                                "w-full min-w-0",
                                fieldErrors.length > 0 && "!border-amber-500/70"
                              )}
                              onChange={(event) => change(event.target.value)}
                            />
                          )}
                          {fieldErrors.length > 0 && (
                            <p
                              id={`${fieldId}-error`}
                              className="break-words text-[11px] leading-4 text-amber-600 dark:text-amber-400"
                            >
                              {fieldErrors.join(" ")}
                            </p>
                          )}
                        </div>
                      );
                    };
                    return (
                      <tr key={index} className="border-t border-custom-border-200">
                        <td className="p-0">
                          <div
                            className={cn(
                              "min-w-0 space-y-3 p-4",
                              needsReview && "border-l-2 border-l-amber-500 bg-amber-500/5",
                              isExcluded && "bg-custom-background-90 opacity-60"
                            )}
                          >
                            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                              <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <span className="shrink-0 rounded border border-custom-border-200 px-1.5 py-0.5 text-[11px] text-custom-text-400">
                                  Row {index + 2}
                                </span>
                                <span className="min-w-0 break-words font-medium text-custom-text-100">
                                  {row.player_name || "Unnamed player"}
                                </span>
                                <span
                                  className={cn(
                                    "inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[11px]",
                                    needsReview
                                      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                      : "bg-custom-background-90 text-custom-text-300"
                                  )}
                                >
                                  {needsReview ? (
                                    <AlertTriangle className="size-3" />
                                  ) : !isExcluded ? (
                                    <Check className="size-3" />
                                  ) : null}
                                  {isExcluded ? "Excluded" : needsReview ? "Needs review" : "Ready to import"}
                                </span>
                              </div>
                              <Button
                                variant="neutral-primary"
                                size="sm"
                                disabled={isSubmitting}
                                onClick={() =>
                                  setExcluded((current) => {
                                    const next = new Set(current);
                                    if (next.has(index)) next.delete(index);
                                    else next.add(index);
                                    return next;
                                  })
                                }
                              >
                                {isExcluded ? "Restore" : "Exclude"}
                              </Button>
                            </div>
                            <div className="grid min-w-0 grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                              {visibleReviewFields
                                .filter((field) => !["height", "weight", "notes"].includes(field.key))
                                .map(renderField)}
                            </div>
                            {visibleReviewFields.some((field) => ["height", "weight", "notes"].includes(field.key)) && (
                              <details className="min-w-0 rounded-md border border-custom-border-200 px-3 py-2">
                                <summary className="cursor-pointer text-xs text-custom-text-300">
                                  Additional fields · height, weight and notes
                                </summary>
                                <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                  {visibleReviewFields
                                    .filter((field) => ["height", "weight", "notes"].includes(field.key))
                                    .map(renderField)}
                                </div>
                              </details>
                            )}
                            <div
                              id={`roster-import-review-${index}`}
                              aria-live="polite"
                              className="min-w-0 text-xs leading-5"
                            >
                              {isExcluded ? (
                                <p className="text-custom-text-400">This row will not be imported.</p>
                              ) : (
                                <>
                                  {result.errors.length > 0 && (
                                    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-amber-600 dark:text-amber-400">
                                      <p className="font-medium">Correct the highlighted fields</p>
                                      <ul className="mt-1 list-inside list-disc break-words">
                                        {result.errors.map((error) => (
                                          <li key={error}>{error}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                  {result.warnings.map((warning) => (
                                    <p key={warning} className="mt-1 break-words text-amber-600 dark:text-amber-400">
                                      {warning}
                                    </p>
                                  ))}
                                  {result.warnings.length > 0 && (
                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                      <Button
                                        variant="neutral-primary"
                                        size="sm"
                                        disabled={isSubmitting}
                                        onClick={() => {
                                          setExcluded((current) => new Set(current).add(index));
                                          setDifferentPeople(new Set());
                                        }}
                                      >
                                        Same person · exclude row
                                      </Button>
                                      <Button
                                        variant={differentPeople.has(index) ? "primary" : "neutral-primary"}
                                        size="sm"
                                        disabled={isSubmitting}
                                        aria-pressed={differentPeople.has(index)}
                                        onClick={() =>
                                          setDifferentPeople((current) => {
                                            const next = new Set(current);
                                            if (next.has(index)) next.delete(index);
                                            else next.add(index);
                                            return next;
                                          })
                                        }
                                      >
                                        Different person
                                      </Button>
                                      {differentPeople.has(index) && (
                                        <span className="text-custom-text-300">Reviewed as a separate player</span>
                                      )}
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length > 0 && !rows.some((_, index) => showRow(index)) && (
                <p role="status" className="px-4 py-6 text-center text-xs text-custom-text-400">
                  No rows in this category.
                </p>
              )}
            </div>
            {errorCount > 0 && (
              <p role="alert" className="text-sm text-red-500">
                Fix or exclude {errorCount} row{errorCount === 1 ? "" : "s"} before importing.
              </p>
            )}
            {unresolvedDuplicates > 0 && (
              <p role="alert" className="text-sm text-amber-600">
                Decide on {unresolvedDuplicates} possible duplicate{unresolvedDuplicates === 1 ? "" : "s"} before
                importing.
              </p>
            )}
            {includedCount === 0 && <p className="text-sm text-custom-text-300">Restore at least one row to import.</p>}
          </>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-custom-border-200 px-6 py-4">
        {step > 1 && (
          <Button
            variant="neutral-primary"
            size="sm"
            disabled={isSubmitting}
            onClick={() => setStep((current) => current - 1)}
          >
            Back
          </Button>
        )}
        <span className="flex-1" />
        <Button variant="neutral-primary" size="sm" onClick={handleClose} disabled={isSubmitting}>
          Cancel
        </Button>
        {step === 1 && (
          <Button variant="primary" size="sm" disabled={!rawRows.length || isParsing} onClick={() => setStep(2)}>
            Map columns
          </Button>
        )}
        {step === 2 && (
          <Button
            variant="primary"
            size="sm"
            disabled={mappingErrors.length > 0}
            onClick={() => {
              setRows(mapRosterColumns(rawRows, mapping));
              setExcluded(new Set());
              setDifferentPeople(new Set());
              setFilter("all");
              setStep(3);
            }}
          >
            Review rows
          </Button>
        )}
        {step === 3 && (
          <Button
            variant="primary"
            size="sm"
            className={!canImport ? "cursor-not-allowed opacity-50" : ""}
            disabled={!canImport}
            loading={isSubmitting}
            onClick={() => {
              if (canImport)
                void importPlayers(
                  rows
                    .filter((_, index) => !excluded.has(index))
                    .map((row) => ({
                      ...row,
                      player_name: row.player_name.trim(),
                      email: row.email?.trim().toLowerCase() || null,
                    }))
                );
            }}
          >
            Import {includedCount} player{includedCount === 1 ? "" : "s"}
          </Button>
        )}
      </div>
    </ModalCore>
  );
});
