import { Pool } from 'pg';
import { centralPool } from '../central-db.js';

export type AuditLogAction = 
  | 'tenant.create'
  | 'tenant.update'
  | 'tenant.suspend'
  | 'tenant.reactivate'
  | 'tenant.delete'
  | 'tenant.hard_delete'
  | 'user.create'
  | 'user.update'
  | 'user.delete'
  | 'user.role_change'
  | 'subscription.create'
  | 'subscription.upgrade'
  | 'subscription.downgrade'
  | 'subscription.cancel'
  | 'payment.process'
  | 'payment.refund'
  | 'course.create'
  | 'course.update'
  | 'course.delete'
  | 'course.publish'
  | 'enrollment.create'
  | 'enrollment.delete'
  | 'setting.update'
  | 'media.upload'
  | 'media.delete'
  | 'admin.login'
  | 'admin.logout'
  | 'system.maintenance_mode';

export type AuditLogStatus = 'success' | 'failure' | 'error';

export type ResourceType = 
  | 'tenant'
  | 'user'
  | 'course'
  | 'subscription'
  | 'payment'
  | 'enrollment'
  | 'setting'
  | 'media'
  | 'admin'
  | 'system';

export interface AuditLogEntry {
  tenantId?: string;
  userId?: string;
  userEmail?: string;
  action: AuditLogAction;
  resourceType: ResourceType;
  resourceId?: string;
  ipAddress?: string;
  userAgent?: string;
  status?: AuditLogStatus;
  errorMessage?: string;
  metadata?: Record<string, any>;
  stateBefore?: Record<string, any>;
  stateAfter?: Record<string, any>;
}

export interface AuditLogQuery {
  tenantId?: string;
  userId?: string;
  action?: string;
  resourceType?: ResourceType;
  resourceId?: string;
  status?: AuditLogStatus;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export interface AuditLogResult {
  id: string;
  tenant_id: string | null;
  user_id: string | null;
  user_email: string | null;
  action: AuditLogAction;
  resource_type: ResourceType;
  resource_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  status: AuditLogStatus;
  error_message: string | null;
  metadata: Record<string, any>;
  state_before: Record<string, any> | null;
  state_after: Record<string, any> | null;
  created_at: string;
}

export class AuditLogService {
  constructor(private readonly pool: Pool = centralPool) {}

  /**
   * Create an audit log entry
   */
  async log(entry: AuditLogEntry): Promise<string> {
    const {
      tenantId = null,
      userId = null,
      userEmail = null,
      action,
      resourceType,
      resourceId = null,
      ipAddress = null,
      userAgent = null,
      status = 'success',
      errorMessage = null,
      metadata = {},
      stateBefore = null,
      stateAfter = null
    } = entry;

    try {
      const result = await this.pool.query<{ id: string }>(
        `INSERT INTO audit_logs (
          tenant_id, user_id, user_email, action, resource_type, resource_id,
          ip_address, user_agent, status, error_message, metadata, 
          state_before, state_after
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING id`,
        [
          tenantId,
          userId,
          userEmail,
          action,
          resourceType,
          resourceId,
          ipAddress,
          userAgent,
          status,
          errorMessage,
          JSON.stringify(metadata),
          stateBefore ? JSON.stringify(stateBefore) : null,
          stateAfter ? JSON.stringify(stateAfter) : null
        ]
      );

      return result.rows[0].id;
    } catch (error) {
      // Log to console if audit logging itself fails
      console.error('Failed to create audit log:', error);
      console.error('Audit entry:', entry);
      throw error;
    }
  }

  /**
   * Create an audit log for a successful operation
   */
  async logSuccess(entry: Omit<AuditLogEntry, 'status'>): Promise<string> {
    return this.log({ ...entry, status: 'success' });
  }

  /**
   * Create an audit log for a failed operation
   */
  async logFailure(
    entry: Omit<AuditLogEntry, 'status' | 'errorMessage'>,
    errorMessage: string
  ): Promise<string> {
    return this.log({ ...entry, status: 'failure', errorMessage });
  }

  /**
   * Create an audit log for an error
   */
  async logError(
    entry: Omit<AuditLogEntry, 'status' | 'errorMessage'>,
    error: Error
  ): Promise<string> {
    return this.log({
      ...entry,
      status: 'error',
      errorMessage: error.message
    });
  }

