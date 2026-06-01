-- RBAC System Implementation
-- This migration creates a comprehensive Role-Based Access Control system
-- with roles, permissions, and role-permission mappings

-- =====================================================
-- 1. ROLES TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT,
  is_system BOOLEAN DEFAULT false, -- System roles cannot be deleted
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 2. PERMISSIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE, -- e.g., 'course:create', 'user:delete'
  resource TEXT NOT NULL, -- e.g., 'course', 'user', 'enrollment'
  action TEXT NOT NULL, -- e.g., 'create', 'read', 'update', 'delete', 'manage'
  description TEXT,
  is_system BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 3. ROLE_PERMISSIONS TABLE (Many-to-Many)
-- =====================================================
CREATE TABLE IF NOT EXISTS role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (role_id, permission_id)
);

-- =====================================================
-- 4. USER_ROLES TABLE (Many-to-Many)
-- =====================================================
CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES users(id),
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ, -- Optional: for temporary role assignments
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, role_id)
);

-- =====================================================
-- INDEXES
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions(permission_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_active ON user_roles(user_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_permissions_resource_action ON permissions(resource, action);

-- =====================================================
-- TRIGGERS FOR UPDATED_AT
-- =====================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_roles_updated_at ON roles;
CREATE TRIGGER trg_roles_updated_at
BEFORE UPDATE ON roles
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_permissions_updated_at ON permissions;
CREATE TRIGGER trg_permissions_updated_at
BEFORE UPDATE ON permissions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_user_roles_updated_at ON user_roles;
CREATE TRIGGER trg_user_roles_updated_at
BEFORE UPDATE ON user_roles
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- INSERT DEFAULT PERMISSIONS
-- =====================================================
INSERT INTO permissions (name, resource, action, description, is_system) VALUES
  -- Course permissions
  ('course:create', 'course', 'create', 'Create new courses', true),
  ('course:read', 'course', 'read', 'View courses', true),
  ('course:update', 'course', 'update', 'Edit courses', true),
  ('course:delete', 'course', 'delete', 'Delete courses', true),
  ('course:manage', 'course', 'manage', 'Full course management including publishing', true),
  ('course:enroll', 'course', 'enroll', 'Enroll in courses', true),
  
  -- User permissions
  ('user:create', 'user', 'create', 'Create new users', true),
  ('user:read', 'user', 'read', 'View user profiles', true),
  ('user:update', 'user', 'update', 'Edit user profiles', true),
  ('user:delete', 'user', 'delete', 'Delete users', true),
  ('user:manage', 'user', 'manage', 'Full user management', true),
  
  -- Enrollment permissions
  ('enrollment:create', 'enrollment', 'create', 'Enroll users in courses', true),
  ('enrollment:read', 'enrollment', 'read', 'View enrollments', true),
  ('enrollment:update', 'enrollment', 'update', 'Modify enrollments', true),
  ('enrollment:delete', 'enrollment', 'delete', 'Remove enrollments', true),
  ('enrollment:manage', 'enrollment', 'manage', 'Full enrollment management', true),
  
  -- Lesson permissions
  ('lesson:create', 'lesson', 'create', 'Create lessons', true),
  ('lesson:read', 'lesson', 'read', 'View lessons', true),
  ('lesson:update', 'lesson', 'update', 'Edit lessons', true),
  ('lesson:delete', 'lesson', 'delete', 'Delete lessons', true),
  
  -- Assignment permissions
  ('assignment:create', 'assignment', 'create', 'Create assignments', true),
  ('assignment:read', 'assignment', 'read', 'View assignments', true),
  ('assignment:update', 'assignment', 'update', 'Edit assignments', true),
  ('assignment:delete', 'assignment', 'delete', 'Delete assignments', true),
  ('assignment:grade', 'assignment', 'grade', 'Grade assignments', true),
  
  -- Blog permissions
  ('blog:create', 'blog', 'create', 'Create blog posts', true),
  ('blog:read', 'blog', 'read', 'View blog posts', true),
  ('blog:update', 'blog', 'update', 'Edit blog posts', true),
  ('blog:delete', 'blog', 'delete', 'Delete blog posts', true),
  ('blog:publish', 'blog', 'publish', 'Publish blog posts', true),
  
  -- Report permissions
  ('report:view', 'report', 'view', 'View reports and analytics', true),
  ('report:export', 'report', 'export', 'Export reports', true),
  
  -- Settings permissions
  ('settings:read', 'settings', 'read', 'View system settings', true),
  ('settings:update', 'settings', 'update', 'Modify system settings', true),
  
  -- Role management permissions
  ('role:create', 'role', 'create', 'Create new roles', true),
  ('role:read', 'role', 'read', 'View roles', true),
  ('role:update', 'role', 'update', 'Edit roles', true),
  ('role:delete', 'role', 'delete', 'Delete roles', true),
  ('role:assign', 'role', 'assign', 'Assign roles to users', true),
  
  -- Payment permissions
  ('payment:read', 'payment', 'read', 'View payment information', true),
  ('payment:manage', 'payment', 'manage', 'Manage payments and transactions', true)
ON CONFLICT (name) DO NOTHING;

-- =====================================================
-- INSERT DEFAULT ROLES
-- =====================================================
INSERT INTO roles (name, display_name, description, is_system, is_active) VALUES
  ('ADMIN', 'Administrator', 'Full system access with all permissions', true, true),
  ('INSTRUCTOR', 'Instructor', 'Can create and manage courses, lessons, and grade assignments', true, true),
  ('STUDENT', 'Student', 'Can enroll in courses and view content', true, true),
  ('CONTENT_CREATOR', 'Content Creator', 'Can create and edit courses and blog posts', true, true),
  ('TEACHING_ASSISTANT', 'Teaching Assistant', 'Can help grade assignments and manage enrollments', true, true)
ON CONFLICT (name) DO NOTHING;

-- =====================================================
-- ASSIGN PERMISSIONS TO ROLES
-- =====================================================

-- ADMIN: All permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'ADMIN'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- INSTRUCTOR: Course, lesson, assignment, enrollment management
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'INSTRUCTOR'
  AND p.name IN (
    'course:create', 'course:read', 'course:update', 'course:manage',
    'lesson:create', 'lesson:read', 'lesson:update', 'lesson:delete',
    'assignment:create', 'assignment:read', 'assignment:update', 'assignment:delete', 'assignment:grade',
    'enrollment:read', 'enrollment:create',
    'blog:create', 'blog:read', 'blog:update', 'blog:publish',
    'report:view', 'user:read'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- STUDENT: Read-only access to courses, lessons, assignments
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'STUDENT'
  AND p.name IN (
    'course:read', 'course:enroll',
    'lesson:read',
    'assignment:read',
    'blog:read',
    'user:read'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- CONTENT_CREATOR: Create and manage content
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'CONTENT_CREATOR'
  AND p.name IN (
    'course:create', 'course:read', 'course:update',
    'lesson:create', 'lesson:read', 'lesson:update', 'lesson:delete',
    'blog:create', 'blog:read', 'blog:update', 'blog:delete', 'blog:publish',
    'user:read'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- TEACHING_ASSISTANT: Grade assignments and manage enrollments
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'TEACHING_ASSISTANT'
  AND p.name IN (
    'course:read',
    'lesson:read',
    'assignment:read', 'assignment:grade',
    'enrollment:read', 'enrollment:create', 'enrollment:update',
    'user:read',
    'report:view'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- =====================================================
-- MIGRATE EXISTING USERS TO NEW RBAC SYSTEM
-- =====================================================
-- Assign roles to existing users based on their current 'role' field

INSERT INTO user_roles (user_id, role_id, assigned_at, is_active)
SELECT u.id, r.id, NOW(), true
FROM users u
JOIN roles r ON UPPER(u.role) = r.name
WHERE NOT EXISTS (
  SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = r.id
)
ON CONFLICT (user_id, role_id) DO NOTHING;

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Function to check if a user has a specific permission
CREATE OR REPLACE FUNCTION user_has_permission(p_user_id UUID, p_permission_name TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  has_perm BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN role_permissions rp ON ur.role_id = rp.role_id
    JOIN permissions p ON rp.permission_id = p.id
    WHERE ur.user_id = p_user_id
      AND ur.is_active = true
      AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
      AND p.name = p_permission_name
  ) INTO has_perm;
  
  RETURN has_perm;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to get all permissions for a user
CREATE OR REPLACE FUNCTION get_user_permissions(p_user_id UUID)
RETURNS TABLE (
  permission_name TEXT,
  resource TEXT,
  action TEXT,
  role_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT
    p.name,
    p.resource,
    p.action,
    r.name
  FROM user_roles ur
  JOIN roles r ON ur.role_id = r.id
  JOIN role_permissions rp ON r.id = rp.role_id
  JOIN permissions p ON rp.permission_id = p.id
  WHERE ur.user_id = p_user_id
    AND ur.is_active = true
    AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
  ORDER BY p.resource, p.action;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to get all roles for a user
CREATE OR REPLACE FUNCTION get_user_roles(p_user_id UUID)
RETURNS TABLE (
  role_id UUID,
  role_name TEXT,
  display_name TEXT,
  assigned_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    r.name,
    r.display_name,
    ur.assigned_at,
    ur.expires_at
  FROM user_roles ur
  JOIN roles r ON ur.role_id = r.id
  WHERE ur.user_id = p_user_id
    AND ur.is_active = true
    AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
  ORDER BY ur.assigned_at DESC;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON TABLE roles IS 'System roles for RBAC';
COMMENT ON TABLE permissions IS 'System permissions for RBAC';
COMMENT ON TABLE role_permissions IS 'Maps permissions to roles';
COMMENT ON TABLE user_roles IS 'Assigns roles to users';
COMMENT ON FUNCTION user_has_permission IS 'Check if a user has a specific permission';
COMMENT ON FUNCTION get_user_permissions IS 'Get all permissions for a user';
COMMENT ON FUNCTION get_user_roles IS 'Get all roles for a user';
