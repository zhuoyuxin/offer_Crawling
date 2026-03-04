# 岗位抓取与投递管理

本项目将岗位数据写入 `SQLite`，并提供后端 API 与前端管理页面。

## 目录结构

- `givemeoc_crawler.py`：Python 爬虫，抓取并写入 SQLite
- `backend`：Express + TypeScript API 服务
- `frontend`：React + Vite 前端
- `data/jobs.db`：SQLite 数据库文件（首次运行自动创建）

## 一、爬虫（写入 SQLite）

安装依赖：

```bash
python -m pip install -r requirements.txt
```

### 抓取模式

`--mode` 仅支持以下两种：

- `stop_on_existing`：若某页检测到 `data_id` 已存在于数据库快照中，先保存该页，再停止继续抓取
- `update_and_continue`：若检测到 `data_id` 已存在，更新数据库并继续抓取下一页（默认）

示例命令：

```bash
python givemeoc_crawler.py --mode stop_on_existing --db-path data/jobs.db
python givemeoc_crawler.py --mode update_and_continue --db-path data/jobs.db
```

说明：

- 旧模式 `full` / `incremental` 已废弃，传入会报参数错误
- 入库冲突键为 `data_id`
- 程序会确保 `jobs(data_id)` 唯一索引存在；若历史数据存在重复 `data_id`，会报错并提示先清理

常用参数：

- `--head-file head.txt`
- `--recruitment-type 春招`
- `--max-pages 50`
- `--sleep-seconds 0.8`
- `--timeout 20`
- `--retries 3`

## 二、后端 API（Express + SQLite）

```bash
cd backend
npm install
npm run dev
```

默认地址：`http://localhost:3001`

核心接口：

- `GET /api/jobs`
- `POST /api/jobs/:postId/apply`
- `GET /api/applications`
- `GET /api/applications/:id`
- `POST /api/applications`
- `PUT /api/applications/:id`
- `DELETE /api/applications/:id`

## 三、前端（React + Vite）

```bash
cd frontend
npm install
npm run dev
```

默认地址：`http://localhost:5173`
