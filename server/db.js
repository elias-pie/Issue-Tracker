import fs from "fs";
import path from "path";

const DB_PATH = path.resolve("db.json");
const EMPTY_DB = { users: [], groups: [], groupMembers: [], issues: [], invites: [], applications: [] };

function ensureDb() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(EMPTY_DB, null, 2), "utf8");
  }
}

export function readDb() {
  ensureDb();
  const db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  if (!db.users) db.users = [];
  if (!db.groups) db.groups = [];
  if (!db.groupMembers) db.groupMembers = [];
  if (!db.issues) db.issues = [];
  if (!db.invites) db.invites = [];
  if (!db.applications) db.applications = [];
  return db;
}

export function writeDb(next) {
  fs.writeFileSync(DB_PATH, JSON.stringify(next, null, 2), "utf8");
}