  /**
   * Query audit logs with filters
   */
  async query(filters: AuditLogQuery): Promise<AuditLogResult[]> {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (filters.tenantId) {
      conditions.push(`tenant_id = $${paramIndex++}`);
      params.push(filters.tenantId);
    }

    if (filters.userId) {
      conditions.push(`user_id = $${paramIndex++}`);
      params.push(filters.userId);
    }

    if (filters.action) {
      conditions.push(`action = $${paramIndex++}`);
      params.push(filters.action);
    }

    if (filters.resourceType) {
      conditions.push(`resource_type = $${paramIndex++}`);
      params.push(filters.resourceType);
    }

    if (filters.resourceId) {
      conditions.push(`resource_id = $${paramIndex++}`);
      params.push(filters.resourceId);
    }

    if (filters.status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(filters.status);
    }

    if (filters.startDate) {
      conditions.push(`created_at >= $${paramIndex++}`);
      params.push(filters.startDate.toISOString());
    }

    if (filters.endDate) {
      conditions.push(`created_at <= $${paramIndex++}`);
      params.push(filters.endDate.toISOString());
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit || 100;
    const offset = filters.offset || 0;

    const query = `
      SELECT 
        id, tenant_id, user_id, user_email, action, resource_type, resource_id,
        ip_address, user_agent, status, error_message, metadata, 
        state_before, state_after, created_at
      FROM audit_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    params.push(limit, offset);

    const result = await this.pool.query<AuditLogResult>(query, params);
    return result.rows;
  }

  /**
   * Get audit logs for a specific resource
   */
  async getResourceAuditTrail(
    resourceType: ResourceType,
    resourceId: string,
    limit: number = 50
  ): Promise<AuditLogResult[]> {
    return this.query({ resourceType, resourceId, limit });
  }

  /**
   * Get recent audit logs for a tenant
   */
  async getTenantAuditLogs(
    tenantId: string,
    limit: number = 100
  ): Promise<AuditLogResult[]> {
    return this.query({ tenantId, limit });
  }

  /**
   * Get audit logs for a specific user
   */
  async getUserAuditLogs(
    userId: string,
    limit: number = 100
  ): Promise<AuditLogResult[]> {
    return this.query({ userId, limit });
  }

  /**
   * Get audit statistics for a time period
   */
  async getStatistics(startDate: Date, endDate: Date): Promise<{
    totalLogs: number;
    successCount: number;
    failureCount: number;
    errorCount: number;
    byAction: Array<{ action: string; count: number }>;
    byResourceType: Array<{ resource_type: string; count: number }>;
  }> {
    const statsQuery = `
      SELECT 
        COUNT(*) as total_logs,
        COUNT(*) FILTER (WHERE status = 'success') as success_count,
        COUNT(*) FILTER (WHERE status = 'failure') as failure_count,
        COUNT(*) FILTER (WHERE status = 'error') as error_count
      FROM audit_logs
      WHERE created_at >= $1 AND created_at <= $2
    `;

    const byActionQuery = `
      SELECT action, COUNT(*) as count
      FROM audit_logs
      WHERE created_at >= $1 AND created_at <= $2
      GROUP BY action
      ORDER BY count DESC
      LIMIT 10
    `;

    const byResourceQuery = `
      SELECT resource_type, COUNT(*) as count
      FROM audit_logs
      WHERE created_at >= $1 AND created_at <= $2
      GROUP BY resource_type
      ORDER BY count DESC
    `;

    const [statsResult, actionResult, resourceResult] = await Promise.all([
      this.pool.query(statsQuery, [startDate.toISOString(), endDate.toISOString()]),
      this.pool.query(byActionQuery, [startDate.toISOString(), endDate.toISOString()]),
      this.pool.query(byResourceQuery, [startDate.toISOString(), endDate.toISOString()])
    ]);

    const stats = statsResult.rows[0];

    return {
      totalLogs: parseInt(stats.total_logs),
      successCount: parseInt(stats.success_count),
      failureCount: parseInt(stats.failure_count),
      errorCount: parseInt(stats.error_count),
      byAction: actionResult.rows.map(r => ({ action: r.action, count: parseInt(r.count) })),
      byResourceType: resourceResult.rows.map(r => ({ resource_type: r.resource_type, count: parseInt(r.count) }))
    };
  }

  /**
   * Delete old audit logs based on retention policy
   */
  async cleanupOldLogs(retentionDays: number = 365): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await this.pool.query(
      `DELETE FROM audit_logs WHERE created_at < $1`,
      [cutoffDate.toISOString()]
    );

    return result.rowCount || 0;
  }
}

// Export singleton instance
export const auditLogService = new AuditLogService();
