import changelogMarkdown from "../../CHANGELOG.md?raw";
import { parseChangelog } from "./changelog";

/** Identité de l'application (À propos) : package.json, et notes de version de CHANGELOG.md. */
export const APP_NAME = "ModelIt";
export const APP_INFO = __APP_INFO__;
export const COPYRIGHT = `© 2026 ${APP_INFO.author}`;
export const LICENSE_URL = "https://www.gnu.org/licenses/gpl-3.0.html";
export const CHANGELOG = parseChangelog(changelogMarkdown);
