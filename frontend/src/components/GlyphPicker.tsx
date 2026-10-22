import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchSignInfo, fetchSigns, type Sign, type SignCategory } from '../api';

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
  const shown = useMemo(() => category?.signs.filter((s) => extended || !s.extended) ?? [], [category, extended]);

  useEffect(() => {
    gridRef.current?.scrollTo({ top: 0 });
  }, [categoryId, extended]);

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
          onChange={(e) => {
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

      <div ref={gridRef} className="picker-grid" role="listbox" aria-label="Signs">
        {error && <div className="picker-message text-danger">Could not load the signs: {error}</div>}
        {!error && !categories && <div className="picker-message text-muted"><i className="fa-solid fa-spinner fa-spin me-1" />Loading signs…</div>}
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
