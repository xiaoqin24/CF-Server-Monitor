# [CF-Server-Monitor](https://github.com/huilang-me/CF-Server-Monitor)

一个基于 Cloudflare Workers + D1 的多服务器监控探针系统，支持实时监控、历史数据查看、延迟追踪、地图展示等功能。兼容主流Linux系统，Alpine Linux，Windows系统。**演示地址**：<https://tz.dashdeep.dpdns.org/>

**当前版本：V2.6.5**

- V2.6.4 增加了 **月流量统计** 功能，升级后请在后台手动点击 **升级数据库** 来更新数据库结构。不然会导致数据库结构错误，影响正常运行。同时需要在后台设置重置日期，并重新安装脚本。
- V2.6.3 应大家需求，增加自定义Ping设置
- V2.6.0 降低了 50% 的D1写入消耗，强烈建议升级，升级后请在后台手动点击 升级数据库 或者 重建数据库 。
- V2.5.0 增加客户端上报数据后，在不占用D1消耗的情况下，前端WebSocket实时刷新数据
- V2.4.0 版本主要优化了D1读写占用，使项目消耗大大降低，以及增加了防护避免被刷。

## ✨ 功能特点

- 📊 **实时监控**：CPU、内存、磁盘、网络、进程数、连接数、负载均衡
- 📈 **历史图表**：支持 1/3/6/12/24 小时历史数据查看
- 🌍 **全球地图**：可视化展示服务器分布
- 🔔 **离线告警**：支持 Telegram 和企业微信通知
- 📱 **响应式**：支持桌面端和移动端
- 🔄 **自动部署**：GitHub Actions 一键部署
- 🗺️ **延迟追踪**：国内电信/联通/移动/字节延迟监测
- 🔒 **服务器隐藏**：可设置特定服务器对非登录用户隐藏
- ↕️ **拖拽排序**：后台拖拽调整服务器显示顺序
- 🌐 **双语支持**：支持中文和英文界面自由切换
- 🧪 **本地测试**：支持本地模拟数据生成，方便开发和测试
- 🔐 **Turnstile 验证**：集成 Cloudflare Turnstile 人机验证，增强 API 安全性
- 🔑 **JWT 认证**：登录系统采用 JWT token 认证，支持自定义密钥
- ⚡ **实时推送**：基于 Durable Objects + WebSocket，探针上报后页面立即刷新，无轮询延迟

## 🚀 快速开始

### 前置要求

- [Cloudflare 账户](https://dash.cloudflare.com/)
- [GitHub 账户](https://github.com/)

<details>
<summary>方式一：Cloudflare Workers 连接GitHub仓库（推荐使用，方便同步）</summary>

### 第一步：Fork 项目

点击右上角 **Fork** 按钮，将项目 Fork 到你的 GitHub 账户。

### 第二步：新建 Cloudflare Workers

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)
2. 进入 **[Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages)**
3. 点击 **Create application**
4. 选择 Continue with GitHub（第一次使用需要连接 GitHub 账户），选择本项目
5. Project Name填写：`cf-server-monitor`,小写即可，可按自己需求设置
6. Build command 填写：`npm run build:frontend`
7. 点击 **Deploy**，成功会在底部显示`✨ Success! Build completed.`

### 第三步：配置环境变量

1. 在当前Workers & Pages页面，点击 **Settings**
2. 在Variables and secrets找到API\_SECRET，点右侧编辑，填写密码（建议使用随机数,不要包含特殊字符比如%），点Deploy保存部署，等待30秒左右部署完成

</details>

<details>
<summary>方式二：GitHub Action 自动部署</summary>

### 第一步：Fork 项目

点击右上角 **Fork** 按钮，将项目 Fork 到你的 GitHub 账户。

### 第二步：创建 D1 数据库

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)
2. 进入 **[Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages)**  → **[D1 SQL Database](https://dash.cloudflare.com/?to=/:account/workers/d1)**
3. 点击 **Create database**
4. 数据库名称填写：`server-monitor-db`
5. 点击 **Create**
6. 记录下生成的 **Database ID**，稍后会用到

### 第三步：获取 Cloudflare 配置

#### 获取 Account ID

**方式一：从右侧面板获取**

1. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com/?to=/:account/workers-and-pages)
2. 在右侧面板找到 **Account ID**
3. 复制保存

**方式二：从 URL 中获取**

- 登录后访问任意 Cloudflare 页面，例如 [Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages)
- URL 中 `dash.cloudflare.com/` 之后的那串字符就是 Account ID

#### 获取 API Token

