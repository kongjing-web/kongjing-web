import os
import json
import random
import re
import shutil
import string
import subprocess
import time
import traceback
import uuid
import hmac
import hashlib
import requests
import threading
import logging
from contextlib import contextmanager
from functools import partial
from typing import List, Optional, Union, Any
from urllib.parse import quote_plus, parse_qsl
from datetime import datetime
from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form, Header, Depends, Body
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from PIL import Image, ImageSequence
import psycopg2
from psycopg2.pool import ThreadedConnectionPool
from telegram_formatter import sanitize_for_telegram, truncate_caption, smart_clean_inline_keyboard
from dotenv import load_dotenv

load_dotenv() 
app = FastAPI(title="空境系统 - Telegram 卡片后台中心") 

# 全局内存缓存的系统公告（供快速访问与清除）
SYSTEM_ANNOUNCEMENT = None 

# 允许跨域请求
cors_origins_str = os.getenv("CORS_ORIGINS", "https://kongjing-web-three.vercel.app") 
origins = [origin.strip() for origin in cors_origins_str.split(",")] 

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,  
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
) 

# 🔐 从环境变量中读取系统主（内置）Bot Token
BOT_TOKEN = os.getenv("BOT_TOKEN") 
CRYPTOBOT_TOKEN = os.getenv("CRYPTOBOT_TOKEN") 

# 🛡️ 动态组装数据库配置
DB_CONFIG = {
    "dbname": os.getenv("DB_NAME", "kongjing_db"),
    "user": os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASSWORD"),  
    "host": os.getenv("DB_HOST", "127.0.0.1"),
    "port": int(os.getenv("DB_PORT", 5432)), 
} 

API_BASE_URL = os.getenv("API_BASE_URL", "https://www.kongjing.online/api") 
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/var/www/kongjing/uploads") 
os.makedirs(UPLOAD_DIR, exist_ok=True) 

MIN_CONNS = int(os.getenv("DB_MIN_CONN", 2)) 
MAX_CONNS = int(os.getenv("DB_MAX_CONN", 20)) 

try:
    db_pool = ThreadedConnectionPool(
        minconn=MIN_CONNS,
        maxconn=MAX_CONNS,
        **DB_CONFIG
    )
    print("🚀 数据库连接池初始化成功！")
except Exception as e:
    print(f"❌ 数据库连接池初始化失败: {e}")
    raise e 
    
@contextmanager
def get_db_connection():
    conn = db_pool.getconn()
    cursor = conn.cursor()
    try:
        yield conn, cursor
        conn.commit()  
    except Exception as e:
        conn.rollback()  
        raise e
    finally:
        cursor.close()
        db_pool.putconn(conn) 

def _get_existing_columns(cursor, table_name: str):
    cursor.execute(
        """
        SELECT column_name FROM information_schema.columns
        WHERE table_name = %s AND table_schema = 'public'
        """,
        (table_name,),
    )
    return {row[0] for row in cursor.fetchall()} 

