import { Pool } from 'pg';
import { centralPool } from '../central-db.js';

export type SettingValueType = 'string' | 'number' | 'boolean' | 'json' | 'encrypted';
export type SettingCategory = 
  | 'general'
  | 'email'
  | 'payment'
  | 'security'
  | 'features'
  | 'audit'
  | 'maintenance'
  | 'custom';

export interface SystemSetting {
  id: string;
  key: string;
  value: string | null;
  value_type: SettingValueType;
  category: SettingCategory;
  description: string | null;
  is_encrypted: boolean;
  is_public: boolean;
  validation_rules: Record<string, any> | null;
  default_value: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface CreateSettingInput {
  key: string;
  value?: string;
  valueType?: SettingValueType;
  category: SettingCategory;
  description?: string;
  isEncrypted?: boolean;
  isPublic?: boolean;
  validationRules?: Record<string, any>;
  defaultValue?: string;
  createdBy?: string;
}

export interface UpdateSettingInput {
  value?: string;
  description?: string;
  isPublic?: boolean;
  validationRules?: Record<string, any>;
  updatedBy?: string;
}

export class SystemSettingsService {
  constructor(private readonly pool: Pool = centralPool) {}

  /**
   * Get a setting by key
   */
  async get(key: string): Promise<SystemSetting | null> {
    const result = await this.pool.query<SystemSetting>(
      `SELECT * FROM system_settings WHERE key = $1`,
      [key]
    );

    return result.rows[0] || null;
  }

  /**
   * Get a setting value by key (returns parsed value based on type)
   */
  async getValue<T = any>(key: string): Promise<T | null> {
    const setting = await this.get(key);
    if (!setting) return null;

    const value = setting.value || setting.default_value;
    if (value === null) return null;

    return this.parseValue(value, setting.value_type) as T;
  }

  /**
   * Get multiple settings by keys
   */
  async getMany(keys: string[]): Promise<SystemSetting[]> {
    if (keys.length === 0) return [];

    const result = await this.pool.query<SystemSetting>(
      `SELECT * FROM system_settings WHERE key = ANY($1)`,
      [keys]
    );

    return result.rows;
  }

  /**
   * Get all settings in a category
   */
  async getByCategory(category: SettingCategory): Promise<SystemSetting[]> {
    const result = await this.pool.query<SystemSetting>(
      `SELECT * FROM system_settings WHERE category = $1 ORDER BY key`,
      [category]
    );

    return result.rows;
  }

  /**
   * Get all public settings (safe to expose to frontend)
   */
  async getPublicSettings(): Promise<Record<string, any>> {
    const result = await this.pool.query<SystemSetting>(
      `SELECT key, value, value_type, default_value FROM system_settings WHERE is_public = TRUE`
    );

    const settings: Record<string, any> = {};
    for (const row of result.rows) {
      const value = row.value || row.default_value;
      settings[row.key] = value ? this.parseValue(value, row.value_type) : null;
    }

    return settings;
  }

  /**
   * Get all settings (admin only)
   */
  async getAll(): Promise<SystemSetting[]> {
    const result = await this.pool.query<SystemSetting>(
      `SELECT * FROM system_settings ORDER BY category, key`
    );

    return result.rows;
  }

