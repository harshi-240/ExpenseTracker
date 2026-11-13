"""Expense Tracker System - prototype backend (Python standard library only)."""
import json, sqlite3, hashlib, secrets, re, csv, io, os, datetime, mimetypes
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")
DB = os.environ.get("DB_PATH", os.path.join(ROOT, "expense.db"))
DEFAULTS = {"expense": ["Food", "Transport", "Shopping", "Bills", "Travel", "Education"],
            "income": ["Salary", "Allowance", "Other"]}
SCHEMA = """
create table if not exists users(id integer primary key, name text, email text unique, salt text, pw text, monthly_limit real default 0);
create table if not exists sessions(token text primary key, user_id integer);
create table if not exists categories(id integer primary key, user_id integer, kind text, name text);
create table if not exists transactions(id integer primary key, user_id integer, type text, amount real, date text, category text, description text);
"""

class Err(Exception):
    def __init__(self, code, msg): self.code, self.msg = code, msg

def conn():
    c = sqlite3.connect(DB); c.row_factory = sqlite3.Row; return c

def init():
    c = conn(); c.executescript(SCHEMA)
    if not c.execute("select 1 from categories").fetchone():
        for kind, names in DEFAULTS.items():
            c.executemany("insert into categories(user_id,kind,name) values(0,?,?)", [(kind, n) for n in names])
    c.commit(); c.close()

def hashpw(pw, salt): return hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), 120000).hex()

def check_tx(b):  # FR: Data Validation
    t = b.get("type")
    if t not in ("income", "expense"): raise Err(400, "Choose income or expense")
    try: a = round(float(b.get("amount")), 2)
    except (TypeError, ValueError): raise Err(400, "Enter a valid amount")
    if a <= 0: raise Err(400, "Amount must be greater than zero")
    try: datetime.date.fromisoformat(b.get("date") or "")
    except ValueError: raise Err(400, "Enter a valid date")
    cat = (b.get("category") or "").strip()
    if not cat: raise Err(400, "Choose a category")
    return t, a, b["date"], cat, (b.get("description") or "").strip()[:200]

def where(uid, q):
    w, a = ["user_id=?"], [uid]
    for k, col, op in (("type", "type", "="), ("category", "category", "="), ("from", "date", ">="), ("to", "date", "<=")):
        if q.get(k): w.append(f"{col}{op}?"); a.append(q[k])
    if q.get("q"): w.append("(description like ? or category like ?)"); a += [f"%{q['q']}%"] * 2
    return " and ".join(w), a

