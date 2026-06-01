import React, { useEffect, useRef, useState } from 'react';
import { COUNTRIES, DEFAULT_COUNTRY, type Country } from '../utils/countries';

export interface PhoneValue {
  countryCode: string;   // e.g. "US"
  dialCode: string;      // e.g. "+1"
  number: string;        // local number digits
  full: string;          // combined e.g. "+1 5551234567"
}

interface Props {
  value: PhoneValue;
  onChange: (val: PhoneValue) => void;
  required?: boolean;
  id?: string;
  name?: string;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  disabled?: boolean;
  dir?: 'ltr' | 'rtl';
  'aria-label'?: string;
}

function buildFull(dialCode: string, number: string): string {
  if (!number.trim()) return '';
  return `${dialCode} ${number.trim()}`;
}

export function parsePhoneValue(raw: string | undefined): PhoneValue {
  if (!raw) return { countryCode: DEFAULT_COUNTRY.code, dialCode: DEFAULT_COUNTRY.dialCode, number: '', full: '' };
  const trimmed = raw.trim();
  const matched = COUNTRIES.find(c => trimmed.startsWith(c.dialCode));
  if (matched) {
    const number = trimmed.slice(matched.dialCode.length).trim();
    return { countryCode: matched.code, dialCode: matched.dialCode, number, full: trimmed };
  }
  return { countryCode: DEFAULT_COUNTRY.code, dialCode: DEFAULT_COUNTRY.dialCode, number: trimmed, full: trimmed };
}

const PhoneInput: React.FC<Props> = ({
  value,
  onChange,
  required = false,
  id = 'phone',
  name = 'phone',
  placeholder,
  className = '',
  inputClassName = '',
  disabled = false,
  dir = 'ltr',
  'aria-label': ariaLabel,
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selectedCountry: Country =
    COUNTRIES.find(c => c.code === value.countryCode) ?? DEFAULT_COUNTRY;

  const filtered = search.trim()
    ? COUNTRIES.filter(
        c =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.dialCode.includes(search) ||
          c.code.toLowerCase().includes(search.toLowerCase())
      )
    : COUNTRIES;

  const selectCountry = (country: Country) => {
    setOpen(false);
    setSearch('');
    onChange({
      countryCode: country.code,
      dialCode: country.dialCode,
      number: value.number,
      full: buildFull(country.dialCode, value.number),
    });
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const num = e.target.value.replace(/[^\d\s\-().+]/g, '');
    onChange({
      countryCode: value.countryCode,
      dialCode: value.dialCode,
      number: num,
      full: buildFull(value.dialCode, num),
    });
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open]);

  const baseInputClasses =
    'appearance-none rounded-lg block w-full px-3 py-2 border border-zinc-300 placeholder-zinc-500 text-zinc-900 focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm';

  return (
    <div className={`flex gap-2 ${className}`} dir="ltr">
      {/* Country selector */}
      <div className="relative flex-shrink-0" ref={dropdownRef}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(o => !o)}
          className="h-full flex items-center gap-1.5 px-3 py-2 border border-zinc-300 rounded-lg bg-white text-sm text-zinc-900 hover:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-500 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`Country code: ${selectedCountry.name} ${selectedCountry.dialCode}`}
        >
          <span className="text-base leading-none">{selectedCountry.flag}</span>
          <span className="font-medium text-zinc-700">{selectedCountry.dialCode}</span>
          <svg
            className={`h-3 w-3 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {open && (
          <div className="absolute z-50 mt-1 w-64 bg-white border border-zinc-200 rounded-xl shadow-lg overflow-hidden">
            {/* Search */}
            <div className="p-2 border-b border-zinc-100">
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search country..."
                className="w-full px-3 py-1.5 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400"
                onClick={e => e.stopPropagation()}
              />
            </div>
            {/* List */}
            <ul
              role="listbox"
              className="max-h-52 overflow-y-auto py-1"
            >
              {filtered.length === 0 ? (
                <li className="px-4 py-2 text-sm text-zinc-500">No results</li>
              ) : (
                filtered.map(country => (
                  <li
                    key={country.code}
                    role="option"
                    aria-selected={country.code === value.countryCode}
                    onClick={() => selectCountry(country)}
                    className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-red-50 ${
                      country.code === value.countryCode ? 'bg-red-50 font-semibold text-red-700' : 'text-zinc-800'
                    }`}
                  >
                    <span className="text-base">{country.flag}</span>
                    <span className="flex-1 truncate">{country.name}</span>
                    <span className="text-zinc-500 text-xs">{country.dialCode}</span>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </div>

      {/* Phone number input */}
      <input
        id={id}
        name={name}
        type="tel"
        required={required}
        disabled={disabled}
        placeholder={placeholder ?? '5xx xxx xxxx'}
        value={value.number}
        onChange={handleNumberChange}
        aria-label={ariaLabel ?? 'Phone number'}
        className={`${baseInputClasses} flex-1 ${inputClassName}`}
        style={{ direction: 'ltr' }}
        inputMode="tel"
      />
    </div>
  );
};

export default PhoneInput;
