"use client";

import React from "react";
import { UsersRoundIcon } from "lucide-react";
import { OppositionTeamBlock } from "./opposition-team-block";
import { TeamLogo } from "./opposition-team-logo";

interface Team {
  id: string;
  name: string;
  address: string;
  logo: string;
  athletic_email: string;
  athletic_phone: string;
  head_coach_name: string;
  asst_coach_name: string;
  asst_athletic_email: string;
  asst_athletic_phone: string;
}

interface Props {
  teams: Team[];
  workspaceSlug: string;
  searchQuery?: string;
  loading?: boolean;
}

export default function OppositionTeamsList({ teams, workspaceSlug, searchQuery = "", loading = false }: Props) {
  const filteredTeams = teams.filter((team) => team.name.toLowerCase().includes(searchQuery.toLowerCase()));

  if (loading) {
    return (
      <div className="flex h-full min-h-[360px] items-center justify-center text-sm text-custom-text-300">
        Loading opposition teams...
      </div>
    );
  }

  if (filteredTeams.length === 0) {
    return (
      <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-3 text-center">
        <UsersRoundIcon className="h-10 w-10 text-custom-text-300" />
        <div>
          <h3 className="text-base font-medium text-custom-text-100">
            {searchQuery ? "No opposition teams found" : "No opposition teams yet"}
          </h3>
          <p className="mt-1 text-sm text-custom-text-300">
            {searchQuery ? "Try a different search term." : "Create an opposition team to see it here."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full border-b border-custom-border-200">
      {filteredTeams.map((team) => (
        <div
          key={team.id}
          className="flex items-center justify-between px-4 py-4 border-b border-custom-border-200 last:border-b-0 transition"
        >
          <div className="flex items-center gap-4">
            {/* Logo */}
            <div className="w-12 h-12 rounded-md border border-custom-border-200 overflow-hidden bg-zinc-900">
              <TeamLogo path={team.logo} name={team.name} />
            </div>
            {/* LEFT */}
            <div>
              <h3 className="text-base font-medium">{team.name}</h3>
              <span className="text-sm text-gray-500">{team.address}</span>
            </div>
          </div>

          {/* RIGHT */}
          <div className="flex items-center gap-4">
            {/* MENU OPENED */}
            <div>
              <OppositionTeamBlock workspaceSlug={workspaceSlug} team={team} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
