# Dynamic Branding Configuration

Your Roaming Management System now supports **dynamic branding** through environment variables. This allows you to customize the application for different clients or deployments without changing code.

## 🎨 Customizable Brand Elements

### Frontend Configuration

Create or update `frontend/.env` with these variables:

```env
# Application Branding
REACT_APP_NAME=Roaming Management System
REACT_APP_SHORT_NAME=RMS
REACT_APP_TAGLINE=Professional Roaming & Interconnect Platform
REACT_APP_COMPANY_NAME=Your Company Name
REACT_APP_SUPPORT_EMAIL=support@yourdomain.com
```

### Backend Configuration

Update `backend/.env` for backend branding:

```env
# MFA/2FA Branding
MFA_ISSUER=Roaming Management System

# Email Branding
RESEND_FROM=Roaming Management System <noreply@yourdomain.com>
```

## 📝 Example Customizations

### For Cellcard Deployment

**Frontend (`frontend/.env`):**
```env
REACT_APP_NAME=Cellcard Roaming Management System
REACT_APP_SHORT_NAME=Cellcard RMS
REACT_APP_TAGLINE=Cellcard's Professional Roaming Platform
REACT_APP_COMPANY_NAME=Cellcard
REACT_APP_SUPPORT_EMAIL=roaming-support@cellcard.com.kh
```

**Backend (`backend/.env`):**
```env
MFA_ISSUER=Cellcard RMS
RESEND_FROM=Cellcard Roaming System <noreply@cellcard.com.kh>
```

### For Generic White-Label

**Frontend:**
```env
REACT_APP_NAME=Roaming Management System
REACT_APP_SHORT_NAME=RMS
REACT_APP_TAGLINE=Enterprise Roaming & Interconnect Platform
REACT_APP_COMPANY_NAME=
REACT_APP_SUPPORT_EMAIL=support@roamingmanagementsystem.com
```

## 🚀 Where Branding Appears

### Application Name & Short Name
- Sidebar logo and header
- Login page
- Registration page
- Page titles
- Email templates

### Tagline
- Login page subtitle
- Registration page subtitle
- Landing page

### Company Name
- Footer (if set)
- Email signatures

### Support Email
- Contact information
- Error messages
- Help links

## 🔄 Applying Changes

### Development
1. Update `frontend/.env`
2. Restart development server:
   ```bash
   cd frontend
   npm start
   ```

### Production (Render)
1. Go to Render Dashboard → Frontend Service
2. **Settings** → **Environment**
3. Add/update variables
4. **Manual Deploy** → Clear build cache & deploy

## 🎯 Benefits

✅ **Multi-tenant ready** - Deploy same codebase for different clients
✅ **No code changes** - Just update environment variables
✅ **Consistent branding** - All pages use same configuration
✅ **Easy customization** - Change anytime without redeployment
✅ **Professional** - Client-specific branding builds trust

## 📦 Default Values

If no environment variables are set, these defaults are used:

```typescript
{
  appName: 'Roaming Management System',
  appShortName: 'RMS',
  appTagline: 'Professional Roaming & Interconnect Platform',
  companyName: undefined,
  supportEmail: 'support@roamingmanagementsystem.com',
}
```

## 🔐 Security Note

**Do not commit `.env` files to Git!** They often contain secrets. Only commit `.env.example` with placeholder values.

Your `.gitignore` should include:
```
.env
.env.local
.env.production
```
