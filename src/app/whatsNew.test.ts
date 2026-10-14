import { beforeEach, describe, expect, it } from "vitest";
import { APP_INFO, CHANGELOG } from "./appInfo";
import { usePreferencesStore } from "./preferencesStore";
import { useUiStore } from "./uiStore";
import { showWhatsNew } from "./updates";

describe("nouveautés après une mise à jour", () => {
  beforeEach(() => useUiStore.setState({ about: null }));

  it("première installation : rien n'est montré, la version est retenue", () => {
    usePreferencesStore.setState({ lastSeenVersion: "" });
    showWhatsNew();
    expect(useUiStore.getState().about).toBeNull();
    expect(usePreferencesStore.getState().lastSeenVersion).toBe(APP_INFO.version);
  });

  it("nouvelle version : les nouveautés sont montrées une seule fois", () => {
    expect(CHANGELOG.some((e) => e.version === APP_INFO.version)).toBe(true);
    usePreferencesStore.setState({ lastSeenVersion: "0.0.1" });
    showWhatsNew();
    expect(useUiStore.getState().about).toBe("changes");
    useUiStore.setState({ about: null });
    showWhatsNew();
    expect(useUiStore.getState().about).toBeNull();
  });
});
