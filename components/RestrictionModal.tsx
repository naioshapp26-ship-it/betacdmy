import React from 'react';
import { Lock, X } from 'lucide-react';

interface RestrictionModalProps {
  onCreateAccount: () => void;
  onLogin: () => void;
  onClose: () => void;
  translations: {
    title: string;
    message?: string;
    createAccount: string;
    login: string;
  };
}

export const RestrictionModal: React.FC<RestrictionModalProps> = ({
  onCreateAccount,
  onLogin,
  onClose,
  translations
}) => {
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="restriction-modal-title"
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute left-4 top-4 rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
          aria-label="Close"
        >
          <X size={20} />
        </button>

        {/* Icon */}
        <div className="mb-4 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
            <Lock className="text-red-600" size={32} />
          </div>
        </div>

        {/* Title */}
        <h2
          id="restriction-modal-title"
          className="mb-3 text-center text-xl font-bold text-zinc-900 sm:text-2xl"
        >
          {translations.title}
        </h2>

        {/* Message */}
        {translations.message && (
          <p className="mb-6 text-center text-zinc-600">
            {translations.message}
          </p>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col gap-3">
          <button
            onClick={onCreateAccount}
            className="w-full rounded-lg bg-red-900 py-3 font-semibold text-white transition hover:bg-red-950 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
          >
            {translations.createAccount}
          </button>
          <button
            onClick={onLogin}
            className="w-full rounded-lg border-2 border-zinc-300 bg-white py-3 font-semibold text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2"
          >
            {translations.login}
          </button>
        </div>
      </div>
    </div>
  );
};
