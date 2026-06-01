import React, { useState, useEffect } from 'react';
import { Upload, X, Link2, Image as ImageIcon, Video as VideoIcon, CheckCircle } from 'lucide-react';

interface MediaUploadProps {
  value: string;
  onChange: (url: string) => void;
  type: 'image' | 'video' | 'thumbnail' | 'avatar';
  label?: string;
  placeholder?: string;
  accept?: string;
  uploadEndpoint?: string;
  disabled?: boolean;
  className?: string;
  showPreview?: boolean;
  translations?: {
    upload?: string;
    uploading?: string;
    urlPlaceholder?: string;
    uploadSuccess?: string;
    uploadError?: string;
    onlyLinksAllowed?: string;
  };
}

export const MediaUpload: React.FC<MediaUploadProps> = ({
  value,
  onChange,
  type,
  label,
  placeholder,
  accept,
  uploadEndpoint,
  disabled = false,
  className = '',
  showPreview = true,
  translations = {}
}) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadAllowed, setUploadAllowed] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch media settings on mount
  useEffect(() => {
    const fetchMediaSettings = async () => {
      try {
        const response = await fetch('/api/media-settings');
        if (response.ok) {
          const settings = await response.json();
          setUploadAllowed(settings.allowDirectUpload);
        }
      } catch (err) {
        console.error('Failed to fetch media settings:', err);
        // Default to allowing uploads if fetch fails
        setUploadAllowed(true);
      }
    };

    fetchMediaSettings();
  }, []);

  const getDefaultEndpoint = () => {
    if (uploadEndpoint) return uploadEndpoint;
    
    switch (type) {
      case 'image':
        return '/api/upload/image';
      case 'video':
        return '/api/upload/video';
      case 'thumbnail':
        return '/api/upload/thumbnail';
      case 'avatar':
        return '/api/upload/avatar';
      default:
        return '/api/upload/image';
    }
  };

  const getDefaultAccept = () => {
    if (accept) return accept;
    
    switch (type) {
      case 'video':
        return 'video/*';
      case 'image':
      case 'thumbnail':
      case 'avatar':
      default:
        return 'image/*';
    }
  };

  const getFieldName = () => {
    switch (type) {
      case 'video':
        return 'video';
      case 'thumbnail':
        return 'thumbnail';
      case 'avatar':
        return 'avatar';
      case 'image':
      default:
        return 'image';
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append(getFieldName(), file);

      const response = await fetch(getDefaultEndpoint(), {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Upload failed');
      }

      const data = await response.json();
      onChange(data.url);
    } catch (err) {
      console.error('Upload error:', err);
      setError(translations.uploadError || 'Upload failed. Please try again.');
    } finally {
      setIsUploading(false);
      // Reset the input
      e.target.value = '';
    }
  };

  const handleClear = () => {
    onChange('');
    setError(null);
  };

  const isVideo = type === 'video';
  const isImage = type === 'image' || type === 'thumbnail' || type === 'avatar';

  const toVideoPreviewUrl = (rawUrl: string): string | null => {
    const trimmed = rawUrl.trim();
    if (!trimmed) {
      return null;
    }

    const parseYouTubeId = (url: string): string | null => {
      try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
        const pathParts = parsed.pathname.split('/').filter(Boolean);

        if (host === 'youtu.be') {
          return pathParts[0] || null;
        }

        if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
          const searchVideoId = parsed.searchParams.get('v');
          if (searchVideoId) {
            return searchVideoId;
          }
          if (pathParts[0] === 'shorts' || pathParts[0] === 'live' || pathParts[0] === 'embed' || pathParts[0] === 'v') {
            return pathParts[1] || null;
          }
        }
      } catch {
        // Fall through to regex checks.
      }

      const shortMatch = url.match(/youtu\.be\/([^?&#/]+)/i);
      if (shortMatch?.[1]) {
        return shortMatch[1];
      }
      const watchMatch = url.match(/[?&]v=([^?&#/]+)/i);
      if (watchMatch?.[1]) {
        return watchMatch[1];
      }
      const embedMatch = url.match(/youtube(?:-nocookie)?\.com\/(?:shorts|live|embed|v)\/([^?&#/]+)/i);
      if (embedMatch?.[1]) {
        return embedMatch[1];
      }
      return null;
    };

    const youtubeId = parseYouTubeId(trimmed);
    if (youtubeId) {
      return `https://www.youtube.com/embed/${youtubeId}?autoplay=0&mute=1&controls=1&playsinline=1&rel=0&modestbranding=1`;
    }

    const vimeoMatch = trimmed.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
    if (vimeoMatch?.[1]) {
      return `https://player.vimeo.com/video/${vimeoMatch[1]}?autoplay=0&muted=1&loop=0&controls=1`;
    }

    return null;
  };

  const previewVideoUrl = isVideo ? toVideoPreviewUrl(value) : null;

  return (
    <div className={`space-y-2 ${className}`}>
      {label && (
        <label className="block text-sm font-medium text-zinc-700">
          {label}
        </label>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          className="flex-1 border border-zinc-300 rounded-lg p-2 text-sm"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || translations.urlPlaceholder || 'Enter URL or upload file...'}
          disabled={disabled}
        />

        {uploadAllowed ? (
          <label className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 cursor-pointer ${
            isUploading || disabled
              ? 'bg-zinc-300 text-zinc-500 cursor-not-allowed'
              : isVideo
              ? 'bg-purple-600 text-white hover:bg-purple-700'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}>
            <Upload className="h-4 w-4" />
            {isUploading
              ? translations.uploading || 'Uploading...'
              : translations.upload || 'Upload'}
            <input
              type="file"
              accept={getDefaultAccept()}
              className="hidden"
              onChange={handleFileUpload}
              disabled={isUploading || disabled}
            />
          </label>
        ) : (
          <div 
            className="px-4 py-2 bg-zinc-100 text-zinc-500 rounded-lg font-medium flex items-center gap-2 text-sm"
            title={translations.onlyLinksAllowed || 'Direct upload disabled. Please use external links.'}
          >
            <Link2 className="h-4 w-4" />
            {translations.linksOnly || 'Links Only'}
          </div>
        )}

        {value && (
          <button
            onClick={handleClear}
            className="px-3 py-2 bg-red-900 text-white rounded-lg hover:bg-red-950"
            title="Clear"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-600 flex items-center gap-1">
          <X className="h-3 w-3" />
          {error}
        </p>
      )}

      {value && !error && value.startsWith('/uploads/') && (
        <p className="text-xs text-green-600 flex items-center gap-1">
          <CheckCircle className="h-3 w-3" />
          {translations.uploadSuccess || 'File uploaded successfully'}
        </p>
      )}

      {/* Preview */}
      {showPreview && value && (
        <div className="mt-2">
          {isImage && (
            <div className="w-full h-40 overflow-hidden rounded-lg bg-zinc-100 border border-zinc-200">
              <img
                src={value}
                alt="Preview"
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
          )}

          {isVideo && (
            <div className="w-full rounded-lg overflow-hidden bg-black">
              {previewVideoUrl ? (
                <div className="aspect-video">
                  <iframe
                    src={previewVideoUrl}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              ) : (
                <video
                  controls
                  className="w-full max-h-60"
                  onError={(e) => {
                    (e.target as HTMLVideoElement).style.display = 'none';
                  }}
                >
                  <source src={value} />
                  Your browser does not support the video tag.
                </video>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MediaUpload;