1. 打开 [API Tokens 页面](https://dash.cloudflare.com/profile/api-tokens)
2. 点击 **Create Token/创建令牌**
3. 选择（**Edit Cloudflare Workers/编辑 Cloudflare Workers**）模板
4. 在 **Account Resources/帐户资源** 选择你的账户
5. 点击 **Continue to summary/继续以显示摘要**→ **Create Token/创建令牌**
6. 复制生成的 Token（只显示一次！）

### 第四步：配置 GitHub Secrets

1. 打开你 Fork 的 GitHub 仓库
2. 进入 **Settings** → **Secrets and variables** → **Actions**
3. 点击 **New repository secret**，依次添加以下 5 个密钥：

| Secret 名称        | 值                  | 说明                                     |
| ---------------- | ------------------ | -------------------------------------- |
| `CF_API_TOKEN`   | 第三步获取的 Token       | Cloudflare API 令牌                      |
| `CF_ACCOUNT_ID`  | 第三步获取的 ID          | Cloudflare 账户 ID                       |
| `API_USER_NAME`  | 自定义用户名（非必填）        | 管理后台用户名 新版已移除，默认用户名admin               |
| `API_SECRET`     | API 认证密钥（必填）       | 探针认证密钥 & 默认管理后台密码 建议使用随机密码,不要包含特殊字符比如% |
| `D1_DATABASE_ID` | 第二步获取的 Database ID | D1 数据库 ID                              |

### 第五步：部署

#### 方式一：自动部署

推送代码到 `main` 分支即可自动部署：

```bash
# 克隆你 Fork 的仓库
git clone https://github.com/你的用户名/CF-Server-Monitor.git
cd CF-Server-Monitor

# 可选：修改配置后提交
git add .
git commit -m "Initial setup"
git push origin main
```

推送后，GitHub Actions 会自动部署。在仓库的 **Actions** 标签页可查看部署进度。

#### 方式二：手动部署

也可以通过 GitHub Actions 手动触发部署：

1. 进入你的 GitHub 仓库页面
2. 点击顶部的 **Actions** 标签
3. 在左侧工作流列表中选择 **Deploy to Cloudflare Workers**
4. 点击右侧的 **Run workflow** 按钮
5. 选择分支（默认选择 `main`）
6. 点击 **Run workflow** 开始部署

部署进度可在 **Actions** 标签页中查看。

</details>

<details>
<summary>方式三：一键部署（比较简单，但不推荐，不方便更新）</summary>

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/huilang-me/CF-Server-Monitor)

新用户点击一键部署

修改`API_SECRET`，建议使用随机密码,不要包含特殊字符比如%，登录密码在登录后修改，建议和API\_SECRET不同。

在build command中填入 `npm run build:frontend`，其他保持默认

点击部署即可

</details>

## 📊 使用说明

<details>
<summary>访问管理后台</summary>

部署成功后，访问管理后台：

```
https://你的项目名.你的子域.workers.dev/admin
```

- 用户名：默认admin，如果设置了环境变量 `API_USER_NAME`，则使用该值
- 密码：你设置的 `API_SECRET`

**登录后务必修改用户名和密码，以确保安全。** 强烈建议登录密码和探针认证密钥不同。

> **提示**：项目名和子域可以在 Cloudflare Workers & Pages 页面找到。建议绑定域名，避免国内无法访问

</details>

<details>
<summary>添加服务器监控</summary>

### 在管理后台添加服务器

1. 进入管理后台 `/admin`
2. 在"服务器名称"输入框填写名称
3. 点击 **+ 添加服务器**
4. 点击新服务器旁的 **📋** 按钮复制安装命令

### Linux系统

Ubuntu / Debian / CentOS / RHEL / Fedora / Rocky / AlmaLinux 系统

```bash
curl -sL https://你的项目.你的子域.workers.dev/install.sh | bash -s install -id=<SERVER_ID> -secret=<SECRET> -url=<WORKER_URL> [-interval=60] [-ping=http] [-ct=xxx] [-cu=xxx] [-cm=xxx] [-bd=xxx]
```

Alpine 系统

```bash
curl -sL https://你的项目.你的子域.workers.dev/install-alpine.sh | sh -s install -id=<SERVER_ID> -secret=<SECRET> -url=<WORKER_URL> [-interval=60] [-ping=http] [-ct=xxx] [-cu=xxx] [-cm=xxx] [-bd=xxx]
```

### Windows 系统安装

对于 Windows 系统，使用 Python 脚本安装探针：

#### 安装依赖

`pip install psutil pystray pillow`

#### 下载探针脚本

[cf-server-monitor.pyw](public/cf-server-monitor.pyw)

