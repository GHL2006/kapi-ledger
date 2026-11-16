# 咔皮记账 · 双人共享账本（纯前端 + Supabase）

参考「咔皮记账」UI 的移动端记账网站，**只给两个人用**：

- 两本独立账本：各自记自己的，可以切换查看对方的（只读）；
- 时间轴展示账单，支持消费照片、编辑、删除；
- 资产 / 负债记录；
- 月度报表（文字 + 分类表格 + 饼图）、年度总账；
- CSV 导出、图片列表；
- 纯前端：HTML + TailwindCSS + JavaScript，数据存 Supabase（PostgreSQL + Storage + Auth），部署在 GitHub Pages。
- **不需要服务器、不需要域名、不需要备案、不需要数据库运维。**

## 线上地址

- 网站：<https://ghl2006.github.io/kapi-ledger/>
- 代码：<https://github.com/GHL2006/kapi-ledger>

> 登录方式：只需要输入密码（你和朋友各用自己的 4 位密码）；密码不写进公开仓库，需要时私聊获取或到 Supabase 后台重置。

---

## 一、技术栈

| 部分 | 技术 |
| --- | --- |
| 页面 | HTML5 + TailwindCSS（本地 vendor 文件） |
| 交互 | 原生 JavaScript |
| 数据库 | Supabase PostgreSQL（免费 500MB） |
| 图片 | Supabase Storage（免费 1GB，私有桶 + 签名链接） |
| 登录 | Supabase Auth（只输密码，固定两个账号，前端隐藏邮箱） |
| 图表 | ECharts（本地 vendor 文件） |
| 部署 | GitHub Pages（免费 HTTPS） |

---

## 二、目录结构

```text
kapi-ledger/
├── index.html              页面（登录 + 账单/资产/统计/我的）
├── css/style.css           自定义样式（时间轴、卡片、弹窗、Tab）
├── js/config.js            ★ 需要填写 Supabase URL 和 anon key
├── js/app.js               全部业务逻辑
├── vendor/                 本地依赖（Tailwind / Supabase / ECharts）
├── supabase/schema.sql     ★ 建表 + RLS 权限 + 存储桶
├── start-local.bat         本地启动脚本
└── .nojekyll               GitHub Pages 用
```

---

## 三、Supabase 配置（一次性，约 10 分钟）

### 1. 创建项目

打开 <https://supabase.com>，注册登录，点 **New project**：

- 名称：`kapi-ledger`
- 数据库密码：自己记好（只用于数据库，不影响登录）
- 区域：选 Singapore / Tokyo 等离你近的

### 2. 建表 + 权限 + 存储桶

进入项目 → 左侧 **SQL Editor** → New query → 把 `supabase/schema.sql` 全部粘贴进去 → **Run**。

成功后会创建：

- `profiles`：用户资料
- `categories`：分类（含 8 个预设）
- `bills`：账单
- `assets`：资产/负债
- `bill-images` 存储桶（私有）
- RLS 规则：登录用户能看所有人的数据，但只能改自己的

### 3. 关闭邮箱验证、关闭注册

- **Authentication → Providers → Email**：关闭 **Confirm email**；
- **Authentication → Sign In / Up**：如果不想让陌生人注册，关闭 **Allow new users to sign up**（账号由你在后台创建）。

### 4. 创建两个账号

**Authentication → Users → Add user**，分别创建：

| 邮箱（示例） | 后台密码（注意规则） | 显示名 |
| --- | --- | --- |
| `me@example.com` | `kapi-1234`（即 `kapi-` + 你的 4 位密码） | 我 |
| `friend@example.com` | `kapi-4321`（即 `kapi-` + 朋友的 4 位密码） | 朋友 |

> 邮箱只是登录名，不需要真的能收邮件（因为关闭了邮箱验证）。
> 前端只让用户输入 4 位密码，代码会自动拼成 `kapi-` + 4 位密码去登录；所以 Supabase 后台的密码必须按这个规则设置。**不要把密码提交到仓库**。

创建后到 SQL Editor 执行（把邮箱换成你实际的）：

```sql
update public.profiles set display_name = '我'
where email = 'me@example.com';

update public.profiles set display_name = '朋友'
where email = 'friend@example.com';
```

> **注册限制**：项目数据库里已经加了触发器，只允许 `me@example.com` / `friend@example.com` 两个邮箱注册；即使匿名注册开关没关，陌生人也注册不进来。如果你换了邮箱，要同步修改 `schema.sql` 里的触发器。

