#!/usr/bin/env python3
"""Extract the UFP Production Schedule into production.json.

    python3 backend/prisma/seed-data/extract_production.py "path/to/UFP Production Schedule.xlsx"

Columns are resolved by header name. Row order becomes productionSequence.
Yellow/orange date cells are tentative; green (or other filled) dates are confirmed.
PI DATE in the workbook is Production Begin − 14 weeks (=L-(14*7)).
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

FIELD_ALIASES = {
    "poNo": ("PO#", "PO #", "PO"),
    "rev": ("Rev#", "Rev #", "Rev"),
    "piNo": ("PI ", "PI#", "PI #", "PI"),
    "soNo": ("SO", "SO#", "SO #"),
    "standardColorsOnly": ("Standard Colors Only?", "Standard Colors Only", "Colors Only?"),
    "allMaterialAvailable": ("All Material Available",),
    "productionBegin": ("Production Begin",),
    "productionComplete": ("Production Complete",),
    "dispatchFromFactory": ("Dispatch from Factory",),
    "piDate": ("PI DATE", "PI Date", "PI date"),
    "piSent": ("PI Sent?", "PI Sent"),
    "productionStatus": ("STATUS", "Status"),
    "productionNotes": ("Notes", "Note"),
}

# Excel estimated-date fills (Abitha legend: yellow). Everything else filled = confirmed/green.
ESTIMATED_RGB = {
    "FFFFC000",  # orange/amber used in current workbook
    "FFFFFF00",
    "FFFFEB9C",
    "FFFFF2CC",
    "FFFFF200",
    "00FFC000",
    "00FFFF00",
}


def cell(v):
    if v is None:
        return None
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, bool):
        return "Yes" if v else "No"
    if isinstance(v, (int, float)):
        # Notes / flags sometimes land as bare numbers in Excel.
        if isinstance(v, float) and v.is_integer():
            return str(int(v))
        return str(v).strip() or None
    if isinstance(v, str):
        s = v.strip()
        return s if s else None
    return str(v).strip() or None


def lines_of(v):
    """Split a cell that Abitha sometimes stacks with Alt+Enter."""
    raw = cell(v)
    if not raw:
        return []
    return [part.strip() for part in raw.replace("\r", "\n").split("\n") if part.strip()]


def first_doc(v, prefer=None):
    """Primary document number from a stacked PI/SO cell."""
    parts = lines_of(v)
    if not parts:
        return None
    if prefer:
        for part in parts:
            if prefer in part.upper():
                return part
    return parts[0]


def as_int(v):
    if v is None or v == "":
        return None
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return None


def find_header_row(ws, max_scan=20):
    for r in range(1, max_scan + 1):
        vals = []
        for c in range(1, ws.max_column + 1):
            raw = ws.cell(r, c).value
            if raw is None:
                continue
            vals.append(str(raw).strip())
        joined = " | ".join(vals).lower()
        if "po#" in joined.replace(" ", "") or ("po #" in joined and "production begin" in joined):
            return r
        if "production begin" in joined and ("po#" in joined.replace(" ", "") or "po #" in joined):
            return r
    raise KeyError("Could not find header row with PO# / Production Begin")


def header_map(ws, header_row):
    mapping = {}
    for c in range(1, ws.max_column + 1):
        raw = ws.cell(header_row, c).value
        if raw is None:
            continue
        key = str(raw).strip()
        if key:
            mapping[key] = c
    return mapping


def col(mapping, *names):
    for name in names:
        if name in mapping:
            return mapping[name]
    raise KeyError(f"Missing column(s): {names}")


def is_estimated_fill(cell):
    fill = cell.fill
    if not fill or fill.fill_type in (None, "none"):
        return False
    fg = fill.fgColor
    if fg is None:
        return False
    if fg.type == "rgb" and fg.rgb:
        rgb = str(fg.rgb).upper()
        return rgb in ESTIMATED_RGB or rgb.endswith("FFC000") or rgb.endswith("FFFF00") or rgb.endswith("FFEB9C")
    # Theme / indexed solids in this workbook are the green "confirmed" cells.
    return False


def date_confirmed(ws_styles, row, col_idx, value):
    """True when the date cell looks green/confirmed; False when yellow/estimated or blank."""
    if not value:
        return False
    cell = ws_styles.cell(row, col_idx)
    fill = cell.fill
    if not fill or fill.fill_type in (None, "none"):
        return False
    if is_estimated_fill(cell):
        return False
    return True


def main():
    wb_vals = openpyxl.load_workbook(SRC, data_only=True)
    wb_styles = openpyxl.load_workbook(SRC, data_only=False)
    sheet = "Order Level" if "Order Level" in wb_vals.sheetnames else wb_vals.sheetnames[0]
    ws = wb_vals[sheet]
    ws_styles = wb_styles[sheet]
    header_row = find_header_row(ws)
    headers = header_map(ws, header_row)
    cols = {}
    for field, aliases in FIELD_ALIASES.items():
        try:
            cols[field] = col(headers, *aliases)
        except KeyError:
            if field == "piNo":
                continue
            raise

    rows = []
    seq = 0
    for r in range(header_row + 1, ws.max_row + 1):
        po = ws.cell(r, cols["poNo"]).value
        if not po:
            continue
        seq += 10
        begin = cell(ws.cell(r, cols["productionBegin"]).value)
        complete = cell(ws.cell(r, cols["productionComplete"]).value)
        dispatch = cell(ws.cell(r, cols["dispatchFromFactory"]).value)
        status = cell(ws.cell(r, cols["productionStatus"]).value)
        if isinstance(status, str):
            status = status.strip() or None
        # Abitha sometimes stacks a later SO under PI / SO with Alt+Enter.
        # Keep the primary document only so the grid does not show the second line.
        pi_no = first_doc(ws.cell(r, cols["piNo"]).value, prefer="NX/PI") if "piNo" in cols else None
        so_no = first_doc(ws.cell(r, cols["soNo"]).value)
        rows.append({
            "poNo": str(po).strip(),
            "rev": as_int(ws.cell(r, cols["rev"]).value) or 0,
            "piNo": pi_no,
            "soNo": so_no,
            "standardColorsOnly": cell(ws.cell(r, cols["standardColorsOnly"]).value),
            "allMaterialAvailable": cell(ws.cell(r, cols["allMaterialAvailable"]).value),
            "productionBegin": begin,
            "productionComplete": complete,
            "dispatchFromFactory": dispatch,
            "piDate": cell(ws.cell(r, cols["piDate"]).value),
            "piSent": cell(ws.cell(r, cols["piSent"]).value),
            "productionStatus": status,
            "productionNotes": cell(ws.cell(r, cols["productionNotes"]).value),
            "productionSequence": seq,
            "productionBeginConfirmed": date_confirmed(ws_styles, r, cols["productionBegin"], begin),
            "productionCompleteConfirmed": date_confirmed(ws_styles, r, cols["productionComplete"], complete),
            "dispatchConfirmed": date_confirmed(ws_styles, r, cols["dispatchFromFactory"], dispatch),
        })

    OUT.write_text(json.dumps(rows, indent=2))
    print(f"Wrote {len(rows)} production rows to {OUT} (header row {header_row})")
    from collections import Counter
    print("STATUS:", dict(Counter(r["productionStatus"] for r in rows)))
    print(
        "confirmed begin/complete/dispatch:",
        sum(1 for r in rows if r["productionBeginConfirmed"]),
        sum(1 for r in rows if r["productionCompleteConfirmed"]),
        sum(1 for r in rows if r["dispatchConfirmed"]),
    )
    print("pi numbers:", sum(1 for r in rows if r.get("piNo")))
    print("stacked cells cleaned:", sum(
        1 for r in rows
        if r.get("soNo") and "\n" not in str(r.get("soNo"))
    ), "SO /", sum(1 for r in rows if r.get("piNo")), "PI")


if __name__ == "__main__":
    main()
