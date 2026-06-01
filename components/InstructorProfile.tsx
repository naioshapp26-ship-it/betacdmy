import React, { useState } from 'react';
import { User, Course, BlogPost, UserRole } from '../types';
import { ArrowLeft, Mail, Phone, Award, BookOpen, Clock, Linkedin, Camera, Save, X, Upload, FileText, CheckCircle, PenTool, Eye, EyeOff } from 'lucide-react';
import DOMPurify from 'dompurify';
import { resolveBlogImage, BLOG_IMAGE_FALLBACK } from '../utils/blogMedia';
import { useNotification } from './NotificationContext';
import PhoneInput, { parsePhoneValue, type PhoneValue } from './PhoneInput';
import { formatPhoneNumberDisplay, getDialCodeFromCountryCode } from '../utils/phone';

interface InstructorProfileProps {
    user: User;
    onUpdateUser: (user: User) => void;
    onBack: () => void;
    t: any;
    lang: 'ar' | 'en';
    blogPosts?: BlogPost[];
    courses?: Course[];
    onShowRestrictionModal?: () => void;
}

export const InstructorProfile: React.FC<InstructorProfileProps> = ({ user, onUpdateUser, onBack, t, lang, blogPosts, courses, onShowRestrictionModal }) => {
    const { notify } = useNotification();
    const isGuest = user.role === UserRole.GUEST;
    const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'COURSES' | 'CREDENTIALS' | 'BLOGS'>('OVERVIEW');
    const [isEditing, setIsEditing] = useState(false);
    const [editForm, setEditForm] = useState<User>(user);
    const [phoneValue, setPhoneValue] = useState<PhoneValue>(parsePhoneValue(user.phone));
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [passwordForm, setPasswordForm] = useState({
        currentPassword: '',
        newPassword: '',
        confirmNewPassword: ''
    });
    const [showCurrentPassword, setShowCurrentPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [passwordError, setPasswordError] = useState<string | null>(null);
    const [passwordSuccess, setPasswordSuccess] = useState(false);

    // Filter courses taught by this instructor (basic name matching between instructor and course records)
    const myCourses = (courses || []).filter(c => c.instructor === user.name || c.instructor.includes(user.name));
    
    // Filter blog posts by this instructor
    const myPosts = (blogPosts || []).filter(p => p.author === user.name);
    const ratingValue = typeof user.rating === 'number' ? Math.max(0, Math.min(5, user.rating)) : null;
    const reviewsCount = typeof user.reviewsCount === 'number' ? user.reviewsCount : null;

    const resolvePhoneValue = (target: User): PhoneValue => {
        const parsed = parsePhoneValue(target.phone);
        const countryCode = (target.phoneCountryCode || '').trim().toUpperCase();
        const dialCode = getDialCodeFromCountryCode(countryCode);
        const phone = (target.phone || '').trim();
        if (!countryCode || !dialCode) return parsed;
        const localNumber = phone.startsWith(dialCode) ? phone.slice(dialCode.length).trim() : parsed.number;
        return {
            countryCode,
            dialCode,
            number: localNumber,
            full: localNumber ? `${dialCode} ${localNumber}` : '',
        };
    };

    React.useEffect(() => {
        setEditForm(user);
        setPhoneValue(resolvePhoneValue(user));
    }, [user]);

    const handleSave = async () => {
        // Block guests from saving
        if (isGuest && onShowRestrictionModal) {
            onShowRestrictionModal();
            return;
        }
        
        setIsSaving(true);
        setSaveError(null);
        try {
            // Get access token from localStorage if available
            const savedUser = localStorage.getItem('betacademy_user');
            const accessToken = savedUser ? JSON.parse(savedUser).accessToken : null;
            
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (accessToken) {
                headers['Authorization'] = `Bearer ${accessToken}`;
            }
            
            const response = await fetch(`/api/users/${user.id}`, {
                method: 'PUT',
                headers,
                credentials: 'include',
                body: JSON.stringify({
                    name: editForm.name,
                    email: editForm.email,
                    phone: phoneValue.full || phoneValue.number.trim() || undefined,
                    phoneCountryCode: phoneValue.number.trim() ? phoneValue.countryCode : undefined,
                    avatar: editForm.avatar,
                    bio: editForm.bio,
                    specialization: editForm.specialization,
                    gender: editForm.gender || undefined,
                    yearsOfExperience: editForm.yearsOfExperience,
                    portfolioUrl: editForm.portfolioUrl,
                    socialLinks: editForm.socialLinks,
                    certifications: editForm.certifications
                })
            });
            
            if (!response.ok) {
                if (response.status === 401) {
                    const errorMsg = lang === 'ar' 
                        ? 'انتهت صلاحية الجلسة. يرجى تسجيل الدخول مرة أخرى.'
                        : 'Session expired. Please log in again.';
                    throw new Error(errorMsg);
                }
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || (lang === 'ar' ? 'فشل تحديث الملف الشخصي' : 'Failed to update profile'));
            }
            
            const updatedUser = await response.json();
            onUpdateUser(updatedUser);
            setEditForm(updatedUser);
            setIsEditing(false);
            notify('success', lang === 'ar' ? 'تم حفظ التغييرات بنجاح!' : 'Profile updated successfully!');
        } catch (error) {
            console.error('Failed to save profile:', error);
            const errorMessage = error instanceof Error ? error.message : (t.profileSaveFailed || 'Failed to save profile. Please try again.');
            setSaveError(errorMessage);
            notify('error', errorMessage);
        } finally {
            setIsSaving(false);
        }
    };

    const handleCancel = () => {
        setEditForm(user);
        setPhoneValue(resolvePhoneValue(user));
        setIsEditing(false);
    };

    const handlePasswordChange = async () => {
        setPasswordError(null);
        setPasswordSuccess(false);
        
        if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmNewPassword) {
            setPasswordError(t.passwordFieldsRequired);
            return;
        }
        
        if (passwordForm.newPassword !== passwordForm.confirmNewPassword) {
            setPasswordError(t.passwordsDoNotMatch);
            return;
        }
        
        if (passwordForm.newPassword.length < 6) {
            setPasswordError(t.passwordTooShort);
            return;
        }
        
        try {
            // Get access token from localStorage if available
            const savedUser = localStorage.getItem('betacademy_user');
            const accessToken = savedUser ? JSON.parse(savedUser).accessToken : null;
            
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (accessToken) {
                headers['Authorization'] = `Bearer ${accessToken}`;
            }
            
            const response = await fetch(`/api/users/${user.id}/password`, {
                method: 'PUT',
                headers,
                credentials: 'include',
                body: JSON.stringify({
                    currentPassword: passwordForm.currentPassword,
                    newPassword: passwordForm.newPassword
                })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || t?.passwordChangeFailed || 'Failed to change password');
            }
            
            setPasswordSuccess(true);
            setPasswordForm({ currentPassword: '', newPassword: '', confirmNewPassword: '' });
            setTimeout(() => setPasswordSuccess(false), 3000);
        } catch (error: any) {
            setPasswordError(error.message || t?.passwordChangeFailed || 'Failed to change password');
        }
    };

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setEditForm({ ...editForm, avatar: reader.result as string });
            };
            reader.readAsDataURL(file);
        }
    };

    const handleCertUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                const newCerts = [...(editForm.certifications || []), reader.result as string];
                setEditForm({ ...editForm, certifications: newCerts });
            };
            reader.readAsDataURL(file);
        }
    };

    const renderTabContent = () => {
        switch (activeTab) {
            case 'OVERVIEW':
                return (
                    <div className="space-y-6 animate-fade-in">
                        {/* Bio Section */}
                        <div className="ds-card">
                            <h3 className="ds-section-title mb-4">{t.biography || 'Biography'}</h3>
                            {isEditing ? (
                                <textarea 
                                    className="w-full border border-zinc-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-red-500 focus:outline-none"
                                    rows={5}
                                    value={editForm.bio || ''}
                                    onChange={e => setEditForm({...editForm, bio: e.target.value})}
                                    placeholder={t.aboutYourselfPlaceholder || 'Tell students about yourself...'}
                                />
                            ) : (
                                <p className="ds-description">
                                    {user.bio || t.noBiography || 'No biography provided yet.'}
                                </p>
                            )}
                        </div>

                        {/* Stats Row */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="ds-card-compact">
                                <p className="text-zinc-500 text-sm flex items-center gap-2"><BookOpen className="h-4 w-4" /> {t.coursesTaught}</p>
                                <p className="text-2xl font-bold text-zinc-900 mt-1">{myCourses.length}</p>
                            </div>
                            <div className="ds-card-compact">
                                <p className="text-zinc-500 text-sm flex items-center gap-2"><Clock className="h-4 w-4" /> {t.yearsOfExp}</p>
                                {isEditing ? (
                                    <input 
                                        type="number"
                                        className="w-full border-b border-zinc-300 focus:border-red-500 focus:outline-none text-xl font-bold mt-1"
                                        value={editForm.yearsOfExperience || 0}
                                        onChange={e => setEditForm({...editForm, yearsOfExperience: parseInt(e.target.value)})}
                                    />
                                ) : (
                                    <p className="text-2xl font-bold text-zinc-900 mt-1">{user.yearsOfExperience || 0}+ {t.yearsLabel || 'Years'}</p>
                                )}
                            </div>
                        </div>
                    </div>
                );
            case 'COURSES':
                return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fade-in">
                        {myCourses.map(course => (
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
                        {myCourses.length === 0 && (
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
                            {isEditing && (
                                <label className="ds-btn ds-btn-secondary cursor-pointer">
                                    <Upload className="h-4 w-4" /> {t.uploadCert}
                                    <input type="file" className="hidden" accept="image/*,.pdf" onChange={handleCertUpload} />
                                </label>
                            )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {(isEditing ? editForm.certifications : user.certifications)?.map((cert, idx) => (
                                <div key={idx} className="border border-zinc-200 rounded-lg p-3 flex items-center gap-3 bg-zinc-50">
                                    <div className="ds-icon-container ds-icon-red">
                                        <Award className="h-5 w-5" />
                                    </div>
                                    <div className="flex-1 overflow-hidden">
                                        <p className="text-sm font-medium text-zinc-900 truncate">Certificate {idx + 1}</p>
                                        <a href={cert} download={`cert-${idx + 1}`} className="text-xs text-blue-600 hover:underline">View Document</a>
                                    </div>
                                    {isEditing && (
                                        <button 
                                            onClick={() => {
                                                const newCerts = [...(editForm.certifications || [])];
                                                newCerts.splice(idx, 1);
                                                setEditForm({...editForm, certifications: newCerts});
                                            }}
                                            className="text-zinc-400 hover:text-red-600"
                                        >
                                            <X className="h-4 w-4" />
                                        </button>
                                    )}
                                </div>
                            ))}
                            {(!user.certifications || user.certifications.length === 0) && !isEditing && (
                                <p className="text-zinc-500 text-sm italic col-span-2">{t.noCertifications || 'No certifications listed.'}</p>
                            )}
                        </div>
                    </div>
                );
            case 'BLOGS':
                return (
                    <div className="space-y-6 animate-fade-in">
                        {myPosts.length > 0 ? (
                            myPosts.map(post => {
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
                                                <p className="text-xs text-zinc-500 mb-2">{post.date}</p>
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

            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 -mt-20 relative z-10">
                {saveError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 flex items-center justify-between">
                        <span>{saveError}</span>
                        <button onClick={() => setSaveError(null)} className="text-red-500 hover:text-red-700">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                )}
                <div className="ds-card flex flex-col md:flex-row items-start md:items-end gap-6 mb-8">
                    <div className="relative group">
                        <div className="h-32 w-32 rounded-full border-4 border-white shadow-lg bg-zinc-200 overflow-hidden relative">
                            {editForm.avatar ? (
                                <img src={editForm.avatar} className="h-full w-full object-cover" alt={editForm.name} />
                            ) : (
                                <div className="h-full w-full flex items-center justify-center bg-zinc-100 text-zinc-400 text-4xl font-bold">
                                    {editForm.name[0]}
                                </div>
                            )}
                            {isEditing && (
                                <label className="absolute inset-0 bg-black/50 flex items-center justify-center cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Camera className="h-8 w-8 text-white" />
                                    <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                                </label>
                            )}
                        </div>
                        {!isEditing && <div className="absolute bottom-2 right-2 h-6 w-6 bg-blue-500 border-4 border-white rounded-full" title="Verified Instructor"></div>}
                    </div>
                    
                    <div className="flex-1 w-full">
                        {isEditing ? (
                            <div className="space-y-4 max-w-lg w-full">
                                <input 
                                    className="text-3xl font-black text-zinc-900 bg-transparent border-b-2 border-zinc-200 focus:border-red-600 focus:outline-none w-full pb-1"
                                    value={editForm.name}
                                    onChange={e => setEditForm({...editForm, name: e.target.value})}
                                    placeholder="Full Name"
                                />
                                <input 
                                    className="w-full border border-zinc-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-red-500 focus:outline-none"
                                    value={editForm.specialization || ''}
                                    onChange={e => setEditForm({...editForm, specialization: e.target.value})}
                                    placeholder="Specialization (e.g. AI Researcher)"
                                />
                                <div>
                                    <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">{(t as any).genderLabel || 'Gender'}</label>
                                    <select
                                        className="w-full border border-zinc-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-red-500 focus:outline-none bg-white"
                                        value={editForm.gender || ''}
                                        onChange={e => setEditForm({...editForm, gender: e.target.value === '' ? undefined : e.target.value as 'male' | 'female'})}
                                    >
                                        <option value="">{lang === 'ar' ? 'غير محدد' : '— Not specified —'}</option>
                                        <option value="male">{(t as any).genderMale || 'Male'}</option>
                                        <option value="female">{(t as any).genderFemale || 'Female'}</option>
                                    </select>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <input 
                                        className="w-full border border-zinc-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-red-500 focus:outline-none"
                                        value={editForm.email}
                                        onChange={e => setEditForm({...editForm, email: e.target.value})}
                                        placeholder="Email"
                                    />
                                    <PhoneInput
                                        value={phoneValue}
                                        onChange={(val) => {
                                            setPhoneValue(val);
                                            setEditForm({
                                                ...editForm,
                                                phone: val.full || val.number.trim() || undefined,
                                                phoneCountryCode: val.countryCode || undefined
                                            });
                                        }}
                                        placeholder="Phone"
                                        className="w-full"
                                    />
                                </div>
                                {/* Social Links Edit */}
                                <div className="grid grid-cols-1 gap-2">
                                    <input 
                                        className="w-full border border-zinc-300 rounded-lg p-2 text-xs"
                                        value={editForm.socialLinks?.linkedin || ''}
                                        onChange={e => setEditForm({...editForm, socialLinks: {...editForm.socialLinks, linkedin: e.target.value}})}
                                        placeholder="LinkedIn URL"
                                    />
                                </div>
                                
                                {/* Password Change Section */}
                                <div className="pt-4 border-t border-zinc-200">
                                    <h4 className="text-sm font-bold text-zinc-700 mb-3">{t.changePassword}</h4>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div>
                                            <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">{t.currentPassword}</label>
                                            <div className="relative">
                                                <button
                                                    type="button"
                                                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                                                    className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-700 focus:outline-none z-10"
                                                >
                                                    {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                                </button>
                                                <input 
                                                    type={showCurrentPassword ? "text" : "password"}
                                                    className="appearance-none relative block w-full border border-zinc-300 rounded-lg pl-10 pr-3 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 focus:z-10"
                                                    value={passwordForm.currentPassword}
                                                    onChange={e => setPasswordForm({...passwordForm, currentPassword: e.target.value})}
                                                    placeholder={t.currentPassword}
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">{t.newPassword}</label>
                                            <div className="relative">
                                                <button
                                                    type="button"
                                                    onClick={() => setShowNewPassword(!showNewPassword)}
                                                    className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-700 focus:outline-none z-10"
                                                >
                                                    {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                                </button>
                                                <input 
                                                    type={showNewPassword ? "text" : "password"}
                                                    className="appearance-none relative block w-full border border-zinc-300 rounded-lg pl-10 pr-3 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 focus:z-10"
                                                    value={passwordForm.newPassword}
                                                    onChange={e => setPasswordForm({...passwordForm, newPassword: e.target.value})}
                                                    placeholder={t.newPassword}
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">{t.confirmNewPassword}</label>
                                            <div className="relative">
                                                <button
                                                    type="button"
                                                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                                    className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-700 focus:outline-none z-10"
                                                >
                                                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                                </button>
                                                <input 
                                                    type={showConfirmPassword ? "text" : "password"}
                                                    className="appearance-none relative block w-full border border-zinc-300 rounded-lg pl-10 pr-3 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 focus:z-10"
                                                    value={passwordForm.confirmNewPassword}
                                                    onChange={e => setPasswordForm({...passwordForm, confirmNewPassword: e.target.value})}
                                                    placeholder={t.confirmNewPassword}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <div className="mt-3 flex items-center gap-3">
                                        <button 
                                            onClick={handlePasswordChange}
                                            className="bg-zinc-700 text-white px-4 py-2 rounded-lg font-medium text-sm hover:bg-zinc-800"
                                        >
                                            {t.changePassword}
                                        </button>
                                        {passwordError && (
                                            <p className="text-red-600 text-sm">{passwordError}</p>
                                        )}
                                        {passwordSuccess && (
                                            <p className="text-green-600 text-sm">{t.passwordChanged}</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div>
                                <h1 className="ds-page-title mb-1 flex items-center gap-2">
                                    {user.name} 
                                    <span className="text-sm font-normal text-white bg-zinc-800 px-2 py-0.5 rounded ml-2 align-middle">Instructor</span>
                                </h1>
                                <p className="text-red-600 font-medium mb-3">{user.specialization || user.expertise || 'General Instructor'}</p>
                                <div className="mb-3 flex flex-wrap gap-6 text-sm">
                                    <div>
                                        <p className="text-xs font-bold text-zinc-400 uppercase">{(t as any).genderLabel || 'Gender'}</p>
                                        <p className="text-zinc-700">
                                            {user.gender ? (user.gender === 'male' ? ((t as any).genderMale || 'Male') : ((t as any).genderFemale || 'Female')) : '—'}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs font-bold text-zinc-400 uppercase">{(t as any).expertiseLabel || 'Area of Expertise/Field of Study'}</p>
                                        <p className="text-zinc-700">{user.specialization || user.expertise || '—'}</p>
                                    </div>
                                </div>
                                
                                <div className="flex flex-wrap gap-4 text-sm text-zinc-500 mb-4">
                                    <div className="flex items-center gap-1">
                                        <Mail className="h-4 w-4" /> {user.email}
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Phone className="h-4 w-4" /> <span dir="ltr" className="inline-block text-left">{formatPhoneNumberDisplay(user.phone, user.phoneCountryCode) || 'N/A'}</span>
                                    </div>
                                </div>

                                <div className="flex gap-3">
                                    {user.socialLinks?.linkedin && <a href={user.socialLinks.linkedin} target="_blank" rel="noopener" className="p-1.5 bg-zinc-100 rounded hover:bg-[#0077b5] hover:text-white transition-colors"><Linkedin className="h-4 w-4" /></a>}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                        {isEditing ? (
                            <>
                                <button onClick={handleCancel} disabled={isSaving} className="ds-btn ds-btn-secondary disabled:opacity-50 disabled:cursor-not-allowed">
                                    <X className="h-4 w-4" /> {t.cancel}
                                </button>
                                <button onClick={handleSave} disabled={isSaving} className="ds-btn ds-btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
                                    {isSaving ? (
                                        <>
                                            <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                                            {lang === 'ar' ? 'جاري الحفظ...' : 'Saving...'}
                                        </>
                                    ) : (
                                        <>
                                            <Save className="h-4 w-4" /> {t.save}
                                        </>
                                    )}
                                </button>
                            </>
                        ) : (
                            <button onClick={() => {
                                // Block guests from editing
                                if (isGuest && onShowRestrictionModal) {
                                    onShowRestrictionModal();
                                    return;
                                }
                                setEditForm(user);
                                setPhoneValue(resolvePhoneValue(user));
                                setIsEditing(true);
                            }} className="ds-btn ds-btn-secondary">
                                {t.editProfile}
                            </button>
                        )}
                    </div>
                </div>

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