  /**
   * Create a new setting
   */
  async create(input: CreateSettingInput): Promise<SystemSetting> {
    const {
      key,
      value = null,
      valueType = 'string',
      category,
      description = null,
      isEncrypted = false,
      isPublic = false,
      validationRules = null,
      defaultValue = null,
      createdBy = null
    } = input;

    // Validate the value if validation rules are provided
    if (validationRules && value) {
      this.validateValue(value, valueType, validationRules);
    }

    const result = await this.pool.query<SystemSetting>(
      `INSERT INTO system_settings (
        key, value, value_type, category, description, 
        is_encrypted, is_public, validation_rules, default_value, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        key,
        value,
        valueType,
        category,
        description,
        isEncrypted,
        isPublic,
        validationRules ? JSON.stringify(validationRules) : null,
        defaultValue,
        createdBy
      ]
    );

    return result.rows[0];
  }

  /**
   * Update an existing setting
   */
  async update(key: string, input: UpdateSettingInput): Promise<SystemSetting | null> {
    const existing = await this.get(key);
    if (!existing) return null;

    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (input.value !== undefined) {
      // Validate the value if validation rules exist
      if (existing.validation_rules) {
        this.validateValue(input.value, existing.value_type, existing.validation_rules);
      }
      updates.push(`value = $${paramIndex++}`);
      params.push(input.value);
    }

    if (input.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      params.push(input.description);
    }

    if (input.isPublic !== undefined) {
      updates.push(`is_public = $${paramIndex++}`);
      params.push(input.isPublic);
    }

    if (input.validationRules !== undefined) {
      updates.push(`validation_rules = $${paramIndex++}`);
      params.push(input.validationRules ? JSON.stringify(input.validationRules) : null);
    }

    if (input.updatedBy !== undefined) {
      updates.push(`updated_by = $${paramIndex++}`);
      params.push(input.updatedBy);
    }

    if (updates.length === 0) {
      return existing;
    }

    updates.push(`updated_at = NOW()`);
    params.push(key);

    const result = await this.pool.query<SystemSetting>(
      `UPDATE system_settings SET ${updates.join(', ')} WHERE key = $${paramIndex} RETURNING *`,
      params
    );

    return result.rows[0] || null;
  }

  /**
   * Set a setting value (create if not exists, update if exists)
   */
  async set(key: string, value: any, updatedBy?: string): Promise<SystemSetting> {
    const existing = await this.get(key);
    
    if (existing) {
      const stringValue = this.stringifyValue(value, existing.value_type);
      const updated = await this.update(key, { value: stringValue, updatedBy });
      return updated!;
    } else {
      // Auto-detect value type
      const valueType = this.detectValueType(value);
      const stringValue = this.stringifyValue(value, valueType);
      
      return this.create({
        key,
        value: stringValue,
        valueType,
        category: 'custom',
        createdBy: updatedBy
      });
    }
  }

  /**
   * Delete a setting
   */
  async delete(key: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM system_settings WHERE key = $1`,
      [key]
    );

    return (result.rowCount || 0) > 0;
  }

  /**
   * Search settings by key pattern
   */
  async search(pattern: string): Promise<SystemSetting[]> {
    const result = await this.pool.query<SystemSetting>(
      `SELECT * FROM system_settings WHERE key LIKE $1 ORDER BY key`,
      [`%${pattern}%`]
    );

    return result.rows;
  }

  /**
   * Bulk update settings
   */
  async bulkUpdate(
    settings: Array<{ key: string; value: any }>,
    updatedBy?: string
  ): Promise<SystemSetting[]> {
    const results: SystemSetting[] = [];

    for (const { key, value } of settings) {
      const result = await this.set(key, value, updatedBy);
      results.push(result);
    }

    return results;
  }

  /**
   * Parse value based on type
   */
  private parseValue(value: string, type: SettingValueType): any {
    switch (type) {
      case 'boolean':
        return value === 'true' || value === '1';
      case 'number':
        return parseFloat(value);
      case 'json':
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      case 'encrypted':
        // In production, this would decrypt the value
        // For now, return as-is (implement encryption later)
        return value;
      case 'string':
      default:
        return value;
    }
  }

  /**
   * Stringify value based on type
   */
  private stringifyValue(value: any, type: SettingValueType): string {
    switch (type) {
      case 'boolean':
        return value ? 'true' : 'false';
      case 'number':
        return String(value);
      case 'json':
        return JSON.stringify(value);
      case 'encrypted':
        // In production, this would encrypt the value
        // For now, return as-is (implement encryption later)
        return String(value);
      case 'string':
      default:
        return String(value);
    }
  }

  /**
   * Auto-detect value type
   */
  private detectValueType(value: any): SettingValueType {
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'object') return 'json';
    return 'string';
  }

  /**
   * Validate value against rules
   */
  private validateValue(
    value: string,
    type: SettingValueType,
    rules: Record<string, any>
  ): void {
    const parsedValue = this.parseValue(value, type);

    // Min/max validation for numbers
    if (type === 'number') {
      if (rules.min !== undefined && parsedValue < rules.min) {
        throw new Error(`Value must be at least ${rules.min}`);
      }
      if (rules.max !== undefined && parsedValue > rules.max) {
        throw new Error(`Value must be at most ${rules.max}`);
      }
    }

    // Length validation for strings
    if (type === 'string') {
      if (rules.minLength !== undefined && value.length < rules.minLength) {
        throw new Error(`Value must be at least ${rules.minLength} characters`);
      }
      if (rules.maxLength !== undefined && value.length > rules.maxLength) {
        throw new Error(`Value must be at most ${rules.maxLength} characters`);
      }
      if (rules.pattern && !new RegExp(rules.pattern).test(value)) {
        throw new Error(`Value does not match required pattern`);
      }
    }

    // Enum validation
    if (rules.enum && !rules.enum.includes(parsedValue)) {
      throw new Error(`Value must be one of: ${rules.enum.join(', ')}`);
    }
  }
}

// Export singleton instance
export const systemSettingsService = new SystemSettingsService();
