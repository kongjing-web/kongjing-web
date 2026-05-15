import React, { useState, useRef } from 'react';
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
  const fileInputRef = useRef(null);

  // 1. 初始化 Tiptap (整合 3.txt 的配置)
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false, HTMLAttributes: { class: 'text-blue-500 underline' } }),
      Placeholder.configure({ placeholder: '输入内容或配置下方按钮...' }),
    ],
    content: `<h2>探索未知的边界</h2><p>选中文字可插入“内嵌链接”</p >`,
    editorProps: {
      attributes: { class: 'prose prose-sm focus:outline-none min-h-[300px] p-1 text-gray-800 max-w-none' },
    },
  });

  // 2. 菜单动作处理 (整合 3.txt 的功能图标逻辑)
  const handleMenuAction = (label) => {
    if (!editor) return;
    switch (label) {
      case '加粗': editor.chain().focus().toggleBold().run(); break;
      case '斜体': editor.chain().focus().toggleItalic().run(); break;
      case '下划线': editor.chain().focus().toggleUnderline().run(); break;
      case '删除线': editor.chain().focus().toggleStrike().run(); break;
      case '引用': editor.chain().focus().toggleBlockquote().run(); break;
      case '分隔线': editor.chain().focus().setHorizontalRule().run(); break;
      case '清除格式': editor.chain().focus().unsetAllMarks().clearNodes().run(); break;
      case '内嵌链接': setMenuView('link'); break; // 跳转到链接视图
      case '按钮': setMenuView('grid'); break;     // 跳转到矩阵视图
      case '外部链接': setMenuView('grid'); break; // 同按钮逻辑
      case '撤销': editor.chain().focus().undo().run(); break;
      case '重做': editor.chain().focus().redo().run(); break;
      default: console.log('Action:', label);
    }
  };

  // 3. 按钮矩阵逻辑
  const generateGrid = () => {
    const newBtns = [];
    for (let i = 0; i < gridConfig.rows * gridConfig.cols; i++) {
      newBtns.push({ id: Date.now() + i, text: `按钮 ${i + 1}`, url: '' });
    }
    setButtons(newBtns);
    setMenuView('main'); // 回到主菜单
  };

  const handleBtnPreviewClick = (btn) => {
    setActiveBtnId(btn.id);
    setMenuView('editBtn'); // 点击预览区按钮，菜单跳转到编辑页
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
    { icon: "—", label: "分隔线" },
    { icon: "“", label: "引用", active: 'blockquote' },
    { icon: "扫", label: "清除格式" },
    { icon: "↩", label: "撤销" },
    { icon: "↪", label: "重做" }
  ];

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-800 max-w-md mx-auto overflow-hidden relative border-x border-gray-200 font-sans">
      {/* Header (3.txt 样式) */}
      <div className="flex items-center justify-between p-4 bg-white border-b shrink-0 z-30">
        <span className="text-xl cursor-pointer">✕</span>
        <h1 className="text-lg font-medium text-orange-500">高级编辑器</h1>
        <button className="bg-orange-500 text-white px-4 py-1 rounded-full text-sm font-bold shadow-lg shadow-orange-100">发布</button>
      </div>

      {/* 主动体 */}
      <div className="flex-1 flex flex-col min-h-0 transition-transform duration-300" 
           style={{ transform: showMenu ? 'translateY(-280px)' : 'translateY(0)' }}>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 relative min-h-[350px]">
            <EditorContent editor={editor} />
            
            {/* 按钮矩阵预览区 */}
            {buttons.length > 0 && (
              <div className="mt-6 pt-4 border-t border-dashed" style={{ 
                display: 'grid', gridTemplateColumns: `repeat(${gridConfig.cols}, 1fr)`, gap: '8px' 
              }}>
                {buttons.map(btn => (
                  <div key={btn.id} onClick={() => handleBtnPreviewClick(btn)}
                    className={`py-2 rounded-xl text-center text-xs font-bold border transition-all cursor-pointer ${
                      activeBtnId === btn.id ? 'border-orange-500 bg-orange-50 text-orange-500' : 'bg-gray-50 border-gray-100 text-gray-500'
                    }`}>
                    {btn.text}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 底部输入条 */}
        <div className="bg-white border-t p-3 flex items-center gap-3 shrink-0 z-20">
          <div className="flex-1 bg-gray-100 rounded-full px-4 py-2 text-sm text-gray-400">
            {buttons.length > 0 ? `已配置 ${buttons.length} 个底部按钮` : '点击 + 配置卡片格式...'}
          </div>
          <button onClick={() => {setShowMenu(!showMenu); setMenuView('main')}} 
            className={`w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all ${showMenu ? 'rotate-45 text-orange-500 border-orange-500 bg-orange-50' : 'text-gray-300 border-gray-200'}`}>
            <span className="text-2xl">+</span>
          </button>
        </div>
      </div>

      {/* 动态功能菜单面板 */}
      <div className={`absolute bottom-0 left-0 right-0 bg-white border-t transition-all duration-300 z-10 ${showMenu ? 'h-[280px]' : 'h-0 overflow-hidden'}`}>
        
        {/* 1. 主菜单视图 */}
        {menuView === 'main' && (
          <div className="grid grid-cols-4 gap-y-6 p-6">
            {menuItems.map((item, idx) => (
              <div key={idx} onClick={() => handleMenuAction(item.label)} className="flex flex-col items-center gap-1 active:scale-90 transition-all cursor-pointer">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-xl border ${item.active && editor?.isActive(item.active) ? 'bg-orange-500 text-white border-orange-500 shadow-md' : 'bg-gray-50 text-gray-600 border-transparent'}`}>
                  {item.icon}
                </div>
                <span className="text-[10px] text-gray-400">{item.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* 2. 矩阵视图 */}
        {menuView === 'grid' && (
          <div className="p-6 space-y-5 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex justify-between items-center"><span className="font-bold">配置按钮阵列</span><span className="text-gray-400 text-sm" onClick={()=>setMenuView('main')}>返回</span></div>
            <div className="flex gap-4">
              <div className="flex-1 group">
                <p className="text-[10px] text-gray-400 mb-1">行数 (Rows)</p >
                <input type="number" value={gridConfig.rows} onChange={e=>setGridConfig({...gridConfig, rows: e.target.value})} className="w-full border-b pb-1 outline-none text-lg focus:border-orange-500 transition-colors" />
              </div>
              <div className="flex-1">
                <p className="text-[10px] text-gray-400 mb-1">列数 (Cols)</p >
                <input type="number" value={gridConfig.cols} onChange={e=>setGridConfig({...gridConfig, cols: e.target.value})} className="w-full border-b pb-1 outline-none text-lg focus:border-orange-500 transition-colors" />
              </div>
            </div>
            <button onClick={generateGrid} className="w-full bg-orange-500 text-white py-3 rounded-2xl font-bold shadow-lg shadow-orange-100">生成并预览</button>
          </div>
        )}

        {/* 3. 按钮详情编辑视图 */}
        {menuView === 'editBtn' && (
          <div className="p-6 space-y-4 animate-in fade-in">
            <div className="flex justify-between items-center"><span className="font-bold text-orange-500">编辑选中按钮</span><span className="text-blue-500 text-sm font-bold" onClick={()=>setMenuView('main')}>完成</span></div>
            <div className="space-y-3">
              <input placeholder="按钮名" value={buttons.find(b=>b.id===activeBtnId)?.text || ''} onChange={e => setButtons(buttons.map(b => b.id === activeBtnId ? {...b, text: e.target.value} : b))} className="w-full border-b py-2 outline-none" />
              <input placeholder="跳转链接 (https://...)" value={buttons.find(b=>b.id===activeBtnId)?.url || ''} onChange={e => setButtons(buttons.map(b => b.id === activeBtnId ? {...b, url: e.target.value} : b))} className="w-full border-b py-2 outline-none text-blue-500" />
            </div>
            <button onClick={() => {setButtons(buttons.filter(b=>b.id!==activeBtnId)); setMenuView('main');}} className="text-red-400 text-xs pt-2">删除此按钮</button>
          </div>
        )}

        {/* 4. 内嵌链接视图 */}
        {menuView === 'link' && (
          <div className="p-6 space-y-5 animate-in fade-in">
            <div className="flex justify-between items-center"><span className="font-bold">插入内嵌链接</span><span className="text-gray-400 text-sm" onClick={()=>setMenuView('main')}>取消</span></div>
            <input id="linkUrl" placeholder="https://..." className="w-full border-b py-2 outline-none text-blue-500" autoFocus />
            <button onClick={() => {
              const url = document.getElementById('linkUrl').value;
              if(url) editor.chain().focus().setLink({ href: url }).run();
              setMenuView('main');
            }} className="w-full bg-black text-white py-3 rounded-2xl font-bold">确认插入到文字</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;