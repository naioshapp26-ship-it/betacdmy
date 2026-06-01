import React, { useMemo, useState } from 'react';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { MediaGalleryItem, MediaItemType } from '../types';
import MediaUpload from './MediaUpload';

type MediaGalleryManagerProps = {
  items: MediaGalleryItem[];
  onChange: (items: MediaGalleryItem[]) => void;
  label?: string;
  addLabel?: string;
  emptyLabel?: string;
  className?: string;
};

const generateItemId = () => `media_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const withOrder = (items: MediaGalleryItem[]): MediaGalleryItem[] =>
  items.map((item, index) => ({ ...item, order: index }));

const normalizeItem = (item: Partial<MediaGalleryItem>, index: number): MediaGalleryItem => ({
  id: typeof item.id === 'string' && item.id.trim() ? item.id : generateItemId(),
  url: typeof item.url === 'string' ? item.url : '',
  mediaType: item.mediaType === 'video' ? 'video' : 'image',
  order: Number.isFinite(Number(item.order)) ? Number(item.order) : index
});

const MediaGalleryManager: React.FC<MediaGalleryManagerProps> = ({
  items,
  onChange,
  label,
  addLabel = 'Add media',
  emptyLabel = 'No media items yet. Add images or videos.',
  className = ''
}) => {
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const normalizedItems = useMemo(() => withOrder(items.map(normalizeItem)), [items]);

  const setItems = (nextItems: MediaGalleryItem[]) => {
    onChange(withOrder(nextItems.map(normalizeItem)));
  };

  const handleAdd = (mediaType: MediaItemType) => {
    const next = [
      ...normalizedItems,
      {
        id: generateItemId(),
        url: '',
        mediaType,
        order: normalizedItems.length
      }
    ];
    setItems(next);
  };

  const handleAddClick = (event: React.MouseEvent<HTMLButtonElement>, mediaType: MediaItemType) => {
    event.preventDefault();
    event.stopPropagation();
    handleAdd(mediaType);
  };

  const handleRemove = (id: string) => {
    setItems(normalizedItems.filter((item) => item.id !== id));
  };

  const handleUpdate = (id: string, patch: Partial<MediaGalleryItem>) => {
    setItems(normalizedItems.map((item) => (item.id === id ? normalizeItem({ ...item, ...patch }, item.order) : item)));
  };

  const handleDrop = (targetId: string) => {
    if (!draggedItemId || draggedItemId === targetId) return;
    const sourceIndex = normalizedItems.findIndex((item) => item.id === draggedItemId);
    const targetIndex = normalizedItems.findIndex((item) => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const nextItems = [...normalizedItems];
    const [moved] = nextItems.splice(sourceIndex, 1);
    nextItems.splice(targetIndex, 0, moved);
    setItems(nextItems);
    setDraggedItemId(null);
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {label && <label className="block text-sm font-medium text-zinc-700">{label}</label>}

      <div className="relative z-20 flex flex-wrap gap-2 pointer-events-auto">
        <button
          type="button"
          onClick={(event) => handleAddClick(event, 'image')}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
        >
          <Plus className="h-4 w-4" /> {addLabel} (Image)
        </button>
        <button
          type="button"
          onClick={(event) => handleAddClick(event, 'video')}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
        >
          <Plus className="h-4 w-4" /> {addLabel} (Video)
        </button>
      </div>

      {normalizedItems.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">{emptyLabel}</div>
      ) : (
        <div className="space-y-3">
          {normalizedItems.map((item, index) => (
            <div
              key={item.id}
              draggable
              onDragStart={() => setDraggedItemId(item.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => handleDrop(item.id)}
              className="rounded-lg border border-zinc-200 bg-zinc-50 p-3"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-700">
                  <span className="cursor-move text-zinc-400" title="Drag to reorder">
                    <GripVertical className="h-4 w-4" />
                  </span>
                  <span>Item #{index + 1}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(item.id)}
                  className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </button>
              </div>

              <div className="mb-3">
                <label className="mb-1 block text-xs font-semibold text-zinc-600">Media type</label>
                <select
                  className="w-full rounded-lg border border-zinc-300 p-2 text-sm"
                  value={item.mediaType}
                  onChange={(event) => handleUpdate(item.id, { mediaType: event.target.value as MediaItemType })}
                >
                  <option value="image">Image</option>
                  <option value="video">Video</option>
                </select>
              </div>

              <MediaUpload
                type={item.mediaType}
                value={item.url}
                onChange={(url) => handleUpdate(item.id, { url })}
                label={item.mediaType === 'video' ? 'Video URL' : 'Image URL'}
                showPreview
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MediaGalleryManager;
