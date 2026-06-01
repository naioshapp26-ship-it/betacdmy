import React, { useRef, useEffect, useState } from 'react';
import { 
  Bold, Italic, Underline, List, ListOrdered, Link as LinkIcon, 
  AlignLeft, AlignCenter, AlignRight, Eraser, Type
} from 'lucide-react';
import DOMPurify from 'dompurify';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: string;
}

export const RichTextEditor: React.FC<RichTextEditorProps> = ({ 
  value, 
  onChange, 
  placeholder = 'Start writing...',
  minHeight = '300px'
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [isInitialized, setIsInitialized] = useState(false);
  const savedSelectionRef = useRef<Range | null>(null);
  const [activeFormats, setActiveFormats] = useState<Set<string>>(new Set());
  const lastValueRef = useRef<string>('');

  // Initialize editor content
  useEffect(() => {
    if (editorRef.current && !isInitialized) {
      const sanitized = DOMPurify.sanitize(value || '', {
        ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'div'],
        ALLOWED_ATTR: ['href', 'target', 'rel', 'style']
      });
      // Only set content if there's actual content, otherwise leave empty
      editorRef.current.innerHTML = sanitized || '';
      lastValueRef.current = sanitized;
      setIsInitialized(true);
    }
  }, [value, placeholder, isInitialized]);

  // Update editor content when value prop changes externally (e.g., from AI generation)
  useEffect(() => {
    if (editorRef.current && isInitialized && value !== lastValueRef.current) {
      const sanitizedValue = DOMPurify.sanitize(value || '', {
        ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'div'],
        ALLOWED_ATTR: ['href', 'target', 'rel', 'style']
      });
      
      // Only update if there's actual content, otherwise leave empty
      editorRef.current.innerHTML = sanitizedValue || '';
      lastValueRef.current = value;
    }
  }, [value, isInitialized, placeholder]);

  // Update parent when content changes
  const handleInput = () => {
    if (editorRef.current) {
      const html = editorRef.current.innerHTML;
      // Sanitize before saving
      const sanitized = DOMPurify.sanitize(html, {
        ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'div'],
        ALLOWED_ATTR: ['href', 'target', 'rel', 'style']
      });
      lastValueRef.current = sanitized;
      onChange(sanitized);
    }
  };

  // Save selection when editor loses focus
  const saveSelection = () => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      savedSelectionRef.current = selection.getRangeAt(0);
    }
  };

  // Restore selection before executing command
  const restoreSelection = () => {
    if (savedSelectionRef.current) {
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(savedSelectionRef.current);
      }
    }
  };

  // Update active formats based on cursor position
  const updateActiveFormats = () => {
    const formats = new Set<string>();
    
    if (document.queryCommandState('bold')) formats.add('bold');
    if (document.queryCommandState('italic')) formats.add('italic');
    if (document.queryCommandState('underline')) formats.add('underline');
    if (document.queryCommandState('insertUnorderedList')) formats.add('ul');
    if (document.queryCommandState('insertOrderedList')) formats.add('ol');
    if (document.queryCommandState('justifyLeft')) formats.add('alignLeft');
    if (document.queryCommandState('justifyCenter')) formats.add('alignCenter');
    if (document.queryCommandState('justifyRight')) formats.add('alignRight');
    
    // Check for heading tags
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      let node = selection.anchorNode;
      while (node && node !== editorRef.current) {
        if (node.nodeName === 'H1') formats.add('h1');
        if (node.nodeName === 'H2') formats.add('h2');
        if (node.nodeName === 'H3') formats.add('h3');
        node = node.parentNode;
      }
    }
    
    setActiveFormats(formats);
  };

  const execCommand = (command: string, value?: string) => {
    restoreSelection();
    document.execCommand(command, false, value);
    editorRef.current?.focus();
    saveSelection();
    updateActiveFormats();
    handleInput();
  };

  const handleFormat = (format: string) => {
    switch (format) {
      case 'bold':
        execCommand('bold');
        break;
      case 'italic':
        execCommand('italic');
        break;
      case 'underline':
        execCommand('underline');
        break;
      case 'h1':
        execCommand('formatBlock', '<h1>');
        break;
      case 'h2':
        execCommand('formatBlock', '<h2>');
        break;
      case 'h3':
        execCommand('formatBlock', '<h3>');
        break;
      case 'ul':
        execCommand('insertUnorderedList');
        break;
      case 'ol':
        execCommand('insertOrderedList');
        break;
      case 'alignLeft':
        execCommand('justifyLeft');
        break;
      case 'alignCenter':
        execCommand('justifyCenter');
        break;
      case 'alignRight':
        execCommand('justifyRight');
        break;
      case 'removeFormat':
        execCommand('removeFormat');
        break;
      case 'p':
        execCommand('formatBlock', '<p>');
        break;
    }
  };

  const handleLinkInsert = () => {
    if (linkUrl.trim()) {
      // Ensure URL has protocol
      let url = linkUrl.trim();
      if (!url.match(/^https?:\/\//i)) {
        url = 'https://' + url;
      }
      execCommand('createLink', url);
      setLinkUrl('');
      setShowLinkInput(false);
    }
  };

  const ToolbarButton: React.FC<{ 
    onClick: () => void; 
    icon: React.ReactNode; 
    title: string;
    active?: boolean;
  }> = ({ onClick, icon, title, active }) => (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      title={title}
      className={`p-2 rounded hover:bg-zinc-200 transition-colors ${active ? 'bg-zinc-200' : ''}`}
    >
      {icon}
    </button>
  );

  return (
    <div className="border border-zinc-300 rounded-lg overflow-hidden bg-white">
      {/* Toolbar */}
      <div className="bg-zinc-50 border-b border-zinc-300 p-2 flex flex-wrap gap-1">
        <ToolbarButton
          onClick={() => handleFormat('bold')}
          icon={<Bold className="w-4 h-4" />}
          title="Bold (Ctrl+B)"
          active={activeFormats.has('bold')}
        />
        <ToolbarButton
          onClick={() => handleFormat('italic')}
          icon={<Italic className="w-4 h-4" />}
          title="Italic (Ctrl+I)"
          active={activeFormats.has('italic')}
        />
        <ToolbarButton
          onClick={() => handleFormat('underline')}
          icon={<Underline className="w-4 h-4" />}
          title="Underline (Ctrl+U)"
          active={activeFormats.has('underline')}
        />
        
        <div className="w-px h-6 bg-zinc-300 mx-1"></div>
        
        <ToolbarButton
          onClick={() => handleFormat('h1')}
          icon={<span className="text-sm font-bold">H1</span>}
          title="Heading 1"
          active={activeFormats.has('h1')}
        />
        <ToolbarButton
          onClick={() => handleFormat('h2')}
          icon={<span className="text-sm font-bold">H2</span>}
          title="Heading 2"
          active={activeFormats.has('h2')}
        />
        <ToolbarButton
          onClick={() => handleFormat('h3')}
          icon={<span className="text-sm font-bold">H3</span>}
          title="Heading 3"
          active={activeFormats.has('h3')}
        />
        
        <div className="w-px h-6 bg-zinc-300 mx-1"></div>
        
        <ToolbarButton
          onClick={() => handleFormat('ul')}
          icon={<List className="w-4 h-4" />}
          title="Bullet List"
          active={activeFormats.has('ul')}
        />
        <ToolbarButton
          onClick={() => handleFormat('ol')}
          icon={<ListOrdered className="w-4 h-4" />}
          title="Numbered List"
          active={activeFormats.has('ol')}
        />
        
        <div className="w-px h-6 bg-zinc-300 mx-1"></div>
        
        <ToolbarButton
          onClick={() => handleFormat('alignLeft')}
          icon={<AlignLeft className="w-4 h-4" />}
          title="Align Left"
          active={activeFormats.has('alignLeft')}
        />
        <ToolbarButton
          onClick={() => handleFormat('alignCenter')}
          icon={<AlignCenter className="w-4 h-4" />}
          title="Align Center"
          active={activeFormats.has('alignCenter')}
        />
        <ToolbarButton
          onClick={() => handleFormat('alignRight')}
          icon={<AlignRight className="w-4 h-4" />}
          title="Align Right"
          active={activeFormats.has('alignRight')}
        />
        
        <div className="w-px h-6 bg-zinc-300 mx-1"></div>
        
        <ToolbarButton
          onClick={() => setShowLinkInput(!showLinkInput)}
          icon={<LinkIcon className="w-4 h-4" />}
          title="Insert Link"
          active={showLinkInput}
        />
        <ToolbarButton
          onClick={() => handleFormat('p')}
          icon={<Type className="w-4 h-4" />}
          title="Paragraph"
        />
        <ToolbarButton
          onClick={() => handleFormat('removeFormat')}
          icon={<Eraser className="w-4 h-4" />}
          title="Clear Formatting"
        />
      </div>

      {/* Link Input */}
      {showLinkInput && (
        <div className="bg-blue-50 border-b border-blue-200 p-3 flex gap-2">
          <input
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleLinkInsert();
              }
            }}
            placeholder="https://example.com"
            className="flex-1 px-3 py-1.5 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={handleLinkInsert}
            className="px-4 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium text-sm"
          >
            Insert
          </button>
          <button
            type="button"
            onClick={() => {
              setShowLinkInput(false);
              setLinkUrl('');
            }}
            className="px-4 py-1.5 bg-zinc-200 text-zinc-700 rounded hover:bg-zinc-300 font-medium text-sm"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Editor */}
      <div
        ref={editorRef}
        contentEditable
        onInput={handleInput}
        onBlur={() => {
          saveSelection();
          handleInput();
        }}
        onMouseUp={() => {
          saveSelection();
          updateActiveFormats();
        }}
        onKeyUp={() => {
          saveSelection();
          updateActiveFormats();
        }}
        className="p-4 focus:outline-none prose prose-lg max-w-none"
        style={{ minHeight }}
        suppressContentEditableWarning
      />

      <style>{`
        [contenteditable] {
          outline: none;
        }
        [contenteditable]:empty:before {
          content: attr(data-placeholder);
          color: #9ca3af;
          pointer-events: none;
        }
        [contenteditable] h1 {
          font-size: 2em;
          font-weight: 700;
          margin: 0.67em 0;
          line-height: 1.2;
        }
        [contenteditable] h2 {
          font-size: 1.5em;
          font-weight: 700;
          margin: 0.75em 0;
          line-height: 1.3;
        }
        [contenteditable] h3 {
          font-size: 1.17em;
          font-weight: 700;
          margin: 0.83em 0;
          line-height: 1.4;
        }
        [contenteditable] p {
          margin: 1em 0;
          line-height: 1.75;
        }
        [contenteditable] ul,
        [contenteditable] ol {
          margin: 1em 0;
          padding-left: 2em;
        }
        [contenteditable] ul {
          list-style-type: disc;
        }
        [contenteditable] ol {
          list-style-type: decimal;
        }
        [contenteditable] li {
          margin: 0.5em 0;
          display: list-item;
        }
        [contenteditable] a {
          color: #2563eb;
          text-decoration: underline;
        }
        [contenteditable] a:hover {
          color: #1d4ed8;
        }
        [contenteditable] strong,
        [contenteditable] b {
          font-weight: 700;
        }
        [contenteditable] em,
        [contenteditable] i {
          font-style: italic;
        }
        [contenteditable] u {
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
};
