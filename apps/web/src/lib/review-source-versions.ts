type Source = { id: string; version?: string };
type Reference = { documentId: string; version?: string };

/** Keep the version seen when selecting a reference, never the current list version. */
export function expectedReviewSources(sources: Source[], references: Reference[]): Array<{ id: string; version: string }> {
  const expected = [...sources, ...references.map(r => ({ id: r.documentId, version: r.version }))];
  const unique = new Map<string, { id: string; version: string }>();
  for (const source of expected) if (source.version) unique.set(`${source.id}:${source.version}`, { id: source.id, version: source.version });
  return [...unique.values()];
}

/** An unavailable list is unknown; the server still checks expected versions on save. */
export function reviewSourcesChanged(expected: Source[], current: Source[] | undefined): boolean {
  return !!current && expected.some(source => !!source.version && current.find(d => d.id === source.id)?.version !== source.version);
}
