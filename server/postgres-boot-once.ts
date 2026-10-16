/**
 * One production-shaped boot against DATABASE_URL.
 * The double-boot test spawns this twice so each process runs initDatabase
 * from a cold module cache (the in-process singleton would skip the second seed).
 */
import { initDatabase } from "./db.ts";

initDatabase();
console.log("postgres boot ok");
