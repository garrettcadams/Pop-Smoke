const dotenv = require('dotenv');

dotenv.config();

module.exports = {
  // Existing
  PORT: process.env.PORT || 3000,
  MONGODB_URI: process.env.MONGODB_URI,
  JWT_SECRET: process.env.JWT_SECRET,

  // New App Configuration
  APP_CURRENCY: process.env.APP_CURRENCY || 'USD',
  APP_CURRENCY_SYMBOL: process.env.APP_CURRENCY_SYMBOL || '$',
  DELIVERY_RATE_PER_KM: parseFloat(process.env.DELIVERY_RATE_PER_KM || '0.5'), // Example default
  MAX_DELIVERY_DISTANCE_KM: parseFloat(process.env.MAX_DELIVERY_DISTANCE_KM || '10'), // Example default
  GOOGLE_API_KEY_CLIENT: process.env.GOOGLE_API_KEY_CLIENT || null,
  STRIPE_PUBLISHABLE_KEY_CLIENT: process.env.STRIPE_PUBLISHABLE_KEY_CLIENT || null,
  TWILIO_ENABLED: (process.env.TWILIO_ENABLED || 'false').toLowerCase() === 'true',
  SKIP_EMAIL_VERIFICATION: (process.env.SKIP_EMAIL_VERIFICATION || 'false').toLowerCase() === 'true',
  SKIP_MOBILE_VERIFICATION: (process.env.SKIP_MOBILE_VERIFICATION || 'false').toLowerCase() === 'true',
  APP_MINIMUM_VERSION: process.env.APP_MINIMUM_VERSION || '1.0.0',

  // New fields for ID verification and age limits
  DEFAULT_AGE_LIMIT: parseInt(process.env.DEFAULT_AGE_LIMIT || '21', 10),
  ID_IMAGE_STORAGE_BUCKET: process.env.ID_IMAGE_STORAGE_BUCKET || null,
};
