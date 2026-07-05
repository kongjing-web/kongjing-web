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
import math
import hashlib
import requests
import threading
import logging
from contextlib import contextmanager
from functools import partial
from typing import List, Optional, Union, Any
from urllib.parse import quote_plus, parse_qsl
from datetime import datetime
from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form, Header, Depends, Body, BackgroundTasks
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from PIL import Image, ImageSequence
import psycopg2
from psycopg2.pool import ThreadedConnectionPool
from telegram_formatter import sanitize_for_telegram, truncate_caption, smart_clean_inline_keyboard
from dotenv import load_dotenv
from bs4 import BeautifulSoup


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

# 💡 全局母舰机器人用户名缓存（动态自适应感知）
GLOBAL_BOT_USERNAME_CACHE = None

def get_global_bot_username() -> str:
    """同步自适应获取母舰机器人的用户名，并进行全局缓存"""
    global GLOBAL_BOT_USERNAME_CACHE
    if GLOBAL_BOT_USERNAME_CACHE:
        return GLOBAL_BOT_USERNAME_CACHE

    token = os.getenv("BOT_TOKEN")
    if not token:
        print("[严重警告] 环境变量中未检测到 BOT_TOKEN，无法获取母舰用户名！")
        return ""
        
    try:
        # 因为在同步路由中，直接使用普通的 requests 发起一次同步查询
        url = f"https://api.telegram.org/bot{token}/getMe"
        response = requests.get(url, timeout=5)
        res_json = response.json()
        if res_json.get("ok"):
            GLOBAL_BOT_USERNAME_CACHE = str(res_json["result"]["username"]).strip()
            print(f"[系统初始化] 🚀 成功通过 Token 自适应感知母舰机器人用户名: @{GLOBAL_BOT_USERNAME_CACHE}")
            return GLOBAL_BOT_USERNAME_CACHE
    except Exception as e:
        print(f"[错误] 自动拉取母舰机器人用户名失败: {e}")
    
    return ""

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
        (table_name.lower(),),  # 👈 强转小写，防止大小写混用导致查不到
    )
    return {row[0] for row in cursor.fetchall()}