#### 运行探针

双击`cf-server-monitor.pyw`文件即可启动探针。

**参数说明：**

| 参数          | 说明                      | 默认值    |
| ----------- | ----------------------- | ------ |
| `-id`       | 服务器唯一标识符（必填）            | -      |
| `-secret`   | API 认证密钥（必填）            | -      |
| `-url`      | Worker 上报地址（必填）         | -      |
| `-interval` | 数据上报间隔（秒）               | `60`   |
| `-ping`     | Ping 检测类型（`http`/`tcp`） | `http` |
| `-ct`       | 自定义CT测试节点               | 默认节点   |
| `-cu`       | 自定义CU测试节点               | 默认节点   |
| `-cm`       | 自定义CM测试节点               | 默认节点   |
| `-bd`       | 自定义BD测试节点               | 默认节点   |

> **注意**：上报间隔越短，数据越实时，但会增加 API 调用和数据库存储。建议根据服务器数量和网络状况选择合适的间隔。

</details>

<details>
<summary>卸载探针</summary>

Ubuntu / Debian / CentOS / RHEL / Fedora / Rocky / AlmaLinux 系统

```bash
curl -sL https://你的项目.你的子域.workers.dev/install.sh | bash -s uninstall
```

Alpine 系统

```bash
curl -sL https://你的项目.你的子域.workers.dev/install-alpine | sh -s uninstall
```

Windows 系统

启动cf-server-monitor.pyw后，GUI中关闭自启动（如已开启）。点删除，再删除这个文件即可

</details>

<details>
<summary>安全增强</summary>

### Turnstile 配置（可选）

如需启用 Turnstile 人机验证，可用基本拦截恶意攻击避免额度超出，需在管理后台配置：

1. 登录 [Cloudflare Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile)
2. 创建站点，获取 **Site Key** 和 **Secret Key**
3. 在管理后台 → 全局设置中启用 Turnstile 并填入密钥

### JWT 配置（可选）

如需自定义 JWT 密钥：

1. 生成一个至少 32 位的随机字符串作为 JWT Secret
2. 在管理后台 → 全局设置中填入 JWT Secret
3. 保存后系统将使用自定义密钥进行 token 签名

</details>

<details>
<summary>其他设置</summary>

### 前台大盘

访问 `https://你的项目.你的子域.workers.dev/` 查看：

- **卡片视图**：服务器状态概览（含实时网速和本月流量）
- **表格视图**：详细数据列表
- **地图视图**：全球服务器分布
- **过滤器**：按国家筛选服务器

### 服务器详情

点击任意服务器卡片进入详情页：

- 实时 CPU/内存/磁盘/网络/负载
- 1/3/6/12/24 小时历史趋势图
- 鼠标悬停查看具体时间点的数值
- 国内三大运营商延迟追踪

> **注意**：查看1小时以上的历史数据需要登录管理员账户。

### 主题切换

管理后台支持自定义 CSS主题

### 拖拽排序

在管理后台的服务器列表中，可以通过拖拽调整服务器的显示顺序

### 服务器隐藏

可以将特定服务器设置为对非登录用户隐藏：

1. 进入管理后台 `/admin`
2. 点击服务器行右侧的 **✏️ 编辑** 按钮
3. 勾选 **Hide from Public** 选项
4. 点击 **保存**

### 数据库管理

管理后台提供数据库维护功能，可在 "Database Management" 标签页中找到：

1. **升级数据库**：将数据库结构升级到最新版本，适用于旧版本用户升级
   - 点击「Upgrade Database」按钮
   - 确认升级操作
   - 系统会自动执行数据库升级脚本
2. **重建数据库**：清空并重建整个数据库（⚠️ 危险操作）
   - 点击「Rebuild Database」按钮
   - 确认重建操作（此操作将删除所有数据）
   - 系统会清空并重新初始化数据库

> **注意**：
>
> - 重建数据库是不可逆操作，请确保已备份重要数据
> - 升级数据库不会删除现有数据，仅会更新表结构

## 🔔 离线告警配置

在管理后台 → 全局设置中配置：

**Telegram 告警：**

