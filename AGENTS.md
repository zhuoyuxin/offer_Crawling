# Repository Guidelines（仓库贡献指南）

## 项目结构与模块组织
本仓库由三部分组成：
- `givemeoc_crawler.py`：独立 Python 爬虫，用于抓取职位并写入数据库。
- `backend/`：Express + TypeScript 后端 API（`src/` 为源码，`dist/` 为构建产物）。
- `frontend/`：React + Vite 前端（`src/` 为页面与组件，`dist/` 为构建产物）。

运行时数据位于 `data/jobs.db`（SQLite，可能伴随 `-wal/-shm` 文件）。`backend/dist/` 和 `frontend/dist/` 属于生成目录，不要手动修改。

## 构建、测试与开发命令
- `python -m pip install -r requirements.txt`：安装爬虫依赖。
- `python givemeoc_crawler.py --mode update_and_continue --db-path data/jobs.db`：抓取并更新职位数据。
- `cd backend && npm install && npm run dev`：启动后端开发服务（`http://localhost:3001`）。
- `cd backend && npm run build && npm start`：构建并启动后端生产版本。
- `cd frontend && npm install && npm run dev`：启动前端开发服务（`http://localhost:5173`，`/api` 代理到后端）。
- `cd frontend && npm run build && npm run preview`：构建并预览前端生产版本。

## 代码风格与命名规范
- 前后端 TypeScript 均启用 `strict`，接口与边界数据必须显式标注类型。
- 延续现有格式：2 空格缩进、分号、TS/TSX 使用双引号。
- React 页面/组件文件使用 `PascalCase`，例如 `JobsPage.tsx`。
- 工具函数与中间件文件使用 `camelCase`，例如 `requireRole.ts`。
- 前端导入优先使用 `@/`（映射到 `src`）。
- Python 代码遵循 PEP 8：4 空格缩进、`snake_case` 命名。

## 测试指南
当前仓库未配置自动化测试框架。提交 PR 前至少完成：
- `cd backend && npm run build`
- `cd frontend && npm run build`
- 手动冒烟测试核心流程：注册/登录、职位列表、投递记录 CRUD、管理员用户管理。

如需新增测试，建议与源码同目录放置 `*.test.ts`/`*.test.tsx`，优先覆盖鉴权、角色权限与 SQLite 数据一致性。

## 提交与 Pull Request 规范
现有提交历史使用 Conventional Commits（例如 `feat(crawler): ...`）。建议继续使用：
- `feat(scope): 简述`
- `fix(scope): 简述`
- `chore(scope): 简述`

PR 应包含：
- 变更目的与影响范围（`crawler`、`backend`、`frontend`）。
- 配置或数据库结构变更说明（如新增环境变量、迁移行为）。
- 验证步骤；若有 UI 变更，附截图。
