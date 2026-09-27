import { beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({
  createBudgetProject: vi.fn(),
  updateBudgetProject: vi.fn(),
  createContact: vi.fn(),
  createGrant: vi.fn(),
}));

vi.mock("./budget-mutations", async (importOriginal) => ({
  ...await importOriginal<typeof import("./budget-mutations")>(),
  createBudgetProject: services.createBudgetProject,
  updateBudgetProject: services.updateBudgetProject,
}));
vi.mock("./contacts", async (importOriginal) => ({
  ...await importOriginal<typeof import("./contacts")>(),
  createContact: services.createContact,
}));
vi.mock("./grants", async (importOriginal) => ({
  ...await importOriginal<typeof import("./grants")>(),
  createGrant: services.createGrant,
}));

function request(body: unknown, method = "POST") {
  return new Request("https://labels.example/api/test", {
    method,
    headers: { "content-type": "application/json", origin: "https://labels.example" },
    body: JSON.stringify(body),
  });
}

const locals = { orgId: "org-1", membershipRole: "fundraiser" };

describe("fundraiser route happy-path contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    services.createBudgetProject.mockResolvedValue({ ok: true, id: "project-1" });
    services.updateBudgetProject.mockResolvedValue({ ok: true });
    services.createContact.mockResolvedValue({ ok: true, id: "contact-1" });
    services.createGrant.mockResolvedValue({ ok: true, id: "grant-1" });
  });

  it("creates and patches budget projects with projects.mutate", { timeout: 15_000 }, async () => {
    const { POST, PATCH } = await import("../pages/api/budget-projects/index");
    const created = await POST({ request: request({ name: "Video", currency: "DKK" }), locals } as never);
    expect(created.status).toBe(201);
    expect(services.createBudgetProject).toHaveBeenCalledWith("org-1", expect.objectContaining({ name: "Video" }));

    const updated = await PATCH({ request: request({ id: "project-1", name: "Video launch" }, "PATCH"), locals } as never);
    expect(updated.status).toBe(200);
    expect(services.updateBudgetProject).toHaveBeenCalledWith("org-1", expect.objectContaining({ id: "project-1" }));
  });

  it("creates a contact with contacts.mutate", async () => {
    const { POST } = await import("../pages/api/contacts");
    const response = await POST({ request: request({ name: "Fund partner" }), locals } as never);
    expect(response.status).toBe(201);
    expect(services.createContact).toHaveBeenCalledWith("org-1", expect.objectContaining({ name: "Fund partner" }), null);
    const attributed = await POST({ request: request({ name: "Attributed partner" }), locals: { ...locals, user: { id: "fundraiser-user" } } } as never);
    expect(attributed.status).toBe(201);
    expect(services.createContact).toHaveBeenLastCalledWith("org-1", expect.objectContaining({ name: "Attributed partner" }), "fundraiser-user");
  });

  it("creates a grant with fundraising.mutate", async () => {
    const { POST } = await import("../pages/api/grants");
    const response = await POST({ request: request({ name: "Export fund" }), locals } as never);
    expect(response.status).toBe(201);
    expect(services.createGrant).toHaveBeenCalledWith("org-1", expect.objectContaining({ name: "Export fund" }));
  });
});
