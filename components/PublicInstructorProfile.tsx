import React from 'react';
import { User, Course, BlogPost } from '../types';
import { ArrowLeft, Mail, Award, BookOpen, Clock, Linkedin, FileText, CheckCircle, PenTool } from 'lucide-react';
import DOMPurify from 'dompurify';
import { resolveBlogImage, BLOG_IMAGE_FALLBACK } from '../utils/blogMedia';

interface PublicInstructorProfileProps {
    instructor: User;
    onBack: () => void;
    t: any;
    lang: 'ar' | 'en';
    blogPosts?: BlogPost[];
    courses?: Course[];
}

export const PublicInstructorProfile: React.FC<PublicInstructorProfileProps> = ({ 
    instructor, 
    onBack, 
    t, 
    lang, 
    blogPosts, 
    courses 
}) => {
    const [activeTab, setActiveTab] = React.useState<'OVERVIEW' | 'COURSES' | 'CREDENTIALS' | 'BLOGS'>('OVERVIEW');

    // Filter courses taught by this instructor
    const instructorCourses = (courses || []).filter(c => 
        c.instructor === instructor.name || c.instructor.includes(instructor.name)
    );
    
    // Filter blog posts by this instructor
    const instructorPosts = (blogPosts || []).filter(p => p.author === instructor.name);

    const renderTabContent = () => {
        switch (activeTab) {
            case 'OVERVIEW':
                return (
                    <div className="space-y-6 animate-fade-in">
                        {/* Bio Section */}
                        <div className="ds-card">
                            <h3 className="ds-section-title mb-4">{t.biography || 'Biography'}</h3>
                            <p className="ds-description">
                                {instructor.bio || t.noBiography || 'No biography provided yet.'}
                            </p>
                        </div>

                        {/* Stats Row */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="ds-card-compact">
                                <p className="text-zinc-500 text-sm flex items-center gap-2">
                                    <BookOpen className="h-4 w-4" /> {t.coursesTaught}
                                </p>
                                <p className="text-2xl font-bold text-zinc-900 mt-1">{instructorCourses.length}</p>
                            </div>
                            <div className="ds-card-compact">
                                <p className="text-zinc-500 text-sm flex items-center gap-2">
                                    <Clock className="h-4 w-4" /> {t.yearsOfExp}
                                </p>
                                <p className="text-2xl font-bold text-zinc-900 mt-1">
                                    {instructor.yearsOfExperience || 0}+ {t.yearsLabel || 'Years'}
                                </p>
                            </div>
                            <div className="ds-card-compact">
                                <p className="text-zinc-500 text-sm flex items-center gap-2">
                                    <Award className="h-4 w-4" /> {t.certifications}
                                </p>
                                <p className="text-2xl font-bold text-zinc-900 mt-1">
                                    {instructor.certifications?.length || 0}
                                </p>
                            </div>
                        </div>
                    </div>
                );
            case 'COURSES':
                return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fade-in">
                        {instructorCourses.map(course => (
                            <div key={course.id} className="ds-card overflow-hidden group hover:shadow-md transition-shadow">
                                <div className="h-40 bg-zinc-200 relative overflow-hidden">
                                    <img src={course.thumbnail} alt={course.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                                    <div className="absolute top-2 right-2 bg-white/90 backdrop-blur px-2 py-1 rounded text-xs font-bold text-zinc-800">
                                        {course.level}
                                    </div>
                                </div>
                                <div className="p-5">
                                    <h3 className="font-bold text-zinc-900 mb-2 line-clamp-1">{course.title}</h3>
                                    <div 
                                        className="text-sm text-zinc-500 line-clamp-2 mb-4 prose prose-sm max-w-none"
                                        dangerouslySetInnerHTML={{ 
                                            __html: DOMPurify.sanitize(course.description || '', {
                                                ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'a'],
                                                ALLOWED_ATTR: ['href', 'target', 'rel']
                                            })
                                        }}
                                    />
                                    <div className="flex justify-between items-center text-sm">
                                        <span className="text-red-600 font-bold">${course.price}</span>
                                        <span className="text-zinc-400 flex items-center gap-1">
                                            <BookOpen className="h-3 w-3" /> {course.modules.length} Lessons
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ))}
                        {instructorCourses.length === 0 && (
                            <div className="col-span-2 text-center py-12 text-zinc-500 bg-white rounded-xl border border-zinc-200 border-dashed">
                                {t.noCoursesAssigned || 'No courses assigned yet.'}
                            </div>
                        )}
                    </div>
                );
            case 'CREDENTIALS':
                return (
                    <div className="ds-card animate-fade-in">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="ds-section-title">{t.certifications}</h3>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {instructor.certifications?.map((cert, idx) => (
                                <div key={idx} className="border border-zinc-200 rounded-lg p-3 flex items-center gap-3 bg-zinc-50">
                                    {cert.startsWith('data:image') ? (
                                        <img src={cert} alt={`Certification ${idx + 1}`} className="h-12 w-12 rounded object-cover" />
                                    ) : (
                                        <div className="ds-icon-container ds-icon-red">
                                            <Award className="h-6 w-6" />
                                        </div>
                                    )}
                                    <div className="flex-1">
                                        <p className="text-sm font-bold text-zinc-700">{t.certification} {idx + 1}</p>
                                    </div>
                                </div>
                            ))}
                            {(!instructor.certifications || instructor.certifications.length === 0) && (
                                <p className="text-zinc-500 text-sm italic col-span-2">{t.noCertifications || 'No certifications listed.'}</p>
                            )}
                        </div>
                    </div>
                );
            case 'BLOGS':
                return (
                    <div className="space-y-6 animate-fade-in">
                        {instructorPosts.length > 0 ? (
                            instructorPosts.map(post => {
                                const coverImage = resolveBlogImage(post.image, post.uploadedImagePath);
                                return (
                                    <div key={post.id} className="ds-card flex flex-col md:flex-row gap-6 hover:shadow-md transition-shadow">
                                        <div className="w-full md:w-48 h-32 bg-zinc-100 rounded-lg overflow-hidden flex-shrink-0">
                                            <img
                                                src={coverImage}
                                                alt={post.title}
                                                className="w-full h-full object-cover"
                                                onError={(event) => {
                                                    (event.currentTarget as HTMLImageElement).src = BLOG_IMAGE_FALLBACK;
                                                }}
                                            />
                                        </div>
                                    <div className="flex-1">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <h3 className="font-bold text-zinc-900 text-lg mb-1">{post.title}</h3>
                                                <p className="text-xs text-zinc-500 mb-2">{post.publishedOn}</p>
                                            </div>
                                            <span className={`px-2 py-1 text-xs rounded-full font-bold ${post.status === 'PUBLISHED' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                                                {post.status || 'DRAFT'}
                                            </span>
                                        </div>
                                        <p className="text-zinc-600 text-sm line-clamp-2 mb-3">{post.excerpt}</p>
                                        <div className="flex items-center gap-2">
                                            {post.isFeatured && (
                                                <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-bold">Featured</span>
                                            )}
                                        </div>
                                    </div>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="text-center py-12 text-zinc-500 bg-white rounded-xl border border-zinc-200 border-dashed">
                                <PenTool className="h-10 w-10 mx-auto text-zinc-300 mb-2" />
                                <p>{t.noBlogPosts || 'No blog posts published yet.'}</p>
                            </div>
                        )}
                    </div>
                );
            default:
                return null;
        }
    };

    return (
        <div className="min-h-screen pb-12 bg-transparent">
            {/* Header/Cover */}
            <div className="h-48 bg-gradient-to-r from-zinc-800 to-black relative">
                <button 
                    onClick={onBack}
                    className="absolute top-6 left-6 bg-white/10 hover:bg-white/20 text-white p-2 rounded-full backdrop-blur-sm transition-all z-20"
                >
                    <ArrowLeft className="h-6 w-6" />
                </button>
            </div>

            {/* Profile Card */}
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 -mt-20 relative z-10">
                <div className="ds-card flex flex-col md:flex-row items-start md:items-end gap-6 mb-8">
                    <div className="relative group">
                        <div className="h-32 w-32 rounded-full border-4 border-white shadow-lg bg-zinc-200 overflow-hidden relative">
                            {instructor.avatar ? (
                                <img src={instructor.avatar} className="h-full w-full object-cover" alt={instructor.name} />
                            ) : (
                                <div className="h-full w-full flex items-center justify-center bg-zinc-100 text-zinc-400 text-4xl font-bold">
                                    {instructor.name[0]}
                                </div>
                            )}
                        </div>
                        <div className="absolute bottom-2 right-2 h-6 w-6 bg-blue-500 border-4 border-white rounded-full" title="Verified Instructor"></div>
                    </div>
                    
                    <div className="flex-1 w-full">
                        <div>
                            <h1 className="ds-page-title mb-1 flex items-center gap-2">
                                {instructor.name} 
                                <span className="text-sm font-normal text-white bg-zinc-800 px-2 py-0.5 rounded ml-2 align-middle">Instructor</span>
                            </h1>
                            <p className="text-red-600 font-medium mb-3">{instructor.specialization || instructor.expertise || 'General Instructor'}</p>
                            
                            <div className="flex flex-wrap gap-4 text-sm text-zinc-500 mb-4">
                                <div className="flex items-center gap-1">
                                    <Mail className="h-4 w-4" /> {instructor.email}
                                </div>
                            </div>

                            <div className="flex gap-3">
                                {instructor.socialLinks?.linkedin && (
                                    <a href={instructor.socialLinks.linkedin} target="_blank" rel="noopener" className="p-1.5 bg-zinc-100 rounded hover:bg-[#0077b5] hover:text-white transition-colors">
                                        <Linkedin className="h-4 w-4" />
                                    </a>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Navigation Sidebar */}
                    <div className="lg:col-span-1">
                        <div className="ds-card overflow-hidden sticky top-24 z-20">
                            <nav className="flex flex-col p-2 space-y-1">
                                <button 
                                    onClick={() => setActiveTab('OVERVIEW')}
                                    className={`flex items-center justify-between px-4 py-3 rounded-lg text-sm font-medium transition-colors ${activeTab === 'OVERVIEW' ? 'bg-red-50 text-red-700' : 'text-zinc-600 hover:bg-zinc-50'}`}
                                >
                                    <div className="flex items-center gap-3">
                                        <FileText className="h-4 w-4" /> {t.overview}
                                    </div>
                                    {activeTab === 'OVERVIEW' && <CheckCircle className="h-4 w-4" />}
                                </button>
                                <button 
                                    onClick={() => setActiveTab('COURSES')}
                                    className={`flex items-center justify-between px-4 py-3 rounded-lg text-sm font-medium transition-colors ${activeTab === 'COURSES' ? 'bg-red-50 text-red-700' : 'text-zinc-600 hover:bg-zinc-50'}`}
                                >
                                    <div className="flex items-center gap-3">
                                        <BookOpen className="h-4 w-4" /> {t.coursesTaught}
                                    </div>
                                    {activeTab === 'COURSES' && <CheckCircle className="h-4 w-4" />}
                                </button>
                                <button 
                                    onClick={() => setActiveTab('BLOGS')}
                                    className={`flex items-center justify-between px-4 py-3 rounded-lg text-sm font-medium transition-colors ${activeTab === 'BLOGS' ? 'bg-red-50 text-red-700' : 'text-zinc-600 hover:bg-zinc-50'}`}
                                >
                                    <div className="flex items-center gap-3">
                                        <PenTool className="h-4 w-4" /> {t.blog}
                                    </div>
                                    {activeTab === 'BLOGS' && <CheckCircle className="h-4 w-4" />}
                                </button>
                                <button 
                                    onClick={() => setActiveTab('CREDENTIALS')}
                                    className={`flex items-center justify-between px-4 py-3 rounded-lg text-sm font-medium transition-colors ${activeTab === 'CREDENTIALS' ? 'bg-red-50 text-red-700' : 'text-zinc-600 hover:bg-zinc-50'}`}
                                >
                                    <div className="flex items-center gap-3">
                                        <Award className="h-4 w-4" /> {t.credentials}
                                    </div>
                                    {activeTab === 'CREDENTIALS' && <CheckCircle className="h-4 w-4" />}
                                </button>
                            </nav>
                        </div>
                    </div>

                    {/* Main Content Area */}
                    <div className="lg:col-span-2">
                        {renderTabContent()}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PublicInstructorProfile;
