import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  AppBar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid2 as Grid,
  Link,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  FormControlLabel,
  useTheme,
  Toolbar,
  Typography
} from "@mui/material";

const BACKEND_ORIGIN = `http://${window.location.hostname}:4000`;
const API = `${BACKEND_ORIGIN}/api`;
const FILES = BACKEND_ORIGIN;

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

function honeycombPattern(lineColor) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="144" height="124" viewBox="0 0 144 124">
      <g fill="none" stroke="${lineColor}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" opacity="0.82">
        <path d="M36 2 L70 21 L70 59 L36 78 L2 59 L2 21 Z"/>
        <path d="M108 2 L142 21 L142 59 L108 78 L74 59 L74 21 Z"/>
        <path d="M72 64 L106 83 L106 121 L72 140 L38 121 L38 83 Z"/>
      </g>
    </svg>
  `;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export default function App() {
  const theme = useTheme();
  const honeycombBase = theme.custom?.honeycombBase || "#eef3f9";
  const honeycombLine = theme.custom?.honeycombLine || "#d9e3f0";
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [user, setUser] = useState(JSON.parse(localStorage.getItem("user") || "null"));
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ username: "", displayName: "", password: "" });
  const [groups, setGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [issues, setIssues] = useState([]);
  const [invites, setInvites] = useState([]);
  const [applications, setApplications] = useState([]);
  const [error, setError] = useState("");
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupForm, setGroupForm] = useState({
    name: "",
    description: "",
    visibility: "private",
    allowAllContributors: false
  });
  const [memberUsername, setMemberUsername] = useState("");
  const [memberDialogOpen, setMemberDialogOpen] = useState(false);
  const [issueDialogOpen, setIssueDialogOpen] = useState(false);
  const [editingIssueId, setEditingIssueId] = useState("");
  const [issueForm, setIssueForm] = useState({
    title: "",
    description: "",
    status: "open",
    priority: "medium",
    referenceLink: "",
    proposedSolution: "",
    imageFile: null,
    modelFile: null
  });

  const selectedGroup = useMemo(
    () => groups.find((g) => g.id === selectedGroupId) || null,
    [groups, selectedGroupId]
  );

  async function safeRequest(url, options = {}) {
    const res = await fetch(url, options);
    const contentType = res.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");
    const data = isJson ? await res.json() : null;
    if (!res.ok) {
      if (isJson) throw new Error(data?.error || "Request failed");
      const text = await res.text();
      const trimmed = text.slice(0, 120).replace(/\s+/g, " ").trim();
      throw new Error(
        `API returned non-JSON response (${res.status}). Usually means backend/proxy is down or stale. ${trimmed}`
      );
    }
    if (!isJson) {
      throw new Error("API returned non-JSON response. Check backend and Vite proxy.");
    }
    return data;
  }

  async function loadGroups() {
    const data = await safeRequest(`${API}/groups`, { headers: authHeaders(token) });
    setGroups(data);
    if (!selectedGroupId && data.length) {
      setSelectedGroupId(data[0].id);
    }
  }

  async function loadInvites() {
    const data = await safeRequest(`${API}/invites`, { headers: authHeaders(token) });
    setInvites(data);
  }

  async function loadIssues(groupId) {
    if (!groupId) return;
    const data = await safeRequest(`${API}/groups/${groupId}/issues`, { headers: authHeaders(token) });
    setIssues(data);
  }

  useEffect(() => {
    if (!token) return;
    loadGroups().catch((e) => setError(e.message));
    loadInvites().catch((e) => setError(e.message));
  }, [token]);

  useEffect(() => {
    if (!token) return undefined;
    const interval = setInterval(() => {
      loadGroups().catch(() => {});
      loadInvites().catch(() => {});
      if (selectedGroupId) {
        loadIssues(selectedGroupId).catch(() => {});
        loadApplications(selectedGroupId).catch(() => {});
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [token, selectedGroupId]);

  useEffect(() => {
    if (!token || !selectedGroupId) return;
    loadIssues(selectedGroupId).catch((e) => setError(e.message));
    loadApplications(selectedGroupId);
  }, [token, selectedGroupId]);

  async function handleAuthSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      const endpoint = authMode === "login" ? "login" : "register";
      const payload =
        authMode === "login"
          ? { username: authForm.username, password: authForm.password }
          : authForm;
      const data = await safeRequest(`${API}/auth/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      setToken(data.token);
      setUser(data.user);
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
    } catch (e2) {
      setError(e2.message);
    }
  }

  async function createGroup() {
    if (!groupForm.name.trim()) return;
    try {
      await safeRequest(`${API}/groups`, {
        method: "POST",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({
          name: groupForm.name.trim(),
          description: groupForm.description.trim(),
          visibility: groupForm.visibility,
          allowAllContributors: groupForm.allowAllContributors
        })
      });
      setGroupForm({
        name: "",
        description: "",
        visibility: "private",
        allowAllContributors: false
      });
      setGroupDialogOpen(false);
      await loadGroups();
    } catch (e) {
      setError(e.message);
    }
  }

  async function addMember() {
    if (!selectedGroupId || !memberUsername.trim()) return;
    try {
      await safeRequest(`${API}/groups/${selectedGroupId}/invites`, {
        method: "POST",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ username: memberUsername.trim() })
      });
      setMemberUsername("");
      setMemberDialogOpen(false);
      await loadInvites();
    } catch (e) {
      setError(e.message);
    }
  }

  async function respondInvite(inviteId, action) {
    try {
      await safeRequest(`${API}/invites/${inviteId}/respond`, {
        method: "POST",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      await loadInvites();
      await loadGroups();
    } catch (e) {
      setError(e.message);
    }
  }

  async function applyToSelectedGroup() {
    if (!selectedGroupId) return;
    try {
      await safeRequest(`${API}/groups/${selectedGroupId}/apply`, {
        method: "POST",
        headers: authHeaders(token)
      });
      await loadGroups();
    } catch (e) {
      setError(e.message);
    }
  }

  async function loadApplications(groupId) {
    if (!groupId) return setApplications([]);
    try {
      const data = await safeRequest(`${API}/groups/${groupId}/applications`, { headers: authHeaders(token) });
      setApplications(data);
    } catch {
      setApplications([]);
    }
  }

  async function respondApplication(applicationId, action) {
    if (!selectedGroupId) return;
    try {
      await safeRequest(`${API}/groups/${selectedGroupId}/applications/${applicationId}/respond`, {
        method: "POST",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      await loadApplications(selectedGroupId);
      await loadGroups();
    } catch (e) {
      setError(e.message);
    }
  }

  async function submitIssue() {
    if (!selectedGroupId) return;
    try {
      const fd = new FormData();
      Object.entries(issueForm).forEach(([k, v]) => {
        if (v && k !== "imageFile" && k !== "modelFile") fd.append(k, v);
      });
      if (issueForm.imageFile) fd.append("imageFile", issueForm.imageFile);
      if (issueForm.modelFile) fd.append("modelFile", issueForm.modelFile);
      await safeRequest(`${API}/groups/${selectedGroupId}/issues`, {
        method: "POST",
        headers: authHeaders(token),
        body: fd
      });
      setIssueDialogOpen(false);
      setIssueForm({
        title: "",
        description: "",
        status: "open",
        priority: "medium",
        referenceLink: "",
        proposedSolution: "",
        imageFile: null,
        modelFile: null
      });
      await loadIssues(selectedGroupId);
    } catch (e) {
      setError(e.message);
    }
  }

  async function saveIssueUpdate(issue) {
    try {
      await safeRequest(`${API}/issues/${issue.id}`, {
        method: "PUT",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({
          status: issue.status,
          priority: issue.priority,
          proposedSolution: issue.proposed_solution || ""
        })
      });
      setEditingIssueId("");
      await loadIssues(selectedGroupId);
    } catch (e) {
      setError(e.message);
    }
  }

  function logout() {
    setToken("");
    setUser(null);
    setGroups([]);
    setIssues([]);
    setSelectedGroupId("");
    localStorage.removeItem("token");
    localStorage.removeItem("user");
  }

  if (!token) {
    return (
      <Container maxWidth="sm" sx={{ py: 10 }}>
        <Paper sx={{ p: 4 }}>
          <Typography variant="h4" mb={2}>
            CAD Club Issue Tracker
          </Typography>
          <Typography color="text.secondary" mb={3}>
            Track print defects, group issues, files, and proposed fixes.
          </Typography>
          <Stack direction="row" spacing={1} mb={2}>
            <Button variant={authMode === "login" ? "contained" : "outlined"} onClick={() => setAuthMode("login")}>
              Login
            </Button>
            <Button
              variant={authMode === "register" ? "contained" : "outlined"}
              onClick={() => setAuthMode("register")}
            >
              Register
            </Button>
          </Stack>
          <Box component="form" onSubmit={handleAuthSubmit}>
            <Stack spacing={2}>
              <TextField
                label="Username"
                value={authForm.username}
                onChange={(e) => setAuthForm({ ...authForm, username: e.target.value })}
                required
              />
              {authMode === "register" && (
                <TextField
                  label="Display Name"
                  value={authForm.displayName}
                  onChange={(e) => setAuthForm({ ...authForm, displayName: e.target.value })}
                  required
                />
              )}
              <TextField
                label="Password"
                type="password"
                value={authForm.password}
                onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
                required
              />
              <Button type="submit" variant="contained">
                {authMode === "login" ? "Sign In" : "Create Account"}
              </Button>
            </Stack>
          </Box>
          {error && (
            <Alert sx={{ mt: 2 }} severity="error">
              {error}
            </Alert>
          )}
        </Paper>
      </Container>
    );
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        backgroundColor: honeycombBase,
        backgroundImage: honeycombPattern(honeycombLine),
        backgroundSize: "144px 124px"
      }}
    >
      <AppBar position="static">
        <Toolbar sx={{ display: "flex", justifyContent: "space-between" }}>
          <Typography variant="h6">3D Print Group Issue Tracker</Typography>
          <Stack direction="row" spacing={2} alignItems="center">
            <Typography>{user?.displayName}</Typography>
            <Button color="inherit" onClick={logout}>
              Logout
            </Button>
          </Stack>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: 3 }}>
        {error && (
          <Alert sx={{ mb: 2 }} severity="error">
            {error}
          </Alert>
        )}
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 4 }}>
            <Paper sx={{ p: 2, mb: 2 }}>
              <Typography variant="h6" mb={1}>
                Your Groups
              </Typography>
              <Stack spacing={1}>
                {groups.map((g) => (
                  <Button
                    key={g.id}
                    variant={selectedGroupId === g.id ? "contained" : "outlined"}
                    onClick={() => setSelectedGroupId(g.id)}
                  >
                    {g.name} {g.visibility === "global" ? "(Global)" : ""}
                  </Button>
                ))}
              </Stack>
              <Button sx={{ mt: 2 }} fullWidth onClick={() => setGroupDialogOpen(true)} variant="contained">
                Create Group
              </Button>
              <Button sx={{ mt: 1 }} fullWidth variant="outlined" onClick={() => setMemberDialogOpen(true)}>
                Invite Member by Username
              </Button>
            </Paper>
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" mb={1}>
                Pending Invites
              </Typography>
              <Stack spacing={1}>
                {invites.length === 0 && <Typography color="text.secondary">No pending invites.</Typography>}
                {invites.map((invite) => (
                  <Card key={invite.id} variant="outlined">
                    <CardContent sx={{ py: "12px !important" }}>
                      <Typography variant="body2">
                        {invite.groupName} invited by {invite.invitedByName}
                      </Typography>
                      <Stack direction="row" spacing={1} mt={1}>
                        <Button size="small" variant="contained" onClick={() => respondInvite(invite.id, "accept")}>
                          Accept
                        </Button>
                        <Button size="small" variant="outlined" onClick={() => respondInvite(invite.id, "decline")}>
                          Decline
                        </Button>
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            </Paper>
          </Grid>
          <Grid size={{ xs: 12, md: 8 }}>
            <Paper sx={{ p: 2, mb: 2 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="h6">
                  {selectedGroup ? `${selectedGroup.name} Issues` : "Select a Group"}
                </Typography>
                <Stack direction="row" spacing={1}>
                  {selectedGroup && !selectedGroup.isMember && selectedGroup.visibility === "global" && (
                    <Button
                      variant="outlined"
                      onClick={applyToSelectedGroup}
                      disabled={selectedGroup.myPendingApplication}
                    >
                      {selectedGroup.myPendingApplication ? "Application Pending" : "Apply to Join"}
                    </Button>
                  )}
                  <Button
                    variant="contained"
                    onClick={() => setIssueDialogOpen(true)}
                    disabled={!selectedGroupId}
                  >
                    New Issue
                  </Button>
                </Stack>
              </Stack>
            </Paper>
            <Stack spacing={2}>
              {issues.map((issue) => (
                <Card key={issue.id}>
                  <CardContent>
                    <Stack direction="row" spacing={1} alignItems="center" mb={1}>
                      <Typography variant="h6">{issue.title}</Typography>
                      <Chip size="small" label={issue.status} />
                      <Chip size="small" color="secondary" label={issue.priority} />
                    </Stack>
                    <Typography mb={1}>{issue.description}</Typography>
                    {issue.reference_link && (
                      <Typography mb={1}>
                        Reference:{" "}
                        <Link href={issue.reference_link} target="_blank" rel="noreferrer">
                          {issue.reference_link}
                        </Link>
                      </Typography>
                    )}
                    <Typography mb={1}>
                      Proposed Solution: {issue.proposed_solution || "No solution proposed yet."}
                    </Typography>
                    <Stack direction="row" spacing={2} mb={1}>
                      {issue.image_path && (
                        <Link href={`${FILES}${issue.image_path}`} target="_blank" rel="noreferrer">
                          View Image
                        </Link>
                      )}
                      {issue.model_path && (
                        <Link href={`${FILES}${issue.model_path}`} target="_blank" rel="noreferrer">
                          Download .3mf
                        </Link>
                      )}
                    </Stack>
                    <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                      Created by {issue.createdByName} on {new Date(issue.created_at).toLocaleString()}
                    </Typography>
                    <Button size="small" onClick={() => setEditingIssueId(editingIssueId === issue.id ? "" : issue.id)}>
                      {editingIssueId === issue.id ? "Cancel" : "Edit Status/Solution"}
                    </Button>
                    {editingIssueId === issue.id && (
                      <Stack spacing={1} mt={1}>
                        <TextField
                          select
                          label="Status"
                          value={issue.status}
                          onChange={(e) =>
                            setIssues((prev) =>
                              prev.map((x) => (x.id === issue.id ? { ...x, status: e.target.value } : x))
                            )
                          }
                        >
                          <MenuItem value="open">open</MenuItem>
                          <MenuItem value="in_progress">in_progress</MenuItem>
                          <MenuItem value="resolved">resolved</MenuItem>
                        </TextField>
                        <TextField
                          select
                          label="Priority"
                          value={issue.priority}
                          onChange={(e) =>
                            setIssues((prev) =>
                              prev.map((x) => (x.id === issue.id ? { ...x, priority: e.target.value } : x))
                            )
                          }
                        >
                          <MenuItem value="low">low</MenuItem>
                          <MenuItem value="medium">medium</MenuItem>
                          <MenuItem value="high">high</MenuItem>
                        </TextField>
                        <TextField
                          multiline
                          minRows={2}
                          label="Proposed Solution"
                          value={issue.proposed_solution || ""}
                          onChange={(e) =>
                            setIssues((prev) =>
                              prev.map((x) => (x.id === issue.id ? { ...x, proposed_solution: e.target.value } : x))
                            )
                          }
                        />
                        <Button variant="contained" onClick={() => saveIssueUpdate(issue)}>
                          Save
                        </Button>
                      </Stack>
                    )}
                  </CardContent>
                </Card>
              ))}
            </Stack>
            {selectedGroup && (selectedGroup.myRole === "owner" || selectedGroup.myRole === "admin") && (
              <Paper sx={{ p: 2, mt: 2 }}>
                <Typography variant="h6" mb={1}>
                  Join Applications
                </Typography>
                <Stack spacing={1}>
                  {applications.length === 0 && (
                    <Typography color="text.secondary">No pending applications.</Typography>
                  )}
                  {applications.map((app) => (
                    <Card key={app.id} variant="outlined">
                      <CardContent sx={{ py: "12px !important" }}>
                        <Typography variant="body2">
                          {app.displayName} (@{app.username})
                        </Typography>
                        <Stack direction="row" spacing={1} mt={1}>
                          <Button size="small" variant="contained" onClick={() => respondApplication(app.id, "approve")}>
                            Approve
                          </Button>
                          <Button size="small" variant="outlined" onClick={() => respondApplication(app.id, "reject")}>
                            Reject
                          </Button>
                        </Stack>
                      </CardContent>
                    </Card>
                  ))}
                </Stack>
              </Paper>
            )}
          </Grid>
        </Grid>
      </Container>
      <Dialog open={memberDialogOpen} onClose={() => setMemberDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Invite Member to Group</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            margin="normal"
            label="Username"
            value={memberUsername}
            onChange={(e) => setMemberUsername(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMemberDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={addMember}>
            Send Invite
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={groupDialogOpen} onClose={() => setGroupDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Create Group + Settings</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            <TextField
              label="Group name"
              value={groupForm.name}
              onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
            />
            <TextField
              multiline
              minRows={2}
              label="Description"
              value={groupForm.description}
              onChange={(e) => setGroupForm({ ...groupForm, description: e.target.value })}
            />
            <TextField
              select
              label="Visibility"
              value={groupForm.visibility}
              onChange={(e) => setGroupForm({ ...groupForm, visibility: e.target.value })}
            >
              <MenuItem value="private">private (invite-only)</MenuItem>
              <MenuItem value="global">global (everyone can view)</MenuItem>
            </TextField>
            <FormControlLabel
              control={
                <Switch
                  checked={groupForm.allowAllContributors}
                  onChange={(e) => setGroupForm({ ...groupForm, allowAllContributors: e.target.checked })}
                />
              }
              label="Allow all users to create issues (global groups only)"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGroupDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={createGroup}>
            Create Group
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={issueDialogOpen} onClose={() => setIssueDialogOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>Create 3D Print Issue</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            <TextField
              label="Issue title"
              value={issueForm.title}
              onChange={(e) => setIssueForm({ ...issueForm, title: e.target.value })}
            />
            <TextField
              multiline
              minRows={3}
              label="Issue description"
              value={issueForm.description}
              onChange={(e) => setIssueForm({ ...issueForm, description: e.target.value })}
            />
            <TextField
              label="Reference link"
              value={issueForm.referenceLink}
              onChange={(e) => setIssueForm({ ...issueForm, referenceLink: e.target.value })}
            />
            <TextField
              multiline
              minRows={2}
              label="Proposed solution"
              value={issueForm.proposedSolution}
              onChange={(e) => setIssueForm({ ...issueForm, proposedSolution: e.target.value })}
            />
            <Stack direction="row" spacing={2}>
              <Button variant="outlined" component="label">
                Upload image
                <input
                  hidden
                  type="file"
                  accept="image/*"
                  onChange={(e) => setIssueForm({ ...issueForm, imageFile: e.target.files?.[0] || null })}
                />
              </Button>
              <Button variant="outlined" component="label">
                Upload .3mf profile
                <input
                  hidden
                  type="file"
                  accept=".3mf"
                  onChange={(e) => setIssueForm({ ...issueForm, modelFile: e.target.files?.[0] || null })}
                />
              </Button>
            </Stack>
            <TextField
              select
              label="Status"
              value={issueForm.status}
              onChange={(e) => setIssueForm({ ...issueForm, status: e.target.value })}
            >
              <MenuItem value="open">open</MenuItem>
              <MenuItem value="in_progress">in_progress</MenuItem>
              <MenuItem value="resolved">resolved</MenuItem>
            </TextField>
            <TextField
              select
              label="Priority"
              value={issueForm.priority}
              onChange={(e) => setIssueForm({ ...issueForm, priority: e.target.value })}
            >
              <MenuItem value="low">low</MenuItem>
              <MenuItem value="medium">medium</MenuItem>
              <MenuItem value="high">high</MenuItem>
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIssueDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={submitIssue}>
            Create Issue
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
