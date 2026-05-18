>[!WARNING]
> This was vibecoded by GPT 5.3 Codex and GPT 5.5

# 3D Print Issue Tracker (Material UI)

This app provides:

- User accounts (register/login)
- Group issue trackers with settings (create private/global groups)
- Invite-based membership (invite by username, accept/decline in app)
- 3D print issue tracking (status, priority, description)
- Proposed solutions for each issue
- Attachments per issue:
  - Image upload
  - Reference link
  - `.3mf` profile upload

## Stack

- Frontend: React + Vite + Material UI
- Backend: Node.js + Express + JWT + Multer
- Storage: local JSON file (`server/db.json`) and uploaded files (`server/uploads`)

## Run

1. Backend:

```powershell
cd "F:\CAD Issue Tracker\server"
npm install
npm run dev
```

2. Frontend (new terminal):

```powershell
cd "F:\CAD Issue Tracker\client"
npm install
npm run dev
```

3. Open `http://localhost:5173` on your machine, or `http://<YOUR_PC_IP>:5173` from another device on the same network.

## Notes

- Backend listens on `0.0.0.0:4000` (LAN accessible)
- Frontend listens on `0.0.0.0:5173` (LAN accessible)
- Frontend uses Vite proxy so `/api` and `/uploads` are forwarded to backend
