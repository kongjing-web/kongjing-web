import React, { useState, useRef, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';

const App = () => {
  const [showMenu, setShowMenu] = useState(false);
  const [menuView, setMenuView] = useState('main'); // main | grid | editBtn | link
  const [buttons, setButtons] = useState([]); 
  const [activeBtnId, setActiveBtnId] = useState(null);
  const [gridConfig, setGridConfig] = useState({ rows: 1, cols: 2 });
  
  // 媒体上传状态
  const [mediaFile, setMediaFile] = useState(null); 
  const fileInputRef = useRef(null);
  
  // 滚动与光标定位引用
  const scrollContainerRef = useRef(null);

  // 1. 初始化 Tiptap 编辑器
  // 严格限制富文本标签，使其匹配 Telegram Bot API 的 HTML 规范 (仅支持 <b>, <i>, <u>, <s>, <a>, <code>, <pre>, <blockquote>)
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // 禁用 TG 不支持的标题和分隔线，确保所见即所得
        heading: false,
        horizontalRule: false,
      }),
      Underline,
      Link.configure({ 
        openOnClick: false, 
        HTMLAttributes: { class: 'text-blue-500 underline pointer-events-none' } 
      }),
      Placeholder.configure({ placeholder: '输入卡片正文内容...' }),
    ],
    content: `<p>选中文字可插入“内嵌链接”</p >`,
    editorProps: {
      attributes: { 
        // 严格模拟 Telegram 客户端的排版规则：断字、行高、字体大小
        class: 'focus:outline-none min-h-[150px] text-[15px] leading-[1.4] text-[#000000] max-w-none break-words whitespace-pre-wrap font-sans',
      },
    },
  });

  // 监听光标位置，动态滚动定位到可视区域
  useEffect(() => {
    if (!editor) return;
    const handleSelectionUpdate = () => {
      // 延时等待 DOM 更新和键盘完全弹起
      setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;
        
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        
        // 如果光标在不可见区域，滚动容器使其可见
        if (rect.top > 0 && rect.bottom > (window.innerHeight * 0.45)) {
          scrollContainerRef.current?.scrollBy({
            top: rect.bottom - (window.innerHeight * 0.45) + 40,
            behavior: 'smooth'
          });
        }
      }, 150);
    };

    editor.on('selectionUpdate', handleSelectionUpdate);
    return () => { editor.off('selectionUpdate', handleSelectionUpdate); };
  }, [editor]);

  // 处理媒体上传
  const handleMediaChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setMediaFile({ url, type: file.type.startsWith('video') ? 'video' : 'image' });
    }
  };

  // 4. 解决菜单与键盘冲突的动作处理
  const handleMenuAction = (e, label) => {
    // 关键点：阻止默认的 Focus 行为，防止点击菜单按钮时手机弹出/唤醒键盘
    e.preventDefault();
    e.stopPropagation();

    if (!editor) return;

    // 获取当前选区
    const { from, to } = editor.state.selection;

    switch (label) {
      case '加粗': editor.chain().toggleBold().run(); break;
      case '斜体': editor.chain().toggleItalic().run(); break;
      case '下划线': editor.chain().toggleUnderline().run(); break;
      case '删除线': editor.chain().toggleStrike().run(); break;
      case '引用': editor.chain().toggleBlockquote().run(); break;
      case '清除格式': editor.chain().unsetAllMarks().clearNodes().run(); break;
      case '内嵌链接': 
        if (from === to) {
          alert('请先在编辑器中选中一段文字，再插入内嵌链接');
          return;
        }
        setMenuView('link'); 
        break;
      case '按钮': setMenuView('grid'); break;
      case '外部链接': setMenuView('grid'); break;
      case '撤销': editor.chain().undo().run(); break;
      case '重做': editor.chain().redo().run(); break;
      default: console.log('Action:', label);
    }
  };

  // 生成按钮矩阵
  const generateGrid = () => {
    const newBtns = [];
    const rows = parseInt(gridConfig.rows) || 1;
    const cols = parseInt(gridConfig.cols) || 2;
    for (let i = 0; i < rows * cols; i++) {
      newBtns.push({ id: Date.now() + i, text: `按钮 ${i + 1}`, url: '' });
    }
    setButtons(newBtns);
    setMenuView('main');
  };

  const handleBtnPreviewClick = (btn) => {
    setActiveBtnId(btn.id);
    setMenuView('editBtn');
    setShowMenu(true);
  };

  const menuItems = [
    { icon: "B", label: "加粗", active: 'bold' },
    { icon: "I", label: "斜体", active: 'italic' },
    { icon: "U", label: "下划线", active: 'underline' },
    { icon: "S", label: "删除线", active: 'strike' },
    { icon: "🔗", label: "内嵌链接", active: 'link' },
    { icon: "🔘", label: "按钮" },
    { icon: "↗", label: "外部链接" },
    { icon: "—", label: "引用", active: 'blockquote' },
    { icon: "扫", label: "清除格式" },
    { icon: "↩", label: "撤销" },
    { icon: "↪", label: "重做" }
  ];

  return (
    <div className="flex flex-col h-screen bg-[#E7EBF0] text-gray-800 max-w-md mx-auto overflow-hidden relative border-x border-gray-200 font-sans">
      
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-white border-b shrink-0 z-30">
        <span className="text-xl cursor-pointer text-gray-400">✕</span>
        <h1 className="text-md font-medium text-gray-700">Telegram 卡片编辑器</h1>
        <button className="bg-[#24A1DE] text-white px-4 py-1 rounded-full text-sm font-medium shadow-sm">发布</button>
      </div>

      {/* 第三点修复：主体画布不再整体位移(取消过往的 translateY)。
        通过 flex-1 和 overflow-y-auto，让中间的“模拟聊天气泡”在键盘/菜单弹起时自由滚动。
      */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-3 space-y-3 pb-[320px] scroll-smooth">
        
        {/* 第一点修复：最上方加入媒体导入框（完美模拟 TG 宽屏或正方形自适应无损尺寸） */}
        <div className="w-full bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm relative group">
          <input type="file" accept="image/*,video/*" ref={fileInputRef} onChange={handleMediaChange} className="hidden" />
          
          {!mediaFile ? (
            <div onClick={() => fileInputRef.current.click()} className="w-full h-48 bg-gray-50 flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-gray-100 transition-colors">
              <span className="text-3xl text-gray-300">+</span>
              <span className="text-xs text-gray-400">导入图片 / 视频 (TG 原生比例)</span>
            </div>
          ) : (
            <div className="relative w-full bg-black flex items-center justify-center">
              {mediaFile.type === 'image' ? (
                // object-contain 配合 max-h，保证发布到 TG 里的图片尺寸不变、不被裁剪
                < img src={mediaFile.url} alt="Preview" className="w-full max-h-[260px] object-contain" />
              ) : (
                <video src={mediaFile.url} controls className="w-full max-h-[260px] object-contain" />
              )}
              <button onClick={() => setMediaFile(null)} className="absolute top-2 right-2 bg-black/60 text-white w-6 h-6 rounded-full text-xs flex items-center justify-center">✕</button>
            </div>
          )}
        </div>

        {/* 第二点修复：1:1 还原 Telegram 原生气泡排版效果 (所见即所得) */}
        <div className="bg-white rounded-2xl p-[12px] shadow-sm border border-gray-100 relative min-h-[180px]">
          {/* Tiptap 渲染区域 */}
          <EditorContent editor={editor} onFocus={() => {
            // 第四点修复：点击编辑器弹出键盘时，一级功能菜单面板必须自动关闭
            setShowMenu(false);
          }} />
          
          {/* 下方按钮矩阵预览区 */}
          {buttons.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100" style={{ 
              display: 'grid', gridTemplateColumns: `repeat(${gridConfig.cols}, 1fr)`, gap: '5px' 
            }}>
              {buttons.map(btn => (
                <div key={btn.id} onClick={() => handleBtnPreviewClick(btn)}
                     className={`py-2 px-1 rounded-md text-center text-[13px] font-normal border transition-all cursor-pointer truncate ${
                    activeBtnId === btn.id ? 'border-[#24A1DE] bg-blue-50 text-[#24A1DE]' : 'bg-[#F1F5F9] border-transparent text-[#24A1DE]'
                  }`}>
                  {btn.text || "未命名按钮"}
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* 固定底部的交互输入条 */}
      <div className="absolute bottom-0 left-0 right-0 bg-white border-t p-3 flex flex-col z-20 shadow-lg">
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex-1 bg-gray-100 rounded-full px-4 py-2 text-xs text-gray-400">
            {buttons.length > 0 ? `已配置 ${buttons.length} 个底部内联按钮` : '点击右侧 + 配置卡片矩阵按钮'}
          </div>
          <button 
            type="button"
            onMouseDown={(e) => {
              e.preventDefault(); // 强行阻止焦点丢失
              // 第四点修复：点击菜单时，主动让输入框失焦以主动收起手机键盘，两者绝不同时出现
              if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur();
              }
              setShowMenu(!showMenu);
              setMenuView('main');
            }} 
            className={`w-9 h-9 rounded-full border flex items-center justify-center transition-all ${showMenu ? 'rotate-45 text-[#24A1DE] border-[#24A1DE] bg-blue-50' : 'text-gray-400 border-gray-200'}`}>
            <span className="text-xl">+</span>
          </button>
        </div>

        {/* 动态功能菜单面板（占位等同于手机键盘高度区域，两者分时复用底部空间） */}
        <div className={`transition-all duration-200 overflow-y-auto ${showMenu ? 'h-[240px] mt-3' : 'h-0'}`}>
          
          {/* 1. 一级工具菜单视图 */}
          {menuView === 'main' && (
            <div className="grid grid-cols-4 gap-y-4 p-2">
              {menuItems.map((item, idx) => (
                <div 
                  key={idx} 
                  // 核心改动：必须使用 onMouseDown 并在内部执行 preventDefault()，保证富文本选区不丢失且不唤醒键盘
                  onMouseDown={(e) => handleMenuAction(e, item.label)} 
                  className="flex flex-col items-center gap-1 active:scale-95 transition-all cursor-pointer"
                >
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-lg border ${item.active && editor?.isActive(item.active) ? 'bg-[#24A1DE] text-white border-transparent' : 'bg-gray-50 text-gray-600 border-gray-100'}`}>
                    {item.icon}
                  </div>
                  <span className="text-[10px] text-gray-400">{item.label}</span>
                </div>
              ))}
            </div>
          )}

          {/* 2. 矩阵配置视图 */}
          {menuView === 'grid' && (
            <div className="p-2 space-y-4 animate-in fade-in">
              <div className="flex justify-between items-center"><span className="text-sm font-bold">配置 Inline 按钮阵列</span><span className="text-[#24A1DE] text-xs cursor-pointer" onClick={()=>setMenuView('main')}>返回</span></div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <p className="text-[10px] text-gray-400 mb-1">行数 (Rows)</p >
                  <input type="number" value={gridConfig.rows} onChange={e=>setGridConfig({...gridConfig, rows: e.target.value})} className="w-full border-b pb-1 outline-none text-base focus:border-[#24A1DE]" />
                </div>
                <div className="flex-1">
                  <p className="text-[10px] text-gray-400 mb-1">列数 (Cols)</p >
                  <input type="number" value={gridConfig.cols} onChange={e=>setGridConfig({...gridConfig, cols: e.target.value})} className="w-full border-b pb-1 outline-none text-base focus:border-[#24A1DE]" />
                </div>
              </div>
              <button onClick={generateGrid} className="w-full bg-[#24A1DE] text-white py-2.5 rounded-xl text-sm font-medium">生成并在气泡下方预览</button>
            </div>
          )}

          {/* 3. 按钮详情编辑视图 */}
          {menuView === 'editBtn' && (
            <div className="p-2 space-y-4 animate-in fade-in">
              <div className="flex justify-between items-center"><span className="text-sm font-bold text-[#24A1DE]">编辑选中按钮参数</span><span className="text-gray-500 text-xs cursor-pointer" onClick={()=>setMenuView('main')}>完成</span></div>
              <div className="space-y-3">
                <input placeholder="按钮显示文本" value={buttons.find(b=>b.id===activeBtnId)?.text || ''} onChange={e => setButtons(buttons.map(b => b.id === activeBtnId ? {...b, text: e.target.value} : b))} className="w-full border-b py-1.5 text-sm outline-none" />
                <input placeholder="跳转 URL (如 t.me/xxxx)" value={buttons.find(b=>b.id===activeBtnId)?.url || ''} onChange={e => setButtons(buttons.map(b => b.id === activeBtnId ? {...b, url: e.target.value} : b))} className="w-full border-b py-1.5 text-sm outline-none text-blue-500" />
              </div>
              <button onClick={() => {setButtons(buttons.filter(b=>b.id!==activeBtnId)); setMenuView('main');}} className="text-red-500 text-xs block pt-1">删除此按钮</button>
            </div>
          )}

          {/* 4. 内嵌链接超链接视图 */}
          {menuView === 'link' && (
            <div className="p-2 space-y-4 animate-in fade-in">
              <div className="flex justify-between items-center"><span className="text-sm font-bold">为选中文字插入超链接</span><span className="text-gray-400 text-xs cursor-pointer" onClick={()=>setMenuView('main')}>取消</span></div>
              <input id="linkUrl" placeholder="https://t.me/..." className="w-full border-b py-1.5 text-sm outline-none text-blue-500" autoFocus />
              <button onClick={() => {
                const url = document.getElementById('linkUrl').value;
                if(url) editor.chain().focus().setLink({ href: url }).run();
                setMenuView('main');
              }} className="w-full bg-black text-white py-2.5 rounded-xl text-sm font-medium">确认插入 (a 标签封装)</button>
            </div>
          )}

        </div>
      </div>

    </div>
  );
};

export default App;