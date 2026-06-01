import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, ArrowUpRight } from 'lucide-react';
import { User } from '../types';
import { GlobalSearchItem, searchGlobalItems } from '../utils/globalSearch';

interface GlobalSearchBarProps {
  lang: 'en' | 'ar';
  user?: User | null;
  onSelect: (item: GlobalSearchItem) => void;
}

const TYPE_LABELS: Record<GlobalSearchItem['type'], { en: string; ar: string }> = {
  page: { en: 'Page', ar: 'صفحة' },
  section: { en: 'Section', ar: 'قسم' },
  feature: { en: 'Feature', ar: 'ميزة' },
  settings: { en: 'Settings', ar: 'إعدادات' },
  module: { en: 'Module', ar: 'وحدة' }
};

export const GlobalSearchBar: React.FC<GlobalSearchBarProps> = ({ lang, user, onSelect }) => {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const results = useMemo(() => searchGlobalItems(query, user, 24), [query, user]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (item: GlobalSearchItem) => {
    onSelect(item);
    setQuery('');
    setIsOpen(false);
  };

  return (
    <div ref={rootRef} className="relative w-full max-w-3xl">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <input
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder={lang === 'ar' ? 'ابحث عن صفحة أو قسم أو ميزة...' : 'Search pages, sections, modules, or settings...'}
          className="w-full rounded-xl border border-zinc-300 bg-white py-2.5 pl-10 pr-4 text-sm text-zinc-900 shadow-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-200"
          aria-label={lang === 'ar' ? 'بحث داخل النظام' : 'System search'}
        />
      </div>

      {isOpen && query.trim().length > 0 && (
        <div className="absolute z-50 mt-2 max-h-[24rem] w-full overflow-y-auto rounded-xl border border-zinc-200 bg-white p-2 shadow-2xl">
          {results.length === 0 ? (
            <div className="px-3 py-5 text-center text-sm text-zinc-500">
              {lang === 'ar' ? 'لا توجد نتائج مطابقة' : 'No matching results'}
            </div>
          ) : (
            <ul className="space-y-1">
              {results.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(item)}
                    className="flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-zinc-50"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="rounded-md bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                          {TYPE_LABELS[item.type][lang]}
                        </span>
                        <p className="truncate text-sm font-semibold text-zinc-900">
                          {item.label[lang]}
                        </p>
                      </div>
                      {item.description?.[lang] && (
                        <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{item.description[lang]}</p>
                      )}
                    </div>
                    <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default GlobalSearchBar;
