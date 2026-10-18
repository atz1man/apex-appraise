import { demoFallbacksAllowed } from './demo-mode.js';

// Configuration presence only: this cannot establish delivery or inbox acceptance.
export const signupAvailable = () => demoFallbacksAllowed() || Boolean(process.env.SMTP_URL?.trim());
