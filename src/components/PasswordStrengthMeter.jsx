/**
 * PasswordStrengthMeter.jsx
 * 
 * A visual password strength indicator that evaluates password quality
 * based on multiple criteria and displays a color-coded progress bar
 * with a descriptive label.
 * 
 * Criteria (each worth 20%):
 *   - Length >= 8 characters
 *   - Contains uppercase letter
 *   - Contains lowercase letter
 *   - Contains number
 *   - Contains special character
 */
import { useMemo } from 'react';

/**
 * Calculates password strength score (0-5) based on multiple criteria.
 * @param {string} password - The password to evaluate
 * @returns {{ score: number, percentage: number, label: string, level: string }}
 */
function evaluateStrength(password) {
  if (!password) {
    return { score: 0, percentage: 0, label: '', level: '' };
  }

  let score = 0;

  // Check length >= 8
  if (password.length >= 8) score++;

  // Check for uppercase letter
  if (/[A-Z]/.test(password)) score++;

  // Check for lowercase letter
  if (/[a-z]/.test(password)) score++;

  // Check for number
  if (/[0-9]/.test(password)) score++;

  // Check for special character
  if (/[^A-Za-z0-9]/.test(password)) score++;

  const percentage = (score / 5) * 100;

  // Determine label and CSS level class
  let label, level;
  if (percentage <= 20) {
    label = 'Weak';
    level = 'weak';
  } else if (percentage <= 40) {
    label = 'Weak';
    level = 'weak';
  } else if (percentage <= 60) {
    label = 'Fair';
    level = 'fair';
  } else if (percentage <= 80) {
    label = 'Good';
    level = 'good';
  } else {
    label = 'Strong';
    level = 'strong';
  }

  return { score, percentage, label, level };
}

/**
 * PasswordStrengthMeter component
 * 
 * @param {Object} props
 * @param {string} props.password - The password string to evaluate
 */
function PasswordStrengthMeter({ password = '' }) {
  // Memoize the strength calculation to avoid recalculating on unrelated re-renders
  const { percentage, label, level } = useMemo(
    () => evaluateStrength(password),
    [password]
  );

  // Don't render anything if there's no password
  if (!password) return null;

  return (
    <div className="password-strength" role="meter" aria-label="Password strength meter" aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100}>
      {/* The track (background bar) */}
      <div className="password-strength-track">
        {/* The filled portion — width and color driven by CSS classes */}
        <div
          className={`password-strength-fill password-strength-${level}`}
          style={{ width: `${percentage}%` }}
        />
      </div>

      {/* Label text showing current strength */}
      {label && (
        <span className={`password-strength-label password-strength-label-${level}`}>
          {label}
        </span>
      )}
    </div>
  );
}

export default PasswordStrengthMeter;
