import { beforeEach, describe, expect, it, vi } from "vitest";
import PublicSchoolPage from "./page";

const mocks = vi.hoisted(() => ({ access: vi.fn(), catalog: vi.fn() }));
vi.mock("@/lib/schools/public", () => ({
  getSchoolForLandingAccess: mocks.access,
  loadSchoolCatalog: mocks.catalog,
}));
vi.mock("@/components/booking-chat", () => ({ BookingChat: "booking-chat" }));
vi.mock("@/components/landing-session", () => ({ LandingSession: "landing-session" }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not_found");
  },
}));

const school = {
  id: "school-id",
  slug: "demo",
  name: "Demo",
  address: "123 Main St",
  city: "London",
  welcomeMessage: "Welcome!",
  approvedAt: new Date(),
  publishedAt: new Date(),
  notificationEmail: "private@example.com",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue(school);
  mocks.catalog.mockResolvedValue({ offerings: [] });
});

describe("public school page", () => {
  it("does not load the catalog when access is denied", async () => {
    mocks.access.mockResolvedValue(null);
    await expect(
      PublicSchoolPage({
        params: Promise.resolve({ slug: "demo" }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("not_found");
    expect(mocks.access).toHaveBeenCalledWith("demo", { preview: false });
    expect(mocks.catalog).not.toHaveBeenCalled();
  });

  it.each([false, true])("passes preview=%s through the shared access check", async (preview) => {
    const page = await PublicSchoolPage({
      params: Promise.resolve({ slug: "demo" }),
      searchParams: Promise.resolve(preview ? { preview: "1" } : {}),
    });
    expect(mocks.access).toHaveBeenCalledWith("demo", { preview });
    expect(mocks.catalog).toHaveBeenCalledWith(school.id);
    const children = page.props.children as Array<{ type: string; props: unknown } | null>;
    expect(children.find((child) => child?.type === "booking-chat")?.props).toEqual({
      slug: "demo",
      schoolName: "Demo",
      location: "123 Main St, London",
      offerings: [],
      welcomeMessage: "Welcome!",
      preview,
    });
    expect(children.find((child) => child?.type === "landing-session")?.props).toEqual({
      slug: "demo",
      preview,
    });
  });
});
