# telegram_formatter.py
import re
from html import escape
from bs4 import BeautifulSoup, NavigableString, Tag

ALLOWED_TAGS = {
    "b", "strong", "i", "em", "u", "s", "strike",
    "code", "pre", "a", "blockquote", "tg-spoiler",
    "tg-emoji"  # 允许 Telegram 官方的专属表情标签
}


def normalize_spoilers(html: str) -> str:
    """
    地毯式扫描转换剧透标签，兼容 Tiptap 的各类自定义 Mark 属性
    """
    if not html:
        return ""

    # 强力降级替换：直接用正则匹配包含 spoiler 关键字的 span 开头标签
    html = re.sub(
        r'<span[^>]*?(?:class="[^"]*?tg-spoiler[^"]*"|data-tg-spoiler="true"|data-type="spoiler")[^>]*?>',
        '<tg-spoiler>',
        html,
        flags=re.IGNORECASE
    )
    # 替换自定义的 <spoiler> 标签
    html = re.sub(r'<spoiler[^>]*?>', '<tg-spoiler>', html, flags=re.IGNORECASE)

    # 统一闭合标签
    html = html.replace("</spoiler>", "</tg-spoiler>")

    soup = BeautifulSoup(html, "html.parser")

    # 兜底：通过 DOM 属性再次捞一遍剧透
    for span in soup.find_all("span"):
        attrs_str = str(span.attrs).lower()
        if "spoiler" in attrs_str:
            new_tag = soup.new_tag("tg-spoiler")
            new_tag.extend(span.contents)
            span.replace_with(new_tag)

    # Telegram 规范校正：如果加粗/斜体等在剧透外面，强制换位
    for parent_name in ["b", "strong", "i", "em", "u", "s"]:
        for parent_tag in soup.find_all(parent_name):
            child_spoiler = parent_tag.find("tg-spoiler")
            if child_spoiler:
                inner_tag = soup.new_tag(parent_name)
                inner_tag.extend(child_spoiler.contents)
                child_spoiler.contents = [inner_tag]
                parent_tag.replace_with(child_spoiler)

    return str(soup)


def process_and_unwrap_tags(soup: BeautifulSoup):
    """
    处理不兼容标签，保留换行排版
    """
    # 💡【针对问题三修复】前置高精度拦截：显式为 blockquote 和 pre 块级元素后面加上换行符保护
    # 彻底杜绝可折叠引用、多行代码块与后续常规正文紧密粘连、甚至排版错乱坍塌的死穴！
    for block_tag in soup.find_all(["blockquote", "pre"]):
        if block_tag.next_sibling:
            next_sib = block_tag.next_sibling
            # 如果后面已经是换行字符，则不重复添加，防止空行过多
            if not (isinstance(next_sib, NavigableString) and next_sib.startswith("\n")):
                block_tag.insert_after("\n")

    # 🚀 【核心升级】代码块强力扁平化引擎：彻底杜绝多行代码块消失的死穴！
    # Telegram 严禁 pre/code 内部嵌套任何其他 HTML 标签。这里必须提纯为纯文本。
    for pre_tag in soup.find_all("pre"):
        code_tag = pre_tag.find("code")
        if code_tag:
            language_cls = code_tag.get("class", [])
            pure_text = code_tag.get_text()  # 榨干所有内嵌的 span/b/i，只留纯代码文本
            pre_tag.clear()  # 物理清空内部所有杂质
            
            # 重新组装标准的、干净的 <code> 标签
            new_code = soup.new_tag("code")
            if language_cls:
                new_code["class"] = language_cls
            new_code.append(pure_text)
            pre_tag.append(new_code)
        else:
            pure_text = pre_tag.get_text()
            pre_tag.clear()
            new_code = soup.new_tag("code")
            new_code.append(pure_text)
            pre_tag.append(new_code)

    # 处理独立的内联代码（不在 pre 内部的 code），同样做去标签提纯
    for code_tag in soup.find_all("code"):
        if not code_tag.find_parent("pre"):
            pure_text = code_tag.get_text()
            code_tag.clear()
            code_tag.append(pure_text)

    # 以下为基础排版解包逻辑，完美保留并加入防御性换行校验
    for tag in soup.find_all(["p", "div", "tr", "h1", "h2", "h3", "h4", "h5", "h6"]):
        if tag.next_sibling:
            next_sib = tag.next_sibling
            if not (isinstance(next_sib, NavigableString) and next_sib.startswith("\n")):
                tag.insert_after("\n")
        tag.unwrap()

    for tag in soup.find_all(["br", "hr"]):
        tag.replace_with("\n")

    for tag in soup.find_all("li"):
        tag.insert_before("• ")
        if tag.next_sibling:
            tag.insert_after("\n")
        tag.unwrap()

    for tag in soup.find_all(["ul", "ol", "table", "tbody"]):
        tag.unwrap()

    # 安全拔除不在白名单的其余脏标签
    all_tags = soup.find_all()
    for tag in all_tags:
        if tag.name not in ALLOWED_TAGS:
            tag.unwrap()


