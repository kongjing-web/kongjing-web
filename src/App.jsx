// src/App.jsx
import React, { useState, useRef, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { FaHome, FaPlus, FaLayerGroup, FaUser, FaChartBar, FaThLarge } from "react-icons/fa";

export default function App() {
  // 页面路由状态：'home' | 'editor'
  const [currentScreen, setCurrentScreen] = useState('home');

  // 全局卡片列表数据统计状态
  const [cards, setCards] = useState([
    { id: 1, title: "探索世界 发现美好", views: "12.5k", status: "已发布", img: "https://picsum.photos/200/120?random=1" },
    { id: 2, title: "产品发布会邀请函", views: "8.2k", status: "草稿", img: "https://picsum.photos/200/120?random=2" },
  ]);

  // 当编辑器发布新卡片时调用的函数
  const handlePublishCard = (newCard) => {
    setCards([newCard, ...cards]); // 新发布的卡片置顶显示
    setCurrentScreen('home');     // 自动跳转回首页
  };

  return (
    <div className="w-full min-h-screen bg-slate-50 text-slate-900 font-sans">
      {currentScreen === 'home' ? (
        <HomeScreen onNavigate={() => setCurrentScreen('editor')} cards={cards} />
      ) : (
        <EditorScreen onBack={() => setCurrentScreen('home')} onPublish={handlePublishCard} />
      )}
    </div>
  );
}

/* ==========================================================================
   1. 首页组件 (HomeScreen)
   ========================================================================== */
function HomeScreen({ onNavigate, cards }) {
  return (
    <div className="flex flex-col min-h-screen pb-24 relative max-w-md mx-auto bg-slate-50 border-x border-gray-200">
      {/* 顶部栏 */}
      <div className="sticky top-0 w-full flex items-center justify-between p-4 bg-white border-b border-gray-100 z-30 shadow-sm">
        <button className="text-xl w-10 text-left text-gray-300">{"<"}</button>
        <h1 className="text-lg font-bold text-gray-800">新建卡片</h1>
        <button className="text-blue-600 font-bold text-sm w-10 text-right opacity-0" disabled>下一步</button>
      </div>

      {/* 主体滚动内容区域 */}
      <div className="flex-1 overflow-y-auto px-4">
        <p className="text-[11px] text-gray-400 mt-6 mb-3 font-bold uppercase tracking-widest">选择卡片类型</p >
        
        {/* 点击原生卡片模式，跳转到编辑器 */}
        <div className="flex flex-col gap-3 cursor-pointer" onClick={onNavigate}>
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

        {/* 我的卡片与数据统计头部 */}
        <div className="flex items-center justify-between mt-8 mb-4">
          <h2 className="font-bold text-gray-800 text-lg">我的卡片</h2>
          <span className="text-xs text-gray-400 font-bold px-2 py-1 bg-gray-100 rounded-lg">全部 {cards.length} {">"}</span>
        </div>

        {/* 动态卡片渲染列表 */}
        <div className="flex flex-col gap-3">
          {cards.map((card) => (
            <div key={card.id} className="flex gap-4 bg-white rounded-2xl p-3 shadow-sm border border-gray-100">
              <img src={card.img} className="w-20 h-20 object-cover rounded-xl shrink-0 bg-gray-100" alt="" />
              <div className="flex-1 flex flex-col justify-between py-1">
                <p className="font-bold text-sm text-gray-800 line-clamp-2">{card.title || "无标题卡片"}</p >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-gray-400 font-medium">👁 {card.views}</span>
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                    card.status === '已发布' ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600'
                  }`}>{card.status}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 底部固定导航栏 */}
      <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white border-t border-gray-100 py-2 px-6 flex justify-between items-center z-40 shadow-xl rounded-t-3xl">
        <div className="flex flex-col items-center gap-0.5 text-blue-600 cursor-pointer">
          <FaHome size={20} /><span className="text-[10px] font-bold">首页</span>
        </div>
        <div className="flex flex-col items-center gap-0.5 text-gray-300 cursor-pointer hover:text-gray-500">
          <FaChartBar size={20} /><span className="text-[10px] font-medium">数据</span>
        </div>
        <div className="flex flex-col items-center gap-0.5 text-gray-300 cursor-pointer hover:text-gray-500">
          <FaUser size={20} /><span className="text-[10px] font-medium">我的</span>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   2. 编辑器页面组件 (EditorScreen)
   ========================================================================== */
function EditorScreen({ onBack, onPublish }) {
  const [showMenu, setShowMenu] = useState(false);
  const [menuView, setMenuView] = useState('main'); // main | grid | editBtn | link | emoji
  const [buttons, setButtons] = useState([]); 
  const [activeBtnId, setActiveBtnId] = useState(null);
  const [gridConfig, setGridConfig] = useState({ rows: 1, cols: 2 });
  const [mediaFile, setMediaFile] = useState(null); 
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
    content: `<p>点击“+”配置下方按钮矩阵，发布后可统计数据...</p >`,
    editorProps: {
      attributes: { class: 'focus:outline-none min-h-[140px] text-[15px] leading-[1.4] text-[#000000] max-w-none break-words whitespace-pre-wrap font-sans' },
    },
  });

  // 监控光标滚动
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

  // 处理媒体图片上传
  const handleMediaChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setMediaFile({ url, type: file.type.startsWith('video') ? 'video' : 'image' });
    }
  };

  // 触发发布动作，向外部提交数据
  const triggerPublish = () => {
    if (!editor) return;
    // 获取纯文本作为列表页标题展示，如果为空则设默认值
    const pureText = editor.getText().trim();
    const title = pureText.length > 0 ? pureText : "未命名 Telegram 原生卡片";
    
    // 构建新卡片统计对象
    const newCard = {
      id: Date.now(),
      title: title,
      views: "0", // 新发布卡片初始浏览量为 0
      status: "已发布",
      img: mediaFile?.url || "https://picsum.photos/200/120?random=" + Math.floor(Math.random() * 100) // 若没传图则配随机图占位
    };

    onPublish(newCard);
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
      {/* 顶部栏 */}
      <div className="flex items-center justify-between p-4 bg-white border-b shrink-0 z-30 shadow-sm">
        <span className="text-xl cursor-pointer text-gray-400 font-bold px-2" onClick={onBack}>{"<"}</span>
        <h1 className="text-md font-medium text-gray-700">高级内容编辑</h1>
        <button onClick={triggerPublish} className="bg-[#24A1DE] text-white px-4 py-1 rounded-full text-sm font-bold shadow-md shadow-blue-100">发布</button>
      </div>

      {/* 主体画布 */}
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

        {/* Telegram 1:1 气泡预览 */}
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

      {/* 底部输入控制台 */}
      <div className="absolute bottom-0 left-0 right-0 bg-white border-t p-3 flex flex-col z-20 shadow-lg">
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex-1 bg-gray-100 rounded-full px-4 py-2 text-xs text-gray-400">
            {buttons.length > 0 ? `已配置 ${buttons.length} 个底部矩阵按钮` : '点击右侧 + 配置卡片底层按钮'}
          </div>
          <button type="button" onMouseDown={(e) => { e.preventDefault(); if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); setShowMenu(!showMenu); setMenuView('main'); }} className={`w-9 h-9 rounded-full border flex items-center justify-center transition-all ${showMenu ? 'rotate-45 text-[#24A1DE] border-[#24A1DE] bg-blue-50' : 'text-gray-400 border-gray-200'}`}>
            <span className="text-xl">+</span>
          </button>
        </div>

        {/* 动态抽屉 */}
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