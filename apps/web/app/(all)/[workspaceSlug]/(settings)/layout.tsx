"use client";

import { observer } from "mobx-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { ArrowRight, Home, LockKeyhole, ShieldCheck } from "lucide-react";
import { CommandPalette } from "@/components/command-palette";
import { ContentWrapper } from "@/components/core/content-wrapper";
import { SettingsHeader } from "@/components/settings/header";
import { useUserReadOnly } from "@/hooks/use-user-readonly";
import { AuthenticationWrapper } from "@/lib/wrappers/authentication-wrapper";
import { WorkspaceAuthWrapper } from "@/plane-web/layouts/workspace-wrapper";

const SettingsContent = observer(({ children }: { children: React.ReactNode }) => {
  const { workspaceSlug } = useParams();
  const pathname = usePathname();
  const readOnly = useUserReadOnly();
  if (readOnly && !pathname.includes("/settings/account"))
    return (
      <main className="flex min-h-dvh items-center justify-center bg-custom-background-100 px-5 py-12">
        <section
          aria-labelledby="settings-access-title"
          className="w-full max-w-lg rounded-2xl border border-custom-border-200 bg-custom-background-90 p-7 shadow-lg sm:p-10"
        >
          <div className="mb-6 flex size-14 items-center justify-center rounded-2xl border border-amber-500/20 bg-amber-500/10 text-amber-500">
            <LockKeyhole size={26} strokeWidth={1.5} aria-hidden="true" />
          </div>
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-custom-text-300">Read-only access</p>
          <h1 id="settings-access-title" className="text-2xl font-semibold tracking-tight text-custom-text-100">
            Settings access is restricted
          </h1>
          <p className="mt-3 text-sm leading-6 text-custom-text-300">
            Your role lets you view your workspace and programs. Managing settings requires additional permissions.
          </p>
          <div className="my-7 flex items-start gap-3 rounded-xl border border-custom-border-200 bg-custom-background-100 p-4">
            <ShieldCheck size={19} className="mt-0.5 shrink-0 text-custom-primary-100" aria-hidden="true" />
            <p className="text-sm leading-6 text-custom-text-200">
              You can still explore shared work items, pages, and media. Contact your workspace administrator if you
              need access to settings.
            </p>
          </div>
          <Link
            href={`/${workspaceSlug}`}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-custom-primary-100 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-custom-primary-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-custom-primary-100"
          >
            <Home size={17} aria-hidden="true" />
            Go to homepage
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </section>
      </main>
    );
  return <>{children}</>;
});

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthenticationWrapper>
      <WorkspaceAuthWrapper>
        <SettingsContent>
          <CommandPalette />
          <div className="relative flex h-full w-full overflow-hidden rounded-lg border border-custom-border-200">
            <main className="relative flex h-full w-full flex-col overflow-hidden bg-custom-background-100">
              {/* Header */}
              <SettingsHeader />
              {/* Content */}
              <ContentWrapper className="p-page-x md:flex w-full">
                <div className="w-full h-full overflow-hidden">{children}</div>
              </ContentWrapper>
            </main>
          </div>
        </SettingsContent>
      </WorkspaceAuthWrapper>
    </AuthenticationWrapper>
  );
}
