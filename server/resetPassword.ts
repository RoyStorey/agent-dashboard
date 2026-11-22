/**
 * Forgot the dashboard password? Stop the dashboard, then run:
 *   npm run reset-password
 * It removes the password (your data is untouched) and saves a backup first.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store, log } from "./store.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(root, "data"));
const store = new Store(dataDir);
if (!store.get().security.passwordHash) {
  console.log("No dashboard password is set. Nothing to do.");
} else {
  const backup = store.createBackup("before-password-reset");
  const next = structuredClone(store.get());
  next.security = { passwordHash: null, passwordSalt: null, passwordUpdatedAt: new Date().toISOString() };
  log(next, "Owner", "warning", "Removed the dashboard password from the command line (npm run reset-password).");
  store.replace(next);
  console.log(`Password removed. Backup saved as ${backup}.`);
  console.log("Start the dashboard again and set a new password under Settings.");
}
