import { describe, expect, test, beforeEach } from "@jest/globals";
import { AiSettingsService } from "../services/ai/aiSettingsService";

describe("AI settings service", () => {
  beforeEach(() => {
    process.env.AI_SETTINGS_ENCRYPTION_KEY = "settings-service-test-key";
  });

  test("settings save stores printershero_managed as canonical mode", async () => {
    let saved: any = null;
    const repo = {
      getSettings: async () => null,
      recordUsage: async (data: any) => data,
      upsertSettings: async (orgId: string, data: any) => {
        saved = { id: "settings_1", orgId, ...data, createdAt: new Date(), updatedAt: new Date() };
        return saved;
      },
    };
    const service = new AiSettingsService(repo as any);

    const dto = await service.updateSettings("org_1", {
      mode: "printershero_managed",
      provider: "openai",
      model: "gpt-test",
      bugReviewEnabled: true,
    });

    expect(saved.mode).toBe("printershero_managed");
    expect(saved.isEnabled).toBe(true);
    expect(dto.mode).toBe("printershero_managed");
  });

  test("legacy managed mode is rejected for new writes", async () => {
    const service = new AiSettingsService({
      getSettings: async () => null,
      recordUsage: async (data: any) => data,
      upsertSettings: async () => {
        throw new Error("should not save");
      },
    } as any);

    await expect(service.updateSettings("org_1", { mode: "titanos_managed" })).rejects.toThrow();
  });
});
