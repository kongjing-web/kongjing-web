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
from contextlib import contextmanager
from functools import partial
from typing import List, Optional, Union, Any
from urllib.parse import quote_plus, parse_qsl
from datetime import datetime
from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form, Header, Depends
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from PIL import Image, ImageSequence
import psycopg2
from telegram_formatter import sanitize_for_telegram, truncate_caption, smart_clean_inline_keyboard


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
DB_CONFIG = {
    "dbname": "kongjing_db",
    "user": "postgres",
    "password": "741858",
    "host": "127.0.0.1",
    "port": 5432,
}
API_BASE_URL = "https://www.kongjing.online/api"
UPLOAD_DIR = "/var/www/kongjing/uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

@contextmanager
def get_db_connection():
    conn = psycopg2.connect(**DB_CONFIG)
    cursor = conn.cursor()
    try:
        yield conn, cursor
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()

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
    with get_db_connection() as (_, cursor):
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
                cursor.execute(f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {name} {metadata}")

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
        }.items():
            if name not in cards_columns:
                cursor.execute(f"ALTER TABLE cards ADD COLUMN IF NOT EXISTS {name} {metadata}")

        if "telegram_id" in users_columns:
            cursor.execute(
                """
                UPDATE users SET id = telegram_id WHERE (id IS NULL OR id = '') AND telegram_id IS NOT NULL
                """
            )

init_db()

# ==========================================
# 🛡️ TELEGRAM 安全校验核心依赖项
# ==========================================
def verify_telegram_init_data(init_data: str, bot_token: str) -> Optional[dict]:
    """
    严谨校验 Telegram 小程序的 initData 签名，并验证时效性
    """
    try:
        parsed_data = dict(parse_qsl(init_data))
        if "hash" not in parsed_data:
            return None
        
        tg_hash = parsed_data.pop("hash")
        
        # 1. 检查凭证时效性，超过 24 小时判定为过期
        auth_date = int(parsed_data.get("auth_date", 0))
        if int(time.time()) - auth_date > 86400:
            print("[安全警告] Telegram initData 凭证已过期")
            return None
            
        # 2. 升序拼接参数计算签名
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
    FastAPI 统一拦截器：防身份伪造
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="请重新从 Telegram 打开小程序以完成登录授权")
    
    init_data = authorization.split(" ", 1)[1]
    user_info = verify_telegram_init_data(init_data, BOT_TOKEN)
    if not user_info:
        raise HTTPException(status_code=403, detail="身份认证已失效或数据已被非法篡改")
        
    return user_info

# ==========================================
# 工具函数保持原有逻辑不变
# ==========================================
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

class UpdateSettingsInput(BaseModel):
    user_id: Any
    bot_token: Optional[str] = None
    language: Optional[str] = None

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

    # 身份提取完全交给 get_current_tg_user
    incoming_user_id = str(current_user.get("id")).strip()
    print("\n====== 保存调试 ======")
    print("title =", repr(data.title))
    print("content =", repr(data.content))
    print("=====================\n")
    if not incoming_user_id:
        raise HTTPException(status_code=400, detail="卡片保存失败：未能提取到有效的 Telegram 用户ID")

    # ==================== 【彻底简化：拥抱 type/value 纯净存储】 ====================
    db_buttons = data.buttons
    if isinstance(db_buttons, str):
        try:
            # 如果前端传过来的是未解开的字符串，解成 Python 列表/字典
            db_buttons = json.loads(db_buttons)
        except Exception:
            pass

    # 确保最终入库前包裹成标准 JSON 文本，原封不动保留前端的 type 和 value 结构
    if isinstance(db_buttons, (list, dict)):
        db_buttons_str = json.dumps(db_buttons, ensure_ascii=False)
    else:
        db_buttons_str = str(db_buttons) if db_buttons is not None else "[]"
    # ==============================================================================

    media_type = str(data.media_type).strip() if data.media_type else 'photo'
    if media_type not in ['photo', 'video', 'gif']:
        media_type = 'photo'

    card_id = str(data.id).strip() if data.id else ""

    try:
        with get_db_connection() as (_, cursor):
            if card_id:
                cursor.execute("SELECT id FROM cards WHERE id = %s", (card_id,))
                if cursor.fetchone():
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
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"数据库写入异常: {str(e)}")

    return {"code": 200, "status": "success", "message": "卡片保存成功", "id": card_id}


