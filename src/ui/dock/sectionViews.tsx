import type { ComponentType } from "react";
import type { SectionId } from "@/app/dock/layout";
import { t } from "@/i18n";
import { ModelSection, PropertiesSection } from "@/ui/panels/Inspector";
import { IssuesSection, IssuesTitle, MldSection, MldTitle, SqlSection, SqlTitle } from "@/ui/panels/OutputPanel";

/** Contenu et libellé d'onglet de chaque section (override O-46). */
export const SECTION_VIEWS: Record<SectionId, { Title: ComponentType; Body: ComponentType }> = {
  properties: { Title: () => <>{t("dock.section.properties")}</>, Body: PropertiesSection },
  model: { Title: () => <>{t("dock.section.model")}</>, Body: ModelSection },
  mld: { Title: MldTitle, Body: MldSection },
  sql: { Title: SqlTitle, Body: SqlSection },
  issues: { Title: IssuesTitle, Body: IssuesSection },
};

/** Libellé simple d'une section (menus). */
export const sectionLabel = (id: SectionId) =>
  ({
    properties: t("dock.section.properties"),
    model: t("dock.section.model"),
    mld: t("output.mld"),
    sql: t("output.sql", { dbms: "" }).replace(/\s*·\s*$/, ""),
    issues: t("output.issues"),
  })[id];
