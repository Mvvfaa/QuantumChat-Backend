import jwt from 'jsonwebtoken';

export function generateToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

/** Short-lived token used only to complete TOTP verification after password login. */
export function generate2faTempToken(userId) {
  return jwt.sign({ id: userId, purpose: '2fa' }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '10m',
  });
}

export function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
}
