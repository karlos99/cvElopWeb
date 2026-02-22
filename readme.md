# Start
docker compose up -d

# Stop
docker compose down

# Rebuild after changing source files or schools.csv
python3 scripts/create_db.py   # regenerate app.db
docker compose build && docker compose up -d

# Reset a user's data (DevTools console)
localStorage.removeItem('cdElop26_db_v1'); location.reload();