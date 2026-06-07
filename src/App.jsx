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

export default function App() {
  // 页面路由状态：'home' | 'editor' | 'preview' | 'analytics' | 'recharge' | 'settings' | 'admin'
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

function AdminDashboard({ currentUser, onBack }) {
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

  const handlePublishAnnouncement = () => {
    if (!announcement.trim()) {
      return alert('请输入公告内容');
    }
    alert('全局公告已发布：' + announcement.trim());
    setAnnouncement('');
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
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1">
                        <div className="text-sm font-semibold text-white">{card.title || '未命名卡片'}</div>
                        <div className="text-xs text-slate-400">卡片 ID: {card.id}</div>
                        <div className="text-xs text-slate-400">创建者: {card.user_id || '未知'}</div>
                        <div className="text-xs text-slate-400">状态: <span className={`font-semibold ${isBanned ? 'text-rose-400' : 'text-emerald-300'}`}>{isBanned ? '已下架' : '正常'}</span></div>
                      </div>
                      <button onClick={() => handleToggleCardStatus(card.id)} disabled={submitting} className={`rounded-2xl px-3 py-2 text-xs font-semibold transition ${isBanned ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400' : 'bg-rose-500 text-white hover:bg-rose-400'}`}>
                        {isBanned ? '恢复卡片' : '下架卡片'}
                      </button>
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
          </div>
        )}
      </div>
    </div>
  );
}

/* ==========================================================================
   1. 首页组件 (HomeScreen)
   ========================================================================== */
