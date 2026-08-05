#!/usr/bin/env bash
# ============================================================
#  WAAN — Realtime System Status Monitor
#  usage: bash scripts/status.sh            (refresh every 15s)
#         bash scripts/status.sh 5          (refresh every 5s)
#         bash scripts/status.sh once       (single check, then exit)
# ============================================================

cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"
LOGS="$ROOT/.run-logs"
WEB="http://localhost:3000"
WINDOW=300                 # treat as a "live" error if the log was written within 5 minutes

ARG="${1:-15}"
if [[ "$ARG" == "once" ]]; then ONCE=1; REFRESH=0; else ONCE=0; REFRESH="$ARG"; fi

# ---- colors ----
R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; C=$'\033[36m'; M=$'\033[35m'; B=$'\033[1m'; D=$'\033[2m'; N=$'\033[0m'

# ---- error patterns (split by severity; TOPIC_CLOSED excluded = normal for a closed topic) ----
AUTHERR='invalid_grant|unauthorized|Unauthorized|login required|เข้าสู่ระบบ|ต้องล็อกอิน| 401 |403 |sign.?in|เซสชันหมด'   # -> session expired (warn on first hit)
CODEERR='MODULE_NOT_FOUND|UnhandledPromise|TypeError|ReferenceError|EADDRINUSE|SyntaxError'                            # -> code bug (warn on first hit)
SOFTERR='ENOTFOUND|fetch failed|scan fail|browser has been closed|ECONNREFUSED|ETIMEDOUT'                             # -> transient (needs >=3 hits to warn)
BANNER='พร้อมทำงาน|เฝ้า|poll ทุก|เฝ้าคำขอ|เฝ้าดู|เฝ้าแชท|watching|ready'

# label|logfile|shortname|role|auth-cmd|psmatch (for uptime)
# โซนบน — ระบบบริษัท (น้องวาน)
WAAN_SERVICES=(
  "com.changoh.web|dev.log|web|Web/API :3000||next dev"
  "com.changoh.bot|bot.log|bot|Telegram (Waan)||telegram-bot.mjs"
  "com.changoh.drive|drive.log|drive|Google Drive watcher|npm run drive:auth|drive-watch.mjs"
  "com.changoh.oho|oho.log|oho|OHO chat watcher|npm run oho:auth|oho-watch.mjs"
  "com.changoh.fb|fb.log|fb|Facebook inbox watcher|npm run fb:auth|fb-watch.mjs"
  "com.changoh.line|line.log|line|LINE OA watcher|npm run line:auth|line-watch.mjs"
  "com.changoh.refund|refund.log|refund|Thunder credit refunds|npm run thunder:auth|refund-watch.mjs"
)

# โซนล่าง — เลขาส่วนตัว (Vex) แยกขาดจากของบริษัท ไม่ปนกัน
VEX_SERVICES=(
  "com.changoh.kiki|kiki.log|kiki|ท่อ Telegram|npm run kiki:tg-auth|kiki-bot.mjs"
  "com.changoh.vexdiscord|vex-discord.log|discord|ท่อ Discord (ข้อความ+เสียง)||kiki-discord.mjs"
  "com.changoh.vexeyes|vex-eyes.log|eyes|ตาเฝ้าเหตุการณ์ขาเข้า||vex-eyes.mjs"
)

# ---- animation ----
SPIN=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏)
SPAN=8            # width of the moving highlight band on the status bar
FPR=$(( REFRESH * 8 )); (( FPR < 1 )) && FPR=1   # animation frames per data refresh (~0.12s/frame)

now_epoch() { date +%s; }

