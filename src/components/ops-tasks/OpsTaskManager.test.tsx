import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OpsTaskForm } from "./OpsTaskForm";
import { OpsTaskManager } from "./OpsTaskManager";

describe("OpsTaskManager", () => {
  it("renders project and event links for related task records", () => {
    const html = renderToStaticMarkup(
      <OpsTaskManager
        initialTasks={[
          {
            id: "task-1",
            task_name: "Confirm load-in",
            status: "todo",
            project_id: "project-1",
            project_name: "Autumn tour",
            event_id: "event-1",
            event_title: "Vega",
          },
        ]}
        artists={[]}
        releases={[]}
        campaigns={[]}
        contacts={[]}
        projects={[{ id: "project-1", name: "Autumn tour" }]}
        events={[{ id: "event-1", title: "Vega", start_date: "2026-08-20" }]}
      />,
    );

    expect(html).toContain('href="/projects/project-1"');
    expect(html).toContain('href="/events/event-1"');
    expect(html).toContain("Autumn tour");
    expect(html).toContain("Vega");
  });

  it("offers event options in the task create surface", () => {
    const html = renderToStaticMarkup(
      <OpsTaskForm
        artists={[]}
        releases={[]}
        campaigns={[]}
        contacts={[]}
        projects={[]}
        events={[{ id: "event-1", title: "Vega", start_date: "2026-08-20" }]}
        onClose={() => undefined}
      />,
    );

    expect(html).toContain("Event");
    expect(html).toContain("Vega (2026-08-20)");
  });
});
