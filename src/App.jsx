import React, { useState, useRef, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { Mark } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { 
  FaLayerGroup, FaEye, FaShare, FaHeart, FaMousePointer, 
  FaChartBar, FaTrashAlt, FaEdit, FaChevronDown,
  FaCoins, FaBell, FaBookOpen, FaHeadset, FaPaperPlane,
  FaArrowLeft, FaUsers, FaClipboardList, FaBullhorn, FaLock
} from "react-icons/fa";

import { useTranslation } from 'react-i18next';
import './i18n'; 

// ==========================================================================
// 后端配置中心
// ==========================================================================
const BASE_URL = "https://www.kongjing.online/api".replace(/\/+$/, ""); // 去除尾部斜杠，避免拼接时出现 //api//user

const getAuthHeaders = (contentType = null) => {
  const headers = {};
  if (contentType) {
    headers['Content-Type'] = contentType;
  }

  const initData = window.Telegram?.WebApp?.initData || "";
  if (initData) {
    headers.Authorization = `Bearer ${initData}`;
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

  // 3. 完美防御型：卡片保存逻辑
  const handleSaveCard = async (cardData) => {
    try {
      const isEditing = !!cardData.id;
      const url = isEditing ? `${BASE_URL}/cards/${cardData.id}` : `${BASE_URL}/cards`;
      
      const payload = {
        id: cardData.id ?? selectedCard?.id ?? undefined,
        title: cardData.title ?? '',
        content: cardData.content ?? '',
        img: cardData.img ?? '',
        media_type: cardData.media_type ?? 'photo',
        buttons: typeof cardData.buttons === 'string' ? cardData.buttons : JSON.stringify(cardData.buttons || [])
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: getAuthHeaders('application/json'),
        body: JSON.stringify(payload)
      });

      // 🚀 核心改动：只要 response.ok (状态码 200/201)，就说明后端实打实地存进数据库了！
      if (response.ok) {
        // 我们尝试安全解析 JSON，如果后端给的是 "OK" 导致报错，直接忽略，强行通车！
        try {
            await response.json();
        } catch (e) {
            console.log("后端返回了非标准JSON（比如'OK'），已自动忽略并继续：", e);
        }

        // 完美衔接：去刷新列表，并退回首页
        await fetchCards();
        setCurrentScreen('home');
        setSelectedCard(null);
      } else {
        throw new Error('服务器响应异常');
      }

    } catch (error) {
      console.error("请求失败:", error);
      alert("连接服务器失败，已为您在本地临时更新。");
      
      // 容错降轨：万一服务器彻底断开，本地临时充数
      if (!cardData.id) {
        const newCard = { ...cardData, id: 'LOCAL_' + Date.now(), views: 0, shares: 0, likes: 0, clicks: 0 };
        setCards(prev => [newCard, ...prev]);
      } else {
        setCards(prev => prev.map(c => c.id === cardData.id ? cardData : c));
      }
      setCurrentScreen('home');
    }
  };

  return (
    <div className="w-full min-h-screen bg-slate-50 text-slate-900 font-sans">
      {loading && (
        <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center text-xs text-white font-medium">
          <div className="bg-slate-800 px-4 py-2 rounded-xl shadow-md">同步中...</div>
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
  const { t } = useTranslation();
  const [activeCardId, setActiveCardId] = useState(null);
  const [showUserMenu, setShowUserMenu] = useState(false); 
  const menuRef = useRef(null);

  // 保留原有 currentUser 状态不变，提供兼容的 `user` 别名以满足旧版逻辑引用
  const user = currentUser || null;
  const wxUsername = user?.username || t('common_anonymous');
  const wxRole = user ? (user.role === 'superuser' ? t('home_role_superuser') : t('home_user_regular')) : t('home_not_logged_in');
  const vipStatus = user?.vip_until && Number(user.vip_until) > Math.floor(Date.now() / 1000) ? t('home_vip_active') : (user ? t('home_user_regular') : t('home_not_logged_in'));

  // 优先读取 user?.tg_id，其次回退到 Telegram WebApp initDataUnsafe 中的 id
  const telegramInitId = typeof window !== 'undefined' ? window.Telegram?.WebApp?.initDataUnsafe?.user?.id : null;
  const resolvedId = (user && user.tg_id) ? user.tg_id : (telegramInitId ? telegramInitId : null);
  const isAnonymous = (user && user.is_anonymous === true) || !resolvedId;
  const displayName = isAnonymous ? t('common_anonymous') : `${t('common_id')}${resolvedId}`;
  
  // VIP 标签：只有非匿名用户时展示
  const vipTag = !isAnonymous ? (user?.is_vip ? 'VIP' : t('home_user_regular')) : null;
  
  // 专属 Bot 状态（保持原变量名判断 user?.has_bot / user?.bot_username）
  const botStatus = isAnonymous
    ? { text: t('home_waiting_auth'), className: 'text-gray-400' }
    : (user?.has_bot ? { text: `● ${t('home_bound')}@${user?.bot_username}`, className: 'text-emerald-500' } : { text: `○ ${t('home_not_bound')}`, className: 'text-amber-500' });
  
  const isAdmin = user?.role === 'admin' || user?.role === 'superuser';

  const toggleCardActions = (id) => {
    setActiveCardId(activeCardId === id ? null : id);
  };

  // 物理删除：对接后端 API
  const handleDeleteCard = async (id) => {
    if (window.confirm(t('home_delete_confirm'))) {
      try {
        const response = await fetch(`${BASE_URL}/cards/${id}`, {
          method: 'DELETE',
          headers: getAuthHeaders(),
        });
        if (response.ok) {
          setCards(cards.filter(c => c.id !== id));
          setActiveCardId(null);
        } else {
          alert("后端删除失败");
        }
      } catch (error) {
        console.error("删除失败:", error);
        // 容错处理
        setCards(cards.filter(c => c.id !== id));
        setActiveCardId(null);
      }
    }
  };

// 核心功能升级：更安全的呼叫主体判定
const handlePublishToTelegram = (card) => {
  try {
    // 1. 你的默认系统主 Bot 用户名（请替换为你真实的主 Bot 名，不要带@）
    const SYSTEM_MAIN_BOT_USERNAME = "kongjing_service_bot"; 

    let targetBotUsername = SYSTEM_MAIN_BOT_USERNAME;
    
    // 2. 🛡️ 双重安全判定：只有当用户绑定了专属 Bot，且后端成功返回了 bot_username 时，才切换
    // 这样哪怕数据库里 bot_username 偶尔为空，也会自动降级用系统默认 Bot 发送，绝不卡死！
    if (user && user.bot_username && user.bot_username.trim() !== "") {
      targetBotUsername = user.bot_username.trim().replace('@', ''); // 确保过滤掉用户误输入的@符号
    }

    const queryPayload = `card_${card.id}`;
    
    // 3. 唤醒 Telegram 原生转发大厅
    if (window.Telegram?.WebApp) {
      const inlineUrl = `https://t.me/${targetBotUsername}?switch_inline_query=${queryPayload}`;
      window.Telegram.WebApp.openTelegramLink(inlineUrl);
      
      // 4. 异步刷新状态
      setTimeout(() => {
        if (typeof fetchCards === 'function') fetchCards();
      }, 1500);
      
    } else {
      alert("请在 Telegram 客户端内打开小程序以使用发布功能 ⚠️");
    }

  } catch (error) {
    console.error("前端调起内联转发故障:", error);
    alert("调起发布失败，请检查网络或Bot状态。");
  }
};

  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="w-full max-w-md mx-auto bg-slate-50 min-h-screen border-x border-gray-200 relative">
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
            <div className="absolute left-0 mt-2 w-44 bg-white rounded-2xl shadow-xl border border-gray-100 p-1.5 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
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
              <button onClick={() => { alert(t('home_calling_support')); setShowUserMenu(false); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-semibold text-gray-700 hover:bg-slate-50 rounded-xl transition-colors">
                <FaHeadset className="text-emerald-500" /> {t('home_support')}
              </button>
            </div>
          )}
        </div>
        <div className="text-right"><span className="text-[10px] bg-slate-100 font-bold text-slate-500 px-2 py-1 rounded-md">{t('home_console_v')}</span></div>
      </div>
      {/* 注：已将下方冗余的用户信息卡片移除，相关显示已整合至顶部 Header */}

      {announcement && (
        <div className="mx-4 mt-3 rounded-2xl border border-amber-300/30 bg-gradient-to-r from-amber-100/80 to-amber-50 p-3 text-sm text-amber-900 flex items-start gap-3">
          <FaBell className="text-amber-700 mt-1" />
          <div className="flex-1">
            <div className="font-bold">{t('home_announcement')}</div>
            <div className="text-xs mt-1">{announcement}</div>
          </div>
          <div className="text-xs text-amber-800 font-semibold">{t('home_announcement')}</div>
        </div>
      )}

      {isAdmin && (
        <div className="mx-4 mt-4 rounded-3xl border border-amber-400/40 bg-gradient-to-r from-amber-100/80 via-yellow-50 to-slate-50 p-4 shadow-lg shadow-amber-200/30">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-700">{t('home_admin_panel')}</p >
              <p className="mt-1 text-sm font-bold text-slate-900">{t('home_admin_panel_open')}</p >
            </div>
            <button
              onClick={onNavigateAdmin}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2 text-xs font-bold uppercase tracking-[0.15em] text-amber-200 shadow-lg shadow-slate-900/10 hover:bg-slate-800 transition"
            >
              <FaLock size={14} /> {t('home_enter_admin')}
            </button>
          </div>
          <p className="mt-3 text-[11px] text-slate-500">{t('home_admin_only_tip')}</p >
        </div>
      )}

      <div className="p-4 pb-12">
        <p className="text-[11px] text-gray-400 mt-2 mb-3 font-bold uppercase tracking-widest">{t('home_select_type')}</p >
        <div className="flex flex-col gap-3 cursor-pointer" onClick={onNavigateEditor}>
          <div className="flex items-center p-4 bg-white border-2 border-blue-500 rounded-2xl gap-4 shadow-sm active:scale-[0.99] transition-all">
            <div className="bg-blue-600 p-3 rounded-xl text-white shadow-md"><FaLayerGroup size={20} /></div>
            <div>
              <p className="font-bold text-sm">{t('home_native_mode')}</p >
              <p className="text-xs text-gray-400">{t('home_native_mode_desc')}</p >
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
              return (
                <div key={card.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden transition-all">
                  <div className="flex gap-4 p-3 cursor-pointer active:bg-gray-50/80 transition-colors" onClick={() => toggleCardActions(card.id)}>
                    {card.media_type === 'video' ? 
                      <video src={card.img} className="w-20 h-20 object-cover rounded-xl shrink-0 bg-slate-100" />
                    : card.media_type === 'gif' ?
                      < img src={card.img} className="w-20 h-20 object-cover rounded-xl shrink-0 bg-slate-100" alt="" />
                      : < img src={card.img || "https://picsum.photos/200/120?random=default"} className="w-20 h-20 object-cover rounded-xl shrink-0 bg-slate-100" alt="" />
                    }
                    <div className="flex-1 flex flex-col justify-between py-1">
                      <p className="font-bold text-sm text-gray-800 line-clamp-2">{card.title || t('admin_unnamed_card')}</p >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-gray-400 font-medium flex items-center gap-1"><FaEye /> {card.analytics?.views || 0}</span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${card.status === '已发布' ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600'}`}>{card.status}</span>
                      </div>
                    </div>
                  </div>

                  <div className={`flex border-t border-gray-50 bg-slate-50/50 transition-all duration-200 ${isExpanded ? 'h-11 opacity-100' : 'h-0 opacity-0 overflow-hidden pointer-events-none'}`}>
                    <button onClick={() => onNavigatePreview(card)} className="flex-1 text-center text-[11px] font-bold text-gray-600 flex items-center justify-center gap-1 border-r border-gray-100 hover:bg-gray-100/50 active:text-blue-500">
                      <FaEye size={11} className="text-gray-400" /> {t('common_preview')}
                    </button>
                    <button onClick={() => handlePublishToTelegram(card)} className="flex-1 text-center text-[11px] font-bold text-blue-600 flex items-center justify-center gap-1 border-r border-gray-100 hover:bg-blue-50/50 active:scale-95 transition-transform">
                      <FaPaperPlane size={10} className="text-blue-400" /> {t('common_publish')}
                    </button>
                    <button onClick={() => onNavigateAnalytics(card)} className="flex-1 text-center text-[11px] font-bold text-gray-600 flex items-center justify-center gap-1 border-r border-gray-100 hover:bg-gray-100/50 active:text-blue-500">
                      <FaChartBar size={11} className="text-gray-400" /> {t('common_data')}
                    </button>
                    <button onClick={() => onNavigateEditSpecific(card)} className="flex-1 text-center text-[11px] font-bold text-gray-600 flex items-center justify-center gap-1 border-r border-gray-100 hover:bg-gray-100/50 active:text-blue-500">
                      <FaEdit size={11} className="text-gray-400" /> {t('common_edit')}
                    </button>
                    <button onClick={() => handleDeleteCard(card.id)} className="flex-1 text-center text-[11px] font-bold text-red-500 flex items-center justify-center gap-1 hover:bg-red-50/40">
                      <FaTrashAlt size={11} className="text-red-400" /> {t('common_delete')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function RechargeScreen({ currentUser, onBack, onRefreshUser }) {
  const { t } = useTranslation();
  // 后台控制的动态多通道价格状态
  const [livePrices, setLivePrices] = useState({ crypto_usdt: 2.0, tg_stars: 143 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // 优先从 TG 容器获取当前用户的真实 Telegram 唯一 ID
  const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
  const userId = tgUser?.id || currentUser?.id || currentUser?.telegram_id;

  // 页面初始化时，自动去后端拉取最新由你调控控制的价格
  useEffect(() => {
    async function fetchPrices() {
      try {
        const res = await fetch(`${BASE_URL}/payment/prices`, {
          headers: getAuthHeaders(),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.prices) setLivePrices(data.prices);
        }
      } catch (err) {
        console.error("拉取后台控制定价失败，降级使用标准预设价格", err);
      }
    }
    fetchPrices();
  }, []);

  // 通道一：你原本的 Crypto Bot（USDT）支付网关触发器
  const handleCryptoPay = async () => {
    if (!userId) {
      alert(t('auth_fail')); // 未检测到您的 Telegram 账号信息，降级通用报错或提示
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${BASE_URL}/vip/create_invoice`, {
        method: 'POST',
        headers: getAuthHeaders('application/json'),
        body: JSON.stringify({ telegram_id: String(userId) }) // 你的高级身份防御双保险
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
        // 轮询同步权益
        triggerPolling();
      }
    } catch (err) {
      alert(err.message || t('common_failed'));
    } finally {
      setLoading(false);
    }
  };

  // 通道二：核心新增 —— 官方 Stars 原生高安全级收银台
  const handleStarsPay = async () => {
    if (!userId) {
      alert(t('auth_fail'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // 强力校验：既走 getAuthHeaders 密文，又在 body 丢明文 ID 供后端强力交叉审计
      const response = await fetch(`${BASE_URL}/payment/create_stars_invoice`, {
        method: 'POST',
        headers: getAuthHeaders('application/json'),
        body: JSON.stringify({ telegram_id: String(userId) })
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || '创建官方发票失败');
      }
      
      const data = await response.json();
      if (data.status === 'success' && data.pay_url) {
        // ⭐ 原生大招：调用 TG 内置底层 API，唤起无需跳转的精致指纹支付弹窗
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

  // 你原本的轮询复用逻辑
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

          {/* 通道一：Crypto 支付按钮 */}
          <button
            onClick={handleCryptoPay}
            disabled={loading}
            className="mt-6 w-full rounded-2xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-md hover:bg-blue-700 disabled:bg-blue-300 flex justify-between items-center"
          >
            <span>{loading ? t('recharge_processing') : t('recharge_pay_crypto')}</span>
            <span className="bg-blue-700 px-2.5 py-0.5 rounded-lg text-xs font-black">{livePrices.crypto_usdt} USDT</span>
          </button>

          {/* 通道二：官方 Stars 支付按钮（自动计算并包含了30%溢价） */}
          <button
            onClick={handleStarsPay}
            disabled={loading}
            className="mt-3 w-full rounded-2xl bg-amber-500 px-4 py-3 text-sm font-bold text-white shadow-md hover:bg-amber-600 disabled:bg-amber-300 flex justify-between items-center"
          >
            <span>{loading ? t('recharge_activating') : t('recharge_pay_stars')}</span>
            <span className="bg-amber-600 px-2.5 py-0.5 rounded-lg text-xs font-black">⭐ {livePrices.tg_stars}</span>
          </button>
          
          <div className="pt-2 text-[10px] text-gray-400 text-center leading-normal">
            {t('recharge_tax_tip')}
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsScreen({ currentUser, onBack, onSave }) {
  // 👈 1. 引入官方多语言 Hook 实例
  const { t, i18n } = useTranslation();

  const [botToken, setBotToken] = useState(currentUser?.bot_token || '');
  const [language, setLanguage] = useState(currentUser?.language || 'en'); // 👈 默认强制初始化为 en
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const isVip = currentUser?.role === 'superuser' || (currentUser?.vip_until && Number(currentUser.vip_until) > Math.floor(Date.now() / 1000));
  const botInputDisabled = !isVip;

  const handleSave = async () => {
    if (!currentUser?.id) {
      alert('请先完成 Telegram 登录'); 
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        user_id: currentUser.id,
        language, // 这里就是用户在下拉菜单里选择的新语言 ('zh' 或 'en')
      };
      if (!botInputDisabled) {
        payload.bot_token = botToken;
      }

      const response = await fetch(`${BASE_URL}/user/update_settings`, {
        method: 'POST',
        headers: getAuthHeaders('application/json'),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || '保存设置失败');
      }
      
      const result = await response.json();
      
      // 👈 2. 【核心改动】：后端成功返回 ok 之后，立刻强制让前端 UI 变更为新选择的语言！
      i18n.changeLanguage(language);
      
      // 3. 将成功提示词改为字典里的 common_success（因为字典中无 settings_save_success 词条，通用 common_success）
      setMessage(t('common_success')); 
      
      // 4. 执行你原本的传值回调
      onSave(result);
    } catch (err) {
      console.error('保存设置失败:', err);
      // 5. 失败提示词改为字典里的 common_failed
      setMessage(t('common_failed'));
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
                disabled={botInputDisabled}
                className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-400 disabled:bg-slate-100"
                placeholder={t('settings_bot_token_placeholder')}
              />
              {!isVip && (
                <p className="mt-2 text-xs text-red-500">{t('settings_vip_only_bot')}</p >
              )}
              {currentUser?.bot_username && (
                <p className="mt-2 text-xs text-slate-500">{t('settings_current_bot')}{currentUser.bot_username}</p >
              )}
            </div>

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

  const emojiList = [
    "😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","🙃","😉","😌","😍","🥰","😘","😗","😙","😚","😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🤩","🥳","😏","😒","😞","😔","😟","😕","🙁","☹️","😣","😖","😫","😩","🥺","😢","😭","哼","😠","😡","🤬","🤯","😳","🥵","🥶","😱","😨","😰","😥","😓","🤗","🤔","🤭","🤫","🤥","😶","😐","😑","😬","🙄","😯","😦","😧","😮","😲","🥱","😴","🤤","😪","😵","🤐","🥴","🤢","🤮","🤧","😷","🤒","🤕","🤑","🤠","😈","👿","👹","👺","🤡","💩","👻","💀","☠️","👽","👾","🤖","🎃","😺","😸","😹","😻","😼","😽","🙀","😾"
  ];

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        horizontalRule: false,
        link: false,
        underline: false,
        code: {
          HTMLAttributes: {
            class: 'bg-gray-100 text-red-500 px-1.5 py-0.5 rounded font-mono text-sm cursor-pointer mx-0.5',
          },
        },
      }),
      Underline,
      SpoilerMark,
      Link.configure({ openOnClick: false, HTMLAttributes: { class: 'text-blue-500 underline pointer-events-none' } }),
      Placeholder.configure({ placeholder: t('editor_placeholder') }),
    ],
    content: cardToEdit ? cardToEdit.content : `<p>${t('editor_default_content')}</p >`,
    editorProps: {
      attributes: { class: 'focus:outline-none min-h-[140px] text-base leading-[1.4] text-[#000000] max-w-none break-words whitespace-pre-wrap font-sans' },
    },
  });

  // 处理图片或者视频文件（自动上传至后端并获取真实公网 URL）
   const handleMediaChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const previewUrl = URL.createObjectURL(file);
    
    // 1. 判断媒体类型：photo、video、gif
    let mediaType = 'photo';
    if (file.type.startsWith('video/')) {
      mediaType = 'video';
    } else if (file.name.toLowerCase().endsWith('.gif') || file.type === 'image/gif') {
      mediaType = 'gif';
    }

    // 设置本地预览状态，previewUrl 只用于前端预览
    setMediaFile({ previewUrl, type: mediaType, uploading: true, remoteUrl: null });

    try {
      let finalUrl = "";

      // 2. 核心分流机制：只有视频（video）走分片上传
      if (mediaType === 'video') {
        console.log('检测到视频文件，正在触发【分片上传】...');
        finalUrl = await uploadVideoInChunks(file);
      } else {
        // GIF 和普通图片（photo）统一走【普通单片上传】
        console.log(`检测到 ${mediaType}，正在触发【普通单片上传】...`);
        const formData = new FormData();
        formData.append('file', file); // 严格对应后端 upload_file 的 file

        const response = await fetch(`${BASE_URL}/upload`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: formData,
        });

        if (!response.ok) throw new Error(`普通上传失败：${response.status}`);
        const data = await response.json();
        if (!data?.url) throw new Error('后端返回无效上传地址');
        
        finalUrl = data.url;
      }

      // 3. 上传成功，统一更新状态，保存公网 URL 用于最终发布
      setMediaFile((prev) => ({
        ...prev,
        remoteUrl: finalUrl,
        previewUrl: prev.previewUrl,
        uploading: false,
      }));

    } catch (uploadError) {
      console.error('媒体文件上传失败:', uploadError);
      alert('媒体文件上传失败，请重试。');
      setMediaFile(null); // 上传失败时清除状态，防止误保存
    }
  };

  // 4. 视频分片上传专用辅助函数（直接依附在组件内部）
  const uploadVideoInChunks = async (file) => {
    const CHUNK_SIZE = 2 * 1024 * 1024; // 规定每片大小为 2MB
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    
    // 生成一个本次上传唯一的随机 ID
    const uploadId = `vid_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    let lastResponseData = null;

    // 循环切片并依次发送给后端
    for (let index = 0; index < totalChunks; index++) {
      const start = index * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end); // 物理切割文件

      // 严格按照 FastAPI 接口要求的 Form 字段进行数据封装
      const chunkFormData = new FormData();
      chunkFormData.append('file_chunk', chunk);        // 对应后端 file_chunk
      chunkFormData.append('chunk_index', index);       // 对应后端 chunk_index
      chunkFormData.append('total_chunks', totalChunks); // 对应后端 total_chunks
      chunkFormData.append('upload_id', uploadId);       // 对应后端 upload_id
      chunkFormData.append('filename', file.name);       // 对应后端 filename

      const response = await fetch(`${BASE_URL}/upload/chunk`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: chunkFormData
      });

      if (!response.ok) {
        throw new Error(`视频分片 [${index}/${totalChunks}] 上传失败`);
      }

      // 如果是最后一片，后端会执行合并并返回带有真实 URL 的 JSON
      if (index === totalChunks - 1) {
        lastResponseData = await response.json();
      } else {
        // 过程中的分片，后端只返回接收成功提示，我们继续循环
        await response.json();
      }
    }

    // 从最后一片的返回体中提取合并压缩后的真实公网 URL
    if (lastResponseData && lastResponseData.url) {
      return lastResponseData.url;
    } else {
      throw new Error('分片合并完成，但未能获取到最终的公网URL');
    }
  };

  const triggerPublish = () => {
    if (!editor) return;
    // 改为判断 uploading 状态，而不是只针对图片
    if (mediaFile?.uploading) {
      alert(t('editor_uploading_tip'));
      return;
    }

    const pureText = editor.getText().trim();
    const shortTitle = pureText.length > 0 
     ? (pureText.slice(0, 15) + (pureText.length > 15 ? "..." : "")) 
     : t('editor_unnamed_native');

    // 🟢 【终极修正】直接把原汁原味的、包含 text/type/value 的纯净矩阵传过去
    // 不要在前端自作聪明地做任何转型过滤，全部交给后端的强力编译器
    onPublish({
      id: cardToEdit ? cardToEdit.id : null,
      title: shortTitle, 
      status: cardToEdit ? cardToEdit.status : "未发布",
      content: editor.getHTML(),
      buttons: Array.isArray(buttons) ? buttons : [], // 🟢 保持最纯净的矩阵形态原样上报
      img: mediaFile?.remoteUrl || "",  // 禁止保存 blob URL，只保存公网地址或空字符串
      media_type: mediaFile?.type || 'photo',  // 同时保存媒体类型
      analytics: cardToEdit ? cardToEdit.analytics : { views: 0, shares: 0, likes: 0, clicks: 0 }
    });
  };

  // 🟢 核心整编重构：通过纯净的 actionId 来精准驱动底层富文本架构，不再绑定中文。
  const handleMenuActionById = (e, actionId) => {
    e.preventDefault(); e.stopPropagation();
    if (!editor) return;
    const { from, to } = editor.state.selection;

    switch (actionId) {
      case 'bold': editor.chain().toggleBold().run(); break;
      case 'italic': editor.chain().toggleItalic().run(); break;
      case 'underline': editor.chain().toggleUnderline().run(); break;
      case 'strike': editor.chain().toggleStrike().run(); break;
      case 'quote': editor.chain().toggleBlockquote().run(); break;
      case 'copy': editor.chain().focus().toggleCode().run(); break;
      case 'spoiler': editor.chain().focus().toggleMark('spoiler').run(); break;
      case 'clear': editor.chain().unsetAllMarks().clearNodes().run(); break;
      case 'emoji': setMenuView('emoji'); break;
      case 'link':
        if (from === to) { 
          alert('请先在编辑器中选中一段文字，再插入内嵌链接'); // 后续视需要加进字典
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
    // 如果是 inline 切换查询类型，自动规范化加上 @ 符号
    if (btnDraft.btnType === 'switch' && rawValue && !rawValue.startsWith('@')) {
      rawValue = `@${rawValue}`;
    }

    // 🚀【核心整编】前端只生成纯净的 text、type、value，让后端发布器和编译器去读
    const nextButton = {
      text: rawText || t('editor_unnamed_btn'),
      type: btnDraft.btnType || 'url',
      value: rawValue
    };
    // 更新按钮矩阵状态
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

  // 🟢 添加了固定的内部 id，label 使用 t() 映射
  const menuItems = [
    { id: "bold", icon: "B", label: t('editor_bold'), active: 'bold' }, 
    { id: "italic", icon: "I", label: t('editor_italic'), active: 'italic' },
    { id: "underline", icon: "U", label: t('editor_underline'), active: 'underline' }, 
    { id: "strike", icon: "S", label: t('editor_strike'), active: 'strike' },
    { id: "copy", icon: "📋", label: t('common_copy') }, 
    { id: "spoiler", icon: "🫥", label: t('editor_spoiler') },
    { id: "emoji", icon: "😀", label: t('editor_emoji') }, 
    { id: "link", icon: "🔗", label: t('editor_inline_link'), active: 'link' },
    { id: "button", icon: "🔘", label: t('editor_edit_btn') }, 
    { id: "external", icon: "↗", label: t('editor_external_link') },
    { id: "quote", icon: "—", label: t('editor_quote'), active: 'blockquote' }, 
    { id: "clear", icon: "扫", label: t('editor_clear_format') },
    { id: "undo", icon: "↩", label: t('editor_undo') }, 
    { id: "redo", icon: "↪", label: t('editor_redo') }
  ];

  return (
    <div className="flex flex-col h-screen bg-[#E7EBF0] text-gray-800 max-w-md mx-auto overflow-hidden relative border-x border-gray-200">
      <div className="flex items-center justify-between p-4 bg-white border-b shrink-0 z-30 shadow-sm">
        <span className="text-xl cursor-pointer text-gray-400 font-bold px-2" onClick={onBack}>{"<"}</span>
        <h1 className="text-sm font-bold text-gray-700">{t('editor_title')}</h1>
        <button onClick={triggerPublish} className="bg-blue-600 text-white px-4 py-1.5 rounded-full text-xs font-bold shadow-md active:scale-95 transition-transform">{t('editor_save_card')}</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-80">
        
        <div className="w-full max-w-[330px] mx-auto bg-white rounded-[15px] overflow-hidden shadow-sm border border-gray-100 flex flex-col">
          <div className="p-3 border-b border-gray-50 bg-slate-50/50 flex justify-between items-center">
            <span className="text-[11px] text-gray-400 font-bold">{t('editor_media_title')}</span>
            <button onClick={() => fileInputRef.current.click()} className="text-xs text-blue-500 font-bold hover:underline">
              {mediaFile ? t('editor_replace_media') : t('editor_add_media')}
            </button>
            <input type="file" ref={fileInputRef} onChange={handleMediaChange} accept="image/*,video/*" className="hidden" />
          </div>

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

          <div className="p-3 bg-white min-h-[140px]">
            <p className="mb-2 text-[10px] text-gray-400">{t('editor_btn_matrix_tip')}</p>
            <EditorContent editor={editor} onFocus={() => setShowMenu(false)} />
          </div>

          {buttons.length > 0 && (
            <div className="p-2 border-t border-gray-100 bg-white space-y-[1.5px]">
              {buttons.map((row, rowIndex) => (
                <div key={`row-${rowIndex}`} className="grid gap-[1.5px]" style={{ gridTemplateColumns: `repeat(${Math.max(1, row.length)}, 1fr)` }}>
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
        </div>

        {/* 悬浮主编辑呼起圆盘 */}
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center select-none">
          {showMenu && (
            <div className="mb-4 bg-white/95 backdrop-blur-md rounded-[24px] shadow-2xl border border-gray-200/80 p-3 w-[290px] grid grid-cols-4 gap-2 animate-in fade-in slide-in-from-bottom-4 duration-200 max-h-[220px] overflow-y-auto">
              {menuView === 'main' && menuItems.map((item, index) => (
                <button
                  key={index}
                  onClick={(e) => handleMenuActionById(e, item.id)} // 🟢 修改为基于固定 ID 的逻辑分发
                  className={`flex flex-col items-center justify-center p-2 rounded-xl transition-all active:scale-90 ${
                    item.active && editor?.isActive(item.active) ? 'bg-blue-50 text-blue-600 font-bold' : 'hover:bg-gray-50 text-gray-600'
                  }`}
                >
                  <span className="text-base mb-1">{item.icon}</span>
                  <span className="text-[10px] scale-90 tracking-tighter opacity-80">{item.label}</span>
                </button>
              ))}

              {menuView === 'grid' && (
                <div className="col-span-4 p-2 space-y-3 animate-in fade-in zoom-in-95 duration-150">
                  <div className="flex justify-between items-center border-b pb-1">
                    <span className="text-xs font-bold text-gray-700">{t('editor_config_matrix')}</span>
                    <span className="text-blue-500 text-xs cursor-pointer font-bold" onClick={() => setMenuView('main')}>{t('common_back')}</span>
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

              {menuView === 'link' && (
                <div className="col-span-4 p-2 space-y-3 animate-in fade-in zoom-in-95 duration-150">
                  <div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-700">{t('editor_insert_link_title')}</span><span className="text-gray-400 text-xs cursor-pointer" onClick={() => setMenuView('main')}>{t('common_cancel')}</span></div>
                  <input id="linkUrl" placeholder="https://..." className="w-full border-b py-1.5 text-xs outline-none text-blue-500" autoFocus />
                  <button onClick={() => { const url = document.getElementById('linkUrl').value; if (url) { editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run(); } setMenuView('main'); }} className="w-full bg-blue-600 text-white py-2 rounded-xl text-xs font-bold">{t('editor_confirm_insert')}</button>
                </div>
              )}

              {menuView === 'emoji' && (
                <div className="p-3 h-full overflow-y-auto col-span-4">
                  <div className="flex justify-between items-center pb-2 px-2 border-b mb-2 sticky top-0 bg-white"><span className="text-xs font-bold text-gray-700">{t('editor_common_emojis')}</span><span className="text-blue-500 text-xs font-bold cursor-pointer" onClick={() => setMenuView('main')}>{t('common_back')}</span></div>
                  <div className="grid grid-cols-8 gap-2 pb-10">
                    {emojiList.map((emoji, idx) => (
                      <button key={idx} onMouseDown={(e) => handleInsertEmoji(e, emoji)} className="text-lg hover:scale-125 transition-transform p-0.5">{emoji}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <button onClick={() => { setShowMenu(!showMenu); setMenuView('main'); }} className="bg-slate-900 text-white px-6 py-3 rounded-full flex items-center gap-2 shadow-xl border border-slate-800 active:scale-95 transition-transform font-bold text-xs tracking-wider">
            <span>🔘</span> {t('editor_btn_config_title')}
          </button>
        </div>
      </div>

      {/* 底部按钮配置行为高精弹窗 */}
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
                <input type="text" value={btnDraft.text} onChange={(e) => setBtnDraft({ ...btnDraft, text: e.target.value })} placeholder={t('editor_input_btn_text')} className="w-full border rounded-xl px-3 py-2.5 text-base outline-none focus:border-blue-500 bg-slate-50" />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1.5">{t('editor_btn_type')}</label>
                <select value={btnDraft.btnType} onChange={(e) => setBtnDraft({ ...btnDraft, btnType: e.target.value, value: '' })} className="w-full border rounded-xl px-3 py-2 text-xs outline-none bg-slate-50 focus:border-blue-500 font-medium">
                  <option value="url">{t('editor_btn_type_url')}</option>
                  <option value="web_app">{t('editor_btn_type_webapp')}</option>
                  <option value="share">{t('editor_btn_type_share')}</option>
                  <option value="callback">{t('editor_btn_type_callback')}</option>
                  <option value="switch">{t('editor_btn_type_switch')}</option>
                  <option value="pay">{t('editor_btn_type_pay')}</option>
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
                    className="w-full border rounded-xl px-3 py-2.5 text-base outline-none focus:border-blue-500 bg-slate-50 font-mono text-blue-600"
                  />
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowBtnModal(false)} className="flex-1 border py-2.5 rounded-xl text-xs font-bold text-gray-500 hover:bg-slate-50 active:scale-98 transition-transform">{t('common_cancel')}</button>
              <button onClick={saveButtonConfig} className="flex-1 bg-blue-600 text-white py-2.5 rounded-xl text-xs font-bold shadow-md shadow-blue-100 hover:bg-blue-700 active:scale-98 transition-transform">{t('common_confirm')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
   3. 全屏卡片预览页面组件 (PreviewScreen)
   ========================================================================== */
function PreviewScreen({ card, onBack }) {
  const { t } = useTranslation();
  if (!card) return null;
  useEffect(() => {
    if (card && card.id) {
      trackView(card.id);
    }
  }, [card && card.id]);
  return (
    <div className="flex flex-col h-screen bg-[#E7EBF0] max-w-md mx-auto overflow-hidden relative border-x border-gray-200">
      <div className="flex items-center justify-between p-4 bg-white border-b shrink-0 z-30 shadow-sm">
        <span className="text-xl cursor-pointer text-gray-400 font-bold px-2" onClick={onBack}>{"<"}</span>
        <h1 className="text-md font-medium text-gray-700">卡片效果预览</h1>
        <div className="w-10"></div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="text-center text-xs text-gray-400 my-2">今天</div>
        
        <div className="w-full bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100">
          {card.img && (
            <div className="w-full bg-black flex items-center justify-center">
              <img src={card.img} className="w-full max-h-[260px] object-contain" alt="" />
            </div>
          )}
          <div className="p-3 text-[15px] leading-[1.4] text-black break-words font-sans space-y-2 select-none">
            <div dangerouslySetInnerHTML={{ __html: card.content }} />
          </div>
          {card.buttons && card.buttons.length > 0 && (
            <div className="p-2 border-t border-gray-50 bg-white grid gap-1.5" style={{ gridTemplateColumns: `repeat(${card.buttons.length > 1 ? 2 : 1}, 1fr)` }}>
              {card.buttons.map(btn => (
                <a key={btn.id} href={btn.url || "#placeholder"} target="_blank" rel="noopener noreferrer" onClick={() => trackClick(card.id)} className="py-2 px-1 bg-[#F1F5F9] rounded-md text-center text-[13px] text-[#24A1DE] font-normal truncate block shadow-sm hover:bg-slate-100">
                  {btn.text}
                </a>
              ))}
            </div>
          )}
        </div>
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
          <p className="text-xs text-gray-400 mb-1">{t('analytics_analyzing_card')}</p >
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