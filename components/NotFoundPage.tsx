import React from 'react';
import { Link } from 'react-router-dom';
import { Home, Search, ArrowLeft } from 'lucide-react';

interface NotFoundPageProps {
  t: any;
  lang: 'ar' | 'en';
  onBack?: () => void;
}

const NotFoundPage: React.FC<NotFoundPageProps> = ({ t, lang, onBack }) => {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-16">
      <div className="max-w-2xl w-full text-center">
        {/* 404 Illustration */}
        <div className="mb-8">
          <div className="text-9xl font-bold text-red-600 mb-4">404</div>
          <div className="relative mx-auto w-64 h-64">
            <div className="absolute inset-0 bg-red-50 rounded-full opacity-50 animate-pulse"></div>
            <div className="absolute inset-8 bg-red-100 rounded-full opacity-50 animate-pulse delay-75"></div>
            <div className="absolute inset-16 bg-red-200 rounded-full opacity-50 animate-pulse delay-150"></div>
            <div className="absolute inset-0 flex items-center justify-center">
              <Search className="h-24 w-24 text-red-600" />
            </div>
          </div>
        </div>

        {/* Error Message */}
        <h1 className="text-4xl font-bold text-zinc-900 mb-4">
          {lang === 'ar' ? 'الصفحة غير موجودة' : 'Page Not Found'}
        </h1>
        <p className="text-lg text-zinc-600 mb-8 max-w-md mx-auto">
          {lang === 'ar' 
            ? 'عذراً، الصفحة التي تبحث عنها غير موجودة أو تم نقلها إلى موقع آخر.'
            : "Sorry, the page you're looking for doesn't exist or has been moved to another location."
          }
        </p>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          {onBack && (
            <button
              onClick={onBack}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg border-2 border-zinc-300 text-zinc-700 font-semibold hover:bg-zinc-50 transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
              {lang === 'ar' ? 'العودة' : 'Go Back'}
            </button>
          )}
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-red-900 text-white font-semibold hover:bg-red-950 transition-colors shadow-lg shadow-red-900/30"
          >
            <Home className="h-5 w-5" />
            {lang === 'ar' ? 'الصفحة الرئيسية' : 'Go Home'}
          </Link>
          <a
            href="https://betacdmy.com.vendoworld.com/contact-us"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg border-2 border-red-600 text-red-600 font-semibold hover:bg-red-50 transition-colors"
          >
            {lang === 'ar' ? 'تواصل معنا' : 'Contact Us'}
          </a>
        </div>

        {/* Helpful Links */}
        <div className="mt-12 pt-8 border-t border-zinc-200">
          <p className="text-sm text-zinc-500 mb-4">
            {lang === 'ar' ? 'أو يمكنك زيارة:' : 'Or you might want to visit:'}
          </p>
          <div className="flex flex-wrap gap-4 justify-center text-sm">
            <Link to="/courses" className="text-red-600 hover:underline font-medium">
              {lang === 'ar' ? 'الدورات' : 'Courses'}
            </Link>
            <span className="text-zinc-300">•</span>
            <Link to="/blog" className="text-red-600 hover:underline font-medium">
              {lang === 'ar' ? 'المدونة' : 'Blog'}
            </Link>
            <span className="text-zinc-300">•</span>
            <Link to="/about-us" className="text-red-600 hover:underline font-medium">
              {lang === 'ar' ? 'من نحن' : 'About Us'}
            </Link>
            <span className="text-zinc-300">•</span>
            <Link to="/services" className="text-red-600 hover:underline font-medium">
              {lang === 'ar' ? 'الخدمات' : 'Services'}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotFoundPage;
