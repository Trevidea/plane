"use client";

import type { ReactNode, FC } from "react";
import { useEffect } from "react";
import { ThemeProvider } from "next-themes";
// components
import { TranslationProvider } from "@plane/i18n";
import { installFrontendDiagnostics } from "@plane/logger/diagnostics-browser";
import { InstanceProvider } from "@/lib/instance-provider";
import { StoreProvider } from "@/lib/store-provider";
import { ToastProvider } from "@/lib/toast-provider";

interface IAppProvider {
  children: ReactNode;
}

export const AppProvider: FC<IAppProvider> = (props) => {
  useEffect(() => installFrontendDiagnostics(process.env.NEXT_PUBLIC_SPACE_BASE_PATH || ""), []);
  const { children } = props;

  return (
    <ThemeProvider themes={["light", "dark"]} defaultTheme="system" enableSystem>
      <StoreProvider>
        <TranslationProvider>
          <ToastProvider>
            <InstanceProvider>{children}</InstanceProvider>
          </ToastProvider>
        </TranslationProvider>
      </StoreProvider>
    </ThemeProvider>
  );
};
