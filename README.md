# Expense Tracker System (prototype)

Working prototype built from the SRS (Experiment 2). Python 3.8+ only, no installs needed.

## Run
    python app.py          # then open http://127.0.0.1:8000
    (use PORT=9000 python app.py to change the port)

Register an account, add some income and expenses, then explore History and Reports.

## Structure
- `app.py`         backend: HTTP server, JSON API, SQLite database (`expense.db`, created on first run)
- `static/`        frontend: `index.html`, `style.css`, `app.js` (HTML/CSS/JavaScript, charts drawn as SVG)

## SRS requirement -> where it lives
| SRS requirement | Prototype |
|---|---|
| User registration and login | Login screen; `/api/register`, `/api/login`; PBKDF2-hashed passwords, session token |
| Profile management | Profile page; `/api/profile` |
| Add / edit / delete income and expense | Add transaction page, History page; `/api/transactions` |
| Category management (predefined and user-created) | Category list plus "Add category" on the form; `/api/categories` |
| Transaction history, search and filter | History page (text, type, category, date range) |
| Balance calculation, dashboard | Dashboard; `/api/summary` |
| Monthly / period summary, reports and charts | Reports page (category donut, monthly bars, date range) |
| Data validation | `check_tx()` in `app.py` plus form validation |
| Notifications / alerts (optional) | Monthly spending limit on Profile; alert on Dashboard at 80% and over 100% |
| Data export (optional) | "Export CSV" on History |
| Security / privacy | Every query is scoped to the logged-in user; users cannot see each other's records |

Not included (outside the SRS mini-project scope): Administrator role, bank integration, HTTPS/deployment.

## Deploy on Render
Build command: `pip install -r requirements.txt`   Start command: `python app.py`
The app reads `PORT` (set by Render) and optional `DB_PATH` (use e.g. `/var/data/expense.db` with a paid persistent disk).
Note: on Render's free plan the local SQLite file is erased on every restart, redeploy or idle spin-down.
