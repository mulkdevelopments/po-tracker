#!/usr/bin/env python3
"""Extract the UFP Production Schedule into production.json. Run from the
workbook directory:

    python3 backend/prisma/seed-data/extract_production.py "UFP  Production Schedule.xlsx"

Each row maps to an existing PurchaseOrder by (poNo, rev); the seed applies the
production-side fields onto the matching order.
"""
import json
import sys
import datetime
import warnings
from pathlib import Path

import openpyxl

warnings.filterwarnings("ignore")

SRC = sys.argv[1] if len(sys.argv) > 1 else "UFP  Production Schedule.xlsx"
OUT = Path(__file__).resolve().parent / "production.json"


def cell(v):
    if v is None:
        return None
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, str):
        s = v.strip()
        return s if s else None
    return v


def as_int(v):
    if v is None or v == "":
        return None
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return None


def main():
    wb = openpyxl.load_workbook(SRC, data_only=True)
    ws = wb["Order Level"]
    rows = []
    for r in range(5, ws.max_row + 1):
        po = ws.cell(r, 2).value
        if not po:
            continue
        rows.append({
            "poNo": str(po).strip(),
            "rev": as_int(ws.cell(r, 5).value) or 0,
            "soNo": cell(ws.cell(r, 4).value),
            "standardColorsOnly": cell(ws.cell(r, 13).value),
            "allMaterialAvailable": cell(ws.cell(r, 14).value),
            "productionBegin": cell(ws.cell(r, 15).value),
            "productionComplete": cell(ws.cell(r, 16).value),
            "dispatchFromFactory": cell(ws.cell(r, 17).value),
            "piSent": cell(ws.cell(r, 19).value),
            "productionStatus": cell(ws.cell(r, 20).value),
            "productionNotes": cell(ws.cell(r, 21).value),
        })
    OUT.write_text(json.dumps(rows, indent=2))
    print(f"Wrote {len(rows)} production rows to {OUT}")
    from collections import Counter
    print("STATUS:", dict(Counter(r["productionStatus"] for r in rows)))


if __name__ == "__main__":
    main()
