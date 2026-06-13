#!/bin/bash
# ==============================================================================
# V1.1.0
# CF-Server-Monitor 安装/卸载脚本 (企业级安全加固版)
# 支持: Ubuntu/Debian/CentOS/RHEL/Fedora/Rocky/AlmaLinux
# Fixes: 1. 独立协程无 wait 阻塞 2. 原子化原子覆盖 3. 兼容全版本 Systemd 4. 严格 set -u 闭环
# ==============================================================================

set -euo pipefail

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# 路径定义
SERVICE_NAME="cf-probe"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
SCRIPT_FILE="/usr/local/bin/${SERVICE_NAME}.sh"

print_banner() {
    echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║     CF-Server-Monitor 探针管理工具 (Enterprise) ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
}

info() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; exit 1; }
step() { echo -e "${BLUE}[→]${NC} $1"; }

check_root() {
    if [ "$(id -u)" != "0" ]; then
        error "请使用 root 权限运行此脚本: sudo bash $0"
    fi
}

detect_os() {
    # 彻底杜绝 set -u 下 source /etc/os-release 由于发行版自身未知变量未定义导致的崩溃
    if [ -f /etc/os-release ]; then
        OS_ID=$(grep -E '^ID=' /etc/os-release | cut -d= -f2 | tr -d '"' | tr -d "'")
    else
        OS_ID=$(uname -s | tr '[:upper:]' '[:lower:]')
    fi
    OS_ID=${OS_ID:-"unknown"}
    
    case "$OS_ID" in
        ubuntu|debian|raspbian) PKG_MGR="apt-get" ;;
        centos|rhel|fedora|rocky|almalinux|ol|amzn) PKG_MGR="yum" ;;
        *) warn "未识别的系统类型: $OS_ID，尝试默认使用 apt-get" ; PKG_MGR="apt-get" ;;
    esac
}

install_deps() {
    step "检查系统依赖组件..."
    local required_cmds=("curl" "awk" "grep" "sed" "ps" "df")
    
    for cmd in "${required_cmds[@]}"; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            warn "缺少必要依赖: $cmd，正在尝试自动安装..."
            if [ "${PKG_MGR:-apt-get}" = "apt-get" ]; then
                apt-get update -qq && apt-get install -y -qq "$cmd" >/dev/null 2>&1 || true
            else
                yum install -y -q "$cmd" >/dev/null 2>&1 || true
            fi
        fi
        if ! command -v "$cmd" >/dev/null 2>&1; then
            error "无法自动安装依赖 [$cmd]，请手动安装后重试。"
        fi
    done
    
    if ! command -v systemctl >/dev/null 2>&1; then
        error "本脚本仅支持基于 systemd 的 Linux 发行版。"
    fi
    info "基础依赖组件检查通过"
}

stop_old_service() {
    step "清理可能存在的旧服务进程..."
    if systemctl is-active --quiet "${SERVICE_NAME}.service" 2>/dev/null; then
        systemctl stop "${SERVICE_NAME}.service" 2>/dev/null || true
    fi
    if systemctl is-enabled --quiet "${SERVICE_NAME}.service" 2>/dev/null; then
        systemctl disable "${SERVICE_NAME}.service" 2>/dev/null || true
    fi
    if pgrep -f "${SERVICE_NAME}.sh" >/dev/null 2>&1; then
        pkill -9 -f "${SERVICE_NAME}.sh" 2>/dev/null || true
    fi
}

