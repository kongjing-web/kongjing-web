# telegram_formatter.py
import re
from html import escape
from bs4 import BeautifulSoup, NavigableString, Tag

ALLOWED_TAGS = {
    "b", "strong", "i", "em", "u", "s", "strike",
    "code", "pre", "a", "blockquote", "tg-spoiler"
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

    # 统一闭合标签（注意：由于前面已经把特定的 span 换成了 tg-spoiler，这里需要特殊处理）
    # 为了防止误杀正常的 </span>，我们可以配合 BeautifulSoup 自动修正，或者先做基础替换
    html = html.replace("</spoiler>", "</tg-spoiler>")

    # 利用 DOM 树做二次校正：如果发现加粗嵌套在剧透里面导致的死穴，进行强制外翻换位
    soup = BeautifulSoup(html, "html.parser")

    # 兜底：如果有些 span 漏网了，通过 DOM 属性再次捞一遍
    for span in soup.find_all("span"):
        attrs_str = str(span.attrs).lower()
        if "spoiler" in attrs_str:
            new_tag = soup.new_tag("tg-spoiler")
            new_tag.extend(span.contents)
            span.replace_with(new_tag)

    # 【核心修正】Telegram 规范校正：如果 b/strong/i/u 在 tg-spoiler 外面，强制把 tg-spoiler 翻到最外层
    for parent_name in ["b", "strong", "i", "em", "u", "s"]:
        for parent_tag in soup.find_all(parent_name):
            child_spoiler = parent_tag.find("tg-spoiler")
            if child_spoiler:
                # 发现错误嵌套，开始换位
                # 把里面的文本抽出来，在外面套上父级标签
                inner_tag = soup.new_tag(parent_name)
                inner_tag.extend(child_spoiler.contents)

                # 让 tg-spoiler 包裹新的内层标签
                child_spoiler.contents = [inner_tag]

                # 拔除外层多余的壳
                parent_tag.replace_with(child_spoiler)

    return str(soup)


def process_and_unwrap_tags(soup: BeautifulSoup):
    """
    处理不兼容标签，保留换行排版
    """
    for tag in soup.find_all(["p", "div", "tr", "h1", "h2", "h3", "h4", "h5", "h6"]):
        if tag.next_sibling:
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

    # 安全拔除不在白名单的标签
    all_tags = soup.find_all()
    for tag in all_tags:
        if tag.name not in ALLOWED_TAGS:
            tag.unwrap()


def clean_attributes_and_escape(soup: BeautifulSoup):
    """
    严格洗白属性，同时保障文本安全转义
    """
    # 1. 优先对纯文本节点做转义，规避 TG 400 错误
    for text_node in soup.find_all(text=True):
        if isinstance(text_node, NavigableString):
            # 如果父级已经是转义后的文本，不再重复转义
            if not text_node.string.startswith("&lt;") and not text_node.string.endswith("&gt;"):
                escaped_text = escape(text_node.string)
                text_node.replace_with(escaped_text)

    # 2. 精准过滤属性
    for tag in soup.find_all():
        if not isinstance(tag, Tag):
            continue

        attrs = dict(tag.attrs)
        tag.attrs.clear()

        if tag.name == "a":
            href = attrs.get("href", "").strip()
            # 智能补全 URL 前缀
            if href and not href.startswith(("http://", "https://", "tg://")):
                href = "https://" + href
            if href.startswith(("http://", "https://", "tg://")):
                tag["href"] = href

        elif tag.name == "blockquote":
            if "collapsible" in attrs or "collapsible" in attrs.get("class", []):
                tag["collapsible"] = ""

        elif tag.name == "code":
            # 保留代码高亮类
            cls = attrs.get("class", [])
            cls_str = " ".join(cls) if isinstance(cls, list) else str(cls)
            if "language-" in cls_str:
                match = re.search(r'(language-\w+)', cls_str)
                if match:
                    tag["class"] = match.group(1)


def remove_empty_tags(soup: BeautifulSoup):
    for tag in reversed(soup.find_all()):
        if tag.name == "tg-spoiler":
            continue
        if tag.name == "a" and not tag.get("href"):
            tag.decompose()
            continue
        if not tag.get_text(strip=True):
            tag.decompose()


def sanitize_for_telegram(html: str) -> str:
    if not html:
        return ""
    # 规范化剧透
    html = normalize_spoilers(html)
    soup = BeautifulSoup(html, "html.parser")
    # 解包多余标签
    process_and_unwrap_tags(soup)
    # 属性洗白与文本转义
    clean_attributes_and_escape(soup)
    # 清理空标签
    remove_empty_tags(soup)

    result = soup.decode(formatter=None)
    # 修正二次转义
    result = result.replace("&amp;lt;", "&lt;").replace("&amp;gt;", "&gt;").replace("&amp;amp;", "&amp;")
    return result.strip()


def truncate_caption(html: str, limit: int = 1024) -> str:
    if not html:
        return ""
    temp_soup = BeautifulSoup(html, "html.parser")
    pure_text = temp_soup.get_text()
    if len(pure_text) <= limit:
        return html
    return pure_text[:limit - 3] + "..."


def smart_clean_inline_keyboard(buttons_list: list, card_id: str) -> list:
    """
    智能清洗和重构内联键盘按钮
    适配前端传参：name (按钮文本), type (按钮类型), value (按钮内容/链接)
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

           # 1. 修正文本错位：完美兼顾前端直发与后端存储字段 (name / text)
            btn_text = btn.get("name") or btn.get("text") or "点击查看"
            b_type = btn.get("type") or "url"
            
            # 2. 🟢【全兼容大终结】内容错位终极解法：
            # 不管是前端 payload 里的 'value'，还是老数据残留的 'url'、'callback_data'，全部一网打尽！
            val = btn.get("value") or btn.get("url") or btn.get("callback_data") or ""
            val = str(val).strip()

            tg_btn = {"text": btn_text}

            # 3. 智能处理 URL 类型（包含你的独家高爽直连黑科技）
            if b_type == "url":
                # 如果用户直接输入的是频道名、Bot名（例如: kongjing_service_bot 或 t.me/xxx）
                if val and not val.startswith(("http://", "https://")) and ("_bot" in val or len(val) >= 4 and not "." in val):
                    # 自动将其编译为无缝拉起客户端的官方高爽直连链接
                    # 如果用户写了 @，先去掉 @
                    pure_username = val.lstrip("@")
                    tg_btn["url"] = f"https://t.me/{pure_username}"
                else:
                    # 普通外部网址补全
                    if val and not val.startswith(("http://", "...")): # 补全 http
                        if not val.startswith(("http://", "https://")):
                            val = "https://" + val
                    tg_btn["url"] = val if val else "https://t.me"

            # 4. 智能处理 Web App 类型
            elif b_type == "web_app":
                if val and not val.startswith(("http://", "https://")):
                    val = "https://" + val
                tg_btn["web_app"] = {"url": val if val else "https://t.me"}

            # 5. 智能自动修复 Callback 类型
            elif b_type == "callback":
                tg_btn["callback_data"] = val if val else f"click_card_{card_id}"

            # 6. 智能处理 Switch 转发类型
            elif b_type == "switch":
                tg_btn["switch_inline_query"] = val

            # 7. 完美对齐的 share 裂变机制
            elif b_type == "share":
                # 智能翻译为 Telegram 官方的 switch_inline_query 核心参数
                # 如果用户没填附加值，默认附带当前卡片 ID
                share_text = val if val else f"card_{card_id}"
                tg_btn["switch_inline_query"] = share_text

            cleaned_row.append(tg_btn)
        
        if cleaned_row:
            cleaned_keyboard.append(cleaned_row)

    return cleaned_keyboard