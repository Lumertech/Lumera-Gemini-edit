/**
 * Loaded via `tsx --import` from `npm test` so every test file in the process
 * has the googleapis.com fetch guard before any suite runs.
 */
import { installGoogleCalendarNetworkGuard } from "./google-calendar-http.ts";

installGoogleCalendarNetworkGuard();