create_script() {
    local report_interval=${1:-60}
    local ping_type=${2:-http}
    local ct_node=${3:-}
    local cu_node=${4:-}
    local cm_node=${5:-}
    local bd_node=${6:-}
    local reset_day=${7:-1}
    step "注入工业级监控采集探针..."

    cat > "${SCRIPT_FILE}" << 'PROBE_EOF'
#!/bin/bash
# 激活严格的未定义变量检查与错误即刻退出
set -eu

SERVER_ID="${1:-}"
SECRET="${2:-}"
WORKER_URL="${3:-}"
REPORT_INTERVAL="${4:-60}"
PING_TYPE="${5:-PING_TYPE_PLACEHOLDER}"
CT_NODE="${6:-}"
CU_NODE="${7:-}"
CM_NODE="${8:-}"
BD_NODE="${9:-}"
RESET_DAY="${10:-1}"

# 严苛环境下的规范 JSON 字段转义函数
escape_json() {
    local val="${1:-}"
    val="${val//\\/\\\\}"
    val="${val//\"/\\\"}"
    val="${val//$'\n'/ }"
    val="${val//$'\r'/}"
    echo -n "$val"
}

safe_div() {
    local num="${1:-0}"
    local den="${2:-0}"
    local def="${3:-0}"
    if [ "${den}" -eq 0 ]; then echo "${def}"; else echo $(( num / den )); fi
}

get_net_bytes() {
    awk 'NR>2{rx+=$2;tx+=$10}END{printf "%.0f %.0f\n",rx,tx}' /proc/net/dev 2>/dev/null || echo "0 0";
}

# ------------------ 月度流量追踪模块 ------------------
# 功能：计算当月消耗流量（上行/下行），自动处理服务器重启和跨月重置
TRAFFIC_DATA_DIR="/var/lib/cf-probe"
TRAFFIC_DATA_FILE="${TRAFFIC_DATA_DIR}/traffic.dat"

# 获取当月账单周期起始时间戳（UTC+0）
get_period_start_ts() {
    local reset_day="$1"
    local now_ts="$2"
    local year month day
    # 使用 UTC 时间获取年月日
    year=$(date -u -d "@${now_ts}" '+%Y' 2>/dev/null || date -u -r "${now_ts}" '+%Y' 2>/dev/null)
    month=$(date -u -d "@${now_ts}" '+%m' 2>/dev/null || date -u -r "${now_ts}" '+%m' 2>/dev/null)
    day=$(date -u -d "@${now_ts}" '+%d' 2>/dev/null || date -u -r "${now_ts}" '+%d' 2>/dev/null)
    
    local target_day="$reset_day"
    # 处理月份最后一天：2月最多29天，4/6/9/11月最多30天
    case "$month" in
        02) [ "$target_day" -gt 29 ] && target_day=29 ;;
        04|06|09|11) [ "$target_day" -gt 30 ] && target_day=30 ;;
    esac
    
    local period_start_ts
    if [ "$day" -ge "$target_day" ]; then
        # 当月重置日当天及之后（UTC时间 00:00:00）
        period_start_ts=$(date -u -d "${year}-${month}-${target_day} 00:00:00" '+%s' 2>/dev/null || date -u -r "${now_ts}" '+%s' 2>/dev/null)
    else
        # 上个月重置日（UTC时间 00:00:00）
        local prev_month=$((month - 1))
        [ "$prev_month" -eq 0 ] && { prev_month=12; year=$((year - 1)); }
        local prev_month_str=$(printf "%02d" "$prev_month")
        case "$prev_month" in
            02) [ "$target_day" -gt 29 ] && target_day=29 ;;
            04|06|09|11) [ "$target_day" -gt 30 ] && target_day=30 ;;
        esac
        period_start_ts=$(date -u -d "${year}-${prev_month_str}-${target_day} 00:00:00" '+%s' 2>/dev/null || date -u -r "${now_ts}" '+%s' 2>/dev/null)
    fi
    echo "$period_start_ts"
}

# 计算月度流量（自动持久化）
calc_monthly_traffic() {
    local current_rx="$1"
    local current_tx="$2"
    local reset_day="${RESET_DAY:-1}"
    local now_ts
    now_ts=$(date '+%s')
    
    mkdir -p "${TRAFFIC_DATA_DIR}" 2>/dev/null || true
    
    # 读取上次保存的数据（使用临时变量避免与全局变量冲突）
    local saved_rx_prev=0 saved_tx_prev=0 saved_rx_period=0 saved_tx_period=0 saved_last_check=0 saved_period_start=0
    if [ -f "${TRAFFIC_DATA_FILE}" ]; then
        local tmp_rx_prev tmp_tx_prev tmp_rx_period tmp_tx_period tmp_last_check tmp_period_start
        while IFS='=' read -r key value; do
            case "$key" in
                RX_PREV) tmp_rx_prev="$value" ;;
                TX_PREV) tmp_tx_prev="$value" ;;
                RX_PERIOD) tmp_rx_period="$value" ;;
                TX_PERIOD) tmp_tx_period="$value" ;;
                LAST_CHECK) tmp_last_check="$value" ;;
                PERIOD_START) tmp_period_start="$value" ;;
            esac
        done < "${TRAFFIC_DATA_FILE}"
        saved_rx_prev=${tmp_rx_prev:-0}; saved_tx_prev=${tmp_tx_prev:-0}
        saved_rx_period=${tmp_rx_period:-0}; saved_tx_period=${tmp_tx_period:-0}
        saved_last_check=${tmp_last_check:-0}; saved_period_start=${tmp_period_start:-0}
    fi
    
    # 计算当前账单周期起始
    local period_start_ts
    period_start_ts=$(get_period_start_ts "$reset_day" "$now_ts")
    
    # 检测是否是首次运行（没有历史记录）
    local rx_delta=0 tx_delta=0
    if [ "$saved_last_check" -ne 0 ]; then
        # 非首次运行，计算增量
        if [ "$current_rx" -lt "$saved_rx_prev" ] || [ "$current_tx" -lt "$saved_tx_prev" ]; then
            rx_delta=0; tx_delta=0
        else
            rx_delta=$((current_rx - saved_rx_prev))
            tx_delta=$((current_tx - saved_tx_prev))
        fi
        
        # 判断是否进入新账单周期（跨月）
        if [ "$period_start_ts" -ne "$saved_period_start" ] && [ "$saved_period_start" -ne 0 ]; then
            saved_rx_period="$rx_delta"; saved_tx_period="$tx_delta"
        else
            saved_rx_period=$((saved_rx_period + rx_delta))
            saved_tx_period=$((saved_tx_period + tx_delta))
        fi
    else
        # 首次运行，周期流量从0开始
        saved_rx_period=0
        saved_tx_period=0
    fi
    
    # 持久化保存
    cat > "${TRAFFIC_DATA_FILE}.tmp" << EOF
