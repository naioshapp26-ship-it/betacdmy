import React from 'react';
import { BookOpen, GraduationCap, X } from 'lucide-react';

interface RoleSelectionModalProps {
  onSelectStudent: () => void;
  onSelectInstructor: () => void;
  onClose: () => void;
  translations: {
    title: string;
    studentOption: string;
    studentDesc: string;
    instructorOption: string;
    instructorDesc: string;
    enterAsStudent: string;
    enterAsInstructor: string;
  };
}

export const RoleSelectionModal: React.FC<RoleSelectionModalProps> = ({
  onSelectStudent,
  onSelectInstructor,
  onClose,
  translations
}) => {
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="role-selection-title"
    >
      <div
        className="relative w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl sm:p-8"
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

        {/* Title */}
        <h2
          id="role-selection-title"
          className="mb-6 text-center text-2xl font-bold text-zinc-900 sm:text-3xl"
        >
          {translations.title}
        </h2>

        {/* Options Grid */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Student Option */}
          <div className="flex flex-col rounded-xl border-2 border-zinc-200 bg-zinc-50 p-6 transition hover:border-red-300 hover:bg-red-50/30">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
              <BookOpen className="text-red-600" size={24} />
            </div>
            <h3 className="mb-2 text-xl font-bold text-zinc-900">
              {translations.studentOption}
            </h3>
            <p className="mb-4 flex-1 text-sm text-zinc-600">
              {translations.studentDesc}
            </p>
            <button
              onClick={onSelectStudent}
              className="w-full rounded-lg bg-red-900 py-3 font-semibold text-white transition hover:bg-red-950 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
            >
              {translations.enterAsStudent}
            </button>
          </div>

          {/* Instructor Option */}
          <div className="flex flex-col rounded-xl border-2 border-zinc-200 bg-zinc-50 p-6 transition hover:border-red-300 hover:bg-red-50/30">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
              <GraduationCap className="text-red-600" size={24} />
            </div>
            <h3 className="mb-2 text-xl font-bold text-zinc-900">
              {translations.instructorOption}
            </h3>
            <p className="mb-4 flex-1 text-sm text-zinc-600">
              {translations.instructorDesc}
            </p>
            <button
              onClick={onSelectInstructor}
              className="w-full rounded-lg bg-red-900 py-3 font-semibold text-white transition hover:bg-red-950 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
            >
              {translations.enterAsInstructor}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
