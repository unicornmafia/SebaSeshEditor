import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchSignInfo, fetchSigns, type Sign, type SignCategory } from '../api';
import { asciiToUnicode } from '../translit';

const CATEGORY_KEY = 'sebasesh.pickerCategory';
const EXTENDED_KEY = 'sebasesh.pickerExtended';

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // not essential
  }
}

/**
 * How well a sign matches a search typed as MdC (lower is better), or null if it does not:
 * its MdC code or a shortcut (w, nTr) exactly, then a reading exactly (w finds the quail chick
 * and the coil), then a reading or a name that starts with the search.
 */
function matchRank(sign: Sign, query: string, reading: string): number | null {
  const lower = query.toLowerCase();
  if (sign.mnemonics.includes(query) || sign.mdc?.toLowerCase() === lower || sign.name.toLowerCase() === lower) return 0;
  if (sign.readings.includes(reading)) return 1;
  if (sign.readings.some((r) => r.startsWith(reading))) return 2;
  // Names only once they have a number (G4 -> G4, G40...), so w is not every W sign.
  if ((/\d/.test(query) && sign.name.toLowerCase().startsWith(lower)) || sign.mnemonics.some((m) => m.startsWith(query))) return 3;
  return null;
}

/** Most signs a search shows. */
const MAX_RESULTS = 200;

/** The sign list, fetched once per page load. */
let signList: Promise<SignCategory[]> | null = null;

interface Props {
  /** Double click (or the Insert button): put the sign in the document at the cursor. */
  onInsert: (sign: Sign) => void;
  /** Gives the focus back to the document after using a control that takes it (the category list). */
  onDone: () => void;
}

/**
 * Sign palette, as in JSesh: a Gardiner category, its signs, and the chosen sign's readings.
 * Signs keep the focus where it was (the input line or the glyph cursor), so double clicking
 * inserts at the caret.
 */