RX_PREV=${current_rx}
TX_PREV=${current_tx}
RX_PERIOD=${saved_rx_period}
TX_PERIOD=${saved_tx_period}
LAST_CHECK=${now_ts}
PERIOD_START=${period_start_ts}
EOF
    mv "${TRAFFIC_DATA_FILE}.tmp" "${TRAFFIC_DATA_FILE}" 2>/dev/null || true
    
    # 返回当月流量（上行=tx, 下行=rx）
    echo "$saved_rx_period $saved_tx_period"
}

get_cpu_stat() {
    awk '/^cpu /{total=$2+$3+$4+$5+$6+$7+$8+$9;idle=$5+$6;printf "%.0f %.0f\n",total,idle}' /proc/stat 2>/dev/null || echo "0 0";
}

get_http_ping() { 
    local rtt
    rtt=$(curl -o /dev/null -s -m 1 --connect-timeout 1 -w "%{time_total}" "http://${1:-}" 2>/dev/null | awk '{printf "%.0f", $1*1000}')
    if [ -n "$rtt" ] && [ "$rtt" -gt 0 ] 2>/dev/null; then
        echo "$rtt"
    else
        echo ""
    fi
}

get_tcp_ping() {
    local host="${1:-}"
    local port="${2:-443}"
    local scheme="http"
    local timing

    if [ -z "${host}" ]; then
        echo ""
        return
    fi

    if [ "${port}" = "443" ]; then
        scheme="https"
    fi

    timing=$(curl -k -o /dev/null -s \
        --connect-timeout 2 \
        --max-time 3 \
        -w "%{time_namelookup} %{time_connect}" \
        "${scheme}://${host}:${port}/" 2>/dev/null || true)

    awk -v t="${timing}" 'BEGIN{
        split(t, a, " ")
        dns = a[1] + 0
        conn = a[2] + 0
        if (conn <= 0 || conn < dns) {
            print ""
            exit
        }
        ms = int((conn - dns) * 1000 + 0.5)
        if (ms < 1) ms = 1
        print ms
    }'
}

get_ping() {
    local host="$1"
    local port="${2:-443}"
    
    if [ "${PING_TYPE}" = "tcp" ]; then
        get_tcp_ping "$host" "$port"
    else
        get_http_ping "$host"
    fi
}

# 测试节点定义（支持参数覆盖，空值则跳过）
CT_NODE="${CT_NODE:-}"
CU_NODE="${CU_NODE:-}"
CM_NODE="${CM_NODE:-}"
BD_NODE="${BD_NODE:-}"

