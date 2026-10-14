export const COACHING_CARD_TYPES: Readonly<Record<string, { label: string; accent: string; textClass: string }>> = {
  Correction: { label: "Correction", accent: "#2893cc", textClass: "text-[#006b9a] dark:text-[#44b5f0]" },
  "Positive Reinforcement": {
    label: "Reinforcement",
    accent: "#c5a55a",
    textClass: "text-[#74520c] dark:text-[#ddbd72]",
  },
  "Opponent Scout": { label: "Scout", accent: "#445588", textClass: "text-[#344b83] dark:text-[#92a9dc]" },
  "S&C Connection": { label: "S&C", accent: "#7a4488", textClass: "text-[#663b7d] dark:text-[#c091d4]" },
  "Multi-Week Development": {
    label: "Multi-Week Development",
    accent: "#2893cc",
    textClass: "text-[#006b9a] dark:text-[#44b5f0]",
  },
};

export const COACHING_CARD_GROUP_ACCENT = "#7a4488";

export const getCoachingCardAccent = (cardType?: string) =>
  COACHING_CARD_TYPES[cardType || ""]?.accent || COACHING_CARD_TYPES.Correction.accent;

export const getCoachingCardBorderBackground = (cardType?: string, positionGroup?: string | null) => {
  const accent = getCoachingCardAccent(cardType);
  return positionGroup ? `linear-gradient(180deg, ${accent} 50%, ${COACHING_CARD_GROUP_ACCENT} 50%)` : accent;
};

export const getCoachingCardLegendEntries = () => {
  const entries = new Map<string, { accent: string; labels: string[] }>();
  for (const type of Object.values(COACHING_CARD_TYPES)) {
    const entry = entries.get(type.accent);
    if (entry) entry.labels.push(type.label);
    else entries.set(type.accent, { accent: type.accent, labels: [type.label] });
  }
  return [...entries.values()];
};
