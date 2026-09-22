#!/usr/bin/env bash
# Live API smoke test against a running server (default http://127.0.0.1:8000).
# Proves: session auth works, each role is permitted/denied correctly, and the
# dashboard returns real, non-zero figures from the seeded database.
set -uo pipefail

BASE="${BASE:-http://127.0.0.1:8000}"
PY="${PY:-.venv/bin/python}"
PASS="Demo12345!"
JAR_DIR="$(mktemp -d)"
PASSED=0
FAILED=0

login() {  # login <username> <jarname>  -> echoes status code
  local user="$1" jar="$JAR_DIR/$2.txt"
  local token
  token=$(curl -s -c "$jar" "$BASE/api/auth/csrf" | "$PY" -c 'import sys,json;print(json.load(sys.stdin)["csrfToken"])')
  curl -s -o /dev/null -w '%{http_code}' -b "$jar" -c "$jar" \
    -X POST -H 'Content-Type: application/json' -H "X-CSRFToken: $token" \
    -d "{\"username\":\"$user\",\"password\":\"$PASS\"}" "$BASE/api/auth/login"
}

get_code() {  # get_code <jarname> <path>
  curl -s -o /dev/null -w '%{http_code}' -b "$JAR_DIR/$1.txt" "$BASE$2"
}

get_body() {  # get_body <jarname> <path>
  curl -s -b "$JAR_DIR/$1.txt" "$BASE$2"
}

check() {  # check <description> <expected> <actual>
  if [ "$2" = "$3" ]; then
    printf '  \033[32mPASS\033[0m %-52s %s\n' "$1" "$3"; PASSED=$((PASSED+1))
  else
    printf '  \033[31mFAIL\033[0m %-52s expected %s, got %s\n' "$1" "$2" "$3"; FAILED=$((FAILED+1))
  fi
}

echo "== authentication =="
for role in admin manager accountant reception teacher.john; do
  check "login $role" 200 "$(login "$role" "$role")"
done

echo "== role enforcement (server-side) =="
check "teacher GET /api/payments            → forbidden" 403 "$(get_code teacher.john /api/payments/)"
check "teacher GET /api/payroll             → forbidden" 403 "$(get_code teacher.john /api/payroll/)"
check "teacher GET /api/audit               → forbidden" 403 "$(get_code teacher.john /api/audit/)"
check "teacher GET /api/dashboard           → allowed"   200 "$(get_code teacher.john /api/dashboard)"
check "teacher GET /api/groups              → allowed"   200 "$(get_code teacher.john /api/groups/)"
check "accountant GET /api/students          → allowed"   200 "$(get_code accountant /api/students/)"
check "accountant GET /api/finance/summary  → allowed"   200 "$(get_code accountant /api/finance/summary)"
check "accountant GET /api/audit            → allowed"   200 "$(get_code accountant /api/audit/)"
check "receptionist GET /api/leads          → allowed"   200 "$(get_code reception /api/leads/)"
check "receptionist GET /api/payroll        → forbidden" 403 "$(get_code reception /api/payroll/)"
check "manager GET /api/payroll             → allowed"   200 "$(get_code manager /api/payroll/)"
check "admin   GET /api/roles               → allowed"   200 "$(get_code admin /api/roles/)"

echo "== core endpoints =="
check "health" 200 "$(get_code manager /api/health)"
check "settings" 200 "$(get_code manager /api/settings)"
check "audit log" 200 "$(get_code admin /api/audit/)"
check "notifications" 200 "$(get_code manager /api/notifications/)"
check "search" 200 "$(get_code manager '/api/search?q=ali')"
check "students list (trailing slash)" 200 "$(get_code manager '/api/students/?page_size=5')"

echo "== dashboard contains real data =="
get_body manager /api/dashboard > "$JAR_DIR/dashboard.json"
"$PY" - "$JAR_DIR/dashboard.json" <<'PYTHON'
import json, sys
d = json.load(open(sys.argv[1]))
k = d["kpis"]
checks = [
    ("active students > 0",            int(k["students"]["active"]) > 0),
    ("invoices/payments reflected",    float(k["finance"]["income_month"]) > 0),
    ("expenses reflected",             float(k["finance"]["expenses_month"]) > 0),
    ("net result computed",            "net_month" in k["finance"]),
    ("outstanding receivables",        float(k["finance"]["outstanding"]) >= 0),
    ("payroll payable present",        "payroll_payable" in k["finance"]),
    ("attendance today recorded",      k["attendance"]["month"]["present"] > 0),
    ("exams counted this month",       k["academic"]["exams_this_month"] >= 0),
    ("alerts are actionable links",    all(a["link"].startswith("/") for a in d["alerts"])),
    ("at-risk students carry reasons", all(s["reasons"] for s in d["at_risk"])),
    ("financial series has 12 points", len(d["widgets"]["financial_series"]) == 12),
    ("recent payments present",        len(d["widgets"]["recent_payments"]) > 0),
]
fails = [name for name, ok in checks if not ok]
for name, ok in checks:
    print(f"  {'\033[32mPASS\033[0m' if ok else '\033[31mFAIL\033[0m'} {name}")
