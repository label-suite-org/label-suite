export type ProjectPersonRecord = { id: string; name: string; kind: "contact" | "organization" | "artist"; role?: string | null; is_primary?: boolean | null };

export function ProjectPeople({ people = [] }: { people?: ProjectPersonRecord[] }) {
  return <section aria-labelledby="project-people-heading"><h2 id="project-people-heading" className="font-semibold">People &amp; organizations</h2>{!people.length ? <p className="mt-3 border border-dashed border-border p-6 text-sm text-muted-foreground">No people or organizations are linked to this project.</p> : <div className="mt-3 grid gap-3 sm:grid-cols-2">{people.map((person) => <div key={`${person.kind}-${person.id}-${person.role || "linked"}`} className="border border-border bg-card p-4"><p className="text-sm font-medium">{person.name}</p><p className="mt-1 text-xs capitalize text-muted-foreground">{person.role || person.kind}{person.is_primary ? " · Primary" : ""}</p></div>)}</div>}</section>;
}
