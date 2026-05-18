import cors from "cors";
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import { requireAuth, signToken } from "./auth.js";
import { readDb, writeDb } from "./db.js";

const app = express();
const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || "0.0.0.0";

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.resolve("uploads")));

if (!fs.existsSync("uploads")) fs.mkdirSync("uploads", { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, "uploads"),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === "modelFile") {
      return file.originalname.toLowerCase().endsWith(".3mf")
        ? cb(null, true)
        : cb(new Error("Only .3mf files allowed for print profile."));
    }
    if (file.fieldname === "imageFile") {
      return file.mimetype.startsWith("image/")
        ? cb(null, true)
        : cb(new Error("Only image files allowed."));
    }
    cb(null, false);
  }
});

function isMember(db, groupId, userId) {
  return db.groupMembers.some((m) => m.groupId === groupId && m.userId === userId);
}

function getGroup(db, groupId) {
  return db.groups.find((g) => g.id === groupId);
}

function canAccessGroup(db, groupId, userId) {
  const group = getGroup(db, groupId);
  if (!group) return false;
  return group.visibility === "global" || isMember(db, groupId, userId);
}

function canCreateIssue(db, groupId, userId) {
  const group = getGroup(db, groupId);
  if (!group) return false;
  if (isMember(db, groupId, userId)) return true;
  return group.visibility === "global" && group.allowAllContributors === true;
}

app.post("/api/auth/register", (req, res) => {
  const { username, displayName, password } = req.body;
  if (!username || !displayName || !password) {
    return res.status(400).json({ error: "username, displayName, password required." });
  }
  const db = readDb();
  if (db.users.some((u) => u.username === username)) {
    return res.status(409).json({ error: "Username already exists." });
  }
  const user = {
    id: uuid(),
    username,
    display_name: displayName,
    password_hash: bcrypt.hashSync(password, 10),
    created_at: new Date().toISOString()
  };
  db.users.push(user);
  writeDb(db);
  const token = signToken(user);
  res.json({ token, user: { id: user.id, username, displayName } });
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  const db = readDb();
  const user = db.users.find((u) => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid credentials." });
  }
  const token = signToken(user);
  res.json({
    token,
    user: { id: user.id, username: user.username, displayName: user.display_name }
  });
});

app.get("/api/groups", requireAuth, (req, res) => {
  const db = readDb();
  const membershipByGroup = new Map(
    db.groupMembers.filter((m) => m.userId === req.user.userId).map((m) => [m.groupId, m])
  );
  const groups = db.groups
    .filter((g) => membershipByGroup.has(g.id) || g.visibility === "global")
    .map((g) => {
      const membership = membershipByGroup.get(g.id);
      const myPendingApplication = db.applications.some(
        (a) => a.groupId === g.id && a.userId === req.user.userId && a.status === "pending"
      );
      return {
        ...g,
        isMember: Boolean(membership),
        myRole: membership?.role || null,
        myPendingApplication
      };
    });
  res.json(groups);
});

app.post("/api/groups/:groupId/apply", requireAuth, (req, res) => {
  const { groupId } = req.params;
  const db = readDb();
  const group = getGroup(db, groupId);
  if (!group) return res.status(404).json({ error: "Group not found." });
  if (group.visibility !== "global") {
    return res.status(403).json({ error: "Only global groups can receive open applications." });
  }
  const existing = db.groupMembers.find((m) => m.groupId === groupId && m.userId === req.user.userId);
  if (existing) return res.status(409).json({ error: "You are already a member." });
  const pending = db.applications.find(
    (a) => a.groupId === groupId && a.userId === req.user.userId && a.status === "pending"
  );
  if (pending) return res.status(409).json({ error: "You already have a pending application." });
  db.applications.push({
    id: uuid(),
    groupId,
    userId: req.user.userId,
    status: "pending",
    createdAt: new Date().toISOString()
  });
  writeDb(db);
  res.json({ ok: true });
});

