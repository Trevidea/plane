"use client";

import React from "react";
import { PageHead } from "@/components/core/page-title";
import OppositionTeamsList from "./opposition-list";

const WorkspaceOppositionPage = () => {
  const pageTitle = "Opposition Teams";

  // SAMPLE DATA — replace with API call later
  const teams = [
    {
      id: "1",
      name: "Fairport High School",
      website: "http://www.fairporths.edu",
      requests: 0,
      logo: "",
    },
    {
      id: "2",
      name: "Pittsford Mendon HS",
      website: "http://www.pittsfordschools.org",
      requests: 0,
      logo: "",
    },
  ];

  return (
    <>
      <PageHead title={pageTitle} />

      <div className="relative h-full w-full overflow-hidden overflow-y-auto">
      <OppositionTeamsList teams={teams} />
    </div>
    </>
  );
};

export default WorkspaceOppositionPage;
