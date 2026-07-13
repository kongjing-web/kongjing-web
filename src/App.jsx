import React, { useState, useRef, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { Mark, Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Blockquote from '@tiptap/extension-blockquote';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { createLowlight, common } from 'lowlight';
import EmojiPicker from 'emoji-picker-react';

// 🛡️ 干净去重后的所有 Fa 图标集中引入
import { 
  FaLayerGroup, FaEye, FaShare, FaHeart, FaMousePointer, 
  FaChartBar, FaTrashAlt, FaEdit, FaChevronDown,
  FaCoins, FaBell, FaBookOpen, FaHeadset, FaPaperPlane,
  FaArrowLeft, FaUsers, FaClipboardList, FaBullhorn, FaLock,
  FaTelegram, FaCheckCircle, FaRegCircle,
  FaRobot, FaKey, FaCopy, FaExternalLinkAlt, FaArrowRight, FaTimes, FaToggleOn
} from "react-icons/fa";

import { useTranslation, Trans } from 'react-i18next';
import './i18n';

if (typeof window !== 'undefined') {
  // 1. 抓取 URL 中的 bot 参数
  const urlParams = new URLSearchParams(window.location.search);
  const entranceBot = urlParams.get('bot') || urlParams.get('entrance_bot');
  
  // 2. 只要抓到一次，就死死存入缓存，防止后续路由跳转导致 URL 参数丢失
  if (entranceBot) {
    sessionStorage.setItem('kongjing_entrance_bot', entranceBot);
  }

  // 3. 核心黑魔法：劫持全局原生 fetch (完美注入 + 自动无痕翻译响应)
  const originalFetch = window.fetch;
  window.fetch = async function (input, init) {
    let url = typeof input === 'string' ? input : input.url;
    const savedBot = sessionStorage.getItem('kongjing_entrance_bot');

    // 4. 发送时：参数与请求头注入
    if (savedBot && (url.includes('/api/') || url.startsWith('/'))) {
      try {
        const urlObj = new URL(url, window.location.origin);
        if (!urlObj.searchParams.has('entrance_bot')) {
          urlObj.searchParams.set('entrance_bot', savedBot);
        }
        if (typeof input === 'string') {
          input = urlObj.toString();
        } else {
          input = new Request(urlObj.toString(), input);
        }

        init = init || {};
        if (!init.headers) init.headers = {};
        if (init.headers instanceof Headers) {
          init.headers.set('X-Entrance-Bot', savedBot);
        } else if (Array.isArray(init.headers)) {
          init.headers.push(['X-Entrance-Bot', savedBot]);
        } else {
          init.headers['X-Entrance-Bot'] = savedBot;
        }
      } catch (e) {
        console.error("【空境前端网关】URL 或 Headers 解析注入异常:", e);
      }
    }

    // 执行请求拿到真实响应
    const response = await originalFetch(input, init);

    // 5. 🎯【核心大招】：返回给前端前，拦截并自动翻译
    if (url.includes('/api/') || url.startsWith('/')) {
      try {
        // 克隆响应流防止被后续逻辑消费
        const clone = response.clone();
        const data = await clone.json();

        if (data && typeof data === 'object') {
          // 🛡️ 安全的全局翻译器探针，彻底告别 require 引起的运行时崩溃
          const globalT = (key) => {
            // 💡 提示：在你的 i18n.js 初始化完毕后，顺手写一句 window.i18nInstance = i18next 即可无缝对接
            const i18n = window.i18next || window.i18nInstance;
            return (i18n && typeof i18n.t === 'function') ? i18n.t(key) : key;
          };

          let modified = false;
          
          // 翻译常规业务 message
          if (data.message && typeof data.message === 'string') {
            data.message = globalT(data.message);
            modified = true;
          }
          
          // 翻译 FastAPI 特有的 HTTPException detail
          if (data.detail && typeof data.detail === 'string') {
            data.detail = globalT(data.detail);
            modified = true;
          }

          // 如果成功篡改了提示，重包一个全新的 Response 返回给前端业务逻辑（保持原有状态码，通杀 200 和 400/429/500）
          if (modified) {
            return new Response(JSON.stringify(data), {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers
            });
          }
        }
      } catch (err) {
        // 兜底：如果触发了 429 且由于某种原因未能解析为标准 JSON，我们直接手动包装一个带多语言的拦截对象
        if (response.status === 429) {
          const i18n = window.i18next || window.i18nInstance;
          const fallbackMsg = i18n ? i18n.t("Request too frequent. Please do not click repeatedly.") : "Request too frequent. Please do not click repeatedly.";
          return new Response(JSON.stringify({ detail: fallbackMsg, message: fallbackMsg }), {
            status: 429,
            headers: response.headers
          });
        }
      }
    }

    return response;
  };
}

// ==========================================================================
// 后端配置中心
// ==========================================================================
const BASE_URL = "https://www.kongjing.online/api".replace(/\/+$/, ""); // 去除尾部斜杠，避免拼接时出现 //api//user

const getAuthHeaders = (contentType = null) => {
  const headers = {};
  
  // 1. 如果传了特定的 Content-Type 就加上（兼容你原有的旧逻辑）
  if (contentType) {
    headers['Content-Type'] = contentType;
  }

  // 2. 加上 window 安全检查，彻底防止 Vercel 编译打包时因为找不到 window 而崩溃
  const initData = typeof window !== 'undefined' ? window.Telegram?.WebApp?.initData : '';
  if (initData) {
    headers['Authorization'] = `Bearer ${initData}`;
  }

  return headers;
};

// 统计上报（公开接口，无需鉴权）
const trackView = async (cardId) => {
  try {
    await fetch(`${BASE_URL}/cards/${cardId}/track-view`, { method: 'POST' });
  } catch (e) {
    console.warn('trackView failed', e);
  }
};

const trackClick = async (cardId) => {
  try {
    await fetch(`${BASE_URL}/cards/${cardId}/track-click`, { method: 'POST' });
  } catch (e) {
    console.warn('trackClick failed', e);
  }
};

// ==========================================================================
// Tiptap 高级扩展与 1:1 Telegram 视觉样式配置
// ==========================================================================
const lowlight = createLowlight(common);

// 扩展 Blockquote 插件以完美支持 Telegram 原生的 collapsible (可折叠) 属性
const TelegramBlockquote = Blockquote.extend({
  addAttributes() {
    return {
      collapsible: {
        default: false,
        parseHTML: element => element.hasAttribute('collapsible') || element.hasAttribute('expandable'),
        renderHTML: attributes => {
          if (!attributes.collapsible) return {};
          return { expandable: '' };
        },
      },
    };
  },

  // 💡 【核心修复】：显式重写 Tiptap 命令，迫使其强行支持接收并传递属性参数！
  addCommands() {
    return {
      setBlockquote: attributes => ({ commands }) => {
        return commands.wrapIn(this.name, attributes);
      },
      toggleBlockquote: attributes => ({ commands }) => {
        return commands.toggleWrap(this.name, attributes);
      },
    };
  },
});

// 新增 TgEmoji 节点插件以支持 Telegram 自定义表情标签传输
const TgEmoji = Node.create({
  name: 'tgEmoji',
  group: 'inline',
  inline: true,
  selectable: true,
  atom: true,
  addAttributes() {
    return {
      'emoji-id': {
        default: null,
        parseHTML: element => element.getAttribute('emoji-id'),
        renderHTML: attributes => {
          if (!attributes['emoji-id']) return {};
          return { 'emoji-id': attributes['emoji-id'] };
        },
      },
    };
  },
  // 💡 新增这一段：让 editor.getText() 能够把自定义表情精准识别为 2 个字符的长度
  renderText() {
    return '🔥'; 
  },
  parseHTML() {
    return [{ tag: 'tg-emoji' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['tg-emoji', HTMLAttributes, 0];
  },
});

// 在编辑器作用域内强行覆盖 Tailwind 带来的样式擦除，并 1:1 仿真还原 Telegram 经典效果
const editorStyles = `
  .ProseMirror blockquote {
    border-left: 3px solid #0088cc !important; /* 调整为更偏向 TG 官方的经典蓝/琥珀橙边线 */
    background-color: #f4f7f9 !important;
    padding: 0.5rem 1rem !important;
    margin: 0.5rem 0 !important;
    border-radius: 0 8px 8px 0 !important;
    color: #1f2d3d !important;
    position: relative !important;
  }
  .ProseMirror blockquote[collapsible]::after {
    content: "📁 点击可折叠引用" !important;
    position: absolute !important;
    top: 4px !important;
    right: 8px !important;
    font-size: 10px !important;
    background-color: #e2e8f0 !important;
    color: #64748b !important;
    padding: 1px 4px !important;
    border-radius: 4px !important;
  }
  /* 💡【针对问题二修复】1:1 仿真还原 Telegram 原生多行代码块样式 */
  .ProseMirror pre {
    background: #f1f5f9 !important; /* 原生浅灰蓝高质感底色 */
    color: #1e293b !important;       /* 顺滑健康的深色主文本字色 */
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace !important;
    padding: 0.6rem 0.8rem !important;
    border-radius: 6px !important;
    margin: 0.6rem 0 !important;
    overflow-x: auto !important;
    border: 1px solid #e2e8f0 !important; /* 极细轻量边框隔离 */
  }
  .ProseMirror pre code {
    background: none !important;
    color: inherit !important;
    padding: 0 !important;
    border-radius: 0 !important;
    font-size: 0.85rem !important;
  }
  /* 以下保持原有高亮色彩资产 */
  .ProseMirror pre .hljs-comment { color: #6a9955 !important; }
  .ProseMirror pre .hljs-keyword { color: #0000ff !important; }
  .ProseMirror pre .hljs-string { color: #a31515 !important; }
  .ProseMirror pre .hljs-number { color: #098658 !important; }
  .ProseMirror pre .hljs-function { color: #795e26 !important; }
  
  .ProseMirror tg-emoji {
    background-color: rgba(0, 136, 204, 0.1) !important;
    border: 1px dashed #0088cc !important;
    padding: 0 2px !important;
    border-radius: 4px !important;
    display: inline-block !important;
  }
`;

export default function App() {
  // 页面路由状态：'home' | 'editor' | 'preview' | 'analytics' | 'recharge' | 'settings' | 'admin'
  const { t, i18n } = useTranslation();
  const [currentScreen, setCurrentScreen] = useState('home');
  // 当前正在被操作的卡片对象
  const [selectedCard, setSelectedCard] = useState(null);
  // 卡片数据流（初始化为空，从后端动态加载）
  const [cards, setCards] = useState([]);
  // 当前 Telegram 登录用户信息
  const [currentUser, setCurrentUser] = useState(null);
  // 全局加载状态
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refreshingUser, setRefreshingUser] = useState(false);
  const [announcement, setAnnouncement] = useState('');
   // 👈 3. 登录成功时，强制让前端 UI 语言服从后端记录的语言
  useEffect(() => {
  if (currentUser?.language) {
    i18n.changeLanguage(currentUser.language);
  } else {
    i18n.changeLanguage('en'); // 👈 强力修复：如果没有拿到用户语言，先默认切到中文保底！
  }
}, [currentUser, i18n])

  // 👈 4. 手动切换语言的专用处理函数：立刻变前端 UI + 如果登录了就同步给后端
  const handleLanguageSwitch = async (targetLang) => {
    i18n.changeLanguage(targetLang); // 改变前端 UI

    if (currentUser) {
      try {
        await fetch(`${BASE_URL}/user/update_lang`, {
          method: 'POST',
          headers: getAuthHeaders('application/json'),
          body: JSON.stringify({ language: targetLang })
        });
        // 同步更新本地状态，防止发生冲突
        setCurrentUser(prev => prev ? { ...prev, language: targetLang } : null);
      } catch (error) {
        console.error('同步后端语言失败:', error);
      }
    }
  };
  useEffect(() => {
    // A. 判断是否是本地开发调试环境 (支持 localhost 和本地 IP)
    const isLocalhost = 
      window.location.hostname === "localhost" || 
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname.startsWith("192.168."); // 方便手机局域网调试

    // B. 获取 Telegram 环境数据
    const tgInitData = window.Telegram?.WebApp?.initData;

    // C. 拦截逻辑：既没有 TG 环境，又不是本地开发，说明是外网别人乱入，直接弹窗并强制关闭
    if (!tgInitData && !isLocalhost) {
      alert("⚠️ 认证失败：请在 Telegram 手机或电脑客户端内打开此小程序！");
      window.Telegram?.WebApp?.close();
      return; // 这里的退出不会破坏 React 的底层 Hook 顺序了，因为 hooks 已经在上面声明完了
    }

    // D. 如果通过了拦截，打印一下当前环境日志，方便你调试
    if (isLocalhost && !tgInitData) {
      console.log("🛠️ 当前为【本地调试环境】，自动放行并分发 123456789 测试账号。");
    } else {
      console.log("🚀 当前为【Telegram 生产环境】，成功获取 initData，准备与后端安全通信。");
      window.Telegram?.WebApp?.ready();
    }
  }, []); // 确保这段检查只在页面第一次打开时执行一次
  const refreshCurrentUser = async () => {
    if (!currentUser?.id) return;
    setRefreshingUser(true);
    try {
      const response = await fetch(`${BASE_URL}/user/login`, {
        method: 'POST',
        headers: getAuthHeaders('application/json'),
        body: JSON.stringify({}),
      });
      if (!response.ok) return;
      const userInfo = await response.json();
      setCurrentUser(userInfo);
    } catch (err) {
      console.error('刷新用户信息失败:', err);
    } finally {
      setRefreshingUser(false);
    }
  };

  // 2. 强效防御型的数据获取逻辑
  const fetchCards = async () => {
    setLoading(true);
    setError(null);
    try {
        const response = await fetch(`${BASE_URL}/cards`, {
          headers: getAuthHeaders(),
        });
        if (!response.ok) throw new Error('网络响应异常');
        const data = await response.json();

        console.log("后端返回的原始列表数据是:", data); // 打印出来看底细

        // 🚀 终极防御：如果后端返回的是嵌套双重数组 [[...]]，直接帮它脱掉外壳！
        let finalData = data;
        if (Array.isArray(data) && data.length === 1 && Array.isArray(data[0])) {
            finalData = data[0]; // 剥离最外层的 [ ]
        }

        // 强效兼容各种后端格式
        if (Array.isArray(finalData)) {
            setCards(finalData);
        } else if (finalData && Array.isArray(finalData.data)) {
            setCards(finalData.data);
        } else if (finalData && typeof finalData === 'object' && Object.keys(finalData).length > 0) {
            setCards([finalData]);
        } else {
            setCards([]);
        }
    } catch (err) {
        console.error("数据抓取失败原因:", err);
        setError('连接服务中或暂无卡片数据');
    } finally {
        setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    async function initTelegramUser() {
      try {
        let tg = null;
        let telegramUser = null;
        const maxRetries = 30;
        let tries = 0;

        while (tries < maxRetries) {
          const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
          tg = window.Telegram?.WebApp;
          telegramUser = tgUser;
          if (telegramUser?.id) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
          tries += 1;
        }

        if (tg) {
          try {
            tg.ready?.();
          } catch (err) {
            console.warn('Telegram ready() 调用失败', err);
          }
          try {
            tg.expand?.();
          } catch (err) {
            console.warn('Telegram expand() 调用失败', err);
          }
        }

        if (!telegramUser?.id) {
          setCurrentUser({ id: '123456789', username: '浏览器测试用户', role: 'user' });
          return;
        }

        const response = await fetch(`${BASE_URL}/user/login`, {
          method: 'POST',
          headers: getAuthHeaders('application/json'),
          body: JSON.stringify({}),
        });

        if (!response.ok) {
          throw new Error('用户登录失败');
        }

        const userInfo = await response.json();
        if (!cancelled) {
          setCurrentUser(userInfo);
        }
      } catch (err) {
        console.error('Telegram 登录失败:', err);
        if (!cancelled) {
          setCurrentUser({ id: '123456789', username: '浏览器测试用户', role: 'user' });
        }
      }
    }

    initTelegramUser();
    return () => {
      cancelled = true;
    };
  }, []);

  // 拉取全局公告（公开接口，无需身份）
  const fetchAnnouncement = async () => {
    try {
      const resp = await fetch(`${BASE_URL}/announcement`, { headers: getAuthHeaders() });
      if (!resp.ok) return;
      const data = await resp.json();
      setAnnouncement(data.announcement || '');
    } catch (e) {
      console.warn('获取公告失败', e);
    }
  };

  useEffect(() => {
    fetchAnnouncement();
  }, []);

  useEffect(() => {
    if (currentUser?.id) {
      fetchCards();
    }
  }, [currentUser?.id]);

  useEffect(() => {
    if (currentScreen === 'home' && currentUser?.id) {
      refreshCurrentUser();
    }
  }, [currentScreen, currentUser?.id]);

// 3. 完美防御型：卡片保存逻辑（修复版）
  const handleSaveCard = async (cardData) => {
    setLoading(true); // 开启全局 Loading，防止用户在网络慢时重复点击保存
    try {
      const isEditing = !!cardData.id;
      const url = isEditing ? `${BASE_URL}/cards/${cardData.id}` : `${BASE_URL}/cards`;
      
      // 🛠️ 修复问题一：强效过滤纯文本卡片，有图才传 photo，没图坚决为 none
      const hasMedia = !!(cardData.img && cardData.img.trim());
      
      const payload = {
        id: cardData.id ?? selectedCard?.id ?? undefined,
        title: cardData.title ?? '',
        content: cardData.content ?? '',
        img: hasMedia ? cardData.img : '', // 没图就传空字符串，清空后端可能残留的旧图
        media_type: hasMedia ? (cardData.media_type ?? 'photo') : 'none', // 👈 纯文本时强制为 'none'
        buttons: typeof cardData.buttons === 'string' ? cardData.buttons : JSON.stringify(cardData.buttons || [])
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: getAuthHeaders('application/json'),
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        try {
            await response.json();
        } catch (e) {
            console.log("后端返回了非标准JSON（比如'OK'），已自动忽略并继续：", e);
        }

        // 核心：只有真正入库成功，才刷新列表并跳回首页
        await fetchCards();
        setCurrentScreen('home');
        setSelectedCard(null);
      } else {
        throw new Error('服务器拒绝保存');
      }

    } catch (error) {
      console.error("请求失败:", error);
      
      // 🛠️ 修复问题二：斩断危险的本地降级轨，直接弹窗报警
      alert("❌ 保存失败：网络连接异常或服务器超时！请检查网络后重试。");
      
      // 【关键改动】这里不去切换当前页面，不清除选中卡片，让用户留在 EditorScreen 
      // 这样用户的劳动成果（写了一大堆的文本和按钮）不会丢失，网络好了可以重新点“保存”
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full min-h-screen bg-slate-50 text-slate-900 font-sans">
      <style>{editorStyles}</style>
      {loading && (
        <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center text-xs text-white font-medium">
          <div className="bg-slate-800 px-4 py-2 rounded-xl shadow-md">{t('common_loading', '同步中...')}</div>
        </div>
      )}

      {currentScreen === 'home' && (
        <HomeScreen 
          cards={cards} 
          setCards={setCards}
          fetchCards={fetchCards}
          currentUser={currentUser}
          announcement={announcement}
          onNavigateEditor={() => { setSelectedCard(null); setCurrentScreen('editor'); }} 
          onNavigateEditSpecific={(card) => { setSelectedCard(card); setCurrentScreen('editor'); }}
          onNavigatePreview={(card) => { setSelectedCard(card); setCurrentScreen('preview'); }}
          onNavigateAnalytics={(card) => { setSelectedCard(card); setCurrentScreen('analytics'); }}
          onNavigateRecharge={() => { setCurrentScreen('recharge'); setSelectedCard(null); }}
          onNavigateSettings={() => { setCurrentScreen('settings'); setSelectedCard(null); }}
          onNavigateAdmin={() => { setSelectedCard(null); setCurrentScreen('admin'); }}
        />
      )}

      {currentScreen === 'recharge' && (
        <RechargeScreen currentUser={currentUser} onBack={() => setCurrentScreen('home')} onRefreshUser={refreshCurrentUser} />
      )}
      {currentScreen === 'settings' && (
        <SettingsScreen
          currentUser={currentUser}
          onBack={() => setCurrentScreen('home')}
          onSave={(userInfo) => { setCurrentUser(userInfo); setCurrentScreen('home'); }}
        />
      )}
      {currentScreen === 'admin' && (
        <AdminDashboard
          currentUser={currentUser}
          onBack={() => setCurrentScreen('home')}
          onAnnouncementChange={(val) => { setAnnouncement(val); }}
        />
      )}
      
      {currentScreen === 'editor' && (
        <EditorScreen 
          cardToEdit={selectedCard}
          onBack={() => { setSelectedCard(null); setCurrentScreen('home'); }} 
          onPublish={handleSaveCard} 
        />
      )}

      {currentScreen === 'preview' && (
        <PreviewScreen 
          card={selectedCard} 
          onBack={() => { setSelectedCard(null); setCurrentScreen('home'); }} 
        />
      )}

      {currentScreen === 'analytics' && (
        <AnalyticsScreen 
          card={selectedCard} 
          onBack={() => { setSelectedCard(null); setCurrentScreen('home'); }} 
        />
      )}
    </div>
  );
}



function AdminDashboard({ currentUser, onBack, onAnnouncementChange }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('users');
  const [dashboard, setDashboard] = useState({ total_users: 0, total_cards: 0, total_views: 0, total_clicks: 0 });
  const [users, setUsers] = useState([]);
  const [cards, setCards] = useState([]);
  const [announcement, setAnnouncement] = useState('');
  const [userPage, setUserPage] = useState(1);
  const [cardPage, setCardPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fetchDashboard = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${BASE_URL}/admin/dashboard`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        throw new Error('权限不足或网络异常');
      }
      const data = await response.json();
      setDashboard(data);
    } catch (error) {
      console.error('加载管理面板失败:', error);
      alert('无法加载管理面板，请检查管理员权限。');
      onBack();
    } finally {
      setLoading(false);
    }
  };

  const fetchAdminUsers = async (page = 1) => {
    setLoading(true);
    try {
      const response = await fetch(`${BASE_URL}/admin/users?page=${page}&size=20`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        throw new Error('获取用户列表失败');
      }
      const data = await response.json();
      setUsers(Array.isArray(data) ? data : data.data || []);
      setUserPage(page);
    } catch (error) {
      console.error('获取用户失败:', error);
      alert('获取用户列表失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const fetchAdminCards = async (page = 1) => {
    setLoading(true);
    try {
      const response = await fetch(`${BASE_URL}/admin/cards?page=${page}&size=20`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        throw new Error('获取卡片列表失败');
      }
      const data = await response.json();
      setCards(Array.isArray(data) ? data : data.data || []);
      setCardPage(page);
    } catch (error) {
      console.error('获取卡片失败:', error);
      alert('获取卡片列表失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const parseVipValue = (value) => {
    if (typeof value === 'number') return Math.floor(value);
    if (!value) return null;
    const num = Number(value);
    if (!Number.isNaN(num) && String(num).length >= 10) {
      return Math.floor(num);
    }
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return Math.floor(parsed / 1000);
    }
    return null;
  };

  const handleUpdateVip = async (telegram_id) => {
    const raw = window.prompt('请输入新的 VIP 过期时间，支持时间戳或 yyyy-mm-dd hh:mm:ss：', '');
    if (!raw) return;
    const vip_until = parseVipValue(raw);
    if (!vip_until) {
      return alert('输入的 VIP 到期时间格式不正确');
    }

    setSubmitting(true);
    try {
      const response = await fetch(`${BASE_URL}/admin/users/update-vip`, {
        method: 'POST',
        headers: getAuthHeaders('application/json'),
        body: JSON.stringify({ telegram_id, vip_until }),
      });
      if (!response.ok) {
        throw new Error('更新 VIP 失败');
      }
      alert('VIP 到期时间已更新');
      fetchAdminUsers(userPage);
    } catch (error) {
      console.error('更新 VIP 失败:', error);
      alert('更新 VIP 失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleBan = async (telegram_id) => {
    if (!window.confirm('确认要切换该用户的封禁状态吗？')) return;
    setSubmitting(true);
    try {
      const response = await fetch(`${BASE_URL}/admin/users/toggle-ban`, {
        method: 'POST',
        headers: getAuthHeaders('application/json'),
        body: JSON.stringify({ telegram_id }),
      });
      if (!response.ok) {
        throw new Error('封禁切换失败');
      }
      const data = await response.json();
      alert(data.message || '用户状态已更新');
      fetchAdminUsers(userPage);
    } catch (error) {
      console.error('切换封禁失败:', error);
      alert('切换封禁失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleCardStatus = async (card_id) => {
    if (!window.confirm('确认要切换该卡片的审核状态吗？')) return;
    setSubmitting(true);
    try {
      const response = await fetch(`${BASE_URL}/admin/cards/toggle-status`, {
        method: 'POST',
        headers: getAuthHeaders('application/json'),
        body: JSON.stringify({ card_id }),
      });
      if (!response.ok) {
        throw new Error('卡片状态切换失败');
      }
      const data = await response.json();
      alert(data.message || '卡片状态已更新');
      fetchAdminCards(cardPage);
      fetchDashboard();
    } catch (error) {
      console.error('切换卡片状态失败:', error);
      alert('切换卡片状态失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePublishAnnouncement = async () => {
    if (!announcement.trim()) {
      return alert('请输入公告内容');
    }
    setSubmitting(true);
    try {
      const response = await fetch(`${BASE_URL}/admin/announcement`, {
        method: 'POST',
        headers: getAuthHeaders('application/json'),
        body: JSON.stringify({ announcement: announcement.trim() }),
      });
      if (!response.ok) throw new Error('发布公告失败');
      const data = await response.json();
      alert(data.message || '公告已发布');
      setAnnouncement('');
      if (typeof onAnnouncementChange === 'function') onAnnouncementChange(data.announcement || announcement.trim());
    } catch (err) {
      console.error('发布公告失败', err);
      alert('发布公告失败，请检查权限或网络');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClearAnnouncement = async () => {
    if (!window.confirm('确认要清除当前全局公告吗？')) return;
    setSubmitting(true);
    try {
      const response = await fetch(`${BASE_URL}/admin/announcement`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!response.ok) throw new Error('清除公告失败');
      const data = await response.json();
      alert(data.message || '公告已清除');
      if (typeof onAnnouncementChange === 'function') onAnnouncementChange('');
      setAnnouncement('');
    } catch (err) {
      console.error('清除公告失败', err);
      alert('清除公告失败，请检查权限或网络');
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
    if (activeTab === 'users') {
      fetchAdminUsers(userPage);
    } else {
      fetchAdminCards(cardPage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  return (
    <div className="w-full max-w-4xl mx-auto min-h-screen bg-slate-950 text-slate-100 pb-16">
      <div className="sticky top-0 z-40 bg-slate-950/95 border-b border-slate-800 px-4 py-4 backdrop-blur-lg">
        <div className="flex items-center justify-between gap-3">
          <button onClick={onBack} className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-amber-200 hover:bg-slate-800 transition">
            <FaArrowLeft /> 返回主页
          </button>
          <div className="text-center">
            <div className="text-xs uppercase tracking-[0.3em] text-amber-300/80">空境系统</div>
            <div className="text-xl font-bold text-white">全局管理后台</div>
          </div>
          <div className="text-right text-xs text-slate-400">{currentUser?.username || 'Admin'}</div>
        </div>
      </div>

      <div className="px-4 py-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-3xl border border-amber-500/20 bg-slate-900/80 p-4 shadow-lg shadow-amber-500/10">
          <div className="text-sm uppercase tracking-[0.2em] text-amber-300">总用户数</div>
          <div className="mt-4 text-3xl font-bold text-white">{dashboard.total_users ?? 0}</div>
        </div>
        <div className="rounded-3xl border border-slate-700/60 bg-slate-900/70 p-4 shadow-lg shadow-slate-950/20">
          <div className="text-sm uppercase tracking-[0.2em] text-slate-300">总卡片数</div>
          <div className="mt-4 text-3xl font-bold text-white">{dashboard.total_cards ?? 0}</div>
        </div>
        <div className="rounded-3xl border border-slate-700/60 bg-slate-900/70 p-4 shadow-lg shadow-slate-950/20">
          <div className="text-sm uppercase tracking-[0.2em] text-slate-300">总浏览量</div>
          <div className="mt-4 text-3xl font-bold text-white">{dashboard.total_views ?? 0}</div>
        </div>
        <div className="rounded-3xl border border-slate-700/60 bg-slate-900/70 p-4 shadow-lg shadow-slate-950/20">
          <div className="text-sm uppercase tracking-[0.2em] text-slate-300">总点击量</div>
          <div className="mt-4 text-3xl font-bold text-white">{dashboard.total_clicks ?? 0}</div>
        </div>
      </div>

      <div className="px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          {[
            { key: 'users', label: '👥 用户管理', icon: <FaUsers /> },
            { key: 'cards', label: '🃏 内容审计', icon: <FaClipboardList /> },
            { key: 'system', label: '📢 系统配置', icon: <FaBullhorn /> },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${activeTab === tab.key ? 'bg-amber-400 text-slate-950 shadow-lg shadow-amber-400/25' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
            >
              <span className="inline-flex items-center gap-2">{tab.icon}{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pb-8">
        {activeTab === 'users' && (
          <div className="space-y-4">
            <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-4 text-sm text-slate-400">用户管理：展示 telegram_id、用户名、角色、VIP 到期、月剩余额度；支持 VIP 修改与封禁切换。</div>
            <div className="grid gap-3">
              {users.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-700 bg-slate-900/70 p-6 text-center text-slate-500">暂无用户数据</div>
              ) : users.map((user) => {
                const isBanned = user.role === 'banned';
                return (
                  <div key={user.telegram_id} className="rounded-3xl border border-slate-800 bg-slate-900/80 p-4 shadow-inner shadow-slate-950/20">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-2">
                        <div className="text-sm font-semibold text-white">{user.username || '匿名用户'}</div>
                        <div className="text-xs text-slate-400">TG ID: {user.telegram_id}</div>
                        <div className="text-xs text-slate-400">角色: <span className="font-semibold text-amber-300">{user.role}</span></div>
                        <div className="text-xs text-slate-400">VIP 到期: <span className="font-semibold text-white">{user.vip_until && Number(user.vip_until) > Math.floor(Date.now() / 1000) ? new Date(Number(user.vip_until) * 1000).toLocaleString() : '未激活'}</span></div>
                        <div className="text-xs text-slate-400">月发布计数: <span className="font-semibold text-white">{user.monthly_published_count ?? 0}</span></div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => handleUpdateVip(user.telegram_id)} disabled={submitting} className="rounded-2xl bg-amber-400 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-300 transition">修改 VIP</button>
                        <button onClick={() => handleToggleBan(user.telegram_id)} disabled={submitting} className={`rounded-2xl px-3 py-2 text-xs font-semibold transition ${isBanned ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400' : 'bg-rose-500 text-white hover:bg-rose-400'}`}>
                          {isBanned ? '解封用户' : '封禁用户'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
              <button disabled={userPage <= 1 || loading} onClick={() => fetchAdminUsers(userPage - 1)} className="rounded-xl border border-slate-700 px-3 py-2 hover:bg-slate-800 transition">上一页</button>
              <span>第 {userPage} 页</span>
              <button disabled={loading} onClick={() => fetchAdminUsers(userPage + 1)} className="rounded-xl border border-slate-700 px-3 py-2 hover:bg-slate-800 transition">下一页</button>
            </div>
          </div>
        )}

        {activeTab === 'cards' && (
          <div className="space-y-4">
            <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-4 text-sm text-slate-400">内容审计：展示卡片 ID、标题、创建者、状态；支持一键下架 / 恢复。</div>
            <div className="grid gap-3">
              {cards.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-700 bg-slate-900/70 p-6 text-center text-slate-500">暂无卡片记录</div>
              ) : cards.map((card) => {
                const isBanned = card.status === 'banned';
                return (
                  <div key={card.id} className="rounded-3xl border border-slate-800 bg-slate-900/80 p-4 shadow-inner shadow-slate-950/20">
                    <div className="flex gap-4">
                      {card.img ? (
                        <img src={card.img} alt="thumb" className="w-28 h-20 object-cover rounded-xl bg-slate-700" />
                      ) : (
                        <div className="w-28 h-20 bg-slate-800 rounded-xl flex items-center justify-center text-xs text-slate-400">无图片</div>
                      )}
                      <div className="flex-1">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="text-sm font-semibold text-white">{card.title || '未命名卡片'}</div>
                            <div className="text-xs text-slate-400 mt-1 line-clamp-3" dangerouslySetInnerHTML={{ __html: (card.content || '').slice(0, 300) }} />
                            <div className="mt-2 flex items-center gap-2 flex-wrap">
                              {(card.buttons || []).map((b, i) => (
                                <span key={i} className="text-xs px-2 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700">{(b && (b.text || b.label)) || JSON.stringify(b)}</span>
                              ))}
                            </div>
                          </div>
                          <div className="text-right text-xs text-slate-400">
                            <div>ID: {card.id}</div>
                            <div>作者: {card.user_id || '未知'}</div>
                            <div className={`mt-1 font-semibold ${isBanned ? 'text-rose-400' : 'text-emerald-300'}`}>{isBanned ? '已下架' : '正常'}</div>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center justify-between">
                          <div className="text-xs text-slate-400 flex items-center gap-3">
                            <span className="inline-flex items-center gap-1"><FaEye className="text-slate-500" /> {card.views ?? 0}</span>
                            <span className="inline-flex items-center gap-1"><FaMousePointer className="text-slate-500" /> {card.clicks ?? 0}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button onClick={() => handleToggleCardStatus(card.id)} disabled={submitting} className={`rounded-2xl px-3 py-2 text-xs font-semibold transition ${isBanned ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400' : 'bg-rose-500 text-white hover:bg-rose-400'}`}>
                              {isBanned ? '恢复卡片' : '下架卡片'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
              <button disabled={cardPage <= 1 || loading} onClick={() => fetchAdminCards(cardPage - 1)} className="rounded-xl border border-slate-700 px-3 py-2 hover:bg-slate-800 transition">上一页</button>
              <span>第 {cardPage} 页</span>
              <button disabled={loading} onClick={() => fetchAdminCards(cardPage + 1)} className="rounded-xl border border-slate-700 px-3 py-2 hover:bg-slate-800 transition">下一页</button>
            </div>
          </div>
        )}

        {activeTab === 'system' && (
          <div className="space-y-4">
            <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-4 text-sm text-slate-400">系统配置：发布跑马灯公告，通知全网用户。</div>
            <textarea
              value={announcement}
              onChange={(e) => setAnnouncement(e.target.value)}
              rows={6}
              className="w-full rounded-3xl border border-slate-700 bg-slate-900/80 p-4 text-sm text-slate-100 outline-none focus:border-amber-400"
              placeholder="请输入系统跑马灯公告内容..."
            />
            <button onClick={handlePublishAnnouncement} className="inline-flex items-center gap-2 rounded-3xl bg-amber-400 px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-amber-400/20 hover:bg-amber-300 transition">发布公告</button>
            <button onClick={handleClearAnnouncement} disabled={submitting} className="inline-flex items-center gap-2 rounded-3xl bg-red-500 px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-red-600 transition">清除当前公告</button>
          </div>
        )}
      </div>
    </div>
  );
}




/* ==========================================================================
   1. 首页组件 (HomeScreen)
   ========================================================================== */
function HomeScreen({ cards, setCards, fetchCards, currentUser, announcement, onNavigateEditor, onNavigateEditSpecific, onNavigatePreview, onNavigateAnalytics, onNavigateRecharge, onNavigateSettings, onNavigateAdmin }) {
  const { t, i18n } = useTranslation();
  
  const formatCardTime = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp * 1000);
    return new Intl.DateTimeFormat(i18n.language || 'zh', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(date);
  };  

  // 1. 基础状态与引用声明
  const [activeCardId, setActiveCardId] = useState(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const toggleCardActions = (id) => {
    setActiveCardId(activeCardId === id ? null : id);
  };   
  const menuRef = useRef(null);

  const [isBatchMode, setIsBatchMode] = useState(false);
  const [selectedCardIds, setSelectedCardIds] = useState([]);
  const [publishingCardForDirect, setPublishingCardForDirect] = useState(null);
  const [targetChatId, setTargetChatId] = useState('');
  const [directTargets, setDirectTargets] = useState([]);

  // 🛡️ 专属 Bot 状态验证对账网关状态
  const [gateData, setGateData] = useState(null);
  const [isGateLoading, setIsGateLoading] = useState(true);
  const [isPipelineMuted, setIsPipelineMuted] = useState(() => {
    if (typeof window !== 'undefined') {
      // 使用 sessionStorage 记录，用户完全关闭并重新进入小程序时会自动清空
      return sessionStorage.getItem('kongjing_pipeline_muted') === 'true';
    }
    return false;
  });

// ⚡ 统一的弹窗关闭与会话锁定处理器
  const handleMutePipeline = () => {
    setIsPipelineMuted(true);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('kongjing_pipeline_muted', 'true');
    }
  };

  const longPressTimer = useRef(null);
  const isLongPressTriggered = useRef(false);

  // 2. ✨【核心修正：强行提前】先计算好用户身份与权限，消除暂时性死区
  const user = currentUser || null;
  const telegramInitId = typeof window !== 'undefined' ? window.Telegram?.WebApp?.initDataUnsafe?.user?.id : null;
  const resolvedId = (user && (user.telegram_id || user.tg_id)) ? (user.telegram_id || user.tg_id) : (telegramInitId ? telegramInitId : null);
  
  // 🎯 关键变量：必须在 useEffect 之前创建完毕！
  const isAnonymous = (user && user.is_anonymous === true) || !resolvedId;

  const wxUsername = user?.username || t('common_anonymous');
  const isVipUser = user?.role === 'superuser' || user?.role === 'vip' || (user?.vip_until && Number(user.vip_until) > Math.floor(Date.now() / 1000));
  const vipStatus = isVipUser ? t('home_vip_active') : (user ? t('home_user_regular') : t('home_not_logged_in'));
  const displayName = isAnonymous ? t('common_anonymous') : `${t('common_id')}${resolvedId}`;
  const vipTag = !isAnonymous ? (isVipUser ? 'VIP' : t('home_user_regular')) : null;
  const botStatus = isAnonymous ? { text: t('home_waiting_auth'), className: 'text-gray-400' } : (user?.bot_username ? { text: `● ${t('home_bound')}@${user?.bot_username}`, className: 'text-emerald-500' } : { text: `○ ${t('home_not_bound')}`, className: 'text-amber-500' });
  const isAdmin = user?.role === 'admin' || user?.role === 'superuser';

  // 3. 辅助清洗函数
  const cleanBotName = (name) => (name || '').replace('@', '').trim().toLowerCase();

// 4. 🚀 核心听诊机制：此时 isAnonymous 已安全就绪
  useEffect(() => {
    const fetchGateCheck = async () => {
      if (isAnonymous) {
        setIsGateLoading(false);
        return; 
      }
      try {
        const initData = typeof window !== 'undefined' ? window.Telegram?.WebApp?.initData : '';
        const response = await fetch('https://www.kongjing.online/api/user/gate_check', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${initData}`
          }
        });
    
        if (response.ok) {
          const result = await response.json();
          if (result.status === 'success' || result.code === 200) {
            setGateData(result.data);
          }
        }
      } catch (error) {
        console.error("【空境网关】听诊拉取异常:", error);
      } finally {
        setIsGateLoading(false);
      }
    };

    fetchGateCheck();

    if (typeof window !== 'undefined') {
      window.addEventListener('focus', fetchGateCheck);
      return () => window.removeEventListener('focus', fetchGateCheck);
    }
  }, [isAnonymous, currentUser]);

  // ==========================================
  // 📞 客服中心原生无缝唤起网关
  // ==========================================
  const handleContactSupport = () => {
    setShowUserMenu(false); // 关闭下拉菜单

    // 💡 替换提示：把下面的 'Your_Support_Bot' 换成你实际申请的客服机器人 Username（不需要带 @）
    const SUPPORT_BOT_USERNAME = 'kongjing_01_bot'; 
    const targetLink = `https://t.me/${SUPPORT_BOT_USERNAME.replace('@', '')}`;

    if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
      // 🚀 TG 真实环境下，使用 WebApp 原生方法打开，体验极佳，不会弹浏览器
      window.Telegram.WebApp.openTelegramLink(targetLink);
    } else {
      // 🌐 普通浏览器环境降级外跳
      window.open(targetLink, '_blank');
    }
  };

  // ==========================================
  // ⚡ 长按多选核心自研触发器
  // ==========================================
  const handleLongPressStart = (cardId) => {
    isLongPressTriggered.current = false;
    longPressTimer.current = setTimeout(() => {
      isLongPressTriggered.current = true;
      setIsBatchMode(true);
      setSelectedCardIds((prev) => {
        if (prev.includes(cardId)) return prev;
        return [...prev, cardId];
      });
      // 兼容拉起震动
      if (typeof window !== 'undefined' && window.navigator?.vibrate) {
        window.navigator.vibrate(50);
      }
    }, 700); // 700毫秒判定为长按锁定
  };

  const handleLongPressEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
    }
  };

  const handleCardClickGrid = (card) => {
    // 如果长按已经触发，拦截普通的单点展开事件
    if (isLongPressTriggered.current) {
      isLongPressTriggered.current = false;
      return;
    }
    
    if (isBatchMode) {
      // 批量模式：单点变为勾选/反选
      if (selectedCardIds.includes(card.id)) {
        setSelectedCardIds(selectedCardIds.filter(id => id !== card.id));
      } else {
        setSelectedCardIds([...selectedCardIds, card.id]);
      }
    } else {
      // 普通模式：切换底栏展开
      toggleCardActions(card.id);
    }
  };

  // ==========================================
  // 💾 批量物理删除核心网关
  // ==========================================
  const handleBatchDelete = async () => {
    if (selectedCardIds.length === 0) return;
    
    const confirmMsg = t('home_batch_delete_confirm', { count: selectedCardIds.length }) || `确定要删除选中的 ${selectedCardIds.length} 张卡片吗？`;
    if (window.confirm(confirmMsg)) {
      try {
        // 循环调用单点删除，完美兼容老版后端路由架构
        await Promise.all(
          selectedCardIds.map(id =>
            fetch(`${BASE_URL}/cards/${id}`, {
              method: 'DELETE',
              headers: getAuthHeaders(),
            })
          )
        );
        
        // 瞬时前端状态裁剪
        setCards(cards.filter(c => !selectedCardIds.includes(c.id)));
        setSelectedCardIds([]);
        setIsBatchMode(false);
        setActiveCardId(null);
      } catch (error) {
        console.error("批量删除异常:", error);
        alert(t('error_batch_delete_failed') || "删除执行完毕，部分卡片可能由于网络波动未被彻底清除，请刷新重试");
        if (fetchCards) fetchCards();
      }
    }
  };

  // ==========================================
  // 🚀 模式一：Inline Mode (内联分享发布)
  // ==========================================
  const handlePublishInline = async (card) => {
    if (typeof window === 'undefined' || !window.Telegram?.WebApp) {
      alert(t('error_not_in_tg') || '请在 Telegram 真实环境中打开');
      return;
    }
    try {
      const initData = window.Telegram.WebApp.initData;
      const response = await fetch('https://www.kongjing.online/api/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${initData}`
        },
        body: JSON.stringify({ card_id: card.id, publish_mode: 'inline' })
      });
      const result = await response.json();

      if (!response.ok || result.status !== 'success') {
        const errMsg = result.detail || result.message || t('error_inline_activate_failed') || '激活失败';
        window.Telegram.WebApp.showAlert(errMsg);
        return;
      }

      const inlineQueryText = `card_${card.id}`;
      window.Telegram.WebApp.switchInlineQuery(inlineQueryText, ["users", "groups", "channels"]);
    } catch (error) {
      console.error("内联模式发布失败:", error);
      window.Telegram.WebApp.showAlert(t('error_network_exception') || "网络请求异常，请检查后端服务");
    }
  };

// ==========================================
  // 👑 模式二：Direct Message (直发消息投递)
  // ==========================================
  const handlePublishDirectSubmit = async () => {
    // 检查 TG 环境
    const isTgEnv = typeof window !== 'undefined' && window.Telegram?.WebApp;

    if (!targetChatId || !targetChatId.trim()) {
      // 🎯【i18n 修复】
      const inputErrorMsg = t('error_invalid_target_id') || "请输入合法的目标群组用户名、频道 ID 或聊天 ID";
      if (isTgEnv) {
        window.Telegram.WebApp.showAlert(inputErrorMsg);
      } else {
        alert(inputErrorMsg);
      }
      return;
    }

    if (!isTgEnv) {
      // 🎯【i18n 修复】
      alert(t('error_not_in_tg') || '请在 Telegram 真实环境中打开');
      return;
    }

    try {
      const initData = window.Telegram.WebApp.initData;
      const response = await fetch('https://www.kongjing.online/api/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${initData}`
        },
        body: JSON.stringify({ 
          card_id: publishingCardForDirect.id, 
          publish_mode: 'direct',
          chat_id: targetChatId.trim()
        })
      });
      const result = await response.json();

      if (!response.ok || result.status !== 'success') {
              // 1. 提取出后端传回来的干净错误描述（如 "Telegram 拒绝投递: Bad Request: chat not found"）
              const rawErrMsg = result.detail || result.message || 'error_direct_failed';
              
              // 2. 🎯【小布丁核心】：丢进 t() 里面。如果语言包配了这句话，就显示漂亮的中文解释；没配就显示原句 rawErrMsg
              const finalAlertMsg = t(rawErrMsg, rawErrMsg);
              
              window.Telegram.WebApp.showAlert(finalAlertMsg);
              return;
            }

      // 🎯【核心修复】：替换原本的 alert，使用 TG 原生无域名弹窗
      const successMsg = result.message || t('success_direct_published') || '卡片已直接穿透投递到目标渠道！';
      window.Telegram.WebApp.showAlert(successMsg);

      setDirectTargets([]);
      setPublishingCardForDirect(null);
      setTargetChatId('');
      if (fetchCards) fetchCards(); // 刷新卡片状态
    } catch (error) {
      console.error("直接发送失败:", error);
      window.Telegram.WebApp.showAlert(t('error_gateway_failed') || "直发请求失败，请检查网络或后端网关状态");
    }
  };

  // 1. 现有的处理外部点击关闭菜单的副作用
  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 🚀 2. 新增：当直发弹窗打开时（publishingCardForDirect 有值时），无痕拉取该用户直发过的历史渠道列表
  useEffect(() => {
    // 如果直发弹窗关闭了，或者不在 TG 环境，直接拦截不请求
    if (!publishingCardForDirect || typeof window === 'undefined' || !window.Telegram?.WebApp) {
      return;
    }

    const fetchDirectTargets = async () => {
      try {
        const initData = window.Telegram.WebApp.initData;
        const response = await fetch('https://www.kongjing.online/api/publish/targets', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${initData}`
          }
        });
        if (response.ok) {
          const data = await response.json();
          // 将后端返回的常用渠道数组，存入前端状态机（别忘了在页面顶部加一条：const [directTargets, setDirectTargets] = useState([]);）
          setDirectTargets(data.targets || []);
        }
      } catch (error) {
        console.error("拉取直发历史目标失败:", error);
      }
    };

    fetchDirectTargets();
  }, [publishingCardForDirect]);

  // ⚡ 1. 封装一个丝滑的复制 + 跳转处理器
  const handleGoToBotFather = async () => {
    const command = '/setinline';
    
    // 🚀 魔法第一步：利用 WebView 容器能力，静默把指令塞进用户的剪贴板
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(command);
      } catch (err) {
        console.error('剪贴板写入失败', err);
      }
    }

    // 🚀 魔法第二步：使用现代预填链接，能直接填就直接填，不能直接填也有剪贴板兜底
    const fatherUrl = `https://t.me/BotFather?text=${encodeURIComponent(command)}`;
    
    if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
      window.Telegram.WebApp.openTelegramLink(fatherUrl);
    } else {
      window.open(fatherUrl, '_blank');
    }
  };  

  // ==========================================================================
  // 🛡️ 链式状态机流水线拦截处理器 (带全局熔断保护模式)
  // ==========================================================================
  let gateOverlay = null;

  // 1. 动态计算当前应该处于哪一个阶段
  let currentStage = null;
  if (gateData) {
    if (gateData.is_bound === false) {
      currentStage = 'unbound';
    } else if (gateData.is_inline_enabled === false) {
      currentStage = 'inline_disabled';
    } else if (cleanBotName(gateData.current_entrance_bot) !== cleanBotName(gateData.bound_bot_username)) {
      currentStage = 'entrance_mismatch';
    }
  }

  // 2. 核心控制：只有当未加载、数据存在、且管线【未被手动熔断】时才渲染弹窗
  if (!isGateLoading && gateData && !isPipelineMuted && currentStage) {
    
    // 🔥 【一阶弹窗】：尚未绑定传统 Bot
    if (currentStage === 'unbound') {
      gateOverlay = (
        <div className="fixed inset-0 z-[100] bg-slate-950/40 backdrop-blur-[2px] flex items-center justify-center p-4 select-none animate-in fade-in duration-200">
          <div className="w-full max-w-xs bg-white rounded-2xl border border-gray-100 p-5 shadow-2xl relative animate-in zoom-in-95 duration-200">
            {/* 点击 X 关闭：触发熔断 */}
            <button 
              onClick={handleMutePipeline} 
              className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <FaTimes size={14} />
            </button>
            <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center text-amber-500 mb-3">
              <FaRobot size={20} />
            </div>
            <h3 className="text-sm font-black text-gray-950">
              {t('home.gate.unbound.title')}
            </h3>
            <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
              {t('home.gate.unbound.desc')}
            </p >
            {/* 点击行动按钮 */}
            <button 
              onClick={onNavigateSettings} 
              className="w-full mt-4 bg-amber-500 hover:bg-amber-600 active:scale-[0.98] text-white text-xs font-bold py-2.5 px-4 rounded-xl shadow-md shadow-amber-100 transition-all flex items-center justify-center gap-1.5"
            >
              {t('home.gate.unbound.btn')} <FaExternalLinkAlt size={10} />
            </button>
          </div>
        </div>
      );
    }

    // 🔥 【二阶弹窗】：已绑定但未开通 Inline 内联模式
    else if (currentStage === 'inline_disabled') {
      gateOverlay = (
        <div className="fixed inset-0 z-[100] bg-slate-950/40 backdrop-blur-[2px] flex items-center justify-center p-4 select-none animate-in fade-in duration-200">
          <div className="w-full max-w-xs bg-white rounded-2xl border border-gray-100 p-5 shadow-2xl relative animate-in zoom-in-95 duration-200">
            <button 
              onClick={handleMutePipeline} 
              className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <FaTimes size={14} />
            </button>
            <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-500 mb-3">
              <FaToggleOn size={20} />
            </div>
            <h3 className="text-sm font-black text-gray-950">
              {t('home.gate.inline_disabled.title')}
            </h3>
            <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">
              {t('home.gate.inline_disabled.desc')}
            </p >
            
            {/* 💡 引入 Trans 组件处理富文本和变量嵌套 */}
            <div className="mt-3 p-2 bg-slate-50 rounded-xl border border-gray-100 text-[10px] text-gray-500 space-y-1">
              <p className="font-bold text-gray-700">
                {t('home.gate.inline_disabled.guide_title')}
              </p >
              <p>
                <Trans 
                  i18nKey="home.gate.inline_disabled.step1"
                  components={[<span key="0" />, <span className="font-bold text-indigo-600" />]}
                />
              </p >
              <p>
                <Trans 
                  i18nKey="home.gate.inline_disabled.step2"
                  components={[<span key="0" />, <span className="font-mono bg-white px-1 border border-gray-200 rounded" />]}
                />
              </p >
              <p>
                <Trans 
                  i18nKey="home.gate.inline_disabled.step3"
                  values={{ username: gateData.bound_bot_username }}
                  components={[<span key="0" />, <span className="font-mono" />]}
                />
              </p >
            </div>

            <button 
              onClick={handleGoToBotFather} 
              className="w-full mt-4 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white text-xs font-bold py-2.5 px-4 rounded-xl shadow-md shadow-indigo-100 transition-all flex items-center justify-center gap-1.5"
            >
              {t('home.gate.inline_disabled.btn')}
            </button>
          </div>
        </div>
      );
    }

    // 🔥 【三阶弹窗】：防伪入口不匹配拦截
    else if (currentStage === 'entrance_mismatch') {
      gateOverlay = (
        <div className="fixed inset-0 z-[100] bg-slate-950/40 backdrop-blur-[2px] flex items-center justify-center p-4 select-none animate-in fade-in duration-200">
          <div className="w-full max-w-xs bg-white rounded-2xl border border-gray-200 p-6 shadow-2xl text-center relative animate-in zoom-in-95 duration-200">
            <button 
              onClick={handleMutePipeline} 
              className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <FaTimes size={14} />
            </button>
            <div className="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 mx-auto mb-4">
              <FaExternalLinkAlt size={18} />
            </div>
            <h3 className="text-sm font-black text-gray-950">
              {t('home.gate.entrance_mismatch.title')}
            </h3>
            <p className="text-[11px] text-gray-400 mt-2.5 leading-relaxed">
              {t('home.gate.entrance_mismatch.desc')}
            </p >
            
            {/* 动态专属底座展示块 */}
            <div className="my-4 py-1.5 px-3 bg-indigo-50/60 rounded-xl border border-indigo-100/40 inline-block">
              <span className="text-xs font-black text-indigo-950">
                @{gateData.bound_bot_username}
              </span>
            </div>

            <button 
              onClick={() => {
                const targetBotUrl = `https://t.me/${cleanBotName(gateData.bound_bot_username)}`;
                if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
                  window.Telegram.WebApp.openTelegramLink(targetBotUrl);
                } else {
                  window.open(targetBotUrl, '_blank');
                }
              }} 
              className="w-full bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white text-xs font-bold py-2.5 px-4 rounded-xl shadow-lg shadow-indigo-100 transition-all flex items-center justify-center gap-1.5"
            >
              {t('home.gate.entrance_mismatch.btn')}
            </button>
          </div>
        </div>
      );
    }
  }

  // ✨【搭配的精妙对仗横幅】：顶部的精简暗色微提示，用 Trans 完美包裹带有点击动作的文本片段
  let topWarningBanner = null;
  if (gateData && gateData.is_bound && gateData.is_inline_enabled) {
    const entrance = cleanBotName(gateData.current_entrance_bot);
    const bound = cleanBotName(gateData.bound_bot_username);
    if (entrance !== bound) {
      topWarningBanner = (
        <div className="bg-indigo-950 text-indigo-200 text-[10px] px-4 py-2 text-center flex items-center justify-center gap-2 border-b border-indigo-900 select-none animate-in slide-in-from-top duration-300">
          <Trans
            i18nKey="home.gate.banner.text"
            values={{ username: gateData.bound_bot_username }}
            components={[
              <span key="0" />,
              <span 
                key="1"
                onClick={() => {
                  const targetBotUrl = `https://t.me/${bound}`;
                  if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
                    window.Telegram.WebApp.openTelegramLink(targetBotUrl);
                  } else {
                    window.open(targetBotUrl, '_blank');
                  }
                }}
                className="underline font-bold text-white cursor-pointer hover:text-indigo-200 animate-pulse"
              />
            ]}
          />
        </div>
      );
    }
  }

  return (
    <div className="w-full max-w-md mx-auto bg-slate-50 min-h-screen border-x border-gray-200 relative select-none">
      {/* 顶部账号信息头标 */}
      <div className="sticky top-0 w-full bg-white border-b border-gray-100 px-4 py-3 z-40 shadow-sm flex items-center justify-between">
        <div className="relative" ref={menuRef}>
          <div 
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded-xl transition-colors select-none"
          >
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow-md shadow-blue-100">
              {wxUsername.charAt(0)}
            </div>
            <div className="flex flex-col items-start">
              <span className="text-xs font-bold text-gray-800 flex items-center gap-2">
                <span className="truncate max-w-[140px]">{displayName}</span>
                {vipTag && (
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${user?.is_vip ? 'bg-amber-400 text-white' : 'bg-gray-200 text-gray-700'}`}>{vipTag}</span>
                )}
                <FaChevronDown size={8} className={`text-gray-400 transition-transform ${showUserMenu ? 'rotate-180' : ''}`} />
              </span>
              <span className={`text-[11px] font-medium ${botStatus.className}`}>{botStatus.text}</span>
            </div>
          </div>

          {showUserMenu && (
            <div className="absolute left-0 mt-2 w-44 bg-white rounded-2xl shadow-xl border border-gray-100 p-1.5 z-50">
              <button onClick={() => { onNavigateRecharge(); setShowUserMenu(false); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-semibold text-gray-700 hover:bg-slate-50 rounded-xl transition-colors">
                <FaCoins className="text-amber-500" /> {t('home_recharge')}
              </button>
              <button onClick={() => { alert(t('home_not_open')); setShowUserMenu(false); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-semibold text-gray-700 hover:bg-slate-50 rounded-xl transition-colors">
                <FaBell className="text-blue-500" /> {t('home_messages')}
              </button>
              <button onClick={() => { alert(t('home_doc_tip')); setShowUserMenu(false); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-semibold text-gray-700 hover:bg-slate-50 rounded-xl transition-colors">
                <FaBookOpen className="text-purple-500" /> {t('home_instructions')}
              </button>
              <button onClick={() => { onNavigateSettings(); setShowUserMenu(false); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-semibold text-gray-700 hover:bg-slate-50 rounded-xl transition-colors">
                <FaLayerGroup className="text-indigo-500" /> {t('home_settings')}
              </button>
              <div className="h-px bg-gray-100 my-1 mx-2"></div>
              <button 
                onClick={handleContactSupport} // 👈 完美接入刚刚写好的跳转网关
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-semibold text-gray-700 hover:bg-slate-50 rounded-xl transition-colors"
              >
                <FaHeadset className="text-emerald-500" /> {t('home_support')}
              </button>
            </div>
          )}
        </div>
        <div className="text-right"><span className="text-[10px] bg-slate-100 font-bold text-slate-500 px-2 py-1 rounded-md">{t('home_console_v')}</span></div>
      </div>

      {announcement && (
        <div className="mx-4 mt-3 rounded-2xl border border-amber-300/30 bg-gradient-to-r from-amber-100/80 to-amber-50 p-3 text-sm text-amber-900 flex items-start gap-3">
          <FaBell className="text-amber-700 mt-1" />
          <div className="flex-1">
            <div className="font-bold">{t('home_announcement')}</div>
            <div className="text-xs mt-1">{announcement}</div>
          </div>
        </div>
      )}

      {isAdmin && (
        <div className="mx-4 mt-4 rounded-3xl border border-amber-400/40 bg-gradient-to-r from-amber-100/80 via-yellow-50 to-slate-50 p-4 shadow-lg shadow-amber-200/30">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-700">{t('home_admin_panel')}</p>
              <p className="mt-1 text-sm font-bold text-slate-900">{t('home_admin_panel_open')}</p>
            </div>
            <button onClick={onNavigateAdmin} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2 text-xs font-bold uppercase tracking-[0.15em] text-amber-200 hover:bg-slate-800 transition">
              <FaLock size={14} /> {t('home_enter_admin')}
            </button>
          </div>
        </div>
      )}

      <div className="p-4 pb-24">
        <p className="text-[11px] text-gray-400 mt-2 mb-3 font-bold uppercase tracking-widest">{t('home_select_type')}</p>
        <div className="flex flex-col gap-3 cursor-pointer" onClick={onNavigateEditor}>
          <div className="flex items-center p-4 bg-white border-2 border-blue-500 rounded-2xl gap-4 shadow-sm active:scale-[0.99] transition-all">
            <div className="bg-blue-600 p-3 rounded-xl text-white shadow-md"><FaLayerGroup size={20} /></div>
            <div>
              <p className="font-bold text-sm">{t('home_native_mode')}</p>
              <p className="text-xs text-gray-400">{t('home_native_mode_desc')}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between mt-8 mb-4">
          <h2 className="font-bold text-gray-800 text-lg">{t('home_my_cards')}</h2>
          <span className="text-xs text-gray-400 font-bold px-2 py-1 bg-gray-100 rounded-lg">{t('home_total_prefix')}{cards.length}</span>
        </div>

        {cards.length === 0 ? (
          <div className="text-center py-12 text-xs text-gray-400">{t('home_no_data')}</div>
        ) : (
          <div className="flex flex-col gap-3">
            {cards.map((card) => {
              const isExpanded = activeCardId === card.id;
              const isSelected = selectedCardIds.includes(card.id);
              return (
                <div 
                  key={card.id} 
                  className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-all duration-200 ${
                    isBatchMode && isSelected ? 'border-blue-500 bg-blue-50/20 shadow-md' : 'border-gray-100'
                  }`}
                >
                  {/* 核心改动：加入长按管理系统、多端防御误触、勾选指示器 */}
                  <div 
                    className="flex items-center gap-1.5 p-3 cursor-pointer active:bg-gray-50/80 transition-colors select-none"
                    onClick={() => handleCardClickGrid(card)}
                    onTouchStart={() => handleLongPressStart(card.id)}
                    onTouchEnd={handleLongPressEnd}
                    onMouseDown={() => handleLongPressStart(card.id)}
                    onMouseUp={handleLongPressEnd}
                    onMouseLeave={handleLongPressEnd}
                  >
                    {/* 批量选中的复选框标记灯 */}
                    {isBatchMode && (
                      <div className="pr-1 transition-all duration-200 animate-in fade-in zoom-in-75 shrink-0">
                        {isSelected ? (
                          <FaCheckCircle className="text-blue-600 scale-110" size={18} />
                        ) : (
                          <FaRegCircle className="text-gray-300" size={18} />
                        )}
                      </div>
                    )}

                    <div className="flex flex-1 gap-4 items-center overflow-hidden">
                      {/* 🎬 视频/图片缩略图完美兼容区 */}
                      {/* 👇 核心改动：如果 media_type 是 text 或者压根没有图片链接，直接不渲染整个缩略图 DOM */}
                      {card.media_type !== 'text' && card.img && (
                        card.media_type === 'video' ? (
                          <div className="w-20 h-20 rounded-xl shrink-0 bg-zinc-950 relative overflow-hidden border border-gray-100">
                            <video src={`${card.img}#t=0.001`} className="w-full h-full object-cover opacity-80" preload="metadata" muted playsInline />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/10">
                              <svg className="w-4 h-4 text-white/90 fill-current" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z"/>
                              </svg>
                            </div>
                          </div>
                        ) : card.media_type === 'gif' ? (
                          < img src={card.img} className="w-20 h-20 object-cover rounded-xl shrink-0 bg-slate-100" alt="" />
                        ) : (
                          /* 这里的 else 就纯粹只处理普通的 photo（图片）类型，不用再怕空数据了 */
                          < img src={card.img} className="w-20 h-20 object-cover rounded-xl shrink-0 bg-slate-100" alt="" />
                        )
                      )}

                      {/* 📝 右侧文字与状态指标区 */}
                      <div className="flex-1 flex flex-col justify-between py-1 h-20 overflow-hidden">
                        <p className="font-bold text-sm text-gray-800 line-clamp-2 leading-snug">
                          {card.title || t('admin_unnamed_card')}
                        </p>
                        
                        <div className="flex items-center justify-between mt-auto">
                          <span className="text-[10px] text-gray-400 font-medium flex items-center gap-1">
                            <FaEye /> {card.analytics?.views || 0}
                          </span>
                          
                          <div className="flex items-center gap-2">
                            {card.updated_at && (
                              <span className="text-[10px] text-gray-400 font-mono tracking-tighter">
                                {formatCardTime(card.updated_at)}
                              </span>
                            )}
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${card.status === 'published' ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600'}`}>
                              {t(`status.${card.status}`)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 展开的操作面板（批量操作激活时强行隐藏，绝不出格错位） */}
                  <div className={`flex border-t border-gray-50 bg-slate-50/50 transition-all duration-200 ${isExpanded && !isBatchMode ? 'h-11 opacity-100' : 'h-0 opacity-0 overflow-hidden pointer-events-none'}`}>
                    <button onClick={() => onNavigatePreview(card)} className="flex-1 text-center text-[11px] font-bold text-gray-600 flex items-center justify-center gap-1 border-r border-gray-100 hover:bg-gray-100/50 active:text-blue-500">
                      <FaEye size={11} className="text-gray-400" /> {t('common_preview')}
                    </button>
            
                    {/* ⭐ 原生发布按键一：符合官方用词的 Inline Mode 内联模式 */}
                    <button onClick={() => handlePublishInline(card)} className="flex-1 text-center text-[11px] font-bold text-blue-600 flex items-center justify-center gap-1 border-r border-gray-100 hover:bg-blue-50/50 active:scale-95 transition-all">
                      <FaPaperPlane size={10} className="text-blue-400" /> {t('home_publish_inline')}
                    </button>

                    {/* ⭐ 原生发布按键二：接替原本删除仓位的 Direct Message 后端无痕直发 */}
                    <button onClick={() => setPublishingCardForDirect(card)} className="flex-1 text-center text-[11px] font-bold text-emerald-600 flex items-center justify-center gap-1 border-r border-gray-100 hover:bg-emerald-50/50 active:scale-95 transition-all">
                      <FaTelegram size={11} className="text-emerald-400" /> {t('home_publish_direct')}
                    </button>

                    <button onClick={() => onNavigateAnalytics(card)} className="flex-1 text-center text-[11px] font-bold text-gray-600 flex items-center justify-center gap-1 border-r border-gray-100 hover:bg-gray-100/50 active:text-blue-500">
                      <FaChartBar size={11} className="text-gray-400" /> {t('common_data')}
                    </button>
                    <button onClick={() => onNavigateEditSpecific(card)} className="flex-1 text-center text-[11px] font-bold text-gray-600 flex items-center justify-center gap-1 hover:bg-gray-100/50 active:text-blue-500">
                      <FaEdit size={11} className="text-gray-400" /> {t('common_edit')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ==========================================
          👑 工业级暗金/深黑极简：批量管理悬浮底栏
      ========================================== */}
      {isBatchMode && (
        <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-slate-900 text-white border-t border-slate-800 px-4 py-3.5 flex items-center justify-between z-50 animate-in slide-in-from-bottom duration-200 rounded-t-2xl shadow-2xl">
          <div className="flex items-center gap-2">
            <span className="text-xs bg-blue-600 text-white font-black px-2.5 py-0.5 rounded-full transition-all">
              {selectedCardIds.length}
            </span>
            <span className="text-xs font-bold text-slate-300">{t('home_selected_count')}</span>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => {
                if (selectedCardIds.length === cards.length) {
                  setSelectedCardIds([]);
                } else {
                  setSelectedCardIds(cards.map(c => c.id));
                }
              }}
              className="text-xs px-3 py-1.5 font-bold text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-xl active:scale-95 transition-all"
            >
              {selectedCardIds.length === cards.length ? t('home_deselect_all') : t('home_select_all')}
            </button>
            <button 
              onClick={() => {
                setIsBatchMode(false);
                setSelectedCardIds([]);
              }}
              className="text-xs px-3 py-1.5 font-bold text-slate-400 hover:text-white transition-colors"
            >
              {t('common_cancel')}
            </button>
            <button 
              onClick={handleBatchDelete}
              disabled={selectedCardIds.length === 0}
              className="text-xs px-4 py-1.5 font-black bg-red-600 hover:bg-red-700 disabled:bg-red-950/50 disabled:text-red-400/60 rounded-xl shadow-lg shadow-red-900/20 active:scale-95 transition-all flex items-center gap-1"
            >
              <FaTrashAlt size={10} /> {t('common_delete')}
            </button>
          </div>
        </div>
      )}

{/* ==========================================
          💎 精致指纹高仿真级：直发配置渠道弹窗
      ========================================== */}
      {publishingCardForDirect && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl w-full max-w-xs p-5 shadow-2xl border border-gray-100 animate-in zoom-in-95 duration-200">
            <h3 className="text-sm font-black text-gray-900 flex items-center gap-2">
              <FaTelegram className="text-emerald-500" size={16} />
              {t('home_direct_publish_title')}
            </h3>
            <p className="text-[11px] text-gray-400 mt-1 leading-normal">
              {t('home_direct_publish_desc')}
            </p >
            
            <div className="mt-4">
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1.5">
                {t('home_target_chat_id')}
              </label>
              <input 
                type="text"
                value={targetChatId}
                onChange={(e) => setTargetChatId(e.target.value)}
                placeholder="@my_channel / -100xxxxxx"
                className="w-full bg-slate-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono text-slate-800 outline-none focus:border-emerald-500 focus:bg-white transition-all"
              />
            </div>

            {/* 🚀 核心新增：快捷历史渠道选择网关 */}
            {directTargets.length > 0 && (
              <div className="mt-3">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                  {t('home_history_channels')}
                </label>
                {/* 限制最大高度，超出自动产生平滑滚动条，防止目标过多撑破弹窗 */}
                <div className="flex flex-col gap-1.5 max-h-28 overflow-y-auto pr-1">
                  {directTargets.map((target) => (
                    <button
                      key={target.chat_id}
                      type="button"
                      onClick={() => setTargetChatId(String(target.chat_id))}
                      className={`w-full flex items-center justify-between text-left text-[11px] px-2.5 py-1.5 rounded-xl border transition-all ${
                        String(targetChatId) === String(target.chat_id) 
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700 font-bold' 
                          : 'border-gray-100 bg-slate-50 text-gray-700 hover:bg-slate-100 hover:border-gray-200'
                      }`}
                    >
                      <span className="truncate max-w-[120px] font-medium">
                        {target.chat_title || t('home_unnamed_channel')}
                      </span>
                      <span className="text-[9px] font-mono opacity-60">
                        {String(target.chat_id).startsWith('-100') ? t('home_channel_group') : t('home_channel_private')}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-5 flex gap-2.5">
              <button 
                onClick={() => {
                  setPublishingCardForDirect(null);
                  setTargetChatId('');
                  setDirectTargets([]); // 🚀 核心改动：点击取消时，清空历史列表状态，保证下次打开重新拉取最新数据
                }}
                className="flex-1 border border-gray-200 text-gray-500 text-xs font-bold py-2.5 rounded-xl hover:bg-slate-50 transition-colors"
              >
                {t('common_cancel')}
              </button>
              <button 
                onClick={handlePublishDirectSubmit}
                className="flex-1 bg-emerald-600 text-white text-xs font-black py-2.5 rounded-xl shadow-md shadow-emerald-100 hover:bg-emerald-700 active:scale-98 transition-all"
              >
                {t('common_confirm') || '确认直发'}
              </button>
            </div>
          </div>
        </div>
      )}
      {gateOverlay}

    </div>
  );
}

function RechargeScreen({ currentUser, onBack, onRefreshUser }) {
  const { t } = useTranslation();
  
  // 🎯 核心升级 1：初始化默认套餐列表，进行安全降级兜底
  const [packages, setPackages] = useState([
    { package_id: "week", name: "周套餐", price_usd: 2.0, price_stars: 143, duration_days: 7 },
    { package_id: "month", name: "月套餐", price_usd: 7.0, price_stars: 500, duration_days: 30 },
    { package_id: "quarter", name: "季套餐", price_usd: 18.0, price_stars: 1200, duration_days: 90 }
  ]);
  const [selectedPackageId, setSelectedPackageId] = useState("week"); // 默认选中周卡
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // 优先从 TG 容器获取当前用户的真实 Telegram 唯一 ID
  const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
  const userId = tgUser?.id || currentUser?.id || currentUser?.telegram_id;

  // 🎯 核心升级 2：自动去后端拉取最新套餐组合与价格调控
  useEffect(() => {
    async function fetchPrices() {
      try {
        const res = await fetch(`${BASE_URL}/payment/prices`, {
          headers: getAuthHeaders(),
        });
        if (res.ok) {
          const data = await res.json();
          // 如果后端完美返回了多套餐数组，直接更新状态
          if (data.packages && data.packages.length > 0) {
            setPackages(data.packages);
          } else if (data.prices) {
            // 优雅降级：如果老接口只返回了 prices 单一字段，自动包成标准周卡
            setPackages([
              { package_id: "week", name: "标准套餐", price_usd: data.prices.usd || 2.0, price_stars: data.prices.tg_stars || 143, duration_days: 7 }
            ]);
          }
        }
      } catch (err) {
        console.error("拉取后台控制定价失败，降级使用标准预设价格", err);
      }
    }
    fetchPrices();
  }, []);

  // 🎯 核心联动：动态切算出当前用户选中的那款套餐数据
  const currentPkg = packages.find(p => p.package_id === selectedPackageId) || packages[0];

  // 通道一：Crypto Bot（USDT）支付网关触发器
  const handleCryptoPay = async () => {
    if (!userId) {
      alert(t('auth_fail'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${BASE_URL}/vip/create_invoice`, {
        method: 'POST',
        headers: getAuthHeaders('application/json'),
        // 🚀 同步压入 package_id 传给后端
        body: JSON.stringify({ 
          telegram_id: String(userId),
          package_id: selectedPackageId 
        })
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || '创建 Crypto 发票失败');
      }
      
      const data = await response.json();
      const openUrl = data.pay_url || data.url || data.payment_url; 
      
      if (openUrl) {
        if (window.Telegram?.WebApp?.openTelegramLink) {
          window.Telegram.WebApp.openTelegramLink(openUrl);
        } else {
          window.open(openUrl, '_blank');
        }
        triggerPolling();
      }
    } catch (err) {
      alert(err.message || t('common_failed'));
    } finally {
      setLoading(false);
    }
  };

  // 通道二：官方 Stars 原生高安全级收银台
  const handleStarsPay = async () => {
    if (!userId) {
      alert(t('auth_fail'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${BASE_URL}/payment/create_stars_invoice`, {
        method: 'POST',
        headers: getAuthHeaders('application/json'),
        // 🚀 核心对齐：把选中的套餐 ID 安全发送给严防死守版后台接口
        body: JSON.stringify({ 
          telegram_id: String(userId),
          package_id: selectedPackageId 
        })
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || '创建官方发票失败');
      }
      
      const data = await response.json();
      if (data.status === 'success' && data.pay_url) {
        window.Telegram?.WebApp?.openInvoice(data.pay_url, function(status) {
          if (status === 'paid') {
            alert(t('recharge_stars_success'));
            if (onRefreshUser) onRefreshUser();
            onBack();
          } else if (status === 'cancelled') {
            alert(t('recharge_pay_cancelled'));
          } else {
            alert(t('common_failed'));
          }
        });
      }
    } catch (err) {
      alert(err.message || t('common_failed'));
    } finally {
      setLoading(false);
    }
  };

  // 轮询复用逻辑
  const triggerPolling = () => {
    if (onRefreshUser) {
      let attempts = 0;
      const intervalId = setInterval(async () => {
        attempts += 1;
        await onRefreshUser();
        if (attempts >= 15) clearInterval(intervalId);
      }, 5000);
    }
  };

  return (
    <div className="w-full min-h-screen bg-slate-50 text-slate-900 font-sans">
      <div className="sticky top-0 w-full bg-white border-b border-gray-100 px-4 py-3 z-40 shadow-sm flex items-center justify-between">
        <button onClick={onBack} className="text-sm font-bold text-gray-700">← {t('common_back')}</button>
        <span className="text-sm font-bold text-gray-800">{t('recharge_title')}</span>
        <div className="w-8" />
      </div>
      <div className="p-4 space-y-4">
        <div className="bg-white rounded-3xl border border-gray-200 p-5 shadow-sm">
          <h2 className="text-lg font-bold text-gray-900">{t('recharge_vip_perks')}</h2>
          <p className="mt-3 text-sm text-gray-500 leading-6">{t('recharge_perks_desc')}</p >
          <ul className="mt-4 space-y-3 text-sm text-gray-600">
            <li>{t('recharge_perk_1')}</li>
            <li>{t('recharge_perk_2')}</li>
            <li>{t('recharge_perk_3')}</li>
          </ul>
          {currentUser && (
            <div className="mt-4 rounded-2xl bg-slate-50 border border-slate-200 p-3 text-sm text-slate-700">
              {t('recharge_current_user')}{currentUser.username || currentUser.telegram_id} / {currentUser.role === 'vip' ? `👑 ${t('home_vip_active')}` : t('home_user_regular')}
            </div>
          )}
          
          {error && <div className="mt-4 text-sm text-red-500">{error}</div>}

          {/* 🚀 核心新增：精心定制的极简下拉套餐选择盒（Zen / 工业黑金质感） */}
          <div className="mt-6 mb-4">
            <label className="block text-xs font-semibold text-slate-400 mb-2 tracking-wider uppercase">
              {t('recharge_select_package')}
            </label>
            <div className="relative">
              <select
                value={selectedPackageId}
                onChange={(e) => setSelectedPackageId(e.target.value)}
                className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3.5 text-sm font-medium text-gray-800 outline-none focus:border-blue-500 appearance-none shadow-sm transition-all duration-200"
                style={{
                  backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 16px center',
                  backgroundSize: '16px'
                }}
              >
                {packages.map((pkg) => (
                  <option key={pkg.package_id} value={pkg.package_id}>
                    {t(`package_${pkg.package_id}`)} ({pkg.duration_days} {t('recharge_days')})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 通道一：Crypto 支付按钮（联动已选套餐价格） */}
          <button
            onClick={handleCryptoPay}
            disabled={loading}
            className="mt-4 w-full rounded-2xl bg-blue-600 px-4 py-3.5 text-sm font-bold text-white shadow-md hover:bg-blue-700 disabled:bg-blue-300 flex justify-between items-center transition-all duration-200"
          >
            <span>{loading ? t('recharge_processing') : t('recharge_pay_crypto')}</span>
            <span className="bg-blue-700 px-2.5 py-0.5 rounded-lg text-xs font-black">{currentPkg.price_usd} USDT</span>
          </button>

          {/* 通道二：官方 Stars 支付按钮（联动已选套餐价格） */}
          <button
            onClick={handleStarsPay}
            disabled={loading}
            className="mt-3 w-full rounded-2xl bg-amber-500 px-4 py-3.5 text-sm font-bold text-white shadow-md hover:bg-amber-600 disabled:bg-amber-300 flex justify-between items-center transition-all duration-200"
          >
            <span>{loading ? t('recharge_activating') : t('recharge_pay_stars')}</span>
            <span className="bg-amber-600 px-2.5 py-0.5 rounded-lg text-xs font-black">⭐ {currentPkg.price_stars}</span>
          </button>
          
          <div className="pt-3 text-[10px] text-gray-400 text-center leading-normal">
            {t('recharge_tax_tip')}
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsScreen({ currentUser, onBack, onSave }) {
  const { t, i18n } = useTranslation();
  const [localGate, setLocalGate] = useState(null);

  useEffect(() => {
    const checkLocalGate = async () => {
      try {
        const initData = typeof window !== 'undefined' ? window.Telegram?.WebApp?.initData : '';
        const response = await fetch('https://www.kongjing.online/api/user/gate_check', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${initData}`
          }
        });
        if (response.ok) {
          const result = await response.json();
          if (result.status === 'success' || result.code === 200) {
            setLocalGate(result.data);
          }
        }
      } catch (err) {
        console.error("设置页获取网关失败:", err);
      }
    };
    checkLocalGate();
  }, []);  

  const [botToken, setBotToken] = useState(currentUser?.bot_token || '');
  const [language, setLanguage] = useState(currentUser?.language || 'en'); 
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const handleSave = async () => {
      if (!currentUser?.id) {
        alert('请先完成 Telegram 登录');
        return;
      }
      setSaving(true);
      setMessage(null);
      
      try {
        // ===== 事务一：首先同步多语言设置 =====
        const langResponse = await fetch(`${BASE_URL}/user/update_settings`, {
          method: 'POST',
          headers: getAuthHeaders('application/json'),
          body: JSON.stringify({
            user_id: currentUser.id,
            language
          }),
        });
        
        if (!langResponse.ok) {
          throw new Error('通用基础设置同步失败');
        }
        
        i18n.changeLanguage(language);

        let updatedUserResult = {
          ...currentUser,
          language
        };

        // ===== 事务二：智能判断并联调核心一键 Bot 托管绑定接口 =====
        if (botToken.trim()) {
          const bindResponse = await fetch(`${BASE_URL}/bot/bind`, {
            method: 'POST',
            headers: getAuthHeaders('application/json'),
            body: JSON.stringify({
              bot_token: botToken.trim()
            }),
          });

          const bindData = await bindResponse.json().catch(() => ({}));

          if (!bindResponse.ok) {
            throw new Error(bindData.detail || '专属 Bot 托管下发失败，请核对 Token');
          }

          updatedUserResult.bot_token = botToken.trim();
          updatedUserResult.bot_username = bindData.bot_username;
          
        } else if (currentUser?.bot_token && !botToken.trim()) {
          const unbindResponse = await fetch(`${BASE_URL}/user/update_settings`, {
            method: 'POST',
            headers: getAuthHeaders('application/json'),
            body: JSON.stringify({ user_id: currentUser.id, bot_token: "", language }),
          });
          if (unbindResponse.ok) {
            const unbindData = await unbindResponse.json();
            updatedUserResult = unbindData;
          }
        } else {
          const langData = await langResponse.json().catch(() => ({}));
          if (langData.telegram_id) updatedUserResult = langData;
        }

        // ===== 事务三：成功闭环与上层状态回传 =====
        setMessage(t('common_success'));
        
        if (onSave) {
          onSave(updatedUserResult);
        }
        
      } catch (err) {
        console.error('配置中心更新事务故障:', err);
        setMessage(err.message || t('common_failed'));
      } finally {
        setSaving(false);
      }
    };

  return (
    <div className="w-full min-h-screen bg-slate-50 text-slate-900 font-sans">
      <div className="sticky top-0 w-full bg-white border-b border-gray-100 px-4 py-3 z-40 shadow-sm flex items-center justify-between">
        <button onClick={onBack} className="text-sm font-bold text-gray-700">← {t('common_back')}</button>
        <span className="text-sm font-bold text-gray-800">{t('settings_title')}</span>
        <div className="w-8" />
      </div>
      <div className="p-4 space-y-4">
        <div className="bg-white rounded-3xl border border-gray-200 p-5 shadow-sm">
          <h2 className="text-lg font-bold text-gray-900">{t('settings_account_settings')}</h2>
          <p className="mt-2 text-sm text-gray-500">{(t('settings_settings_desc'))}</p >

          <div className="mt-6 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-2">{t('settings_bot_token_label')}</label>
              <input
                type="text"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-400"
                placeholder={t('settings_bot_token_placeholder')}
              />
              {currentUser?.bot_username && (
                <p className="mt-2 text-xs text-slate-500">{t('settings_current_bot')}{currentUser.bot_username}</p >
              )}
            </div>

            {localGate && localGate.is_bound === true && localGate.is_inline_enabled === false && (
              <div className="mt-4 rounded-3xl bg-indigo-50/30 border border-indigo-100 p-5 animate-in fade-in duration-300">
                {/* 顶部的图标保持与弹窗一致 */}
                <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-500 mb-3">
                  <FaToggleOn size={20} />
                </div>
                
                {/* 直接复用首页二阶段弹窗的标题与描述 Key */}
                <h3 className="text-sm font-black text-gray-950">
                  {t('home.gate.inline_disabled.title')}
                </h3>
                <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">
                  {t('home.gate.inline_disabled.desc')}
                </p >
                
                {/* 引导步骤区：注意这里的 username 变量要换成当前组件的 localGate */}
                <div className="mt-3 p-2 bg-white rounded-xl border border-gray-100 text-[10px] text-gray-500 space-y-1">
                  <p className="font-bold text-gray-700">
                    {t('home.gate.inline_disabled.guide_title')}
                  </p >
                  <p>
                    <Trans 
                      i18nKey="home.gate.inline_disabled.step1"
                      components={[<span key="0" />, <span className="font-bold text-indigo-600" />]}
                    />
                  </p >
                  <p>
                    <Trans 
                      i18nKey="home.gate.inline_disabled.step2"
                      components={[<span key="0" />, <span className="font-mono bg-slate-50 px-1 border border-gray-200 rounded" />]}
                    />
                  </p >
                  <p>
                    <Trans 
                      i18nKey="home.gate.inline_disabled.step3"
                      values={{ username: localGate.bound_bot_username }}
                      components={[<span key="0" />, <span className="font-mono" />]}
                    />
                  </p >
                </div>

                {/* 动作按钮：平移了首页的自动复制逻辑，体验更丝滑 */}
                <button 
                  onClick={async () => {
                    const command = '/setinline';
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                      try {
                        await navigator.clipboard.writeText(command);
                      } catch (err) {
                        console.error('剪贴板写入失败', err);
                      }
                    }
                    const fatherUrl = `https://t.me/BotFather?text=${encodeURIComponent(command)}`;
                    if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
                      window.Telegram.WebApp.openTelegramLink(fatherUrl);
                    } else {
                      window.open(fatherUrl, '_blank');
                    }
                  }} 
                  className="w-full mt-4 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white text-xs font-bold py-2.5 px-4 rounded-xl shadow-md shadow-indigo-100 transition-all flex items-center justify-center gap-1.5"
                >
                  {t('home.gate.inline_disabled.btn')}
                </button>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-2">{t('settings_lang_label')}</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-400"
              >
                <option value="zh">{t('settings_zh')}</option>
                <option value="en">{t('settings_en')}</option>
              </select>
            </div>
          </div>

          {message && <div className="mt-4 rounded-2xl bg-slate-50 border border-slate-200 p-3 text-sm text-slate-700">{message}</div>}

          <button
            onClick={handleSave}
            disabled={saving}
            className="mt-6 w-full rounded-2xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-md hover:bg-blue-700 disabled:bg-blue-300"
          >
            {saving ? t('settings_saving') : t('settings_save_btn')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   2. 原生卡片配置/高级内容编辑器 (EditorScreen)
   ========================================================================== */
function EditorScreen({ cardToEdit, onBack, onPublish }) {
  const { t } = useTranslation();
  const [showMenu, setShowMenu] = useState(false);
  const [menuView, setMenuView] = useState('main');
  const [showBtnModal, setShowBtnModal] = useState(false);
  const [editingButtonPos, setEditingButtonPos] = useState(null);
  const [activeBtnKey, setActiveBtnKey] = useState(null);
  const [btnDraft, setBtnDraft] = useState({ text: '', value: '', btnType: 'url' });
  const [charCount, setCharCount] = useState(0);

  // 专属自定义表情库状态（数据闭环：由后端 Bot 抓取入库后通过 API 同步回这里）
  const [customEmojis, setCustomEmojis] = useState([
    { emoji_id: '5432109876543210123', fallback_char: '🚀' },
    { emoji_id: '9876543210123456789', fallback_char: '🔥' },
    { emoji_id: '1234567890123456789', fallback_char: '👑' },
    { emoji_id: '8888888888888888888', fallback_char: '🎯' }
  ]);

  // 动态向 head 注册专有全局样式，保证完全不对外部全局 CSS 产生污染
  useEffect(() => {
    const styleEl = document.createElement('style');
    styleEl.innerHTML = editorStyles;
    document.head.appendChild(styleEl);
    return () => {
      document.head.removeChild(styleEl);
    };
  }, []);

  const detectButtonType = (btn = {}) => {
    if (btn?.web_app) return 'web_app';
    if (btn?.callback_data !== undefined) return 'callback';
    if (btn?.switch_inline_query !== undefined) return 'switch';
    if (btn?.pay === true) return 'pay';
    return 'url';
  };

  const normalizeButtons = (rawButtons) => {
    const parseValue = (value) => {
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }
      return value;
    };

    const raw = parseValue(rawButtons);
    if (Array.isArray(raw) && raw.length > 0 && raw.every((item) => Array.isArray(item))) {
      return raw.map((row) => row.map((btn) => ({
        text: btn?.text || btn?.label || t('editor_unnamed_btn'),
        url: btn?.url || '',
        web_app: btn?.web_app || null,
        callback_data: btn?.callback_data || '',
        switch_inline_query: btn?.switch_inline_query || '',
        pay: Boolean(btn?.pay),
      })));
    }

    const list = Array.isArray(raw) ? raw : [];
    if (list.length === 0) return [];
    return [list.map((btn) => ({
      text: btn?.text || btn?.label || t('editor_unnamed_btn'),
      url: btn?.url || '',
      web_app: btn?.web_app || null,
      callback_data: btn?.callback_data || '',
      switch_inline_query: btn?.switch_inline_query || '',
      pay: Boolean(btn?.pay),
    }))];
  };

  const [buttons, setButtons] = useState(() => normalizeButtons(cardToEdit?.buttons));
  const [activeBtnId, setActiveBtnId] = useState(null);
  const [gridConfig, setGridConfig] = useState({ rows: 1, cols: 2 });
  const [mediaFile, setMediaFile] = useState(cardToEdit && cardToEdit.img ? { remoteUrl: cardToEdit.img, type: cardToEdit.media_type || 'photo', uploading: false } : null);
  const fileInputRef = useRef(null);

  const SpoilerMark = Mark.create({
    name: 'spoiler',
    addAttributes() {
      return {
        'data-spoiler': {
          default: 'true',
        },
      };
    },
    parseHTML() {
      return [
        { tag: 'tg-spoiler' },
        { tag: 'span[data-spoiler="true"]' },
      ];
    },
    renderHTML({ HTMLAttributes }) {
      return ['span', { ...HTMLAttributes, class: 'spoiler-mark', style: 'filter: blur(4px); cursor: help;' }, 0];
    },
  });

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        horizontalRule: false,
        link: false,
        underline: false,
        blockquote: false, // 禁用默认插件，改用支持多维属性的 TelegramBlockquote
        codeBlock: false,  // 禁用默认插件，改用支持实时代码高亮的 CodeBlockLowlight
        code: {
          HTMLAttributes: {
            class: 'bg-gray-100 text-red-500 px-1.5 py-0.5 rounded font-mono text-sm cursor-pointer mx-0.5',
          },
        },
      }),
      Underline,
      SpoilerMark,
      TelegramBlockquote,
      CodeBlockLowlight.configure({ lowlight }),
      TgEmoji,
      Link.configure({ openOnClick: false, HTMLAttributes: { class: 'text-blue-500 underline pointer-events-none' } }),
      Placeholder.configure({ placeholder: t('editor_placeholder') }),
    ],
    content: cardToEdit ? cardToEdit.content : `<p>${t('editor_default_content')}</p >`,
    editorProps: {
      attributes: { class: 'focus:outline-none min-h-[140px] text-[15px] leading-[1.4] text-[#000000] max-w-none break-words whitespace-pre-wrap font-sans' },
    },
    onUpdate({ editor }) {
      setCharCount(editor.getText().length); 
    // 💡 新增下面这一段生命周期钩子：当用户点击输入框唤起手机键盘时，菜单雷达自动收起
    },
    onFocus() {
      setShowMenu(false);
    },
  });
  // 💡 新增：当首次加载已有卡片时，初始化正确的字数
  useEffect(() => {
    if (editor) {
      setCharCount(editor.getText().length);
    }
  }, [editor]);
  // 💡 自动判断：只要 mediaFile 存在（不管是正在上传还是已经拿到远程URL），就意味着有媒体，上限自动切为 1024
  const hasMedia = !!mediaFile; 
  const maxLimit = hasMedia ? 1024 : 4096;
  const isOverLimit = charCount > maxLimit;

  // 处理图片或者视频文件（自动上传至后端并获取真实公网 URL）
  const handleMediaChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const previewUrl = URL.createObjectURL(file);
    
    let mediaType = 'photo';
    if (file.type.startsWith('video/')) {
      mediaType = 'video';
    } else if (file.name.toLowerCase().endsWith('.gif') || file.type === 'image/gif') {
      mediaType = 'gif';
    }

    setMediaFile({ previewUrl, type: mediaType, uploading: true, remoteUrl: null });
    try {
      if (mediaType === 'video') {
        const CHUNK_SIZE = 2 * 1024 * 1024;
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        const uploadId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        let finalRemoteUrl = null;

        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
          const start = chunkIndex * CHUNK_SIZE;
          const end = Math.min(file.size, start + CHUNK_SIZE);
          const chunk = file.slice(start, end);

          const formData = new FormData();
          formData.append('file_chunk', chunk, file.name); 
          formData.append('chunk_index', chunkIndex);
          formData.append('total_chunks', totalChunks);
          formData.append('upload_id', uploadId);
          formData.append('filename', file.name);

          const response = await fetch(`${BASE_URL}/upload/chunk`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: formData,
          });

          if (!response.ok) {
            throw new Error(`视频分片 [${chunkIndex + 1}/${totalChunks}] 上传失败`);
          }

          const data = await response.json();
          if (chunkIndex === totalChunks - 1) {
            if (!data?.url) throw new Error('后端合并后未能返回有效视频公网地址');
            finalRemoteUrl = data.url;
          }
        }

        setMediaFile((prev) => ({
          ...prev,
          remoteUrl: finalRemoteUrl,
          previewUrl: prev.previewUrl,
          uploading: false,
        }));
      } else {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch(`${BASE_URL}/upload`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: formData,
        });
        if (!response.ok) {
          throw new Error(`图片上传失败：${response.status}`);
        }

        const data = await response.json();
        if (!data?.url) {
          throw new Error('后端返回无效图片上传地址');
        }

        setMediaFile((prev) => ({
          ...prev,
          remoteUrl: data.url,
          previewUrl: prev.previewUrl,
          uploading: false,
        }));
      }

    } catch (uploadError) {
      console.error('媒体上传失败:', uploadError);
      alert('媒体文件上传失败，请重试。');
      setMediaFile(null);
    }
  };

  const triggerPublish = () => {
    if (!editor) return;
    if (mediaFile?.uploading) {
      alert(t('editor_uploading_tip'));
      return;
    }

    const pureText = editor.getText().trim();
    const shortTitle = pureText.length > 0 
     ? (pureText.slice(0, 15) + (pureText.length > 15 ? "..." : "")) 
     : t('editor_unnamed_native');

    onPublish({
      id: cardToEdit ? cardToEdit.id : null,
      title: shortTitle, 
      status: cardToEdit ? cardToEdit.status : "未发布",
      content: editor.getHTML(),
      buttons: Array.isArray(buttons) ? buttons : [], 
      img: mediaFile?.remoteUrl || "",  
      media_type: mediaFile?.type || 'photo',  
      analytics: cardToEdit ? cardToEdit.analytics : { views: 0, shares: 0, likes: 0, clicks: 0 }
    });
  };

  const handleMenuActionById = (e, actionId) => {
    e.preventDefault(); e.stopPropagation();
    if (!editor) return;
    const { from, to } = editor.state.selection;

    switch (actionId) {
      case 'bold': editor.chain().toggleBold().run(); break;
      case 'italic': editor.chain().toggleItalic().run(); break;
      case 'underline': editor.chain().toggleUnderline().run(); break;
      case 'strike': editor.chain().toggleStrike().run(); break;
      case 'quote': 
        if (editor.isActive('blockquote', { collapsible: false })) {
          editor.chain().focus().unsetBlockquote().run();
        } else {
          editor.chain().focus().setBlockquote({ collapsible: false }).run();
        }
        break;
      case 'collapsible_quote':
        if (editor.isActive('blockquote', { collapsible: true })) {
          editor.chain().focus().unsetBlockquote().run();
        } else {
          editor.chain().focus().setBlockquote({ collapsible: true }).run();
        }
        break;
      case 'code_block': 
        editor.chain().focus().toggleCodeBlock().run(); 
        break;
      case 'copy': editor.chain().focus().toggleCode().run(); break;
      case 'spoiler': editor.chain().focus().toggleMark('spoiler').run(); break;
      case 'clear': editor.chain().unsetAllMarks().clearNodes().run(); break;
      case 'emoji': setMenuView('emoji'); break;
      case 'custom_emoji': setMenuView('custom_emoji'); break;
      case 'link':
        if (from === to) { 
          alert('请先在编辑器中选中一段文字，再插入内嵌链接');
          return;
        }
        setMenuView('link'); break;
      case 'button': setMenuView('grid'); break;
      case 'external': setMenuView('grid'); break;
      case 'undo': editor.chain().undo().run(); break;
      case 'redo': editor.chain().redo().run(); break;
      default: break;
    }
  };

  const handleInsertEmoji = (e, emoji) => {
    e.preventDefault(); e.stopPropagation();
    if (editor) editor.chain().focus().insertContent(emoji).run();
  };

  const generateGrid = () => {
    const rows = Math.max(1, parseInt(gridConfig.rows) || 1);
    const cols = Math.max(1, parseInt(gridConfig.cols) || 2);
    const matrix = [];
    for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
      const row = [];
      for (let colIndex = 0; colIndex < cols; colIndex += 1) {
        const btnIndex = rowIndex * cols + colIndex;
        row.push({ text: `${t('editor_unnamed_btn')} ${btnIndex + 1}`, url: 'https://t.me' });
      }
      matrix.push(row);
    }
    setButtons(matrix);
    setMenuView('main');
  };

  const saveButtonConfig = () => {
    if (!editingButtonPos) return;
    const { rowIndex, colIndex } = editingButtonPos;
    const rawText = (btnDraft.text || '').trim();
    let rawValue = (btnDraft.value || '').trim();
    if (btnDraft.btnType === 'switch' && rawValue && !rawValue.startsWith('@')) {
      rawValue = `@${rawValue}`;
    }

    const nextButton = {
      text: rawText || t('editor_unnamed_btn'),
      type: btnDraft.btnType || 'url',
      value: rawValue
    };
    setButtons((prev) =>
      prev.map((row, r) =>
        r === rowIndex
          ? row.map((btn, c) => (c === colIndex ? nextButton : btn))
          : row
      )
    );
    setShowBtnModal(false);
    setEditingButtonPos(null);
  };

  // 动态高亮函数：对独立拆分出来的复合型引用和特定格式块提供精准的状态追踪响应
  const isMenuItemActive = (item) => {
    if (!editor) return false;
    if (item.id === 'quote') return editor.isActive('blockquote', { collapsible: false });
    if (item.id === 'collapsible_quote') return editor.isActive('blockquote', { collapsible: true });
    if (item.active) return editor.isActive(item.active);
    return false;
  };

  // 工具栏核心项：加入代码块、自定义表情与可折叠引用的全新映射节点
  const menuItems = [
    { id: "bold", icon: "B", label: t('editor_bold'), active: 'bold' }, 
    { id: "italic", icon: "I", label: t('editor_italic'), active: 'italic' },
    { id: "underline", icon: "U", label: t('editor_underline'), active: 'underline' }, 
    { id: "strike", icon: "S", label: t('editor_strike'), active: 'strike' },
    { id: "copy", icon: "📋", label: t('common_copy') }, 
    { id: "spoiler", icon: "🫥", label: t('editor_spoiler') },
    { id: "code_block", icon: "💻", label: t('editor_code_block'), active: 'codeBlock' }, 
    { id: "emoji", icon: "😀", label: t('editor_emoji') }, 
    { id: "custom_emoji", icon: "🎭", label: t('editor_custom_emoji') }, 
    { id: "link", icon: "🔗", label: t('editor_inline_link'), active: 'link' },
    { id: "button", icon: "🔘", label: t('editor_edit_btn') }, 
    { id: "external", icon: "↗", label: t('editor_external_link') },
    { id: "quote", icon: "—", label: t('editor_quote') }, 
    { id: "collapsible_quote", icon: "🗂️", label: t('editor_collapsible_quote') }, 
    { id: "clear", icon: "扫", label: t('editor_clear_format') },
    { id: "undo", icon: "↩", label: t('editor_undo') }, 
    { id: "redo", icon: "↪", label: t('editor_redo') }
  ];

return (
  <div className="flex flex-col h-screen bg-[#E7EBF0] text-gray-800 max-w-md mx-auto overflow-hidden relative border-x border-gray-200">
    
    {/* 1. 顶部导航栏 */}
    <div className="flex items-center justify-between p-4 bg-white border-b shrink-0 z-30 shadow-sm">
      <span className="text-xl cursor-pointer text-gray-400 font-bold px-2" onClick={onBack}>{"<"}</span>
      <h1 className="text-sm font-bold text-gray-700">{t('editor_title')}</h1>
      <button onClick={triggerPublish} className="bg-blue-600 text-white px-4 py-1.5 rounded-full text-xs font-bold shadow-md active:scale-95 transition-transform">{t('editor_save_card')}</button>
    </div>

    {/* 2. 主体可滚动区域 */}
    <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-80">
      
      {/* 卡片预览总容器 */}
      <div className="w-full max-w-[330px] mx-auto bg-white rounded-[15px] overflow-hidden shadow-sm border border-gray-100 flex flex-col">
        
        {/* 媒体卡片标题与上传栏 */}
        <div className="p-3 border-b border-gray-50 bg-slate-50/50 flex justify-between items-center">
          <span className="text-[11px] text-gray-400 font-bold">{t('editor_media_title')}</span>
          <button onClick={() => fileInputRef.current.click()} className="text-xs text-blue-500 font-bold hover:underline">
            {mediaFile ? t('editor_replace_media') : t('editor_add_media')}
          </button>
          <input type="file" ref={fileInputRef} onChange={handleMediaChange} accept="image/*,video/*" className="hidden" />
        </div>

        {/* 媒体文件预览区 */}
        {mediaFile && (
          <div className="w-full max-h-[380px] min-h-[160px] min-w-[150px] bg-[#f4f4f7] relative flex items-center justify-center overflow-hidden">
            {mediaFile.type === 'video' ? (
              <video src={mediaFile.previewUrl || mediaFile.remoteUrl} controls className="w-full h-full object-contain object-center" />
            ) : mediaFile.type === 'gif' ? (
              <img src={mediaFile.previewUrl || mediaFile.remoteUrl} className="w-full h-full object-contain object-center" alt="" />
            ) : (
              <img src={mediaFile.previewUrl || mediaFile.remoteUrl} className="w-full h-full object-contain object-center" alt="" />
            )}
            <button onClick={() => setMediaFile(null)} className="absolute top-2 right-2 bg-black/60 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">✕</button>
          </div>
        )}

        {/* 富文本编辑器输入区 */}
        <div className="p-3 bg-white min-h-[140px] relative pb-7">
          <p className="mb-2 text-[10px] text-gray-400">{t('editor_btn_matrix_tip')}</p>
          <EditorContent editor={editor} onFocus={() => setShowMenu(false)} />
          <div className={`absolute bottom-2 right-3 text-[10px] font-mono px-1.5 py-0.5 rounded-md select-none transition-all ${
            isOverLimit 
              ? 'bg-red-50 text-red-500 font-bold animate-pulse border border-red-200'
              : 'text-gray-400 bg-slate-50 border border-slate-100'
          }`}>
            {charCount} / {maxLimit}
          </div>
        </div>

        {/* 动态内联按钮矩阵展示区 */}
        {buttons.length > 0 && (
          <div className="p-2 border-t border-gray-100 bg-white space-y-[1.5px]">
            {buttons.map((row, rowIndex) => (
              <div key={`row-${rowIndex}`} className="grid gap-[1.5px]" style={{ gridTemplateColumns: `repeat(${Math.max(1, row.length)}, 1fr)` }}>
                {row.map((btn, colIndex) => {
                  const btnType = detectButtonType(btn);
                  const typeMeta = {
                    url: { icon: '🔗', label: t('editor_type_url') },
                    
                    
                    switch: { icon: '📣', label: t('editor_type_switch') },
                    
                  }[btnType] || { icon: '🔗', label: t('editor_type_url') };

                  return (
                    <button
                      key={`${rowIndex}-${colIndex}`}
                      type="button"
                      onClick={() => {
                        setActiveBtnKey(`${rowIndex}-${colIndex}`);
                        setEditingButtonPos({ rowIndex, colIndex });
                        setBtnDraft({
                          text: btn.text || '',
                          value: btn.url || btn.callback_data || btn.switch_inline_query || btn.web_app?.url || '',
                          btnType: btnType,
                        });
                        setShowBtnModal(true);
                      }}
                      className={`py-2 px-1 rounded-md text-center text-[12px] font-semibold border transition-all cursor-pointer ${
                        activeBtnKey === `${rowIndex}-${colIndex}` 
                          ? 'border-blue-500 bg-blue-50 text-blue-600' 
                          : 'bg-[#f1f5f9]/70 border-transparent text-gray-700 hover:bg-slate-100'
                      }`}
                    >
                      <span className="block truncate max-w-full">{btn.text || t('editor_unnamed_btn')}</span>
                      <span className="text-[9px] opacity-40 font-normal block scale-90">{typeMeta.icon} {typeMeta.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div> {/* 卡片预览总容器 */}

    </div> {/* 💡 核心修复点：在这里精准闭合第 2 步的“主体可滚动区域 (flex-1 overflow-y-auto)” */}

    {/* 3. 悬浮主编辑呼起圆盘 (利用 absolute 固定在页面最底部，不跟随上面滚动) */}
    <div className="absolute bottom-0 left-0 right-0 z-40 flex flex-col select-none pointer-events-none">
      
      {/* 1/3 高度的全宽菜单功能抽屉 - 仅在打开时渲染 */}
      {showMenu && (
        /* 🟢 优化：加入高度动态自适应逻辑，进入 emoji 时变高到 440px，其余时刻保持原样 300px */
        <div className={`pointer-events-auto bg-white rounded-t-[24px] shadow-[0_-10px_30px_rgba(0,0,0,0.08)] border-t border-gray-200/60 p-4 w-full flex flex-col animate-in slide-in-from-bottom duration-200 pb-safe transition-all ${
          menuView === 'emoji' ? 'h-[440px]' : 'h-[300px]'
        }`}>
          
          {/* 抽屉顶部控制小吧台 */}
          <div className="flex justify-between items-center pb-2 mb-2 border-b border-gray-100 shrink-0">
            {menuView === 'main' ? (
              <span className="text-[11px] font-bold text-gray-400 tracking-wider">
                {t('editor_btn_config_title')}
              </span>
            ) : (
              /* 🟢 优化：子视图状态下，左侧统一展现极简的“← 返回”操控按钮，实现全局联动 */
              <button 
                onClick={() => setMenuView('main')}
                className="text-[11px] font-bold text-blue-500 flex items-center gap-1 active:scale-95 transition-transform cursor-pointer"
              >
                ← {t('common_back')}
              </button>
            )}
            <button 
              onClick={() => setShowMenu(false)} 
              className="text-gray-400 hover:text-gray-600 text-xs font-bold px-2 py-0.5 rounded-full bg-gray-50 active:scale-90 transition-transform cursor-pointer"
            >
              ✕
            </button>
          </div>

          {/* 抽屉内部可滚动视图视窗 */}
          <div className="flex-1 overflow-y-auto pb-2">
            
            {/* 视图A：主功能菜单 */}
            {menuView === 'main' && (
              <div className="grid grid-cols-4 gap-3 pb-4">
                {menuItems.map((item, index) => (
                  <button
                    key={index}
                    onClick={(e) => handleMenuActionById(e, item.id)}
                    className={`flex flex-col items-center justify-center py-2.5 px-1 rounded-xl transition-all active:scale-90 ${
                      isMenuItemActive(item) ? 'bg-blue-50 text-blue-600 font-bold' : 'hover:bg-gray-50 text-gray-600'
                    }`}
                  >
                    <span className="text-xl mb-1">{item.icon}</span>
                    <span className="text-[11px] tracking-tight opacity-90">{item.label}</span>
                  </button>
                ))}
              </div>
            )}

            {/* 视图B：矩阵行列配置视图 */}
            {menuView === 'grid' && (
              <div className="p-1 space-y-3 animate-in fade-in zoom-in-95 duration-150">
                <div className="flex justify-between items-center border-b pb-1">
                  <span className="text-xs font-bold text-gray-700">{t('editor_config_matrix')}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1">{t('editor_rows')}</label>
                    <input type="number" min="1" max="8" value={gridConfig.rows} onChange={(e) => setGridConfig({ ...gridConfig, rows: e.target.value })} className="w-full border rounded-lg px-2 py-1 text-xs outline-none" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1">{t('editor_cols')}</label>
                    <input type="number" min="1" max="5" value={gridConfig.cols} onChange={(e) => setGridConfig({ ...gridConfig, cols: e.target.value })} className="w-full border rounded-lg px-2 py-1 text-xs outline-none" />
                  </div>
                </div>
                <button onClick={generateGrid} className="w-full bg-blue-600 text-white py-2 rounded-xl text-xs font-bold shadow-md shadow-blue-100">{t('editor_generate_matrix')}</button>
              </div>
            )}

            {/* 视图C：内嵌文字超级链接视图 */}
            {menuView === 'link' && (
              <div className="p-1 space-y-3 animate-in fade-in zoom-in-95 duration-150">
                <div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-700">{t('editor_insert_link_title')}</span></div>
                <input id="linkUrl" placeholder="https://..." className="w-full border-b py-1.5 text-xs outline-none text-blue-500" autoFocus />
                <button onClick={() => { const url = document.getElementById('linkUrl').value; if (url) { editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run(); } setMenuView('main'); }} className="w-full bg-blue-600 text-white py-2 rounded-xl text-xs font-bold">{t('editor_confirm_insert')}</button>
              </div>
            )}

            {/* 🟢 优化：视图D：标准原生 Emoji 开源组件视图 */}
            {menuView === 'emoji' && (
              /* 彻底移除局部的额外标题栏，注入样式穿透彻底隐形组件内部的英文分类标题 */
              <div className="p-0 flex flex-col h-full [&_.epr-emoji-category-label]:hidden">
                <div className="flex-1 overflow-hidden rounded-xl border border-slate-100">
                  <EmojiPicker 
                    onEmojiClick={(emojiData) => { if (editor) editor.chain().focus().insertContent(emojiData.emoji).run(); }} 
                    autoFocusSearch={false} 
                    theme="light" 
                    searchPlaceholder={t('editor_search_emoji_placeholder')} 
                    width="100%" 
                    height="340px" /* 🟢 高度从原本捉襟见肘的 180px 直接撑满放大到 340px */
                    previewConfig={{ showPreview: false }} 
                    skinTonesDisabled={true} 
                  />
                </div>
              </div>
            )}

            {/* 视图E：TG 特性专属自定义表情包视图 */}
            {menuView === 'custom_emoji' && (
              <div className="p-1 min-h-[200px]">
                <p className="text-[10px] text-gray-400 p-2 text-center bg-amber-50/60 rounded-lg mb-2">{t('editor_custom_emoji_tip')}</p>
                <div className="grid grid-cols-4 gap-2 pb-4">
                  {customEmojis.map((item, idx) => (
                    <button key={idx} onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (editor) { editor.chain().focus().insertContent(`<tg-emoji emoji-id="${item.emoji_id}">${item.fallback_char}</tg-emoji>`).run(); } }} className="flex flex-col items-center justify-center p-1.5 border border-slate-100 rounded-xl hover:bg-slate-50 transition-all active:scale-95" >
                      <span className="text-xl mb-1">{item.fallback_char}</span>
                      <span className="text-[8px] text-gray-400 scale-90 truncate max-w-full">ID:{item.emoji_id.slice(-4)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div> {/* 闭合：抽屉内部滚动视窗 */}
        </div>
      )}

      {/* 固守页面最底部的触发按钮条 - 仅在菜单关闭时（!showMenu）才显示 */}
      {!showMenu && (
        <div className="flex justify-center w-full mb-4 shrink-0 pb-safe">
          <button 
            onClick={() => { 
              setShowMenu(true);
              setMenuView('main');
              if (editor) {
                editor.commands.blur();
              }
            }} 
            className="pointer-events-auto bg-slate-900/95 backdrop-blur-xs text-white py-1.5 px-4 rounded-full flex items-center justify-center gap-1.5 shadow-xl border border-slate-800 active:scale-95 transition-transform font-bold text-xs whitespace-nowrap"
          >
            <span>⚙️</span> {t('editor_btn_config_title')}
          </button>
        </div>
      )}

    </div>

    {/* 4. 底部单个按钮高精度独立配置弹窗 (Modal 遮罩层) */}
    {showBtnModal && editingButtonPos && (
      <div className="absolute inset-0 bg-black/40 backdrop-blur-xs flex items-end justify-center z-50 animate-in fade-in duration-200" onClick={() => setShowBtnModal(false)}>
        <div className="w-full bg-white rounded-t-[30px] p-5 pb-8 space-y-4 shadow-2xl animate-in slide-in-from-bottom-10 duration-200 max-h-[90%] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <div className="flex justify-between items-center border-b pb-3">
            <h3 className="text-sm font-bold text-gray-800 flex items-center gap-1.5"><span>⚙️</span> {t('editor_edit_specific_btn')}</h3>
            <button onClick={() => {
              const { rowIndex, colIndex } = editingButtonPos;
              setButtons((prev) => prev.map((row, r) => r === rowIndex ? row.filter((_, c) => c !== colIndex) : row).filter((row) => row.length > 0));
              setShowBtnModal(false);
            }} className="text-xs text-red-500 font-bold bg-red-50 px-2.5 py-1 rounded-lg hover:bg-red-100">{t('editor_remove_btn')}</button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1.5">{t('editor_btn_text')}</label>
              <input type="text" value={btnDraft.text} onChange={(e) => setBtnDraft({ ...btnDraft, text: e.target.value })} placeholder={t('editor_input_btn_text')} className="w-full border rounded-xl px-3 py-2 text-xs outline-none focus:border-blue-500 bg-slate-50" />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1.5">{t('editor_btn_type')}</label>
              <select value={btnDraft.btnType} onChange={(e) => setBtnDraft({ ...btnDraft, btnType: e.target.value, value: '' })} className="w-full border rounded-xl px-3 py-2 text-xs outline-none bg-slate-50 focus:border-blue-500 font-medium">
                <option value="url">{t('editor_btn_type_url')}</option>
                
                <option value="share">{t('editor_btn_type_share')}</option>
                
                <option value="switch">{t('editor_btn_type_switch')}</option>
                
              </select>
            </div>

            {btnDraft.btnType !== 'pay' && btnDraft.btnType !== 'share' && (
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1.5">{t('editor_core_content')}</label>
                <input
                  type="text"
                  value={btnDraft.value}
                  onChange={(e) => setBtnDraft({ ...btnDraft, value: e.target.value })}
                  placeholder={
                    btnDraft.btnType === 'callback' ? t('editor_input_callback_tip') :
                    btnDraft.btnType === 'switch' ? t('editor_input_switch_tip') : t('editor_input_url_tip')
                  }
                  className="w-full border rounded-xl px-3 py-2 text-xs outline-none focus:border-blue-500 bg-slate-50 font-mono text-blue-600"
                />
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={() => setShowBtnModal(false)} className="flex-1 border py-2.5 rounded-xl text-xs font-bold text-gray-500 hover:bg-slate-50 active:scale-98 transition-transform">{t('common_cancel')}</button>
            <button onClick={saveButtonConfig} className="flex-1 bg-blue-600 text-white py-2.5 rounded-xl text-xs font-bold shadow-md shadow-blue-100 hover:bg-blue-700 active:scale-98 transition-transform">{t('common_confirm')}</button>
          </div>
        </div> {/* 闭合：Modal内层白色卡片容器 */}
      </div> 
    )}

  </div> 
);
} // 闭合整个 EditorScreen 组件函数



/* ==========================================================================
   3. 全屏卡片预览页面组件 (PreviewScreen) - 1:1 像素级高度还原版
   ========================================================================== */
function PreviewScreen({ card, onBack }) {
  const { t } = useTranslation();
  
  if (!card) return null;


  // 1:1 复制编辑器的按钮类型探测逻辑，确保徽章图标完全一致
  const detectButtonType = (btn = {}) => {
    if (btn?.web_app) return 'web_app';
    if (btn?.callback_data !== undefined) return 'callback';
    if (btn?.switch_inline_query !== undefined) return 'switch';
    if (btn?.pay === true) return 'pay';
    return 'url';
  };

  // 稳健解析：确保按钮数据在任何情况下都能正确还原为二维矩阵
  const normalizeButtons = (rawButtons) => {
    if (!rawButtons) return [];
    let raw = rawButtons;
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch {
        return [];
      }
    }
    // 如果已经是标准的二维数组，直接返回
    if (Array.isArray(raw) && raw.length > 0 && raw.every((item) => Array.isArray(item))) {
      return raw;
    }
    // 如果是老版本一维数组，自动包裹成单行二维数组以防报错
    return Array.isArray(raw) ? [raw] : [];
  };

  const layoutButtons = normalizeButtons(card.buttons);
  const mediaType = card.media_type || 'photo';

  return (
    <div className="flex flex-col h-screen bg-[#E7EBF0] max-w-md mx-auto overflow-hidden relative border-x border-gray-200">
      
      {/* 顶部导航栏 */}
      <div className="flex items-center justify-between p-4 bg-white border-b shrink-0 z-30 shadow-sm">
        <span className="text-xl cursor-pointer text-gray-400 font-bold px-2" onClick={onBack}>{"<"}</span>
        <h1 className="text-sm font-bold text-gray-700">卡片效果预览</h1>
        <div className="w-10"></div>
      </div>

      {/* 主体可滚动区域 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="text-center text-xs text-gray-400 my-2">今天</div>
        
        {/* 核心改动：完全镜像 EditorScreen 内部的卡片预览总容器结构与类名 */}
        <div className="w-full max-w-[330px] mx-auto bg-white rounded-[15px] overflow-hidden shadow-sm border border-gray-100 flex flex-col">
          
          {/* 1. 媒体文件展示区 - 完美同步编辑器的视频/图片/GIF分流逻辑 */}
          {card.img && (
            <div className="w-full max-h-[380px] min-h-[160px] min-w-[150px] bg-[#f4f4f7] relative flex items-center justify-center overflow-hidden">
              {mediaType === 'video' ? (
                <video src={card.img} controls className="w-full h-full object-contain object-center" />
              ) : (
                < img src={card.img} className="w-full h-full object-contain object-center" alt="" />
              )}
            </div>
          )}

          {/* 2. 富文本内容展示区 - 注入 ProseMirror 类名激活全量动态样式 */}
          <div className="p-3 bg-white min-h-[60px] text-[15px] leading-[1.4] text-[#000000] break-words font-sans">
            <div 
              className="ProseMirror focus:outline-none" 
              dangerouslySetInnerHTML={{ __html: card.content }} 
            />
          </div>

          {/* 3. 动态内联按钮矩阵展示区 - 完美复刻二维 Grid 布局，仅保留展示与埋点，不触发具体业务 */}
          {layoutButtons.length > 0 && (
            <div className="p-2 border-t border-gray-100 bg-white space-y-[1.5px]">
              {layoutButtons.map((row, rowIndex) => (
                <div 
                  key={`preview-row-${rowIndex}`} 
                  className="grid gap-[1.5px]" 
                  style={{ gridTemplateColumns: `repeat(${Math.max(1, row.length)}, 1fr)` }}
                >
                  {row.map((btn, colIndex) => {
                    const btnType = detectButtonType(btn);
                    const typeMeta = {
                      url: { icon: '🔗', label: t('editor_type_url') },
                      web_app: { icon: '📱', label: t('editor_type_webapp') },
                      callback: { icon: '⚡', label: t('editor_type_callback') },
                      switch: { icon: '📣', label: t('editor_type_switch') },
                      pay: { icon: '💳', label: t('editor_type_pay') },
                    }[btnType] || { icon: '🔗', label: t('editor_type_url') };

                    return (
                      <button
                        key={`preview-btn-${rowIndex}-${colIndex}`}
                        type="button"
                        onClick={() => {
                          // 预览模式：按钮只渲染、不弹窗破坏体验，但保留静默点击上报数据
                          if (card.id) trackClick(card.id);
                        }}
                        className="py-2 px-1 rounded-md text-center text-[12px] font-semibold bg-[#f1f5f9]/70 border border-transparent text-gray-700 hover:bg-slate-100 transition-all cursor-pointer"
                      >
                        <span className="block truncate max-w-full">{btn.text || t('editor_unnamed_btn')}</span>
                        <span className="text-[9px] opacity-40 font-normal block scale-90">{typeMeta.icon} {typeMeta.label}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

        </div> {/* 卡片总容器闭合 */}
      </div>
    </div>
  );
}

/* ==========================================================================
   4. 数据统计可视化页面组件 (AnalyticsScreen)
   ========================================================================== */
function AnalyticsScreen({ card, onBack }) {
  const { t } = useTranslation();
  if (!card) return null;

  // 这里的 t 直接读取当前上下文的 t 函数
  const { views = 0, shares = 0, likes = 0, clicks = 0 } = card.analytics || {};
  const maxVal = Math.max(views, shares, likes, clicks, 1);

  return (
    <div className="flex flex-col h-screen bg-slate-50 max-w-md mx-auto overflow-hidden relative border-x border-gray-200">
      {/* 顶部导航栏 */}
      <div className="flex items-center justify-between p-4 bg-white border-b shrink-0 z-30 shadow-sm">
        <span className="text-xl cursor-pointer text-gray-400 font-bold px-2" onClick={onBack}>{"<"}</span>
        <h1 className="text-md font-bold text-gray-800">{t('analytics_title')}</h1>
        <div className="w-10"></div>
      </div>

      {/* 内容滚动区 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* 卡片信息 */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <p className="text-xs text-gray-400 mb-1">{t('analytics_analyzing')}</p >
          <h2 className="text-base font-bold text-gray-800 line-clamp-1">{card.title}</h2>
        </div>

        {/* 四宫格数据 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3">
            <div className="p-3 bg-blue-50 text-blue-500 rounded-xl"><FaEye size={18} /></div>
            <div>
              <p className="text-[11px] text-gray-400 font-medium">{t('analytics_views')}</p >
              <p className="text-base font-bold text-gray-800">{views.toLocaleString()}</p >
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3">
            <div className="p-3 bg-green-50 text-green-500 rounded-xl"><FaPaperPlane size={16} /></div>
            <div>
              <p className="text-[11px] text-gray-400 font-medium">{t('analytics_shares')}</p >
              <p className="text-base font-bold text-gray-800">{shares.toLocaleString()}</p >
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3">
            <div className="p-3 bg-red-50 text-red-500 rounded-xl"><FaHeart size={16} /></div>
            <div>
              <p className="text-[11px] text-gray-400 font-medium">{t('analytics_likes')}</p >
              <p className="text-base font-bold text-gray-800">{likes.toLocaleString()}</p >
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3">
            <div className="p-3 bg-purple-50 text-purple-500 rounded-xl"><FaMousePointer size={18} /></div>
            <div>
              <p className="text-[11px] text-gray-400 font-medium">{t('analytics_clicks')}</p >
              <p className="text-base font-bold text-gray-800">{clicks.toLocaleString()}</p >
            </div>
          </div>
        </div>

        {/* 可视化条形图 */}
        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-gray-800 border-b pb-2">{t('analytics_chart_title')}</h3>
          <div className="space-y-3.5">
            {[
              [t('analytics_views'), views, 'bg-blue-500'],
              [t('analytics_shares'), shares, 'bg-green-500'],
              [t('analytics_likes'), likes, 'bg-red-500'],
              [t('analytics_clicks'), clicks, 'bg-purple-500']
            ].map(([label, val, color]) => (
              <div key={label} className="space-y-1">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-gray-500">{label}</span>
                  <span className="font-bold text-gray-700">{val.toLocaleString()}</span>
                </div>
                <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                  <div 
                    className={`h-full ${color} rounded-full transition-all duration-500`} 
                    style={{ width: `${(val / maxVal) * 100}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}