/**
 * One line icon per station, in a 24 × 24 box drawn with a 1.6 stroke (boceto B1, the owner's
 * own drawing): the same icon inside the bubble and on its pill of the dock. A station the table
 * adds and the design does not know gets a plain circle.
 */

export const ICON_BOX = 24;

export const STATION_ICONS: Readonly<Record<string, string>> = {
  intake: 'M3 12h11M10 8l4 4-4 4M14 4h6v16h-6',
  filter: 'M4 5h16l-6 7v6l-4 2v-8z',
  classification: 'M4 12h6M10 12l6-6h4M10 12l6 6h4',
  knowledge: 'M5 4h10l4 4v12H5zM9 10h6M9 14h6',
  crm: 'M4 5h16v14H4zM4 10h16M10 10v9',
  person: 'M12 4a4 4 0 1 0 0 8a4 4 0 1 0 0-8M4 20c1.5-4 4.5-5.5 8-5.5s6.5 1.5 8 5.5',
  close: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M8 12l3 3 5-6',
};

/** A stopped station shows the stop's square instead of its own icon (§5). */
export const STOP_ICON = 'M7 7h10v10H7z';
/** A failed station shows an X (§5). */
export const FAILED_ICON = 'M7 7l10 10M17 7L7 17';
const UNKNOWN_ICON = 'M12 5a7 7 0 1 0 0 14a7 7 0 1 0 0-14';

export function iconOf(id: string): string {
  return STATION_ICONS[id] ?? UNKNOWN_ICON;
}
