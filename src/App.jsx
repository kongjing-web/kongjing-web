// src/App.jsx
import React, { useState, useRef, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { FaLayerGroup, FaEye, FaShare, FaHeart, FaMousePointer, FaChartBar, FaTrashAlt, FaEdit } from "react-icons/fa";

export default function App() {
  // 页面路由状态：'home' | 'editor' | 'preview' | 'analytics'
  const [currentScreen, setCurrentScreen] = useState('home');
  // 当前正在被预览、修改或查看数据的卡片对象
  const [selectedCard, setSelectedCard] = useState(null);

  // 初始化带有模拟统计数据的卡片列表
  const [cards, setCards] = useState([
    { 
      id: 1, 
      title: "探索世界 发现美好", 
      status: "已发布", 
      img: "https://picsum.photos/200/120?random=1",
      content: "<p>这里是探索世界发现美好的原生卡片正文。包含精彩的导语和深度的行文解析。</p >",
      buttons: [{ id: 101, text: "了解详情", url: "https://t.me" }, { id: 102, text: "加入频道", url: "https://t.me" }],
      analytics: { views: 12500, shares: 3400, likes: 5600, clicks: 8900 }
    },
    { 
      id: 2, 
      title: "产品发布会邀请函", 
      status: "草稿", 
      img: "https://picsum.photos/200/120?random=2",
      content: "<p>诚挚邀请您参加 2026 年度全生态新品线上发布会，点击下方按钮回执。</p >",
      buttons: [{ id: 103, text: "在线预约", url: "https://t.me" }],
      analytics: { views: 8200, shares: 1200, likes: 2100, clicks: 4300 }
    },
  ]);

  // 处理发布/修改卡片的全局保存逻辑
  const handleSaveCard = (savedCard) => {
    const exists = cards.some(c => c.id === savedCard.id);
    if (exists) {
      // 修改逻辑：更新原有卡片
      setCards(cards.map(c => c.id === savedCard.id ? savedCard : c));
    } else {
      // 新建逻辑：置顶追加
      setCards([savedCard, ...cards]);
    }
    setCurrentScreen('home');
    setSelectedCard(null);
  };

  return (
    <div className="w-full min-h-screen bg-slate-50 text-slate-900 font-sans">
      {currentScreen === 'home' && (
        <HomeScreen 
          cards={cards} 
          setCards={setCards}
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
   1. 首页组件 (HomeScreen) - 已去掉顶部标题栏和底部导视栏
   ========================================================================== */
function HomeScreen({ cards, setCards, onNavigateEditor, onNavigateEditSpecific, onNavigatePreview, onNavigateAnalytics }) {
  // 记录当前点击并展开操作面板的卡片 ID
  const [activeCardId, setActiveCardId] = useState(null);

  const toggleCardActions = (id) => {
    setActiveCardId(activeCardId === id ? null : id);
  };

  const handleDeleteCard = (id) => {
    if (window.confirm("确定要删除这张卡片并清除其所有链接和数据统计吗？")) {
      setCards(cards.filter(c => c.id !== id));
      setActiveCardId(null);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto bg-slate-50 min-h-screen p-4 pb-12 border-x border-gray-200">
      {/* 依照细节一：去掉了原先的 sticky 顶部栏，页面直接从卡片选择区开始 */}
      <p className="text-[11px] text-gray-400 mt-2 mb-3 font-bold uppercase tracking-widest">选择卡片类型</p >
      
      <div className="flex flex-col gap-3 cursor-pointer" onClick={onNavigateEditor}>
        <div className="flex items-center p-4 bg-white border-2 border-blue-500 rounded-2xl gap-4 shadow-sm active:scale-[0.99] transition-all">
          <div className="bg-blue-600 p-3 rounded-xl text-white shadow-md">
            <FaLayerGroup size={20} />
          </div>
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

      {/* 卡片列表 */}
      <div className="flex flex-col gap-3">
        {cards.map((card) => {
          const isExpanded = activeCardId === card.id;
          return (
            <div key={card.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden transition-all">
              {/* 卡片主信息体 */}
              <div 
                className="flex gap-4 p-3 cursor-pointer active:bg-gray-50/80 transition-colors"
                onClick={() => toggleCardActions(card.id)}
              >
                <img src={card.img} className="w-20 h-20 object-cover rounded-xl shrink-0 bg-slate-100" alt="" />
                <div className="flex-1 flex flex-col justify-between py-1">
                  <p className="font-bold text-sm text-gray-800 line-clamp-2">{card.title || "未命名卡片"}</p >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-400 font-medium flex items-center gap-1">
                      <FaEye /> {card.analytics.views >= 1000 ? `${(card.analytics.views / 1000).toFixed(1)}k` : card.analytics.views}
                    </span>
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                      card.status === '已发布' ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600'
                    }`}>{card.status}</span>
                  </div>
                </div>
              </div>

              {/* 依照细节二：点击展开的四个一字排开的下沉动作按钮 */}
              <div className={`flex border-t border-gray-50 bg-slate-50/50 transition-all duration-200 ${
                isExpanded ? 'h-11 opacity-100' : 'h-0 opacity-0 overflow-hidden pointer-events-none'
              }`}>
                <button 
                  onClick={() => onNavigatePreview(card)}
                  className="flex-1 text-center text-xs font-medium text-gray-600 flex items-center justify-center gap-1.5 border-r border-gray-100 hover:bg-gray-100/50 active:text-blue-500"
                >
                  <FaEye className="text-gray-400" /> 预览
                </button>
                <button 
                  onClick={() => onNavigateAnalytics(card)}
                  className="flex-1 text-center text-xs font-medium text-gray-600 flex items-center justify-center gap-1.5 border-r border-gray-100 hover:bg-gray-100/50 active:text-blue-500"
                >
                  <FaChartBar className="text-gray-400" /> 数据
                </button>
                <button 
                  onClick={() => onNavigateEditSpecific(card)}
                  className="flex-1 text-center text-xs font-medium text-gray-600 flex items-center justify-center gap-1.5 border-r border-gray-100 hover:bg-gray-100/50 active:text-blue-500"
                >
                  <FaEdit className="text-gray-400" /> 修改
                </button>
                <button 
                  onClick={() => handleDeleteCard(card.id)}
                  className="flex-1 text-center text-xs font-medium text-red-500 flex items-center justify-center gap-1.5 hover:bg-red-50/40"
                >
                  <FaTrashAlt className="text-red-400" /> 删除
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {/* 依照细节一：去掉了底部的固定全局导航栏 (Footer) */}
    </div>
  );
}

/* ==========================================================================
   2. 细节三：全屏卡片预览页面组件 (PreviewScreen)
   ========================================================================== */
function PreviewScreen({ card, onBack }) {
  if (!card) return null;
  return (
    <div className="flex flex-col h-screen bg-[#E7EBF0] max-w-md mx-auto overflow-hidden relative border-x border-gray-200">
      {/* 顶栏 */}
      <div className="flex items-center justify-between p-4 bg-white border-b shrink-0 z-30 shadow-sm">
        <span className="text-xl cursor-pointer text-gray-400 font-bold px-2" onClick={onBack}>{"<"}</span>
        <h1 className="text-md font-medium text-gray-700">卡片效果预览</h1>
        <div className="w-10"></div>
      </div>

      {/* 1:1 模拟 Telegram 聊天视窗真实场景 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="text-center text-xs text-gray-400 my-2">今天</div>
        
        {/* TG 气泡容器 */}
        <div className="w-full bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100">
          {/* 配图/视频 */}
          {card.img && (
            <div className="w-full bg-black flex items-center justify-center">
              <img src={card.img} className="w-full max-h-[260px] object-contain" alt="TG Media" />
            </div>
          )}
          
          {/* 纯正格式化内容渲染 */}
          <div className="p-3 text-[15px] leading-[1.4] text-black break-words font-sans space-y-2 select-none">
            <div dangerouslySetInnerHTML={{ __html: card.content }} />
          </div>

          {/* 底置 Inline 按钮组 */}
          {card.buttons && card.buttons.length > 0 && (
            <div className="p-2 border-t border-gray-50 bg-white grid gap-1.5" style={{ 
              gridTemplateColumns: `repeat(${card.buttons.length > 1 ? 2 : 1}, 1fr)` 
            }}>
              {card.buttons.map(btn => (
                <a 
                  key={btn.id} 
                  href="#placeholder"
                  onClick={(e) => e.preventDefault()}
                  className="py-2 px-1 bg-[#F1F5F9] rounded-md text-center text-[13px] text-[#24A1DE] font-normal truncate block shadow-sm"
                >
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
   3. 细节四：数据统计可视化页面组件 (AnalyticsScreen)
   ========================================================================== */
function AnalyticsScreen({ card, onBack }) {
  if (!card) return null;
  const { views, shares, likes, clicks } = card.analytics;

  // 计算比率柱状图宽度的轻量辅助函数
  const maxVal = Math.max(views, shares, likes, clicks, 1);
  const getWidthPercent = (val) => `${(val / maxVal) * 100}%`;

  return (
    <div className="flex flex-col h-screen bg-slate-50 max-w-md mx-auto overflow-hidden relative border-x border-gray-200">
      {/* 顶栏 */}
      <div className="flex items-center justify-between p-4 bg-white border-b shrink-0 z-30 shadow-sm">
        <span className="text-xl cursor-pointer text-gray-400 font-bold px-2" onClick={onBack}>{"<"}</span>
        <h1 className="text-md font-bold text-gray-800">卡片数据分析</h1>
        <div className="w-10"></div>
      </div>

      {/* 统计指标报告看板 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <p className="text-xs text-gray-400 mb-1">正在分析的卡片：</p >
          <h2 className="text-base font-bold text-gray-800 line-clamp-1">{card.title}</h2>
        </div>

        {/* 核心数据四方格网 */}
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

        {/* 动态可视化图像统计条 */}
        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-gray-800 border-b pb-2">柱状比率图像统计</h3>
          
          <div className="space-y-3.5">
            {/* 浏览量柱 */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs font-medium"><span className="text-gray-500">浏览量</span><span className="font-bold text-gray-700">{views}</span></div>
              <div className="w-full bg-gray-100 h-2.5 rounded-full overflow-hidden">
                <div className="bg-blue-500 h-full rounded-full transition-all duration-500" style={{ width: getWidthPercent(views) }}></div>
              </div>
            </div>
            {/* 转发量柱 */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs font-medium"><span className="text-gray-500">转发量</span><span className="font-bold text-gray-700">{shares}</span></div>
              <div className="w-full bg-gray-100 h-2.5 rounded-full overflow-hidden">
                <div className="bg-green-500 h-full rounded-full transition-all duration-500" style={{ width: getWidthPercent(shares) }}></div>
              </div>
            </div>
            {/* 点赞量柱 */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs font-medium"><span className="text-gray-500">点赞量</span><span className="font-bold text-gray-700">{likes}</span></div>
              <div className="w-full bg-gray-100 h-2.5 rounded-full overflow-hidden">
                <div className="bg-red-500 h-full rounded-full transition-all duration-500" style={{ width: getWidthPercent(likes) }}></div>
              </div>
            </div>
            {/* 点击量柱 */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs font-medium"><span className="text-gray-500">按钮点击量</span><span className="font-bold text-gray-700">{clicks}</span></div>
              <div className="w-full bg-gray-100 h-2.5 rounded-full overflow-hidden">
                <div className="bg-purple-500 h-full rounded-full transition-all duration-500" style={{ width: getWidthPercent(clicks) }}></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   4. 高级编辑器组件 (EditorScreen) - 支持对选中特定卡片进行二次数据回填修改
   ========================================================================== */
function EditorScreen({ cardToEdit, onBack, onPublish }) {
  const [showMenu, setShowMenu] = useState(false);
  const [menuView, setMenuView] = useState('main'); 
  const [buttons, setButtons] = useState(cardToEdit ? cardToEdit.buttons : []); 
  const [activeBtnId, setActiveBtnId] = useState(null);
  const [gridConfig, setGridConfig] = useState({ rows: 1, cols: 2 });
  const [mediaFile, setMediaFile] = useState(cardToEdit && cardToEdit.img ? { url: cardToEdit.img, type: 'image' } : null); 
  
  const fileInputRef = useRef(null);
  const scrollContainerRef = useRef(null);

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

  // 监控光标滚动位置
  useEffect(() => {
    if (!editor) return;
    const handleSelectionUpdate = () => {
      setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        if (rect.top > 0 && rect.bottom > (window.innerHeight * 0.45)) {
          scrollContainerRef.current?.scrollBy({ top: rect.bottom - (window.innerHeight * 0.45) + 40, behavior: 'smooth' });
        }
      }, 150);
    };
    editor.on('selectionUpdate', handleSelectionUpdate);
    return () => { editor.off('selectionUpdate', handleSelectionUpdate); };
  }, [editor]);

  const handleMediaChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setMediaFile({ url, type: file.type.startsWith('video') ? 'video' : 'image' });
    }
  };

  const triggerPublish = () => {
    if (!editor) return;
    const pureText = editor.getText().trim();
    const title = pureText.length > 0 ? pureText : "未命名 Telegram 原生卡片";
    
    // 整合提交包
    const finalCard = {
      id: cardToEdit ? cardToEdit.id : Date.now(), // 维持原本的ID或者是分配全新ID
      title: title,
      status: "已发布",
      content: editor.getHTML(),
      buttons: buttons,
      img: mediaFile?.url || "https://picsum.photos/200/120?random=" + Math.floor(Math.random() * 100),
      // 保持原有数据流不受改动，如果是新卡片则配初始值
      analytics: cardToEdit ? cardToEdit.analytics : { views: 0, shares: 0, likes: 0, clicks: 0 }
    };

    onPublish(finalCard);
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
    if (editor) editor.chain().insertContent(emoji).focus().run();
  };

  const generateGrid = () => {
    const newBtns = [];
    for (let i = 0; i < (parseInt(gridConfig.rows) || 1) * (parseInt(gridConfig.cols) || 2); i++) {
      newBtns.push({ id: Date.now() + i, text: `按钮 ${i + 1}`, url: '' });
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
      {/* 编辑器顶栏 */}
      <div className="flex items-center justify-between p-4 bg-white border-b shrink-0 z-30 shadow-sm">
        <span className="text-xl cursor-pointer text-gray-400 font-bold px-2" onClick={onBack}>{"<"}</span>
        <h1 className="text-md font-medium text-gray-700">{cardToEdit ? "修改原生卡片" : "高级内容编辑"}</h1>
        <button onClick={triggerPublish} className="bg-[#24A1DE] text-white px-4 py-1 rounded-full text-sm font-bold shadow-md shadow-blue-100">保存</button>
      </div>

      {/* 主体画布滚动区 */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-3 space-y-3 pb-[320px] scroll-smooth">
        {/* 媒体导入框 */}
        <div className="w-full bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm relative">
          <input type="file" accept="image/*,video/*" ref={fileInputRef} onChange={handleMediaChange} className="hidden" />
          {!mediaFile ? (
            <div onClick={() => fileInputRef.current.click()} className="w-full h-44 bg-gray-50 flex flex-col items-center justify-center gap-2 cursor-pointer">
              <span className="text-2xl text-gray-300">+</span>
              <span className="text-xs text-gray-400">导入卡片配图 / 视频</span>
            </div>
          ) : (
            <div className="relative w-full bg-black flex items-center justify-center">
              {mediaFile.type === 'image' ? <img src={mediaFile.url} className="w-full max-h-[240px] object-contain" alt="" /> : <video src={mediaFile.url} controls className="w-full max-h-[240px] object-contain" />}
              <button onClick={() => setMediaFile(null)} className="absolute top-2 right-2 bg-black/60 text-white w-6 h-6 rounded-full text-xs">✕</button>
            </div>
          )}
        </div>

        {/* Telegram 仿真气泡 */}
        <div className="bg-white rounded-2xl p-3 shadow-sm border border-gray-100 min-h-[160px]">
          <EditorContent editor={editor} onFocus={() => setShowMenu(false)} />
          {buttons.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100" style={{ display: 'grid', gridTemplateColumns: `repeat(${gridConfig.cols}, 1fr)`, gap: '5px' }}>
              {buttons.map(btn => (
                <div key={btn.id} onClick={() => { setActiveBtnId(btn.id); setMenuView('editBtn'); setShowMenu(true); }} className={`py-2 px-1 rounded-md text-center text-[13px] border truncate cursor-pointer ${activeBtnId === btn.id ? 'border-[#24A1DE] bg-blue-50 text-[#24A1DE]' : 'bg-[#F1F5F9] border-transparent text-[#24A1DE]'}`}>
                  {btn.text || "未命名按钮"}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 底部输入面板 */}
      <div className="absolute bottom-0 left-0 right-0 bg-white border-t p-3 flex flex-col z-20 shadow-lg">
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex-1 bg-gray-100 rounded-full px-4 py-2 text-xs text-gray-400">
            {buttons.length > 0 ? `已配置 ${buttons.length} 个底部矩阵按钮` : '点击右侧 + 配置卡片底层按钮'}
          </div>
          <button type="button" onMouseDown={(e) => { e.preventDefault(); if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); setShowMenu(!showMenu); setMenuView('main'); }} className={`w-9 h-9 rounded-full border flex items-center justify-center transition-all ${showMenu ? 'rotate-45 text-[#24A1DE] border-[#24A1DE] bg-blue-50' : 'text-gray-400 border-gray-200'}`}>
            <span className="text-xl">+</span>
          </button>
        </div>

        {/* 动态抽屉二级面板 */}
        <div className={`transition-all duration-200 overflow-y-auto ${showMenu ? 'h-[240px] mt-3' : 'h-0'}`}>
          {menuView === 'main' && (
            <div className="grid grid-cols-4 gap-y-4 p-2">
              {menuItems.map((item, idx) => (
                <div key={idx} onMouseDown={(e) => handleMenuAction(e, item.label)} className="flex flex-col items-center gap-1 active:scale-95 transition-all cursor-pointer">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-lg border ${item.active && editor?.isActive(item.active) ? 'bg-[#24A1DE] text-white border-transparent' : 'bg-gray-50 text-gray-600 border-gray-100'}`}>{item.icon}</div>
                  <span className="text-[10px] text-gray-400">{item.label}</span>
                </div>
              ))}
            </div>
          )}

          {menuView === 'emoji' && (
            <div className="p-2 h-full flex flex-col">
              <div className="flex justify-between items-center pb-2 border-b shrink-0"><span className="text-sm font-bold">常用表情</span><span className="text-[#24A1DE] text-xs cursor-pointer" onClick={()=>setMenuView('main')}>返回</span></div>
              <div className="flex-1 overflow-y-auto pt-2 grid grid-cols-8 gap-y-3 text-center">
                {emojiList.map((emoji, index) => (
                  <button key={index} type="button" onMouseDown={(e) => handleInsertEmoji(e, emoji)} className="text-2xl hover:scale-125 active:scale-90 outline-none">{emoji}</button>
                ))}
              </div>
            </div>
          )}

          {menuView === 'grid' && (
            <div className="p-2 space-y-4">
              <div className="flex justify-between items-center"><span className="text-sm font-bold">配置 Inline 按钮阵列</span><span className="text-[#24A1DE] text-xs cursor-pointer" onClick={()=>setMenuView('main')}>返回</span></div>
              <div className="flex gap-4">
                <div className="flex-1"><p className="text-[10px] text-gray-400 mb-1">行数</p ><input type="number" value={gridConfig.rows} onChange={e=>setGridConfig({...gridConfig, rows: e.target.value})} className="w-full border-b pb-1 outline-none text-base focus:border-[#24A1DE]" /></div>
                <div className="flex-1"><p className="text-[10px] text-gray-400 mb-1">列数</p ><input type="number" value={gridConfig.cols} onChange={e=>setGridConfig({...gridConfig, cols: e.target.value})} className="w-full border-b pb-1 outline-none text-base focus:border-[#24A1DE]" /></div>
              </div>
              <button onClick={generateGrid} className="w-full bg-[#24A1DE] text-white py-2.5 rounded-xl text-sm font-medium">生成矩阵</button>
            </div>
          )}

          {menuView === 'editBtn' && (
            <div className="p-2 space-y-4">
              <div className="flex justify-between items-center"><span className="text-sm font-bold text-[#24A1DE]">编辑按钮参数</span><span className="text-gray-500 text-xs cursor-pointer" onClick={()=>setMenuView('main')}>完成</span></div>
              <div className="space-y-3">
                <input placeholder="按钮文本" value={buttons.find(b=>b.id===activeBtnId)?.text || ''} onChange={e => setButtons(buttons.map(b => b.id === activeBtnId ? {...b, text: e.target.value} : b))} className="w-full border-b py-1.5 text-sm outline-none" />
                <input placeholder="跳转 URL" value={buttons.find(b=>b.id===activeBtnId)?.url || ''} onChange={e => setButtons(buttons.map(b => b.id === activeBtnId ? {...b, url: e.target.value} : b))} className="w-full border-b py-1.5 text-sm outline-none text-blue-500" />
              </div>
              <button onClick={() => {setButtons(buttons.filter(b=>b.id!==activeBtnId)); setMenuView('main');}} className="text-red-500 text-xs block pt-1">删除按钮</button>
            </div>
          )}

          {menuView === 'link' && (
            <div className="p-2 space-y-4">
              <div className="flex justify-between items-center"><span className="text-sm font-bold">插入文本超链接</span><span className="text-gray-400 text-xs cursor-pointer" onClick={()=>setMenuView('main')}>取消</span></div>
              <input id="linkUrl" placeholder="https://..." className="w-full border-b py-1.5 text-sm outline-none text-blue-500" autoFocus />
              <button onClick={() => { const url = document.getElementById('linkUrl').value; if(url) editor.chain().focus().setLink({ href: url }).run(); setMenuView('main'); }} className="w-full bg-black text-white py-2.5 rounded-xl text-sm font-medium">确认插入</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}