# ==============================================================================
# 高并发/无竞态后台网络 Worker 协程
# ==============================================================================
run_network_worker() {
    # 继承外层 set -eu 行为
    set -eu
    local last_ip=0
    local last_ping=0
    
    while true; do
        local now; now=$(date +%s)
        
        # 10分钟检测一次 IP
        if [ $((now - last_ip)) -ge 600 ] || [ "$last_ip" -eq 0 ]; then
            (curl -s -m 2 --connect-timeout 2 https://cloudflare.com/cdn-cgi/trace 2>/dev/null | grep -q "ip=" && echo "1" || echo "0") > /dev/shm/.cf_ipv4.tmp && mv /dev/shm/.cf_ipv4.tmp /dev/shm/.cf_ipv4 || true
            (curl -6 -s -m 2 --connect-timeout 2 https://cloudflare.com/cdn-cgi/trace 2>/dev/null | grep -q "ip=" && echo "1" || echo "0") > /dev/shm/.cf_ipv6.tmp && mv /dev/shm/.cf_ipv6.tmp /dev/shm/.cf_ipv6 || true
            last_ip="$now"
        fi
        
        # 30秒检测一次网络延迟
        if [ $((now - last_ping)) -ge 30 ] || [ "$last_ping" -eq 0 ]; then
            [ -n "$CT_NODE" ] && get_ping "$CT_NODE" > /dev/shm/.cf_ping_ct.tmp && mv /dev/shm/.cf_ping_ct.tmp /dev/shm/.cf_ping_ct || rm -f /dev/shm/.cf_ping_ct
            [ -n "$CU_NODE" ] && get_ping "$CU_NODE" > /dev/shm/.cf_ping_cu.tmp && mv /dev/shm/.cf_ping_cu.tmp /dev/shm/.cf_ping_cu || rm -f /dev/shm/.cf_ping_cu
            [ -n "$CM_NODE" ] && get_ping "$CM_NODE" > /dev/shm/.cf_ping_cm.tmp && mv /dev/shm/.cf_ping_cm.tmp /dev/shm/.cf_ping_cm || rm -f /dev/shm/.cf_ping_cm
            [ -n "$BD_NODE" ] && get_ping "$BD_NODE" > /dev/shm/.cf_ping_bd.tmp && mv /dev/shm/.cf_ping_bd.tmp /dev/shm/.cf_ping_bd || rm -f /dev/shm/.cf_ping_bd
            last_ping="$now"
        fi
        sleep 5
    done
}

# 首次基础数据初始化
NET_STAT=$(get_net_bytes)
RX_PREV=$(echo "$NET_STAT" | awk '{print $1}'); RX_PREV=${RX_PREV:-0}
TX_PREV=$(echo "$NET_STAT" | awk '{print $2}'); TX_PREV=${TX_PREV:-0}

CPU_STAT=$(get_cpu_stat)
PREV_CPU_TOTAL=$(echo "$CPU_STAT" | awk '{print $1}'); PREV_CPU_TOTAL=${PREV_CPU_TOTAL:-0}
PREV_CPU_IDLE=$(echo "$CPU_STAT" | awk '{print $2}'); PREV_CPU_IDLE=${PREV_CPU_IDLE:-0}

PREV_LOOP_TIME=$(date +%s)

echo "[INFO] CF-Server-Monitor Probe Engine Started Successfully."

# 核心架构升级：在这里脱离主循环，静默启动常驻网络 Worker 协程，无 wait 干扰
run_network_worker &

while true; do
    LOOP_START_TIME=$(date +%s)
    
    # ------------------ 同步系统指标采集模块 (全面 set -u 安全适配) ------------------
    MEM_TOTAL_KB=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0); MEM_TOTAL_KB=${MEM_TOTAL_KB:-0}
    MEM_AVAIL_KB=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0); MEM_AVAIL_KB=${MEM_AVAIL_KB:-0}
    if [ "${MEM_AVAIL_KB}" -eq 0 ]; then
        MEM_FREE_KB=$(awk '/^MemFree:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0); MEM_FREE_KB=${MEM_FREE_KB:-0}
        MEM_BUFF_KB=$(awk '/^Buffers:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0); MEM_BUFF_KB=${MEM_BUFF_KB:-0}
        MEM_CACH_KB=$(awk '/^Cached:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0); MEM_CACH_KB=${MEM_CACH_KB:-0}
        MEM_AVAIL_KB=$((MEM_FREE_KB + MEM_BUFF_KB + MEM_CACH_KB))
    fi
    RAM_TOTAL=$((MEM_TOTAL_KB / 1024))
    RAM_USED=$(((MEM_TOTAL_KB - MEM_AVAIL_KB) / 1024))
    [ "${RAM_USED}" -lt 0 ] && RAM_USED=0
    
    if [ "${RAM_TOTAL}" -gt 0 ]; then
        RAM=$(awk -v u="${RAM_USED}" -v t="${RAM_TOTAL}" 'BEGIN {printf "%.2f", (u/t)*100}')
    else
        RAM="0.00"
    fi

    SWAP_TOTAL_KB=$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0); SWAP_TOTAL_KB=${SWAP_TOTAL_KB:-0}
    SWAP_FREE_KB=$(awk '/^SwapFree:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0); SWAP_FREE_KB=${SWAP_FREE_KB:-0}
    SWAP_TOTAL=$((SWAP_TOTAL_KB / 1024))
    SWAP_USED=$(((SWAP_TOTAL_KB - SWAP_FREE_KB) / 1024))
    [ "${SWAP_USED}" -lt 0 ] && SWAP_USED=0

    # 规范化的 df 提取，防范因个别挂载路径过长导致换行错位
    DISK_INFO=$(df -P / 2>/dev/null | tail -n1 || echo "")
    DISK_TOTAL=0; DISK_USED=0; DISK=0
    if [ -n "${DISK_INFO}" ]; then
        DISK_TOTAL=$(echo "${DISK_INFO}" | awk '{print int($2/1024)}')
        DISK_USED=$(echo "${DISK_INFO}" | awk '{print int($3/1024)}')
        DISK=$(echo "${DISK_INFO}" | awk '{print $5}' | tr -d '%')
    fi

    # CPU 核心利用率计算
    CPU_STAT=$(get_cpu_stat)
    CPU_TOTAL_NOW=$(echo "$CPU_STAT" | awk '{print $1}'); CPU_TOTAL_NOW=${CPU_TOTAL_NOW:-0}
    CPU_IDLE_NOW=$(echo "$CPU_STAT" | awk '{print $2}'); CPU_IDLE_NOW=${CPU_IDLE_NOW:-0}
    DIFF_TOTAL=$((CPU_TOTAL_NOW - PREV_CPU_TOTAL))
    DIFF_IDLE=$((CPU_IDLE_NOW - PREV_CPU_IDLE))
    
    if [ "${DIFF_TOTAL}" -le 0 ]; then
        CPU="0.00"
    else
        CPU=$(awk -v t="${DIFF_TOTAL}" -v i="${DIFF_IDLE}" 'BEGIN {p=(1-i/t)*100; if(p<0)p=0; if(p>100)p=100; printf "%.2f", p}')
    fi
    PREV_CPU_TOTAL=${CPU_TOTAL_NOW}
    PREV_CPU_IDLE=${CPU_IDLE_NOW}

    # 基础静态/准静态元数据安全解析
    if [ -f /etc/os-release ]; then
        OS_RAW=$(grep -E '^PRETTY_NAME=' /etc/os-release | cut -d= -f2 | tr -d '"' | tr -d "'")
    else
        OS_RAW=$(uname -srm)
    fi
    OS=${OS_RAW:-"Linux"}
    ARCH=$(uname -m)
    BOOT_TIME=$(
    awk '
    $1=="btime"{
        print $2 * 1000
        exit
    }
    ' /proc/stat 2>/dev/null
    )
    BOOT_TIME=${BOOT_TIME:-0}
    CPU_INFO=$(grep -m 1 'model name' /proc/cpuinfo 2>/dev/null | awk -F: '{print $2}' | xargs || echo "")
    [ -z "${CPU_INFO}" ] && CPU_INFO=${ARCH}
    CPU_CORES=$(nproc 2>/dev/null || grep -c '^processor' /proc/cpuinfo 2>/dev/null || echo "1")
    LOAD_AVG=$(cat /proc/loadavg 2>/dev/null | awk '{print $1, $2, $3}' || echo "0 0 0")
    PROCESSES=$(ps -e 2>/dev/null | wc -l || echo 0)

    # ---------------- TCP ----------------
    TCP_CONN=""

    if command -v ss >/dev/null 2>&1; then
        # 只统计真正“活跃连接”
        TCP_CONN=$(ss -H -ant state established 2>/dev/null | wc -l)
    else
        # /proc fallback：只算 ESTABLISHED (st=01)
        TCP_CONN=$(awk 'NR>1 && $4=="01"{c++} END{print c+0}' /proc/net/tcp 2>/dev/null)
    fi

    TCP_CONN=$(printf "%s" "${TCP_CONN:-0}" | tr -d '\r\n ')


    # ---------------- UDP ----------------
    UDP_CONN=""

    if command -v ss >/dev/null 2>&1; then
        UDP_CONN=$(ss -H -anu 2>/dev/null | wc -l)
    else
        UDP_CONN=$(awk 'NR>1{c++} END{print c+0}' /proc/net/udp 2>/dev/null)
    fi

    UDP_CONN=$(printf "%s" "${UDP_CONN:-0}" | tr -d '\r\n ')

    # ------------------ 精确无干扰时钟网速算法 ------------------
    NET_STAT=$(get_net_bytes)
    RX_NOW=$(echo "$NET_STAT" | awk '{print $1}'); RX_NOW=${RX_NOW:-0}
    TX_NOW=$(echo "$NET_STAT" | awk '{print $2}'); TX_NOW=${TX_NOW:-0}
    
    # 计算当月累计流量
    MONTHLY_TRAFFIC=$(calc_monthly_traffic "$RX_NOW" "$TX_NOW")
    RX_MONTHLY=$(echo "$MONTHLY_TRAFFIC" | awk '{print $1}')
    TX_MONTHLY=$(echo "$MONTHLY_TRAFFIC" | awk '{print $2}')
    
    TIME_DELTA=$((LOOP_START_TIME - PREV_LOOP_TIME))
    [ "${TIME_DELTA}" -le 0 ] && TIME_DELTA=${REPORT_INTERVAL}
    
    RX_DELTA=$((RX_NOW - RX_PREV))
    TX_DELTA=$((TX_NOW - TX_PREV))
    [ "${RX_DELTA}" -lt 0 ] && RX_DELTA=0
    [ "${TX_DELTA}" -lt 0 ] && TX_DELTA=0
    
    RX_SPEED=$(safe_div "${RX_DELTA}" "${TIME_DELTA}" "0")
    TX_SPEED=$(safe_div "${TX_DELTA}" "${TIME_DELTA}" "0")
    
    RX_PREV=${RX_NOW}
    TX_PREV=${TX_NOW}
    PREV_LOOP_TIME=${LOOP_START_TIME}

    # ------------------ 读取共享内存 (Rename 机制下绝对无竞态) ------------------
    [ -f /dev/shm/.cf_ipv4 ] && IPV4=$(cat /dev/shm/.cf_ipv4) || IPV4="0"
    [ -f /dev/shm/.cf_ipv6 ] && IPV6=$(cat /dev/shm/.cf_ipv6) || IPV6="0"
    [ -f /dev/shm/.cf_ping_ct ] && PING_CT=$(cat /dev/shm/.cf_ping_ct) || PING_CT=""
    [ -f /dev/shm/.cf_ping_cu ] && PING_CU=$(cat /dev/shm/.cf_ping_cu) || PING_CU=""
    [ -f /dev/shm/.cf_ping_cm ] && PING_CM=$(cat /dev/shm/.cf_ping_cm) || PING_CM=""
    [ -f /dev/shm/.cf_ping_bd ] && PING_BD=$(cat /dev/shm/.cf_ping_bd) || PING_BD=""

    # 安全地构建闭合规范的 JSON 数据流
    EOS=$(escape_json "${OS}")
    EARCH=$(escape_json "${ARCH}")
    ECPU=$(escape_json "${CPU_INFO}")

    PAYLOAD=$(cat <<EOF
{"id":"$SERVER_ID","secret":"$SECRET","metrics":{"cpu":"$CPU","ram":"$RAM","ram_total":"$RAM_TOTAL","ram_used":"$RAM_USED","swap_total":"$SWAP_TOTAL","swap_used":"$SWAP_USED","disk":"$DISK","disk_total":"$DISK_TOTAL","disk_used":"$DISK_USED","load_avg":"$LOAD_AVG","boot_time":"$BOOT_TIME","net_rx":"$RX_NOW","net_tx":"$TX_NOW","net_rx_monthly":"$RX_MONTHLY","net_tx_monthly":"$TX_MONTHLY","net_in_speed":"$RX_SPEED","net_out_speed":"$TX_SPEED","os":"$EOS","arch":"$EARCH","cpu_info":"$ECPU","cpu_cores":"$CPU_CORES","processes":"$PROCESSES","tcp_conn":"$TCP_CONN","udp_conn":"$UDP_CONN","ip_v4":"$IPV4","ip_v6":"$IPV6","ping_ct":"$PING_CT","ping_cu":"$PING_CU","ping_cm":"$PING_CM","ping_bd":"$PING_BD"}}
EOF
)
    # 上报上游数据端 (限定 4s 超时控制，主循环绝不严重漂移)
    curl -s -o /dev/null -X POST -H "Content-Type: application/json" -d "$PAYLOAD" -m 4 --connect-timeout 2 "$WORKER_URL" 2>/dev/null || true
    
    # 动态补偿机制：减去指标采集耗时，保证平稳的上报频率
    LOOP_END_TIME=$(date +%s)
    EXEC_DURATION=$((LOOP_END_TIME - LOOP_START_TIME))
    SLEEP_TIME=$((REPORT_INTERVAL - EXEC_DURATION))
    [ "${SLEEP_TIME}" -le 0 ] && SLEEP_TIME=1
    sleep "${SLEEP_TIME}"
done
PROBE_EOF

    sed -i "s/PING_TYPE_PLACEHOLDER/${ping_type}/g" "${SCRIPT_FILE}"
    
    [ -n "${ct_node}" ] && sed -i "s|CT_NODE=\".*\"|CT_NODE=\"${ct_node}\"|g" "${SCRIPT_FILE}"
    [ -n "${cu_node}" ] && sed -i "s|CU_NODE=\".*\"|CU_NODE=\"${cu_node}\"|g" "${SCRIPT_FILE}"
    [ -n "${cm_node}" ] && sed -i "s|CM_NODE=\".*\"|CM_NODE=\"${cm_node}\"|g" "${SCRIPT_FILE}"
    [ -n "${bd_node}" ] && sed -i "s|BD_NODE=\".*\"|BD_NODE=\"${bd_node}\"|g" "${SCRIPT_FILE}"

    chmod +x "${SCRIPT_FILE}"
    info "探针脚本注入完成: ${SCRIPT_FILE}"
}

create_service() {
    local ct_node="${1:-}"
    local cu_node="${2:-}"
    local cm_node="${3:-}"
    local bd_node="${4:-}"
    
    step "构建高兼容、全版本通用的 Systemd 守护配置..."
    
    local esc_id; esc_id=$(printf '%s' "$SERVER_ID" | sed 's/\\/\\\\/g; s/"/\\"/g')
    local esc_sec; esc_sec=$(printf '%s' "$SECRET" | sed 's/\\/\\\\/g; s/"/\\"/g; s/%/%%/g')
    local esc_url; esc_url=$(printf '%s' "$WORKER_URL" | sed 's/\\/\\\\/g; s/"/\\"/g')
    local esc_ping; esc_ping=$(printf '%s' "$PING_TYPE" | sed 's/\\/\\\\/g; s/"/\\"/g')
    local esc_ct; esc_ct=$(printf '%s' "$ct_node" | sed 's/\\/\\\\/g; s/"/\\"/g')
    local esc_cu; esc_cu=$(printf '%s' "$cu_node" | sed 's/\\/\\\\/g; s/"/\\"/g')
    local esc_cm; esc_cm=$(printf '%s' "$cm_node" | sed 's/\\/\\\\/g; s/"/\\"/g')
    local esc_bd; esc_bd=$(printf '%s' "$bd_node" | sed 's/\\/\\\\/g; s/"/\\"/g')
    local esc_reset_day; esc_reset_day=$(printf '%s' "$RESET_DAY" | sed 's/\\/\\\\/g; s/"/\\"/g')
    
    # 完全剔除 MemoryHigh/MemoryMax/CPUQuota 等低版本 Systemd 会抛错的非泛用特性
    # 仅使用全版本 Linux 完美兼容的 Nice 权重调配及 IO 闲置调度
    cat > "${SERVICE_FILE}" << EOF
[Unit]
Description=CF Server Monitor Probe Agent
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/bin/bash "${SCRIPT_FILE}" "${esc_id}" "${esc_sec}" "${esc_url}" "${REPORT_INTERVAL}" "${esc_ping}" "${esc_ct}" "${esc_cu}" "${esc_cm}" "${esc_bd}" "${esc_reset_day}"
Restart=always
RestartSec=5
User=root
Group=root

# 生产级通用平滑优先级约束：永远不挤占前台核心业务
Nice=19
CPUSchedulingPolicy=other
IOSchedulingClass=idle
IOSchedulingPriority=7
StandardOutput=journal
StandardError=journal
SyslogIdentifier=cf-probe

[Install]
WantedBy=multi-user.target
EOF

    info "Systemd 守护配置文件生成成功: ${SERVICE_FILE}"
}

start_service() {
    step "加载进程树并激活监控探针..."
    systemctl daemon-reload
    systemctl enable ${SERVICE_NAME}.service >/dev/null 2>&1 || true
    systemctl restart ${SERVICE_NAME}.service
    
    sleep 1.5
    if systemctl is-active --quiet ${SERVICE_NAME}.service; then
        info "探针监控引擎已进入平稳运行状态。"
    else
        error "探针服务未能启动成功。请执行命令排查原因: journalctl -u ${SERVICE_NAME} -n 20"
    fi
}

install_probe() {
    SERVER_ID=""
    SECRET=""
    WORKER_URL=""
    REPORT_INTERVAL=""
    PING_TYPE=""
    CT_NODE=""
    CU_NODE=""
    CM_NODE=""
    BD_NODE=""
    RESET_DAY=""

    for arg in "$@"; do
        case "$arg" in
            -id=*) SERVER_ID="${arg#-id=}" ;;
            -secret=*) SECRET="${arg#-secret=}" ;;
            -url=*) WORKER_URL="${arg#-url=}" ;;
            -interval=*) REPORT_INTERVAL="${arg#-interval=}" ;;
            -ping=*) PING_TYPE="${arg#-ping=}" ;;
            -ct=*) CT_NODE="${arg#-ct=}" ;;
            -cu=*) CU_NODE="${arg#-cu=}" ;;
            -cm=*) CM_NODE="${arg#-cm=}" ;;
            -bd=*) BD_NODE="${arg#-bd=}" ;;
            -reset_day=*) RESET_DAY="${arg#-reset_day=}" ;;
        esac
    done

    if [ -z "$SERVER_ID" ] || [ -z "$SECRET" ] || [ -z "$WORKER_URL" ]; then
        echo -e "${RED}错误: 运行所需的入参不完整。${NC}\n"
        echo "用法:"
        echo "  bash $0 install -id=SERVER_ID -secret=SECRET -url=WORKER_URL [选项]"
        echo ""
        echo "必需参数:"
        echo "  -id=xxx        服务器ID"
        echo "  -secret=xxx    密钥"
        echo "  -url=xxx       上报地址"
        echo ""
        echo "可选参数:"
        echo "  -interval=N    上报间隔(秒)，默认60"
        echo "  -ping=TYPE     探测类型: http | tcp，默认http"
        echo "  -ct=HOST       自定义CT测试节点"
        echo "  -cu=HOST       自定义CU测试节点"
        echo "  -cm=HOST       自定义CM测试节点"
        echo "  -bd=HOST       自定义BD测试节点"
        echo "  -reset_day=N   流量重置日(1-31)，默认1"
        echo ""
        echo "示例:"
        echo "  bash $0 install -id=server123 -secret=abc123 -url=https://worker.example.com"
        echo "  bash $0 install -id=server123 -secret=abc123 -url=https://worker.example.com -interval=30 -ping=tcp"
        echo "  bash $0 install -id=server123 -secret=abc123 -url=https://worker.example.com -ct=ct.example.com -cu=cu.example.com"
        echo "  bash $0 install -id=server123 -secret=abc123 -url=https://worker.example.com -reset_day=15"
        exit 1
    fi

    REPORT_INTERVAL=${REPORT_INTERVAL:-60}
    PING_TYPE=${PING_TYPE:-http}
    RESET_DAY=${RESET_DAY:-1}

    print_banner
    check_root
    detect_os
    install_deps
    stop_old_service
    create_script "$REPORT_INTERVAL" "$PING_TYPE" "$CT_NODE" "$CU_NODE" "$CM_NODE" "$BD_NODE" "$RESET_DAY"
    create_service "$CT_NODE" "$CU_NODE" "$CM_NODE" "$BD_NODE"
    start_service

    echo -e "\n${GREEN}============================================="
    echo -e "         CF-Server-Monitor 安装成功"
    echo -e "=============================================${NC}"
    echo -e "  服务状态 : ${GREEN}Active (Running)${NC}"
    echo -e "  配置参数 :"
    echo -e "    ● Server ID   : ${SERVER_ID}"
    echo -e "    ● Secret      : ${SECRET}"
    echo -e "    ● Worker URL  : ${WORKER_URL}"
    echo -e "    ● 上报间隔    : ${REPORT_INTERVAL}秒"
    echo -e "    ● 探测类型    : ${PING_TYPE}"
    echo -e "    ● 流量重置日  : ${RESET_DAY}号"
    [ -n "${CT_NODE}" ] && echo -e "    ● CT节点      : ${CT_NODE}"
    [ -n "${CU_NODE}" ] && echo -e "    ● CU节点      : ${CU_NODE}"
    [ -n "${CM_NODE}" ] && echo -e "    ● CM节点      : ${CM_NODE}"
    [ -n "${BD_NODE}" ] && echo -e "    ● BD节点      : ${BD_NODE}"
    echo -e "  管理指令 :"
    echo -e "    ● 查看实时日志 : journalctl -u ${SERVICE_NAME} -f"
    echo -e "    ● 查看运行状态 : systemctl status ${SERVICE_NAME}"
    echo -e "    ● 停止探针服务 : systemctl stop ${SERVICE_NAME}"
    echo -e "=============================================\n"
}