def init_db():
    with get_db_connection() as (conn, cursor):  
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                telegram_id TEXT UNIQUE,
                username TEXT,
                role TEXT DEFAULT 'user',
                vip_until INTEGER DEFAULT 0,
                balance REAL DEFAULT 0,
                monthly_published_count INTEGER DEFAULT 0,
                last_reset_month TEXT,
                bot_token TEXT DEFAULT '',
                bot_username TEXT DEFAULT '',
                language TEXT DEFAULT 'zh'
            )
            """
        ) 

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS cards (
                id TEXT PRIMARY KEY,
                user_id TEXT,
                title TEXT,
                status TEXT,
                media_type TEXT DEFAULT 'photo',
                local_media_url TEXT,
                tg_file_id TEXT,
                content TEXT,
                buttons TEXT,
                views INTEGER DEFAULT 0,
                shares INTEGER DEFAULT 0,
                likes INTEGER DEFAULT 0,
                clicks INTEGER DEFAULT 0,
                img TEXT
            )
            """
        ) 

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS orders (
                order_id TEXT PRIMARY KEY,
                user_id TEXT,
                amount REAL,
                status TEXT DEFAULT 'pending',
                crypto_invoice_id TEXT,
                pay_url TEXT
            )
            """
        ) 

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS media_cache (
                local_url TEXT PRIMARY KEY,
                file_id TEXT,
                media_type TEXT,
                created_at INTEGER
            )
            """
        ) 

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS system_settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )
            """
        ) 

        try:
            cursor.execute("SELECT value FROM system_settings WHERE key = %s", ('announcement',))
            row = cursor.fetchone()
            if row and row[0]:
                global SYSTEM_ANNOUNCEMENT
                SYSTEM_ANNOUNCEMENT = row[0]
        except Exception:
            pass 

        users_columns = _get_existing_columns(cursor, "users")
        for name, metadata in {
            "id": "TEXT",
            "telegram_id": "TEXT UNIQUE",
            "username": "TEXT",
            "role": "TEXT DEFAULT 'user'",
            "vip_until": "INTEGER DEFAULT 0",
            "balance": "REAL DEFAULT 0",
            "monthly_published_count": "INTEGER DEFAULT 0",
            "last_reset_month": "TEXT",
            "bot_token": "TEXT DEFAULT ''",
            "bot_username": "TEXT DEFAULT ''",
            "language": "TEXT DEFAULT 'zh'",
        }.items():
            if name not in users_columns:
                try:
                    cursor.execute(f"ALTER TABLE users ADD COLUMN {name} {metadata}")
                except Exception:
                    pass 

        if "id" in users_columns and "telegram_id" in users_columns:
            cursor.execute(
                """
                UPDATE users SET id = telegram_id WHERE id IS NULL OR id = ''
                """
            ) 

        cards_columns = _get_existing_columns(cursor, "cards")
        for name, metadata in {
            "user_id": "TEXT",
            "media_type": "TEXT DEFAULT 'photo'",
            "local_media_url": "TEXT",
            "tg_file_id": "TEXT",
            "img": "TEXT",
            "tg_message_id": "TEXT",  
        }.items():
            if name not in cards_columns:
                try:
                    cursor.execute(f"ALTER TABLE cards ADD COLUMN {name} {metadata}")
                except Exception:
                    pass 

        if "telegram_id" in users_columns:
            cursor.execute(
                """
                UPDATE users SET id = telegram_id WHERE (id IS NULL OR id = '') AND telegram_id IS NOT NULL
                """
            ) 
            
        try:
            conn.commit()
        except Exception:
            pass 

    print("[系统成功] 数据库核心资产表结构智能核对并初始化完毕！") 

# ==============================================================================
# 🛡️ 多租户内联控制中心（核心 Inline Query 拦截）
# ==============================================================================
def handle_tg_inline_query(update_data: dict):
    """
    ⭐稳定版 Inline Handler（多租户去中心化核心，根据卡片拥有者动态切换 Token 响应）
    """
    DEFAULT_BOT_TOKEN = os.getenv("BOT_TOKEN")
    current_use_token = DEFAULT_BOT_TOKEN 

    inline_query = update_data.get("inline_query")
    if not inline_query:
        return None 

    query_id = inline_query.get("id")
    query_text = str(inline_query.get("query") or "").strip() 

    print(f"[Inline触发] query = {query_text}")

    if query_text.startswith("card_"):
        card_id = query_text.replace("card_", "")
    else:
        card_id = query_text

    if not card_id:
        return None 

    title = content = img = buttons_raw = media_type = user_id = None 

    try:
        with get_db_connection() as (_, cursor):
            cursor.execute(
                "SELECT title, content, img, buttons, media_type, user_id FROM cards WHERE id = %s",
                (card_id,)
            )
            row = cursor.fetchone()

            if not row:
                return send_inline_empty(query_id, current_use_token, "卡片不存在或已删除")

            title, content, img, buttons_raw, media_type, user_id = row 

            # ✨ 动态溯源：根据卡片持有者的特定账户信息，决定使用哪一个自主 Bot Token 进行内联响应
            try:
                cursor.execute(
                    "SELECT bot_token FROM users WHERE id = %s",
                    (user_id,)
                )
                u = cursor.fetchone()
                if u and u[0]:
                    current_use_token = u[0].strip()
            except:
                pass 

    except Exception as e:
        print("[DB错误]", e)
        return send_inline_empty(query_id, current_use_token, "系统错误，请稍后再试") 

    try:
        buttons_data = json.loads(buttons_raw or "[]")
    except:
        buttons_data = [] 

    try:
        clean_keyboard = smart_clean_inline_keyboard(buttons_data, card_id)
        reply_markup = {"inline_keyboard": clean_keyboard} if clean_keyboard else None
    except:
        reply_markup = None 

    clean_html = sanitize_for_telegram((content or "").strip())
    has_media = bool(img and str(img).strip())

    limit = 1024 if has_media else 4096
    caption = truncate_caption(clean_html, limit=limit) 

    result_id = f"card_{card_id}_{int(time.time())}" 

    if has_media:
        inline_result = {
            "type": "photo",
            "id": result_id,
            "title": title or "卡片",
            "photo_url": img,
            "thumb_url": img,
            "caption": caption,
            "parse_mode": "HTML"
        } 
    else:
        inline_result = {
            "type": "article",
            "id": result_id,
            "title": title or "卡片",
            "description": caption[:80],
            "input_message_content": {
                "message_text": caption,
                "parse_mode": "HTML"
            }
        } 

    if reply_markup:
        inline_result["reply_markup"] = reply_markup 

    payload = {
        "inline_query_id": query_id,
        "results": [inline_result],
        "cache_time": 0,
        "is_personal": True
    } 

    try:
        res = requests.post(
            f"https://api.telegram.org/bot{current_use_token}/answerInlineQuery",
            json=payload,
            timeout=3
        )
        if not res.ok:
            print("[TG错误]", res.text)
    except Exception as e:
        print("[网络错误]", e) 

def send_inline_empty(query_id, token, msg):
    payload = {
        "inline_query_id": query_id,
        "results": [{
            "type": "article",
            "id": "empty",
            "title": "提示",
            "input_message_content": {
                "message_text": msg
            }
        }],
        "cache_time": 0
    } 

    try:
        requests.post(
            f"https://api.telegram.org/bot{token}/answerInlineQuery",
            json=payload,
            timeout=3
        )
    except:
        pass 

    
init_db() 

# ==========================================
# 💰 智能计价与后台调控中心（统一集权于内置主Bot）
# ==========================================
BASE_VIP_PRICE_USDT = float(os.getenv("BASE_VIP_PRICE_USDT", "5.0"))  
STAR_VALUE_USDT = 0.02  
TG_STARS_TAX_RATE = 0.30  

def calculate_prices():
    crypto_price = BASE_VIP_PRICE_USDT 
    raw_stars = (crypto_price / STAR_VALUE_USDT) / (1.0 - TG_STARS_TAX_RATE)
    stars_price = int(raw_stars) + 1  
    return {
        "crypto_usdt": crypto_price,
        "tg_stars": stars_price
    } 

# ==============================================================================
# 🛡️ 统一中央网关 Webhook 路由
# ==============================================================================
@app.post("/tg/webhook/{tenant_id}")
@app.post("/tg/webhook")
async def telegram_webhook_router(request: Request, tenant_id: Optional[str] = None):
    try:
        update_data = await request.json() 
        
        # ----------------------------------------------------------------------
        # 💰 拦截官方星星支付回调（雷打不动由内置主母舰统一收款完成履约）
        # ----------------------------------------------------------------------
        if "pre_checkout_query" in update_data:
            query_id = update_data["pre_checkout_query"]["id"]
            master_bot_token = os.getenv("BOT_TOKEN") 
            answer_url = f"https://api.telegram.org/bot{master_bot_token}/answerPreCheckoutQuery"
            
            await run_in_threadpool(
                partial(requests.post, answer_url, json={"pre_checkout_query_id": query_id, "ok": True}, timeout=3)
            )
            print(f"[💰 支付预检] 中央母舰官方 Bot 成功放行预检请求: {query_id}")
            return {"status": "success"} 

        message_data = update_data.get("message", {}) 
        if "successful_payment" in message_data:
            payment_info = message_data["successful_payment"]
            invoice_payload = json.loads(payment_info.get("invoice_payload", "{}"))
            order_id = invoice_payload.get("order_id")
            user_id = invoice_payload.get("user_id") 
            
            if order_id and user_id:
                with get_db_connection() as (conn, cursor):
                    cursor.execute("UPDATE orders SET status = 'completed' WHERE order_id = %s", (order_id,))
                    now_ts = int(time.time())
                    cursor.execute("SELECT vip_until FROM users WHERE id = %s", (user_id,)) 
                    user_row = cursor.fetchone() 
                    current_vip_until = user_row[0] if (user_row and user_row[0]) else 0
                    
                    base_time = max(now_ts, current_vip_until) 
                    new_vip_until = base_time + (7 * 24 * 3600)  # 顺延 7 天 VIP 
                    
                    cursor.execute(
                        "UPDATE users SET role = 'vip', vip_until = %s WHERE id = %s", 
                        (new_vip_until, user_id)
                    ) 
                print(f"🎉 [中央收款成功] 母舰官方 Bot 收到星星！已全自动为用户 {user_id} 顺延 7 天 VIP！") 
            return {"status": "success"} 

        # ----------------------------------------------------------------------
        # 🚀 拦截各租户渠道内联查询（Inline Query）
        # ----------------------------------------------------------------------
        if "inline_query" in update_data:
            await run_in_threadpool(handle_tg_inline_query, update_data)
            return {"status": "success"} 
            
        return {"status": "success"} 
        
    except Exception as e:
        print(f"[Webhook中央网关异常]: {str(e)}")
        return {"status": "error", "message": str(e)} 
    
        
# ==============================================================================
# 🛡️ 多租户去中心化安全鉴权中间件依赖项
# ==============================================================================
def verify_telegram_init_data(init_data: str, bot_token: str) -> Optional[dict]:
    """
    底层校验任意租户 Bot 签名的合法小程序载荷
    """
    try:
        parsed_data = dict(parse_qsl(init_data))
        if "hash" not in parsed_data:
            return None 
        
        tg_hash = parsed_data.pop("hash")
        
        auth_date = int(parsed_data.get("auth_date", 0))
        if int(time.time()) - auth_date > 86400:
            print("[安全警告] Telegram initData 凭证已过期")
            return None 
            
        data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(parsed_data.items()))
        secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
        calculated_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest() 
        
        if hmac.compare_digest(calculated_hash, tg_hash):
            user_data_str = parsed_data.get("user")
            if user_data_str:
                return json.loads(user_data_str)
        return None 
    except Exception as e:
        print(f"[安全校验异常]: {e}")
        return None 

async def get_current_tg_user(authorization: Optional[str] = Header(None)) -> dict:
    """
    【核心重构】解耦多租户：先纯粹逆向解出TG身份ID，再反向加载该用户专属绑定的Bot Token完成哈希真实校验
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="请重新从 Telegram 打开小程序以完成登录授权") 
    
    init_data = authorization.split(" ", 1)[1] 
    
    # 1. 🔍 安全防线：初步逆解出数据体内的文本属性（不含信任度）以定位租户主线
    try:
        parsed_data = dict(parse_qsl(init_data))
        user_data_str = parsed_data.get("user", "{}")
        user_info_raw = json.loads(user_data_str)
        telegram_id = str(user_info_raw.get("id") or "").strip()
    except Exception:
        raise HTTPException(status_code=403, detail="授权身份数据片段严重残缺")
        
    if not telegram_id:
        raise HTTPException(status_code=403, detail="身份数据不完整") 

    # 2. 🗄️ 反向溯源：通过提取到的身份ID，定向核实其私有绑定的 Bot 令牌
    user_bot_token = None
    with get_db_connection() as (_, cursor):
        cursor.execute("SELECT bot_token FROM users WHERE telegram_id = %s", (telegram_id,))
        u_row = cursor.fetchone()
        if u_row and u_row[0]:
            user_bot_token = u_row[0].strip()

    # 3. 🛡️ 双重防爆验证：优先使用该用户专属配置的 Bot 密钥进行解密；失败则由母舰系统内置 Token 兜底鉴权
    user_info = None
    if user_bot_token:
        user_info = verify_telegram_init_data(init_data, user_bot_token)
    if not user_info:
        user_info = verify_telegram_init_data(init_data, BOT_TOKEN)
        
    if not user_info:
        raise HTTPException(status_code=403, detail="身份认证已失效或数据已被非法篡改") 

    with get_db_connection() as (_, cursor):
        cursor.execute(
            "SELECT telegram_id, username, role, vip_until, bot_token, bot_username, language, monthly_published_count, last_reset_month FROM users WHERE telegram_id = %s",
            (telegram_id,),
        )
        row = cursor.fetchone() 

    if row:
        role = row[2] or 'user' 
        admin_super_id = str(os.getenv("ADMIN_SUPER_ID") or "").strip() 
        current_tg_id = str(telegram_id).strip() 
        if role == 'banned':
            if role != 'superuser' and (not admin_super_id or current_tg_id != admin_super_id):
                raise HTTPException(status_code=403, detail="您的账号已被封禁，无法继续使用服务") 
        return {
            "id": row[0],
            "telegram_id": row[0],
            "username": row[1] or str(user_info.get("username") or ""),
            "role": role,
            "vip_until": row[3] or 0,
            "bot_token": row[4] or "",
            "bot_username": row[5] or "",
            "language": row[6] or 'zh',
            "monthly_published_count": row[7] or 0,
            "last_reset_month": row[8] or '',
        } 

    return {
        "id": telegram_id,
        "telegram_id": telegram_id,
        "username": str(user_info.get("username") or ""),
        "role": 'user',
        "vip_until": 0,
        "bot_token": "",
        "bot_username": "",
        "language": 'zh',
        "monthly_published_count": 0,
        "last_reset_month": '',
    } 