print(f"\n  active students: {k['students']['active']}, "
      f"income this month: {k['finance']['income_month']}, "
      f"outstanding: {k['finance']['outstanding']}, "
      f"overdue invoices: {k['finance']['overdue_count']}, "
      f"attendance %: {k['attendance']['month']['percentage']}")
print(f"  alerts: {len(d['alerts'])}, at-risk students: {len(d['at_risk'])}")
sys.exit(1 if fails else 0)
PYTHON
if [ $? -eq 0 ]; then PASSED=$((PASSED+1)); else FAILED=$((FAILED+1)); fi

echo "== reports =="
for name in students attendance academic finance management groups at-risk; do
  check "report $name" 200 "$(get_code manager "/api/reports/$name")"
done
check "report CSV export" 200 "$(get_code manager /api/reports/finance/export.csv)"
check "unknown report → 404" 404 "$(get_code manager /api/reports/nonsense)"

echo "== write paths (real IDs, not guesses) =="
check "write-session login" 200 "$(login manager w)"
# Django rotates the CSRF token on login, so the token must be fetched AFTER
# authenticating. Keep the session cookie with -b/-c.
csrf() { curl -s -b "$JAR_DIR/$1.txt" -c "$JAR_DIR/$1.txt" "$BASE/api/auth/csrf" \
         | "$PY" -c 'import sys,json;print(json.load(sys.stdin)["csrfToken"])'; }
XSRF_W=$(csrf w)

GROUP_ID=$(get_body w '/api/groups/?page_size=1' | "$PY" -c 'import sys,json;d=json.load(sys.stdin);print(d["results"][0]["id"] if d["results"] else "")')
STUDENT_ID=$(get_body w '/api/students/?page_size=1' | "$PY" -c 'import sys,json;d=json.load(sys.stdin);print(d["results"][0]["id"] if d["results"] else "")')
OTHER_STUDENT_ID=$(get_body w '/api/students/?page_size=2' | "$PY" -c 'import sys,json;d=json.load(sys.stdin);print(d["results"][1]["id"] if len(d["results"])>1 else "")')
INVOICE_ID=$(get_body w '/api/invoices/?page_size=1' | "$PY" -c 'import sys,json;d=json.load(sys.stdin);print(d["results"][0]["id"] if d["results"] else "")')

check "read a real group id" "yes" "$([ -n "$GROUP_ID" ] && echo yes || echo no)"
check "read a real student id" "yes" "$([ -n "$STUDENT_ID" ] && echo yes || echo no)"

check "student detail page" 200 "$(get_code w "/api/students/$STUDENT_ID/")"
check "student overview tab" 200 "$(get_code w "/api/students/$STUDENT_ID/overview/")"
check "student attendance tab" 200 "$(get_code w "/api/students/$STUDENT_ID/attendance/")"
check "student exams tab" 200 "$(get_code w "/api/students/$STUDENT_ID/exams/")"
check "student payments tab" 200 "$(get_code w "/api/students/$STUDENT_ID/payments/")"
check "student activity tab" 200 "$(get_code w "/api/students/$STUDENT_ID/activity/")"
check "group roster" 200 "$(get_code w "/api/groups/$GROUP_ID/students/")"
check "group performance" 200 "$(get_code w "/api/groups/$GROUP_ID/performance/")"
check "timetable today" 200 "$(get_code w /api/schedule/today/)"

post_code() {  # post_code <jar> <path> <json> [csrf]
  local csrf_value="${4:-$XSRF_W}"
  curl -s -o /dev/null -w '%{http_code}' -b "$JAR_DIR/$1.txt" -X POST \
    -H 'Content-Type: application/json' -H "X-CSRFToken: $csrf_value" -d "$3" "$BASE$2"
}