1. 创建 Telegram Bot（通过 [@BotFather](https://t.me/BotFather)）
2. 获取 Bot Token
3. 获取 Chat ID（通过 [@userinfobot](https://t.me/userinfobot)）
4. 填入后台设置并开启

**企业微信告警：**

1. 创建群机器人，获取 Webhook URL
2. 填入 Bot Token 字段
3. Chat ID 留空

</details>

<details>
<summary>定时任务</summary>

系统包含以下定时任务（UTC 时区）：

| 任务   | 触发时间          | 说明                       |
| ---- | ------------- | ------------------------ |
| 数据清理 | `50 23 * * *` | 每天UTC 23:50 清理 3 天前的历史数据 |
| 离线检测 | `*/1 * * * *` | 每分钟检测离线节点并发送告警           |

</details>

## 📁 项目结构

<details>
<summary>项目结构</summary>

```
CF-Server-Monitor/
├── public/
│   ├── cf-server-monitor.pyw   # Windows 探针脚本（.pyw 不显示 CMD 窗口）
│   ├── install.sh              # 一键安装脚本（含卸载）
│   └── logo.svg                # Logo
├── src/
│   ├── index.js                # 后端主入口 - 路由分发 + Durable Object 导出
│   ├── database/
│   │   ├── schema.js           # 数据库初始化、历史数据存储
│   │   └── updateDatabase.js   # 数据库升级处理
│   ├── durable/
│   │   └── MetricsBroadcaster.js  # Durable Object：WebSocket 实时推送广播中心
│   ├── middleware/
│   │   └── auth.js             # 认证中间件
│   ├── handlers/
│   │   ├── admin.js            # 后台管理 API
│   │   ├── dashboard.js        # 前台大盘 API
│   │   ├── frontend.js         # 前端资源服务
│   │   └── update.js           # 数据上报处理 + 广播到 DO
│   ├── services/
│   │   └── notification.js     # 通知服务
│   ├── utils/
│   │   ├── cache.js            # 缓存工具
│   │   └── settings.js         # 设置管理
│   └── frontend/               # Vue 3 前端应用
│       ├── components/         # Vue 组件
│       │   ├── Footer.vue
│       │   ├── ServerCard.vue
│       │   └── TerminalHeader.vue
│       ├── views/              # 页面视图
│       │   ├── Admin.vue
│       │   ├── Dashboard.vue    # 首页（接入 WebSocket 实时推送）
│       │   └── ServerDetail.vue # 详情页（接入 WebSocket 实时推送）
│       ├── router/
│       │   └── index.js        # Vue Router 配置
│       ├── utils/
│       │   ├── api.js          # API 请求封装 + WebSocket 客户端
│       │   └── i18n.js         # 国际化配置
│       ├── styles/             # 样式文件
│       │   ├── light.css
│       │   └── main.css
│       ├── App.vue             # 根组件
│       └── main.js             # 前端入口
├── scripts/
│   └── build.js                # 前端构建脚本
├── test/
│   ├── README.md               # 测试工具说明
│   └── generate-sql.js         # 测试数据生成工具
│   ├── mock-sender.sh          # 模拟数据发送脚本（macOS）
├── index.html
├── jsconfig.json               # JS 配置
├── package.json
├── vite.config.js              # Vite 配置
├── wrangler.toml               # 本地测试 wrangler 配置
└── .github/
    └── workflows/
        └── deploy.yml          # GitHub Actions 自动部署
```

</details>

## ❓ 常见问题

<details>
<summary>常见问题</summary>

**Q: 部署后返回API\_SECRET is required**

如果是GitHub Action 自动部署，确保在 GitHub Secrets 中设置了 API\_SECRET 密钥。
如果是一键部署，确保在Cloudflare Workers & Pages 中设置了 API\_SECRET 密钥。

**Q: 探针安装后不显示数据？**

检查服务器是否能访问 Worker URL，查看探针日志：`journalctl -u cf-probe -f`

**Q: 如何更换 API\_SECRET？**

更新 Cloudflare Workers & Pages 中的 `API_SECRET`，重新部署，并在所有服务器上重新安装探针。如果是GitHub Action 自动部署，需要在 GitHub Secrets 中更新 `API_SECRET`。

**Q: D1 数据库免费额度够用吗？**

Cloudflare D1 免费版提供 5GB 存储和 5M 读取行/日、100K 写入行/日，足以支持服务器监控。

写入行：1台服务器一天占用写入行是2.88k，免费写入额度是100k/天，理论上可用支持34台服务器的监控，如果修改上报频率为120秒可用翻倍。

读取行：1台服务器一天占用读行是8k左右，如果开启站点兼容，大概是1.6k，免费读行是5M/天，非常充裕
主要是前端访问消耗的次数，限制了非登录用户1小时以上的查看，只要不被暴力刷额度，绝对够用，如果不放心，可用在后台开启Turnstile人机验证，或者也可以选择仅登录查看

**Q: D1 数据库免费额度超出扣费吗？**

超出不扣费，只会限制访问，第二天北京时间08:00重置

**Q: 遇到其他异常问题怎么办？**

可以尝试在后台数据库管理中：

- 升级数据库：尝试修复数据库结构问题
- 重置数据库：清空并重建数据库（⚠️ 注意：此操作将清除所有数据，请确保已备份重要信息）

**Q: 忘记密码？**

进入Cloudflare后台，进入D1数据库（server-monitor-db），点击右上角explore data，进入后点击左侧的`setting`表，双击`site_options`右侧的value，可以看到`用户名`和md5加密的`密码`，password修改成`e10adc3949ba59abbe56e057f20f883e`，即默认密码`123456`，右上角点Commit 1 change，弹出的确认框点确认即可。然后访问后台用默认密码登录即可。

</details>

## 📸 界面预览

<details>
<summary>界面预览</summary>

![image](https://github.com/user-attachments/assets/0527f847-4631-47ad-8315-3f80ebba42d2)
![image](https://github.com/user-attachments/assets/a9c1aefd-42f7-4805-aa42-bbe9e58aed59)
![image](https://github.com/user-attachments/assets/527bcf04-3124-4f1c-b052-451bccae961d)
![image](https://github.com/user-attachments/assets/ac6f6fbb-b9fb-45cd-93e5-ca08bbad9ecb)
![image](https://github.com/user-attachments/assets/b5436816-54bd-4512-a65c-bf963fd4874c)
![image](https://github.com/user-attachments/assets/ba0d3605-ef64-4be1-884b-9506f20277a8)
![image](https://github.com/user-attachments/assets/197767cc-028b-4ec1-b41f-5cadc2b25629)

浅色风格
![image](https://github.com/user-attachments/assets/3a7f3204-0a68-4f59-9822-f7f1b5479822)
![image](https://github.com/user-attachments/assets/e100d984-3165-4f38-948a-625249b4600a)
![image](https://github.com/user-attachments/assets/7d266ff3-0db7-477b-8029-c76e42298002)

</details>

## 🛠️ 本地开发

<details>
<summary>本地开发步骤</summary>

### 环境要求

- Node.js 18+
- npm 或 pnpm

### 开发步骤

根目录新建 `.env` 文件，添加环境变量默认API\_SECRET：

```bash
API_SECRET = "123456"
```

然后执行以下命令进行本地开发：

```bash
# 安装依赖
npm install

# 创建 D1 数据库（首次）
npx wrangler d1 create server-monitor-db

# 前端开发模式（热重载）
npm run dev

# 构建前端生产版本
npm run build:frontend

# 部署到 Cloudflare Workers
npm run deploy
```

### 本地测试数据

支持生成本地测试数据，方便在部署前进行功能测试：

1. 进入 `test` 目录查看详细说明
2. 运行测试数据生成脚本
3. 导入生成的 SQL 数据到本地 D1 数据库
4. 启动本地开发服务器进行测试

```
node test/generate-sql.js
wrangler d1 execute server-monitor-db --file=test/mock-data.sql
```

详细步骤见 [test/README.md](test/README.md)

### API 接口测试

项目提供了 `api-check.js` 接口测试工具，用于验证本地开发环境的 API 接口是否正常工作：

```bash
# 默认配置测试
node test/api-check.js

# 指定参数测试
node test/api-check.js --base-url=http://localhost:8787 --api-secret=123456

# 查看帮助
node test/api-check.js --help
```

**测试覆盖范围：**

- 未登录接口：`/api/config`、`/api/servers`、`/api/server`、`/update` 等
- 登录流程：登录接口验证
- 已登录接口：隐藏服务器访问、历史数据查询等
- 后台管理：服务器增删改查、设置管理等

**选项参数：**

| 参数                 | 说明          | 默认值                     |
| ------------------ | ----------- | ----------------------- |
| `--base-url`       | 本地服务地址      | `http://localhost:8787` |
| `--api-secret`     | API\_SECRET | `123456`                |
| `--admin-user`     | 管理员用户名      | `admin`                 |
| `--admin-password` | 管理员密码       | 使用 API\_SECRET          |
| `--timeout`        | 请求超时时间(ms)  | `10000`                 |

</details>

## 📄 许可证

MIT License

## 🙏 致谢

- [CF-Server-Monitor-Pro](https://github.com/a63414262/CF-Server-Monitor-Pro) 最初借鉴该项目，进行深度二次开发
- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Vue 3](https://vuejs.org/)
- [Vite](https://vitejs.dev/)
- [Chart.js](https://www.chartjs.org/)
- [Leaflet](https://leafletjs.com/)
- 感谢 [LINUX DO](https://linux.do/) 社区的支持与推广

