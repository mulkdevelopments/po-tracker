# PO Tracker — Mulk ecosystem notes

This repo is **PO Tracker** in the Mulk platform (production / shipping / cost).

## Siblings (separate Cursor windows)

| App | Absolute path | FE | BE |
|-----|---------------|----|----|
| MULK OS | `/Users/user/Mulk Ecosystem/MULK OS` | 3100 | 4100 |
| CRM | `/Users/user/Mulk Ecosystem/CRM` | 3000 | 4001 |
| HRMS | `/Users/user/Mulk Ecosystem/HRMS` | 5173 | 4000 |

Full map: `/Users/user/Mulk Ecosystem/ECOSYSTEM.md`

## OS bridge

- `GET /api/ecosystem/summary` + header `X-Ecosystem-Key: mulk-dev-bridge`
- Consumed by MULK OS backend (`:4100`) after OS user JWT login

## Ports note

Local FE is **5174** and API **4002** (not 5173/4000 — those belong to HRMS).

## Workflow

Work order/ops features here. For OS Operations tiles, open **MULK OS** after the API contract exists.