def clean_attributes_and_escape(soup: BeautifulSoup):
    """
    严格洗白属性，同时保障文本安全转义
    """
    # 1. 优先对纯文本节点做转义，规避 TG 400 错误
    text_nodes = []
    for text_node in soup.find_all(text=True):
        if isinstance(text_node, NavigableString):
            if not text_node.string.startswith("&lt;") and not text_node.string.endswith("&gt;"):
                text_nodes.append(text_node)
                
    # 统一安全替换
    for node in text_nodes:
        node.replace_with(escape(node.string))

    # 2. 精准过滤属性 
    for tag in soup.find_all():
        if not isinstance(tag, Tag):
            continue

        attrs = dict(tag.attrs)
        tag.attrs.clear()

        # ====== 仅对指定标签放行特定属性 ======
        if tag.name == "a":
            href = attrs.get("href", "").strip()
            if href:
                if not href.startswith(("http://", "https://", "tg://")):
                    if href.startswith("@") or "_bot" in href.lower() or (len(href) >= 3 and "." not in href):
                        pure_username = href.lstrip("@")
                        href = f"https://t.me/{pure_username}"
            
            if href and not href.startswith(("http://", "https://", "tg://")):
                href = "https://" + href
                
            if href.startswith(("http://", "https://", "tg://")):
                tag["href"] = href

        # 💡 修复点 1：全地形模糊匹配，彻底解决前端属性名/值不一致的死穴
        elif tag.name == "blockquote":
            is_collapsible = False
            for k, v in attrs.items():
                k_lower = str(k).lower()
                v_str = " ".join(v) if isinstance(v, list) else str(v).lower()
                # 只要任何属性的键或值里包含 expandable 或 collapsible 信号，直接判定需要折叠
                if "expandable" in k_lower or "collapsible" in k_lower or "expandable" in v_str or "collapsible" in v_str:
                    is_collapsible = True
                    break
            
            if is_collapsible:
                tag["expandable"] = ""  # 塞入空属性，等待最后一步正则矫正

        elif tag.name == "code":
            cls = attrs.get("class", [])
            cls_str = " ".join(cls) if isinstance(cls, list) else str(cls)
            if "language-" in cls_str:
                match = re.search(r'(language-\w+)', cls_str)
                if match:
                    tag["class"] = match.group(1)

        elif tag.name == "tg-emoji":
            emoji_id = attrs.get("emoji-id", "").strip()
            if emoji_id:
                tag["emoji-id"] = emoji_id


def remove_empty_tags(soup: BeautifulSoup):
    for tag in reversed(soup.find_all()):
        # 🚀【安全升级】将 pre 和 code 也纳入保护豁免名单，防止空行或空格导致整个代码块被误杀
        if tag.name in ["tg-spoiler", "pre", "code"]:
            continue
        if tag.name == "a" and not tag.get("href"):
            tag.decompose()
            continue
        if not tag.get_text(strip=True):
            tag.decompose()


