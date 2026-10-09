type AttachmentTab = {
  location: { href: string };
  opener: unknown;
  close: () => void;
};

export const openAttachment = async (
  url: string | undefined,
  openTab: () => AttachmentTab | null,
  resolveUrl: (url: string) => Promise<string>
) => {
  if (!url) throw new Error("This attachment is unavailable. Please upload the file again.");
  const tab = openTab();
  if (!tab) throw new Error("Please allow pop-ups to open this attachment.");
  tab.opener = null;
  try {
    const resolvedUrl = await resolveUrl(url);
    if (!resolvedUrl) throw new Error("This attachment is unavailable. Please upload the file again.");
    tab.location.href = resolvedUrl;
  } catch (error) {
    tab.close();
    throw error;
  }
};