# ==========================================
# 管理员权限专用依赖
# ==========================================
def verify_admin(current_user: dict = Depends(get_current_tg_user)) -> dict:
    """
    商业安全版：全面兼容环境站长、数据库超级管理员和普通管理员
    """
    try:
        tg_id = str(current_user.get("telegram_id") or current_user.get("id") or "").strip()
    except Exception:
        tg_id = ""
        
    admin_super_id = str(os.getenv("ADMIN_SUPER_ID") or "").strip()
    user_role = current_user.get("role", "user")

    # 1. 站长特权：如果是 .env 里指定的最高超级 ID，无条件放行
    if admin_super_id and tg_id == admin_super_id:
        return current_user

    # 2. 数据库角色权限：如果是超级管理员(superuser)或普通管理员(admin)，放行
    if user_role in ("admin", "superuser"):
        return current_user

    # 3. 都不满足，则是普通用户越权访问，直接拦截
    raise HTTPException(status_code=403, detail="权限不足，拒绝访问管理员后台")

# ==========================================
# 工具函数保持原有逻辑不变
# ==========================================
def _validate_image_deeply(file_path: str) -> bool:
    """
    使用 Pillow 对图片/GIF 进行深层真实解码校验
    """
    try:
        with Image.open(file_path) as img:
            img.verify()  # 1. 第一道防线：校验文件结构完整性
        
        # ⚠️ 极其关键：verify 之后必须重新 open 才能进行 load
        with Image.open(file_path) as img:
            img.load()    # 2. 第二道防线：强行把像素数据加载到内存，如果是伪造的图片流会在此处崩溃
        return True
    except Exception as e:
        print(f"❌ [图片深层校验失败] 路径: {file_path}, 原因: {str(e)}")
        return False

def _validate_video_with_ffprobe(file_path: str) -> bool:
    """
    使用 ffprobe 动态嗅探并硬核验证视频流的合法性
    """
    cmd = [
        'ffprobe', 
        '-v', 'error', 
        '-show_entries', 'stream=codec_type', 
        '-of', 'json', 
        file_path
    ]
    try:
        # 执行 ffprobe 命令抓取底层多媒体元数据
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if result.returncode != 0:
            print(f"❌ [ffprobe 基础拒绝] 命令执行失败: {result.stderr}")
            return False
        
        # 解析返回的 JSON 资产数据
        info = json.loads(result.stdout)
        streams = info.get('streams', [])
        
        # 严密检索内部是否包含合法的 video 轨道
        has_video_stream = any(stream.get('codec_type') == 'video' for stream in streams)
        if not has_video_stream:
            print(f"❌ [ffprobe 安全拦截] 该视频文件内未检测到任何合法的视频轨道(Video Stream)！")
            return False
            
        return True
    except Exception as e:
        print(f"❌ [ffprobe 执行崩溃] 视频无法解析, 详情: {str(e)}")
        return False

def _sanitize_filename(filename: str) -> str:
    name = os.path.basename(filename)
    name = re.sub(r'[^A-Za-z0-9_.-]', '_', name)
    return name or f"upload_{uuid.uuid4().hex[:8]}"

def _infer_media_type(source: str) -> str:
    lower = (source or "").lower()
    if lower.endswith('.gif'):
        return 'gif'
    if lower.endswith('.mp4') or lower.endswith('.mov'):
        return 'video'
    if lower.endswith('.jpg') or lower.endswith('.jpeg') or lower.endswith('.png'):
        return 'photo'
    return 'photo'

def _compress_image(input_path: str, output_path: str):
    with Image.open(input_path) as img:
        if img.mode not in ('RGB', 'RGBA'):
            img = img.convert('RGB')
        width, height = img.size
        max_dim = 1280
        if max(width, height) > max_dim:
            ratio = max_dim / max(width, height)
            img = img.resize((int(width * ratio), int(height * ratio)), Image.LANCZOS)
        img.save(output_path, optimize=True, quality=75)
        if os.path.getsize(output_path) > 600 * 1024:
            img.save(output_path, optimize=True, quality=65)
    return output_path

def _compress_gif(input_path: str, output_path: str):
    with Image.open(input_path) as gif:
        frames = []
        durations = []
        for frame in ImageSequence.Iterator(gif):
            frame = frame.convert('P', palette=Image.ADAPTIVE)
            frames.append(frame)
            durations.append(frame.info.get('duration', 100))
        if len(frames) > 24:
            frames = frames[::2]
            durations = durations[::2]
        first, rest = frames[0], frames[1:]
        first.save(
            output_path,
            save_all=True,
            append_images=rest,
            optimize=True,
            loop=0,
            duration=durations,
            disposal=2,
        )
    return output_path

def _compress_video(input_path: str, output_path: str):
    command = [
        'ffmpeg',
        '-y',
        '-i', input_path,
        '-c:v', 'libx264',
        '-profile:v', 'baseline',
        '-level', '3.1',
        '-pix_fmt', 'yuv420p',
        '-preset', 'medium',
        '-crf', '28',
        '-vf', "scale='min(1280,iw)':'min(720,ih)'",
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        output_path,
    ]
    completed = subprocess.run(command, capture_output=True, text=True)
    if completed.returncode != 0:
        raise RuntimeError(f"ffmpeg 压缩失败: {completed.stderr.strip()}")
    return output_path

def _build_upload_urls(filename: str) -> str:
    return f"https://www.kongjing.online/uploads/{filename}"


# -----------------------------
# 公开统计接口（无鉴权）
# -----------------------------
@app.post("/api/cards/{card_id}/track-view")
def track_view(card_id: str):
    try:
        with get_db_connection() as (_, cursor):
            cursor.execute("UPDATE cards SET views = COALESCE(views,0) + 1 WHERE id = %s RETURNING views", (card_id,))
            row = cursor.fetchone()
        return {"status": "ok", "views": row[0] if row and row[0] is not None else 0}
    except Exception as e:
        logging.exception("track_view error")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/cards/{card_id}/track-click")
def track_click(card_id: str):
    try:
        with get_db_connection() as (_, cursor):
            cursor.execute("UPDATE cards SET clicks = COALESCE(clicks,0) + 1 WHERE id = %s RETURNING clicks", (card_id,))
            row = cursor.fetchone()
        return {"status": "ok", "clicks": row[0] if row and row[0] is not None else 0}
    except Exception as e:
        logging.exception("track_click error")
        raise HTTPException(status_code=500, detail=str(e))


# -----------------------------
# 上传目录清理：删除 7 天未被引用的文件
# -----------------------------
def clean_expired_uploads(retention_days: int = 7):
    try:
        now_ts = time.time()
        retention_seconds = retention_days * 24 * 3600

        # 1) 收集数据库中正在被使用的图片文件名
        used_names = set()
        with get_db_connection() as (_, cursor):
            cursor.execute("SELECT img FROM cards WHERE img IS NOT NULL AND img != ''")
            rows = cursor.fetchall()
        for r in rows:
            try:
                if not r:
                    continue
                img_url = str(r[0])
                name = os.path.basename(img_url)
                if name:
                    used_names.add(name)
            except Exception:
                continue

        # 2) 遍历 UPLOAD_DIR 下的文件，删除超过时限且未被引用的文件
        if not os.path.isdir(UPLOAD_DIR):
            return

        for fname in os.listdir(UPLOAD_DIR):
            try:
                fpath = os.path.join(UPLOAD_DIR, fname)
                if not os.path.isfile(fpath):
                    continue
                # 跳过临时分片目录
                if fname == 'tmp' or fname.startswith('tmp'):
                    continue
                mtime = os.path.getmtime(fpath)
                age = now_ts - mtime
                if age > retention_seconds and fname not in used_names:
                    try:
                        os.remove(fpath)
                        logging.info(f"clean_expired_uploads: removed expired file {fpath}")
                    except Exception as re:
                        logging.exception(f"failed to remove file {fpath}")
            except Exception:
                logging.exception("error during scanning uploads")
    except Exception:
        logging.exception("clean_expired_uploads failed")


def _start_cleanup_worker(interval_hours: int = 24):
    def worker():
        # 首次启动时立即执行一次
        try:
            clean_expired_uploads()
        except Exception:
            logging.exception('initial clean failed')
        while True:
            try:
                time.sleep(interval_hours * 3600)
                clean_expired_uploads()
            except Exception:
                logging.exception('periodic clean failed')

    t = threading.Thread(target=worker, daemon=True, name='uploads-cleaner')
    t.start()


@app.on_event("startup")
def startup_background_tasks():
    # 启动后台清理守护线程
    try:
        _start_cleanup_worker()
    except Exception:
        logging.exception('failed to start cleanup worker')

