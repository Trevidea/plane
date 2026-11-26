"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import useSWR from "swr";
import { ArrowLeft, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { Button } from "@plane/propel/button";
import type { IProject } from "@plane/types";
import SportDropdown from "@/components/dropdowns/sport-property";
import { ProjectEventMetadataFields } from "@/components/project/event-metadata-fields";
import { useUserPermissions } from "@/hooks/store/user";
import type {
  AdminOption,
  AdminPage,
  SchoolRosterRow,
  SeasonAssignment,
  TeamSeason,
} from "@/services/team-season.service";
import { TeamSeasonService, teamSeasonError } from "@/services/team-season.service";

const service = new TeamSeasonService();
const control = "w-full min-w-0 rounded-md border border-custom-border-200 bg-custom-background-100 px-3 py-2 text-sm";
const section = "space-y-3 border-b border-custom-border-200 py-5";

function Pager({
  data,
  page,
  setPage,
  label,
}: {
  data?: AdminPage<unknown>;
  page: number;
  setPage: (page: number) => void;
  label: string;
}) {
  if (!data?.next && !data?.previous) return null;
  return (
    <nav className="flex items-center gap-2" aria-label={label}>
      <button
        type="button"
        className="p-2 disabled:opacity-30"
        title="Previous page"
        aria-label={`${label} previous page`}
        disabled={!data.previous}
        onClick={() => setPage(page - 1)}
      >
        <ChevronLeft size={16} />
      </button>
      <span className="text-xs tabular-nums">{page}</span>
      <button
        type="button"
        className="p-2 disabled:opacity-30"
        title="Next page"
        aria-label={`${label} next page`}
        disabled={!data.next}
        onClick={() => setPage(page + 1)}
      >
        <ChevronRight size={16} />
      </button>
    </nav>
  );
}

function useAdminPage<T>(slug: string, route: string | null, page: number, filters?: Record<string, string>) {
  return useSWR(
    route ? ["team-admin", slug, route, page, filters] : null,
    () => service.readPage<T>(slug, route!, page, filters),
    { shouldRetryOnError: false }
  );
}

function NewSeason({ save, busy }: { save: (values: Record<string, string>) => Promise<boolean>; busy: boolean }) {
  const form = useForm<IProject>();
  const sport = form.watch("sport");
  const [missing, setMissing] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={form.handleSubmit(async (values, event) => {
        const fields = new FormData(event?.target as HTMLFormElement);
        if (!values.sport || !values.event_season || !values.event_program || !values.event_level) {
          setMissing(true);
          return;
        }
        setMissing(false);
        const payload = Object.fromEntries(
          ["name", "identifier", "starts_on", "ends_on"].flatMap((key) => {
            const value = String(fields.get(key) ?? "");
            return value ? [[key, value]] : [];
          })
        );
        if (
          await save({
            ...payload,
            sport: values.sport,
            season_label: values.event_season,
            division: values.event_program,
            level: values.event_level,
          })
        ) {
          form.reset();
          (event?.target as HTMLFormElement).reset();
        }
      })}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          Program name
          <input className={control} name="name" required maxLength={255} disabled={busy} />
        </label>
        <label className="space-y-1 text-sm">
          Program ID
          <input className={control} name="identifier" required pattern="[A-Za-z0-9]+" maxLength={12} disabled={busy} />
        </label>
        <label className="space-y-1 text-sm">
          Start date
          <input className={control} name="starts_on" type="date" disabled={busy} />
        </label>
        <label className="space-y-1 text-sm">
          End date
          <input className={control} name="ends_on" type="date" disabled={busy} />
        </label>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <SportDropdown
          value={sport ?? null}
          onChange={(value) => form.setValue("sport", value)}
          placeholder="Sport"
          buttonVariant="border-with-text"
          disabled={busy}
        />
        <ProjectEventMetadataFields control={form.control} disabled={busy} futureSeasonYears={1} />
      </div>
      {missing && (
        <p role="alert" className="text-sm text-red-500">
          Select sport, season, division, and level.
        </p>
      )}
      <Button type="submit" size="sm" disabled={busy} prependIcon={<Plus size={16} />}>
        Create season
      </Button>
    </form>
  );
}

