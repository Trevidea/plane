export const cardPeekUrl = (href: string, cardId: string | null) => {
  const url = new URL(href, "https://plane.invalid");
  if (cardId) url.searchParams.set("card", cardId);
  else url.searchParams.delete("card");
  return `${url.pathname}${url.search}${url.hash}`;
};

export const cardIdFromUrl = (href: string) => {
  const id = new URL(href, "https://plane.invalid").searchParams.get("card");
  return id && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id) ? id : null;
};

export const canActivateCard = ({
  now,
  suppressUntil,
  interactive,
}: {
  now: number;
  suppressUntil: number;
  interactive: boolean;
}) => !interactive && now >= suppressUntil;

export const cardStageProgress = <T extends { id: string; name: string; order: number }>(
  stages: T[],
  currentId: string | null
) => {
  const ordered = [...stages].sort((a, b) => a.order - b.order);
  const currentIndex = ordered.findIndex((stage) => stage.id === currentId);
  return ordered.map((stage, index) => ({
    ...stage,
    status: (index === currentIndex ? "current" : index < currentIndex ? "completed" : "future") as
      | "current"
      | "completed"
      | "future",
  }));
};
