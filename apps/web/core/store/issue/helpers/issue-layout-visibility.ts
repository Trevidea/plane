type TIssueWithServiceGatewayEvent = {
  sg_event_id?: string | number | null;
};

export const hasServiceGatewayEvent = (issue: TIssueWithServiceGatewayEvent): boolean =>
  issue.sg_event_id !== null && issue.sg_event_id !== undefined && String(issue.sg_event_id).trim().length > 0;

export const isIssueVisibleInLayout = (issue: TIssueWithServiceGatewayEvent, layout: string | undefined): boolean => {
  if (!layout) return true;

  return hasServiceGatewayEvent(issue) === (layout === "calendar");
};
