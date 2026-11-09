// error reports first, so an error while the rest starts up is reported too
import "./app/reports.ts";
import "./app/visits.ts";
import "./features/index.ts";
import { App } from "./app/app.ts";
import { startLanguage } from "./app/i18n.ts";

// the interface's language first, so the editor isn't seen in English before it
void startLanguage().then(() => new App().start());