function HomeScreen({ cards, setCards, fetchCards, currentUser, onNavigateEditor, onNavigateEditSpecific, onNavigatePreview, onNavigateAnalytics, onNavigateRecharge, onNavigateSettings, onNavigateAdmin }) {
  const [activeCardId, setActiveCardId] = useState(null);
  const [showUserMenu, setShowUserMenu] = useState(false); 
  const menuRef = useRef(null);

  // 保留原有 currentUser 状态不变，提供兼容的 `user` 别名以满足旧版逻辑引用
  const user = currentUser || null;
  const wxUsername = user?.username || "匿名用户";
  const wxRole = user ? (user.role === 'superuser' ? '超级管理员' : '普通用户') : '未登录';
  const vipStatus = user?.vip_until && Number(user.vip_until) > Math.floor(Date.now() / 1000) ? 'VIP 有效' : (user ? '普通用户' : '未登录');

  // 优先读取 user?.tg_id，其次回退到 Telegram WebApp initDataUnsafe 中的 id
  const telegramInitId = typeof window !== 'undefined' ? window.Telegram?.WebApp?.initDataUnsafe?.user?.id : null;
  const resolvedId = (user && user.tg_id) ? user.tg_id : (telegramInitId ? telegramInitId : null);
  const isAnonymous = (user && user.is_anonymous === true) || !resolvedId;
  const displayName = isAnonymous ? '匿名用户' : `ID: ${resolvedId}`;

  // VIP 标签：只有非匿名用户时展示
  const vipTag = !isAnonymous ? (user?.is_vip ? 'VIP' : '普通用户') : null;

  // 专属 Bot 状态（保持原变量名判断 user?.has_bot / user?.bot_username）
  const botStatus = isAnonymous
    ? { text: '正在等待 Telegram 授权登录...', className: 'text-gray-400' }
    : (user?.has_bot ? { text: `● 已绑定: @${user?.bot_username}`, className: 'text-emerald-500' } : { text: '○ 当前尚未绑定专属bot', className: 'text-amber-500' });

  const isAdmin = user?.role === 'admin' || user?.role === 'superuser';

  const toggleCardActions = (id) => {
    setActiveCardId(activeCardId === id ? null : id);
  };

  // 物理删除：对接后端 API
  const handleDeleteCard = async (id) => {
    if (window.confirm("确定要删除这张卡片并清除其所有链接和数据统计吗？")) {
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

  // 核心功能：点击发布直接触发 Python 后端驱动 Bot
  const handlePublishToTelegram = async (card) => {
    try {
      const response = await fetch(`${BASE_URL}/publish`, {
        method: 'POST',
        headers: getAuthHeaders('application/json'),
        body: JSON.stringify({
          cardId: card.id
        })
      });
      if (response.ok) {
        alert(`【发布成功】已经向后端发出指令！\n您的 Bot (@kongjing_service_bot) 正在将卡片《${card.title}》推送到目标频道/用户。`);
        fetchCards(); // 刷新列表，将卡片状态更新为“已发布”
      } else {
        alert("发布请求失败，请确保 Python 接口已正确部署。");
      }
    } catch (error) {
      console.error("发布通信故障:", error);
      alert(`【本地模拟发布】未连接到后端。发送的内容包含：\n标题: ${card.title}\n内嵌按钮数: ${card.buttons?.length}`);
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
                <FaCoins className="text-amber-500" /> 充值页面
              </button>
              <button onClick={() => { alert('消息中心暂未开放'); setShowUserMenu(false); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-semibold text-gray-700 hover:bg-slate-50 rounded-xl transition-colors">
                <FaBell className="text-blue-500" /> 消息中心
              </button>
              <button onClick={() => { alert('请查阅开发文档使用说明'); setShowUserMenu(false); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-semibold text-gray-700 hover:bg-slate-50 rounded-xl transition-colors">
                <FaBookOpen className="text-purple-500" /> 使用说明
              </button>
              <button onClick={() => { onNavigateSettings(); setShowUserMenu(false); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-semibold text-gray-700 hover:bg-slate-50 rounded-xl transition-colors">
                <FaLayerGroup className="text-indigo-500" /> 设置
              </button>
              <div className="h-px bg-gray-100 my-1 mx-2"></div>
              <button onClick={() => { alert('正在呼叫客服'); setShowUserMenu(false); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-semibold text-gray-700 hover:bg-slate-50 rounded-xl transition-colors">
                <FaHeadset className="text-emerald-500" /> 联系客服
              </button>
            </div>
          )}
        </div>
        <div className="text-right"><span className="text-[10px] bg-slate-100 font-bold text-slate-500 px-2 py-1 rounded-md">Console v1.2</span></div>
      </div>
      {/* 注：已将下方冗余的用户信息卡片移除，相关显示已整合至顶部 Header */}

      {isAdmin && (
        <div className="mx-4 mt-4 rounded-3xl border border-amber-400/40 bg-gradient-to-r from-amber-100/80 via-yellow-50 to-slate-50 p-4 shadow-lg shadow-amber-200/30">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-700">管理员专用</p>
              <p className="mt-1 text-sm font-bold text-slate-900">空境系统管理后台已开启</p>
            </div>
            <button
              onClick={onNavigateAdmin}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2 text-xs font-bold uppercase tracking-[0.15em] text-amber-200 shadow-lg shadow-slate-900/10 hover:bg-slate-800 transition"
            >
              <FaLock size={14} /> 进入后台
            </button>
          </div>
          <p className="mt-3 text-[11px] text-slate-500">仅限管理员访问。前端页面伪造无法绕过后端 `verify_admin` 权限校验。</p>
        </div>
      )}

      <div className="p-4 pb-12">
        <p className="text-[11px] text-gray-400 mt-2 mb-3 font-bold uppercase tracking-widest">选择卡片类型</p >
        <div className="flex flex-col gap-3 cursor-pointer" onClick={onNavigateEditor}>
          <div className="flex items-center p-4 bg-white border-2 border-blue-500 rounded-2xl gap-4 shadow-sm active:scale-[0.99] transition-all">
            <div className="bg-blue-600 p-3 rounded-xl text-white shadow-md"><FaLayerGroup size={20} /></div>
            <div>
              <p className="font-bold text-sm">原生卡片模式</p >
              <p className="text-xs text-gray-400">创建 Telegram 原生卡片</p >
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between mt-8 mb-4">
          <h2 className="font-bold text-gray-800 text-lg">我的卡片</h2>
          <span className="text-xs text-gray-400 font-bold px-2 py-1 bg-gray-100 rounded-lg">全部 {cards.length}</span>
        </div>

        {cards.length === 0 ? (
          <div className="text-center py-12 text-xs text-gray-400">暂无卡片数据，点击上方“原生卡片模式”创建一张吧</div>
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
                      <img src={card.img} className="w-20 h-20 object-cover rounded-xl shrink-0 bg-slate-100" alt="" />
                      : <img src={card.img || "https://picsum.photos/200/120?random=default"} className="w-20 h-20 object-cover rounded-xl shrink-0 bg-slate-100" alt="" />
                    }
                    <div className="flex-1 flex flex-col justify-between py-1">
                      <p className="font-bold text-sm text-gray-800 line-clamp-2">{card.title || "未命名卡片"}</p >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-gray-400 font-medium flex items-center gap-1"><FaEye /> {card.analytics?.views || 0}</span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${card.status === '已发布' ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600'}`}>{card.status}</span>
                      </div>
                    </div>
                  </div>

                  <div className={`flex border-t border-gray-50 bg-slate-50/50 transition-all duration-200 ${isExpanded ? 'h-11 opacity-100' : 'h-0 opacity-0 overflow-hidden pointer-events-none'}`}>
                    <button onClick={() => onNavigatePreview(card)} className="flex-1 text-center text-[11px] font-bold text-gray-600 flex items-center justify-center gap-1 border-r border-gray-100 hover:bg-gray-100/50 active:text-blue-500">
                      <FaEye size={11} className="text-gray-400" /> 预览
                    </button>
                    <button onClick={() => handlePublishToTelegram(card)} className="flex-1 text-center text-[11px] font-bold text-blue-600 flex items-center justify-center gap-1 border-r border-gray-100 hover:bg-blue-50/50 active:scale-95 transition-transform">
                      <FaPaperPlane size={10} className="text-blue-400" /> 发布
                    </button>
                    <button onClick={() => onNavigateAnalytics(card)} className="flex-1 text-center text-[11px] font-bold text-gray-600 flex items-center justify-center gap-1 border-r border-gray-100 hover:bg-gray-100/50 active:text-blue-500">
                      <FaChartBar size={11} className="text-gray-400" /> 数据
                    </button>
                    <button onClick={() => onNavigateEditSpecific(card)} className="flex-1 text-center text-[11px] font-bold text-gray-600 flex items-center justify-center gap-1 border-r border-gray-100 hover:bg-gray-100/50 active:text-blue-500">
                      <FaEdit size={11} className="text-gray-400" /> 修改
                    </button>
                    <button onClick={() => handleDeleteCard(card.id)} className="flex-1 text-center text-[11px] font-bold text-red-500 flex items-center justify-center gap-1 hover:bg-red-50/40">
                      <FaTrashAlt size={11} className="text-red-400" /> 删除
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
      alert('未检测到您的 Telegram 账号信息，请在 TG 客户端内重新打开小程序');
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
      alert(err.message || '网络连接异常');
    } finally {
      setLoading(false);
    }
  };

  // 通道二：核心新增 —— 官方 Stars 原生高安全级收银台
  const handleStarsPay = async () => {
    if (!userId) {
      alert('未检测到您的 Telegram 账号信息，请重新在 TG 内加载');
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
            alert("🎉 恭喜！您已成功通过官方星星完成订阅，VIP 权限已全自动秒级到账！");
            if (onRefreshUser) onRefreshUser();
            onBack();
          } else if (status === 'cancelled') {
            alert("💡 支付已取消");
          } else {
            alert("⚠️ 支付失败，请检查您的 Stars 账户余额。");
          }
        });
      }
    } catch (err) {
      alert(err.message || 'Stars 收银台连接故障');
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
        <button onClick={onBack} className="text-sm font-bold text-gray-700">← 返回</button>
        <span className="text-sm font-bold text-gray-800">多通道智能充值中心</span>
        <div className="w-8" />
      </div>
      <div className="p-4 space-y-4">
        <div className="bg-white rounded-3xl border border-gray-200 p-5 shadow-sm">
          <h2 className="text-lg font-bold text-gray-900">VIP 会员专属权限</h2>
          <p className="mt-3 text-sm text-gray-500 leading-6">开通后可绑定专属 Bot，解除非会员每月限制，享受无限原生裂变卡片发布权限。</p >
          <ul className="mt-4 space-y-3 text-sm text-gray-600">
            <li>• 自定义多租户独立专属 Bot</li>
            <li>• 无限次高级裂变卡片发布</li>
            <li>• 高级全维度柱状数据透视面板</li>
          </ul>
          
          {currentUser && (
            <div className="mt-4 rounded-2xl bg-slate-50 border border-slate-200 p-3 text-sm text-slate-700">
              当前用户：{currentUser.username || currentUser.telegram_id} / {currentUser.role === 'vip' ? '👑 VIP会员' : '普通用户'}
            </div>
          )}
          
          {error && <div className="mt-4 text-sm text-red-500">{error}</div>}

          {/* 通道一：Crypto 支付按钮 */}
          <button
            onClick={handleCryptoPay}
            disabled={loading}
            className="mt-6 w-full rounded-2xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-md hover:bg-blue-700 disabled:bg-blue-300 flex justify-between items-center"
          >
            <span>{loading ? '正在处理...' : '立即用 Crypto Bot 支付'}</span>
            <span className="bg-blue-700 px-2.5 py-0.5 rounded-lg text-xs font-black">{livePrices.crypto_usdt} USDT</span>
          </button>

          {/* 通道二：官方 Stars 支付按钮（自动计算并包含了30%溢价） */}
          <button
            onClick={handleStarsPay}
            disabled={loading}
            className="mt-3 w-full rounded-2xl bg-amber-500 px-4 py-3 text-sm font-bold text-white shadow-md hover:bg-amber-600 disabled:bg-amber-300 flex justify-between items-center"
          >
            <span>{loading ? '激活收银台...' : 'Telegram 官方原生支付'}</span>
            <span className="bg-amber-600 px-2.5 py-0.5 rounded-lg text-xs font-black">⭐️ {livePrices.tg_stars} Stars</span>
          </button>

          <p className="text-[11px] text-center text-gray-400 mt-4 font-medium">
            * 官方原生通道已包含苹果/安卓商店 30% 平台抽成税点补贴
          </p >
        </div>
      </div>
    </div>
  );
}

function SettingsScreen({ currentUser, onBack, onSave }) {
  const [botToken, setBotToken] = useState(currentUser?.bot_token || '');
  const [language, setLanguage] = useState(currentUser?.language || 'zh');
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
        language,
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
      setMessage('设置已保存');
      onSave(result);
    } catch (err) {
      console.error('保存设置失败:', err);
      setMessage(err.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full min-h-screen bg-slate-50 text-slate-900 font-sans">
      <div className="sticky top-0 w-full bg-white border-b border-gray-100 px-4 py-3 z-40 shadow-sm flex items-center justify-between">
        <button onClick={onBack} className="text-sm font-bold text-gray-700">← 返回</button>
        <span className="text-sm font-bold text-gray-800">设置</span>
        <div className="w-8" />
      </div>
      <div className="p-4 space-y-4">
        <div className="bg-white rounded-3xl border border-gray-200 p-5 shadow-sm">
          <h2 className="text-lg font-bold text-gray-900">账号设置</h2>
          <p className="mt-2 text-sm text-gray-500">在此处绑定您的专属 Bot，并选择界面语言。</p>

          <div className="mt-6 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-2">Bot 密钥设置</label>
              <input
                type="text"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                disabled={botInputDisabled}
                className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-400 disabled:bg-slate-100"
                placeholder="请输入专属 Bot Token"
              />
              {!isVip && (
                <p className="mt-2 text-xs text-red-500">仅限会员使用专属Bot</p>
              )}
              {currentUser?.bot_username && (
                <p className="mt-2 text-xs text-slate-500">当前绑定 Bot：@{currentUser.bot_username}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-2">语言设置</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-400"
              >
                <option value="zh">简体中文</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>

          {message && <div className="mt-4 rounded-2xl bg-slate-50 border border-slate-200 p-3 text-sm text-slate-700">{message}</div>}

          <button
            onClick={handleSave}
            disabled={saving}
            className="mt-6 w-full rounded-2xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-md hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            {saving ? '保存中...' : '保存设置'}
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
        text: btn?.text || btn?.label || '按钮',
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
      text: btn?.text || btn?.label || '按钮',
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
    "😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","🙃","😉","😌","😍","🥰","😘","😗","😙","😚","😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🤩","🥳","😏","😒","😞","😔","😟","😕","🙁","☹️","😣","😖","😫","😩","🥺","😢","😭","😤","😠","😡","🤬","🤯","😳","🥵","🥶","😱","😨","😰","😥","😓","🤗","🤔","🤭","🤫","🤥","😶","😐","😑","😬","🙄","😯","😦","😧","😮","😲","🥱","😴","🤤","😪","😵","🤐","🥴","🤢","🤮","🤧","😷","🤒","🤕","🤑","🤠","😈","👿","👹","👺","🤡","💩","👻","💀","☠️","👽","👾","🤖","🎃","😺","😸","😹","😻","😼","😽","🙀","😾"
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
      Placeholder.configure({ placeholder: '输入卡片正文内容...' }),
    ],
    content: cardToEdit ? cardToEdit.content : `<p>点击“+”配置下方按钮矩阵，发布后可统计数据...</p >`,
    editorProps: {
      attributes: { class: 'focus:outline-none min-h-[140px] text-[15px] leading-[1.4] text-[#000000] max-w-none break-words whitespace-pre-wrap font-sans' },
    },
  });

  // 处理图片或者视频文件（自动上传至后端并获取真实公网 URL）
  const handleMediaChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const previewUrl = URL.createObjectURL(file);
    
    // 判断媒体类型：photo、video、gif
    let mediaType = 'photo';
    if (file.type.startsWith('video/')) {
      mediaType = 'video';
    } else if (file.name.toLowerCase().endsWith('.gif') || file.type === 'image/gif') {
      mediaType = 'gif';
    }

    // 设置本地预览状态，previewUrl 只用于前端预览，不保存到数据库
    setMediaFile({ previewUrl, type: mediaType, uploading: true, remoteUrl: null });

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${BASE_URL}/upload`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`上传失败：${response.status}`);
      }

      const data = await response.json();
      if (!data?.url) {
        throw new Error('后端返回无效上传地址');
      }

      // 上传完成后，将公网 URL 保存到 remoteUrl，不再需要 previewUrl
      setMediaFile((prev) => ({
        ...prev,
        remoteUrl: data.url,  // 公网地址，用于数据库和发送到 Telegram
        previewUrl: prev.previewUrl,  // 保留 previewUrl 用于显示
        uploading: false,
      }));
    } catch (uploadError) {
      console.error('图片上传失败:', uploadError);
      alert('图片上传失败，请重试。');
      // 上传失败时，清除 mediaFile 防止误保存
      setMediaFile(null);
    }
  };

  const triggerPublish = () => {
    if (!editor) return;

    // 改为判断 uploading 状态，而不是只针对图片
    if (mediaFile?.uploading) {
      alert('媒体文件正在上传，请稍后再保存');
      return;
    }

    const pureText = editor.getText().trim();
    const shortTitle = pureText.length > 0 
     ? (pureText.slice(0, 15) + (pureText.length > 15 ? "..." : "")) 
     : "未命名原生卡片";

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

  const handleMenuAction = (e, label) => {
    e.preventDefault(); e.stopPropagation();
    if (!editor) return;
    const { from, to } = editor.state.selection;

    switch (label) {
      case '加粗': editor.chain().toggleBold().run(); break;
      case '斜体': editor.chain().toggleItalic().run(); break;
      case '下划线': editor.chain().toggleUnderline().run(); break;
      case '删除线': editor.chain().toggleStrike().run(); break;
      case '引用': editor.chain().toggleBlockquote().run(); break;
      case '一键复制': editor.chain().focus().toggleCode().run(); break;
      case '防剧透': editor.chain().focus().toggleMark('spoiler').run(); break;
      case '清除格式': editor.chain().unsetAllMarks().clearNodes().run(); break;
      case '表情': setMenuView('emoji'); break;
      case '内嵌链接':
        if (from === to) { alert('请先在编辑器中选中一段文字，再插入内嵌链接'); return; }
        setMenuView('link'); break;
      case '按钮': setMenuView('grid'); break;
      case '外部链接': setMenuView('grid'); break;
      case '撤销': editor.chain().undo().run(); break;
      case '重做': editor.chain().redo().run(); break;
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
        row.push({ text: `按钮 ${btnIndex + 1}`, url: 'https://t.me' });
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
      text: rawText || '按钮',
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

  const menuItems = [
    { icon: "B", label: "加粗", active: 'bold' }, { icon: "I", label: "斜体", active: 'italic' },
    { icon: "U", label: "下划线", active: 'underline' }, { icon: "S", label: "删除线", active: 'strike' },
    { icon: "📋", label: "一键复制" }, { icon: "🫥", label: "防剧透" },
    { icon: "😀", label: "表情" }, { icon: "🔗", label: "内嵌链接", active: 'link' },
    { icon: "🔘", label: "按钮" }, { icon: "↗", label: "外部链接" },
    { icon: "—", label: "引用", active: 'blockquote' }, { icon: "扫", label: "清除格式" },
    { icon: "↩", label: "撤销" }, { icon: "↪", label: "重做" }
  ];

  return (
    <div className="flex flex-col h-screen bg-[#E7EBF0] text-gray-800 max-w-md mx-auto overflow-hidden relative border-x border-gray-200">
      <div className="flex items-center justify-between p-4 bg-white border-b shrink-0 z-30 shadow-sm">
        <span className="text-xl cursor-pointer text-gray-400 font-bold px-2" onClick={onBack}>{"<"}</span>
        <h1 className="text-sm font-bold text-gray-700">原生卡片配置</h1>
        <button onClick={triggerPublish} className="bg-blue-600 text-white px-4 py-1.5 rounded-full text-xs font-bold shadow-md active:scale-95 transition-transform">保存卡片</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-80">
        <div className="w-full max-w-[330px] mx-auto bg-white rounded-[15px] overflow-hidden shadow-sm border border-gray-100 flex flex-col">
          <div className="p-3 border-b border-gray-50 bg-slate-50/50 flex justify-between items-center">
            <span className="text-[11px] text-gray-400 font-bold">TELEGRAM MEDIA FILE</span>
            <button onClick={() => fileInputRef.current.click()} className="text-xs text-blue-500 font-bold hover:underline">
              {mediaFile ? '替换素材' : '+ 添加图片/视频'}
            </button>
            <input type="file" ref={fileInputRef} onChange={handleMediaChange} accept="image/*,video/*" className="hidden" />
          </div>

          {mediaFile && (
            <div className="w-full max-h-[380px] min-h-[160px] min-w-[150px] bg-[#f4f4f7] relative flex items-center justify-center overflow-hidden">
              {mediaFile.type === 'video' ? <video src={mediaFile.previewUrl || mediaFile.remoteUrl} controls className="w-full h-full object-contain object-center" /> 
              : mediaFile.type === 'gif' ? <img src={mediaFile.previewUrl || mediaFile.remoteUrl} className="w-full h-full object-contain object-center" alt="" />
              : <img src={mediaFile.previewUrl || mediaFile.remoteUrl} className="w-full h-full object-contain object-center" alt="" />}
              <button onClick={() => setMediaFile(null)} className="absolute top-2 right-2 bg-black/60 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">✕</button>
            </div>
          )}

          <div className="p-3 bg-white min-h-[140px]">
            <p className="mb-2 text-[10px] text-gray-400">提示：点击代码可一键复制；选中文字后可开启防剧透。</p>
            <EditorContent editor={editor} onFocus={() => setShowMenu(false)} />
          </div>

          {buttons.length > 0 && (
            <div className="p-2 border-t border-gray-100 bg-white space-y-[1.5px]">
              {buttons.map((row, rowIndex) => (
                <div key={`row-${rowIndex}`} className="grid gap-[1.5px]" style={{ gridTemplateColumns: `repeat(${Math.max(1, row.length)}, 1fr)` }}>
                  {row.map((btn, colIndex) => {
                    const btnType = detectButtonType(btn);
                    const typeMeta = {
                      url: { icon: '🔗', label: '外链' },
                      web_app: { icon: '📱', label: '小程序' },
                      callback: { icon: '⚡', label: '交互' },
                      switch: { icon: '📣', label: '转发' },
                      pay: { icon: '💳', label: '支付' },
                    }[btnType] || { icon: '🔗', label: '外链' };
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
                        className={`py-2 px-1 rounded-md text-center text-[12px] font-semibold border transition-all cursor-pointer ${activeBtnKey === `${rowIndex}-${colIndex}` ? 'border-blue-500 bg-blue-50 text-blue-600' : 'bg-[#F1F5F9] border-transparent text-[#2481cc]'}`}>
                        <span className="mr-1">{typeMeta.icon}</span>{btn.text || '未命名'}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showBtnModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-sm rounded-[18px] bg-white border border-gray-100 shadow-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400 font-bold uppercase tracking-[0.25em]">按钮配置</p>
                <h3 className="text-sm font-bold text-gray-800">编辑当前按钮</h3>
              </div>
              <button type="button" onClick={() => setShowBtnModal(false)} className="text-xs text-gray-400">关闭</button>
            </div>

            <div className="space-y-2">
              <label className="block text-[11px] font-semibold text-gray-500">按钮文案</label>
              <input value={btnDraft.text} onChange={(e) => setBtnDraft((prev) => ({ ...prev, text: e.target.value }))} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400" placeholder="输入按钮文案" />
            </div>

            <div className="space-y-2">
              <label className="block text-[11px] font-semibold text-gray-500">按钮功能类型</label>
              <select value={btnDraft.btnType} onChange={(e) => setBtnDraft((prev) => ({ ...prev, btnType: e.target.value, value: '' }))} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400">
                <option value="url">url（普通外链）</option>
                <option value="web_app">web_app（内嵌小程序）</option>
                <option value="share">📢 内联裂变分享 (Share)</option>
                <option value="callback">callback（后台静默交互）</option>
                <option value="switch">switch（一键转发分享）</option>
                <option value="pay">pay（官方支付）</option>
              </select>
            </div>

            {btnDraft.btnType !== 'pay' && (
              <div className="space-y-2">
                <label className="block text-[11px] font-semibold text-gray-500">核心内容</label>
                <input value={btnDraft.value} onChange={(e) => setBtnDraft((prev) => ({ ...prev, value: e.target.value }))} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400" placeholder={btnDraft.btnType === 'callback' ? '输入纯指令，如 like_click' : btnDraft.btnType === 'switch' ? '输入频道名或 Bot 名' : '输入网址或链接'} />
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={() => setShowBtnModal(false)} className="px-3 py-2 rounded-xl text-xs font-semibold text-gray-500 bg-gray-100">取消</button>
              <button type="button" onClick={saveButtonConfig} className="px-3 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 shadow-md">保存</button>
            </div>
          </div>
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 bg-white border-t flex flex-col z-40 shadow-2xl transition-all duration-300">
        <div className="p-3 flex items-center gap-3 shrink-0 border-b border-gray-50">
          <div className="flex-1 bg-gray-100 rounded-full px-4 py-2 text-xs font-medium text-gray-400">
            {buttons.length > 0 ? `当前卡片已配置 ${buttons.length} 个底部矩阵按钮` : '点击右侧按钮配置卡片格式与底层矩阵...'}
          </div>
          <button 
            type="button" 
            onClick={() => { setShowMenu(!showMenu); setMenuView('main'); }} 
            className={`w-9 h-9 rounded-full border-2 flex items-center justify-center transition-all ${showMenu ? 'rotate-45 text-blue-500 border-blue-500 bg-blue-50' : 'text-gray-300 border-gray-200'}`}
          >
            <span className="text-xl font-light">+</span>
          </button>
        </div>

        <div className={`transition-all duration-300 bg-white overflow-hidden ${showMenu ? 'h-[250px]' : 'h-0'}`}>
          {menuView === 'main' && (
            <div className="grid grid-cols-4 gap-y-4 p-4 overflow-y-auto h-full">
              {menuItems.map((item, idx) => (
                <div key={idx} onMouseDown={(e) => handleMenuAction(e, item.label)} className="flex flex-col items-center gap-1 cursor-pointer">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-lg border ${item.active && editor?.isActive(item.active) ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-gray-50 text-gray-700 border-gray-100 hover:bg-gray-100'}`}>
                    {item.icon}
                  </div>
                  <span className="text-[10px] text-gray-400 font-medium">{item.label}</span>
                </div>
              ))}
            </div>
          )}

          {menuView === 'grid' && (
            <div className="p-5 space-y-4">
              <div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-700">配置底层 Inline 矩阵排布</span><span className="text-blue-500 text-xs font-bold cursor-pointer" onClick={() => setMenuView('main')}>返回</span></div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <p className="text-[10px] text-gray-400 mb-1">纵向排列 (行数)</p >
                  <input type="number" min="1" max="5" value={gridConfig.rows} onChange={e => setGridConfig({ ...gridConfig, rows: e.target.value })} className="w-full border-b pb-1 text-sm outline-none focus:border-blue-500 font-bold" />
                </div>
                <div className="flex-1">
                  <p className="text-[10px] text-gray-400 mb-1">横向均分 (列数)</p >
                  <input type="number" min="1" max="4" value={gridConfig.cols} onChange={e => setGridConfig({ ...gridConfig, cols: e.target.value })} className="w-full border-b pb-1 text-sm outline-none focus:border-blue-500 font-bold" />
                </div>
              </div>
              <button onClick={generateGrid} className="w-full bg-blue-600 text-white py-2 rounded-xl text-xs font-bold shadow-md shadow-blue-100">生成矩阵按钮组</button>
            </div>
          )}

          {menuView === 'editBtn' && (
            <div className="p-5 space-y-4">
              <div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-700">编辑特定按钮行为</span><span className="text-gray-400 text-xs cursor-pointer" onClick={() => { setActiveBtnId(null); setMenuView('main'); }}>完成</span></div>
              <div className="space-y-3">
                <input placeholder="按钮显示文案" value={buttons.find(b => b.id === activeBtnId)?.text || ''} onChange={e => setButtons(buttons.map(b => b.id === activeBtnId ? { ...b, text: e.target.value } : b))} className="w-full border-b py-1.5 text-xs outline-none" />
                <input placeholder="跳转 URL (如：https://t.me/...)" value={buttons.find(b => b.id === activeBtnId)?.url || ''} onChange={e => setButtons(buttons.map(b => b.id === activeBtnId ? { ...b, url: e.target.value } : b))} className="w-full border-b py-1.5 text-xs outline-none text-blue-500" />
              </div>
              <button onClick={() => { setButtons(buttons.filter(b => b.id !== activeBtnId)); setMenuView('main'); }} className="text-red-500 text-[10px] font-bold block pt-1">✕ 移除该按钮</button>
            </div>
          )}

          {menuView === 'link' && (
            <div className="p-5 space-y-4">
              <div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-700">给选中文本插入超链接</span><span className="text-gray-400 text-xs cursor-pointer" onClick={() => setMenuView('main')}>取消</span></div>
              <input id="linkUrl" placeholder="https://..." className="w-full border-b py-1.5 text-xs outline-none text-blue-500" autoFocus />
              <button onClick={() => { const url = document.getElementById('linkUrl').value; if (url) { editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run(); } setMenuView('main'); }} className="w-full bg-blue-600 text-white py-2 rounded-xl text-xs font-bold">确认嵌入</button>
            </div>
          )}

          {menuView === 'emoji' && (
            <div className="p-3 h-full overflow-y-auto">
              <div className="flex justify-between items-center pb-2 px-2 border-b mb-2 sticky top-0 bg-white"><span className="text-xs font-bold text-gray-700">常用快捷表情</span><span className="text-blue-500 text-xs font-bold cursor-pointer" onClick={() => setMenuView('main')}>返回</span></div>
              <div className="grid grid-cols-8 gap-2 pb-10">
                {emojiList.map((emoji, idx) => (
                  <button key={idx} onMouseDown={(e) => handleInsertEmoji(e, emoji)} className="text-xl p-1 hover:bg-gray-100 rounded-md active:scale-90 transition-transform">{emoji}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   3. 全屏卡片预览页面组件 (PreviewScreen)
   ========================================================================== */
function PreviewScreen({ card, onBack }) {
  if (!card) return null;
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
                <a key={btn.id} href={btn.url || "#placeholder"} target="_blank" rel="noopener noreferrer" className="py-2 px-1 bg-[#F1F5F9] rounded-md text-center text-[13px] text-[#24A1DE] font-normal truncate block shadow-sm hover:bg-slate-100">
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
  if (!card) return null;
  const { views = 0, shares = 0, likes = 0, clicks = 0 } = card.analytics || {};
  const maxVal = Math.max(views, shares, likes, clicks, 1);
  return (
    <div className="flex flex-col h-screen bg-slate-50 max-w-md mx-auto overflow-hidden relative border-x border-gray-200">
      <div className="flex items-center justify-between p-4 bg-white border-b shrink-0 z-30 shadow-sm">
        <span className="text-xl cursor-pointer text-gray-400 font-bold px-2" onClick={onBack}>{"<"}</span>
        <h1 className="text-md font-bold text-gray-800">卡片数据分析</h1>
        <div className="w-10"></div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <p className="text-xs text-gray-400 mb-1">正在分析的卡片：</p >
          <h2 className="text-base font-bold text-gray-800 line-clamp-1">{card.title}</h2>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3">
            <div className="p-3 bg-blue-50 text-blue-500 rounded-xl"><FaEye size={18} /></div>
            <div>
              <p className="text-[11px] text-gray-400 font-medium">浏览量</p >
              <p className="text-base font-bold text-gray-800">{views.toLocaleString()}</p >
            </div>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3">
            <div className="p-3 bg-green-50 text-green-500 rounded-xl"><FaShare size={18} /></div>
            <div>
              <p className="text-[11px] text-gray-400 font-medium">转发量</p >
              <p className="text-base font-bold text-gray-800">{shares.toLocaleString()}</p >
            </div>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3">
            <div className="p-3 bg-red-50 text-red-500 rounded-xl"><FaHeart size={18} /></div>
            <div>
              <p className="text-[11px] text-gray-400 font-medium">点赞量</p >
              <p className="text-base font-bold text-gray-800">{likes.toLocaleString()}</p >
            </div>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3">
            <div className="p-3 bg-purple-50 text-purple-500 rounded-xl"><FaMousePointer size={18} /></div>
            <div>
              <p className="text-[11px] text-gray-400 font-medium">按钮点击量</p >
              <p className="text-base font-bold text-gray-800">{clicks.toLocaleString()}</p >
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-gray-800 border-b pb-2">柱状比率图像统计</h3>
          <div className="space-y-3.5">
            {[['浏览量', views, 'bg-blue-500'], ['转发量', shares, 'bg-green-500'], ['点赞量', likes, 'bg-red-500'], ['按钮点击量', clicks, 'bg-purple-500']].map(([label, val, color]) => (
              <div key={label} className="space-y-1">
                <div className="flex justify-between text-xs font-medium"><span className="text-gray-500">{label}</span><span className="font-bold text-gray-700">{val}</span></div>
                <div className="w-full bg-gray-100 h-2.5 rounded-full overflow-hidden">
                  <div className={`${color} h-full rounded-full transition-all duration-500`} style={{ width: `${(val / maxVal) * 100}%` }}></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}