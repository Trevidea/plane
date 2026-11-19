"use client";

import { useState } from "react";
import Image from "next/image";
import { Download } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IRosterPlayer } from "@plane/types";
import { CustomMenu } from "@plane/ui";
import { rosterToCSV, rosterToSpreadsheetRows } from "../utils/roster-presentation";

export const RosterExportDropdown = ({ players, projectId }: { players: IRosterPlayer[]; projectId: string }) => {
  const [busy, setBusy] = useState(false);
  const exportRoster = async (format: "xlsx" | "csv") => {
    if (busy) return;
    setBusy(true);
    try {
      if (format === "xlsx") {
        const xlsxModule = await import("xlsx");
        const XLSX = "default" in xlsxModule ? xlsxModule.default : xlsxModule;
        const book = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rosterToSpreadsheetRows(players)), "Roster");
        XLSX.writeFile(book, `roster-${projectId}.xlsx`);
      } else {
        const url = URL.createObjectURL(
          new Blob(["\uFEFF", rosterToCSV(players)], { type: "text/csv;charset=utf-8;" })
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = `roster-${projectId}.csv`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Export failed",
        message: "Could not export the roster. Please try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <CustomMenu
      label={
        <span className="flex items-center gap-1.5">
          <Download className="size-3.5" />
          {busy ? "Exporting…" : "Export"}
        </span>
      }
      ariaLabel="Export roster"
      disabled={!players.length || busy}
      placement="bottom-end"
      buttonClassName="h-7 text-xs"
      optionsClassName="min-w-44"
      closeOnSelect
    >
      <CustomMenu.MenuItem onClick={() => void exportRoster("xlsx")} className="flex items-center gap-2">
        <Image src="/attachment/excel-icon.png" width={20} height={20} alt="" />
        Export as XLSX
      </CustomMenu.MenuItem>
      <CustomMenu.MenuItem onClick={() => void exportRoster("csv")} className="flex items-center gap-2">
        <Image src="/attachment/csv-icon.png" width={20} height={20} alt="" />
        Export as CSV
      </CustomMenu.MenuItem>
    </CustomMenu>
  );
};