uninstall_probe() {
    print_banner
    echo -e "${YELLOW}[!] 开始执行无残留深度卸载清理方案...${NC}\n"
    check_root

    step "停用并撤销系统守护进程..."
    if systemctl is-active --quiet "${SERVICE_NAME}.service" 2>/dev/null; then
        systemctl stop "${SERVICE_NAME}.service" 2>/dev/null || true
    fi
    if systemctl is-enabled --quiet "${SERVICE_NAME}.service" 2>/dev/null; then
        systemctl disable "${SERVICE_NAME}.service" 2>/dev/null || true
    fi

    step "清理服务描述性系统文件..."
    rm -f "${SERVICE_FILE}"
    systemctl daemon-reload 2>/dev/null || true
    systemctl reset-failed "${SERVICE_NAME}" 2>/dev/null || true

    step "销毁探针物理可执行代码文件..."
    rm -f "${SCRIPT_FILE}"

    step "抹除共享内存高速缓存区..."
    rm -f /dev/shm/.cf_ipv4 /dev/shm/.cf_ipv6 /dev/shm/.cf_ping_*

    step "抹除流量追踪数据..."
    rm -rf /var/lib/${SERVICE_NAME}

    step "根除孤儿或僵尸状态的探测残留进程..."
    if pgrep -f "${SERVICE_NAME}.sh" >/dev/null 2>&1; then
        pkill -9 -f "${SERVICE_NAME}.sh" 2>/dev/null || true
    fi

    echo -e "\n${GREEN}╔══════════════════════════════════════════╗"
    echo -e "║     ✓ 卸载完毕！系统环境无任何残留。     ║"
    echo -e "╚══════════════════════════════════════════╝${NC}\n"
}

case "${1:-install}" in
    install)
        shift 1 2>/dev/null || true
        install_probe "$@"
        ;;
    uninstall|remove|delete|purge)
        uninstall_probe
        ;;
    *)
        echo "未知指令. 可选命令: install | uninstall"
        exit 1
        ;;
esac