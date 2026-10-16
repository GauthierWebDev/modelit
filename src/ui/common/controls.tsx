import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePreferencesStore } from "@/app/preferencesStore";
import { t } from "@/i18n";
import { tip } from "./Tooltip";

/** Contrôles de formulaire communs aux panneaux. */

export const inputClass =
  "w-full min-w-0 rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-neutral-600 dark:bg-neutral-800";

/**
 * Champ texte validé à la sortie du champ ou sur Entrée. `onCommit` peut renvoyer
 * un message d'erreur : la saisie est alors conservée et l'erreur affichée.
 * Échap rétablit la valeur d'origine. `autoSelect` : texte sélectionné à la prise du focus
 * automatique ; `onEnter` : appelé après Entrée, si la saisie est acceptée.
 */
export function CommitInput({
  value,
  onCommit,
  placeholder,
  className = "",
  autoFocus,
  autoSelect,
  onEnter,
}: {
  value: string;
  onCommit: (value: string) => string | null | void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  autoSelect?: boolean;
  onEnter?: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  /** Sélection du texte à faire une seule fois, à la prise du focus automatique. */
  const pendingSelect = useRef(autoSelect);
  useEffect(() => {
    setDraft(value);
    setError(null);
  }, [value]);

  /** Vrai si la saisie est acceptée (ou inchangée). */
  const commit = () => {
    const next = draft === value ? null : (onCommit(draft) ?? null);
    setError(next);
    return next === null;
  };

  return (
    <div className={`min-w-0 ${className}`}>
      <input
        className={`${inputClass} ${error ? "border-red-500 focus:border-red-500 focus:ring-red-500" : ""}`}
        value={draft}
        placeholder={placeholder}
        autoFocus={autoFocus}
        ref={(input) => {
          if (!input || !pendingSelect.current || input !== document.activeElement) return;
          pendingSelect.current = false;
          input.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" && commit()) onEnter?.();
          if (e.key === "Escape") {
            setDraft(value);
            setError(null);
          }
        }}
      />
      {error && <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

export function NumberInput({
  value,
  onCommit,
  min,
  className = "",
}: {
  value: number | undefined;
  onCommit: (value: number | undefined) => void;
  min?: number;
  className?: string;
}) {
  return (
    <CommitInput
      className={className}
      value={value === undefined ? "" : String(value)}
      onCommit={(v) => {
        if (v.trim() === "") return onCommit(undefined);
        const n = Number(v);
        if (!Number.isInteger(n) || (min !== undefined && n < min)) return t("common.integerExpected");
        onCommit(n);
      }}
    />
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
  tooltip,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  tooltip?: string;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-sm select-none" {...tip(tooltip)}>
      <input type="checkbox" className="accent-blue-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  className = "",
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <select className={`${inputClass} ${className}`} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid grid-cols-[7rem_1fr] items-start gap-2 text-sm">
      <span className="pt-0.5 text-neutral-500 dark:text-neutral-400">{label}</span>
      {children}
    </label>
  );
}

const sectionTitle = "text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400";

/**
 * Bloc titré d'une section. `collapsible` : identifiant d'un bloc repliable (O-50), replié par
 * défaut, dont l'état est mémorisé dans les options du poste ; `summary` s'affiche à côté du
 * titre (ex. un nombre), utile surtout replié.
 */
export function Section({
  title,
  children,
  actions,
  collapsible,
  summary,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  collapsible?: string;
  summary?: ReactNode;
}) {
  const stored = usePreferencesStore((s) => (collapsible ? s.disclosures[collapsible] : undefined));
  const open = !collapsible || stored === true;
  return (
    <section className="border-b border-neutral-200 px-3 py-3 dark:border-neutral-700">
      <div className={`flex items-center justify-between ${open ? "mb-2" : ""}`}>
        {collapsible ? <DisclosureToggle id={collapsible} open={open} title={title} summary={summary} /> : <h3 className={sectionTitle}>{title}</h3>}
        {open && actions}
      </div>
      {open && <div className="flex flex-col gap-2">{children}</div>}
    </section>
  );
}

/** Bloc repliable à l'intérieur d'un autre (ex. « Avancé » d'une rubrique). */
export function Disclosure({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const open = usePreferencesStore((s) => s.disclosures[id] === true);
  return (
    <div className="flex flex-col gap-1">
      <DisclosureToggle id={id} open={open} title={title} />
      {open && <div className="flex flex-col gap-1 pl-4">{children}</div>}
    </div>
  );
}

/**
 * En-tête cliquable d'un bloc repliable. Pas un <button> : il reste utilisable dans un
 * formulaire désactivé (session en lecture seule), où l'on consulte sans modifier.
 */
function DisclosureToggle({ id, open, title, summary }: { id: string; open: boolean; title: string; summary?: ReactNode }) {
  const toggle = () => usePreferencesStore.getState().setDisclosure(id, !open);
  return (
    <span
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        toggle();
      }}
      className={`flex cursor-pointer items-center gap-1 select-none hover:text-neutral-800 dark:hover:text-neutral-200 ${sectionTitle}`}
    >
      <ChevronRight size={12} className={`transition-transform ${open ? "rotate-90" : ""}`} />
      {title}
      {summary !== undefined && <span className="font-normal tracking-normal normal-case">{summary}</span>}
    </span>
  );
}

export function ErrorBanner({ message, onClose }: { message: string | null; onClose: () => void }) {
  if (!message) return null;
  return (
    <div className="mx-3 mt-3 flex items-start gap-2 rounded border border-red-300 bg-red-50 px-2 py-1.5 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
      <span className="flex-1">{message}</span>
      <button className="text-red-500 hover:text-red-700" onClick={onClose} aria-label={t("common.close")}>
        ×
      </button>
    </div>
  );
}

/**
 * Bouton icône avec infobulle DOM (override O-20). L'infobulle est portée par un conteneur :
 * un bouton désactivé ne reçoit pas les événements de survol, son conteneur si.
 */
export function IconButton({
  tooltip,
  onClick,
  children,
  active,
  disabled,
}: {
  tooltip: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <span className="inline-flex" {...tip(tooltip)}>
      <button
        type="button"
        aria-label={tooltip}
        disabled={disabled}
        onClick={onClick}
        className={`inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded px-1.5 text-sm transition-colors disabled:pointer-events-none disabled:opacity-35 ${
          active
            ? "bg-blue-600 text-white"
            : "text-neutral-700 hover:bg-neutral-200 dark:text-neutral-200 dark:hover:bg-neutral-700"
        }`}
      >
        {children}
      </button>
    </span>
  );
}
