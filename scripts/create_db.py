#!/usr/bin/env python3
"""
create_db.py — Generates app.db (SQLite) pre-seeded with the ASES district
schools and full application schema.

Run from the project root:
    python3 scripts/create_db.py

Output:  ./app.db   (served statically by nginx at /app.db)
"""

import sqlite3
import uuid
import os

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'app.db')


SCHEMA = """
CREATE TABLE IF NOT EXISTS Schools (
    SchoolID        TEXT PRIMARY KEY,
    SchoolName      TEXT NOT NULL,
    SchoolShortName TEXT DEFAULT '',
    Level           TEXT DEFAULT 'Elementary',
    LogoURL         TEXT DEFAULT '',
    IsActive        INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS Tournaments (
    TournamentID   TEXT PRIMARY KEY,
    TournamentName TEXT NOT NULL,
    Sport          TEXT DEFAULT '',
    Level          TEXT DEFAULT 'Elementary',
    Format         TEXT DEFAULT 'ROUND_ROBIN',
    SeasonYear     INTEGER DEFAULT 2026,
    Status         TEXT DEFAULT 'DRAFT',
    PublicVisible  INTEGER DEFAULT 0,
    Notes          TEXT DEFAULT '',
    CreatedAt      TEXT,
    UpdatedAt      TEXT
);

CREATE TABLE IF NOT EXISTS TournamentTeams (
    TeamID       TEXT PRIMARY KEY,
    TournamentID TEXT NOT NULL,
    SchoolID     TEXT DEFAULT '',
    TeamName     TEXT DEFAULT '',
    TeamLabel    TEXT DEFAULT '',
    CoachName    TEXT DEFAULT '',
    CoachEmail   TEXT DEFAULT '',
    IsActive     INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS Games (
    GameID        TEXT PRIMARY KEY,
    TournamentID  TEXT NOT NULL,
    Stage         TEXT DEFAULT 'ROUND_ROBIN',
    RoundNumber   INTEGER DEFAULT 1,
    GameLabel     TEXT DEFAULT '',
    TeamA_ID      TEXT DEFAULT '',
    TeamB_ID      TEXT DEFAULT '',
    ScoreA        TEXT DEFAULT '',
    ScoreB        TEXT DEFAULT '',
    WinnerTeamID  TEXT DEFAULT '',
    Location      TEXT DEFAULT '',
    GameTimeLabel TEXT DEFAULT '',
    IsComplete    INTEGER DEFAULT 0,
    CreatedAt     TEXT,
    UpdatedAt     TEXT
);

CREATE TABLE IF NOT EXISTS Standings (
    TournamentID  TEXT NOT NULL,
    TeamID        TEXT NOT NULL,
    Wins          INTEGER DEFAULT 0,
    Losses        INTEGER DEFAULT 0,
    PointsFor     INTEGER DEFAULT 0,
    PointsAgainst INTEGER DEFAULT 0,
    PointDiff     INTEGER DEFAULT 0,
    Rank          INTEGER DEFAULT 0,
    LastUpdatedAt TEXT,
    PRIMARY KEY (TournamentID, TeamID)
);

CREATE TABLE IF NOT EXISTS Settings (
    Key   TEXT PRIMARY KEY,
    Value TEXT
);
"""

# ── Schools from schools.csv ──────────────────────────────────────────────────
SCHOOLS = [
    # Elementary
    ("Cesar Chavez",            "CC",  "Elementary", "https://files.smartsites.parentsquare.com/9154/CC_logo@3x_1749069437.png"),
    ("Coral Mountain",          "CMA", "Elementary", "https://files.smartsites.parentsquare.com/9154/CMA_logo@3x_1749069438.png"),
    ("John Kelley",             "JK",  "Elementary", "https://files.smartsites.parentsquare.com/9154/JK_logo@3x_1749069439.png"),
    ("Las Palmitas",            "LP",  "Elementary", "https://files.smartsites.parentsquare.com/9154/canva_93356.png"),
    ("Mecca",                   "MA",  "Elementary", "https://files.smartsites.parentsquare.com/9154/M_logo@3x_1749069440.png"),
    ("Mountain Vista",          "MV",  "Elementary", "https://files.smartsites.parentsquare.com/9154/MV_logo@3x_1749069206.png"),
    ("Oasis",                   "OA",  "Elementary", "https://files.smartsites.parentsquare.com/9154/O_logo@3x_1749069440.png"),
    ("Palm View",               "PV",  "Elementary", "https://files.smartsites.parentsquare.com/9154/PV_logo@2x_1749069441.png"),
    ("Peter Pendleton",         "PP",  "Elementary", "https://files.smartsites.parentsquare.com/9154/PP_logo@2x_1749069441.png"),
    ("Saul Martinez",           "SM",  "Elementary", "https://files.smartsites.parentsquare.com/9154/SM_logo@2x_1749069441.png"),
    ("Sea View",                "SV",  "Elementary", "https://files.smartsites.parentsquare.com/9154/SV_logo@3x_1749069441.png"),
    ("Valle del Sol",           "VDS", "Elementary", "https://files.smartsites.parentsquare.com/9154/VDS_logo@3x_1749069448.png"),
    ("Valley View",             "VV",  "Elementary", "https://files.smartsites.parentsquare.com/9154/VV_logoSq4_1749069208.png"),
    ("Westside",                "WS",  "Elementary", "https://files.smartsites.parentsquare.com/9154/W_logo@3x_1749069208.png"),
    # Middle
    ("Bobby Duke",              "BD",  "Middle",     "https://files.smartsites.parentsquare.com/9154/BB_logo@3x_1749069437.png"),
    ("Cahuilla Desert Academy", "CDA", "Middle",     "https://files.smartsites.parentsquare.com/9154/CDA_logo@3x_1749069203.png"),
    ("Toro Canyon",             "TC",  "Middle",     "https://files.smartsites.parentsquare.com/9154/TC_logo@3x_1749069442.png"),
    ("West Shores",             "WSH", "Middle",     ""),
]


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def main():
    # Remove stale file so we always produce a fresh seed
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
        print(f"Removed existing {DB_PATH}")

    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()

    # Create schema
    cur.executescript(SCHEMA)

    # Insert schools
    for name, short, level, logo in SCHOOLS:
        cur.execute(
            "INSERT INTO Schools (SchoolID, SchoolName, SchoolShortName, Level, LogoURL, IsActive) "
            "VALUES (?, ?, ?, ?, ?, 1)",
            (new_id("SCH"), name, short, level, logo),
        )

    # Seed settings
    cur.execute("INSERT OR REPLACE INTO Settings (Key, Value) VALUES ('SchemaVersion', '1')")
    cur.execute("INSERT OR REPLACE INTO Settings (Key, Value) VALUES ('DistrictName', 'ASES')")
    cur.execute("INSERT OR REPLACE INTO Settings (Key, Value) VALUES ('DefaultSeasonYear', '2026')")

    con.commit()
    con.close()

    size_kb = os.path.getsize(DB_PATH) / 1024
    print(f"✓  Created {DB_PATH}  ({size_kb:.1f} KB)")
    print(f"   Schools inserted: {len(SCHOOLS)}")


if __name__ == "__main__":
    main()
