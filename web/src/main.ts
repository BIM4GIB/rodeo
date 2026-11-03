// error reports first, so an error while the rest starts up is reported too
import "./app/reports.ts";
import "./app/visits.ts";
import "./features/index.ts";
import { App } from "./app/app.ts";

new App().start();
