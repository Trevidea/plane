"use client";

import React from "react";
import { MoreVertical, Users } from "lucide-react";

interface Team {
  id: string;
  name: string;
  website: string;
  requests: number;
  logo?: string;
}

interface Props {
  teams: Team[];
}

export default function OppositionTeamsList({ teams }: Props) {
  return (
    <div className="w-full border-b border-zinc-800 ">
      {teams.map((team) => (
        <div
          key={team.id}
          className="flex items-center justify-between px-4 py-4 border-b border-zinc-800 last:border-b-0 transition"
        >
          {/* LEFT */}
          <div className="flex items-center gap-3">
            {/* Team Logo */}
            {team.logo !== "" ? (
              <img
                src={team.logo}
                alt="..."
                width={40}
                height={40}
                className="rounded-md object-cover"
              />
            ) : (
              <div className="h-10 w-10 bg-gray-200 bg-zinc-700 rounded-md flex items-center justify-center text-nutral-300">
                {team.name.charAt(0).toUpperCase()}
              </div>
            )}

            {/* Team Info */}
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
          </div>

          {/* RIGHT */}
          <div className="flex items-center gap-4">
            {/* Requests Badge */}
            <div className="flex items-center gap-1 text-sm border border-gray-700 dark:border-gray-700 light:text-gray-600 dark:text-gray-300 bg-transparent px-3 py-1 rounded-md">
              <Users className="h-4 w-4 light:text-gray-600 dark:text-gray-400" />
              {team.requests} requests
            </div>

            {/* Menu Icon */}
            <button className="p-1 rounded">
              <MoreVertical className="h-5 w-5 text-gray-600" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