def init_db():
    with get_db_connection() as (conn, cursor):  
        
        # =====================================================================
        # STEP 1. 先用 2.0 标准结构进行防御性建表（如果表完全不存在，直接建完美的）
        # =====================================================================
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                telegram_id TEXT PRIMARY KEY,
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
        """) 

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS cards (
                card_id TEXT PRIMARY KEY,
                user_id TEXT,
                title TEXT,
                status TEXT,
                media_type TEXT DEFAULT 'photo',
                local_media_url TEXT,
                tg_file_id TEXT,
                tg_message_id TEXT,  
                content TEXT,
                buttons TEXT,
                views INTEGER DEFAULT 0,
                shares INTEGER DEFAULT 0,
                likes INTEGER DEFAULT 0,
                clicks INTEGER DEFAULT 0,
                img TEXT,
                bot_username TEXT DEFAULT '',
                created_at INTEGER DEFAULT 0, 
                updated_at INTEGER DEFAULT 0  
            )
        """) 

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS orders (
                order_id TEXT PRIMARY KEY,
                user_id TEXT,
                package_id TEXT,
                duration_days INTEGER DEFAULT 0,
                amount REAL,
                status TEXT DEFAULT 'pending',
                crypto_invoice_id TEXT,
                pay_url TEXT
            )
        """) 

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS media_cache (
                local_url TEXT PRIMARY KEY,
                file_id TEXT,
                media_type TEXT,
                created_at INTEGER
            )
        """) 

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS system_settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        """) 

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS publish_targets (
                target_id TEXT PRIMARY KEY,            
                user_id TEXT,                  
                chat_id TEXT,              
                chat_title TEXT,               
                chat_type TEXT,                
                created_at INTEGER DEFAULT 0,  
                UNIQUE(user_id, chat_id)       
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS custom_emojis (
                emoji_id TEXT PRIMARY KEY,       
                fallback_char TEXT,             
                created_at INTEGER DEFAULT 0     
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS packages (
                package_id TEXT PRIMARY KEY,          
                name TEXT,                     
                duration_days INTEGER,        
                price_usd REAL,               
                price_stars INTEGER       
            )
        """)

        # =====================================================================
        # STEP 2. 🔥【核心硬核：2.0 智能在线热升级与老数据兼容拯救机制】
        # =====================================================================
        
        # 🔄 A. 用户表 (users) 老数据改造
        users_columns = _get_existing_columns(cursor, "users")
        if "id" in users_columns:
            try:
                # 如果还残留旧 id，说明是从 1.0 升级上来的老库，执行物理重构
                print("[热升级] 检测到旧版本 users 表，开始平滑迁移资产...")
                cursor.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_pkey;")
                cursor.execute("ALTER TABLE users DROP COLUMN IF EXISTS id;")
                # 确保把没有主键的 telegram_id 顶上成为新主键
                cursor.execute("ALTER TABLE users ADD PRIMARY KEY (telegram_id);")
            except Exception as e:
                print(f"[热升级警告] users表升级中途拦截: {e}")

        # 动态追加未来 users 表可能新加的字段 (Vibe Coding 狂喜)
        for name, metadata in {
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
            if name not in _get_existing_columns(cursor, "users"):
                try:
                    cursor.execute(f"ALTER TABLE users ADD COLUMN {name} {metadata}")
                except Exception:
                    pass

        # 🔄 B. 卡片表 (cards) 智能改名与扩容
        cards_columns = _get_existing_columns(cursor, "cards")
        if "id" in cards_columns and "card_id" not in cards_columns:
            try:
                print("[热升级] 正在自动将 cards.id 转换为明确的 card_id...")
                cursor.execute("ALTER TABLE cards RENAME COLUMN id TO card_id;")
            except Exception:
                pass

        # 动态追加 cards 表可能新扩展的列
        for name, metadata in {
            "user_id": "TEXT",
            "media_type": "TEXT DEFAULT 'photo'",
            "local_media_url": "TEXT",
            "tg_file_id": "TEXT",
            "tg_message_id": "TEXT",
            "img": "TEXT",
            "bot_username": "TEXT DEFAULT ''",
            "created_at": "INTEGER DEFAULT 0",  
            "updated_at": "INTEGER DEFAULT 0",  
        }.items():
            if name not in _get_existing_columns(cursor, "cards"):
                try:
                    cursor.execute(f"ALTER TABLE cards ADD COLUMN {name} {metadata}")
                    print(f"[热升级成功] 已成功为老 cards 表动态追加字段: {name}")
                except Exception:
                    print(f"[热升级失败] 尝试为 cards 表追加字段 {name} 失败: {e}")
                    pass 

        # 🔄 C. 订单表 (orders) 动态扩容
        orders_columns = _get_existing_columns(cursor, "orders")
        for name, metadata in {
            "package_id": "TEXT",
            "duration_days": "INTEGER DEFAULT 0",
        }.items():
            if name not in orders_columns:
                try:
                    cursor.execute(f"ALTER TABLE orders ADD COLUMN {name} {metadata}")
                except Exception:
                    pass

        # 🔄 D. 直发目标表 (publish_targets) 智能改名
        targets_columns = _get_existing_columns(cursor, "publish_targets")
        if "id" in targets_columns and "target_id" not in targets_columns:
            try:
                print("[热升级] 正在自动将 publish_targets.id 转换为明确的 target_id...")
                cursor.execute("ALTER TABLE publish_targets RENAME COLUMN id TO target_id;")
            except Exception:
                pass

        for name, metadata in {
            "user_id": "TEXT",
            "chat_id": "TEXT",
            "chat_title": "TEXT",
            "chat_type": "TEXT",
            "created_at": "INTEGER DEFAULT 0",
        }.items():
            if name not in _get_existing_columns(cursor, "publish_targets"):
                try:
                    cursor.execute(f"ALTER TABLE publish_targets ADD COLUMN {name} {metadata}")
                except Exception:
                    pass

        # 🔄 E. 套餐表 (packages) 智能改名
        packages_columns = _get_existing_columns(cursor, "packages")
        if "id" in packages_columns and "package_id" not in packages_columns:
            try:
                print("[热升级] 正在自动将 packages.id 转换为明确的 package_id...")
                cursor.execute("ALTER TABLE packages RENAME COLUMN id TO package_id;")
            except Exception:
                pass

        # =====================================================================
        # STEP 3. 基础数据入库与全局配置加载
        # =====================================================================
        
        # 完美兼容 Postgres 的默认套餐初始化
        cursor.execute("""
            INSERT INTO packages (package_id, name, duration_days, price_usd, price_stars) VALUES 
            ('week', 'VIP周会员', 7, 2.99, 150),
            ('month', 'VIP月会员', 30, 9.99, 500),
            ('quarter', 'VIP季会员', 90, 26.99, 1350)
            ON CONFLICT (package_id) DO NOTHING
        """)

        # 载入系统全局公告
        try:
            cursor.execute("SELECT value FROM system_settings WHERE key = %s", ('announcement',))
            row = cursor.fetchone()
            if row and row[0]:
                global SYSTEM_ANNOUNCEMENT
                SYSTEM_ANNOUNCEMENT = row[0]
        except Exception:
            pass 
            
        try:
            conn.commit()
            print("[系统成功] 2.0 智能热升级与架构核对完美闭环！")
        except Exception as e:
            print(f"[提交失败] 事务提交异常: {e}")

# ==============================================================================
# 🛡️ 多租户内联控制中心（核心 Inline Query 拦截）
# ==============================================================================
def handle_tg_inline_query(update_data: dict, tenant_id: Optional[str] = None):
    """
    ⭐完美原生发布 Inline Handler（硬核升级：完美支持 file_id 秒发机制、多媒体精准匹配与动态兜底）
    """
    DEFAULT_BOT_TOKEN = os.getenv("BOT_TOKEN")
    current_use_token = DEFAULT_BOT_TOKEN 

    inline_query = update_data.get("inline_query")
    if not inline_query:
        return None 

    query_id = inline_query.get("id")
    query_text = str(inline_query.get("query") or "").strip() 

    print(f"[Inline触发] 收到内联查询: query='{query_text}', 路由租户ID(tenant_id)={tenant_id}")

    # 1. 👑 【核心对齐】：精确锁定收信 Bot 令牌
    if tenant_id:
        try:
            with get_db_connection() as (_, cursor):
                cursor.execute(
                    "SELECT bot_token FROM users WHERE telegram_id = %s",
                    (str(tenant_id).strip(),)
                )
                u = cursor.fetchone()
                if u and u[0]:
                    current_use_token = u[0].strip()
                    print(f"[Token精准对齐] 成功切换至专属租户 Bot Token 响应")
        except Exception as token_err:
            print(f"[Token对齐异常] 提取租户 {tenant_id} 令牌失败:", token_err)
    else:
        print(f"[Token精准对齐] 锁定系统中央母舰主 BOT_TOKEN 响应")

    # 2. 解析卡片 ID
    if query_text.startswith("card_"):
        card_id = query_text.replace("card_", "")
    else:
        card_id = query_text

    if not card_id:
        return None 

    title = content = img = buttons_raw = media_type = user_id = tg_file_id = None 

    try:
        with get_db_connection() as (_, cursor):
            cursor.execute(
                "SELECT title, content, img, buttons, media_type, user_id, tg_file_id FROM cards WHERE card_id = %s",
                (card_id,)
            )
            row = cursor.fetchone()

            if not row:
                return send_inline_empty(query_id, current_use_token, "卡片不存在或已删除")

            title, content, img, buttons_raw, media_type, user_id, tg_file_id = row 
    except Exception as e:
        print("[DB错误]", e)
        return send_inline_empty(query_id, current_use_token, "系统数据加载失败") 

    # 3. 🖼️ 【路径智能修补】：为兜底方案准备公网绝对路径
    has_media = bool(img and str(img).strip())
    if has_media:
        img_str = str(img).strip()
        if not (img_str.startswith("http://") or img_str.startswith("https://")):
            img_str = img_str.lstrip("/")
            base_url = API_BASE_URL.rstrip("/")
            if img_str.startswith("api/"):
                img_str = img_str[4:]
            img = f"{base_url}/{img_str}"

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
    limit = 1024 if has_media else 4096
    caption = truncate_caption(clean_html, limit=limit) 

    # =========================================================================
    # 🚨 【核心修复层 A】：规避 Telegram 极度严格的布尔属性审查
    # BeautifulSoup 序列化时会把布尔属性写成 expandable=""，这会导致 TG 拒绝解析并引发语法崩溃
    # 我们在此将其强行还原为 Telegram 官方指定的标准格式
    # =========================================================================
    if caption:
        caption = caption.replace('expandable=""', 'expandable').replace("expandable=''", "expandable")

    # =========================================================================
    # 🚨 【核心修复层 B】：一键扒光 HTML 标签，提炼纯净的下拉弹窗专用预览摘要
    # 确保在用户输入 @bot 弹出的下拉菜单里，绝对不泄露任何 <blockquote> 源码
    # =========================================================================
    soup_preview = BeautifulSoup(clean_html, "html.parser")
    pure_preview_text = soup_preview.get_text().strip()
    short_description = pure_preview_text[:60] + "..." if len(pure_preview_text) > 60 else pure_preview_text
    if not short_description:
        short_description = "点击直接发布此卡片内容"

    result_id = f"card_{card_id}_{int(time.time())}" 
    tg_file_id_str = str(tg_file_id or "").strip()

    # 4. 🚀 【核心逻辑重构】：根据是否有 file_id 以及媒体类型进行精准下发
    if has_media:
        if tg_file_id_str:
            # ⚡ 黄金链路：拥有预热好的 file_id，采用 TG 官方 Cached 机制，秒级下发，永不转圈！
            norm_media = str(media_type or 'photo').lower().strip()
            
            if norm_media == "video":
                inline_result = {
                    "type": "video",
                    "id": result_id,
                    "video_file_id": tg_file_id_str, 
                    "title": title or "精美可视化视频卡片",
                    "description": short_description,  # 🌟 修复：注入干净的纯文本预览，彻底终结源码裸奔
                    "caption": caption,
                    "parse_mode": "HTML"
                }
            elif norm_media == "gif":
                inline_result = {
                    "type": "gif",
                    "id": result_id,
                    "gif_file_id": tg_file_id_str,   
                    "title": title or "精美动态卡片",
                    "description": short_description,  # 🌟 修复：注入干净的纯文本预览，彻底终结源码裸奔
                    "caption": caption,
                    "parse_mode": "HTML"
                }
            else:
                inline_result = {
                    "type": "photo",
                    "id": result_id,
                    "photo_file_id": tg_file_id_str, 
                    "title": title or "精美可视化卡片",
                    "description": short_description,  # 🌟 修复：注入干净的纯文本预览，彻底终结源码裸奔
                    "caption": caption,
                    "parse_mode": "HTML"
                }
        else:
            # 🔄 纯净退路：针对历史遗留无 file_id 的卡片，无缝降级回绝对 URL 爬取模式
            print(f"[⚠️ 内联降级兜底] 卡片 {card_id} 缺失 tg_file_id，自动切换回公网 URL 抓取模式...")
            inline_result = {
                "type": "photo",
                "id": result_id,
                "title": title or "精美可视化卡片",
                "description": short_description,      # 🌟 修复：降级模式下也必须注入纯文本预览
                "photo_url": img,
                "thumb_url": img,
                "caption": caption,
                "parse_mode": "HTML"
            } 
    else:
        # 文本卡片保持原本的 article 逻辑
        inline_result = {
            "type": "article",
            "id": result_id,
            "title": title or "精美可视化卡片",
            "description": short_description,          # 🌟 统一使用提取好的无标签干净摘要
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

    # 5. 🚀 【硬核自愈发信层】
    try:
        res = requests.post(
            f"https://api.telegram.org/bot{current_use_token}/answerInlineQuery",
            json=payload,
            timeout=3
        )
        
        if not res.ok and ("parse" in res.text.lower() or "entity" in res.text.lower() or "entities" in res.text.lower()):
            print(f"[⚠️ HTML格式自愈触发] 依旧有未闭合或非法标签，正在启动免解析无痕降级重试...")
            if "parse_mode" in inline_result:
                inline_result["parse_mode"] = None
            if "input_message_content" in inline_result and "parse_mode" in inline_result["input_message_content"]:
                inline_result["input_message_content"]["parse_mode"] = None
            
            payload["results"] = [inline_result]
            res = requests.post(
                f"https://api.telegram.org/bot{current_use_token}/answerInlineQuery",
                json=payload,
                timeout=3
            )
            
        if not res.ok:
            print("[TG内联核心网关报错]:", res.text)
        else:
            print("[Inline响应成功] 内联卡片数据已成功秒级闭合下发！")
    except Exception as e:
        print("[网络通信发信故障]:", e)

    
init_db() 

# 1. 初始化数据库表结构
init_db() 

# 2. ⚓ 【主母舰系统自动化中心】服务器启动时，自动把主 Bot 的 Webhook 牢牢锚定，彻底告别浏览器手动访问！
def auto_align_master_bot_webhook():
    master_token = os.getenv("BOT_TOKEN")
    if not master_token:
        print("⚠️ [系统警告] 未检测到环境变量 BOT_TOKEN，主母舰全自动网关无法初始化！")
        return

    # 对应你代码里定义的无 tenant_id 的中央路由：@app.post("/tg/webhook")
    master_webhook_url = f"{API_BASE_URL.rstrip('/')}/tg/webhook"
    print(f"⚓ [主舰自检] 正在尝试为中央主 Bot 自动注册公网网关: {master_webhook_url} ...")
    
    try:
        res = requests.post(
            f"https://api.telegram.org/bot{master_token}/setWebhook",
            json={
                "url": master_webhook_url, 
                "allowed_updates": ["inline_query", "message", "pre_checkout_query"] # 连同星星支付、内联一并全自动监听
            },
            timeout=5
        )
        if res.ok:
            print(f"🟢 [主舰自愈成功] 中央主 Bot Webhook 已经完美全自动对齐！网关：{master_webhook_url}")
        else:
            print(f"❌ [主舰自愈失败] TG官方拒绝了主网关注册: {res.text}")
    except Exception as e:
        print(f"❌ [主舰自愈异常] 连接 Telegram 官方服务器超时或失败: {e}")

# 顺轨执行主舰自愈（这里开启一个线程或者直接执行，由于是启动时执行一次，直接执行即可）
auto_align_master_bot_webhook()

# ==========================================
# 💰 智能计价与后台调控中心（统一集权于内置主Bot）
# ==========================================
STAR_VALUE_USDT = 0.02  
TG_STARS_TAX_RATE = 0.30  

def auto_calculate_stars(price_usd: float) -> int:
    """根据美金价格自动换算 Telegram 星星数（含官方 30% 税点补贴）"""
    raw_stars = (price_usd / STAR_VALUE_USDT) / (1.0 - TG_STARS_TAX_RATE)
    return int(raw_stars) + 1


# ======================================================================
# 💰 业务拆分 1：拦截官方星星支付预检
# ======================================================================
async def process_pre_checkout(update_data: dict) -> bool:
    if "pre_checkout_query" not in update_data:
        return False
        
    query_id = update_data["pre_checkout_query"]["id"]
    master_bot_token = os.getenv("BOT_TOKEN") 
    answer_url = f"https://api.telegram.org/bot{master_bot_token}/answerPreCheckoutQuery"
    
    await run_in_threadpool(
        partial(requests.post, answer_url, json={"pre_checkout_query_id": query_id, "ok": True}, timeout=3)
    )
    print(f"[💰 支付预检] 中央母舰官方 Bot 成功放行预检请求: {query_id}")
    return True


# ======================================================================
# 💰 业务拆分 2：处理支付成功回调与 VIP 履约
# ======================================================================
async def process_successful_payment(message_data: dict) -> bool:
    if "successful_payment" not in message_data:
        return False
        
    payment_info = message_data["successful_payment"]
    invoice_payload = json.loads(payment_info.get("invoice_payload", "{}"))
    order_id = invoice_payload.get("order_id")
    user_id = invoice_payload.get("user_id") 
    
    if order_id and user_id:
        with get_db_connection() as (_, cursor):
            # 反查动态配置的天数
            cursor.execute("SELECT duration_days FROM orders WHERE order_id = %s", (order_id,))
            order_row = cursor.fetchone()
            duration_days = order_row[0] if (order_row and order_row[0]) else 7
            
            cursor.execute("UPDATE orders SET status = 'completed' WHERE order_id = %s", (order_id,))
            
            # 动态授予会员时间
            grant_vip_equity(cursor, user_id, duration_days)

        print(f"🎉 [中央收款成功] 母舰官方 Bot 收到星星！已全自动为用户 {user_id} 顺延 {duration_days} 天 VIP！") 
    return True


# ======================================================================
# ✨ 业务拆分 3：专属表情/贴纸拦截器（只管入库，不阻断主流程）
# ======================================================================
def process_custom_emojis(message_data: dict):
    if not message_data:
        return

    # 情况 A：用户打字聊天，里面夹带了专属表情
    text = message_data.get("text", "")
    entities = message_data.get("entities", [])
   
    for ent in entities:
        if ent.get("type") == "custom_emoji":
            emoji_id = ent.get("custom_emoji_id")
            offset = ent.get("offset", 0)
            length = ent.get("length", 0)
            
            try:
                fallback_char = text.encode('utf-16-le')[offset*2:(offset+length)*2].decode('utf-16-le')
            except Exception:
                fallback_char = "✨"
       
            if emoji_id:
                _save_emoji_to_db(emoji_id, fallback_char)

    # 情况 B：用户直接发送了一张专属贴纸
    if "sticker" in message_data:
        sticker = message_data["sticker"]
        emoji_id = sticker.get("custom_emoji_id")
        fallback_char = sticker.get("emoji", "🌟")
        
        if emoji_id:
            _save_emoji_to_db(emoji_id, fallback_char)

def _save_emoji_to_db(emoji_id: str, fallback_char: str):
    """表情入库私有辅助函数"""
    with get_db_connection() as (conn, cursor):
        cursor.execute(
            """
            INSERT INTO custom_emojis (emoji_id, fallback_char, created_at)
            VALUES (%s, %s, %s)
            ON CONFLICT (emoji_id) DO NOTHING
            """,
            (str(emoji_id), fallback_char, int(time.time()))
        )


# ======================================================================
# 🏁 彻底净化的中央交通指挥官（主路由）
# ======================================================================
@app.post("/tg/webhook/{tenant_id}")
@app.post("/tg/webhook")
async def telegram_webhook_router(request: Request, background_tasks: BackgroundTasks, tenant_id: Optional[str] = None):
    try:
        update_data = await request.json() 
        
        # 1. 💰 拦截官方星星支付预检
        if await process_pre_checkout(update_data):
            return {"status": "success"} 

        message_data = update_data.get("message", {}) 
        
        # 2. 💰 处理支付成功回调
        if "successful_payment" in message_data:
            await process_successful_payment(message_data)
            return {"status": "success"}

        # 3. 🚀 专属表情拦截器（改用 BackgroundTasks 后台异步处理，完全不阻塞主响应）
        if message_data:
            background_tasks.add_task(process_custom_emojis, message_data)

        # 4. 🧭 内联查询网关
        if "inline_query" in update_data:
            await run_in_threadpool(handle_tg_inline_query, update_data, tenant_id)
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

async def get_current_tg_user(
    authorization: Optional[str] = Header(None),
    x_entrance_bot: Optional[str] = Header(None)  # 👈 核心注入：前端请求头带入当前网址中的 ?bot=bot_username
) -> dict:
    """
    【2.0 中央底座自适应网关】
    不论用户从哪个 Bot 入口进来，统一逆解身份，根据入口管道动态校验真值，
    完美实现“认人不认入口”的全局共享账号体系，并支持新用户任意入口静默注册。
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="请重新从 Telegram 打开小程序以完成登录授权")
    
    init_data = authorization.split(" ", 1)[1] 
    
    # =====================================================================
    # STEP 1. 🔍 初步逆解：提取数据体内的明文属性（此时尚未信任）以定位用户 TG_ID
    # =====================================================================
    try:
        parsed_data = dict(parse_qsl(init_data))
        user_data_str = parsed_data.get("user", "{}")
        user_info_raw = json.loads(user_data_str)
        telegram_id = str(user_info_raw.get("id") or "").strip()
    except Exception:
        raise HTTPException(status_code=403, detail="授权身份数据片段严重残缺")
       
    if not telegram_id:
        raise HTTPException(status_code=403, detail="身份数据不完整")

    # =====================================================================
    # STEP 2. 🗺️ 路由反查：根据前端告知的流量入口，精准调拨对应的加密密钥 (Token)
    # =====================================================================
    target_bot_token = None
    entrance_bot = x_entrance_bot.strip() if x_entrance_bot else ""
    MAIN_BOT_TOKEN = os.getenv("BOT_TOKEN")  # 系统内置母舰 Token
    
    if entrance_bot:
        with get_db_connection() as (_, cursor):
            # 在全网用户资产中，反查是谁绑定了这个 bot_username，从而提取出它的合法 token
            cursor.execute("SELECT bot_token FROM users WHERE bot_username = %s", (entrance_bot,))
            row = cursor.fetchone()
            if row and row[0]:
                target_bot_token = row[0].strip()
    
    # 兜底策略：如果前端没传后缀，或者数据库里查不到这个 Bot（可能是刚解绑或主舰），直接用母舰 Token 校验
    if not target_bot_token:
        target_bot_token = MAIN_BOT_TOKEN
        
    print("\n====== [KONGJING DEBUG START] ======")
    print(f"👉 1. 前端传过来的原始入口参数 (Header): {x_entrance_bot}")
    print(f"👉 2. 经过清洗后的入口参数: {entrance_bot if entrance_bot else '💡 未传(视为主舰流量)'}")
    print(f"👉 3. 最终决定的校验 Token: {target_bot_token[:10] if target_bot_token else '⚠️ 完全没查到 (None)！'}...")
    print("====== [KONGJING DEBUG END] ======\n")
    # =====================================================================
    # STEP 3. 🛡️ 真实性校验：利用定位到的 Token 压榨出 Telegram 官方签名真值
    # =====================================================================
    user_info = verify_telegram_init_data(init_data, target_bot_token)
    
    # 极其强壮的防御性容错：如果用子 Bot 校验失败，且当前不是用的母舰，尝试用母舰再校验一次
    # （防止前端页面在边界切换、缓存抖动时导致的鉴权死锁）
    if not user_info and target_bot_token != MAIN_BOT_TOKEN:
        user_info = verify_telegram_init_data(init_data, MAIN_BOT_TOKEN)
        
    if not user_info:
        raise HTTPException(status_code=403, detail="身份认证已失效或数据已被非法篡改")

    # =====================================================================
    # STEP 4. 🗄️ 资产裁决：判定新老用户，老用户直接加载，新用户静默激活落地
    # =====================================================================
    with get_db_connection() as (conn, cursor):
        cursor.execute(
            "SELECT telegram_id, username, role, vip_until, bot_token, bot_username, language, monthly_published_count, last_reset_month FROM users WHERE telegram_id = %s",
            (telegram_id,),
        )
        row = cursor.fetchone() 

        # 🆕 命中冷数据：纯新用户从任意入口首次闯入
        if not row:
            username = str(user_info.get("username") or "").strip()
            
            # 站长环境变量最高特权卡点拦截
            admin_super_id = str(os.getenv("ADMIN_SUPER_ID") or "").strip()
            role = 'superuser' if admin_super_id and telegram_id == admin_super_id else 'user'
            
            # 自动化执行母舰底座静默注册
            cursor.execute("""
                INSERT INTO users (telegram_id, username, role, vip_until, balance, monthly_published_count, language, bot_token, bot_username)
                VALUES (%s, %s, %s, 0, 0, 0, 'zh', '', '')
            """, (telegram_id, username, role))
            conn.commit()  # 立即提交事务落地
            
            print(f"[中央激活] 🎯 新用户 {username}({telegram_id}) 成功通过入口 Bot [@{entrance_bot or '母舰'}] 激活加入数字底座！")
            
            return {
                "id": telegram_id,
                "telegram_id": telegram_id,
                "username": username,
                "role": role,
                "vip_until": 0,
                "bot_token": "",
                "bot_username": "",
                "language": 'zh',
                "monthly_published_count": 0,
                "last_reset_month": '',
                "current_entrance_bot": entrance_bot  # 动态告知前端本次登录的客观管道
            }

    # 🧓 命中热数据：老用户平滑归巢（不管他从哪个入口进来，数据全是全局唯一的这一套）
    role = row[2] or 'user'
    vip_until = row[3] or 0
    
    # 站长最高特权覆盖
    admin_super_id = str(os.getenv("ADMIN_SUPER_ID") or "").strip()
    if admin_super_id and str(telegram_id).strip() == admin_super_id:
        role = 'superuser'
        
    # 权限调拨裁决（如是否封禁）
    perm = get_user_permission({"role": role, "vip_until": vip_until})
    if perm["is_banned"]:
        raise HTTPException(status_code=403, detail="您的账号已被封禁，无法继续使用服务")
      
    return {
        "id": row[0],
        "telegram_id": row[0],
        "username": row[1] or str(user_info.get("username") or ""),
        "role": role,
        "vip_until": vip_until,
        "bot_token": row[4] or "",
        "bot_username": row[5] or "",
        "language": row[6] or 'zh',
        "monthly_published_count": row[7] or 0,
        "last_reset_month": row[8] or '',
        "current_entrance_bot": entrance_bot  # 完美透传客观入口网关
    }

@app.get("/user/gate_check")
async def check_user_bot_gate_status(current_user: dict = Depends(get_current_tg_user)):
    """
    【纯净中央数字底座听诊网关】
    后端绝不包含任何硬编码的文案或业务级卡死阻断逻辑。
    只输出 4 个精确反映客观技术指标的黄金数据，判决与展示全权下放到前端状态机。
    """
    bot_token = current_user.get("bot_token", "").strip()
    bot_username = current_user.get("bot_username", "").strip()
    entrance_bot = current_user.get("current_entrance_bot", "").strip()
    
    # 指标 1：用户本身是否绑定了任何专属 Bot
    is_bound = bool(bot_token and bot_username)
    
    # 指标 2：该绑定的 Bot 是否已经开通了 Telegram 官方的 Inline (内联) 分享模式
    is_inline_enabled = False
    if is_bound:
        try:
            # 🔍 实时连线 TG 官方总线嗅探 getMe 指标
            res = requests.get(f"https://api.telegram.org/bot{bot_token}/getMe", timeout=3)
            if res.ok:
                bot_info = res.json().get("result", {})
                # supports_inline_queries 为 TG 官方返回的是否在 BotFather 开启了内联的硬真值标记
                is_inline_enabled = bool(bot_info.get("supports_inline_queries", False))
        except Exception as e:
            print(f"[中央网关提示] 预检自定义 Bot 官方内联状态产生网络抖动: {e}")
            is_inline_enabled = False # 超时或网络异常时优雅降级，不卡死用户体验
            
    return {
        "code": 200,
        "status": "success",
        "data": {
            "is_bound": is_bound,                  # 📊 1. 用户是否已绑定专属 Bot (True/False)
            "bound_bot_username": bot_username,    # 📊 2. 用户绑定的专属 Bot 名字 (无则为空字符串)
            "is_inline_enabled": is_inline_enabled, # 📊 3. 专属 Bot 是否已在官方开通内联 (True/False)
            "current_entrance_bot": entrance_bot   # 📊 4. 用户当前实际打开小程序的入口 Bot 名字 (自适应补全)
        }
    }   

def get_user_permission(user: dict) -> dict:
    """
    全站统一权限裁决大脑
    根据用户角色(role)和VIP到期时间(vip_until)，返回是否封禁、是否VIP、是否管理员
    """
    try:
        current_role = user.get("role", "user")
        vip_until = int(user.get("vip_until") or 0)
        current_ts = int(time.time())
        
        # 1. 判定是否被封禁
        is_banned = (current_role == "banned")
        
        # 2. 判定是否为管理员/超级管理员
        is_admin = (current_role in ["superuser", "admin"])
        
        # 3. 综合判定 VIP 权益
        if is_banned:
            # 如果被拉黑，剥夺所有权限
            is_vip = False
            is_admin = False
        elif is_admin:
            # 超级管理员和管理员无条件享受 VIP 权益
            is_vip = True
        else:
            # 普通用户严格对比当前时间戳
            is_vip = vip_until > current_ts
            
        return {
            "is_banned": is_banned,
            "is_vip": is_vip,
            "is_admin": is_admin
        }
    except Exception:
        # 发生异常时安全兜底，不给任何特权
        return {
            "is_banned": False,
            "is_vip": False,
            "is_admin": False
        }

def get_current_ts() -> int:
    return int(time.time())

def is_vip(user: dict) -> bool:
    """
    全站唯一核心权鉴门禁
    整合：1. 黑名单一刀切 2. 超管/白嫖号无条件放行 3. 普通用户看VIP到期时间
    """
    try:
        current_role = user.get("role", "user")
        
        # 🛡️ 第一优先拦截：如果是拉黑用户，任凭你 vip_until 有多少天，一律剥夺所有特权
        if current_role == "banned":
            return False
            
        # 👑 第二优先放行：如果是超级管理员或白嫖测试号，不需要看时间，直接享受最高特权
        if current_role in ["superuser", "admin"]:
            return True
            
        # ⏱️ 第三常规判断：普通用户（user、vip等），严格走“时间是唯一真理”的校验
        vip_until = int(user.get("vip_until") or 0)
        return vip_until > get_current_ts()
        
    except Exception:
        return False  


def grant_vip_equity(cursor, telegram_id: str, days: int):
    """
    【核心解耦枢纽】统一的权益发放函数
    不管什么渠道充值成功，最后都只调用这个函数来加时间
    """
    # 1. 查出用户当前的时间（👇 必须改为 telegram_id = %s）
    cursor.execute("SELECT vip_until FROM users WHERE telegram_id = %s", (telegram_id,))
    row = cursor.fetchone()
    current_vip_until = row[0] if row else 0
    
    # 2. 顺延时间
    base_time = max(get_current_ts(), current_vip_until)
    new_vip_until = base_time + (days * 24 * 3600)
    
    # 3. 写入数据库，保持 role 不受干扰（👇 必须改为 telegram_id = %s）
    cursor.execute(
        "UPDATE users SET vip_until = %s WHERE telegram_id = %s",
        (new_vip_until, telegram_id)
    )

def vip_remaining_days(user: dict) -> int:
    """计算剩余VIP天数，完美适配特殊身份"""
    try:
        current_role = user.get("role", "user")
        
        if current_role == "banned":
            return 0  # 被封禁的人直接显示 0 天
            
        if current_role in ["superuser", "admin"]:
            return 9999  # 超管显示永久无限期（前端可展示为“永久特权”）
            
        # 普通人算时间差
        vip_until = int(user.get("vip_until") or 0)
        diff = vip_until - get_current_ts()
        return max(0, math.ceil(diff / 86400))
    except Exception:
        return 0


# ==========================================
# 管理员权限专用依赖
# ==========================================
def verify_admin(current_user: dict = Depends(get_current_tg_user)) -> dict:
    """商业安全版：全面兼容环境站长、数据库超级管理员和普通管理员"""
    perm = get_user_permission(current_user)
    
    if perm["is_banned"]:
        raise HTTPException(status_code=403, detail="账号已被封禁，拒绝访问")
        
    if not perm["is_admin"]:
        raise HTTPException(status_code=403, detail="权限不足，拒绝访问管理员后台")
        
    return current_user

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

def warm_telegram_media_cache(bot_token: str, chat_id: str, media_url: str, media_type: str) -> Optional[str]:
    """
    让 Bot 主动向用户私聊投递媒体文件，拦截并提取 Telegram 官方的 file_id 缓存凭证，随后无感销毁
    """
    if not bot_token or not media_url:
        return None
    try:
        # 兼容性自愈：确保是绝对网络路径
        if not (media_url.startswith("http://") or media_url.startswith("https://")):
            base_url = os.getenv("API_BASE_URL", "https://www.kongjing.online").rstrip("/")
            media_url = f"{base_url}/{media_url.lstrip('/')}"

        # 针对图片、视频、GIF，调用不同的官方专属畅行通道
        # 💡 核心优化：追加 "disable_notification": True，让用户手机完全不震动、不发出声音
        if media_type == 'video':
            api_url = f"https://api.telegram.org/bot{bot_token}/sendVideo"
            payload = {
                "chat_id": chat_id, 
                "video": media_url, 
                "caption": "⚡ [空境流媒体] 正在为您全自动构建高质视频分布式缓存...",
                "disable_notification": True
            }
        elif media_type == 'gif':
            api_url = f"https://api.telegram.org/bot{bot_token}/sendAnimation"
            payload = {
                "chat_id": chat_id, 
                "animation": media_url, 
                "caption": "⚡ [空境流媒体] 正在为您全自动构建动态GIF多路缓存...",
                "disable_notification": True
            }
        else:
            api_url = f"https://api.telegram.org/bot{bot_token}/sendPhoto"
            payload = {
                "chat_id": chat_id, 
                "photo": media_url, 
                "caption": "⚡ [空境流媒体] 您的专属秒刷级图片缓存已成功部署！",
                "disable_notification": True
            }

        res = requests.post(api_url, json=payload, timeout=12) # 适当放宽超时，因为TG下载大视频需要时间
        if res.ok:
            res_data = res.json()
            result = res_data.get("result", {})
            
            # 1. 精准剥离不同媒体类型的专属 file_id
            file_id = None
            if media_type == 'video':
                file_id = result.get("video", {}).get("file_id")
            elif media_type == 'gif':
                file_id = result.get("animation", {}).get("file_id")
            else:
                photos = result.get("photo", [])
                file_id = photos[-1].get("file_id") if photos else None # 取最高画质的原图

            # 2. 🚀【过河拆桥：核心无感化逻辑】
            # 既然 file_id 已经安全拿到，立刻远程抹除刚刚发送的测试消息，不留痕迹
            message_id = result.get("message_id")
            if message_id:
                try:
                    delete_url = f"https://api.telegram.org/bot{bot_token}/deleteMessage"
                    requests.post(delete_url, json={"chat_id": chat_id, "message_id": message_id}, timeout=3)
                except Exception as del_err:
                    print(f"⚠️ [缓存预热] 擦除残留消息偶发失败: {del_err}")

            if file_id:
                print(f"🔥 [缓存捕获成功] 成功拦截到专属媒体({media_type})的官方加密 file_id: {file_id}")
                return file_id
                
    except Exception as e:
        print(f"⚠️ [缓存预热降级] 捕获 file_id 偶发性失败（不影响基础存储事务）: {e}")
    return None


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
            # 🔥 【核心防伪加入】：在 merged_path（刚合并完的源文件）上重拳出击
            # 如果校验失败，直接抛出异常，利用外层的 except 阻断并清理临时目录
            if not _validate_video_with_ffprobe(merged_path):
                raise ValueError("视频真伪校验失败：文件损坏或未检测到合法的视频轨道！")
                
            # 只有通过了 ffprobe 铁面无私的检查，才配消耗服务器珍贵的 CPU 去压缩
            _compress_video(merged_path, final_path)
        else:
            shutil.move(merged_path, final_path)
    except Exception as exc:
        # 确保万一出错时，能把可能已经生成的 final_path 清理掉
        if os.path.exists(final_path):
            os.remove(final_path)
        raise exc  # 继续向上抛出，让外层的 FastAPI 捕获并返回 500
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

def calculate_prices():
    """
    统一的定价计算逻辑，支持多套餐返回
    """
    # 你可以在这里调整价格，或者从数据库/配置文件中读取
    return {
        "packages": [
            {
                "package_id": "week", 
                "name": "VIP Weekly", 
                "price_usd": 2.0, 
                "price_stars": 143, 
                "duration_days": 7
            },
            {
                "package_id": "month", 
                "name": "VIP Monthly", 
                "price_usd": 7.0, 
                "price_stars": 500, 
                "duration_days": 30
            },
            {
                "package_id": "quarter", 
                "name": "VIP Quarterly", 
                "price_usd": 18.0, 
                "price_stars": 1200, 
                "duration_days": 90
            }
        ]
    }

@app.get("/payment/prices")
def get_current_prices():
    """
    【动态多套餐版】让前端拉取数据库最新的套餐价格列表
    直接对接 packages 表，后台改数据库，前端秒生效！
    """
    try:
        # 1. 实时从数据库中捞出周、月、季度的配置
        with get_db_connection() as (_, cursor):
            cursor.execute(
                """
                SELECT package_id, name, price_usd, price_stars, duration_days 
                FROM packages 
                ORDER BY duration_days ASC
                """
            )
            rows = cursor.fetchall()
            
        packages_list = []
        for row in rows:
            pkg_id, name, price_usd, db_price_stars, duration_days = row
            
            # 2. 🧭 计价裁决：如果数据库填了特定星星数就用数据库的，没填就自动动态换算
            if db_price_stars and db_price_stars > 0:
                stars_amount = db_price_stars
            else:
                stars_amount = auto_calculate_stars(float(price_usd))
                
            packages_list.append({
                "package_id": pkg_id,
                "name": name,
                "price_usd": float(price_usd),
                "price_stars": int(stars_amount),
                "duration_days": duration_days
            })
            
        # 3. 完美返回给前端
        return {
            "status": "success",
            "packages": packages_list  # 🔥 新前端推荐循环遍历这个数组来展示多套餐
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"拉取后台最新调控价格失败: {str(e)}")

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

    # 1. 🛡️ 基础大类过滤（彻底移除 is_video 校验，把视频彻底关在门外）
    is_image = content_type_lower.startswith("image/")
    is_gif = filename_lower.endswith('.gif') or content_type_lower == 'image/gif'
    
    if not (is_image or is_gif):
        raise HTTPException(status_code=400, detail="仅支持图片和 GIF 上传（视频请走分片上传接口）")

    # 2. ⚙️ 提取并规范化后缀
    ext = os.path.splitext(filename_lower)[1]
    if ext not in [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]:
        # 如果是符合 GIF 大类但后缀奇葩，强制归一化为 .gif，其余图片默认 .jpg
        ext = ".gif" if is_gif else ".jpg"

    file_name = f"{int(time.time())}_{random.randint(100000, 999999)}{ext}"
    file_path = os.path.join(UPLOAD_DIR, file_name)

    try:
        # 写入文件
        with open(file_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
            
        # ==========================================
        # 🔥 【核心深层真实校验】
        # ==========================================
        try:
            # Pillow 会尝试解码文件流，如果是黑客伪造的虚假图片/GIF，这里会直接崩溃
            with Image.open(file_path) as verify_img:
                verify_img.verify() # 深入校验图片完整性
        except Exception:
            if os.path.exists(file_path):
                os.remove(file_path) # 校验失败，立刻销毁伪造文件
            raise HTTPException(status_code=400, detail="文件损坏或非真实的合法图片/GIF格式！")
            
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

class UpdateSettingsInput(BaseModel):
    """
    用户通用设置及多语言偏好同步请求体
    """
    user_id: Union[str, int]             # 兼容支持字符串或纯数字的 Telegram ID
    language: Optional[str] = None       # 语言选项，如 'zh' 或 'en'
    bot_token: Optional[str] = None      # 专属 Bot 凭证（解绑时前端会传空字符串 "" 清空）

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


@app.post("/cards")
def save_card(data: CardInput, current_user: dict = Depends(get_current_tg_user)):
    target_photo = data.img if data.img else (data.image if data.image else "")
    db_img = str(target_photo).strip()

    incoming_user_id = str(current_user.get("id")).strip()
    if not incoming_user_id:
        raise HTTPException(status_code=400, detail="卡片保存失败：未能提取到有效的 Telegram 用户ID")

    # ----------------------------------------------------------------------
    # 🚀 【第一道纵深防御】全局文本长度与恶意灌水强力清洗
    # ----------------------------------------------------------------------
    title_str = str(data.title or "").strip()
    content_str = str(data.content or "").strip()

    if len(title_str) > 100:
        raise HTTPException(status_code=400, detail="卡片保存失败：标题过长，不能超过 100 个字符")

    # 限制富文本原始 HTML 编码长度，防止恶意超长网页标签轰炸数据库
    if len(content_str) > 12000:
        raise HTTPException(status_code=400, detail="卡片保存失败：富文本排版源码过长，请精简格式")

    # 提取实际的纯文本长度进行审计（Telegram 官方计数基于最终呈现的纯文本）
    from bs4 import BeautifulSoup
    pure_text = BeautifulSoup(content_str, "html.parser").get_text()
    if len(pure_text) > 4096:
        raise HTTPException(status_code=400, detail="卡片保存失败：实际文本内容超过了 Telegram 允许的最大 4096 字符限制")
    # ----------------------------------------------------------------------

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
        
    current_timestamp = int(time.time()) 
    card_id = str(data.id).strip() if data.id else ""

    try:
        # 🛡️ 【缩进已彻底修复：标准 4 空格对齐】
        with get_db_connection() as (_, cursor):
            cursor.execute("SELECT bot_token, bot_username FROM users WHERE telegram_id = %s", (incoming_user_id,))
            u_bot = cursor.fetchone()
            
            # 💡 【完美闭环逻辑】：优先检测用户是否绑定了专属 Bot 资产
            if u_bot and str(u_bot[0]).strip():
                # 如果用户表里有专属 Token，直接用他自己绑定好的
                active_bot_token = str(u_bot[0]).strip()
                active_bot_username = str(u_bot[1]).strip()
            else:
                # 如果没有绑定，完美降级回系统母舰，并动态触发自适应感知机制
                active_bot_token = os.getenv("BOT_TOKEN") or ""
                active_bot_username = get_global_bot_username() # 🔥 调用自适应探针，防守拉满

            if card_id:
                cursor.execute("SELECT status, img, media_type, user_id, tg_message_id, tg_file_id FROM cards WHERE card_id = %s", (card_id,))
                existing_card = cursor.fetchone()
                
                if existing_card:
                    current_status, old_img, old_media_type, owner_id, tg_message_id, old_tg_file_id = existing_card

                    admin_super_id = str(os.getenv("ADMIN_SUPER_ID") or "").strip()
                    if owner_id != incoming_user_id and incoming_user_id != admin_super_id:
                        raise HTTPException(status_code=403, detail="您没有修改此卡片的权限")

                    if current_status == "已发布":
                        if db_img != str(old_img or "").strip() or media_type != old_media_type:
                            raise HTTPException(
                                status_code=400, 
                                detail="根据 Telegram 官方规则，已发布的卡片无法更改媒体文件（图片/视频/GIF）。仅支持修改文字内容和按钮！"
                            )
                        
                        # ----------------------------------------------------------------------
                        # 🚀 【第二道纵深防御】对活体卡片进行 Telegram 官规硬锁
                        # ----------------------------------------------------------------------
                        has_media = db_img != ""
                        tg_limit = 1024 if has_media else 4096
                        if len(pure_text) > tg_limit:
                            media_desc = "带有媒体（图片/视频/GIF）的卡片" if has_media else "纯文本卡片"
                            raise HTTPException(
                                status_code=400, 
                                detail=f"保存失败：当前卡片为【{media_desc}】且处于【已发布】状态，实际更新文本（当前 {len(pure_text)} 字）不能超过官方规定的 {tg_limit} 个字符限制！"
                            )
                        # ----------------------------------------------------------------------

                        final_tg_file_id = old_tg_file_id
                        
                        # 更新已发布的卡片，同步刷新其最新的 bot_username
                        cursor.execute(
                            """
                            UPDATE cards
                            SET title = %s, content = %s, buttons = %s, bot_username = %s, updated_at = %s
                            WHERE card_id = %s
                            """,
                            (data.title, data.content, db_buttons_str, active_bot_username, current_timestamp, card_id),
                        )
                        
                        if tg_message_id:
                            clean_keyboard = smart_clean_inline_keyboard(db_buttons if isinstance(db_buttons, list) else [], card_id)
                            reply_markup = {"inline_keyboard": clean_keyboard} if clean_keyboard else None
                            clean_html_content = sanitize_for_telegram((data.content or "").strip())

                            has_media = db_img != ""
                            api_method = "editMessageCaption" if has_media else "editMessageText"
                            text_key = "caption" if has_media else "text"
                            
                            payload = {
                                "chat_id": incoming_user_id,
                                "message_id": int(tg_message_id),
                                text_key: truncate_caption(clean_html_content, limit=tg_limit),
                                "parse_mode": "HTML"
                            }
                            if reply_markup:
                                payload["reply_markup"] = reply_markup
                                
                            try:
                                requests.post(f"https://api.telegram.org/bot{active_bot_token}/{api_method}", json=payload, timeout=10)
                            except Exception as tg_edit_err:
                                print(f"[错误] 远程同步编辑 TG 母车消息失败: {str(tg_edit_err)}")
                    else:
                        if db_img and (db_img != str(old_img or "").strip() or media_type != old_media_type or not old_tg_file_id):
                            final_tg_file_id = warm_telegram_media_cache(active_bot_token, incoming_user_id, db_img, media_type) or old_tg_file_id
                        else:
                            final_tg_file_id = old_tg_file_id

                        # 更新草稿状态的卡片，同步刷新其最新 bot_username
                        cursor.execute(
                            """
                            UPDATE cards
                            SET title = %s, content = %s, img = %s, buttons = %s, media_type = %s, user_id = %s, tg_file_id = %s, bot_username = %s, updated_at = %s
                            WHERE card_id = %s
                            """,
                            (data.title, data.content, db_img, db_buttons_str, media_type, incoming_user_id, final_tg_file_id, active_bot_username, current_timestamp, card_id),
                        )
                else:
                    final_tg_file_id = warm_telegram_media_cache(active_bot_token, incoming_user_id, db_img, media_type) if db_img else None
                    # 指定了 card_id 但属于新卡片插入时，存入 bot_username
                    cursor.execute(
                        """
                        INSERT INTO cards (card_id, title, content, img, buttons, media_type, status, user_id, tg_file_id, bot_username, created_at, updated_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (card_id, data.title, data.content, db_img, db_buttons_str, media_type, "草稿", incoming_user_id, final_tg_file_id, active_bot_username, current_timestamp, current_timestamp),
                    )
            else:
                import random, string
                card_id = ''.join(random.choices(string.ascii_letters + string.digits, k=16))
                final_tg_file_id = warm_telegram_media_cache(active_bot_token, incoming_user_id, db_img, media_type) if db_img else None
                # 没有指定 card_id 纯全新创建卡片时，存入 bot_username
                cursor.execute(
                    """
                    INSERT INTO cards (card_id, title, content, img, buttons, media_type, status, user_id, tg_file_id, bot_username, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (card_id, data.title, data.content, db_img, db_buttons_str, media_type, "草稿", incoming_user_id, final_tg_file_id, active_bot_username, current_timestamp, current_timestamp),
                )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"数据库保存异常: {str(e)}")

    return {"code": 200, "status": "success", "message": "卡片保存成功", "id": card_id}

@app.get("/cards")
def get_cards(current_user: dict = Depends(get_current_tg_user)):
    user_id = str(current_user.get("id")).strip()

    with get_db_connection() as (_, cursor):
        # ⏱️ 【核心升级】：在 SQL 最后强行加上 ORDER BY updated_at DESC
        # 这样当你保存、或者预热完新卡片时，它在小程序列表里会雷打不动地出现在最上面！
        query = """
            SELECT card_id, title, status, img, content, buttons, views, shares, likes, clicks, user_id, media_type, updated_at, bot_username  
            FROM cards 
            WHERE user_id = %s
            ORDER BY updated_at DESC
        """
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
            "card_id": row[0],
            "title": row[1],
            "status": row[2],
            "img": row[3],
            "image": row[3],  # 保持你原有的双重保障，兼容前端习惯
            "content": row[4],
            "buttons": parsed_buttons,
            "user_id": row[10],
            "media_type": row[11] or 'photo',
            "updated_at": row[12],
            "bot_username": row[13] or '@default_bot',
            "analytics": {
                "views": row[6],
                "shares": row[7],
                "likes": row[8],
                "clicks": row[9],
            },
        })
        
    # 🚀 雷打不动返回你前端最喜欢的裸数组格式，405 报错瞬间烟消云散！
    return result



@app.post("/cards/{card_id}")
def save_card_with_path_id(card_id: str, data: CardInput, current_user: dict = Depends(get_current_tg_user)):
    data.id = card_id
    return save_card(data=data, current_user=current_user)

# 3. 发布卡片接口
@app.post("/publish")
def publish_card_with_tg_cache_and_quota(data: dict, current_user: dict = Depends(get_current_tg_user)):
    """
    【双模硬核发布网关】
    1. inline 模式：保持原样，只做鉴权与配额裁决，由前端调起原生 Inline 分享。
    2. direct 模式：后端越过前端，直接使用专属/系统 Bot 将卡片无痕投递至指定群组或频道。
    """
    incoming_user_id = str(current_user.get("id")).strip()
    
    # 1. 兼容获取必填参数
    card_id = str(data.get("card_id") or data.get("cardId") or "").strip()
    publish_mode = str(data.get("publish_mode") or data.get("publishMode") or "inline").lower().strip()
    target_chat_id = str(data.get("chat_id") or data.get("chatId") or "").strip()

    if not card_id:
        raise HTTPException(status_code=400, detail="发布失败：缺少必填卡片ID（card_id）")
    
    if publish_mode == "direct" and not target_chat_id:
        raise HTTPException(status_code=400, detail="发布失败：直发模式下必须提供目标渠道ID（chat_id）")

    title = content = img = buttons_raw = media_type = card_user_id = tg_file_id = None

    try:
        # 🔍 一气呵成：验证支配权的同时，顺手把直发所需的卡片全量核心资产全捞出来
        with get_db_connection() as (_, cursor):
            # 🎯【修复 1】: 将 WHERE id = %s 统一修正为 WHERE card_id = %s
            cursor.execute(
                "SELECT user_id, title, content, img, buttons, media_type, tg_file_id FROM cards WHERE card_id = %s",
                (card_id,),
            )
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="卡片未找到")
            
            card_user_id, title, content, img, buttons_raw, media_type, tg_file_id = row
            
            # 安全卡点：鉴别卡片支配权
            admin_super_id = str(os.getenv("ADMIN_SUPER_ID") or "").strip()
            if str(card_user_id).strip() != incoming_user_id and incoming_user_id != admin_super_id:
                raise HTTPException(status_code=403, detail="发布失败：您没有权限发布此卡片")

            if not card_user_id or str(card_user_id).strip() == "" or str(card_user_id).lower() == "none":
                raise HTTPException(status_code=400, detail="发布失败：该卡片在数据库中未绑定任何有效用户")

            # 🔐 读取所属用户的 VIP 状态、月度配额、以及专属 Bot 令牌
            cursor.execute(
                "SELECT telegram_id, role, vip_until, monthly_published_count, last_reset_month, bot_token FROM users WHERE telegram_id = %s",
                (str(card_user_id),),
            )
            user_row = cursor.fetchone()
            if not user_row:
                raise HTTPException(status_code=404, detail="卡片所属的用户在系统中未找到")
            
            # 🎯【修复 3】: 将原本含糊的 chat_id 变量名严谨修正为 owner_tg_id，绝不与目标渠道ID混淆
            owner_tg_id, role, vip_until, monthly_published_count, last_reset_month, bot_token = user_row
            
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
                (0, current_month, owner_tg_id),
            )

    # VIP 校验断点
    owner_perm = get_user_permission({"role": role, "vip_until": vip_until})

    if owner_perm["is_banned"]:
        raise HTTPException(status_code=403, detail="发布失败：该卡片所有者账号已被封禁")

    # 如果不是 VIP（超管/普通管理员/未过期VIP），则面临严苛的免费配额审查
    if not owner_perm["is_vip"]:
        if monthly_published_count >= 5:
            raise HTTPException(status_code=403, detail='普通用户每月仅能发布5张卡片，请充值升级为无限发布会员')

    # ==========================================
    # 🚀 核心整改：根据模式进行逻辑分支处理
    # ==========================================
    
    if publish_mode == "direct":
        active_bot_token = str(bot_token or "").strip() if bot_token else os.getenv("BOT_TOKEN")
        if not active_bot_token:
            raise HTTPException(status_code=500, detail="系统配置错误：未找到有效的 Bot Token")

        # 1. 🖼️ 路径智能修补
        has_media = bool(img and str(img).strip())
        if has_media:
            img_str = str(img).strip()
            if not (img_str.startswith("http://") or img_str.startswith("https://")):
                img_str = img_str.lstrip("/")
                base_url = API_BASE_URL.rstrip("/")
                if img_str.startswith("api/"):
                    img_str = img_str[4:]
                img = f"{base_url}/{img_str}"

        # 2. 🎛️ 解析组装内联按钮组
        try:
            buttons_data = json.loads(buttons_raw or "[]")
        except:
            buttons_data = []
        try:
            clean_keyboard = smart_clean_inline_keyboard(buttons_data, card_id)
            reply_markup = {"inline_keyboard": clean_keyboard} if clean_keyboard else None
        except:
            reply_markup = None

        # 3. 📝 文本清洗与字数截断
        clean_html = sanitize_for_telegram((content or "").strip())
        limit = 1024 if has_media else 4096
        caption_text = truncate_caption(clean_html, limit=limit)

        # 4. 🧳 智能化判定直发网关方法与载荷
        tg_file_id_str = str(tg_file_id or "").strip()
        
        payload = {
            "chat_id": target_chat_id
        }
        
        if reply_markup and reply_markup.get("inline_keyboard"):
            payload["reply_markup"] = reply_markup

        if has_media:
            norm_media = str(media_type or 'photo').lower().strip()
            media_value = tg_file_id_str if tg_file_id_str else img
            
            if norm_media == "video":
                endpoint = "sendVideo"
                payload["video"] = media_value
                payload["caption"] = caption_text
                payload["parse_mode"] = "HTML"
            elif norm_media == "gif":
                endpoint = "sendAnimation"
                payload["animation"] = media_value
                payload["caption"] = caption_text
                payload["parse_mode"] = "HTML"
            else:
                endpoint = "sendPhoto"
                payload["photo"] = media_value
                payload["caption"] = caption_text
                payload["parse_mode"] = "HTML"
        else:
            endpoint = "sendMessage"
            payload["text"] = caption_text
            payload["parse_mode"] = "HTML"

        # 5. 🚀 执行直发投递与【硬核自愈发信层】
        try:
            res = requests.post(
                f"https://api.telegram.org/bot{active_bot_token}/{endpoint}",
                json=payload,
                timeout=5
            )
            
            if not res.ok and ("parse" in res.text.lower() or "entity" in res.text.lower() or "entities" in res.text.lower()):
                print(f"[⚠️ 直发HTML自愈] 检测到排版引发语法崩溃，启动免解析无痕降级直发...")
                if "parse_mode" in payload:
                    payload["parse_mode"] = None
                res = requests.post(
                    f"https://api.telegram.org/bot{active_bot_token}/{endpoint}",
                    json=payload,
                    timeout=5
                )
                
            if not res.ok:
                print(f"[TG直发核心网关报错]: {res.text}")
                raise HTTPException(status_code=502, detail=f"Telegram 渠道投递失败: {res.text}")
                
            print(f"[直发成功] 卡片已成功穿透直发到目标渠道: {target_chat_id}")
            
            # ========================================================
            # 🔥【自动记忆存盘逻辑校正】
            # ========================================================
            try:
                res_json = res.json()
                chat_info = res_json.get("result", {}).get("chat", {})
                if chat_info:
                    real_chat_id = str(chat_info.get("id") or target_chat_id).strip()
                    chat_title = str(chat_info.get("title") or chat_info.get("username") or target_chat_id).strip()
                    chat_type = str(chat_info.get("type") or "channel").strip()
                    
                    with get_db_connection() as (_, cursor):
                        # 🎯【修复 2-A】: 这里的唯一判重和查询，将 id 改为 target_id
                        cursor.execute(
                            "SELECT target_id FROM publish_targets WHERE user_id = %s AND chat_id = %s",
                            (incoming_user_id, real_chat_id)
                        )
                        if cursor.fetchone():
                            cursor.execute(
                                "UPDATE publish_targets SET chat_title = %s, chat_type = %s, created_at = %s WHERE user_id = %s AND chat_id = %s",
                                (chat_title, chat_type, int(time.time()), incoming_user_id, real_chat_id)
                            )
                        else:
                            target_id = f"tgt_{int(time.time())}_{real_chat_id.replace('-', '')}"
                            # 🎯【修复 2-B】: 将 INSERT 语句里的字段名 id 改为 target_id
                            cursor.execute(
                                "INSERT INTO publish_targets (target_id, user_id, chat_id, chat_title, chat_type, created_at) VALUES (%s, %s, %s, %s, %s, %s)",
                                (target_id, incoming_user_id, real_chat_id, chat_title, chat_type, int(time.time()))
                            )
                print(f"[🎉 渠道自动锁定] 已成功将频道「{chat_title}」绑定至用户 {incoming_user_id} 的常用列表！")
            except Exception as save_err:
                print(f"[⚠️ 常用渠道资产录入失败]: {str(save_err)}")

        except Exception as tg_err:
            if isinstance(tg_err, HTTPException):
                raise tg_err
            raise HTTPException(status_code=500, detail=f"与 Telegram 通信失败: {str(tg_err)}")

    # ==========================================
    # 💾 激活存储与配额扣减（两套模式共享此中心）
    # ==========================================
    with get_db_connection() as (_, cursor):
        # 🎯【修复 1-B】: 将 UPDATE 语句里的 WHERE id = %s 修正为 WHERE card_id = %s
        cursor.execute("UPDATE cards SET status = %s WHERE card_id = %s", ("已发布", card_id))
        
        # 🎯【修复 4】: 将原本致命错误的 not is_vip 修正为标准的权限判断结果 not owner_perm["is_vip"]
        if role != 'superuser' and not owner_perm["is_vip"]:
            cursor.execute(
                "UPDATE users SET monthly_published_count = monthly_published_count + 1 WHERE telegram_id = %s",
                (owner_tg_id,),
            )

    # 6. 根据发布模式返回对应的成功文案
    if publish_mode == "direct":
        return {
            "code": 200,
            "status": "success",
            "message": "卡片已成功直接投递到您的目标渠道！",
        }
    else:
        return {
            "code": 200,
            "status": "success",
            "message": "卡片授权激活完毕！请配合前端调起原生分享面板进行发布。",
        }

@app.get("/publish/targets")  # 🚀 修复1：路径精准修正为前端请求的 /publish/targets，彻底解决 404
def get_user_publish_targets(current_user: dict = Depends(get_current_tg_user)):
    """
    【常用直发渠道查询网关】
    如实捞出当前登录用户历史上直发成功过并记录在册的所有群组或频道列表，供前端直接渲染成快捷下拉列表。
    """
    incoming_user_id = str(current_user.get("id")).strip()
    
    try:
        with get_db_connection() as (_, cursor):
            # 按最新绑定或更新时间降序排列，把最新用过的顶到最前面
            cursor.execute(
                """
                SELECT chat_id, chat_title, chat_type 
                FROM publish_targets 
                WHERE user_id = %s 
                ORDER BY created_at DESC
                """,
                (incoming_user_id,)
            )
            rows = cursor.fetchall()
            
            targets = []
            for row in rows:
                targets.append({
                    "chat_id": row[0],
                    "chat_title": row[1],
                    "chat_type": row[2]
                })
                
            return {
                "code": 200,
                "status": "success",
                "targets": targets,  # 🚀 修复2：完美契合前端的 data.targets 字段读取
                "data": targets      # 💡 留一个底牌备份，双重保险防空
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"拉取历史常用渠道失败: {str(e)}")
    
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
            admin_super_id = str(os.getenv("ADMIN_SUPER_ID") or "").strip()
            # 自动升级超管逻辑，很稳
            if admin_super_id and telegram_id == admin_super_id and role != 'superuser':
                role = 'superuser'
                cursor.execute("UPDATE users SET role = %s WHERE telegram_id = %s", (role, telegram_id))
            # 自动同步电报最新用户名，很赞
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
            admin_super_id = str(os.getenv("ADMIN_SUPER_ID") or "").strip()
            role = 'superuser' if (admin_super_id and telegram_id == admin_super_id) else 'user'
            
            # 🎯【核心修复】：在 SQL 写入阶段，彻底移除已经不存在的 id 列
            cursor.execute(
                """
                INSERT INTO users (telegram_id, username, role, vip_until, bot_token, bot_username, language, monthly_published_count, last_reset_month)
                VALUES (%s, %s, %s, 0, '', '', 'zh', 0, '')
                """,
                (telegram_id, username, role), # 👈 对应参数也少传一个 telegram_id
            ) 
            
            # 🎯【前端兼容】：返回给前端的字典里保留 "id" 键，装 telegram_id，确保前端不崩溃
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

@app.get("/api/custom-emojis")
async def get_custom_emojis():
    """
    让前端获取全网或当前可用专属表情包的闭环接口
    """
    try:
        with get_db_connection() as (conn, cursor):
            cursor.execute("SELECT emoji_id, fallback_char FROM custom_emojis ORDER BY created_at DESC")
            rows = cursor.fetchall()
            
            # 组装成和前端 1:1 完全对应的 JSON 格式
            result = [{"emoji_id": row[0], "fallback_char": row[1]} for row in rows]
            return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取自定义表情库失败: {str(e)}")

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
    【严防死守 + 多套餐动态版】创建官方星星支付链接
    Depends(get_current_tg_user) 强行在请求头解密验签 initData，保证身份绝对真实！
    """
    try:
        body = await request.json()
        body_tg_id = str(body.get("telegram_id", ""))
        # 🎯 动态获取前端传入的套餐 ID，默认降级为 week
        package_id = str(body.get("package_id") or body.get("packageId") or "week").strip().lower()
    except Exception:
        body_tg_id = ""
        package_id = "week"
        
    # 🚨【完美保留核心鉴权】：比对解密出来的 token 拥有者 ID 是否与前端 Body 上报的 ID 一致，防止越权并发欺诈
    token_tg_id = str(current_user.get("id") or current_user.get("telegram_id") or "")
    if body_tg_id and token_tg_id and body_tg_id != token_tg_id:
        raise HTTPException(status_code=403, detail="安全合规校验未通过：身份凭证不匹配")

    # 🎯 核心动态联动：每次创单都实时去 packages 表查出对应的天数和价格，达成“随时改价”
    with get_db_connection() as (_, cursor):
        cursor.execute(
            "SELECT name, price_usd, price_stars, duration_days FROM packages WHERE package_id = %s",
            (package_id,)
        )
        pkg_row = cursor.fetchone()
        if not pkg_row:
            raise HTTPException(status_code=400, detail="未找到指定的套餐配置，请检查 package_id")
        
        pkg_name, price_usd, db_price_stars, duration_days = pkg_row

    # 🧭 计价裁决：如果数据库填了特定的星星数就用数据库的，没填(或为0)就根据USDT动态算
    if db_price_stars and db_price_stars > 0:
        stars_amount = db_price_stars
    else:
        stars_amount = auto_calculate_stars(price_usd)
    
    order_id = f"STARS_{token_tg_id}_{int(time.time())}"
    
    # 组装请求 TG 官方创建发票的载荷
    tg_api_url = f"https://api.telegram.org/bot{BOT_TOKEN}/createInvoiceLink"
    payload = {
        "title": f"空境系统 - {pkg_name}",
        "description": f"享受高级会员专属特权（有效期 {duration_days} 天，含官方渠道税点补贴）",
        "payload": json.dumps({"order_id": order_id, "user_id": token_tg_id}),
        "provider_token": "",  # ⭐️ 官方 Stars 支付此处必须留空字符串
        "currency": "XTR",     # ⭐️ XTR 代表 Telegram Stars
        "prices": [
            {"label": f"{pkg_name}订阅", "amount": stars_amount}
        ]
    }
    
    try:
        res = requests.post(tg_api_url, json=payload, timeout=5)
        res_json = res.json()
        if not res_json.get("ok"):
            raise HTTPException(status_code=500, detail=f"TG官方收银台激活失败: {res_json.get('description')}")
            
        pay_url = res_json["result"]
        
        # 🎯 核心修复：使用下划线 `_` 让管家隐式接管事务，并把 package_id 和 duration_days 完美压入 orders 表留底
        with get_db_connection() as (_, cursor):
            cursor.execute(
                """
                INSERT INTO orders (order_id, user_id, amount, status, crypto_invoice_id, pay_url, package_id, duration_days)
                VALUES (%s, %s, %s, 'pending', %s, %s, %s, %s)
                """,
                (order_id, token_tg_id, float(stars_amount), "STARS_PAYING", pay_url, package_id, duration_days)
            )
            
        return {"status": "success", "pay_url": pay_url, "order_id": order_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"创建星星发票失败: {str(e)}")


@app.post("/vip/create_invoice")
async def create_invoice(data: dict, req: Request):
    """
    自适应安全创建发票：支持动态套餐控价与时间动态化
    """
    telegram_id = None

    try:
        auth_header = req.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            init_data = auth_header.split(" ", 1)[1]
            if "_" in init_data or "user=" in init_data:
                current_user = await get_current_tg_user(auth_header)
                telegram_id = str(current_user.get("id") or "").strip()
    except Exception as parse_err:
        print(f"[Header解析微报错，转入降级通道]: {parse_err}")

    if not telegram_id:
        telegram_id = str(data.get("telegram_id") or data.get("telegramId") or "").strip()

    if not telegram_id or telegram_id == "undefined" or telegram_id == "null":
        raise HTTPException(status_code=400, detail="认证失败，无法获取合法的 Telegram ID，请重新打开小程序")
 
    package_id = str(data.get("package_id") or data.get("packageId") or "week").strip().lower()
    
    # 🎯【优化 1】：换成下划线 _，利用智能管家自动控制生命周期
    with get_db_connection() as (_, cursor): 
        # 🎯【核心修复】：对齐 2.0 表结构，将 id 改为 package_id
        cursor.execute(
            "SELECT name, price_usd, duration_days FROM packages WHERE package_id = %s", 
            (package_id,)
        )
        pkg_row = cursor.fetchone()
        if not pkg_row:
            raise HTTPException(status_code=400, detail="未找到指定的套餐配置，请检查 package_id")
        
        pkg_name, price_usd, duration_days = pkg_row

    local_order_id = f"ORDER_{int(time.time())}_{uuid.uuid4().hex[:6].upper()}"
    amount = price_usd  
    
    crypto_pay_url = "https://pay.crypt.bot/api/createInvoice" 
    headers = {
        "Crypto-Pay-API-Token": CRYPTOBOT_TOKEN,
        "Content-Type": "application/json"
    }
    
    payload = {
        "asset": "USDT",
        "amount": str(amount),
        "description": f"空境系统 - {pkg_name}({duration_days}天)",  
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
      
        # 🎯【优化 2】：这里同样换成下划线 _，彻底拿掉冗余的手动 commit 代码
        with get_db_connection() as (_, cursor):
            # 💡 orders 表字段叫 user_id，传入的值是 telegram_id，这是完美的 2.0 规范
            cursor.execute(
                """
                INSERT INTO orders (order_id, user_id, amount, status, crypto_invoice_id, pay_url, package_id, duration_days)
                VALUES (%s, %s, %s, 'pending', %s, %s, %s, %s)
                """,
                (local_order_id, telegram_id, amount, crypto_invoice_id, pay_url, package_id, duration_days)
            )
            # 👈 原来的 try: conn.commit() except: pass 已被管家隐式接管，安全删除！
            
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
            local_order_id = payload_data.get("payload")
            crypto_invoice_id = str(payload_data.get("invoice_id")) 
            
            # 🎯【优化】：使用下划线 _ 替代 conn，利用底层连接池管家隐式接管事务
            with get_db_connection() as (_, cursor):
                # 🚀 用 FOR UPDATE 锁住订单行，高并发下稳如泰山
                cursor.execute(
                    "SELECT user_id, status, duration_days FROM orders WHERE order_id = %s FOR UPDATE", 
                    (local_order_id,)
                )
                order_row = cursor.fetchone()
                
                if order_row and order_row[1] == 'pending':
                    user_id = order_row[0]
                    # 安全兜底：如果老订单没有天数，默认走 7 天
                    duration_days = order_row[2] if (len(order_row) > 2 and order_row[2]) else 7 
                    
                    # 1. 更新订单状态
                    cursor.execute("UPDATE orders SET status = 'completed' WHERE order_id = %s", (local_order_id,))
                    
                    # 2. 传入动态获取到的天数，发放 VIP 权益
                    grant_vip_equity(cursor, user_id, duration_days)
                    
                    # 🎯【核心移除】：删除了不安全的 try: conn.commit() except: pass
                    # 只要上面的代码全部顺利走完，走出 with 缩进块时，管家会自动 commit 压盘；
                    # 如果任何一步报异常，管家会自动 rollback 回滚，确保一分钱都不会弄错。
                    
                    print(f"【充值成功】用户 {user_id} 成功续费 {duration_days} 天 VIP")
                    
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
async def update_settings(
    data: UpdateSettingsInput,
    current_user: dict = Depends(get_current_tg_user) # 🛡️ 强制引入 Telegram 真实性签名校验[span_4](end_span)
):
    # [span_5](start_span)🔒 绝对安全的身份：直接使用哈希校验通过的 TG_ID，杜绝前端越权篡改[span_5](end_span)
    telegram_id = current_user["telegram_id"]

    with get_db_connection() as (_, cursor):
        updates = []
        params = []

        # 🚀 所有人（VIP 和非 VIP）现在均可自由绑定或解绑专属 Bot
        if data.bot_token is not None:
            bot_token = str(data.bot_token).strip()
            if bot_token:
                # 💎 保留你原有的真实异步方法：获取专属 Bot 的用户名
                bot_username = await fetch_bot_username(bot_token)
                updates.append("bot_token = %s")
                params.append(bot_token)
                updates.append("bot_username = %s")
                params.append(bot_username)
            else:
                # 传入空字符串代表用户主动解绑专属 Bot，无缝恢复使用母舰
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

        # 🔄 重新读取最新数据返回给前端
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
            "SELECT card_id, title, status, img, content, buttons, views, shares, likes, clicks, media_type FROM cards WHERE id = %s",
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
        "card_id": row[0],
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
def delete_card(card_id: str, current_user: dict = Depends(get_current_tg_user)):
    incoming_user_id = str(current_user.get("id")).strip()
    
    try:
        with get_db_connection() as (_, cursor):
            # 🔎 1. 先查出这张卡片到底是谁的
            cursor.execute("SELECT user_id FROM cards WHERE card_id = %s", (card_id,))
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="该卡片不存在或已被删除")
            
            owner_id = str(row[0]).strip()
            
            admin_super_id = str(os.getenv("ADMIN_SUPER_ID") or "").strip()
            if owner_id != incoming_user_id and incoming_user_id != admin_super_id:
                raise HTTPException(status_code=403, detail="对不起，您没有删除此卡片的控制权限")
            
            # 🗑️ 3. 校验通过，允许安全执行切除手术
            cursor.execute("DELETE FROM cards WHERE card_id = %s", (card_id,))
            
            
        return {"code": 200, "status": "success", "msg": "卡片已安全从云端销毁", "message": "删除成功"}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"安全切除事务异常: {str(e)}")