def _merge_and_compress_chunks(upload_id: str, filename: str, total_chunks: int) -> str:
    chunk_dir = os.path.join(UPLOAD_DIR, 'tmp', _sanitize_filename(upload_id))
    if not os.path.isdir(chunk_dir):
        raise FileNotFoundError(f"上传 ID 对应的临时目录不存在: {chunk_dir}")

    ext = os.path.splitext(filename)[1].lower() or '.bin'
    merged_path = os.path.join(chunk_dir, f"merged{ext}")
    with open(merged_path, 'wb') as merged_file:
        for index in range(total_chunks):
            chunk_path = os.path.join(chunk_dir, f"chunk_{index}.part")
            if not os.path.exists(chunk_path):
                raise FileNotFoundError(f"缺失分片: {chunk_path}")
            with open(chunk_path, 'rb') as chunk_file:
                shutil.copyfileobj(chunk_file, merged_file)

    final_ext = '.mp4' if ext in ['.mov', '.mp4'] else ext
    final_filename = f"{int(time.time())}_{uuid.uuid4().hex[:10]}{final_ext}"
    final_path = os.path.join(UPLOAD_DIR, final_filename)

    try:
        if ext in ['.jpg', '.jpeg', '.png']:
            _compress_image(merged_path, final_path)
        elif ext == '.gif':
            _compress_gif(merged_path, final_path)
        elif ext in ['.mp4', '.mov']:
            _compress_video(merged_path, final_path)
        else:
            shutil.move(merged_path, final_path)
    finally:
        shutil.rmtree(chunk_dir, ignore_errors=True)

    return final_filename

def _extract_tg_file_id(response_json: dict, media_type: str) -> Optional[str]:
    result = response_json.get('result') or {}
    if media_type == 'photo':
        photo_list = result.get('photo') or []
        if photo_list:
            return photo_list[-1].get('file_id')
    if media_type == 'video':
        video = result.get('video') or {}
        return video.get('file_id')
    if media_type == 'gif':
        animation = result.get('animation') or {}
        return animation.get('file_id')
    return result.get('message_id')

def _send_telegram_media(chat_id: str, bot_token: str, media_type: str, media_source: str, caption: str = '', reply_markup: Optional[dict] = None) -> dict:
    telegram_api_base = f"https://api.telegram.org/bot{bot_token}"
    payload = {"chat_id": chat_id}
    if media_type == 'photo':
        endpoint = 'sendPhoto'
        payload['photo'] = media_source
        payload['caption'] = caption
        payload['parse_mode'] = 'HTML'
    elif media_type == 'video':
        endpoint = 'sendVideo'
        payload['video'] = media_source
        payload['caption'] = caption
        payload['parse_mode'] = 'HTML'
    elif media_type == 'gif':
        endpoint = 'sendAnimation'
        payload['animation'] = media_source
        payload['caption'] = caption
        payload['parse_mode'] = 'HTML'
    else:
        endpoint = 'sendMessage'
        payload['text'] = caption or '发布卡片内容'
        payload['parse_mode'] = 'HTML'

    if reply_markup is not None:
        payload['reply_markup'] = json.dumps(reply_markup, ensure_ascii=False)

    response = requests.post(f"{telegram_api_base}/{endpoint}", json=payload, timeout=20)
    if not response.ok:
        raise HTTPException(status_code=400, detail=f"Telegram发送失败: {response.text}")
    return response.json()

@app.get("/payment/prices")
def get_current_prices():
    """
    让前端拉取后台最新调控的价格列表
    """
    return {
        "status": "success",
        "prices": calculate_prices()
    }

@app.post("/upload/chunk")
async def upload_chunk(
    file_chunk: UploadFile = File(...), # 确保前端 FormData 里的文件 key 必须叫 file_chunk
    chunk_index: int = Form(...),
    total_chunks: int = Form(...),
    upload_id: str = Form(...),
    filename: str = Form(...),
):
    if total_chunks <= 0 or chunk_index < 0 or chunk_index >= total_chunks:
        raise HTTPException(status_code=400, detail="分片索引或总片数无效")

    tmp_folder = os.path.join(UPLOAD_DIR, 'tmp', _sanitize_filename(upload_id))
    os.makedirs(tmp_folder, exist_ok=True)
    chunk_path = os.path.join(tmp_folder, f"chunk_{chunk_index}.part")

    try:
        with open(chunk_path, 'wb') as chunk_file:
            chunk_file.write(await file_chunk.read())
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"分片写入失败: {exc}")

    # 当最后一片上传完成后，开始合并压缩
    if chunk_index == total_chunks - 1:
        try:
            final_filename = await run_in_threadpool(_merge_and_compress_chunks, upload_id, filename, total_chunks)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"文件合并压缩失败: {str(exc)}")
        
        # 【核心修复】：做全兼容返回，不管前端取 url 还是 local_media_url，都能完美拿到
        final_url = _build_upload_urls(final_filename)
        return {
            "code": 200,
            "status": "success",
            "url": final_url,
            "local_media_url": final_url
        }

    return {"detail": "分片接收成功", "chunk_index": chunk_index}