> 如果 profiles 里没有数据，说明创建用户时触发器没生效；到 SQL Editor 手动执行：
> ```sql
> insert into public.profiles (id, email, display_name)
> select id, email, split_part(email, '@', 1) from auth.users
> on conflict (id) do nothing;
> ```

### 5. 填写前端配置

项目 → **Project Settings → API**，复制：

- Project URL（形如 `https://xxxx.supabase.co`）
- anon public key（很长的一串）

打开 `js/config.js`，填进去：

```js
const SUPABASE_URL = "https://xxxx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOi...";
```

> anon key 是设计为公开的，安全由 RLS 保证；**不要**把 `service_role` key 放前端。

### 6. 本地运行

双击 `start-local.bat`，或命令行：

```bat
cd kapi-ledger
python -m http.server 5500
```

浏览器打开 <http://127.0.0.1:5500/>，输入你的 4 位密码登录。

> 不要直接双击 `index.html`（`file://` 下 Supabase 和图片可能受限），用本地 HTTP 服务。

---

## 四、部署到 GitHub Pages（免费）

1. 在 GitHub 新建仓库（例如 `kapi-ledger`，Private/Public 都行）；
2. 把本目录所有文件推到仓库根目录：

   ```bat
   git init
   git add .
   git commit -m "咔皮记账：纯前端 + Supabase"
   git branch -M main
   git remote add origin https://github.com/你的用户名/kapi-ledger.git
   git push -u origin main
   ```

3. GitHub 仓库 → **Settings → Pages**：
   - Source：`Deploy from a branch`
   - Branch：`main`，目录 `/ (root)`
   - 保存，等 1~2 分钟；
4. 得到地址：`https://你的用户名.github.io/kapi-ledger/`；
5. 回 Supabase → **Authentication → URL Configuration**，把 Site URL 改成这个 GitHub Pages 地址（保存）。

之后两个人手机浏览器打开这个网址就能记账，**不用开电脑**。

---

## 五、数据安全 / 备份（重要）

- 数据存在 **Supabase 云端 PostgreSQL**，不是 localStorage；换手机、清缓存不会丢；
- 图片存在 **Supabase Storage**，数据库只存对象路径，页面用签名 URL 显示；
- 两个人各自有账号和密码，RLS 保证**只能改自己的账单**，对方的只能看；
- **免费项目连续多天不访问会暂停**（不是删除），到 Supabase 控制台点恢复即可，数据保留；
- 建议每月在“我的 → 导出当前账本 CSV”备份一次；重要数据可以在 Supabase 后台导出数据库。

### 免费额度

| 资源 | 免费额度 | 两个人够不够 |
| --- | --- | --- |
| 数据库 | 500MB | 非常够 |
| 图片存储 | 1GB | 够（照片会压缩） |
| 月流量 | 5GB | 够 |
| 项目暂停 | 长时间不活跃会暂停 | 数据保留，可恢复 |

---

## 六、两个账号的权限规则

| 操作 | 我的账本 | 朋友的账本 |
| --- | --- | --- |
| 查看 | ✅ | ✅ |
| 新增/编辑/删除账单 | ✅ | ❌（前端隐藏 + 数据库 RLS 拒绝） |
| 资产/负债 | ✅ | ✅ 只读 |
| 月报/年总账 | ✅ | ✅ 只读 |
| 导出 CSV | ✅ | ✅（只读导出） |

---

## 七、常见问题

| 问题 | 解决 |
| --- | --- |
| 登录提示“密码不正确” | 4 位密码不对，或 Supabase 后台密码不是 `kapi-` + 4 位 |
| 登录提示 `Email not confirmed` | Authentication → Providers → Email 关闭 Confirm email |
| 页面一直显示“还没配置 Supabase” | `js/config.js` 没填对 |
| 图片上传失败 | 检查 `bill-images` 桶是否存在、Storage 策略是否执行 |
| 看不到对方数据 | 两个账号都要创建，且 profiles 有两条记录 |
| GitHub Pages 打开空白 | 看仓库 Settings → Pages 是否部署成功；路径是否为根目录 |
| 免费项目暂停 | Supabase 控制台恢复项目 |

---

## 八、开发说明

- 前端所有请求都走 `supabase-js`，没有自己的后端；
- `state` 里只保存当前页面状态，数据每次从 Supabase 读取；
- 图片上传前会在浏览器里压缩到最长边 1600px、JPEG 质量 0.82；
- 账单金额、消费时间、分类、归属人由 RLS + 前端双重校验。