function SeasonStaff({
  slug,
  season,
  run,
}: {
  slug: string;
  season: TeamSeason;
  run: (action: () => Promise<void>) => Promise<boolean>;
}) {
  const [page, setPage] = useState(1);
  const [optionPage, setOptionPage] = useState(1);
  const [query, setQuery] = useState("");
  const [user, setUser] = useState("");
  const [assignment, setAssignment] = useState<SeasonAssignment["assignment"]>("coach");
  const [grant, setGrant] = useState(false);
  const [busy, setBusy] = useState(false);
  const staff = useAdminPage<SeasonAssignment>(slug, `seasons/${season.id}/staff`, page);
  const options = useAdminPage<AdminOption>(slug, season.archived ? null : "staff-options", optionPage, {
    search: query,
  });
  const mutate = async (action: () => Promise<unknown>) => {
    setBusy(true);
    await run(async () => {
      await action();
      if (page > 1 && staff.data?.results.length === 1) setPage(1);
      await staff.mutate();
    });
    setBusy(false);
  };
  return (
    <section className={section}>
      <h2 className="text-base font-semibold">Season staff</h2>
      {staff.error && (
        <p role="alert" className="text-sm text-red-500">
          Could not load staff assignments.
        </p>
      )}
      {staff.isLoading && (
        <p role="status" className="text-sm">
          Loading staff…
        </p>
      )}
      {staff.data?.results.length === 0 && <p className="text-sm text-custom-text-300">No staff assigned.</p>}
      <ul className="divide-y divide-custom-border-200">
        {staff.data?.results.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2 text-sm">
            <span className="min-w-0 flex-1 break-words">{row.name}</span>
            <span className="capitalize text-custom-text-300">{row.assignment}</span>
            {!season.archived ? (
              <>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={row.manage_roster}
                    disabled={busy}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      void mutate(() =>
                        service.setStaff(slug, season.id, row.id, {
                          assignment: row.assignment,
                          manage_roster: checked,
                        })
                      );
                    }}
                  />{" "}
                  Roster grant
                </label>
                <button
                  type="button"
                  disabled={busy}
                  className="rounded p-2 text-custom-text-300 hover:bg-custom-background-90"
                  title="Remove assignment (keeps Program membership)"
                  aria-label={`Remove assignment for ${row.name}`}
                  onClick={() => void mutate(() => service.clearStaff(slug, season.id, row.id))}
                >
                  <Trash2 size={16} />
                </button>
              </>
            ) : row.manage_roster ? (
              <span>Roster grant (inactive)</span>
            ) : null}
          </li>
        ))}
      </ul>
      <Pager data={staff.data} page={page} setPage={setPage} label="Staff assignments" />
      {!season.archived && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (user) void mutate(() => service.setStaff(slug, season.id, user, { assignment, manage_roster: grant }));
          }}
        >
          <div className="grid gap-2 sm:grid-cols-3">
            <input
              aria-label="Find workspace staff"
              className={control}
              placeholder="Find workspace staff"
              maxLength={100}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setOptionPage(1);
                setUser("");
              }}
            />
            <select
              className={control}
              aria-label="Workspace staff"
              value={user}
              onChange={(event) => setUser(event.target.value)}
              required
            >
              <option value="">Select staff member</option>
              {options.data?.results.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
            <select
              className={control}
              aria-label="Staff assignment"
              value={assignment}
              onChange={(event) => setAssignment(event.target.value === "coach" ? "coach" : "operator")}
            >
              <option value="coach">Coach</option>
              <option value="operator">Operator</option>
            </select>
          </div>
          {options.error && (
            <p role="alert" className="text-sm text-red-500">
              Could not load workspace staff.
            </p>
          )}
          <Pager
            data={options.data}
            page={optionPage}
            setPage={(next) => {
              setOptionPage(next);
              setUser("");
            }}
            label="Workspace staff"
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={grant} onChange={(event) => setGrant(event.target.checked)} /> Delegate
              roster edits
            </label>
            <Button type="submit" size="sm" disabled={busy || !user}>
              Save assignment
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function SchoolRoster({ slug, season }: { slug: string; season: TeamSeason | null }) {
  const [wholeSchool, setWholeSchool] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const roster = useAdminPage<SchoolRosterRow>(slug, "roster", page, {
    ...(season && !wholeSchool ? { season: season.id } : {}),
    search,
  });
  return (
    <section className={section}>
      <h2 className="text-base font-semibold">School roster</h2>
      <div className="flex flex-wrap items-center gap-3">
        <input
          className={`${control} max-w-sm`}
          placeholder="Search players"
          aria-label="Search school roster"
          maxLength={100}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        {season && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={wholeSchool}
              onChange={(event) => {
                setWholeSchool(event.target.checked);
                setPage(1);
              }}
            />{" "}
            All school programs
          </label>
        )}
      </div>
      {roster.error && (
        <p role="alert" className="text-sm text-red-500">
          Could not load the school roster.
        </p>
      )}
      {roster.isLoading && (
        <p role="status" className="text-sm">
          Loading roster…
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-custom-text-300">
            <tr>
              {["Player", "Program", "Season", "Jersey", "Grad year", "Status", "Account"].map((item) => (
                <th className="px-3 py-2" key={item}>
                  {item}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roster.data?.results.map((row) => (
              <tr key={row.id} className="border-t border-custom-border-200">
                <td className="px-3 py-2 break-words">{row.player_name}</td>
                <td className="px-3 py-2">
                  <Link
                    className="text-custom-primary-100 hover:underline"
                    href={`/${slug}/projects/${row.project_id}/roster`}
                  >
                    {row.program}
                  </Link>
                </td>
                <td className="px-3 py-2">{row.season_label || "–"}</td>
                <td className="px-3 py-2">{row.jersey_number || "–"}</td>
                <td className="px-3 py-2">{row.class_year || "–"}</td>
                <td className="px-3 py-2 capitalize">{row.status}</td>
                <td className="px-3 py-2 capitalize">{row.account_status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {roster.data?.results.length === 0 && <p className="text-sm text-custom-text-300">No matching players.</p>}
      <Pager data={roster.data} page={page} setPage={setPage} label="School roster" />
    </section>
  );
}

function Admin({ slug }: { slug: string }) {
  const [team, setTeam] = useState("");
  const [season, setSeason] = useState<TeamSeason | null>(null);
  const [teamPage, setTeamPage] = useState(1);
  const [seasonPage, setSeasonPage] = useState(1);
  const [programPage, setProgramPage] = useState(1);
  const [newMode, setMode] = useState<"new" | "existing">("new");
  const [program, setProgram] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const teams = useAdminPage<AdminOption>(slug, "teams", teamPage);
  const seasons = useAdminPage<TeamSeason>(slug, team ? `teams/${team}/seasons` : null, seasonPage);
  const programs = useAdminPage<AdminOption>(
    slug,
    team && newMode === "existing" ? "unlinked-programs" : null,
    programPage
  );
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      return true;
    } catch (error) {
      setError(teamSeasonError(error));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const selectTeam = (id: string) => {
    setTeam(id);
    setSeason(null);
    setSeasonPage(1);
    setProgram("");
  };
  const addTeam = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get("team") ?? "").trim();
    void run(async () => {
      const created = await service.createTeam(slug, name);
      selectTeam(created.id);
      form.reset();
      await teams.mutate();
    });
  };
  const addSeason = (payload: Record<string, string>) =>
    run(async () => {
      const created = await service.addSeason(slug, team, payload);
      setSeason(created);
      setProgram("");
      setSeasonPage(1);
      await Promise.all([seasons.mutate(), programs.mutate()]);
    });
  return (
    <main className="h-full overflow-y-auto bg-custom-background-100 px-4 py-5 text-custom-text-100 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <Link
          href={`/${slug}/projects`}
          className="inline-flex items-center gap-2 text-sm text-custom-text-300 hover:text-custom-text-100"
        >
          <ArrowLeft size={16} /> Programs
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Teams and seasons</h1>
        {error && (
          <p
            role="alert"
            className="sticky top-0 z-10 my-2 border border-red-500/40 bg-custom-background-100 p-3 text-sm text-red-500"
          >
            {error}
          </p>
        )}
        <section className={section}>
          <h2 className="text-base font-semibold">Teams</h2>
          {teams.error && (
            <p role="alert" className="text-sm text-red-500">
              Could not load teams.
            </p>
          )}
          {teams.isLoading && (
            <p role="status" className="text-sm">
              Loading teams…
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {teams.data?.results.map((row) => (
              <Button
                key={row.id}
                type="button"
                size="sm"
                variant={team === row.id ? "primary" : "neutral-primary"}
                disabled={busy}
                aria-pressed={team === row.id}
                onClick={() => selectTeam(row.id)}
              >
                {row.name}
              </Button>
            ))}
          </div>
          <Pager data={teams.data} page={teamPage} setPage={setTeamPage} label="Teams" />
          <form className="flex max-w-xl flex-wrap items-center gap-2" onSubmit={addTeam}>
            <input
              className={`${control} max-w-sm flex-1`}
              aria-label="Team name"
              name="team"
              placeholder="Team name"
              required
              maxLength={255}
              disabled={busy}
            />
            <Button type="submit" size="sm" variant="neutral-primary" disabled={busy} prependIcon={<Plus size={16} />}>
              Create team
            </Button>
          </form>
        </section>
        {team && (
          <section className={section}>
            <h2 className="text-base font-semibold">Seasons</h2>
            {seasons.error && (
              <p role="alert" className="text-sm text-red-500">
                Could not load seasons.
              </p>
            )}
            {seasons.isLoading && (
              <p role="status" className="text-sm">
                Loading seasons…
              </p>
            )}
            <ul className="divide-y divide-custom-border-200">
              {seasons.data?.results.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={season?.id === row.id ? "primary" : "neutral-primary"}
                    aria-pressed={season?.id === row.id}
                    disabled={busy}
                    onClick={() => setSeason(row)}
                  >
                    {row.season_label} · {row.name}
                    {row.archived ? " · Archived" : ""}
                  </Button>
                  <Link
                    className="text-sm text-custom-primary-100 hover:underline"
                    href={`/${slug}/projects/${row.project_id}/roster`}
                  >
                    Open roster
                  </Link>
                </li>
              ))}
            </ul>
            <Pager data={seasons.data} page={seasonPage} setPage={setSeasonPage} label="Seasons" />
            <div className="flex flex-wrap gap-2" role="group" aria-label="Add season mode">
              <Button
                size="sm"
                variant={newMode === "new" ? "primary" : "neutral-primary"}
                aria-pressed={newMode === "new"}
                disabled={busy}
                onClick={() => setMode("new")}
              >
                New season
              </Button>
              <Button
                size="sm"
                variant={newMode === "existing" ? "primary" : "neutral-primary"}
                aria-pressed={newMode === "existing"}
                disabled={busy}
                onClick={() => setMode("existing")}
              >
                Link existing program
              </Button>
            </div>
            {newMode === "new" ? (
              <NewSeason key={team} save={addSeason} busy={busy} />
            ) : (
              <form
                className="space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (program) void addSeason({ project_id: program });
                }}
              >
                <div className="flex flex-wrap gap-2">
                  <select
                    className={`${control} max-w-sm`}
                    aria-label="Existing program"
                    value={program}
                    onChange={(event) => setProgram(event.target.value)}
                    disabled={busy}
                  >
                    <option value="">Select program</option>
                    {programs.data?.results.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" size="sm" disabled={busy || !program}>
                    Link program
                  </Button>
                </div>
                {programs.error && (
                  <p role="alert" className="text-sm text-red-500">
                    Could not load unlinked programs.
                  </p>
                )}
                <Pager
                  data={programs.data}
                  page={programPage}
                  setPage={(next) => {
                    setProgramPage(next);
                    setProgram("");
                  }}
                  label="Unlinked programs"
                />
              </form>
            )}
          </section>
        )}
        {season && <SeasonStaff key={`staff:${season.id}`} slug={slug} season={season} run={run} />}
        <SchoolRoster key={`roster:${season?.id ?? "all"}`} slug={slug} season={season} />
      </div>
    </main>
  );
}

export const TeamSeasonAdmin = observer(() => {
  const { workspaceSlug } = useParams();
  const { allowPermissions } = useUserPermissions();
  if (typeof workspaceSlug !== "string") return null;
  if (!allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE, workspaceSlug)) {
    return <p className="p-6 text-sm text-custom-text-300">School administrator access is required.</p>;
  }
  return <Admin key={workspaceSlug} slug={workspaceSlug} />;
});
