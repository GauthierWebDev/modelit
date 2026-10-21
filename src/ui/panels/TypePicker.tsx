import { DATA_TYPE_KINDS, type DataType, type DataTypeKind, defaultDataType } from "@core/index";
import { t } from "@/i18n";
import { CommitInput, inputClass, NumberInput } from "@/ui/common/controls";
import { tip } from "@/ui/common/Tooltip";

/** Choix du type conceptuel d'une rubrique. */
export function TypePicker({
  value,
  onChange,
}: {
  value: DataType | undefined;
  onChange: (t: DataType | undefined) => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-start gap-1">
      <select
        className={`${inputClass} w-28 flex-none`}
        value={value?.kind ?? ""}
        onChange={(e) => onChange(e.target.value ? defaultDataType(e.target.value as DataTypeKind) : undefined)}
      >
        <option value="">{t("type.untyped")}</option>
        {(["text", "numeric", "datetime", "other"] as const).map((group) => (
          <optgroup key={group} label={t(`type.group.${group}`)}>
            {DATA_TYPE_KINDS.filter((k) => k.group === group).map((k) => (
              <option key={k.kind} value={k.kind}>
                {t(`type.${k.kind}`)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {value ? <TypeParameters value={value} onChange={onChange} /> : null}
    </div>
  );
}

function TypeParameters({ value, onChange }: { value: DataType; onChange: (t: DataType) => void }) {
  const small = `${inputClass} w-auto flex-none`;
  switch (value.kind) {
    case "text":
      return (
        <>
          <select
            className={small}
            value={value.encoding}
            onChange={(e) => onChange({ ...value, encoding: e.target.value as typeof value.encoding })}
          >
            <option value="ascii">{t("type.ascii")}</option>
            <option value="unicode">{t("type.unicode")}</option>
            <option value="binary">{t("type.binary")}</option>
          </select>
          <select
            className={small}
            value={value.length}
            onChange={(e) => onChange({ ...value, length: e.target.value as typeof value.length })}
          >
            <option value="variable">{t("type.variable")}</option>
            <option value="fixed">{t("type.fixed")}</option>
            <option value="large">{t("type.large")}</option>
          </select>
          {value.length !== "large" && (
            <span className="inline-flex" {...tip(t("type.length"))}>
              <NumberInput
                className="w-14 flex-none"
                min={1}
                value={value.size}
                onCommit={(size) => onChange({ ...value, size })}
              />
            </span>
          )}
        </>
      );
    case "integer":
      return (
        <select
          className={small}
          value={value.bits}
          onChange={(e) => onChange({ ...value, bits: Number(e.target.value) as typeof value.bits })}
        >
          {[8, 16, 32, 64].map((b) => (
            <option key={b} value={b}>
              {t("type.bits", { n: b })}
            </option>
          ))}
        </select>
      );
    case "decimal":
      return (
        <>
          <span className="inline-flex" {...tip(t("type.precision"))}>
            <NumberInput
              className="w-12 flex-none"
              min={1}
              value={value.precision}
              onCommit={(p) => onChange({ ...value, precision: p ?? 15 })}
            />
          </span>
          <span className="inline-flex" {...tip(t("type.scale"))}>
            <NumberInput
              className="w-12 flex-none"
              min={0}
              value={value.scale}
              onCommit={(s) => onChange({ ...value, scale: s ?? 0 })}
            />
          </span>
        </>
      );
    case "real":
      return (
        <select
          className={small}
          value={value.precision}
          onChange={(e) => onChange({ ...value, precision: e.target.value as typeof value.precision })}
        >
          <option value="single">{t("type.single")}</option>
          <option value="double">{t("type.double")}</option>
        </select>
      );
    case "datetime":
      return (
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={value.withTimeZone}
            onChange={(e) => onChange({ ...value, withTimeZone: e.target.checked })}
          />
          {t("type.timezone")}
        </label>
      );
    case "free":
      return (
        <CommitInput
          className="w-28 flex-none"
          value={value.sql}
          placeholder={t("type.freePlaceholder")}
          onCommit={(sql) => onChange({ ...value, sql })}
        />
      );
    default:
      return null;
  }
}
