"use client";

import { useSearchParams } from "next/navigation";
import { RosterPage } from "@/plane-web/features/roster";

export default function ProjectRosterPage() {
  const query = useSearchParams();
  return <RosterPage openJoinRequests={query.get("view") === "join-requests"} />;
}
