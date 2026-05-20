import React, { useState, useRef, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { 
  FaLayerGroup, FaEye, FaShare, FaHeart, FaMousePointer, 
  FaChartBar, FaTrashAlt, FaEdit, FaChevronDown,
  FaCoins, FaBell, FaBookOpen, FaHeadset, FaPaperPlane
} from "react-icons/fa";

// ==========================================================================
// 后端配置中心
// ==========================================================================
const BASE_URL = "https://www.kongjing.online:8443"; // 对应你的服务器域名，请根据 Python 路由自行调整后缀

export default function App() {
  // 页面路由状态：'home' | 'editor' | 'preview' | 'analytics'
  const [currentScreen, setCurrentScreen] = useState('home');
  // 当前正在被操作的卡片对象
  const [selectedCard, setSelectedCard] = useState(null);
  // 卡片数据流（初始化为空，从后端动态加载）
  const [cards, setCards] = useState([]);
  // 全局加载状态
  const [loading, setLoading] = useState(false);

  // 1. 从 Python 后端获取所有卡片列表
  const fetchCards = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${BASE_URL}/cards`);
      if (response.ok) {
        const data = await response.json();
        setCards(data);
      } else {
        console.error("加载卡片失败");
      }
    } catch (error) {
      console.error("网络异常，无法连接到后端服务器:", error);
    } finally {
      setLoading(false);
    }
  };

  // 页面加载时自动同步
  useEffect(() => {
    fetchCards();
  }, []);

  // 2. 保存或更新卡片（处理新建/编辑逻辑）
  const handleSaveCard = async (savedCard) => {
    setLoading(true);
    const isEdit = cards.some(c => c.id === savedCard.id);
    const url = isEdit ? `${BASE_URL}/cards/${savedCard.id}` : `${BASE_URL}/cards`;
    const method = isEdit ? 'PUT' : 'POST';

    try {
      const response = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(savedCard)
      });

      if (response.ok) {
        // 保存成功后，重新刷一遍后端最新数据，保证状态同步
        await fetchCards();
        setCurrentScreen('home');
        setSelectedCard(null);
      } else {
        alert("存储失败，请检查 Python 后端服务。");
      }
    } catch (error) {
      console.error("请求失败:", error);
      alert("连接服务器失败，已为您在本地临时更新。");
      // 降级容错：若后端挂了，本地依然假装成功以维持体验
      if (isEdit) {
        setCards(cards.map(c => c.id === savedCard.id ? savedCard : c));
      } else {
        setCards([savedCard, ...cards]);
      }
      setCurrentScreen('home');
      setSelectedCard(null);
    } finally {
      setLoading(false);
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
          onNavigateEditor={() => { setSelectedCard(null); setCurrentScreen('editor'); }} 
          onNavigateEditSpecific={(card) => { setSelectedCard(card); setCurrentScreen('editor'); }}
          onNavigatePreview={(card) => { setSelectedCard(card); setCurrentScreen('preview'); }}
          onNavigateAnalytics={(card) => { setSelectedCard(card); setCurrentScreen('analytics'); }}
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

/* ==========================================================================
   1. 首页组件 (HomeScreen)
   ========================================================================== */
function HomeScreen({ cards, setCards, fetchCards, onNavigateEditor, onNavigateEditSpecific, onNavigatePreview, onNavigateAnalytics }) {
  const [activeCardId, setActiveCardId] = useState(null);
  const [showUserMenu, setShowUserMenu] = useState(false); 
  const menuRef = useRef(null);

  const wxUsername = "水中的观景房";

  const toggleCardActions = (id) => {
    setActiveCardId(activeCardId === id ? null : id);
  };

  // 物理删除：对接后端 API
  const handleDeleteCard = async (id) => {
    if (window.confirm("确定要删除这张卡片并清除其所有链接和数据统计吗？")) {
      try {
        const response = await fetch(`${BASE_URL}/cards/${id}`, { method: 'DELETE' });
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cardId: card.id,
          botToken: "8732461104:AAHiXL_2QzqHFRg2zfdvews2J5RDW2KWieA", // 直接交给后端或由后端默认配置
          botName: "kongjing_service_bot"
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
              <span className="text-xs font-bold text-gray-800 flex items-center gap-1">
                {wxUsername} <FaChevronDown size={8} className={`text-gray-400 transition-transform ${showUserMenu ? 'rotate-180' : ''}`} />
              </span>
              <span className="text-[9px] text-green-500 font-medium">微信已授权</span>
            </div>
          </div>

          {showUserMenu && (
            <div className="absolute left-0 mt-2 w-44 bg-white rounded-2xl shadow-xl border border-gray-100 p-1.5 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
              <button onClick={() => { alert('充值中心暂未开放'); setShowUserMenu(false); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-semibold text-gray-700 hover:bg-slate-50 rounded-xl transition-colors">
                <FaCoins className="text-amber-500" /> 充值页面
              </button>
              <button onClick={() => { alert('消息中心暂未开放'); setShowUserMenu(false); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-semibold text-gray-700 hover:bg-slate-50 rounded-xl transition-colors">
                <FaBell className="text-blue-500" /> 消息中心
              </button>
              <button onClick={() => { alert('请查阅开发文档使用说明'); setShowUserMenu(false); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-semibold text-gray-700 hover:bg-slate-50 rounded-xl transition-colors">
                <FaBookOpen className="text-purple-500" /> 使用说明
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
                    <img src={card.img || "https://picsum.photos/200/120?random=default"} className="w-20 h-20 object-cover rounded-xl shrink-0 bg-slate-100" alt="" />
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

/* ==========================================================================
   2. 原生卡片配置/高级内容编辑器 (EditorScreen)
   ========================================================================== */
function EditorScreen({ cardToEdit, onBack, onPublish }) {
  const [showMenu, setShowMenu] = useState(false);
  const [menuView, setMenuView] = useState('main'); 
  const [buttons, setButtons] = useState(cardToEdit ? cardToEdit.buttons : []); 
  const [activeBtnId, setActiveBtnId] = useState(null);
  const [gridConfig, setGridConfig] = useState({ rows: 1, cols: 2 });
  const [mediaFile, setMediaFile] = useState(cardToEdit && cardToEdit.img ? { url: cardToEdit.img, type: 'image' } : null); 
  
  const fileInputRef = useRef(null);
  const emojiList = [
    "😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","🙃","😉","😌","😍","🥰","😘","😗","😙","😚","😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🤩","🥳","😏","😒","😞","😔","😟","😕","🙁","☹️","😣","😖","😫","😩","🥺","😢","😭","😤","😠","😡","🤬","🤯","😳","🥵","🥶","😱","😨","😰","😥","😓","🤗","🤔","🤭","🤫","🤥","😶","😐","😑","😬","🙄","😯","😦","😧","😮","😲","🥱","😴","🤤","😪","😵","🤐","🥴","🤢","🤮","🤧","😷","🤒","🤕","🤑","🤠","😈","👿","👹","👺","🤡","💩","👻","💀","☠️","👽","👾","🤖","🎃","😺","😸","😹","😻","😼","😽","🙀","😾"
  ];
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, horizontalRule: false }),
      Underline,
      Link.configure({ openOnClick: false, HTMLAttributes: { class: 'text-blue-500 underline pointer-events-none' } }),
      Placeholder.configure({ placeholder: '输入卡片正文内容...' }),
    ],
    content: cardToEdit ? cardToEdit.content : `<p>点击“+”配置下方按钮矩阵，发布后可统计数据...</p >`,
    editorProps: {
      attributes: { class: 'focus:outline-none min-h-[140px] text-[15px] leading-[1.4] text-[#000000] max-w-none break-words whitespace-pre-wrap font-sans' },
    },
  });

  // 处理图片或者视频文件（在生产环境下，此处可以改为直接把 File 上传至 Python 后端生成真实 URL）
  const handleMediaChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setMediaFile({ url: URL.createObjectURL(file), type: file.type.startsWith('video') ? 'video' : 'image' });
    }
  };

  const triggerPublish = () => {
    if (!editor) return;
    const pureText = editor.getText().trim();
    onPublish({
      id: cardToEdit ? cardToEdit.id : Date.now(),
      title: pureText.length > 0 ? pureText : "未命名 Telegram 原生卡片",
      status: cardToEdit ? cardToEdit.status : "草稿", // 新建默认为草稿，在首页点击发布按钮后改为“已发布”
      content: editor.getHTML(),
      buttons: buttons,
      img: mediaFile?.url || "https://picsum.photos/200/120?random=" + Math.floor(Math.random() * 100),
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
    const newBtns = [];
    for (let i = 0; i < (parseInt(gridConfig.rows) || 1) * (parseInt(gridConfig.cols) || 2); i++) {
      newBtns.push({ id: Date.now() + i, text: `按钮 ${i + 1}`, url: 'https://t.me' });
    }
    setButtons(newBtns);
    setMenuView('main');
  };

  const menuItems = [
    { icon: "B", label: "加粗", active: 'bold' }, { icon: "I", label: "斜体", active: 'italic' },
    { icon: "U", label: "下划线", active: 'underline' }, { icon: "S", label: "删除线", active: 'strike' },
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
        <div className="w-full bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100 relative">
          <div className="p-3 border-b border-gray-50 bg-slate-50/50 flex justify-between items-center">
            <span className="text-[11px] text-gray-400 font-bold">TELEGRAM MEDIA FILE</span>
            <button onClick={() => fileInputRef.current.click()} className="text-xs text-blue-500 font-bold hover:underline">
              {mediaFile ? '替换素材' : '+ 添加图片/视频'}
            </button>
            <input type="file" ref={fileInputRef} onChange={handleMediaChange} accept="image/*,video/*" className="hidden" />
          </div>

          {mediaFile && (
            <div className="w-full bg-black relative flex items-center justify-center max-h-[220px] overflow-hidden">
              {mediaFile.type === 'video' ? <video src={mediaFile.url} controls className="w-full max-h-[220px] object-contain" /> 
              : <img src={mediaFile.url} className="w-full max-h-[220px] object-contain" alt="" />}
              <button onClick={() => setMediaFile(null)} className="absolute top-2 right-2 bg-black/60 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">✕</button>
            </div>
          )}

          <div className="p-4 bg-white min-h-[160px]">
            <EditorContent editor={editor} onFocus={() => setShowMenu(false)} />
          </div>

          {buttons.length > 0 && (
            <div className="p-2.5 border-t border-gray-50 bg-slate-50/50 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${gridConfig.cols}, 1fr)` }}>
              {buttons.map(btn => (
                <div 
                  key={btn.id} 
                  onClick={() => { setActiveBtnId(btn.id); setMenuView('editBtn'); setShowMenu(true); }}
                  className={`py-1.5 px-1 rounded-md text-center text-xs font-bold border transition-all cursor-pointer ${activeBtnId === btn.id ? 'border-blue-500 bg-blue-50 text-blue-600' : 'bg-white border-gray-200 text-gray-500'}`}
                >
                  {btn.text || "未命名"}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

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