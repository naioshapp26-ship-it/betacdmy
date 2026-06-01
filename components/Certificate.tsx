import React, { useRef } from 'react';
import { Certificate as CertificateType } from '../types';
import { Award, Download, Share2, X } from 'lucide-react';
import { useNotification } from './NotificationContext';

interface CertificateProps {
    certificate: CertificateType;
    onClose?: () => void;
    t?: any;
    lang?: 'ar' | 'en';
    studentName?: string;
    courseName?: string;
    courseLevel?: string;
}

export const CertificateDisplay: React.FC<CertificateProps> = ({
    certificate,
    onClose,
    t,
    lang,
    studentName,
    courseName,
    courseLevel
}) => {
    const certificateRef = useRef<HTMLDivElement>(null);
    const { notify } = useNotification();
    const dictionary = t || {};

    const detectLang = (): 'ar' | 'en' => {
        if (lang) return lang;
        if (typeof document !== 'undefined') {
            const docLang = document.documentElement?.lang?.toLowerCase();
            if (docLang === 'ar') {
                return 'ar';
            }
        }
        return 'en';
    };

    const resolvedLang = detectLang();
    const locale = resolvedLang === 'ar' ? 'ar' : 'en-US';
    const resolvedStudentName = studentName || certificate.userName || dictionary.unknownUser || 'Student';
    const fallbackCourseTitle = dictionary.unknownCourse || (resolvedLang === 'ar' ? 'دورة' : 'Course');
    const resolvedCourseTitle = courseName || certificate.courseTitle || fallbackCourseTitle;
    const resolvedCourseLevel = typeof courseLevel === 'string' ? courseLevel : certificate.courseLevel;
    const isCompletion = certificate.type === 'COMPLETION';
    const certificateTypeLabel = isCompletion
        ? (dictionary.certCompletion || 'Certificate of Completion')
        : (dictionary.certAttendance || dictionary.attendanceCerts || 'Certificate of Attendance');
    const shareTemplate = isCompletion
        ? (dictionary.certificateShareCompletion || 'I earned a Certificate of Completion for {course}!')
        : (dictionary.certificateShareAttendance || 'I earned a Certificate of Attendance for {course}!');
    const shareText = shareTemplate.replace('{course}', resolvedCourseTitle);
    const certificateNumberLabel = dictionary.certificateNumber || dictionary.certNumber || 'Certificate Number';
    const clipboardMessage = dictionary.certificateCopied || 'Certificate details copied to clipboard!';
    const exitLabel = dictionary.exitCertificateView || 'Exit certificate view';

    const formattedIssueDate = (() => {
        const rawDate = certificate.issueDate || (certificate as any).issuedAt;
        if (!rawDate) return '';
        try {
            return new Date(rawDate).toLocaleDateString(locale, {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        } catch {
            return rawDate;
        }
    })();

    const handleDownload = () => {
        if (!certificateRef.current) return;

        import('html2canvas')
            .then(html2canvas =>
                html2canvas.default(certificateRef.current!, {
                    scale: 2,
                    backgroundColor: '#ffffff'
                })
            )
            .then(canvas => {
                const link = document.createElement('a');
                link.download = `${certificate.type}-${certificate.certificationNumber}.png`;
                link.href = canvas.toDataURL();
                link.click();
            })
            .catch(() => {
                notify('error', dictionary.installHtml2canvasPrompt || 'Please install html2canvas to download certificates');
            });
    };

    const handleShare = () => {
        const url = typeof window !== 'undefined' ? window.location.href : '';
        const certificateNumberLine = certificate.certificationNumber
            ? `${certificateNumberLabel} #${certificate.certificationNumber}`
            : '';
        const payload = certificateNumberLine ? `${shareText}\n${certificateNumberLine}` : shareText;

        if (typeof navigator !== 'undefined' && navigator.share) {
            navigator.share({ title: shareText, url }).catch(() => {});
            return;
        }

        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(payload)
                .then(() => notify('success', clipboardMessage))
                .catch(() => notify('success', clipboardMessage));
            return;
        }

        notify('info', clipboardMessage);
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-auto">
                {/* Header */}
                <div className="p-4 border-b border-zinc-200 flex justify-between items-center">
                    <h2 className="text-xl font-bold text-zinc-900">{dictionary.yourCertificate || dictionary.certificate || 'Your Certificate'}</h2>
                    <div className="flex gap-2">
                        <button
                            onClick={handleDownload}
                            data-certificate-download
                            className="flex items-center gap-2 px-4 py-2 bg-red-900 text-white rounded-lg hover:bg-red-950 font-medium text-sm"
                        >
                            <Download className="h-4 w-4" /> {dictionary.download || 'Download'}
                        </button>
                        <button
                            onClick={handleShare}
                            className="flex items-center gap-2 px-4 py-2 bg-zinc-100 text-zinc-700 rounded-lg hover:bg-zinc-200 font-medium text-sm"
                        >
                            <Share2 className="h-4 w-4" /> {dictionary.share || 'Share'}
                        </button>
                        {onClose && (
                            <button
                                onClick={onClose}
                                className="flex items-center gap-2 px-4 py-2 border border-zinc-200 rounded-lg text-zinc-700 hover:bg-zinc-50 font-medium text-sm"
                                aria-label={exitLabel}
                            >
                                <X className="h-4 w-4" /> {dictionary.exit || 'Exit'}
                            </button>
                        )}
                    </div>
                </div>

                {/* Certificate */}
                <div className="p-8">
                    <div 
                        ref={certificateRef}
                        className="relative bg-white border-8 border-double border-zinc-800 p-12 aspect-[1.414/1]"
                        style={{
                            background: 'linear-gradient(135deg, #ffffff 0%, #f4f4f5 100%)'
                        }}
                    >
                        {/* Decorative corners */}
                        <div className="absolute top-4 left-4 w-16 h-16 border-t-4 border-l-4 border-red-600"></div>
                        <div className="absolute top-4 right-4 w-16 h-16 border-t-4 border-r-4 border-red-600"></div>
                        <div className="absolute bottom-4 left-4 w-16 h-16 border-b-4 border-l-4 border-red-600"></div>
                        <div className="absolute bottom-4 right-4 w-16 h-16 border-b-4 border-r-4 border-red-600"></div>

                        {/* Content */}
                        <div className="relative z-10 flex flex-col items-center justify-center h-full text-center space-y-6">
                            {/* Icon */}
                            <div className="bg-red-900 p-6 rounded-full">
                                <Award className="h-16 w-16 text-white" />
                            </div>

                            {/* Title */}
                            <div>
                                <h1 className="text-4xl font-black text-zinc-900 mb-2 tracking-[0.3em] uppercase">
                                    {dictionary.certificate || 'Certificate'}
                                </h1>
                                <p className="text-2xl font-bold text-red-600 uppercase">
                                    {certificateTypeLabel}
                                </p>
                            </div>

                            {/* Divider */}
                            <div className="w-32 h-1 bg-gradient-to-r from-transparent via-zinc-400 to-transparent"></div>

                            {/* Award Text */}
                            <div className="space-y-2">
                                <p className="text-sm font-medium text-zinc-600 uppercase tracking-wider">
                                    {dictionary.certifies || 'This is to certify that'}
                                </p>
                                <p className="text-3xl font-bold text-zinc-900 border-b-2 border-zinc-300 pb-2 px-8">
                                    {resolvedStudentName}
                                </p>
                            </div>

                            {/* Course Info */}
                            <div className="space-y-1">
                                <p className="text-sm font-medium text-zinc-600">
                                    {isCompletion
                                        ? (dictionary.courseCompletionLine || 'has successfully completed the course')
                                        : (dictionary.courseAttendanceLine || 'has attended the course')}
                                </p>
                                <p className="text-2xl font-bold text-zinc-900">
                                    {resolvedCourseTitle}
                                </p>
                                {resolvedCourseLevel && (
                                    <p className="text-lg font-medium text-zinc-600">
                                        {(dictionary.level || 'Level')}: {resolvedCourseLevel}
                                    </p>
                                )}
                            </div>

                            {/* Date and Number */}
                            <div className="flex gap-12 pt-8">
                                <div className="text-center">
                                    <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">
                                        {dictionary.issueDate || 'Issue Date'}
                                    </p>
                                    <p className="text-sm font-semibold text-zinc-900 border-t-2 border-zinc-300 pt-2">
                                        {formattedIssueDate}
                                    </p>
                                </div>
                                <div className="text-center">
                                    <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">
                                        {certificateNumberLabel}
                                    </p>
                                    <p className="text-sm font-semibold text-zinc-900 border-t-2 border-zinc-300 pt-2 font-mono">
                                        #{certificate.certificationNumber}
                                    </p>
                                </div>
                            </div>

                            {/* Footer */}
                            <div className="pt-8">
                                <div className="w-48 border-t-2 border-zinc-800 mx-auto mb-2"></div>
                                <p className="text-xs font-bold text-zinc-700 uppercase tracking-wider">
                                    {dictionary.academyDirector || 'Academy Director'}
                                </p>
                            </div>
                        </div>

                        {/* Watermark */}
                        <div className="absolute inset-0 flex items-center justify-center opacity-5 pointer-events-none">
                            <Award className="h-96 w-96 text-zinc-900" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CertificateDisplay;