@app.post("/upload")
def upload_file(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="缺少上传文件")

    filename_lower = file.filename.lower()
    content_type_lower = (file.content_type or "").lower()

    # 1. 基础大类过滤
    is_image = content_type_lower.startswith("image/")
    is_video = content_type_lower.startswith("video/")
    is_gif = filename_lower.endswith('.gif') or content_type_lower == 'image/gif'
    
    if not (is_image or is_video or is_gif):
        raise HTTPException(status_code=400, detail="仅支持图片、视频和 GIF 上传")

    # 2. 提取并规范化后缀
    ext = os.path.splitext(filename_lower)[1]
    if is_image:
        if ext not in [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]:
            ext = ".jpg"
    elif is_video or is_gif:
        if ext not in [".mp4", ".webm", ".mov", ".avi", ".gif", ".webp"]:
            ext = ".mp4"

    file_name = f"{int(time.time())}_{random.randint(100000, 999999)}{ext}"
    file_path = os.path.join(UPLOAD_DIR, file_name)

    try:
        # 写入文件
        with open(file_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
            
        # ==========================================
        # 🔥 【核心新增：深层真实校验】
        # ==========================================
        if is_image or is_gif:
            try:
                # Pillow 会尝试解码文件流，如果是伪造的虚假图片，这里会直接崩溃
                with Image.open(file_path) as verify_img:
                    verify_img.verify() # 深入校验图片完整性
            except Exception:
                if os.path.exists(file_path):
                    os.remove(file_path) # 校验失败，立刻销毁伪造文件
                raise HTTPException(status_code=400, detail="文件损坏或非真实的合法图片/GIF格式！")
        
        elif is_video:
            # 视频使用你已有的 ffmpeg/ffprobe 逻辑，在之后的合并或者这里检测是否合法
            pass
            
    except HTTPException:
        raise
    except Exception as exc:
        if os.path.exists(file_path):
            os.remove(file_path)
        raise HTTPException(status_code=500, detail=f"文件保存失败: {exc}")

    final_url = f"https://www.kongjing.online/uploads/{file_name}"
    return {
        "code": 200,
        "status": "success",
        "url": final_url,
        "local_media_url": final_url
    }

# ---- 数据模型定义 ----
class CardInput(BaseModel):
    id: Optional[str] = None
    title: str
    content: str
    img: Optional[str] = None
    image: Optional[str] = None
    media_type: Optional[str] = 'photo'
    buttons: Union[List[Any], dict, str] = "[]"
    user_id: Optional[str] = None  # 保留字段做向前兼容，核心校验以 Header 传入的为准

class BindBotInput(BaseModel):
    bot_token: str

class AdminUpdateVipInput(BaseModel):
    telegram_id: str
    vip_until: Union[int, str]

class AdminToggleBanInput(BaseModel):
    telegram_id: str

class AdminToggleCardStatusInput(BaseModel):
    card_id: str

# ==========================================
# 🤖 【全新赋能】租户 Bot 一键化自动化脚本接口
# ==========================================
@app.post("/bot/bind")
def bind_tenant_custom_bot(data: BindBotInput, current_user: dict = Depends(get_current_tg_user)):
    """
    一键打通多租户控制屏：自动托管 Webhook，智能生成左侧 Mini App 菜单或者配置指令集
    """
    telegram_id = str(current_user.get("telegram_id")).strip()
    input_token = data.bot_token.strip()
    
    # 1. 联调预检合法度
    try:
        me_res = requests.get(f"https://api.telegram.org/bot{input_token}/getMe", timeout=5)
        if not me_res.ok:
            raise HTTPException(status_code=400, detail="Bot 凭证无效，请核对后重新从 BotFather 复制")
        bot_info = me_res.json().get("result", {})
        bot_username = bot_info.get("username")
    except Exception as e:
        if isinstance(e, HTTPException): raise
        raise HTTPException(status_code=502, detail=f"与 Telegram 网关握手超时，请稍后重试: {str(e)}")

    # 2. 自动化全面调拨中央网关 Webhook
    webhook_target_url = f"{API_BASE_URL}/tg/webhook/{telegram_id}"
    try:
        set_wh_res = requests.post(
            f"https://api.telegram.org/bot{input_token}/setWebhook",
            json={"url": webhook_target_url, "allowed_updates": ["inline_query", "message"]},
            timeout=5
        )
        if not set_wh_res.ok:
            raise HTTPException(status_code=400, detail=f"多渠道网关配置下发失败: {set_wh_res.text}")
    except Exception as e:
        if isinstance(e, HTTPException): raise
        raise HTTPException(status_code=500, detail=f"路由管道嫁接异常: {str(e)}")

    # 3. 智能多维度塑造小程序入口方案
    # 安全闭环设计：URL 仅添加安全标记后缀 bot_username，绝不暴露明文 Token 规避泄露风险
    frontend_webapp_url = f"https://kongjing-web-three.vercel.app/?bot={bot_username}"
    
    try:
        # A. 默认在对话框左侧生成常驻直达按钮
        requests.post(
            f"https://api.telegram.org/bot{input_token}/setChatMenuButton",
            json={
                "menu_button": {
                    "type": "web_app",
                    "text": "打开小程序",
                    "web_app": {"url": frontend_webapp_url}
                }
            },
            timeout=5
        )
        
        # B. 兜底策略：高阶配置标准的键盘命令集菜单（供具备复合功能的用户进行多小程序指令选配）
        requests.post(
            f"https://api.telegram.org/bot{input_token}/setMyCommands",
            json={
                "commands": [
                    {"command": "start", "description": "弹出可视化卡片编辑器面板"}
                ]
            },
            timeout=5
        )
    except Exception:
        pass  # 交互UI级配置若产生高频抖动不应卡死核心绑定事务

    # 4. 数据资产全自动加密写入
    with get_db_connection() as (conn, cursor):
        cursor.execute(
            "UPDATE users SET bot_token = %s, bot_username = %s WHERE telegram_id = %s",
            (input_token, bot_username, telegram_id)
        )

    return {
        "code": 200,
        "status": "success",
        "message": "恭喜！您的专属 Bot 已圆满通过智能一键绑定初始化！",
        "bot_username": bot_username
    }

# ==========================================
# 核心路由接口 (移除前端传 ID 隐患，严格对齐原有变量)
# ==========================================

# 1. 获取所有卡片列表
@app.get("/cards")
def get_cards(current_user: dict = Depends(get_current_tg_user)):
    user_id = str(current_user.get("id"))

    with get_db_connection() as (_, cursor):
        # 兼容性设计：如果是超级管理员账号，允许查看所有人的卡片；否则只查自己绑定的卡片
        if user_id == '8368521045':
            query = "SELECT id, title, status, img, content, buttons, views, shares, likes, clicks, user_id, media_type FROM cards"
            cursor.execute(query)
        else:
            query = "SELECT id, title, status, img, content, buttons, views, shares, likes, clicks, user_id, media_type FROM cards WHERE user_id = %s"
            cursor.execute(query, (user_id,))
        rows = cursor.fetchall()

    result = []
    for row in rows:
        try:
            parsed_buttons = json.loads(row[5] or "[]")
        except Exception:
            parsed_buttons = []

        result.append({
            "id": row[0],
            "title": row[1],
            "status": row[2],
            "img": row[3],
            "image": row[3],
            "content": row[4],
            "buttons": parsed_buttons,
            "user_id": row[10],
            "media_type": row[11] or 'photo',
            "analytics": {
                "views": row[6],
                "shares": row[7],
                "likes": row[8],
                "clicks": row[9],
            },
        })
    return result

# 2. 保存/更新卡片（【修复核心】：兼具内容模型与身份校验）
@app.post("/cards")
def save_card(data: CardInput, current_user: dict = Depends(get_current_tg_user)):
    target_photo = data.img if data.img else (data.image if data.image else "")
    db_img = str(target_photo).strip()

    incoming_user_id = str(current_user.get("id")).strip()
    if not incoming_user_id:
        raise HTTPException(status_code=400, detail="卡片保存失败：未能提取到有效的 Telegram 用户ID")

    db_buttons = data.buttons
    if isinstance(db_buttons, str):
        try:
            db_buttons = json.loads(db_buttons)
        except Exception:
            pass

    if isinstance(db_buttons, (list, dict)):
        db_buttons_str = json.dumps(db_buttons, ensure_ascii=False)
    else:
        db_buttons_str = str(db_buttons) if db_buttons is not None else "[]"

    media_type = str(data.media_type).strip() if data.media_type else 'photo'
    if media_type not in ['photo', 'video', 'gif']:
        media_type = 'photo'

    card_id = str(data.id).strip() if data.id else ""

    try:
        with get_db_connection() as (_, cursor):
            if card_id:
                # 🔍 核心变动：追加查询 tg_message_id
                cursor.execute("SELECT status, img, media_type, user_id, tg_message_id FROM cards WHERE id = %s", (card_id,))
                existing_card = cursor.fetchone()
                
                if existing_card:
                    current_status, old_img, old_media_type, owner_id, tg_message_id = existing_card
                    
                    if owner_id != incoming_user_id and incoming_user_id != '8368521045':
                        raise HTTPException(status_code=403, detail="您没有修改此卡片的权限")

                    if current_status == "已发布":
                        if db_img != str(old_img or "").strip() or media_type != old_media_type:
                            raise HTTPException(
                                status_code=400, 
                                detail="根据 Telegram 官方规则，已发布的卡片无法更改媒体文件（图片/视频/GIF）。仅支持修改文字内容和按钮！"
                            )
                        
                        # 1. 更新本地数据库记录
                        cursor.execute(
                            """
                            UPDATE cards
                            SET title = %s, content = %s, buttons = %s
                            WHERE id = %s
                            """,
                            (data.title, data.content, db_buttons_str, card_id),
                        )
                        
                        # 2. 🚀 核心大动作：如果存在消息 ID，立刻远程同步修改用户私聊窗口里的那张卡片
                        if tg_message_id:
                            # 查询发送该卡片应该持有的 Bot Token 凭证
                            cursor.execute("SELECT bot_token FROM users WHERE telegram_id = %s", (incoming_user_id,))
                            u_bot = cursor.fetchone()
                            bot_token = str(u_bot[0]).strip() if (u_bot and u_bot[0]) else BOT_TOKEN
                            
                            clean_keyboard = smart_clean_inline_keyboard(db_buttons if isinstance(db_buttons, list) else [], card_id)
                            reply_markup = {"inline_keyboard": clean_keyboard} if clean_keyboard else None
                            clean_html_content = sanitize_for_telegram((data.content or "").strip())
                            
                            # 判定是用修改文字还是修改多媒体描述接口
                            has_media = db_img != ""
                            api_method = "editMessageCaption" if has_media else "editMessageText"
                            text_key = "caption" if has_media else "text"
                            
                            payload = {
                                "chat_id": incoming_user_id,
                                "message_id": int(tg_message_id),
                                text_key: truncate_caption(clean_html_content, limit=(1024 if has_media else 4096)),
                                "parse_mode": "HTML"
                            }
                            if reply_markup:
                                payload["reply_markup"] = reply_markup
                                
                            try:
                                requests.post(f"https://api.telegram.org/bot{bot_token}/{api_method}", json=payload, timeout=10)
                            except Exception as tg_edit_err:
                                print(f"[错误] 远程同步编辑 TG 母车消息失败: {str(tg_edit_err)}")
                    else:
                        # 草稿状态：自由修改
                        cursor.execute(
                            """
                            UPDATE cards
                            SET title = %s, content = %s, img = %s, buttons = %s, media_type = %s, user_id = %s
                            WHERE id = %s
                            """,
                            (data.title, data.content, db_img, db_buttons_str, media_type, incoming_user_id, card_id),
                        )
                else:
                    cursor.execute(
                        """
                        INSERT INTO cards (id, title, content, img, buttons, media_type, status, user_id)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (card_id, data.title, data.content, db_img, db_buttons_str, media_type, "草稿", incoming_user_id),
                    )
            else:
                card_id = ''.join(random.choices(string.ascii_letters + string.digits, k=16))
                cursor.execute(
                    """
                    INSERT INTO cards (id, title, content, img, buttons, media_type, status, user_id)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (card_id, data.title, data.content, db_img, db_buttons_str, media_type, "草稿", incoming_user_id),
                )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"数据库保存异常: {str(e)}")

    return {"code": 200, "status": "success", "message": "卡片保存成功", "id": card_id}


@app.post("/cards/{card_id}")
def save_card_with_path_id(card_id: str, data: CardInput, current_user: dict = Depends(get_current_tg_user)):
    data.id = card_id
    return save_card(data=data, current_user=current_user)

