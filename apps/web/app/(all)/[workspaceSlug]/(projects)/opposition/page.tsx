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
      website: "https://www.fairporths.edu",
      requests: 0,
    },
    {
      id: "2",
      name: "Pittsford Mendon HS",
      website: "https://www.pittsfordschools.org",
      requests: 0,
    },
  ];

  return (
    <>
      <PageHead title={pageTitle} />

      <div className="p-6">
      <OppositionTeamsList teams={teams} />
    </div>
    </>
  );
};

export default WorkspaceOppositionPage;