def sanitize_for_telegram(html: str) -> str:
    if not html:
        return ""
    html = normalize_spoilers(html)
    soup = BeautifulSoup(html, "html.parser")
    process_and_unwrap_tags(soup)
    clean_attributes_and_escape(soup)
    remove_empty_tags(soup)

    result = soup.decode(formatter=None)
    result = result.replace("&amp;lt;", "&lt;").replace("&amp;gt;", "&gt;").replace("&amp;amp;", "&amp;")
    
    # 💡 修复点 2：换用终极硬核正则兜底
    # 只要 blockquote 标签内部带有 expandable 关键字（不管 BS4 把它序列化成了 =" " 还是带了尾随空格）
    # 一律强行格式化为 Telegram 官方最严格认可的标准无值标签：<blockquote expandable>
    result = re.sub(
        r'<blockquote\s+[^>]*expandable[^>]*>',
        '<blockquote expandable>',
        result,
        flags=re.IGNORECASE
    )
    
    return result.strip()


def truncate_caption(html: str, limit: int = 1024) -> str:
    """
    DOM 树级安全截断引擎：
    既满足 Telegram 的字数限制，又绝对不破坏、不丢弃外层的 HTML 格式标签（如 blockquote expandable）
    """
    if not html:
        return ""
    
    soup = BeautifulSoup(html, "html.parser")
    pure_text = soup.get_text()
    
    # 如果本身就在安全长度内，直接原样返回
    if len(pure_text) <= limit:
        return html

    # 触发超长保护：目标纯文本截断长度（预留 3 个字符给省略号）
    target_text_len = limit - 3
    current_len = 0

    def truncate_node(node):
        nonlocal current_len
        # 如果是纯文本节点
        if isinstance(node, NavigableString):
            node_len = len(node.string)
            if current_len + node_len > target_text_len:
                remaining = target_text_len - current_len
                # 在文本节点内部截断，并优雅续上省略号
                truncated_text = node.string[:remaining] + "..."
                node.replace_with(NavigableString(truncated_text))
                current_len = target_text_len
                return True  # 向上层发送“截断已完成”信号
            else:
                current_len += node_len
        else:
            # 如果是 Tag 节点（例如 blockquote, b, a 等），深层遍历其子节点
            # 注意：必须转成 list 复制一份，因为遍历过程中可能会动态销毁（decompose）多余子节点
            children = list(node.contents)
            for child in children:
                if current_len >= target_text_len:
                    child.decompose()  # 字符配额已满，安全拔除后续所有多余标签和文本
                else:
                    done = truncate_node(child)
                    if done:
                        return True
        return False

    # 执行 DOM 树深度清洗截断
    truncate_node(soup)
    
    # 重新序列化输出，BeautifulSoup 会完美补齐未闭合的标签
    return soup.decode(formatter=None).strip()


def smart_clean_inline_keyboard(buttons_list: list, card_id: str) -> list:
    """
    智能清洗和重构内联键盘按钮
    """
    if not buttons_list or not isinstance(buttons_list, list):
        return []

    cleaned_keyboard = []

    for row in buttons_list:
        if not isinstance(row, list):
            continue
        
        cleaned_row = []
        for btn in row:
            if not isinstance(btn, dict):
                continue

            btn_text = btn.get("name") or btn.get("text") or "点击查看"
            b_type = btn.get("type") or "url"
            val = btn.get("value") or btn.get("url") or btn.get("callback_data") or ""
            val = str(val).strip()

            tg_btn = {"text": btn_text}

            if b_type == "url":
                if val:
                    temp_val = val.replace("https://", "").replace("http://", "").replace("t.me/", "").lstrip("@")
                    if "/" not in temp_val and "." not in temp_val:
                        tg_btn["url"] = f"https://t.me/{temp_val}"
                    else:
                        if not val.startswith(("http://", "https://", "tg://")):
                            val = "https://" + val
                        tg_btn["url"] = val
                else:
                    tg_btn["url"] = "https://t.me"

            elif b_type == "web_app":
                if val and not val.startswith(("http://", "https://")):
                    val = "https://" + val
                tg_btn["web_app"] = {"url": val if val else "https://t.me"}

            elif b_type == "callback":
                tg_btn["callback_data"] = val if val else f"click_card_{card_id}"

            elif b_type == "switch":
                tg_btn["switch_inline_query"] = val

            elif b_type == "share":
                share_text = val if val else f"card_{card_id}"
                tg_btn["switch_inline_query"] = share_text

            cleaned_row.append(tg_btn)
        
        if cleaned_row:
            cleaned_keyboard.append(cleaned_row)

    return cleaned_keyboard