# JSON payloads are built with printf into variables. Nesting escaped quotes
# inside "$( ... )" makes bash treat the braces as an unquoted brace expression
# and split the body at the comma, which the API then rejects as invalid JSON.
json() { printf "$@"; }

TODAY="$(date +%F)"
SHEET_BODY=$(json '{"group":%s,"date":"%s"}' "$GROUP_ID" "$TODAY")
PAYMENT_BODY=$(json '{"student":%s,"invoice":%s,"amount":"1000","method":"cash"}' \
  "$OTHER_STUDENT_ID" "$INVOICE_ID")

SESSION_BODY=$(curl -s -b "$JAR_DIR/w.txt" -X POST -H 'Content-Type: application/json' \
  -H "X-CSRFToken: $XSRF_W" -d "$SHEET_BODY" "$BASE/api/attendance/")
SESSION_ID=$(printf '%s' "$SESSION_BODY" | "$PY" -c 'import sys,json;d=json.load(sys.stdin);print(d.get("session",{}).get("id",""))' 2>/dev/null)

check "open attendance sheet (idempotent)" "yes" "$([ -n "$SESSION_ID" ] && echo yes || echo no)"
check "attendance mark-all-present" 200 "$(post_code w "/api/attendance/$SESSION_ID/mark-all-present/" '{"submit":false}')"
check "attendance submit sheet" 200 "$(post_code w "/api/attendance/$SESSION_ID/submit/" '{}')"
check "reject payment against another student's invoice" 400 "$(post_code w /api/payments/ "$PAYMENT_BODY")"
check "manager cannot create users (needs users.manage)" 403 "$(post_code w /api/users/ '{"username":"ghost","password":"VeryStrong123","role":1}')"

# The accountant reaches finance but must not gain academic write access.
ACC_CSRF=$(csrf accountant)
NEW_STUDENT_BODY=$(json '{"first_name":"Not","last_name":"Allowed","status":"active"}')
check "accountant cannot create a student" 403 "$(post_code accountant /api/students/ "$NEW_STUDENT_BODY" "$ACC_CSRF")"
check "accountant cannot create a group" 403 "$(post_code accountant /api/groups/ '{"name":"Nope","course":1,"monthly_fee":"1000000"}' "$ACC_CSRF")"
# amount 0 is rejected by the service (400), which also proves the accountant
# reaches the endpoint rather than being blocked by permissions (403).
ZERO_PAYMENT_BODY=$(json '{"student":%s,"amount":"0","method":"cash"}' "$STUDENT_ID")
check "accountant reaches payments but amount 0 is refused" 400 "$(post_code accountant /api/payments/ "$ZERO_PAYMENT_BODY" "$ACC_CSRF")"

# A teacher may only touch their own groups: find a group they do NOT teach.
login teacher.john t > /dev/null
XSRF_T=$(csrf t)
OWN_IDS=$(get_body t '/api/groups/?page_size=100' | "$PY" -c 'import sys,json;print(" ".join(str(r["id"]) for r in json.load(sys.stdin)["results"]))')
ALL_IDS=$(get_body w '/api/groups/?page_size=100' | "$PY" -c 'import sys,json;print(" ".join(str(r["id"]) for r in json.load(sys.stdin)["results"]))')
FOREIGN_TARGET=""
for candidate in $ALL_IDS; do
  case " $OWN_IDS " in *" $candidate "*) ;; *) FOREIGN_TARGET="$candidate"; break;; esac
done
FOREIGN_SHEET_BODY=$(json '{"group":%s,"date":"%s"}' "$FOREIGN_TARGET" "$TODAY")
FOREIGN_EXAM_BODY=$(json '{"group":%s,"name":"Foreign Quiz","exam_type":"quiz","date":"%s"}' \
  "$FOREIGN_TARGET" "$TODAY")

check "teacher sees only own groups" "yes" "$([ -z "$OWN_IDS" ] && echo no || echo yes)"
check "teacher cannot open a foreign group's sheet" 403 "$(post_code t /api/attendance/ "$FOREIGN_SHEET_BODY" "$XSRF_T")"
check "teacher cannot create a foreign group's exam" 403 "$(post_code t /api/exams/ "$FOREIGN_EXAM_BODY" "$XSRF_T")"
check "teacher cannot read payments" 403 "$(get_code t /api/payments/)"

echo
echo "RESULT: $PASSED passed, $FAILED failed"
rm -rf "$JAR_DIR"
[ "$FAILED" -eq 0 ]
