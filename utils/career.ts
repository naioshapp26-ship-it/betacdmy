import { CareerJob } from '../types';

const DEFAULT_APPLY_TEXT = 'Apply Now';

export const CAREER_EMPLOYMENT_TYPES: string[] = [
    'Full-time',
    'Part-time',
    'Contract',
    'Internship',
    'Temporary'
];

const generateJobId = () => {
    const globalCrypto = typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined;
    if (globalCrypto && typeof globalCrypto.randomUUID === 'function') {
        return globalCrypto.randomUUID();
    }
    return `job_${Math.random().toString(36).slice(2, 10)}`;
};

const sanitizeText = (value: unknown, fallback: string) => {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length) {
            return trimmed;
        }
    }
    return fallback;
};

const coerceBoolean = (value: unknown, fallback: boolean) => {
    if (typeof value === 'boolean') {
        return value;
    }
    return fallback;
};

const coerceNumber = (value: unknown, fallback: number) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return fallback;
};

export const ensureCareerJobShape = (job: Partial<CareerJob> | undefined, fallbackOrder = 0): CareerJob => {
    const baseTitle = sanitizeText(job?.title, '');
    const defaultEmployment = CAREER_EMPLOYMENT_TYPES[0];
    return {
        id: sanitizeText(job?.id, generateJobId()),
        title: baseTitle,
        description: sanitizeText(job?.description, ''),
        location: sanitizeText(job?.location, ''),
        employmentType: sanitizeText(job?.employmentType, defaultEmployment),
        applyButtonText: sanitizeText(job?.applyButtonText, ''),
        isPublished: coerceBoolean(job?.isPublished, false),
        department: sanitizeText(job?.department ?? '', ''),
        sortOrder: coerceNumber(job?.sortOrder, fallbackOrder),
        highlight: sanitizeText(job?.highlight ?? '', ''),
        createdAt: job?.createdAt ?? null,
        updatedAt: job?.updatedAt ?? null
    };
};

export const parseCareerJobs = (raw?: string | null): CareerJob[] => {
    if (!raw || !raw.trim()) {
        return [];
    }
    try {
        const payload = JSON.parse(raw);
        if (!Array.isArray(payload)) {
            return [];
        }
        const normalized = payload.map((job, index) => ensureCareerJobShape(job, index));
        return normalized.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    } catch (error) {
        console.warn('Failed to parse career jobs payload', error);
        return [];
    }
};

export const serializeCareerJobs = (jobs: CareerJob[]): string => {
    if (!jobs.length) {
        return '[]';
    }
    const sorted = [...jobs].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    return JSON.stringify(sorted, null, 2);
};

export const createCareerJob = (overrides: Partial<CareerJob> = {}, nextOrder = Date.now()): CareerJob => {
    return ensureCareerJobShape({
        ...overrides,
        id: overrides.id || generateJobId(),
        sortOrder: overrides.sortOrder ?? nextOrder
    }, nextOrder);
};

export const moveCareerJob = (jobs: CareerJob[], sourceId: string, targetId: string): CareerJob[] => {
    if (sourceId === targetId) {
        return jobs;
    }
    const next = [...jobs];
    const fromIndex = next.findIndex((job) => job.id === sourceId);
    const toIndex = next.findIndex((job) => job.id === targetId);
    if (fromIndex === -1 || toIndex === -1) {
        return jobs;
    }
    const [removed] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, removed);
    return next.map((job, index) => ({
        ...job,
        sortOrder: index
    }));
};

export const duplicateCareerJob = (job: CareerJob, nextOrder = Date.now()): CareerJob => {
    return createCareerJob({
        title: `${job.title} (Copy)`,
        description: job.description,
        location: job.location,
        employmentType: job.employmentType,
        applyButtonText: job.applyButtonText,
        department: job.department,
        isPublished: false,
        highlight: job.highlight
    }, nextOrder);
};

export const hasPublishedCareerJobs = (jobs: CareerJob[]): boolean => {
    return jobs.some((job) => job.isPublished);
};

export { DEFAULT_APPLY_TEXT as DEFAULT_CAREER_APPLY_TEXT };
