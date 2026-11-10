// Icons for the HUD, drawn as SVG (24 x 24, stroked in currentColor, so CSS colours them): one per body slot
// (shown dim while the slot is empty) and one per mutation (shown when it's grown). icon(id) falls back to the
// mutation's slot.
const S = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const SLOT_ICONS = {
  maw: S('<path d="M5 7c2 1 4 1.5 7 1.5S17 8 19 7"/><path d="M7 8l1.5 6 1.5-4.5L12 16l2-6.5 1.5 4.5L17 8"/>'),
  forelegs: S('<path d="M12 18V12"/><path d="M12 12L6 7l-2 4"/><path d="M12 12l6-5 2 4"/><circle cx="12" cy="19" r="1.4"/>'),
  carapace: S('<path d="M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6z"/><path d="M12 7v10M8.5 9.5l7 0"/>'),
  abdomen: S('<ellipse cx="12" cy="12.5" rx="5.5" ry="7.5"/><path d="M7 10.5h10M6.8 14.5h10.4"/><path d="M12 20v2"/>'),
  hindlegs: S('<path d="M12 6v5"/><path d="M12 11l-5 4-1 5"/><path d="M12 11l5 4 1 5"/><circle cx="12" cy="5" r="1.4"/>'),
  glands: S('<path d="M12 3c3 4.5 5 7.3 5 10a5 5 0 0 1-10 0c0-2.7 2-5.5 5-10z"/><path d="M10 14.5c.3 1.3 1.1 2 2.3 2.2"/>'),
};

export const MUTATION_ICONS = {
  // Devour: jaws clamping on a drop of blood
  devour: S('<path d="M4 9c3-4 13-4 16 0"/><path d="M4 9l2.5 3 2-2.2 2 2.6 1.5-2 1.5 2 2-2.6 2 2.2L20 9"/><path d="M12 15c1.2 1.6 1.8 2.6 1.8 3.4a1.8 1.8 0 0 1-3.6 0c0-.8.6-1.8 1.8-3.4z"/>'),
  // Rear quills: a fan of spines flying back
  quills: S('<path d="M12 20V4"/><path d="M12 20L5 6"/><path d="M12 20l7-14"/><path d="M12 20L3 12"/><path d="M12 20l9-8"/><path d="M10.5 6.5L12 4l1.5 2.5"/>'),
  // Pounce: a leap arc and a crater
  pounce: S('<path d="M4 15C6 6 14 4 19 12"/><path d="M16.5 11.5l2.8.6.4-2.9"/><path d="M14 19.5c1-1 2.6-1.6 4.5-1.6s3.5.6 4.5 1.6" transform="translate(-4 0)"/><path d="M9 17l-1.5-1.5M15 17l1.5-1.5"/>'),
};

MUTATION_ICONS.scythes = S('<path d="M5 20C5 11 9 5 18 3c-4 4-6 8-6 13"/><path d="M19 20c0-9-4-15-13-17 4 4 6 8 6 13" opacity="0.7"/>');

export function icon(id, slot) { return MUTATION_ICONS[id] || SLOT_ICONS[slot] || SLOT_ICONS.maw; }
