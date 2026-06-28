# UFP Order Tracker (PO Tracker)

Production-ready purchase order tracking application for UFP — from PO receipt through production, shipping, and delivery.

## Stack

- **Frontend:** React 19, Vite, Tailwind CSS 4
- **Backend:** Node.js, Express, Prisma, PostgreSQL
- **Auth:** JWT + bcrypt password hashing
- **Deploy:** Docker, Render Blueprint (`render.yaml`)

## Features

- Dashboard with order status by stocking location and cycle times
- Full PO lifecycle tracking (9 stages)
- PDF PO upload with text extraction and field decoding
- Role-based access: Super Admin, Maintainer, Manager, Finance, Logistics
- Super admin user management (name, email, hashed password, role, access level, page restrictions)
- Master data, pricing table, item summary
- Export JSON / CSV

## Quick start (Docker)

```bash
docker compose up --build
```

Open http://localhost:4000

**Default super admin** (change after first login):

- Email: `admin@ufp.local`
- Password: `ChangeMe123!`

## Local development

### 1. PostgreSQL

```bash
docker compose up db -d
```

### 2. Backend

```bash
cd backend
cp .env.example .env
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev
```

API runs at http://localhost:4000

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

App at http://localhost:5173 (proxies `/api` to backend)

## User roles & permissions

| Role | Typical access |
|------|----------------|
| **Super Admin** | Everything + user management |
| **Maintainer** | Upload, edit POs, advance stages (except PI approval), pricing, master data |
| **Manager** | View orders & dashboard; approve PI (PI Generated → PI Approved) |
| **Finance** | View orders & dashboard; PI generation, payments, invoices, telex stages |
| **Logistics** | View orders, production schedule; container loaded & arrival stages |
| **Viewer** | View-only — dashboard, orders, production, items (no edits or stage actions) |

Only **Maintainer** (and Super Admin) can edit PO fields, upload new POs, or advance stages outside their lane. Other roles may only perform their assigned stage action on the current PO (e.g. Manager clicks **Approve PI**).

Super admin can create users and optionally restrict which pages each user can see.

## Deploy to Render

1. Push this repo to GitHub: https://github.com/mulkdevelopments/po-tracker.git
2. In Render Dashboard → **New Blueprint** → connect repo
3. Set sync env vars:
   - `SUPER_ADMIN_EMAIL`
   - `SUPER_ADMIN_PASSWORD`
   - `FRONTEND_URL` (your Render web service URL, e.g. `https://po-tracker.onrender.com`)
4. Deploy — PostgreSQL and web service are provisioned from `render.yaml`

## Deploy frontend to Vercel

The frontend does **not** store the API URL in the repo. Set it in Vercel:

1. Import the repo in Vercel (root directory; `vercel.json` builds `frontend/`)
2. **Project Settings → Environment Variables** → add:
   - **Name:** `VITE_API_URL`
   - **Value:** your Render API URL, e.g. `https://po-tracker-api-v7iy.onrender.com` (no trailing slash)
   - **Environments:** Production (and Preview if you use preview deploys)
3. Redeploy after saving the variable (Vite bakes `VITE_*` vars in at build time)

On Render, set `FRONTEND_URL` to your frontend URL(s), comma-separated (e.g. `https://tracker.mulkinternational.co,https://po-tracker-eight.vercel.app`) for CORS. The API also allows `*.mulkinternational.co` and `*.vercel.app` origins.

Local dev: leave `VITE_API_URL` unset; Vite proxies `/api` to the backend on port 4000.

## Project structure

```
├── backend/          API, Prisma schema, auth, seed
├── frontend/         React SPA
├── seed-data.json    Sample POs from MVP
├── docker-compose.yml
├── Dockerfile        Production multi-stage build
└── render.yaml       Render Blueprint
```

## Sample documents

Reference PO/PDF files in the repo root (`PurchaseOrderPrint.pdf`, `24092839.pdf`, Excel exports) were used to build the MVP seed data and PDF decoder patterns.

## Security notes

- Passwords are hashed with bcrypt (cost factor 12)
- Change default super admin credentials immediately
- Set a strong `JWT_SECRET` in production (Render generates one via Blueprint)
- Use HTTPS in production (Render provides TLS)
