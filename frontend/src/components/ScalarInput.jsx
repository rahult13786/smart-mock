import { useEffect, useState } from 'react';
import { coerce } from '../util/value.js';

const fmt = (v) => (v === null || v === undefined ? '' : String(v));

export default function ScalarInput({ value, onChange, readOnly, multiline, compact, options }) {
  const [text, setText] = useState(fmt(value));

  useEffect(() => {
    if (coerce(text, value) !== value) setText(fmt(value));
  }, [value]);

  if (readOnly) {
    return <span className={`value readonly-value ${compact ? 'compact' : ''}`} title={fmt(value)}>{fmt(value)}</span>;
  }

  if (options && options.length) {
    const key = (v) => JSON.stringify(v ?? null);
    const current = key(value);
    const known = options.some((o) => key(o) === current);
    return (
      <select
        className={`value enum ${compact ? 'compact' : ''} ${!known && value != null ? 'not-allowed' : ''}`}
        value={current}
        title="Allowed values only"
        onChange={(e) => onChange(JSON.parse(e.target.value))}
      >
        {value == null && <option value="null">(not set)</option>}
        {!known && value != null && <option value={current}>{String(value)} (not allowed)</option>}
        {options.map((o) => (
          <option key={key(o)} value={key(o)}>{String(o)}</option>
        ))}
      </select>
    );
  }

  if (typeof value === 'boolean') {
    return (
      <select className={`value ${compact ? 'compact' : ''}`} value={String(value)} onChange={(e) => onChange(e.target.value === 'true')}>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }

  const handle = (e) => {
    setText(e.target.value);
    onChange(coerce(e.target.value, value));
  };

  if (multiline && typeof value === 'string' && value.length > 60) {
    return <textarea className="value" rows={Math.min(6, Math.ceil(value.length / 70))} value={text} onChange={handle} />;
  }

  return (
    <input
      className={`value ${compact ? 'compact' : ''} ${typeof value === 'number' ? 'num' : ''}`}
      value={text}
      title={text}
      placeholder={value === null ? 'null' : ''}
      inputMode={typeof value === 'number' ? 'decimal' : undefined}
      onChange={handle}
    />
  );
}
