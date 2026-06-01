import bcrypt from 'bcrypt';
const SALT_ROUNDS = 10;
/**
 * Hash a password using bcrypt
 */
export const hashPassword = async (password) => {
    return bcrypt.hash(password, SALT_ROUNDS);
};
/**
 * Compare a plain text password with a hashed password
 */
export const comparePassword = async (password, hashedPassword) => {
    return bcrypt.compare(password, hashedPassword);
};
/**
 * Check if a string is already hashed (bcrypt format)
 */
export const isHashedPassword = (password) => {
    // bcrypt hashes start with $2a$, $2b$, or $2y$ and are 60 characters long
    return /^\$2[aby]\$\d{2}\$.{53}$/.test(password);
};
/**
 * Verify password against both plain text (legacy) and hashed
 * This allows backward compatibility during migration
 */
export const verifyPassword = async (password, storedPassword) => {
    // If stored password is hashed, use bcrypt comparison
    if (isHashedPassword(storedPassword)) {
        return comparePassword(password, storedPassword);
    }
    // Legacy: plain text comparison (should be phased out)
    return password === storedPassword;
};
