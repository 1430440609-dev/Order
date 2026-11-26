# 多用户酒店订单管理系统

基于 Flask、SQLAlchemy、SQLite、Bootstrap 5 和原生 JavaScript。包含员工与管理员角色、订单归属隔离、搜索筛选、分页和 CSV 导出。

## 本地启动

要求 Python 3.10+。

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

访问 http://127.0.0.1:5000。首次启动自动创建数据库及管理员账号 `admin` / `123456`。公网部署前请设置强随机 `SECRET_KEY` 和 `ADMIN_PASSWORD`。

## 功能

- 管理员可创建和删除员工，查看所有订单；员工仅能查看、编辑、删除和导出自己的订单。
- 订单包含订单号、协议公司、酒店、姓名、下单时间、入住/离店日期、入住晚数/天数、成本、报价、定金、尾款、利润、回款、付款方式、入住状态和备注。
- 日期自动计算入住晚数与天数，成本和报价自动计算利润。
- 列表支持关键字、入住状态筛选及分页，导出 CSV 可用 Excel 打开。

## Render / Railway 部署

将仓库连接到平台，构建命令使用 `pip install -r requirements.txt`，启动命令由 `Procfile` 提供：`gunicorn app:app`。配置环境变量 `SECRET_KEY`、`ADMIN_PASSWORD`，如平台使用 PostgreSQL，可将 `DATABASE_URL` 设置为该数据库连接串。SQLite 适合单实例演示；公网生产建议使用平台持久化 PostgreSQL，避免临时磁盘重启后数据丢失。

PythonAnywhere 可创建 Web App（Flask），配置虚拟环境并安装 `requirements.txt` 依赖，WSGI 配置指向 `app:app` 所在项目。确保数据库路径落在持久化目录中。
