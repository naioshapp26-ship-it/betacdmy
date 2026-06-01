import { Pool } from 'pg';
import { centralPool, TenantRow } from '../central-db.js';
import { getTenantPool, evictPool } from './db-manager.js';
import { auditLogService } from './audit-log.service.js';
import fs from 'fs/promises';
import path from 'path';

export type TenantCleanupOptions = {
  dropDatabase?: boolean;
  deleteFiles?: boolean;
  archiveCentralRecords?: boolean;
  retentionDays?: number;
};

export type CleanupResult = {
  tenantId: string;
  subdomain: string;
  databaseDropped: boolean;
  filesDeleted: number;
  centralRecordsArchived: boolean;
  errors: string[];
};

/**
 * Service for performing hard delete and full cleanup of tenant data
 * Handles:
 * - Database deletion (DROP DATABASE)
 * - File storage cleanup
 * - Central DB record archival/deletion
 */
export class TenantCleanupService {
  constructor(private readonly central: Pool = centralPool) {}

  /**
   * Perform hard delete with full cleanup of tenant
   */
  async hardDeleteTenant(tenantId: string, options: TenantCleanupOptions = {}): Promise<CleanupResult> {
    const {
      dropDatabase = true,
      deleteFiles = true,
      archiveCentralRecords = true,
      retentionDays = 90
    } = options;

    const result: CleanupResult = {
      tenantId,
      subdomain: '',
      databaseDropped: false,
      filesDeleted: 0,
      centralRecordsArchived: false,
      errors: []
    };

    try {
      // Step 1: Fetch tenant information
      const tenant = await this.fetchTenantById(tenantId);
      if (!tenant) {
        throw new Error(`Tenant ${tenantId} not found`);
      }
      result.subdomain = tenant.subdomain;
      
      const stateBefore = { ...tenant };

      console.log(`[TenantCleanup] Starting hard delete for tenant ${tenantId} (${tenant.subdomain})`);
      
      // Log cleanup initiation
      await this.logCleanupAction(tenantId, 'HARD_DELETE_INITIATED', {
        dropDatabase,
        deleteFiles,
        archiveCentralRecords,
        retentionDays
      });

      // Audit log: Hard delete initiated
      await auditLogService.logSuccess({
        tenantId,
        action: 'tenant.hard_delete',
        resourceType: 'tenant',
        resourceId: tenantId,
        metadata: {
          options,
          subdomain: tenant.subdomain
        },
        stateBefore
      }).catch(err => console.error('Failed to create audit log:', err));

      // Step 2: Evict tenant pool from cache
      try {
        evictPool(tenantId);
        console.log(`[TenantCleanup] Evicted pool for tenant ${tenantId}`);
      } catch (error) {
        result.errors.push(`Failed to evict pool: ${(error as Error).message}`);
      }

      // Step 3: Delete tenant files from storage
      if (deleteFiles) {
        try {
          const deletedCount = await this.deleteTenantFiles(tenant);
          result.filesDeleted = deletedCount;
          console.log(`[TenantCleanup] Deleted ${deletedCount} files for tenant ${tenantId}`);
        } catch (error) {
          const errorMsg = `Failed to delete files: ${(error as Error).message}`;
          result.errors.push(errorMsg);
          console.error(`[TenantCleanup] ${errorMsg}`);
        }
      }

      // Step 4: Drop tenant database
      if (dropDatabase && tenant.database_name) {
        try {
          await this.dropTenantDatabase(tenant.database_name);
          result.databaseDropped = true;
          console.log(`[TenantCleanup] Dropped database ${tenant.database_name}`);
        } catch (error) {
          const errorMsg = `Failed to drop database: ${(error as Error).message}`;
          result.errors.push(errorMsg);
          console.error(`[TenantCleanup] ${errorMsg}`);
        }
      }

      // Step 5: Archive or delete Central DB records
      if (archiveCentralRecords) {
        try {
          await this.archiveCentralRecords(tenant, retentionDays);
          result.centralRecordsArchived = true;
          console.log(`[TenantCleanup] Archived central records for tenant ${tenantId}`);
        } catch (error) {
          const errorMsg = `Failed to archive central records: ${(error as Error).message}`;
          result.errors.push(errorMsg);
          console.error(`[TenantCleanup] ${errorMsg}`);
        }
      } else {
        // Hard delete from central DB
        try {
          await this.deleteCentralRecords(tenantId);
          console.log(`[TenantCleanup] Deleted central records for tenant ${tenantId}`);
        } catch (error) {
          const errorMsg = `Failed to delete central records: ${(error as Error).message}`;
          result.errors.push(errorMsg);
          console.error(`[TenantCleanup] ${errorMsg}`);
        }
      }

      // Log cleanup completion
      await this.logCleanupAction(tenantId, 'HARD_DELETE_COMPLETED', {
        result,
        errors: result.errors
      });

      console.log(`[TenantCleanup] Hard delete completed for tenant ${tenantId}. Errors: ${result.errors.length}`);
      
      return result;
    } catch (error) {
      console.error(`[TenantCleanup] Hard delete failed for tenant ${tenantId}:`, error);
      
      // Log cleanup failure
      await this.logCleanupAction(tenantId, 'HARD_DELETE_FAILED', {
        error: (error as Error).message,
        stack: (error as Error).stack
      });
      
      // Audit log: Hard delete failed
      await auditLogService.logError({
        tenantId,
        action: 'tenant.hard_delete',
        resourceType: 'tenant',
        resourceId: tenantId,
        metadata: { options }
      }, error as Error).catch(err => console.error('Failed to create audit log:', err));
      
      throw error;
    }
  }

