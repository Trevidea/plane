export type TRosterPlayerStatus = "active" | "injured" | "inactive" | "pending" | "removed";

export interface IRosterPlayer {
  id: string;
  program_id: string;
  email?: string;
  account_email?: string | null;
  account_avatar_url?: string | null;
  user?: string | null;
  account_status?: "email_missing" | "not_linked" | "invitation_pending" | "linked";
  registration_status?: "pending" | null;
  registration_email?: string | null;
  registration_name?: string | null;
  player_name: string;
  jersey_number: string | null;
  position: string | null;
  height: string | null;
  weight: string | null;
  class_year: string | null;
  status: TRosterPlayerStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface IRosterFilters {
  search?: string;
  position?: string;
  status?: TRosterPlayerStatus | "";
  class_year?: string;
}

export interface IRosterPlayerPayload {
  player_name: string;
  email?: string | null;
  jersey_number?: string | null;
  position?: string | null;
  height?: string | null;
  weight?: string | null;
  class_year?: string | null;
  status?: TRosterPlayerStatus;
  notes?: string | null;
}

export interface IRosterImportPayload {
  players: IRosterPlayerPayload[];
}

export interface IRosterImportResponse {
  success: boolean;
  data: IRosterPlayer[];
  imported_count: number;
  message: string;
}

export interface IRosterLifecycleEvent {
  id: string;
  roster_identity: string;
  player_name: string;
  jersey_number: string | null;
  action: string;
  previous_status: TRosterPlayerStatus | null;
  status: TRosterPlayerStatus;
  created_at: string;
  actor_name: string | null;
  has_account: boolean;
}
