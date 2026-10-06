// Unicode Egyptian Hieroglyph Format Controls (U+13430–U+13455) and related characters,
// shown as icons in the left sidebar. NewGardiner has visible glyphs for all format controls.

export interface Control {
  /** Text inserted into the input line. */
  insert: string;
  /** What the icon shows; rendered in the hieroglyphic font unless `label` is set. */
  glyph?: string;
  label?: string;
  name: string;
}

export interface ControlGroup {
  title: string;
  controls: Control[];
}

const c = (cp: number) => String.fromCodePoint(cp);

const DAMAGE_NAMES = ['', 'top start', 'bottom start', 'start', 'top end', 'top', 'bottom start & top end',
  'all but bottom end', 'bottom end', 'top start & bottom end', 'bottom', 'all but top end',
  'end', 'all but bottom start', 'all but top start', 'full'];

export const CONTROL_GROUPS: ControlGroup[] = [
  {
    title: 'Joiners',
    controls: [
      { insert: c(0x13430), name: 'Vertical joiner (MdC :)' },
      { insert: c(0x13431), name: 'Horizontal joiner (MdC *)' },
      { insert: c(0x13436), name: 'Overlay middle (MdC ##)' },
      { insert: c(0x13437), name: 'Begin segment (MdC ( )' },
      { insert: c(0x13438), name: 'End segment (MdC ) )' },
    ],
  },
  {
    title: 'Insertions',
    controls: [
      { insert: c(0x13432), name: 'Insert at top start' },
      { insert: c(0x13433), name: 'Insert at bottom start' },
      { insert: c(0x13434), name: 'Insert at top end' },
      { insert: c(0x13435), name: 'Insert at bottom end' },
      { insert: c(0x13439), name: 'Insert at middle' },
      { insert: c(0x1343A), name: 'Insert at top' },
      { insert: c(0x1343B), name: 'Insert at bottom' },
    ],
  },
  {
    title: 'Enclosures',
    controls: [
      { insert: c(0x13379) + c(0x1343C), glyph: c(0x13379), name: 'Open cartouche' },
      { insert: c(0x1343D) + c(0x1337A), glyph: c(0x1337A), name: 'Close cartouche' },
      { insert: c(0x13258) + c(0x1343C), glyph: c(0x13258), name: 'Open serekh / ḥwt' },
      { insert: c(0x1343D) + c(0x13282), glyph: c(0x13282), name: 'Close serekh' },
      { insert: c(0x1343C), name: 'Begin enclosure' },
      { insert: c(0x1343D), name: 'End enclosure' },
      { insert: c(0x1343E), name: 'Begin walled enclosure' },
      { insert: c(0x1343F), name: 'End walled enclosure' },
    ],
  },
  {
    title: 'Blanks & lacunae',
    controls: [
      { insert: c(0x13441), name: 'Full blank (MdC ..)' },
      { insert: c(0x13442), name: 'Half blank (MdC .)' },
      { insert: c(0x13443), name: 'Full lost sign (MdC //)' },
      { insert: c(0x13444), name: 'Half lost sign (MdC /)' },
      { insert: c(0x13445), name: 'Tall lost sign (MdC v/)' },
      { insert: c(0x13446), name: 'Wide lost sign (MdC h/)' },
      { insert: c(0x13443) + c(0xFE00), glyph: c(0x13443), name: 'Expanding lost region (fills the whole group)' },
    ],
  },
  {
    title: 'Mirror & rotate',
    controls: [
      { insert: c(0x13440), name: 'Mirror horizontally (MdC \\)' },
      { insert: c(0xFE00), label: '90°', name: 'Rotate 90° (VS1)' },
      { insert: c(0xFE01), label: '180°', name: 'Rotate 180° (VS2)' },
      { insert: c(0xFE02), label: '270°', name: 'Rotate 270° (VS3)' },
      { insert: c(0xFE03), label: '45°', name: 'Rotate 45° (VS4)' },
    ],
  },
  {
    title: 'Damage',
    controls: Array.from({ length: 15 }, (_, i) => ({
      insert: c(0x13447 + i),
      name: `Damaged: ${DAMAGE_NAMES[i + 1]}`,
    })),
  },
];
