import os
import json
import sqlite3
import random
import re
import string
import time
import requests
from functools import partial
from urllib.parse import quote_plus
from datetime import datetime
from pydantic import BaseModel
from typing import List, Optional, Union, Any
from fastapi import FastAPI, HTTPException, Request, UploadFile, File
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
app = FastAPI(title="空境系统 - Telegram 卡片后台中心")

# 允许跨域请求
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BOT_TOKEN = "8732461104:AAHiXL_2QzqHFRg2zfdvews2J5RDW2KWieA"
CRYPTOBOT_TOKEN = "586003:AA8fUwUV0Y6cC0GBRUWtiJO9todPsTaKKKs"
DB_FILE = "kongjing.db"
API_BASE_URL = "https://www.kongjing.online/api"
UPLOAD_DIR = "/root/card_system/uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

def init_db():
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            telegram_id TEXT PRIMARY KEY,
            username TEXT,
            role TEXT DEFAULT 'user',
            vip_until INTEGER DEFAULT 0,
            bot_token TEXT,
            bot_username TEXT,
            language TEXT DEFAULT 'zh',
            monthly_published_count INTEGER DEFAULT 0,
            last_reset_month TEXT
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS cards (
            id TEXT PRIMARY KEY,
            title TEXT,
            status TEXT,
            img TEXT,
            content TEXT,
            buttons TEXT,
            views INTEGER DEFAULT 0,
            shares INTEGER DEFAULT 0,
            likes INTEGER DEFAULT 0,
            clicks INTEGER DEFAULT 0,
            user_id TEXT
        )
    ''')
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN language TEXT DEFAULT 'zh'")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE cards ADD COLUMN user_id TEXT")
    except sqlite3.OperationalError:
        pass
    conn.commit()
    conn.close()

init_db()

@app.post("/upload")
def upload_file(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="缺少上传文件")

    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="仅支持图片上传")

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]:
        ext = ".jpg"

    file_name = f"{int(time.time())}_{random.randint(100000, 999999)}{ext}"
    file_path = os.path.join(UPLOAD_DIR, file_name)

    try:
        with open(file_path, "wb") as f:
            f.write(file.file.read())
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"文件保存失败: {exc}")

    return {"url": f"https://www.kongjing.online/uploads/{file_name}"}

# ---- 兼容前端的严谨数据模型 ----
class CardInput(BaseModel):
    id: Optional[str] = None
    title: str
    content: str
    img: Optional[str] = None
    image: Optional[str] = None
    buttons: Union[List[Any], dict, str] = "[]"
    user_id: Optional[str] = None

class UserLoginInput(BaseModel):
    id: Any
    username: Optional[str] = ""

class UpdateSettingsInput(BaseModel):
    user_id: Any
    bot_token: Optional[str] = None
    language: Optional[str] = None

# ==========================================
# 核心路由接口 (已去除 /api 前缀，完美适配 Nginx)
# ==========================================

# 1. 获取所有卡片列表
@app.get("/cards")
def get_cards(user_id: Optional[str] = None):
    if not user_id:
        return []
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    query = "SELECT id, title, status, img, content, buttons, views, shares, likes, clicks, user_id FROM cards WHERE user_id = ?"
    cursor.execute(query, (str(user_id),))
    rows = cursor.fetchall()
    conn.close()
    
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
            "analytics": {
                "views": row[6],
                "shares": row[7],
                "likes": row[8],
                "clicks": row[9]
            }
        })
    return result

# 2. 保存/更新卡片 (完美兼容带有路径 ID 的 POST 请求)
@app.post("/cards")
def save_card(data: CardInput):
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    # 1. 精确双向提取图片字段（防止为空）
    target_photo = data.img if data.img else (data.image if data.image else "")
    db_img = str(target_photo).strip()
    
    # 2. 安全提取并校验 user_id
    incoming_user_id = str(data.user_id).strip() if data.user_id is not None else ""
    if not incoming_user_id or incoming_user_id.lower() == "none" or incoming_user_id == "123456789":
        conn.close()
        raise HTTPException(status_code=400, detail="卡片保存失败：未能提取到有效的 Telegram 用户ID，请确认小程序登录状态。")
    
    # 3. 处理按钮数据格式
    db_buttons = data.buttons
    if isinstance(db_buttons, (list, dict)):
        db_buttons = json.dumps(db_buttons, ensure_ascii=False)
    else:
        db_buttons = str(db_buttons) if db_buttons is not None else "[]"
        
    card_id = str(data.id).strip() if data.id else ""
    
    try:
        if card_id:
            # 修改现有卡片
            cursor.execute("SELECT id FROM cards WHERE id = ?", (card_id,))
            if cursor.fetchone():
                cursor.execute("""
                    UPDATE cards 
                    SET title = ?, content = ?, img = ?, buttons = ?, user_id = ? 
                    WHERE id = ?
                """, (data.title, data.content, db_img, db_buttons, incoming_user_id, card_id))
            else:
                cursor.execute("""
                    INSERT INTO cards (id, title, content, img, buttons, status, user_id) 
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (card_id, data.title, data.content, db_img, db_buttons, "草稿", incoming_user_id))
        else:
            # 创建全新卡片
            card_id = ''.join(random.choices(string.ascii_letters + string.digits, k=16))
            cursor.execute("""
                INSERT INTO cards (id, title, content, img, buttons, status, user_id) 
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (card_id, data.title, data.content, db_img, db_buttons, "草稿", incoming_user_id))
            
        conn.commit()
        conn.close()
        return {"code": 200, "status": "success", "message": "卡片保存成功", "id": card_id}
    except Exception as e:
        if 'conn' in locals():
            conn.close()
        raise HTTPException(status_code=500, detail=f"数据库写入异常: {str(e)}")

# ==========================================
# ⚡ 黄金修复版：发布卡片接口（支持双向命名对齐）
# ==========================================
@app.post("/publish")
def publish_card(data: dict):
    # 完美支持驼峰 cardId 或下划线 card_id
    card_id = str(data.get("card_id") or data.get("cardId") or "").strip()
    if not card_id:
        raise HTTPException(status_code=400, detail="发布失败：缺少必填卡片ID（card_id）")

    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT title, content, img, buttons, user_id FROM cards WHERE id = ?", (card_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="卡片未找到")

        title, content, img, buttons_raw, card_user_id = row
        if not card_user_id or str(card_user_id).strip() == "" or str(card_user_id).lower() == "none":
            raise HTTPException(status_code=400, detail="发布失败：该卡片在数据库中未绑定任何有效用户")

        cursor.execute("SELECT telegram_id, bot_token, role, vip_until, monthly_published_count, last_reset_month FROM users WHERE telegram_id = ?", (str(card_user_id),))
        user_row = cursor.fetchone()
        if not user_row:
            raise HTTPException(status_code=404, detail="卡片所属的用户在系统中未找到")

        chat_id, user_bot_token, role, vip_until, monthly_published_count, last_reset_month = user_row
        bot_token = user_bot_token if user_bot_token else BOT_TOKEN
        conn.close()
    except Exception as e:
        if 'conn' in locals():
            conn.close()
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"发布预查询失败: {str(e)}")

    # 月份重置和额度扣除逻辑保持不变...
    now_ts = int(time.time())
    current_month = datetime.utcfromtimestamp(now_ts).strftime('%Y-%m')
    if last_reset_month != current_month:
        monthly_published_count = 0
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute("UPDATE users SET monthly_published_count = ?, last_reset_month = ? WHERE telegram_id = ?", (0, current_month, chat_id))
        conn.commit()
        conn.close()

    if role != 'superuser':
        if vip_until and int(vip_until) > now_ts:
            pass
        elif monthly_published_count >= 5:
            raise HTTPException(status_code=403, detail='非会员每月仅能发布5张卡片，请前往充值')

    try:
        buttons_data = json.loads(buttons_raw or "[]")
    except Exception:
        buttons_data = []
    if isinstance(buttons_data, dict):
        buttons_data = [buttons_data]

    inline_keyboard = []
    for btn in buttons_data:
        if not isinstance(btn, dict):
            continue
        btn_id = str(btn.get("id") or btn.get("button_id") or btn.get("text") or "btn")
        btn_text = str(btn.get("text") or btn.get("label") or "点击")
        original_url = str(btn.get("url") or btn.get("link") or "")
        if not original_url:
            continue
        redirect_url = f"https://www.kongjing.online/api/click?card_id={quote_plus(card_id)}&button_id={quote_plus(btn_id)}&redirect={quote_plus(original_url)}"
        inline_keyboard.append([{"text": btn_text, "url": redirect_url}])

    reply_markup = {"inline_keyboard": inline_keyboard} if inline_keyboard else None
    clean_content = re.sub(r'<p\s*>', '', content or '')
    clean_content = re.sub(r'</p\s*>', '\n', clean_content)
    telegram_api_base = f"https://api.telegram.org/bot{bot_token}"
    
    try:
        if img and str(img).strip() != "":
            payload = {
                "chat_id": chat_id,
                "photo": img,
                "caption": f"<b>{title}</b>\n\n{clean_content}",
                "parse_mode": "HTML"
            }
            if reply_markup:
                payload["reply_markup"] = json.dumps(reply_markup, ensure_ascii=False)
            response = requests.post(f"{telegram_api_base}/sendPhoto", json=payload, timeout=15)
        else:
            payload = {
                "chat_id": chat_id,
                "text": f"<b>{title}</b>\n\n{clean_content}",
                "parse_mode": "HTML"
            }
            if reply_markup:
                payload["reply_markup"] = json.dumps(reply_markup, ensure_ascii=False)
            response = requests.post(f"{telegram_api_base}/sendMessage", json=payload, timeout=15)

        if not response.ok:
            raise HTTPException(status_code=400, detail=f"Telegram推送失败。请确认您在TG中开启并/start了机器人。错误原因: {response.text}")
    except requests.exceptions.RequestException as req_err:
        raise HTTPException(status_code=502, detail=f"连接 Telegram 官方服务超时，请重试: {str(req_err)}")

    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("UPDATE cards SET status = ? WHERE id = ?", ("已发布", card_id))
    if role != 'superuser' and not (vip_until and int(vip_until) > now_ts):
        cursor.execute("UPDATE users SET monthly_published_count = monthly_published_count + 1 WHERE telegram_id = ?", (chat_id,))
    conn.commit()
    conn.close()

    return {"code": 200, "status": "success", "message": "卡片发布成功！"}

@app.post("/vip/create_invoice")
def create_invoice(data: dict):
    telegram_id = str(data.get("telegram_id") or data.get("telegramId") or "").strip()
    if not telegram_id:
        raise HTTPException(status_code=400, detail="缺少 telegram_id")

    payload = {
        "amount": "2.00",
        "asset": "USDT",
        "currency": "USDT",
        "description": f"Telegram VIP 周会员 - {telegram_id}",
        "metadata": {"telegram_id": telegram_id},
        "callback_url": "https://www.kongjing.online/api/vip/crypto_webhook"
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {CRYPTOBOT_TOKEN}"
    }
    response = requests.post("https://pay.cryptoboot.com/api/createInvoice", json=payload, headers=headers, timeout=15)
    if not response.ok:
        raise HTTPException(status_code=502, detail=f"创建发票失败: {response.text}")

    result = response.json()
    pay_url = result.get("pay_url") or result.get("payUrl") or result.get("url") or result.get("payment_url")
    invoice_id = result.get("invoice_id") or result.get("invoiceId") or result.get("id")
    if not pay_url:
        raise HTTPException(status_code=502, detail=f"创建发票失败: {result}")

    return {"pay_url": pay_url, "invoice_id": invoice_id}

@app.post("/vip/crypto_webhook")
def crypto_webhook(data: dict):
    payload = data.get("payload") if isinstance(data.get("payload"), dict) else data
    status = payload.get("status")
    metadata = payload.get("metadata") or {}
    telegram_id = str(metadata.get("telegram_id") or payload.get("telegram_id") or data.get("telegram_id") or "").strip()
    if status == 'paid' and telegram_id:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute("SELECT vip_until FROM users WHERE telegram_id = ?", (telegram_id,))
        row = cursor.fetchone()
        if row:
            now_ts = int(time.time())
            current_until = max(now_ts, int(row[0] or 0))
            new_until = current_until + 7 * 24 * 60 * 60
            cursor.execute("UPDATE users SET vip_until = ? WHERE telegram_id = ?", (new_until, telegram_id))
            conn.commit()
        conn.close()
        return {"code": 200, "status": "success", "message": "VIP 有效期已延长 7 天"}
    return {"code": 200, "status": "ignored", "message": "未处理的回调"}

@app.get("/click")
def click_redirect(card_id: str, button_id: str, redirect: str):
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("UPDATE cards SET clicks = clicks + 1 WHERE id = ?", (card_id,))
    conn.commit()
    conn.close()
    return RedirectResponse(url=redirect)

@app.post("/cards/{card_id}/preview")
def card_preview(card_id: str):
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("UPDATE cards SET views = views + 1 WHERE id = ?", (card_id,))
    conn.commit()
    conn.close()
    return {"code": 200, "status": "success", "message": "预览计数已更新"}

@app.post("/cards/{card_id}/share")
def card_share(card_id: str):
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("UPDATE cards SET shares = shares + 1 WHERE id = ?", (card_id,))
    conn.commit()
    conn.close()
    return {"code": 200, "status": "success", "message": "分享计数已更新"}

@app.post("/user/login")
def user_login(data: UserLoginInput):
    telegram_id = str(data.id)
    username = str(data.username or "")
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("SELECT telegram_id, username, role, vip_until, bot_token, bot_username, language, monthly_published_count, last_reset_month FROM users WHERE telegram_id = ?", (telegram_id,))
    row = cursor.fetchone()

    if row:
        role = row[2]
        if telegram_id == '8368521045' and role != 'superuser':
            role = 'superuser'
            cursor.execute("UPDATE users SET role = ? WHERE telegram_id = ?", (role, telegram_id))
        if row[1] != username:
            cursor.execute("UPDATE users SET username = ? WHERE telegram_id = ?", (username, telegram_id))
        conn.commit()
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
            "last_reset_month": row[8]
        }
    else:
        role = 'superuser' if telegram_id == '8368521045' else 'user'
        cursor.execute('''
            INSERT INTO users (telegram_id, username, role, vip_until, bot_token, bot_username, language, monthly_published_count, last_reset_month)
            VALUES (?, ?, ?, 0, '', '', 'zh', 0, '')
        ''', (telegram_id, username, role))
        conn.commit()
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
            "last_reset_month": ""
        }

    conn.close()
    return user

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

    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("SELECT role, vip_until FROM users WHERE telegram_id = ?", (telegram_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="用户不存在")

    role, vip_until = row
    now_ts = int(time.time())
    is_member = role == 'superuser' or (vip_until and int(vip_until) > now_ts)

    updates = []
    params = []

    if data.bot_token is not None:
        if not is_member:
            conn.close()
            raise HTTPException(status_code=403, detail="仅会员或超级账号可绑定专属Bot")
        bot_token = str(data.bot_token).strip()
        if bot_token:
            bot_username = await fetch_bot_username(bot_token)
            updates.append("bot_token = ?")
            params.append(bot_token)
            updates.append("bot_username = ?")
            params.append(bot_username)
        else:
            updates.append("bot_token = ?")
            params.append("")
            updates.append("bot_username = ?")
            params.append("")

    if data.language is not None:
        language = str(data.language).strip().lower()
        if language not in ['zh', 'en']:
            language = 'zh'
        updates.append("language = ?")
        params.append(language)

    if updates:
        params.append(telegram_id)
        cursor.execute(f"UPDATE users SET {', '.join(updates)} WHERE telegram_id = ?", params)
        conn.commit()

    cursor.execute("SELECT telegram_id, username, role, vip_until, bot_token, bot_username, language, monthly_published_count, last_reset_month FROM users WHERE telegram_id = ?", (telegram_id,))
    row = cursor.fetchone()
    conn.close()

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
        "last_reset_month": row[8]
    }

# 3. 获取单张卡片详情
@app.get("/cards/{card_id}")
def get_card(card_id: str):
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("SELECT id, title, status, img, content, buttons, views, shares, likes, clicks FROM cards WHERE id = ?", (card_id,))
    row = cursor.fetchone()
    conn.close()
    
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
        "analytics": {
            "views": row[6],
            "shares": row[7],
            "likes": row[8],
            "clicks": row[9]
        }
    }

# 4. 删除卡片
@app.delete("/cards/{card_id}")
def delete_card(card_id: str):
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM cards WHERE id = ?", (card_id,))
    conn.commit()
    conn.close()
    return {"code": 200, "status": "success", "msg": "删除成功", "message": "删除成功"}