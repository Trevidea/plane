"use client";

import { PlayerArea } from "@/plane-web/features/player/components/player-area";
import { AuthenticationWrapper } from "@/lib/wrappers/authentication-wrapper";

export default function PlayerPage() {
  return (
    <AuthenticationWrapper>
      <PlayerArea />
    </AuthenticationWrapper>
  );
}
