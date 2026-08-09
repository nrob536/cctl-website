#!/usr/bin/env python3
"""Merge Excel sheets into a single CSV with Category column.

Usage:
    python3 python/merge_toy_sheets.py input.xlsx --out merged_toys.csv

This script reads all sheets from the workbook, adds a `Category` column
with the sheet name, normalizes column names (strip/upper), concatenates
and writes a merged CSV and a small preview head CSV.
"""
import argparse
from pathlib import Path
import sys
import pandas as pd


def normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    # Strip whitespace from column names and collapse multiple spaces
    new_cols = []
    for c in df.columns:
        if isinstance(c, str):
            nc = " ".join(c.split()).strip()
            nc = nc.upper()
        else:
            nc = str(c)
        new_cols.append(nc)
    df.columns = new_cols
    return df


def main():
    parser = argparse.ArgumentParser(description="Merge Excel sheets and add Category column")
    parser.add_argument("input", help="Path to input Excel workbook")
    parser.add_argument("--out", default="merged_toys.csv", help="Output CSV path")
    parser.add_argument("--preview", default="merged_toys_head.csv", help="Preview CSV path (first 200 rows)")
    parser.add_argument("--dedupe", choices=["keep_first","keep_last","none"], default="none", help="Deduplicate by ID column")
    args = parser.parse_args()

    inp = Path(args.input)
    if not inp.exists():
        print(f"Input workbook not found: {inp}", file=sys.stderr)
        sys.exit(2)

    # Read sheets in workbook preserving order so we can skip the Master sheet
    xls_file = pd.ExcelFile(inp, engine="openpyxl")
    sheet_names = xls_file.sheet_names
    dfs = []
    for i, sheet_name in enumerate(sheet_names):
        # Skip the first sheet if it's the master summary, or any sheet named 'Master'
        if i == 0 or sheet_name.strip().upper() == "MASTER":
            continue
        df = pd.read_excel(xls_file, sheet_name=sheet_name)
        # Some sheets may appear non-empty but contain only all-NaN rows;
        # consider a sheet empty only if all rows are entirely NA.
        if df.dropna(how="all").empty:
            continue
        df = normalize_columns(df)
        # Add Category column using sheet name
        df["CATEGORY"] = sheet_name
        dfs.append(df)

    if not dfs:
        print("No data found in workbook.")
        sys.exit(0)

    master = pd.concat(dfs, ignore_index=True, sort=False)

    # Try to clean ID column name variants
    id_cols = [c for c in master.columns if c.upper() in ("ID", "TOY ID", "ITEM ID")]
    if id_cols:
        id_col = id_cols[0]
        master.rename(columns={id_col: "ID"}, inplace=True)

    # Trim whitespace from string columns (preserve NaN and non-string values)
    for c in master.select_dtypes(include=[object]).columns:
        master[c] = master[c].apply(lambda v: v.strip() if isinstance(v, str) else v)

    # Create a UniqueID column to satisfy databases that require a unique primary key.
    # For rows with an `ID` value, append a lower-case letter suffix per occurrence
    # (a, b, c, ...) to keep the original ID visible while making each row unique.
    # For rows missing `ID`, create `UniqueID` from the dataframe index.
    def _letter_for(n: int) -> str:
        # 0 -> a, 1 -> b, ... 25 -> z, 26 -> aa, etc.
        s = ""
        n_orig = n
        while n >= 0:
            s = chr(ord("a") + (n % 26)) + s
            n = n // 26 - 1
        return s

    if "ID" in master.columns:
        # ensure ID is treated as string for concatenation
        master["ID"] = master["ID"].astype(str)
        counts = master.groupby("ID").cumcount()
        master["_occurrence"] = counts
        # If occurrence is 0, keep original ID; otherwise append letter suffix
        def make_uid(r):
            occ = int(r["_occurrence"])
            if occ == 0:
                return r["ID"]
            return f"{r['ID']}{_letter_for(occ)}"

        master["UniqueID"] = master.apply(make_uid, axis=1)
        master.drop(columns=["_occurrence"], inplace=True)
    else:
        master["UniqueID"] = [f"ROW{idx+1}" for idx in master.index]

    # Dedupe
    if args.dedupe != "none" and "ID" in master.columns:
        keep = "first" if args.dedupe == "keep_first" else "last"
        master = master.drop_duplicates(subset=["ID"], keep=keep)

    outp = Path(args.out)
    master.to_csv(outp, index=False)
    previewp = Path(args.preview)
    master.head(200).to_csv(previewp, index=False)

    print(f"Wrote merged CSV: {outp}")
    print(f"Wrote preview CSV (first 200 rows): {previewp}")


if __name__ == "__main__":
    main()
