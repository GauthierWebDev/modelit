import { enEditor } from "./en/editor";
import { enFiles } from "./en/files";
import { enMenus } from "./en/menus";
import { enSession } from "./en/session";
import type { MessageKey } from "./fr";

/** English catalogue (same keys as `fr.ts`), gathered from the parts of `en/`. Merise terms: CDM / LDM / PDM. */
export const en: Record<MessageKey, string> = { ...enSession, ...enMenus, ...enEditor, ...enFiles };
