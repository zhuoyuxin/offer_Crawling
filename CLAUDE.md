# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在本仓库中工作时提供指引。
默认中文回答
## 项目概述

多用户职位追踪系统：Python 爬虫 → Express/TypeScript API → React/Vite 前端。数据存储于 SQLite (`data/jobs.db`)。

## 开发命令

```bash
# 爬虫
python -m pip install -r requirements.txt
python givemeoc_crawler.py --mode update_and_continue --db-path data/jobs.db
python givemeoc_crawler.py --mode stop_on_existing --db-path data/jobs.db --start-page 5 --max-pages 10

# 后端（端口 3001）
cd backend && npm install && npm run dev        # 开发模式，tsx watch
cd backend && npm run build && npm start         # 生产模式

# 前端（端口 5173，/api 代理到后端）
cd frontend && npm install && npm run dev
cd frontend && npm run build && npm run preview
```

无自动化测试框架。提交前需在 backend 和 frontend 分别执行 `npm run build` 验证编译通过。

## 架构

**三个组件，一个数据库：**
- `givemeoc_crawler.py` 抓取 givemeoc.com → 写入 SQLite `jobs` 表
- `backend/src/server.ts` 提供 REST API（所有路由集中在一个文件），含鉴权中间件
- `frontend/src/pages/` React 页面消费 API

**鉴权流程：** 每次请求携带 Bearer token + `X-Device-Fingerprint` 请求头。Token 和指纹使用 SHA-256 + pepper 哈希后存储。会话滑动过期（默认 3 小时）。新登录会踢掉旧会话。

**核心数据表：** `jobs`（post_id 主键）、`users`（角色：user/vip/admin）、`user_sessions`（token_hash + fingerprint_hash）、`applications`（按 user_id 隔离，user_id+post_id 唯一约束）。

**角色限制：** user = 最多查询 10 条职位 + 30 条投递记录；vip/admin = 无限制。

## 代码规范

- 提交信息：Conventional Commits 中文描述 — `feat(scope):`, `fix(scope):`, `chore(scope):`
- TypeScript：strict 模式、2 空格缩进、分号、双引号
- React 文件：PascalCase（`JobsPage.tsx`）；工具/中间件：camelCase（`requireRole.ts`）
- 前端导入使用 `@/` 别名（映射到 `src/`）
- Python：PEP 8、4 空格缩进、snake_case、类型注解

## 后端环境变量

生产环境必须设置：`TOKEN_PEPPER`、`FINGERPRINT_PEPPER`（启动时校验）。
可选：`PORT`(3001)、`DB_PATH`(../data/jobs.db)、`SESSION_TTL_SECONDS`(10800)、`BCRYPT_ROUNDS`(12)、`ADMIN_EMAIL`/`ADMIN_PASSWORD`（首次启动自动创建管理员）、`CORS_ORIGIN`(http://localhost:5173)。

## 数据库说明

- 后端首次启动时自动初始化表结构；若数据库为空则自动从 `jobs.json` 导入
- 旧版 `applications` 表若缺少 `user_id` 字段，会自动删除并重建（旧数据丢失）
- `head.txt` 存放爬虫使用的浏览器请求模板（请求头 + Cookie）
