import { useMemo } from 'react';
import { marked } from 'marked';
import manual from '../../../USER_MANUAL.md?raw';

export default function ManualPage() {
  const html = useMemo(() => marked.parse(manual, { gfm: true }), []);
  return (
    <div className="page manual-page">
      <article className="card manual" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