app.get("/api/groups/:groupId/applications", requireAuth, (req, res) => {
  const { groupId } = req.params;
  const db = readDb();
  const actor = db.groupMembers.find((m) => m.groupId === groupId && m.userId === req.user.userId);
  if (!actor || (actor.role !== "owner" && actor.role !== "admin")) {
    return res.status(403).json({ error: "Only owner/admin can review applications." });
  }
  const applications = db.applications
    .filter((a) => a.groupId === groupId && a.status === "pending")
    .map((a) => {
      const u = db.users.find((x) => x.id === a.userId);
      return { ...a, username: u?.username || "unknown", displayName: u?.display_name || "Unknown" };
    });
  res.json(applications);
});

app.post("/api/groups/:groupId/applications/:applicationId/respond", requireAuth, (req, res) => {
  const { groupId, applicationId } = req.params;
  const { action } = req.body;
  if (!["approve", "reject"].includes(action)) {
    return res.status(400).json({ error: "Invalid action." });
  }
  const db = readDb();
  const actor = db.groupMembers.find((m) => m.groupId === groupId && m.userId === req.user.userId);
  if (!actor || (actor.role !== "owner" && actor.role !== "admin")) {
    return res.status(403).json({ error: "Only owner/admin can review applications." });
  }
  const application = db.applications.find((a) => a.id === applicationId && a.groupId === groupId);
  if (!application) return res.status(404).json({ error: "Application not found." });
  if (application.status !== "pending") return res.status(400).json({ error: "Application already handled." });
  application.status = action === "approve" ? "approved" : "rejected";
  application.reviewedBy = req.user.userId;
  application.reviewedAt = new Date().toISOString();
  if (action === "approve") {
    const existing = db.groupMembers.find((m) => m.groupId === groupId && m.userId === application.userId);
    if (!existing) {
      db.groupMembers.push({ groupId, userId: application.userId, role: "member" });
    }
  }
  writeDb(db);
  res.json({ ok: true });
});

app.post("/api/groups", requireAuth, (req, res) => {
  const { name, description = "", visibility = "private", allowAllContributors = false } = req.body;
  if (!name) return res.status(400).json({ error: "Group name required." });
  if (!["private", "global"].includes(visibility)) {
    return res.status(400).json({ error: "Invalid visibility." });
  }
  const db = readDb();
  const group = {
    id: uuid(),
    name,
    description,
    visibility,
    allowAllContributors: Boolean(allowAllContributors),
    ownerId: req.user.userId,
    createdAt: new Date().toISOString()
  };
  db.groups.push(group);
  db.groupMembers.push({ groupId: group.id, userId: req.user.userId, role: "owner" });
  writeDb(db);
  res.status(201).json(group);
});

app.post("/api/groups/:groupId/invites", requireAuth, (req, res) => {
  const { groupId } = req.params;
  const { username, role = "member" } = req.body;
  const db = readDb();
  const actor = db.groupMembers.find((m) => m.groupId === groupId && m.userId === req.user.userId);
  if (!actor || (actor.role !== "owner" && actor.role !== "admin")) {
    return res.status(403).json({ error: "Only owner/admin can send invites." });
  }
  const targetUser = db.users.find((u) => u.username === username);
  if (!targetUser) return res.status(404).json({ error: "User not found." });
  const existing = db.groupMembers.find((m) => m.groupId === groupId && m.userId === targetUser.id);
  if (existing) return res.status(409).json({ error: "User is already a member." });
  const openInvite = db.invites.find(
    (i) => i.groupId === groupId && i.invitedUserId === targetUser.id && i.status === "pending"
  );
  if (openInvite) return res.status(409).json({ error: "Pending invite already exists." });
  db.invites.push({
    id: uuid(),
    groupId,
    invitedUserId: targetUser.id,
    invitedByUserId: req.user.userId,
    role,
    status: "pending",
    createdAt: new Date().toISOString()
  });
  writeDb(db);
  res.json({ ok: true, message: "Invite sent." });
});

