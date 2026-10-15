import { IDENTITY_COLORS, randomName } from "@/app/collab/identity";
import { usePreferencesStore } from "@/app/preferencesStore";
import { t } from "@/i18n";
import { CommitInput, Field } from "@/ui/common/controls";

/** Identité en session collaborative (O-05 §3) : nom affiché et couleur, propres au poste. */
export function IdentityOptions() {
  const identity = usePreferencesStore((s) => s.identity);
  const setIdentity = usePreferencesStore((s) => s.setIdentity);
  return (
    <>
      <Field label={t("collab.name")}>
        <CommitInput value={identity.name} placeholder={randomName(identity.seed)} onCommit={(name) => void setIdentity({ name: name.trim() })} />
      </Field>
      <Field label={t("collab.color")}>
        <div role="radiogroup" aria-label={t("collab.color")} className="flex flex-wrap gap-1.5">
          {IDENTITY_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={identity.color === color}
              aria-label={color}
              onClick={() => setIdentity({ color })}
              className={`h-5 w-5 rounded-full ${identity.color === color ? "ring-2 ring-neutral-900 ring-offset-1 dark:ring-white dark:ring-offset-neutral-900" : ""}`}
              style={{ background: color }}
            />
          ))}
        </div>
      </Field>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("collab.identityHelp")}</p>
    </>
  );
}
