import { centralPool } from '../central-db.js';
export class AuditLogService {
    pool;
    constructor(pool = centralPool) {
        this.pool = pool;
    }
    /**
     * Create an audit log entry
     */
    async log(entry) {
        const { tenantId = null, userId = null, userEmail = null, action, resourceType, resourceId = null, ipAddress = null, userAgent = null, status = 'success', errorMessage = null, metadata = {}, stateBefore = null, stateAfter = null } = entry;
        try {
            const result = await this.pool.query(`INSERT INTO audit_logs (
          tenant_id, user_id, user_email, action, resource_type, resource_id,
          ip_address, user_agent, status, error_message, metadata, 
          state_before, state_after
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING id`, [
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
            ]);
            return result.rows[0].id;
        }
        catch (error) {
            // Log to console if audit logging itself fails
            console.error('Failed to create audit log:', error);
            console.error('Audit entry:', entry);
            throw error;
        }
    }
    /**
     * Create an audit log for a successful operation
     */
    async logSuccess(entry) {
        return this.log({ ...entry, status: 'success' });
    }
    /**
     * Create an audit log for a failed operation
     */
    async logFailure(entry, errorMessage) {
        return this.log({ ...entry, status: 'failure', errorMessage });
    }
    /**
     * Create an audit log for an error
     */
    async logError(entry, error) {
        return this.log({
            ...entry,
            status: 'error',
            errorMessage: error.message
        });
    }
    /**
     * Query audit logs with filters
     */
    async query(filters) {
        const conditions = [];
        const params = [];
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
        const result = await this.pool.query(query, params);
        return result.rows;
    }
    /**
     * Get audit logs for a specific resource
     */
    async getResourceAuditTrail(resourceType, resourceId, limit = 50) {
        return this.query({ resourceType, resourceId, limit });
    }
    /**
     * Get recent audit logs for a tenant
     */
    async getTenantAuditLogs(tenantId, limit = 100) {
        return this.query({ tenantId, limit });
    }
    /**
     * Get audit logs for a specific user
     */
    async getUserAuditLogs(userId, limit = 100) {
        return this.query({ userId, limit });
    }
    /**
     * Get audit statistics for a time period
     */
    async getStatistics(startDate, endDate) {
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
    async cleanupOldLogs(retentionDays = 365) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
        const result = await this.pool.query(`DELETE FROM audit_logs WHERE created_at < $1`, [cutoffDate.toISOString()]);
        return result.rowCount || 0;
    }
}
// Export singleton instance
export const auditLogService = new AuditLogService();