class H(BaseHTTPRequestHandler):
    def out(self, code, body, ctype="application/json", extra=None):
        self.send_response(code); self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items(): self.send_header(k, v)
        self.end_headers(); self.wfile.write(body)

    def js(self, code, obj): self.out(code, json.dumps(obj).encode())

    def static(self, p):
        f = os.path.normpath(os.path.join(STATIC, "index.html" if p == "/" else p.lstrip("/")))
        if not f.startswith(STATIC) or not os.path.isfile(f): return self.js(404, {"error": "Not found"})
        self.out(200, open(f, "rb").read(), mimetypes.guess_type(f)[0] or "application/octet-stream")

    def handle_any(self, m):
        u = urlparse(self.path); q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if not u.path.startswith("/api/"): return self.static(u.path)
        n = int(self.headers.get("Content-Length") or 0); b = {}
        if n:
            try: b = json.loads(self.rfile.read(n))
            except ValueError: return self.js(400, {"error": "Invalid request"})
        c = conn()
        try:
            res = self.api(c, m, u.path, q, b); c.commit()
            if isinstance(res, bytes): return self.out(200, res, "text/csv", {"Content-Disposition": "attachment; filename=transactions.csv"})
            self.js(*res)
        except Err as e: self.js(e.code, {"error": e.msg})
        finally: c.close()

    do_GET = lambda s: s.handle_any("GET")
    do_POST = lambda s: s.handle_any("POST")
    do_PUT = lambda s: s.handle_any("PUT")
    do_DELETE = lambda s: s.handle_any("DELETE")
    def log_message(self, *a): pass

    def session(self, c, uid):
        tok = secrets.token_urlsafe(24)
        c.execute("insert into sessions values(?,?)", (tok, uid))
        u = c.execute("select name,email from users where id=?", (uid,)).fetchone()
        return 200, {"token": tok, "user": dict(u)}

    def api(self, c, m, p, q, b):
        if (m, p) == ("POST", "/api/register"):
            name, email, pw = (b.get("name") or "").strip(), (b.get("email") or "").strip().lower(), b.get("password") or ""
            if not name or not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email): raise Err(400, "Enter your name and a valid email")
            if len(pw) < 6: raise Err(400, "Password needs at least 6 characters")
            if c.execute("select 1 from users where email=?", (email,)).fetchone(): raise Err(409, "This email is already registered")
            salt = secrets.token_hex(16)
            uid = c.execute("insert into users(name,email,salt,pw) values(?,?,?,?)", (name, email, salt, hashpw(pw, salt))).lastrowid
            return self.session(c, uid)
        if (m, p) == ("POST", "/api/login"):
            r = c.execute("select * from users where email=?", ((b.get("email") or "").strip().lower(),)).fetchone()
            if not r or not secrets.compare_digest(r["pw"], hashpw(b.get("password") or "", r["salt"])): raise Err(401, "Email or password is incorrect")
            return self.session(c, r["id"])
        tok = (self.headers.get("Authorization") or "")[7:]
        s = c.execute("select user_id from sessions where token=?", (tok,)).fetchone()
        if not s: raise Err(401, "Please log in again")
        uid = s["user_id"]  # access control: every query below is scoped to uid
        if (m, p) == ("POST", "/api/logout"):
            c.execute("delete from sessions where token=?", (tok,)); return 200, {}
        if p == "/api/profile":
            if m == "PUT":
                name = (b.get("name") or "").strip()
                try: lim = float(b.get("monthly_limit") or 0)
                except ValueError: raise Err(400, "Enter a valid limit")
                if not name or lim < 0: raise Err(400, "Enter a name and a limit of 0 or more")
                c.execute("update users set name=?, monthly_limit=? where id=?", (name, lim, uid))
            r = c.execute("select name,email,monthly_limit from users where id=?", (uid,)).fetchone()
            return 200, dict(r)
        if p == "/api/categories":
            if m == "POST":
                kind, name = b.get("kind"), (b.get("name") or "").strip()
                if kind not in ("income", "expense") or not name: raise Err(400, "Enter a category name")
                if c.execute("select 1 from categories where user_id in (0,?) and kind=? and lower(name)=lower(?)", (uid, kind, name)).fetchone():
                    raise Err(409, "That category already exists")
                c.execute("insert into categories(user_id,kind,name) values(?,?,?)", (uid, kind, name))
            return 200, [dict(r) for r in c.execute("select kind,name from categories where user_id in (0,?) order by kind,name", (uid,))]
        if p == "/api/transactions" and m == "GET":
            w, a = where(uid, q)
            sql = f"select * from transactions where {w} order by date desc,id desc"
            if q.get("limit", "").isdigit(): sql += f" limit {int(q['limit'])}"
            return 200, [dict(r) for r in c.execute(sql, a)]
        if p == "/api/transactions" and m == "POST":
            t, a, d, cat, desc = check_tx(b)
            i = c.execute("insert into transactions(user_id,type,amount,date,category,description) values(?,?,?,?,?,?)", (uid, t, a, d, cat, desc)).lastrowid
            return 201, {"id": i}
        mt = re.fullmatch(r"/api/transactions/(\d+)", p)
        if mt:
            tid = int(mt.group(1))
            if not c.execute("select 1 from transactions where id=? and user_id=?", (tid, uid)).fetchone(): raise Err(404, "Transaction not found")
            if m == "PUT":
                t, a, d, cat, desc = check_tx(b)
                c.execute("update transactions set type=?,amount=?,date=?,category=?,description=? where id=?", (t, a, d, cat, desc, tid))
            elif m == "DELETE": c.execute("delete from transactions where id=?", (tid,))
            return 200, {}
        if p == "/api/summary":  # Balance, period summary, report data
            w, a = where(uid, q)
            tot = {r["type"]: r["s"] for r in c.execute(f"select type,sum(amount) s from transactions where {w} group by type", a)}
            cats = [dict(r) for r in c.execute(f"select category,sum(amount) total from transactions where {w} and type='expense' group by category order by total desc", a)]
            months = [dict(r) for r in c.execute(f"select substr(date,1,7) month, sum(case when type='income' then amount else 0 end) income, sum(case when type='expense' then amount else 0 end) expense from transactions where {w} group by month order by month desc limit 6", a)][::-1]
            ym = datetime.date.today().strftime("%Y-%m")
            spent = c.execute("select coalesce(sum(amount),0) from transactions where user_id=? and type='expense' and substr(date,1,7)=?", (uid, ym)).fetchone()[0]
            lim = c.execute("select monthly_limit from users where id=?", (uid,)).fetchone()[0]
            inc, exp = tot.get("income", 0), tot.get("expense", 0)
            return 200, {"income": inc, "expense": exp, "balance": inc - exp, "by_category": cats, "by_month": months, "month_spent": spent, "limit": lim}
        if (m, p) == ("GET", "/api/export"):  # Data Export (CSV)
            w, a = where(uid, q); buf = io.StringIO(); wr = csv.writer(buf)
            wr.writerow(["Date", "Type", "Category", "Amount", "Description"])
            for r in c.execute(f"select * from transactions where {w} order by date", a): wr.writerow([r["date"], r["type"], r["category"], r["amount"], r["description"]])
            return buf.getvalue().encode()
        raise Err(404, "Not found")

if __name__ == "__main__":
    init(); port = int(os.environ.get("PORT", 8000))
    host = "0.0.0.0" if "PORT" in os.environ else "127.0.0.1"  # hosting platforms set PORT and need 0.0.0.0
    print(f"Expense Tracker running at http://{host}:{port}  (Ctrl+C to stop)")
    ThreadingHTTPServer((host, port), H).serve_forever()