  /**
   * Drop tenant database (destructive operation)
   */
  private async dropTenantDatabase(databaseName: string): Promise<void> {
    const adminUrl = process.env.PROVISIONING_ADMIN_DATABASE_URL;
    if (!adminUrl) {
      console.warn('[TenantCleanup] PROVISIONING_ADMIN_DATABASE_URL not set; cannot drop database %s', databaseName);
      throw new Error('Database admin URL not configured');
    }

    const adminPool = new Pool({
      connectionString: adminUrl,
      ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false
    });

    try {
      // Terminate existing connections first
      await adminPool.query(
        `SELECT pg_terminate_backend(pid) 
         FROM pg_stat_activity 
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [databaseName]
      );
      
      // Drop database
      await adminPool.query(`DROP DATABASE IF EXISTS ${databaseName}`);
      console.log(`[TenantCleanup] Successfully dropped database: ${databaseName}`);
    } finally {
      await adminPool.end();
    }
  }

  /**
   * Delete tenant-uploaded files from storage
   */
  private async deleteTenantFiles(tenant: TenantRow): Promise<number> {
    const uploadsDir = path.join(process.cwd(), 'uploads');
    let deletedCount = 0;

    try {
      // Check if uploads directory exists
      await fs.access(uploadsDir);
    } catch {
      console.log(`[TenantCleanup] Uploads directory does not exist: ${uploadsDir}`);
      return 0;
    }

    // Tenant-specific subdirectories to check
    const tenantDirs = [
      path.join(uploadsDir, tenant.subdomain),
      path.join(uploadsDir, tenant.id),
      path.join(uploadsDir, 'tenants', tenant.subdomain),
      path.join(uploadsDir, 'tenants', tenant.id)
    ];

    for (const dir of tenantDirs) {
      try {
        await fs.access(dir);
        const deleted = await this.deleteDirectoryRecursive(dir);
        deletedCount += deleted;
        console.log(`[TenantCleanup] Deleted directory: ${dir} (${deleted} files)`);
      } catch {
        // Directory doesn't exist, skip
        continue;
      }
    }

    // Also check blog-videos if they exist
    const blogVideosDir = path.join(uploadsDir, 'blog-videos', tenant.subdomain);
    try {
      await fs.access(blogVideosDir);
      const deleted = await this.deleteDirectoryRecursive(blogVideosDir);
      deletedCount += deleted;
      console.log(`[TenantCleanup] Deleted blog videos: ${blogVideosDir} (${deleted} files)`);
    } catch {
      // Directory doesn't exist, skip
    }

    return deletedCount;
  }

  /**
   * Recursively delete directory and count files
   */
  private async deleteDirectoryRecursive(dirPath: string): Promise<number> {
    let count = 0;

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        if (entry.isDirectory()) {
          count += await this.deleteDirectoryRecursive(fullPath);
        } else {
          await fs.unlink(fullPath);
          count++;
        }
      }

      // Remove the directory itself
      await fs.rmdir(dirPath);
    } catch (error) {
      console.error(`[TenantCleanup] Error deleting directory ${dirPath}:`, error);
      throw error;
    }

    return count;
  }

  /**
   * Archive central DB records with retention period
   */
  private async archiveCentralRecords(tenant: TenantRow, retentionDays: number): Promise<void> {
    const client = await this.central.connect();
    
    try {
      await client.query('BEGIN');

      // Create archived_tenants table if it doesn't exist
      await client.query(`
        CREATE TABLE IF NOT EXISTS archived_tenants (
          id UUID PRIMARY KEY,
          subdomain VARCHAR(63) NOT NULL,
          company_name VARCHAR(255) NOT NULL,
          database_name VARCHAR(255),
          subscription_plan VARCHAR(50),
          status VARCHAR(50),
          created_at TIMESTAMPTZ,
          deleted_at TIMESTAMPTZ,
          archived_at TIMESTAMPTZ DEFAULT NOW(),
          purge_after TIMESTAMPTZ,
          original_data JSONB,
          UNIQUE(subdomain)
        )
      `);

      // Fetch full tenant data including timestamps
      const tenantData = await client.query(
        `SELECT * FROM tenants WHERE id = $1`,
        [tenant.id]
      );

      if (tenantData.rows.length === 0) {
        throw new Error('Tenant not found');
      }

      const fullTenant = tenantData.rows[0];

      // Archive tenant record
      const purgeDate = new Date();
      purgeDate.setDate(purgeDate.getDate() + retentionDays);

      await client.query(`
        INSERT INTO archived_tenants 
          (id, subdomain, company_name, database_name, subscription_plan, status, 
           created_at, deleted_at, purge_after, original_data)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9)
        ON CONFLICT (subdomain) 
        DO UPDATE SET 
          archived_at = NOW(),
          purge_after = EXCLUDED.purge_after,
          original_data = EXCLUDED.original_data
      `, [
        tenant.id,
        tenant.subdomain,
        tenant.company_name,
        tenant.database_name,
        tenant.subscription_plan,
        'deleted',
        fullTenant.created_at || new Date(),
        purgeDate,
        JSON.stringify({
          database_url_encrypted: tenant.database_url_encrypted,
          status: tenant.status,
          settings: tenant.settings || {}
        })
      ]);

      // Archive tenant_admins
      await client.query(`
        CREATE TABLE IF NOT EXISTS archived_tenant_admins (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          tenant_id UUID NOT NULL,
          email VARCHAR(255) NOT NULL,
          first_name VARCHAR(100),
          last_name VARCHAR(100),
          is_primary BOOLEAN,
          archived_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await client.query(`
        INSERT INTO archived_tenant_admins (tenant_id, email, first_name, last_name, is_primary)
        SELECT tenant_id, email, first_name, last_name, is_primary
        FROM tenant_admins
        WHERE tenant_id = $1
        ON CONFLICT DO NOTHING
      `, [tenant.id]);

      // Archive payment transactions and subscription refunds
      await client.query(`
        CREATE TABLE IF NOT EXISTS archived_payment_transactions (
          id UUID PRIMARY KEY,
          tenant_id UUID,
          subscription_id UUID,
          amount DECIMAL(12,4) NOT NULL,
          currency VARCHAR(3) DEFAULT 'USD',
          status VARCHAR(20),
          payment_method VARCHAR(50),
          transaction_reference VARCHAR(255),
          metadata JSONB,
          created_at TIMESTAMPTZ,
          archived_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS archived_subscription_refunds (
          id UUID PRIMARY KEY,
          payment_transaction_id UUID NOT NULL,
          refund_id TEXT NOT NULL,
          stripe_refund_id TEXT,
          amount DECIMAL(12,4) NOT NULL,
          currency VARCHAR(3) DEFAULT 'USD',
          status VARCHAR(20),
          reason TEXT,
          refunded_by UUID,
          refunded_by_name TEXT,
          refunded_by_email TEXT,
          refunded_at TIMESTAMPTZ,
          stripe_receipt_number TEXT,
          metadata JSONB,
          archived_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await client.query(`
        INSERT INTO archived_subscription_refunds (
          id, payment_transaction_id, refund_id, stripe_refund_id, amount, currency, status, reason,
          refunded_by, refunded_by_name, refunded_by_email, refunded_at, stripe_receipt_number, metadata
        )
        SELECT sr.id, sr.payment_transaction_id, sr.refund_id, sr.stripe_refund_id, sr.amount, sr.currency,
               sr.status, sr.reason, sr.refunded_by, sr.refunded_by_name, sr.refunded_by_email,
               sr.refunded_at, sr.stripe_receipt_number, sr.metadata
        FROM subscription_refunds sr
        JOIN payment_transactions pt ON pt.id = sr.payment_transaction_id
        WHERE pt.tenant_id = $1
        ON CONFLICT DO NOTHING
      `, [tenant.id]);

      await client.query(`
        INSERT INTO archived_payment_transactions (
          id, tenant_id, subscription_id, amount, currency, status, payment_method,
          transaction_reference, metadata, created_at
        )
        SELECT id, tenant_id, subscription_id, amount, currency, status, payment_method,
               transaction_reference, metadata, created_at
        FROM payment_transactions
        WHERE tenant_id = $1
        ON CONFLICT DO NOTHING
      `, [tenant.id]);

      // Delete from active tables
      await client.query(`DELETE FROM tenant_admins WHERE tenant_id = $1`, [tenant.id]);
      await client.query(`DELETE FROM provisioning_logs WHERE tenant_id = $1`, [tenant.id]);
      await client.query(`DELETE FROM payment_transactions WHERE tenant_id = $1`, [tenant.id]);
      await client.query(`DELETE FROM subscriptions WHERE tenant_id = $1`, [tenant.id]);
      await client.query(`DELETE FROM tenants WHERE id = $1`, [tenant.id]);

      await client.query('COMMIT');
      console.log(`[TenantCleanup] Archived tenant ${tenant.id} with ${retentionDays} days retention`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Hard delete central DB records (no retention)
   */
  private async deleteCentralRecords(tenantId: string): Promise<void> {
    const client = await this.central.connect();
    
    try {
      await client.query('BEGIN');

      // Delete in order of foreign key dependencies
      await client.query(`DELETE FROM tenant_admins WHERE tenant_id = $1`, [tenantId]);
      await client.query(`DELETE FROM provisioning_logs WHERE tenant_id = $1`, [tenantId]);
      await client.query(`DELETE FROM payment_transactions WHERE tenant_id = $1`, [tenantId]);
      await client.query(`DELETE FROM subscriptions WHERE tenant_id = $1`, [tenantId]);
      await client.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);

      await client.query('COMMIT');
      console.log(`[TenantCleanup] Hard deleted central records for tenant ${tenantId}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Log cleanup action for audit trail
   */
  private async logCleanupAction(
    tenantId: string,
    action: string,
    details: Record<string, unknown>
  ): Promise<void> {
    try {
      // Create cleanup_logs table if it doesn't exist
      await this.central.query(`
        CREATE TABLE IF NOT EXISTS cleanup_logs (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          tenant_id UUID,
          action VARCHAR(100) NOT NULL,
          details JSONB,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await this.central.query(`
        INSERT INTO cleanup_logs (tenant_id, action, details)
        VALUES ($1, $2, $3)
      `, [tenantId, action, JSON.stringify(details)]);
    } catch (error) {
      console.error('[TenantCleanup] Failed to log cleanup action:', error);
      // Don't throw - logging failure shouldn't stop cleanup
    }
  }

  /**
   * Fetch tenant by ID
   */
  private async fetchTenantById(id: string): Promise<TenantRow | null> {
    const result = await this.central.query<TenantRow>(
      `SELECT id, subdomain, company_name, status, subscription_plan, 
              database_url_encrypted, database_name, created_at, settings
       FROM tenants
       WHERE id = $1
       LIMIT 1`,
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Get cleanup logs for a tenant
   */
  async getCleanupLogs(tenantId: string): Promise<any[]> {
    try {
      const result = await this.central.query(
        `SELECT id, tenant_id, action, details, created_at
         FROM cleanup_logs
         WHERE tenant_id = $1
         ORDER BY created_at DESC`,
        [tenantId]
      );
      return result.rows;
    } catch (error) {
      console.error('[TenantCleanup] Failed to fetch cleanup logs:', error);
      return [];
    }
  }

  /**
   * Purge archived tenants past retention period
   */
  async purgeExpiredArchives(): Promise<number> {
    try {
      const result = await this.central.query(`
        DELETE FROM archived_tenants
        WHERE purge_after < NOW()
        RETURNING id
      `);
      
      const count = result.rowCount || 0;
      console.log(`[TenantCleanup] Purged ${count} expired archived tenants`);
      return count;
    } catch (error) {
      console.error('[TenantCleanup] Failed to purge expired archives:', error);
      return 0;
    }
  }
}