# 3. 发布卡片接口
@app.post("/publish")
def publish_card_with_tg_cache_and_quota(data: dict):
    card_id = str(data.get("card_id") or data.get("cardId") or "").strip()
    if not card_id:
        raise HTTPException(status_code=400, detail="发布失败：缺少必填卡片ID（card_id）")

    try:
        with get_db_connection() as (_, cursor):
            cursor.execute(
                "SELECT title, content, img, buttons, user_id, media_type FROM cards WHERE id = %s",
                (card_id,),
            )
            row = cursor.fetchone()
           
            if not row:
                raise HTTPException(status_code=404, detail="卡片未找到")

            title, content, img, buttons_raw, card_user_id, media_type = row
            print("\n========== 发布调试 ==========")

            print("TITLE:")
            print(repr(title))

            print("\nCONTENT:")
            print(repr(content))

            print("\n=============================\n")
            if not card_user_id or str(card_user_id).strip() == "" or str(card_user_id).lower() == "none":
                raise HTTPException(status_code=400, detail="发布失败：该卡片在数据库中未绑定任何有效用户")

            cursor.execute(
                "SELECT telegram_id, bot_token, role, vip_until, monthly_published_count, last_reset_month FROM users WHERE telegram_id = %s",
                (str(card_user_id),),
            )
            user_row = cursor.fetchone()
            if not user_row:
                raise HTTPException(status_code=404, detail="卡片所属的用户在系统中未找到")

            chat_id, user_bot_token, role, vip_until, monthly_published_count, last_reset_month = user_row
            bot_token = user_bot_token if user_bot_token else BOT_TOKEN
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"发布预查询失败: {str(e)}")

    now_ts = int(time.time())
    current_month = datetime.utcfromtimestamp(now_ts).strftime('%Y-%m')

    if last_reset_month != current_month:
        monthly_published_count = 0
        with get_db_connection() as (_, cursor):
            cursor.execute(
                "UPDATE users SET monthly_published_count = %s, last_reset_month = %s WHERE telegram_id = %s",
                (0, current_month, chat_id),
            )

    if role != 'superuser':
        is_vip = vip_until and int(vip_until) > now_ts
        if not is_vip and monthly_published_count >= 5:
            raise HTTPException(status_code=403, detail='非会员每月仅能发布5张卡片，请前往充值开启无限发布')

    try:
        buttons_data = json.loads(buttons_raw or "[]")
    except Exception:
        buttons_data = []

    # ======= 【更新：调用全新智能按钮清洗器】 =======
    clean_keyboard = smart_clean_inline_keyboard(buttons_data, card_id)
    reply_markup = {"inline_keyboard": clean_keyboard} if clean_keyboard else None

   # 修改后：直接拿富文本内容，不拼接任何多余标题
    raw_html_content = (content or "").strip()
        
    # 调用升级版的工具函数洗白
    clean_html_content = sanitize_for_telegram(raw_html_content)
    
    # 动态控制字数
    has_media = img and str(img).strip() != ""
    limit_length = 1024 if has_media else 4096
    caption_text = truncate_caption(clean_html_content, limit=limit_length)
    # ====================================================================

    with get_db_connection() as (_, cursor):
        cursor.execute(
            "SELECT file_id, media_type FROM media_cache WHERE local_url = %s",
            (img,),
        )
        cache_row = cursor.fetchone()

    tg_file_id = cache_row[0] if cache_row else None
    telegram_api_base = f"https://api.telegram.org/bot{bot_token}"
    response_data = None

    try:
        if tg_file_id:
            if media_type == 'video':
                payload = {"chat_id": chat_id, "video": tg_file_id, "caption": caption_text, "parse_mode": "HTML"}
            elif media_type == 'gif':
                payload = {"chat_id": chat_id, "animation": tg_file_id, "caption": caption_text, "parse_mode": "HTML"}
            else:
                payload = {"chat_id": chat_id, "photo": tg_file_id, "caption": caption_text, "parse_mode": "HTML"}
            if reply_markup:
                payload["reply_markup"] = reply_markup
            res = requests.post(f"{telegram_api_base}/send" + ("Video" if media_type == 'video' else "Animation" if media_type == 'gif' else "Photo"), json=payload, timeout=15)
            response_data = res
        else:
            if img and str(img).strip() != "":
                if media_type == 'video':
                    payload = {"chat_id": chat_id, "video": img, "caption": caption_text, "parse_mode": "HTML"}
                elif media_type == 'gif':
                    payload = {"chat_id": chat_id, "animation": img, "caption": caption_text, "parse_mode": "HTML"}
                else:
                    payload = {"chat_id": chat_id, "photo": img, "caption": caption_text, "parse_mode": "HTML"}
                if reply_markup:
                    payload["reply_markup"] = reply_markup
                res = requests.post(f"{telegram_api_base}/send" + ("Video" if media_type == 'video' else "Animation" if media_type == 'gif' else "Photo"), json=payload, timeout=15)
            else:
                payload = {"chat_id": chat_id, "text": caption_text, "parse_mode": "HTML"}
                if reply_markup:
                    payload["reply_markup"] = reply_markup
                res = requests.post(f"{telegram_api_base}/sendMessage", json=payload, timeout=15)

            response_data = res
            if res.ok and img and str(img).strip() != "":
                try:
                    res_json = res.json()
                    new_file_id = _extract_tg_file_id(res_json, media_type)
                    if new_file_id:
                        with get_db_connection() as (_, cursor):
                            cursor.execute(
                                """
                                INSERT INTO media_cache (local_url, file_id, media_type, created_at)
                                VALUES (%s, %s, %s, %s)
                                ON CONFLICT (local_url) DO UPDATE SET
                                    file_id = EXCLUDED.file_id,
                                    media_type = EXCLUDED.media_type,
                                    created_at = EXCLUDED.created_at
                                """,
                                (img, new_file_id, media_type, int(time.time())),
                            )
                except Exception as cache_err:
                    print(f"[警告] 提取或写入 tg_file_id 失败: {str(cache_err)}")

        if not response_data.ok:
            raise HTTPException(status_code=400, detail=f"Telegram推送失败。错误原因: {response_data.text}")
    except requests.exceptions.RequestException as req_err:
        raise HTTPException(status_code=502, detail=f"连接 Telegram 服务超时: {str(req_err)}")

    with get_db_connection() as (_, cursor):
        # 注意：这里我们只更新状态，绝对不会把带有标题拼装后的 caption_text 更新回 content 字段！
        cursor.execute("UPDATE cards SET status = %s WHERE id = %s", ("已发布", card_id))
        if role != 'superuser' and not (vip_until and int(vip_until) > now_ts):
            cursor.execute(
                "UPDATE users SET monthly_published_count = monthly_published_count + 1 WHERE telegram_id = %s",
                (chat_id,),
            )

    return {"code": 200, "status": "success", "message": "卡片发布成功！", "is_cached": tg_file_id is not None}
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

# 后续所有的 VIP 充值回调、卡片详情、预览、删除等业务路由，完美保持原样不变...
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
        with get_db_connection() as (_, cursor):
            cursor.execute("SELECT vip_until FROM users WHERE telegram_id = %s", (telegram_id,))
            row = cursor.fetchone()
            if row:
                now_ts = int(time.time())
                current_until = max(now_ts, int(row[0] or 0))
                new_until = current_until + 7 * 24 * 60 * 60
                cursor.execute("UPDATE users SET vip_until = %s WHERE telegram_id = %s", (new_until, telegram_id))
        return {"code": 200, "status": "success", "message": "VIP 有效期已延长 7 天"}
    return {"code": 200, "status": "ignored", "message": "未处理的回调"}

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