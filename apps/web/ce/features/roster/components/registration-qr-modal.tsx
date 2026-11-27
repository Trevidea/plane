"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Ban, Copy, Globe, Info, Maximize2, Minimize2, QrCode, RefreshCw, X } from "lucide-react";
import { Dialog } from "@headlessui/react";
import { isAxiosError } from "axios";
import { Button, EModalWidth, Input, ModalCore } from "@plane/ui";
import { RosterService } from "@/services/roster.service";
import type { TRosterRegistration } from "@/services/roster.service";

const service = new RosterService();

export const RegistrationQRModal = ({
  workspaceSlug,
  projectId,
  onClose,
}: {
  workspaceSlug: string;
  projectId: string;
  onClose: () => void;
}) => {
  const [session, setSession] = useState<TRosterRegistration | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let active = true;
    void service
      .getRegistration(workspaceSlug, projectId)
      .then((value) => {
        if (active) setSession(value);
      })
      .catch(() => {
        if (active) setError("Unable to load registration. Close this window and try again.");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [workspaceSlug, projectId]);
  const remaining = session ? Math.max(0, Math.ceil((Date.parse(session.expires_at) - now) / 1000)) : 0;
  const active = Boolean(session && remaining > 0);
  const mutate = async (close: boolean) => {
    setBusy(true);
    setError("");
    setCopied(null);
    try {
      if (close) {
        await service.closeRegistration(workspaceSlug, projectId, session?.version);
        setSession(null);
      } else {
        setSession(await service.generateRegistration(workspaceSlug, projectId, active ? session?.version : "none"));
        setNow(Date.now());
      }
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 412) {
        try {
          setSession(await service.getRegistration(workspaceSlug, projectId));
          setNow(Date.now());
          setError("Registration changed in another window. Review the current invitation before updating it.");
        } catch {
          setError("Registration changed. Close and reopen this window before updating it.");
        }
      } else {
        setError("Unable to update registration. Check your roster and workspace permissions, then try again.");
      }
    } finally {
      setBusy(false);
    }
  };
  const copy = async (kind: "code" | "link", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      setError("");
    } catch {
      setError("Copy is unavailable. Select and copy the text.");
    }
  };
  let server = "";
  try {
    if (session) server = new URL(session.url).host;
  } catch {
    /* Keep invalid links visible for support. */
  }
  const expiry = session
    ? new Date(session.expires_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "";
  return (
    <ModalCore
      isOpen
      handleClose={() => {
        if (!busy) onClose();
      }}
      width={EModalWidth.XXL}
      className={expanded ? "sm:max-w-3xl" : ""}
    >
      <div className="flex items-start justify-between gap-4 border-b border-custom-border-200 px-5 py-4">
        <div>
          <Dialog.Title className="text-base font-semibold text-custom-text-100">Team join code</Dialog.Title>
          <p className="mt-1 text-xs leading-5 text-custom-text-300">
            Share the QR, short code or link so players can request to join this program.
          </p>
        </div>
        <Button
          unstyled
          type="button"
          disabled={busy}
          aria-label="Close QR window"
          onClick={onClose}
          className="rounded p-1 text-custom-text-300 hover:bg-custom-background-80"
        >
          <X className="size-4" />
        </Button>
      </div>
      <div className="space-y-5 p-5">
        {busy && (
          <p role="status" className="text-xs text-custom-text-300">
            Updating registration…
          </p>
        )}
        {active && session ? (
          <>
            <div className={`grid items-start gap-5 ${expanded ? "" : "sm:grid-cols-[180px_1fr]"}`}>
              <div data-support-private className="mx-auto max-w-full rounded-lg border border-custom-border-200 bg-white p-3">
                <QRCodeSVG
                  value={session.url}
                  size={expanded ? 288 : 156}
                  className="h-auto max-w-full"
                  marginSize={2}
                  title="Scan to sign up for this program"
                />
              </div>
              <div className="min-w-0 space-y-4">
                <div data-support-private>
                  <p className="text-xs text-custom-text-400">Program</p>
                  <p className="mt-1 text-sm font-medium text-custom-text-100">{session.program_name}</p>
                  <p className="mt-1 text-xs text-custom-text-300">{session.workspace_name}</p>
                </div>
                {session.short_code && (
                  <div>
                    <p className="text-xs text-custom-text-400">Short code</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <code data-support-private className="text-lg font-semibold text-custom-text-100">{session.short_code}</code>
                      <Button
                        variant="neutral-primary"
                        size="sm"
                        prependIcon={<Copy />}
                        onClick={() => void copy("code", session.short_code!)}
                      >
                        {copied === "code" ? "Code copied" : "Copy code"}
                      </Button>
                    </div>
                  </div>
                )}
                <div>
                  <label htmlFor="roster-registration-link" className="text-xs text-custom-text-300">
                    Join link
                  </label>
                  <div className="mt-1.5 flex gap-2">
                    <Input
                      id="roster-registration-link"
                      data-support-private
                      aria-label="Registration link"
                      readOnly
                      value={session.url}
                      className="min-w-0 flex-1 border-custom-border-200 bg-custom-background-90 text-xs"
                    />
                    <Button
                      variant="neutral-primary"
                      size="sm"
                      prependIcon={<Copy />}
                      onClick={() => void copy("link", session.url)}
                    >
                      {copied === "link" ? "Copied" : "Copy"}
                    </Button>
                  </div>
                </div>
                <div className="flex items-start gap-2 text-xs">
                  <Globe className="mt-0.5 size-3.5 shrink-0 text-custom-text-400" />
                  <div>
                    <p data-support-private className="break-all text-custom-text-200">{server}</p>
                    <p className="mt-1 text-custom-text-400">School server</p>
                  </div>
                </div>
                <div className="text-xs">
                  <p className="text-custom-text-400">Expires {expiry}</p>
                  <p role="timer" className="mt-1 text-custom-primary-100">
                    Registration open · {remaining >= 86400 ? `${Math.floor(remaining / 86400)}d ` : ""}
                    {remaining >= 3600 ? `${Math.floor(remaining / 3600) % 24}h ` : ""}
                    {Math.floor(remaining / 60) % 60}:{String(remaining % 60).padStart(2, "0")} remaining
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-custom-border-200 bg-custom-background-90 p-3">
              <Info className="mt-0.5 size-4 shrink-0 text-custom-primary-100" />
              <p className="text-xs leading-5 text-custom-text-300">
                Share the link by email or team chat. In the Player App, select this school’s server and tap{" "}
                <strong className="font-medium text-custom-text-200">Scan team QR</strong> to scan the QR or enter the
                short code. A coach approves requests before players gain access.
              </p>
            </div>
          </>
        ) : (
          !busy && (
            <div
              role="status"
              className="flex flex-col items-center rounded-lg border border-dashed border-custom-border-300 py-10 text-center"
            >
              <QrCode className="mb-3 size-8 text-custom-text-400" />
              <p className="text-sm font-medium text-custom-text-200">
                {session
                  ? "The team invitation expired."
                  : "Registration is closed. Generate a QR to let athletes join."}
              </p>
              <p className="mt-2 text-xs text-custom-text-400">The QR, code and link expire together.</p>
            </div>
          )
        )}
        {error && (
          <p role="alert" className="text-xs text-red-500">
            {error}
          </p>
        )}
        <p className="text-xs leading-5 text-custom-text-400">
          Closing this window keeps registration open. Replacing or closing registration invalidates the current QR,
          link and code.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-custom-border-200 px-5 py-3">
        <div className="flex gap-2">
          {active && (
            <Button
              variant="neutral-primary"
              size="sm"
              prependIcon={<Ban />}
              disabled={busy}
              onClick={() => void mutate(true)}
            >
              Close registration
            </Button>
          )}
          <Button
            variant="neutral-primary"
            size="sm"
            prependIcon={active ? <RefreshCw /> : <QrCode />}
            disabled={busy}
            onClick={() => void mutate(false)}
          >
            {active ? "Replace QR" : "Generate QR"}
          </Button>
        </div>
        {active && (
          <Button
            variant="neutral-primary"
            size="sm"
            prependIcon={expanded ? <Minimize2 /> : <Maximize2 />}
            disabled={busy}
            onClick={() => setExpanded((value) => !value)}
            aria-label={expanded ? "Show QR details" : "Show QR full screen"}
          >
            {expanded ? "Show details" : "Show full screen"}
          </Button>
        )}
        <Button variant="primary" size="sm" disabled={busy} onClick={onClose}>
          Done
        </Button>
      </div>
    </ModalCore>
  );
};
