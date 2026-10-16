import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { APP_INFO, APP_NAME, CHANGELOG, COPYRIGHT, LICENSE_URL } from "@/app/appInfo";
import { type AboutTab, useUiStore } from "@/app/uiStore";
import { t } from "@/i18n";
import { openExternal } from "@/platform/links";
import { Modal } from "@/ui/common/Modal";

/**
 * À propos : version, mainteneur, licence (mentions légales exigées par la GPL pour une interface
 * interactive) et notes de version de toutes les versions jusqu'à celle installée.
 */
export function AboutDialog() {
  const tab = useUiStore((s) => s.about);
  const setAbout = useUiStore((s) => s.setAbout);
  if (!tab) return null;

  const tabs: { id: AboutTab; label: string }[] = [
    { id: "about", label: t("about.tab.about") },
    { id: "changes", label: t("about.tab.changes") },
  ];

  return (
    <Modal
      title={t("about.title")}
      onClose={() => setAbout(null)}
      footer={
        <>
          <div className="flex-1" />
          <button
            type="button"
            className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700"
            onClick={() => setAbout(null)}
          >
            {t("common.close")}
          </button>
        </>
      }
    >
      <div role="tablist" className="mb-3 flex gap-1 border-b border-neutral-200 dark:border-neutral-700">
        {tabs.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={tab === x.id}
            onClick={() => setAbout(x.id)}
            className={`-mb-px border-b-2 px-3 py-1 text-sm ${
              tab === x.id
                ? "border-blue-600 font-medium text-blue-700 dark:text-blue-400"
                : "border-transparent text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            }`}
          >
            {x.label}
          </button>
        ))}
      </div>
      {tab === "about" ? <About /> : <Changes />}
    </Modal>
  );
}

function About() {
  return (
    <div className="flex flex-col gap-3 text-sm select-text">
      <div className="flex items-center gap-3">
        <img src="/favicon.svg" alt="" className="size-14" />
        <div>
          <p className="text-lg font-semibold">{APP_NAME}</p>
          <p className="text-neutral-600 dark:text-neutral-300">{t("about.version", { version: APP_INFO.version })}</p>
        </div>
      </div>
      <p>{t("about.description")}</p>
      <p>{t("about.maintainer", { name: APP_INFO.author })}</p>
      <div className="flex gap-4">
        <Link url={APP_INFO.homepage}>{t("about.repository")}</Link>
        <Link url={APP_INFO.bugs}>{t("about.issues")}</Link>
      </div>
      <div className="flex flex-col gap-1 border-t border-neutral-200 pt-3 text-xs text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
        <p>{COPYRIGHT}</p>
        <p>{t("about.legal")}</p>
        <Link url={LICENSE_URL}>{t("about.license")}</Link>
        <p>{t("about.font")}</p>
      </div>
    </div>
  );
}

function Changes() {
  if (!CHANGELOG.length) return <p className="text-sm text-neutral-500">{t("about.noChanges")}</p>;
  return (
    <div className="flex max-h-[24rem] flex-col gap-4 overflow-auto pr-1 text-sm select-text">
      {CHANGELOG.map((entry) => (
        <section key={entry.version}>
          <h3 className="flex items-baseline gap-2">
            <span className="font-semibold">{entry.version}</span>
            {entry.date && <span className="text-xs text-neutral-500 dark:text-neutral-400">{entry.date}</span>}
            {entry.version === APP_INFO.version && (
              <span className="rounded bg-blue-100 px-1.5 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                {t("about.installed")}
              </span>
            )}
          </h3>
          {entry.sections.map((section, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: liste en lecture seule, jamais réordonnée
            <div key={i} className="mt-1.5">
              {section.title && (
                <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">{section.title}</p>
              )}
              <ul className="ml-4 list-disc">
                {section.items.map((item, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: liste en lecture seule, jamais réordonnée
                  <li key={j}>
                    <Inline text={item} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

/** Markdown en ligne minimal : `code` et **gras** ; le reste est du texte. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((part, i) =>
        part.startsWith("`") && part.endsWith("`") && part.length > 1 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: liste en lecture seule, jamais réordonnée
          <code key={i} className="rounded bg-neutral-100 px-1 text-[0.85em] dark:bg-neutral-800">
            {part.slice(1, -1)}
          </code>
        ) : part.startsWith("**") && part.endsWith("**") && part.length > 3 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: liste en lecture seule, jamais réordonnée
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : (
          part
        ),
      )}
    </>
  );
}

function Link({ url, children }: { url: string; children: ReactNode }) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 self-start text-blue-600 hover:underline dark:text-blue-400"
      onClick={() => void openExternal(url)}
    >
      {children}
      <ExternalLink size={12} aria-hidden />
    </button>
  );
}
