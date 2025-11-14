"use client";

import React from "react";
import { MoreVertical, Users } from "lucide-react";

interface Team {
  id: string;
  name: string;
  website: string;
  requests: number;
}

interface Props {
  teams: Team[];
}

export default function OppositionTeamsList({ teams }: Props) {
  return (
    <div className="w-full border border-zinc-800 rounded-lg ">
      {teams.map((team) => (
        <div
          key={team.id}
          className="flex items-center justify-between px-4 py-4 border-b border-zinc-800 last:border-b-0 transition"
        >
          {/* LEFT */}
          <div>
            <h3 className="text-base font-medium">{team.name}</h3>
            <a
              href={team.website}
              target="_blank"
              className="text-sm text-gray-500 hover:underline"
            >
              {team.website}
            </a>
          </div>

          {/* RIGHT */}
          <div className="flex items-center gap-4">
            {/* Requests Badge */}
            <div className="flex items-center gap-1 text-sm border border-gray-700 text-gray-300 bg-transparent px-3 py-1 rounded-md">
              <Users className="h-4 w-4 text-gray-400" />
              {team.requests} requests
            </div>

            {/* Menu Icon */}
            <button className="p-1  rounded">
              <MoreVertical className="h-5 w-5 text-gray-600" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
