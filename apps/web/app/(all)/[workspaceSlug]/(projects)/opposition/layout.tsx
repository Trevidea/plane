"use client";

// components
import { AppHeader } from "@/components/core/app-header";
import { ContentWrapper } from "@/components/core/content-wrapper";
import { WorkspaceOppositionHeader } from "./header";



export default function WorkspaceOppositionLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader header={<WorkspaceOppositionHeader />} />
      <ContentWrapper>{children}</ContentWrapper>
    </>
  );
}