<div align="center">

# Twilight 暮光

## Next Generation Emby/Jellyfin Manager

[![Python](https://img.shields.io/badge/Python-3.10+-blue?logo=python&logoColor=white)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-3.x-green?logo=flask&logoColor=white)](https://flask.palletsprojects.com/)
[![SQLite](https://img.shields.io/badge/SQLite-3-blue?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

[功能特性](#-功能特性) •
[快速开始](#-快速开始) •
[配置说明](#-配置说明) •
[API 文档](#-api-文档) •
[部署指南](#-部署指南)

</div>

---

## ✨ 功能特性

### 🎬 Emby/Jellyfin 管理
- **用户管理** - 注册、续期、禁用、删除、批量操作
- **媒体库权限** - 灵活的媒体库访问控制
- **会话管理** - 查看、踢出用户会话
- **设备管理** - 设备数量限制、设备移除
- **NSFW 控制** - 可配置的成人内容访问权限

### 💰 积分系统
- **每日签到** - 可配置的签到奖励和连签加成
- **积分转账** - 用户间积分转账，支持手续费
- **红包系统** - 拼手气红包 / 均分红包
- **积分续期** - 使用积分自动/手动续期账号

### 🎯 求片功能
- **多源搜索** - 支持 TMDB + Bangumi 联合搜索
- **库存检查** - 自动检查媒体库是否已有（支持季度检查）
- **请求管理** - 用户请求、管理员审核流程

### 📺 Bangumi 同步
- **自动点格子** - 通过 Webhook 接收播放完成事件，自动标记 Bangumi 观看记录
- **多端支持** - 支持 Emby、Jellyfin、Plex Webhook
- **自定义映射** - 无法匹配的番剧可手动添加映射

### 🔐 安全特性
- **设备限制** - 限制用户最大设备数和同时播放数
- **IP 限制** - IP 黑名单、登录失败锁定
- **登录日志** - 完整的登录记录追踪
- **API 认证** - 支持 API Key 和 Token 双认证

### 📡 扩展集成
- **RESTful API** - 完整的 REST API 支持前端开发
- **Webhook** - 接收和推送 Webhook 事件
- **Telegram Bot** - 可选的 Telegram 机器人交互（需手动开启）

---

## 🚀 快速开始

### 环境要求

- Python 3.10+
- Emby Server / Jellyfin Server
- （可选）TMDB API Key
- （可选）Telegram Bot Token

### 安装步骤

```bash
# 克隆项目
git clone https://github.com/Prejudice-Studio/Twilight.git
cd Twilight

# 创建虚拟环境
python -m venv venv

# 激活虚拟环境
# Windows
venv\Scripts\activate
# Linux/macOS
source venv/bin/activate

# 安装依赖
pip install -r requirements.txt

# 复制配置文件
cp config.production.toml config.toml

# 编辑配置文件
# 修改 config.toml 中的 Emby 地址和 Token

# 启动服务
python main.py
```

### Docker 部署（推荐）

```bash
# 构建镜像
docker build -t twilight .

# 运行容器
docker run -d \
  --name twilight \
  -p 5000:5000 \
  -v ./config.toml:/app/config.toml \
  -v ./db:/app/db \
  twilight
```

---

## ⚙️ 配置说明

配置文件为 `config.toml`，主要配置项：

### 基础配置

```toml
[Global]
logging = true
log_level = 20  # 10=DEBUG, 20=INFO
telegram_mode = false  # 是否启用 Telegram Bot

# TMDB 配置（用于媒体搜索）
tmdb_api_key = "your_tmdb_api_key"
```

### Emby 配置

```toml
[Emby]
emby_url = "http://127.0.0.1:8096/"
emby_token = "your_emby_api_token"
emby_nsfw = ""  # NSFW 媒体库 ID（可选）
```

### 积分配置

```toml
[SAR]
score_name = "暮光币"
register_mode = true
user_limit = 200

# 签到配置
checkin_base_score = 10
checkin_streak_bonus = 2
checkin_max_streak_bonus = 20

# 自动续期
auto_renew_enabled = true
auto_renew_days = 30
auto_renew_cost = 100
```

### 设备限制

```toml
[DeviceLimit]
device_limit_enabled = false
max_devices = 5
max_streams = 2
```

### Bangumi 同步

```toml
[BangumiSync]
enabled = true
auto_add_collection = true
private_collection = true
```

> 📝 完整配置请参考 `config.production.toml`

---

## 📚 API 文档

### API 概览

| 模块 | 前缀 | 说明 |
|------|------|------|
| Auth | `/api/v1/auth` | 认证登录 |
| Users | `/api/v1/users` | 用户管理 |
| Score | `/api/v1/score` | 积分系统 |
| Emby | `/api/v1/emby` | Emby 操作 |
| Admin | `/api/v1/admin` | 管理员接口 |
| Media | `/api/v1/media` | 媒体搜索/求片 |
| Stats | `/api/v1/stats` | 播放统计 |
| Webhook | `/api/v1/webhook` | Webhook 接收/推送 |
| Security | `/api/v1/security` | 安全设置 |
| System | `/api/v1/system` | 系统信息 |

### 认证方式

```bash
# 方式一：API Key
curl -H "X-API-Key: your_api_key" https://your-domain/api/v1/users/me

# 方式二：Bearer Token
curl -H "Authorization: Bearer your_token" https://your-domain/api/v1/users/me
```

### 常用接口示例

<details>
<summary><b>用户注册</b></summary>

```http
POST /api/v1/users/register
Content-Type: application/json

{
    "telegram_id": 123456789,
    "username": "newuser",
    "reg_code": "code-xxxxx"
}
```
</details>

<details>
<summary><b>签到</b></summary>

```http
POST /api/v1/score/checkin
Authorization: Bearer xxx

# Response
{
    "success": true,
    "data": {
        "score": 15,
        "balance": 150,
        "streak": 7
    }
}
```
</details>

<details>
<summary><b>媒体搜索</b></summary>

```http
GET /api/v1/media/search?q=进击的巨人&source=all

# Response
{
    "success": true,
    "data": {
        "results": [
            {
                "id": 1429,
                "title": "进击的巨人",
                "source": "tmdb",
                "media_type": "tv"
            }
        ]
    }
}
```
</details>

<details>
<summary><b>求片（含库存检查）</b></summary>

```http
POST /api/v1/media/request
Content-Type: application/json
Authorization: Bearer xxx

{
    "source": "tmdb",
    "media_id": 1429,
    "media_type": "tv",
    "season": 4
}

# Response（库中缺少该季）
{
    "success": true,
    "message": "✅ 求片请求 第 4 季已提交，请等待管理员处理"
}

# Response（库中已有）
{
    "success": false,
    "message": "📦 库中已有：进击的巨人 第 4 季\n无需再次请求"
}
```
</details>

---

## 🔌 Webhook 配置

### Bangumi 同步 - Emby

1. 进入 Emby 管理面板 → 通知 → 添加 Webhook
2. URL: `https://your-domain/api/v1/webhook/bangumi/emby`
3. 事件：勾选「播放-停止」

### Bangumi 同步 - Jellyfin

1. 安装 Webhook 插件
2. 添加 Generic Destination
3. URL: `https://your-domain/api/v1/webhook/bangumi/jellyfin`
4. 模板：
```json
{"media_type": "{{{ItemType}}}","title": "{{{SeriesName}}}","season": {{{SeasonNumber}}},"episode": {{{EpisodeNumber}}},"user_name": "{{{NotificationUsername}}}"}
```

---

## 🤝 鸣谢

- [Emby](https://emby.media/) / [Jellyfin](https://jellyfin.org/) - 媒体服务器
- [TMDB](https://www.themoviedb.org/) - The Movie Database
- [Bangumi](https://bgm.tv/) - Bangumi番组计划
- [Telegram Bot API](https://core.telegram.org/bots/api) - 机器人 API
- [Telegram-Jellyfin-Bot](https://github.com/Prejudice-Studio/Telegram-Jellyfin-Bot) - 本组的前代管理器
- [Sakura_embyboss](https://github.com/berry8838/Sakura_embyboss) - 功能参考
- [Bangumi-syncer](https://github.com/SanaeMio/Bangumi-syncer) - Bangumi 同步参考

---

## 📄 许可证

本项目基于 [MIT License](LICENSE) 开源。

---

<div align="center">

**如果这个项目对你有帮助，请给一个 ⭐ Star！**

Made with ❤️ by [Prejudice Studio](https://github.com/Prejudice-Studio/)

</div>