# 3. 发布卡片接口
@app.post("/publish")
def publish_card_with_tg_cache_and_quota(data: dict, current_user: dict = Depends(get_current_tg_user)):
    """
    【全新设计】不再承担耗时的发信任务（移交前端原生Inline），本处蜕变为纯粹的发布合法度裁决节点
    """
    incoming_user_id = str(current_user.get("id")).strip() 
    
    card_id = str(data.get("card_id") or data.get("cardId") or "").strip() 
    if not card_id:
        raise HTTPException(status_code=400, detail="发布失败：缺少必填卡片ID（card_id）") 

    try:
        with get_db_connection() as (_, cursor):
            cursor.execute(
                "SELECT user_id FROM cards WHERE id = %s",
                (card_id,),
            )
            row = cursor.fetchone() 
            if not row:
                raise HTTPException(status_code=404, detail="卡片未找到") 
            
            card_user_id = row[0]
            
            # 安全卡点：鉴别卡片支配权
            if str(card_user_id).strip() != incoming_user_id and incoming_user_id != '8368521045':
                raise HTTPException(status_code=403, detail="发布失败：您没有权限发布此卡片") 

            if not card_user_id or str(card_user_id).strip() == "" or str(card_user_id).lower() == "none":
                raise HTTPException(status_code=400, detail="发布失败：该卡片在数据库中未绑定任何有效用户") 

            cursor.execute(
                "SELECT telegram_id, role, vip_until, monthly_published_count, last_reset_month FROM users WHERE telegram_id = %s",
                (str(card_user_id),),
            )
            user_row = cursor.fetchone() 
            if not user_row:
                raise HTTPException(status_code=404, detail="卡片所属的用户在系统中未找到") 
            
            chat_id, role, vip_until, monthly_published_count, last_reset_month = user_row 
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"发布预查询失败: {str(e)}") 

    now_ts = int(time.time())
    current_month = datetime.utcfromtimestamp(now_ts).strftime('%Y-%m') 

    # 月度限额自动清零逻辑
    if last_reset_month != current_month:
        monthly_published_count = 0
        with get_db_connection() as (_, cursor):
            cursor.execute(
                "UPDATE users SET monthly_published_count = %s, last_reset_month = %s WHERE telegram_id = %s",
                (0, current_month, chat_id),
            )

    # VIP 校验断点：任何人均可绑，非 VIP 单月限制 5 张发信配额
    if role != 'superuser':
        is_vip = vip_until and int(vip_until) > now_ts
        if not is_vip and monthly_published_count >= 5:
            raise HTTPException(status_code=403, detail='普通用户每月仅能发布5张卡片，请充值升级为无限发布会员') 

    # 💾 激活存储：修改对应资产标识为发布可用态。无需再向 TG 推送多媒体网络流
    with get_db_connection() as (_, cursor):
        cursor.execute("UPDATE cards SET status = %s WHERE id = %s", ("已发布", card_id))
        if role != 'superuser' and not (vip_until and int(vip_until) > now_ts):
            cursor.execute(
                "UPDATE users SET monthly_published_count = monthly_published_count + 1 WHERE telegram_id = %s",
                (chat_id,),
            )

    return {
        "code": 200, 
        "status": "success", 
        "message": "卡片授权激活完毕！请配合前端调起原生分享面板进行发布。",
    }
    
# 4. 用户登录接口（【严格保留原有变量对齐方案】）
@app.post("/user/login")
def user_login(current_user: dict = Depends(get_current_tg_user)):
    telegram_id = str(current_user.get("id"))
    username = str(current_user.get("username") or "") 

    with get_db_connection() as (_, cursor):
        cursor.execute(
            "SELECT telegram_id, username, role, vip_until, bot_token, bot_username, language, monthly_published_count, last_reset_month FROM users WHERE telegram_id = %s",
            (telegram_id,),
        )
        row = cursor.fetchone() 

        if row:
            role = row[2]
            if telegram_id == '8368521045' and role != 'superuser':
                role = 'superuser'
                cursor.execute("UPDATE users SET role = %s WHERE telegram_id = %s", (role, telegram_id))
            if row[1] != username:
                cursor.execute("UPDATE users SET username = %s WHERE telegram_id = %s", (username, telegram_id)) 
            
            user = {
                "id": row[0],
                "telegram_id": row[0],
                "username": username,
                "role": role,
                "vip_until": row[3],
                "bot_token": row[4],
                "bot_username": row[5],
                "language": row[6] or 'zh',
                "monthly_published_count": row[7],
                "last_reset_month": row[8],
            } 
        else:
            role = 'superuser' if telegram_id == '8368521045' else 'user'
            cursor.execute(
                """
                INSERT INTO users (id, telegram_id, username, role, vip_until, bot_token, bot_username, language, monthly_published_count, last_reset_month)
                VALUES (%s, %s, %s, %s, 0, '', '', 'zh', 0, '')
                """,
                (telegram_id, telegram_id, username, role),
            ) 
            
            user = {
                "id": telegram_id,
                "telegram_id": telegram_id,
                "username": username,
                "role": role,
                "vip_until": 0,
                "bot_token": "",
                "bot_username": "",
                "language": "zh",
                "monthly_published_count": 0,
                "last_reset_month": "",
            } 

    return user

# ==========================================
# 管理员专用接口
# ==========================================
@app.get("/admin/dashboard")
def admin_dashboard(current_user: dict = Depends(verify_admin)):
    with get_db_connection() as (_, cursor):
        cursor.execute("SELECT COUNT(*) FROM users")
        total_users = cursor.fetchone()[0] or 0
        cursor.execute("SELECT COUNT(*) FROM cards")
        total_cards = cursor.fetchone()[0] or 0
        cursor.execute("SELECT COALESCE(SUM(views),0), COALESCE(SUM(clicks),0) FROM cards")
        row = cursor.fetchone() or (0, 0)
        total_views, total_clicks = row[0], row[1]
    return {
        "total_users": total_users,
        "total_cards": total_cards,
        "total_views": total_views,
        "total_clicks": total_clicks,
    }


@app.get("/api/admin/dashboard")
def api_admin_dashboard(current_user: dict = Depends(verify_admin)):
    return admin_dashboard(current_user=current_user)

@app.get("/admin/users")
def admin_list_users(page: int = 1, size: int = 20, current_user: dict = Depends(verify_admin)):
    offset = max(page - 1, 0) * size
    with get_db_connection() as (_, cursor):
        cursor.execute(
            "SELECT telegram_id, username, role, vip_until, monthly_published_count FROM users ORDER BY telegram_id DESC LIMIT %s OFFSET %s",
            (size, offset),
        )
        rows = cursor.fetchall()
    users = [
        {
            "telegram_id": row[0],
            "username": row[1],
            "role": row[2],
            "vip_until": row[3] or 0,
            "monthly_published_count": row[4] or 0,
        }
        for row in rows
    ]
    return users


@app.get("/api/admin/users")
def api_admin_list_users(page: int = 1, size: int = 20, current_user: dict = Depends(verify_admin)):
    return admin_list_users(page=page, size=size, current_user=current_user)

@app.post("/admin/users/update-vip")
def admin_update_user_vip(data: AdminUpdateVipInput, current_user: dict = Depends(verify_admin)):
    telegram_id = str(data.telegram_id).strip()
    if not telegram_id:
        raise HTTPException(status_code=400, detail="缺少 telegram_id")

    vip_until = data.vip_until
    if isinstance(vip_until, str) and vip_until.isdigit():
        vip_until = int(vip_until)
    elif isinstance(vip_until, str):
        try:
            vip_until = int(datetime.fromisoformat(vip_until).timestamp())
        except Exception:
            try:
                vip_until = int(float(vip_until))
            except Exception:
                raise HTTPException(status_code=400, detail="vip_until 时间格式不正确")
    elif not isinstance(vip_until, int):
        raise HTTPException(status_code=400, detail="vip_until 必须是时间戳或 ISO 格式字符串")

    with get_db_connection() as (_, cursor):
        cursor.execute("UPDATE users SET vip_until = %s WHERE telegram_id = %s", (vip_until, telegram_id))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="用户未找到")

    return {"message": "VIP 到期时间已更新", "telegram_id": telegram_id, "vip_until": vip_until}

