export const CATEGORIES = [
  { slug: "design", label: "Design" },
  { slug: "development", label: "Development" },
  { slug: "smart-contracts", label: "Smart contracts" },
  { slug: "writing", label: "Writing" },
  { slug: "marketing", label: "Marketing" },
  { slug: "data-ai", label: "Data and AI" },
  { slug: "other", label: "Other" },
] as const;

export type CategorySlug = (typeof CATEGORIES)[number]["slug"];
export const isCategory = (s: unknown): s is CategorySlug => CATEGORIES.some((c) => c.slug === s);
export const categoryLabel = (s: string) => CATEGORIES.find((c) => c.slug === s)?.label ?? "Other";
