# 职位爬虫 + 多用户投递系统

该项目包含职位爬虫、后端 API、前端管理台三部分。  
本次已升级为多用户鉴权系统，支持 `user / vip / admin` 角色、单点登录、设备指纹校验和用户管理。

## 功能概览

- 职位列表查询、筛选、分页
- 投递记录 CRUD（严格按 `user_id` 隔离）
- 认证体系：注册、登录、登出、`/api/auth/me`
- 单点登录：同账号新登录会踢掉旧会话
- 设备指纹强校验：请求头 `X-Device-Fingerprint`
- 会话滑动过期：默认 3 小时，可配置
- 角色权限：
  - `user`：职位查询最多 10 条；投递记录最多 30 条
  - `vip`：职位与投递记录无限制
  - `admin`：可访问用户管理 API（查用户、改角色、强制下线）

## 目录结构

- `givemeoc_crawler.py`：爬虫脚本
- `backend`：Express + TypeScript + SQLite API
- `frontend`：React + Vite 前端
- `data/jobs.db`：SQLite 数据库文件

## 一、爬虫

安装依赖：

```bash
python -m pip install -r requirements.txt
```

示例：

```bash
python givemeoc_crawler.py --mode stop_on_existing --db-path data/jobs.db
python givemeoc_crawler.py --mode update_and_continue --db-path data/jobs.db
```

## 二、后端

### 安装与启动

```bash
cd backend
npm install
npm run dev
```

默认端口：`http://localhost:3001`

### 环境变量

- `PORT=3001`
- `DB_PATH=../data/jobs.db`
- `SESSION_TTL_SECONDS=10800`
- `BCRYPT_ROUNDS=12`
- `TOKEN_PEPPER=please-change-me`
- `FINGERPRINT_PEPPER=please-change-me`
- `ADMIN_EMAIL=admin@example.com`（首次无 admin 时用于自动创建）
- `ADMIN_PASSWORD=your-password`（首次无 admin 时用于自动创建）

### 认证与管理接口

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`（需鉴权）
- `GET /api/auth/me`（需鉴权）
- `GET /api/admin/users`（admin）
- `PATCH /api/admin/users/:id/role`（admin，仅可改为 user/vip）
- `POST /api/admin/users/:id/force-logout`（admin）

### 业务接口（全部需鉴权）

- `GET /api/jobs`
- `POST /api/jobs/:postId/apply`
- `GET /api/applications`
- `GET /api/applications/:id`
- `POST /api/applications`
- `PUT /api/applications/:id`
- `DELETE /api/applications/:id`

## 三、前端

### 安装与启动

```bash
cd frontend
npm install
npm run dev
```

默认端口：`http://localhost:5173`  
已配置 `/api` 代理到 `http://localhost:3001`。

### 页面与权限

- `/login`、`/register`：公共页面
- `/jobs`、`/applications`：登录后可访问
- `/users`：仅 `admin` 可访问

## 四、数据库迁移说明

- 新增 `users`、`user_sessions` 表
- `applications` 新增 `user_id`，并改为 `(user_id, post_id)` 唯一
- 当检测到旧版 `applications` 结构时，会自动清空并重建该表（不保留旧数据）

## 五、构建验证

已通过：

- `cd backend && npm run build`
- `cd frontend && npm run build`