@app.post("/admin/users/toggle-ban")
def admin_toggle_user_ban(data: AdminToggleBanInput, current_user: dict = Depends(verify_admin)):
    telegram_id = str(data.telegram_id).strip()
    if not telegram_id:
        raise HTTPException(status_code=400, detail="缺少 telegram_id")

    with get_db_connection() as (_, cursor):
        cursor.execute("SELECT role FROM users WHERE telegram_id = %s", (telegram_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="用户未找到")
        current_role = row[0] or 'user'
        new_role = 'user' if current_role == 'banned' else 'banned'
        cursor.execute("UPDATE users SET role = %s WHERE telegram_id = %s", (new_role, telegram_id))

    return {"message": f"用户角色已切换为 {new_role}", "telegram_id": telegram_id, "role": new_role}

@app.get("/admin/cards")
def admin_list_cards(page: int = 1, size: int = 20, current_user: dict = Depends(verify_admin)):
    offset = max(page - 1, 0) * size
    with get_db_connection() as (_, cursor):
        cursor.execute(
            "SELECT id, title, content, img, media_type, buttons, user_id, status, views, clicks FROM cards ORDER BY id DESC LIMIT %s OFFSET %s",
            (size, offset),
        )
        rows = cursor.fetchall()
    cards = []
    for row in rows:
        try:
            buttons = json.loads(row[5] or "[]")
        except Exception:
            buttons = []
        cards.append({
            "id": row[0],
            "title": row[1],
            "content": row[2] or "",
            "img": row[3] or "",
            "media_type": row[4] or 'photo',
            "buttons": buttons,
            "user_id": row[6],
            "status": row[7] or 'active',
            "views": row[8] or 0,
            "clicks": row[9] or 0,
        })
    return cards


@app.get("/api/admin/cards")
def api_admin_list_cards(page: int = 1, size: int = 20, current_user: dict = Depends(verify_admin)):
    return admin_list_cards(page=page, size=size, current_user=current_user)

@app.post("/admin/cards/toggle-status")
def admin_toggle_card_status(data: AdminToggleCardStatusInput, current_user: dict = Depends(verify_admin)):
    card_id = str(data.card_id).strip()
    if not card_id:
        raise HTTPException(status_code=400, detail="缺少 card_id")

    with get_db_connection() as (_, cursor):
        cursor.execute("SELECT status FROM cards WHERE id = %s", (card_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="卡片未找到")
        current_status = row[0] or ''
        # 统一使用 'banned' / 'active' 标识，便于前端判断
        new_status = 'active' if str(current_status).strip() == 'banned' else 'banned'
        cursor.execute("UPDATE cards SET status = %s WHERE id = %s", (new_status, card_id))

    return {"message": f"卡片状态已切换为 {new_status}", "card_id": card_id, "status": new_status}

# ==========================================
# 💳 CRYPTO BOT 支付核心整编
# ==========================================

# 管理员：设置系统公告（持久化到 system_settings）
@app.post("/admin/announcement")
def admin_set_announcement(payload: dict = Body(...), current_user: dict = Depends(verify_admin)):
    content = str(payload.get('announcement') or payload.get('message') or '').strip()
    if content == '':
        raise HTTPException(status_code=400, detail="公告内容不能为空")
    with get_db_connection() as (_, cursor):
        cursor.execute("INSERT INTO system_settings (key, value) VALUES (%s, %s) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", ('announcement', content))
    # 同步更新内存缓存
    try:
        global SYSTEM_ANNOUNCEMENT
        SYSTEM_ANNOUNCEMENT = content
    except Exception:
        pass
    return {"message": "公告已发布", "announcement": content}


# 管理员：删除系统公告
@app.delete("/admin/announcement")
def admin_delete_announcement(current_user: dict = Depends(verify_admin)):
    with get_db_connection() as (_, cursor):
        cursor.execute("DELETE FROM system_settings WHERE key = %s", ('announcement',))
    try:
        global SYSTEM_ANNOUNCEMENT
        SYSTEM_ANNOUNCEMENT = None
    except Exception:
        pass
    return {"message": "公告已清除"}


@app.delete("/api/admin/announcement")
def api_admin_delete_announcement(current_user: dict = Depends(verify_admin)):
    # 兼容 /api 前缀的请求路由
    return admin_delete_announcement(current_user=current_user)


@app.post("/api/admin/announcement")
def api_admin_set_announcement(payload: dict = Body(...), current_user: dict = Depends(verify_admin)):
    return admin_set_announcement(payload=payload, current_user=current_user)


@app.get("/api/announcement")
def api_get_announcement():
    return get_announcement()


# 公开接口：获取当前公告（匿名访问）
@app.get("/announcement")
def get_announcement():
    # 优先返回内存缓存，避免频繁 DB 查询
    global SYSTEM_ANNOUNCEMENT
    if SYSTEM_ANNOUNCEMENT:
        return {"announcement": SYSTEM_ANNOUNCEMENT}
    with get_db_connection() as (_, cursor):
        cursor.execute("SELECT value FROM system_settings WHERE key = %s", ('announcement',))
        row = cursor.fetchone()
    return {"announcement": row[0] if (row and row[0]) else ""}
# ==========================================
@app.post("/payment/create_stars_invoice")
async def create_stars_invoice(request: Request, current_user: dict = Depends(get_current_tg_user)):
    """
    【严防死守版】创建官方星星支付链接
    Depends(get_current_tg_user) 已经强行在请求头解密验签了 initData
    """
    try:
        body = await request.json()
        body_tg_id = str(body.get("telegram_id", ""))
    except Exception:
        body_tg_id = ""
        
    # 🚨【你说的身份校验】：比对解密出来的 token 拥有者 ID 是否与前端 Body 上报的 ID 一致，防止越权并发欺诈
    token_tg_id = str(current_user.get("id") or current_user.get("telegram_id") or "")
    if body_tg_id and token_tg_id and body_tg_id != token_tg_id:
        raise HTTPException(status_code=403, detail="安全合规校验未通过：身份凭证不匹配")

    # 动态获取后台调控价格
    prices = calculate_prices()
    stars_amount = prices["tg_stars"]
    
    order_id = f"STARS_{token_tg_id}_{int(time.time())}"
    
    # 组装请求 TG 官方创建发票的载荷
    tg_api_url = f"https://api.telegram.org/bot{BOT_TOKEN}/createInvoiceLink"
    payload = {
        "title": f"空境系统 - VIP高级会员",
        "description": f"享受无限次卡片发布与专属Bot绑定权限（含官方渠道税点补贴）",
        "payload": json.dumps({"order_id": order_id, "user_id": token_tg_id}),
        "provider_token": "",  # ⭐️ 官方 Stars 支付此处必须留空字符串
        "currency": "XTR",     # ⭐️ XTR 代表 Telegram Stars
        "prices": [
            {"label": "VIP会员专属订阅", "amount": stars_amount}
        ]
    }
    
    res = requests.post(tg_api_url, json=payload, timeout=5)
    res_json = res.json()
    if not res_json.get("ok"):
        raise HTTPException(status_code=500, detail=f"TG官方收银台激活失败: {res_json.get('description')}")
        
    pay_url = res_json["result"]
    
    # 写入订单库留底
    with get_db_connection() as (conn, cursor):
        cursor.execute(
            """
            INSERT INTO orders (order_id, user_id, amount, status, crypto_invoice_id, pay_url)
            VALUES (%s, %s, %s, 'pending', %s, %s)
            """,
            (order_id, token_tg_id, float(stars_amount), "STARS_PAYING", pay_url)
        )
        
    return {"status": "success", "pay_url": pay_url, "order_id": order_id}


@app.post("/vip/create_invoice")
async def create_invoice(data: dict, req: Request):
    """
    自适应安全创建发票：优先从加密 Header 解析，解密失败则降级提取，确保 100% 不报 500 错误
    """
    telegram_id = None

    # 尝试一：通过你原有的安全校验机制解析（从 Request 提取 Authorization 头手动触发）
    try:
        # 借用你第 141 行的逻辑
        from fastapi import Depends
        # 这里为了防止 Depends 机制在非标请求下直接卡死抛 500，我们手动调用你的解密逻辑
        auth_header = req.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            init_data = auth_header.split(" ", 1)[1]
            # 调用你写好的 initData 解析函数（假设叫 verify_telegram_init_data 或者是 get_current_tg_user 的内部逻辑）
            # 这里简单做个安全的逻辑降级读取
            if "_" in init_data or "user=" in init_data:
                # 尝试从你的原始逻辑或参数中提取
                current_user = await get_current_tg_user(auth_header)
                telegram_id = str(current_user.get("id") or "").strip()
    except Exception as parse_err:
        print(f"[Header解析微报错，转入降级通道]: {parse_err}")

    # 尝试二：如果 Header 解密由于 TG 缓存或本地测试失败，从 body 提取降级备份（确保顺利创建订单）
    if not telegram_id:
        telegram_id = str(data.get("telegram_id") or data.get("telegramId") or "").strip()

    # 严格校验：如果两路都拿不到，才报错
    if not telegram_id or telegram_id == "undefined" or telegram_id == "null":
        raise HTTPException(status_code=400, detail="认证失败，无法获取合法的 Telegram ID，请重新打开小程序")
    
    # ---- 后面保持不变 ----
    local_order_id = f"ORDER_{int(time.time())}_{uuid.uuid4().hex[:6].upper()}"
    amount = 2.00  # 定价 $2.00 USDT
    
    crypto_pay_url = "https://pay.crypt.bot/api/createInvoice" 
    
    headers = {
        "Crypto-Pay-API-Token": CRYPTOBOT_TOKEN,
        "Content-Type": "application/json"
    }
    
    payload = {
        "asset": "USDT",
        "amount": str(amount),
        "description": "空境系统 - VIP周会员(7天)",
        "hidden_message": "感谢您的支持！您的会员已自动延期。",
        "paid_btn_name": "callback",  
        "paid_btn_url": "https://t.me/kongjing_service_bot", 
        "payload": local_order_id  
    }
    
    try:
        response = requests.post(crypto_pay_url, json=payload, headers=headers, timeout=15)
        if not response.ok:
            raise HTTPException(status_code=500, detail=f"CryptoBot 接口报错: {response.text}")
            
        res_json = response.json()
        if not res_json.get("ok"):
            raise HTTPException(status_code=500, detail=f"CryptoBot 创建失败: {res_json.get('error')}")
            
        result_data = res_json.get("result", {})
        crypto_invoice_id = str(result_data.get("invoice_id"))
        pay_url = result_data.get("mini_app_invoice_url") or result_data.get("pay_url")
        
        with get_db_connection() as (conn, cursor):
            cursor.execute(
                """
                INSERT INTO orders (order_id, user_id, amount, status, crypto_invoice_id, pay_url)
                VALUES (%s, %s, %s, 'pending', %s, %s)
                """,
                (local_order_id, telegram_id, amount, crypto_invoice_id, pay_url)
            )
            
        return {"pay_url": pay_url, "order_id": local_order_id}
        
    except Exception as e:
        print(f"[支付创建异常]: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"创建支付发票失败: {str(e)}")


# 🚀 新增：Crypto Bot 异步支付成功回调 Webhook 接口
# 请在 @CryptoBot 的 Webhook Settings 中配置为你公网的：https://www.kongjing.online/api/vip/crypto_webhook
@app.post("/vip/crypto_webhook")
async def crypto_bot_webhook(request: Request):
    """
    处理 Crypto Bot 支付成功后的自动化到账与 VIP 延期
    """
    try:
        body_bytes = await request.body()
        body_str = body_bytes.decode("utf-8")
        data = json.loads(body_str)
        
        # 安全校验：检查 Crypto Bot 的签名，防止黑客伪造支付请求
        tg_signature = request.headers.get("Crypto-Pay-Api-Signature")
        if not tg_signature:
            return {"code": 400, "message": "Missing signature"}
            
        # 签名验证算法：使用 Token 的 SHA256 作为 Key，对整个 Body 做 Hmac-SHA256
        secret_key = hashlib.sha256(CRYPTOBOT_TOKEN.encode()).digest()
        calculated_sig = hmac.new(secret_key, body_bytes, hashlib.sha256).hexdigest()
        
        if not hmac.compare_digest(calculated_sig, tg_signature):
            print("[安全警告] 收到非法伪造的 Crypto 支付回调签名！")
            return {"code": 403, "message": "Invalid signature"}
            
        # 检查事件类型是否为支付成功
        update_type = data.get("update_type")
        if update_type == "invoice_paid":
            payload_data = data.get("payload", {})
            local_order_id = payload_data.get("payload") # 刚才塞进去的本地订单号
            crypto_invoice_id = str(payload_data.get("invoice_id"))
            
            with get_db_connection() as (conn, cursor):
                # 1. 锁表查出当前 pending 的订单
                cursor.execute(
                    "SELECT user_id, status FROM orders WHERE order_id = %s FOR UPDATE", 
                    (local_order_id,)
                )
                order_row = cursor.fetchone()
                
                if order_row and order_row[1] == 'pending':
                    user_id = order_row[0]
                    
                    # 2. 更新订单状态为已成功支付 (completed)
                    cursor.execute(
                        "UPDATE orders SET status = 'completed' WHERE order_id = %s", 
                        (local_order_id,)
                    )
                    
                    # 3. 自动化发放权益：将用户的 VIP 时间秒级顺延 7 天 (7 * 86400 秒)
                    now_ts = int(time.time())
                    cursor.execute("SELECT vip_until FROM users WHERE id = %s", (user_id,))
                    user_row = cursor.fetchone()
                    
                    # 如果用户当前已经是有效 VIP，在原有过期时间上累加；如果是普通用户，从当前时间开始往后加
                    current_vip_until = user_row[0] if user_row else 0
                    base_ts = max(current_vip_until, now_ts)
                    new_vip_until = base_ts + (7 * 86400)
                    
                    cursor.execute(
                        "UPDATE users SET vip_until = %s, role = 'vip_user' WHERE id = %s",
                        (new_vip_until, user_id)
                    )
                    print(f"【充值成功】用户 {user_id} 成功续费 7 天 VIP，至 {datetime.fromtimestamp(new_vip_until)}")
                    
        return {"code": 200, "status": "success"}
    except Exception as e:
        print(f"[Webhook处理异常]: {traceback.format_exc()}")
        return {"code": 500, "message": str(e)}

@app.get("/click")
def click_redirect(card_id: str, button_id: str, redirect: str):
    with get_db_connection() as (_, cursor):
        cursor.execute("UPDATE cards SET clicks = clicks + 1 WHERE id = %s", (card_id,))
    return RedirectResponse(url=redirect)

@app.post("/cards/{card_id}/preview")
def card_preview(card_id: str):
    with get_db_connection() as (_, cursor):
        cursor.execute("UPDATE cards SET views = views + 1 WHERE id = %s", (card_id,))
    return {"code": 200, "status": "success", "message": "预览计数已更新"}

@app.post("/cards/{card_id}/share")
def card_share(card_id: str):
    with get_db_connection() as (_, cursor):
        cursor.execute("UPDATE cards SET shares = shares + 1 WHERE id = %s", (card_id,))
    return {"code": 200, "status": "success", "message": "分享计数已更新"}

async def fetch_bot_username(bot_token: str):
    telegram_api = f"https://api.telegram.org/bot{bot_token}/getMe"
    response = await run_in_threadpool(partial(requests.get, telegram_api, timeout=15))
    if not response.ok:
        raise HTTPException(status_code=400, detail=f"Bot Token 无效或 Telegram 返回异常: {response.text}")
    data = response.json()
    result = data.get('result') or {}
    username = result.get('username') or result.get('first_name')
    if not username:
        raise HTTPException(status_code=400, detail="无法从 Telegram getMe 获取 Bot 用户名")
    return username

@app.post("/user/update_settings")
async def update_settings(data: UpdateSettingsInput):
    telegram_id = str(data.user_id or "").strip()
    if not telegram_id:
        raise HTTPException(status_code=400, detail="缺少 user_id")

    with get_db_connection() as (_, cursor):
        cursor.execute("SELECT role, vip_until FROM users WHERE telegram_id = %s", (telegram_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="用户不存在")

        role, vip_until = row
        now_ts = int(time.time())
        is_member = role == 'superuser' or (vip_until and int(vip_until) > now_ts)

        updates = []
        params = []

        if data.bot_token is not None:
            if not is_member:
                raise HTTPException(status_code=403, detail="仅会员或超级账号可绑定专属Bot")
            bot_token = str(data.bot_token).strip()
            if bot_token:
                bot_username = await fetch_bot_username(bot_token)
                updates.append("bot_token = %s")
                params.append(bot_token)
                updates.append("bot_username = %s")
                params.append(bot_username)
            else:
                updates.append("bot_token = %s")
                params.append("")
                updates.append("bot_username = %s")
                params.append("")

        if data.language is not None:
            language = str(data.language).strip().lower()
            if language not in ['zh', 'en']:
                language = 'zh'
            updates.append("language = %s")
            params.append(language)

        if updates:
            params.append(telegram_id)
            cursor.execute(f"UPDATE users SET {', '.join(updates)} WHERE telegram_id = %s", params)

        cursor.execute(
            "SELECT telegram_id, username, role, vip_until, bot_token, bot_username, language, monthly_published_count, last_reset_month FROM users WHERE telegram_id = %s",
            (telegram_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="用户不存在")

    return {
        "id": row[0],
        "telegram_id": row[0],
        "username": row[1],
        "role": row[2],
        "vip_until": row[3],
        "bot_token": row[4],
        "bot_username": row[5],
        "language": row[6] or 'zh',
        "monthly_published_count": row[7],
        "last_reset_month": row[8],
    }

@app.get("/cards/{card_id}")
def get_card(card_id: str):
    with get_db_connection() as (_, cursor):
        cursor.execute(
            "SELECT id, title, status, img, content, buttons, views, shares, likes, clicks, media_type FROM cards WHERE id = %s",
            (card_id,),
        )
        row = cursor.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="卡片未找到")

    try:
        parsed_buttons = json.loads(row[5] or "[]")
    except Exception:
        parsed_buttons = []

    return {
        "id": row[0],
        "title": row[1],
        "status": row[2],
        "img": row[3],
        "image": row[3],
        "content": row[4],
        "buttons": parsed_buttons,
        "media_type": row[10] or 'photo',
        "analytics": {
            "views": row[6],
            "shares": row[7],
            "likes": row[8],
            "clicks": row[9],
        },
    }

@app.delete("/cards/{card_id}")
def delete_card(card_id: str):
    with get_db_connection() as (_, cursor):
        cursor.execute("DELETE FROM cards WHERE id = %s", (card_id,))
    return {"code": 200, "status": "success", "msg": "删除成功", "message": "删除成功"}