export default function GlyphPicker({ onInsert, onDone }: Props) {
  const [categories, setCategories] = useState<SignCategory[] | null>(null);
  const [error, setError] = useState('');
  const [categoryId, setCategoryId] = useState(() => load(CATEGORY_KEY) ?? 'A');
  const [extended, setExtended] = useState(() => load(EXTENDED_KEY) === 'true');
  const [chosen, setChosen] = useState<Sign | null>(null);
  const [query, setQuery] = useState('');
  const [info, setInfo] = useState<{ char: string; html: string } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    signList ??= fetchSigns();
    signList.then(setCategories).catch((err) => {
      signList = null;
      setError((err as Error).message);
    });
  }, []);

  const category = categories?.find((c) => c.id === categoryId) ?? categories?.[0];
  const search = query.trim();
  // A search looks through every category; otherwise the chosen category is shown.
  const { shown, hiddenExtended } = useMemo(() => {
    if (!search) return { shown: category?.signs.filter((s) => extended || !s.extended) ?? [], hiddenExtended: 0 };
    // MdC transliteration as the readings are written (nTr -> nṯr); q is also ḳ.
    const reading = asciiToUnicode(search.replace(/q/g, 'K'));
    const found: { sign: Sign; rank: number; order: number }[] = [];
    let order = 0;
    let hidden = 0;
    for (const c of categories ?? []) {
      for (const sign of c.signs) {
        const rank = matchRank(sign, search, reading);
        if (rank === null) continue;
        if (sign.extended && !extended) {
          hidden++;
          continue;
        }
        found.push({ sign, rank, order: order++ });
      }
    }
    found.sort((a, b) => a.rank - b.rank || a.order - b.order);
    return { shown: found.slice(0, MAX_RESULTS).map((f) => f.sign), hiddenExtended: hidden };
  }, [category, categories, extended, search]);

  useEffect(() => {
    gridRef.current?.scrollTo({ top: 0 });
  }, [categoryId, extended, search]);

  useEffect(() => {
    if (!chosen) return;
    const char = chosen.char;
    const controller = new AbortController();
    fetchSignInfo(char, controller.signal)
      .then((html) => setInfo({ char, html }))
      .catch(() => undefined);
    return () => controller.abort();
  }, [chosen]);

  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

  return (
    <aside className="glyph-picker" aria-label="Hieroglyph picker">
      <div className="picker-head">
        <select className="form-select form-select-sm" aria-label="Sign category" value={category?.id ?? categoryId}
          disabled={!categories}
          title={search ? 'Showing the search results from every category; choose a category to leave the search' : undefined}
          onChange={(e) => {
            setQuery('');
            setCategoryId(e.target.value);
            store(CATEGORY_KEY, e.target.value);
            onDone();
          }}>
          {(categories ?? [{ id: categoryId, description: '', signs: [] }]).map((c) => (
            <option key={c.id} value={c.id}>{c.id}{c.description ? ` – ${c.description}` : ''}</option>
          ))}
        </select>
        <label className="picker-extended" title="Also show the signs added to Unicode in 2024 (Egyptian Hieroglyphs Extended-A)"
          onMouseDown={keepFocus}>
          <input type="checkbox" checked={extended} onMouseDown={keepFocus}
            onChange={(e) => {
              setExtended(e.target.checked);
              store(EXTENDED_KEY, String(e.target.checked));
            }} />
          <span>Extended</span>
        </label>
      </div>

      <div className="picker-search">
        <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
        <input type="search" className="form-control form-control-sm" placeholder="Find by MdC: w, nTr, G17…"
          aria-label="Find signs by MdC code or transliteration" value={query} spellCheck={false}
          autoCapitalize="off" autoCorrect="off" autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && shown.length) {
              // Enter inserts the best match.
              e.preventDefault();
              setChosen(shown[0]);
              onInsert(shown[0]);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              if (query) setQuery('');
              else onDone();
            }
          }} />
      </div>

      <div ref={gridRef} className="picker-grid" role="listbox" aria-label="Signs">
        {error && <div className="picker-message text-danger">Could not load the signs: {error}</div>}
        {!error && !categories && <div className="picker-message text-muted"><i className="fa-solid fa-spinner fa-spin me-1" />Loading signs…</div>}
        {search && categories && !shown.length && (
          <div className="picker-message text-muted">No sign for “{search}”.</div>
        )}
        {search && hiddenExtended > 0 && (
          <div className="picker-message text-muted">
            {hiddenExtended} more among the extended signs (tick Extended).
          </div>
        )}
        {shown.map((s) => (
          <button key={s.char} type="button" role="option" aria-selected={chosen?.char === s.char}
            className={`picker-sign${chosen?.char === s.char ? ' chosen' : ''}`}
            title={`${s.name}${s.readings.length ? ` – ${s.readings.slice(0, 3).join(', ')}` : ''}\nDouble-click to insert`}
            onMouseDown={keepFocus}
            onClick={() => setChosen(s)}
            onDoubleClick={() => { setChosen(s); onInsert(s); }}>
            <span className="picker-glyph">{s.char}</span>
            <span className="picker-name">{s.name}</span>
          </button>
        ))}
      </div>

      <div className="picker-detail" aria-live="polite">
        {chosen ? (
          <>
            <div className="picker-detail-head">
              <span className="picker-detail-glyph">{chosen.char}</span>
              <div className="picker-detail-names">
                <div className="picker-detail-name">{chosen.name}</div>
                <div className="small text-muted">
                  {chosen.mdc ? <>MdC <code>{[chosen.mdc, ...chosen.mnemonics].join(', ')}</code></>
                    : 'No MdC code: inserted as Unicode'}
                </div>
              </div>
              <button type="button" className="btn btn-sm btn-outline-primary ms-auto" title="Insert at the cursor (or double-click the sign)"
                onMouseDown={keepFocus} onClick={() => onInsert(chosen)}>
                Insert
              </button>
            </div>
            {chosen.readings.length > 0 && (
              <div className="picker-readings">{chosen.readings.join(', ')}</div>
            )}
            {info?.char === chosen.char && info.html && (
              // From hieropy's sign descriptions, reduced on the server to list and emphasis tags.
              <div className="picker-info" dangerouslySetInnerHTML={{ __html: info.html }} />
            )}
          </>
        ) : (
          <div className="text-muted small">Click a sign to see its readings; double-click to insert it at the cursor.</div>
        )}
      </div>
    </aside>
  );
}