# turn etime (e.g. 25:36 / 1:02:33 / 2-03:04:05) into "Xd Yh" / "Yh Zm" / "Zm"
humanize_etime() {
  local e="$1" days=0 hh=0 mm=0 a b c
  [[ -z "$e" ]] && { echo "-"; return; }
  if [[ "$e" == *-* ]]; then days="${e%%-*}"; e="${e#*-}"; fi
  IFS=: read -r a b c <<< "$e"
  if [[ -n "$c" ]]; then hh=$a; mm=$b; else hh=0; mm=$a; fi
  local th=$(( 10#${days:-0}*24 + 10#${hh:-0} ))
  local m=$(( 10#${mm:-0} ))
  if (( th >= 24 )); then echo "$(( th/24 ))d $(( th%24 ))h"
  elif (( th > 0 )); then echo "${th}h ${m}m"
  else echo "${m}m"; fi
}
uptime_of() {  # $1 psmatch
  local e
  e=$(ps -Ao etime=,command= 2>/dev/null | grep -F "$1" | grep -v grep | head -1 | awk '{print $1}')
  humanize_etime "$e"
}

# sets STATE (DOWN/AUTH/WARN/OK), MSG, NOTE
check_service() {
  local label="$1" logf="$LOGS/$2" auth="$3"
  STATE=OK; MSG=""; NOTE=""

  local pid
  pid=$(launchctl list 2>/dev/null | awk -v l="$label" '$3==l{print $1}')
  if [[ -z "$pid" || "$pid" == "-" ]]; then
    STATE=DOWN; MSG="not running — watchdog will restart it (launchctl kickstart -k gui/$(id -u)/$label)"
    return
  fi

  if [[ "$label" == "com.changoh.web" ]]; then
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 6 "$WEB" 2>/dev/null)
    if [[ "$code" =~ ^(200|301|302|307|308)$ ]]; then STATE=OK; MSG="HTTP $code (pid $pid)"
    else STATE=DOWN; MSG="not responding (curl=$code) — check .run-logs/dev.log"; fi
    return
  fi

  [[ -f "$logf" ]] || { STATE=OK; MSG="pid $pid, no log yet"; return; }
  local mtime age after
  mtime=$(stat -f %m "$logf" 2>/dev/null || echo 0)
  age=$(( $(now_epoch) - mtime ))

  # TOPIC_CLOSED note (not an error — just informational)
  if [[ "$label" == "com.changoh.bot" ]] && tail -n 30 "$logf" | grep -q "TOPIC_CLOSED"; then
    NOTE="a topic is closed in the group (Telegram) — reopen it or move the target thread if needed"
  fi

  if (( age < WINDOW )); then
    after=$(tail -n 50 "$logf" | awk -v b="$BANNER" '
      { l[NR]=$0; if ($0 ~ b) last=NR }
      END { for (i=last+1;i<=NR;i++) print l[i] }')
    local nauth ncode nsoft eline
    nauth=$(echo "$after" | grep -cE "$AUTHERR")
    ncode=$(echo "$after" | grep -cE "$CODEERR")
    nsoft=$(echo "$after" | grep -cE "$SOFTERR")
    if (( nauth >= 1 )) && [[ -n "$auth" ]]; then
      eline=$(echo "$after" | grep -E "$AUTHERR" | tail -1 | sed 's/^[[:space:]]*//')
      STATE=AUTH; MSG="session may have expired → run: ${auth}  | ${eline:0:52}"; return
    elif (( ncode >= 1 )); then
      eline=$(echo "$after" | grep -E "$CODEERR" | tail -1 | sed 's/^[[:space:]]*//')
      STATE=WARN; MSG="code error: ${eline:0:72}"; return
    elif (( nsoft >= 3 )); then
      eline=$(echo "$after" | grep -E "$SOFTERR" | tail -1 | sed 's/^[[:space:]]*//')
      STATE=WARN; MSG="repeated errors x${nsoft}: ${eline:0:56}"; return
    elif (( nsoft >= 1 )); then
      STATE=OK; MSG="pid $pid"
      NOTE="${NOTE:+$NOTE · }transient error x${nsoft} — auto-reconnecting"; return
    fi
  fi
  STATE=OK; MSG="pid $pid"
}

check_drive_token() {
  local f="$ROOT/.drive-token.json"
  [[ -f "$f" ]] || { echo "AUTH|.drive-token.json missing → run: npm run drive:auth"; return; }
  node -e '
    const t=require(process.argv[1]);
    if(!t.refresh_token){ console.log("AUTH|no refresh_token → npm run drive:auth"); process.exit(0);}
    const cal=(t.scope||"").includes("calendar");
    const mins=t.expiry_date?Math.round((t.expiry_date-Date.now())/60000):null;
    const exp=mins===null?"":(mins>0?` · access expires in ${mins}m`:" · access expired (auto-refresh)");
    console.log(`OK|refresh_token OK${cal?" · calendar scope ✓":""}${exp}`);
  ' "$f" 2>/dev/null || echo "WARN|.drive-token.json unreadable"
}

# ---- layout metrics (recomputed each refresh so resizing works) ----
layout() {
  COLS=$(tput cols 2>/dev/null || echo 100); (( COLS < 50 )) && COLS=50
  local rw=$(( COLS - 4 )); (( rw > 90 )) && rw=90
  RULE=$(printf '%*s' "$rw" '' | tr ' ' '-')
  CLKCOL=$(( COLS - 18 )); (( CLKCOL < 24 )) && CLKCOL=24
}

# ---- table rows ----
add_row() {  # name state uptime details
  local name="$1" st="$2" up="$3" det="$4" word col pad
  # pad นับ "ช่องว่างที่ต้องเติมให้ครบ 6 คอลัมน์" เอง — printf ของ bash นับไบต์ ไม่ใช่คอลัมน์
  # ถ้าปล่อยให้ %-6s จัดเอง อักษรหลายไบต์อย่าง "·" จะทำให้ตารางเบี้ยว
  case "$st" in
    OK)   word=UP;   col="$G"; pad=4;;
    WARN) word=WARN; col="$Y"; pad=2;;
    AUTH) word=AUTH; col="$M"; pad=2;;
    DOWN) word=DOWN; col="$R"; pad=2;;
    INFO) word="·";  col="$D"; pad=5;;   # แค่บอกข้อมูล ไม่ใช่สถานะขึ้น/ลง
    *)    word="$st"; col="$N"; pad=$(( 6 - ${#st} )); (( pad < 1 )) && pad=1;;
  esac
  local budget=$(( COLS - 33 )); (( budget < 20 )) && budget=20
  det="${det:0:budget}"
  local line
  printf -v line '  %-9s %s%s%s%*s%s %-11s %s' "$name" "$col" "$B" "$word" "$pad" '' "$N" "$up" "$det"
  BODY_LINES+=("$line")
}
add_note() {  # text
  local budget=$(( COLS - 20 )); (( budget < 20 )) && budget=20
  local line; printf -v line '      %s↳ note: %s%s' "$D" "${1:0:budget}" "$N"
  BODY_LINES+=("$line")
}
# เส้นแบ่งโซน — ให้เห็นชัดว่าอันไหนของบริษัท อันไหนของ Vex
add_section() {  # title color
  local title="$1" col="${2:-$C}" w
  w=$(( ${#RULE} - ${#title} - 5 )); (( w < 4 )) && w=4
  local dash; dash=$(printf '%*s' "$w" '' | tr ' ' '=')
  BODY_LINES+=("")
  BODY_LINES+=("  ${col}${B}== ${title} ${dash}${N}")
  BODY_LINES+=("")
}
# วนเช็คบริการหนึ่งชุด — อัปเดต SECT_WORST ให้ผู้เรียก
# ส่งสมาชิก array มาตรง ๆ ("${ARR[@]}") เพราะ bash 3.2 ของ macOS ไม่มี nameref (local -n)
run_services() {
  local s
  for s in "$@"; do
    IFS='|' read -r label logf name role auth psmatch <<< "$s"
    check_service "$label" "$logf" "$auth"
    local up det; up=$(uptime_of "$psmatch")
    if [[ "$STATE" == OK ]]; then det="$role · $MSG"; else det="$MSG"; fi
    add_row "$name" "$STATE" "$up" "$det"
    [[ -n "$NOTE" ]] && add_note "$NOTE"
    [[ "$STATE" == DOWN || "$STATE" == AUTH ]] && SECT_WORST=BAD
    [[ "$STATE" == WARN && "$SECT_WORST" == OK ]] && SECT_WORST=WARN
  done
}

# ---- gather all data into BODY_LINES + WORST ----
collect() {
  layout
  BODY_LINES=(); local worst=OK

  # ===================== โซน 1 · บริษัท (น้องวาน) =====================
  add_section "WAAN · ระบบบริษัท" "$C"
  SECT_WORST=OK
  run_services "${WAAN_SERVICES[@]}"
  [[ "$SECT_WORST" == BAD ]] && worst=BAD
  [[ "$SECT_WORST" == WARN && "$worst" == OK ]] && worst=WARN

  # Google token
  local tokline tstate tmsg
  tokline=$(check_drive_token); tstate="${tokline%%|*}"; tmsg="${tokline#*|}"
  add_row "gtoken" "$tstate" "-" "Google Drive/Calendar · $tmsg"
  [[ "$tstate" == AUTH ]] && worst=BAD

  # Ollama (embeddings for the Thunder knowledge base)
  local ok; ok=$(curl -s --max-time 4 http://localhost:11434/api/tags 2>/dev/null | grep -c "bge-m3")
  if [[ "$ok" -ge 1 ]]; then
    add_row "ollama" OK "-" "bge-m3 · ready, semantic search available"
  else
    add_row "ollama" WARN "-" "bge-m3 not ready · semantic search off (other systems OK)"
    [[ "$worst" == OK ]] && worst=WARN
  fi

  # Thunder brain stats
  local tstats
  tstats=$(sqlite3 prisma/changoh.db "SELECT (SELECT COUNT(*) FROM Customer)||' customers · '||(SELECT COUNT(*) FROM CustomerFact)||' facts · '||(SELECT COUNT(*) FROM ThunderKnowledge)||' Q&A in KB'" 2>/dev/null)
  add_row "brain" OK "-" "memory · ${tstats:-no data yet}"

  # Chat memory (conversations + daily reports)
  local cstats lastrep
  cstats=$(sqlite3 prisma/changoh.db "SELECT (SELECT COUNT(*) FROM ChatLog)||' conversations · analyzed '||(SELECT COUNT(*) FROM ChatLog WHERE analyzed=1)||' · reports '||(SELECT COUNT(*) FROM DailyReport)||' days'" 2>/dev/null)
  lastrep=$(sqlite3 prisma/changoh.db "SELECT bizDate||' ('||chatCount||' cases)' FROM DailyReport ORDER BY bizDate DESC LIMIT 1" 2>/dev/null)
  add_row "chat" OK "-" "reports · ${cstats:-no data yet}${lastrep:+ · latest $lastrep}"

  # ===================== โซน 2 · เลขาส่วนตัว (Vex) =====================
  add_section "VEX · เลขาส่วนตัวของโด้" "$M"
  SECT_WORST=OK
  run_services "${VEX_SERVICES[@]}"

  # Chrome ตัวจริงของ Vex — launchd เป็น one-shot (KeepAlive false) เช็ค PID ไม่ได้ ต้องเคาะพอร์ตดีบักเอง
  local cver
  cver=$(curl -s --max-time 3 http://localhost:9222/json/version 2>/dev/null | sed -n 's/.*"Browser": *"\([^"]*\)".*/\1/p')
  if [[ -n "$cver" ]]; then
    add_row "chrome" OK "-" "Chrome ตัวจริง :9222 · ${cver}"
  else
    add_row "chrome" WARN "-" "Chrome ตัวจริงไม่เปิด — เปิดใหม่: npm run kiki:chrome"
    [[ "$SECT_WORST" == OK ]] && SECT_WORST=WARN
  fi

  # แผงละเอียดของ Vex (สาย/คิวพูด/งาน/ความจำ/คลัง/เงิน/นัด/เสียง/เซสชัน)
  local vexlines
  vexlines=$(node scripts/status-vex.mjs 2>/dev/null)
  if [[ -n "$vexlines" ]]; then
    BODY_LINES+=("")
    while IFS='|' read -r vname vstate vdet; do
      [[ -z "$vname" ]] && continue
      add_row "$vname" "$vstate" "-" "$vdet"
      [[ "$vstate" == DOWN || "$vstate" == AUTH ]] && SECT_WORST=BAD
      [[ "$vstate" == WARN && "$SECT_WORST" == OK ]] && SECT_WORST=WARN
    done <<< "$vexlines"
  else
    add_row "vexinfo" WARN "-" "อ่านแผงละเอียดของ Vex ไม่ได้ — ลอง: node scripts/status-vex.mjs"
    [[ "$SECT_WORST" == OK ]] && SECT_WORST=WARN
  fi

  [[ "$SECT_WORST" == BAD ]] && worst=BAD
  [[ "$SECT_WORST" == WARN && "$worst" == OK ]] && worst=WARN

  # ===================== โซน 3 · โทเค็น/ค่าใช้จ่าย AI =====================
  local usage; usage=$(node scripts/usage-cli.mjs 2>/dev/null)
  if [[ -n "$usage" ]]; then
    add_section "AI USAGE · โทเค็น · ค่าใช้จ่าย · บริบท" "$C"
    while IFS= read -r l; do BODY_LINES+=("  ${C}${l}${N}"); done <<< "$usage"
  fi
  BODY_LINES+=("")

  WORST="$worst"
}

# ---- bottom status bar (built once per refresh; animated each frame) ----
setup_bottom() {  # worst
  case "$1" in
    WARN) BG=$'\033[43m'; FGN=$'\033[30m'; FGH=$'\033[97m'; local msg="Some errors - check the highlighted rows above";;
    BAD)  BG=$'\033[41m'; FGN=$'\033[97m'; FGH=$'\033[93m'; local msg="Problem detected - a service is down or needs re-login";;
    *)    BG=$'\033[42m'; FGN=$'\033[30m'; FGH=$'\033[97m'; local msg="Working normally - No issues";;
  esac
  local w=$(( ${#msg} + 20 )); (( w > COLS - 4 )) && w=$(( COLS - 4 ))
  local pad=$(( (w - ${#msg}) / 2 )); (( pad < 0 )) && pad=0
  local rpad=$(( w - pad - ${#msg} )); (( rpad < 0 )) && rpad=0
  BAR=$(printf '%*s%s%*s' "$pad" '' "$msg" "$rpad" '')
  BW=${#BAR}; (( BW < 1 )) && BW=1
}
shimmer() {  # offset
  local off="$1" a b c
  if (( off + SPAN <= BW )); then
    a=${BAR:0:off}; b=${BAR:off:SPAN}; c=${BAR:off+SPAN}
    printf '%s%s%s%s%s%s%s%s' "$BG" "$FGN$a" "$FGH$b" "$FGN$c" "$N" "" "" ""
  else
    local wrap=$(( off + SPAN - BW ))
    b=${BAR:off}; a=${BAR:wrap:off-wrap}; c=${BAR:0:wrap}
    printf '%s%s%s%s%s' "$BG" "$FGH$c" "$FGN$a" "$FGH$b" "$N"
  fi
}

# ---- draw one full frame (uses cursor-home + erase, no full clear = flicker-free) ----
draw() {  # spinner clock offset
  local sp="$1" clk="$2" off="$3" ln
  printf '\033[H'
  printf '  %s  WAAN + VEX \302\267 SYSTEM STATUS\033[K\033[%dG\033[2mlive \302\267 %s\033[0m\033[K\n' "$sp" "$CLKCOL" "$clk"
  printf '  \033[2mrefresh %ss \302\267 Ctrl+C to quit\033[0m\033[K\n' "$REFRESH"
  printf '  \033[2m%s\033[0m\033[K\n' "$RULE"
  printf '\033[K\n'
  printf '  \033[2m%-9s %-6s %-11s %s\033[0m\033[K\n' 'COMPONENT' 'STATUS' 'UPTIME' 'DETAILS'
  for ln in "${BODY_LINES[@]}"; do printf '%s\033[K\n' "$ln"; done
  printf '\033[K\n'
  printf '  \033[2m%s\033[0m\033[K\n' "$RULE"
  printf '  '; shimmer "$off"; printf '\033[K\n'
  printf '\033[J'
}

# ---- single-shot mode ----
if (( ONCE == 1 )); then
  layout; collect; setup_bottom "$WORST"
  printf '\033[2J\033[H'
  draw "${SPIN[0]}" "$(date '+%H:%M:%S')" 0
  printf '\n'
  exit 0
fi

# ---- live mode ----
printf '\033[?25l\033[2J'
trap 'printf "\033[?25h\n\033[2mmonitor closed\033[0m\n"; exit 0' INT TERM
frame=0
while true; do
  if (( frame % FPR == 0 )); then collect; setup_bottom "$WORST"; fi
  draw "${SPIN[$(( (frame/2) % 10 ))]}" "$(date '+%H:%M:%S')" "$(( (frame*3) % BW ))"
  frame=$(( frame + 1 ))
  sleep 0.12
done
