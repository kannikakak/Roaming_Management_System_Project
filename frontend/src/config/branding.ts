/**
 * Dynamic Branding Configuration
 * Allows environment-based customization of the application branding
 */

export interface BrandingConfig {
  appName: string;
  appShortName: string;
  appTagline: string;
  companyName?: string;
  supportEmail?: string;
  loginSubtitle: string;
  registerSubtitle: string;
}

const getBranding = (): BrandingConfig => {
  return {
    appName: process.env.REACT_APP_NAME || 'Roaming Management System',
    appShortName: process.env.REACT_APP_SHORT_NAME || 'RMS',
    appTagline: process.env.REACT_APP_TAGLINE || 'Professional Roaming & Interconnect Platform',
    companyName: process.env.REACT_APP_COMPANY_NAME,
    supportEmail: process.env.REACT_APP_SUPPORT_EMAIL || 'support@roamingmanagementsystem.com',
    loginSubtitle: 'Sign in to manage your roaming data and reports',
    registerSubtitle: 'Join to manage roaming operations and reports',
  };
};

export const branding = getBranding();

export default branding;