app.get("/api/invites", requireAuth, (req, res) => {
  const db = readDb();
  const invites = db.invites
    .filter((i) => i.invitedUserId === req.user.userId && i.status === "pending")
    .map((invite) => {
      const group = db.groups.find((g) => g.id === invite.groupId);
      const inviter = db.users.find((u) => u.id === invite.invitedByUserId);
      return {
        ...invite,
        groupName: group?.name || "Unknown group",
        invitedByName: inviter?.display_name || inviter?.username || "Unknown user"
      };
    });
  res.json(invites);
});

app.post("/api/invites/:inviteId/respond", requireAuth, (req, res) => {
  const { inviteId } = req.params;
  const { action } = req.body;
  if (!["accept", "decline"].includes(action)) {
    return res.status(400).json({ error: "Invalid action." });
  }
  const db = readDb();
  const invite = db.invites.find((i) => i.id === inviteId);
  if (!invite || invite.invitedUserId !== req.user.userId) {
    return res.status(404).json({ error: "Invite not found." });
  }
  if (invite.status !== "pending") {
    return res.status(400).json({ error: "Invite already handled." });
  }
  invite.status = action === "accept" ? "accepted" : "declined";
  invite.respondedAt = new Date().toISOString();
  if (action === "accept") {
    const existing = db.groupMembers.find(
      (m) => m.groupId === invite.groupId && m.userId === invite.invitedUserId
    );
    if (!existing) {
      db.groupMembers.push({
        groupId: invite.groupId,
        userId: invite.invitedUserId,
        role: invite.role || "member"
      });
    }
  }
  writeDb(db);
  res.json({ ok: true });
});

app.get("/api/groups/:groupId/issues", requireAuth, (req, res) => {
  const { groupId } = req.params;
  const db = readDb();
  if (!canAccessGroup(db, groupId, req.user.userId)) {
    return res.status(403).json({ error: "No access to this group." });
  }
  const issues = db.issues
    .filter((i) => i.group_id === groupId)
    .map((issue) => {
      const creator = db.users.find((u) => u.id === issue.created_by);
      return { ...issue, createdByName: creator?.display_name || "Unknown" };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  res.json(issues);
});

app.post(
  "/api/groups/:groupId/issues",
  requireAuth,
  upload.fields([
    { name: "imageFile", maxCount: 1 },
    { name: "modelFile", maxCount: 1 }
  ]),
  (req, res) => {
    const { groupId } = req.params;
    const db = readDb();
    if (!canCreateIssue(db, groupId, req.user.userId)) {
      return res.status(403).json({ error: "You cannot create issues in this group." });
    }
    const { title, description, status = "open", priority = "medium", referenceLink, proposedSolution } =
      req.body;
    if (!title || !description) return res.status(400).json({ error: "title and description required." });

    const image = req.files?.imageFile?.[0];
    const model = req.files?.modelFile?.[0];
    const now = new Date().toISOString();
    const issue = {
      id: uuid(),
      group_id: groupId,
      title,
      description,
      status,
      priority,
      reference_link: referenceLink || null,
      proposed_solution: proposedSolution || null,
      image_path: image ? `/uploads/${image.filename}` : null,
      model_path: model ? `/uploads/${model.filename}` : null,
      created_by: req.user.userId,
      created_at: now,
      updated_at: now
    };
    db.issues.push(issue);
    writeDb(db);
    res.status(201).json(issue);
  }
);

app.put("/api/issues/:issueId", requireAuth, (req, res) => {
  const { issueId } = req.params;
  const db = readDb();
  const issue = db.issues.find((i) => i.id === issueId);
  if (!issue) return res.status(404).json({ error: "Issue not found." });
  if (!canAccessGroup(db, issue.group_id, req.user.userId)) {
    return res.status(403).json({ error: "No access to this group." });
  }
  issue.status = req.body.status ?? issue.status;
  issue.priority = req.body.priority ?? issue.priority;
  issue.proposed_solution = req.body.proposedSolution ?? issue.proposed_solution;
  issue.updated_at = new Date().toISOString();
  writeDb(db);
  res.json({ ok: true });
});

app.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message || "Unexpected error." });
});

app.listen(PORT, HOST, () => console.log(`Server running on http://${HOST}:${PORT}`));
