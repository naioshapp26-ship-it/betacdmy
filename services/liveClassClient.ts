import { LiveClass } from '../types';

export interface CreateLiveClassPayload {
  instructorId: string;
  topic: string;
  agenda?: string;
  startTime?: string;
  platform: 'smrrtx' | 'zoom' | 'meet';
  inviteType: 'all' | 'specific';
  studentIds: string[];
  durationMinutes?: number;
}

const parseResponse = async <T>(response: Response): Promise<T> => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.error === 'string' ? data.error : response.statusText;
    throw new Error(message || 'Request failed');
  }
  return data as T;
};

export const createLiveClass = async (payload: CreateLiveClassPayload): Promise<LiveClass> => {
  const response = await fetch('/api/live-classes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return parseResponse<LiveClass>(response);
};

export const updateLiveClassStatus = async (id: string, status: LiveClass['status'], recordingUrl?: string): Promise<LiveClass> => {
  const response = await fetch(`/api/live-classes/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, recordingUrl })
  });
  return parseResponse<LiveClass>(response);
};
