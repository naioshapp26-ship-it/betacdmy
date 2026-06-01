import { Pool } from 'pg';
import { getPlanQuota, PlanType } from '../middleware/rate-limiter.js';

export class QuotaService {
  /**
   * Check if tenant has reached user quota
   */
  async checkUserQuota(tenantPool: Pool, plan: string): Promise<{ allowed: boolean; current: number; limit: number }> {
    const quota = getPlanQuota(plan);
    
    const result = await tenantPool.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM users'
    );
    
    const current = parseInt(result.rows[0]?.count || '0', 10);
    const limit = quota.maxUsers;
    
    return {
      allowed: current < limit,
      current,
      limit: limit === Infinity ? -1 : limit
    };
  }

  /**
   * Check if tenant has reached course quota
   */
  async checkCourseQuota(tenantPool: Pool, plan: string): Promise<{ allowed: boolean; current: number; limit: number }> {
    const quota = getPlanQuota(plan);
    
    const result = await tenantPool.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM courses'
    );
    
    const current = parseInt(result.rows[0]?.count || '0', 10);
    const limit = quota.maxCourses;
    
    return {
      allowed: current < limit,
      current,
      limit: limit === Infinity ? -1 : limit
    };
  }

  /**
   * Check if tenant has reached storage quota
   * Note: This is a simplified version. In production, you'd track actual file sizes
   */
  async checkStorageQuota(tenantPool: Pool, plan: string, additionalSizeGb: number = 0): Promise<{ allowed: boolean; current: number; limit: number }> {
    const quota = getPlanQuota(plan);
    
    // This is a placeholder - in production, track actual storage usage
    // You might have a separate table tracking file uploads and their sizes
    const result = await tenantPool.query<{ total_size: string }>(
      `SELECT COALESCE(SUM(file_size_bytes), 0) as total_size 
       FROM uploads 
       WHERE deleted_at IS NULL`
    ).catch(() => ({ rows: [{ total_size: '0' }] }));
    
    const currentBytes = parseInt(result.rows[0]?.total_size || '0', 10);
    const currentGb = currentBytes / (1024 * 1024 * 1024);
    const limit = quota.storageGb;
    
    return {
      allowed: (currentGb + additionalSizeGb) < limit,
      current: Math.round(currentGb * 100) / 100,
      limit
    };
  }

  /**
   * Get all quota usage for a tenant
   */
  async getQuotaUsage(tenantPool: Pool, plan: string): Promise<{
    plan: string;
    users: { current: number; limit: number; percentage: number };
    courses: { current: number; limit: number; percentage: number };
    storage: { current: number; limit: number; percentage: number };
  }> {
    const [users, courses, storage] = await Promise.all([
      this.checkUserQuota(tenantPool, plan),
      this.checkCourseQuota(tenantPool, plan),
      this.checkStorageQuota(tenantPool, plan)
    ]);

    const calculatePercentage = (current: number, limit: number) => {
      if (limit === -1 || limit === Infinity) return 0;
      return Math.round((current / limit) * 100);
    };

    return {
      plan,
      users: {
        current: users.current,
        limit: users.limit,
        percentage: calculatePercentage(users.current, users.limit)
      },
      courses: {
        current: courses.current,
        limit: courses.limit,
        percentage: calculatePercentage(courses.current, courses.limit)
      },
      storage: {
        current: storage.current,
        limit: storage.limit,
        percentage: calculatePercentage(storage.current, storage.limit)
      }
    };
  }

  /**
   * Check if operation is allowed based on quota
   */
  async canPerformOperation(
    tenantPool: Pool, 
    plan: string, 
    operation: 'add_user' | 'add_course' | 'upload_file',
    metadata?: { fileSizeGb?: number }
  ): Promise<{ allowed: boolean; reason?: string; quota?: any }> {
    try {
      let quota;
      
      switch (operation) {
        case 'add_user':
          quota = await this.checkUserQuota(tenantPool, plan);
          return {
            allowed: quota.allowed,
            reason: quota.allowed ? undefined : `User quota exceeded (${quota.current}/${quota.limit})`,
            quota
          };
          
        case 'add_course':
          quota = await this.checkCourseQuota(tenantPool, plan);
          return {
            allowed: quota.allowed,
            reason: quota.allowed ? undefined : `Course quota exceeded (${quota.current}/${quota.limit})`,
            quota
          };
          
        case 'upload_file':
          const fileSizeGb = metadata?.fileSizeGb || 0;
          quota = await this.checkStorageQuota(tenantPool, plan, fileSizeGb);
          return {
            allowed: quota.allowed,
            reason: quota.allowed ? undefined : `Storage quota exceeded (${quota.current}GB/${quota.limit}GB)`,
            quota
          };
          
        default:
          return { allowed: true };
      }
    } catch (error) {
      console.error('[Quota Check Error]', error);
      // Fail open - allow operation but log error
      return { 
        allowed: true, 
        reason: 'Quota check failed, allowing operation'
      };
    }
  }
}

export const quotaService = new QuotaService();
