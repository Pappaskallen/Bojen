/**
 * Swedish user-facing texts. All text shown to users lives here (see CLAUDE.md).
 */
export const sv = {
  app: {
    name: "Bojen",
    tagline: "Bokning, kundregister och receptionist för båtmekaniker",
  },
} as const;

export type Texts = typeof sv;
