# Cash App Brand Integration Guide

## Brand Assets

### Colors

```css
:root {
  /* Primary Colors */
  --cash-green: #00d54b;
  --cash-black: #000000;
  --cash-white: #ffffff;

  /* Secondary Colors */
  --cash-gray-dark: #2d2d2d;
  --cash-gray-medium: #666666;
  --cash-gray-light: #e8e8e8;

  /* Accent Colors */
  --cash-success: #00d54b;
  --cash-error: #ff0000;
  --cash-warning: #ffb800;
}
```

### Typography

#### Primary Font: Cash Sans

```css
@font-face {
  font-family: "Cash Sans";
  src:
    url("/fonts/CashSans-Regular.woff2") format("woff2"),
    url("/fonts/CashSans-Regular.woff") format("woff");
  font-weight: normal;
  font-style: normal;
}

@font-face {
  font-family: "Cash Sans";
  src:
    url("/fonts/CashSans-Bold.woff2") format("woff2"),
    url("/fonts/CashSans-Bold.woff") format("woff");
  font-weight: bold;
  font-style: normal;
}
```

### Logo Usage

- Primary logo: Black "$" on white background
- Alternative logo: White "$" on black background
- Clear space: Minimum 1x logo height on all sides
- Minimum size: 24px height for digital use

## Email Templates

### Transactional Emails

```html
<!DOCTYPE html>
<html>
  <head>
    <style>
      body {
        font-family: "Cash Sans", Helvetica, Arial, sans-serif;
        line-height: 1.5;
        color: #000000;
      }
      .header {
        background: #00d54b;
        padding: 24px;
      }
      .content {
        padding: 32px 24px;
        background: #ffffff;
      }
      .button {
        background: #000000;
        color: #ffffff;
        padding: 16px 32px;
        border-radius: 8px;
        text-decoration: none;
      }
      .footer {
        padding: 24px;
        background: #f8f8f8;
        color: #666666;
      }
    </style>
  </head>
  <body>
    <div class="header">[CASH APP LOGO]</div>
    <div class="content">
      <h1>{{title}}</h1>
      <p>{{message}}</p>
      <a href="{{action_url}}" class="button">{{action_text}}</a>
    </div>
    <div class="footer">
      <p>© Cash App. All rights reserved.</p>
    </div>
  </body>
</html>
```

## Implementation Guide

1. **Update Color Scheme**
   - Replace existing color variables in `public/stylesheets/main.css`
   - Update button and interaction states
   - Implement consistent color usage across components

2. **Typography Integration**
   - Add Cash Sans font files to `public/fonts/`
   - Update font-family declarations
   - Implement consistent type scale

3. **Logo Implementation**
   - Add logo assets to `public/images/`
   - Update favicon and app icons
   - Implement responsive logo sizing

4. **Email Templates**
   - Create new email layouts in `views/emails/`
   - Implement responsive email design
   - Test across major email clients

5. **UI Components**
   - Update button styles
   - Implement consistent form elements
   - Update card and container styles
   - Add branded loading states

6. **Documentation**
   - Create brand usage guidelines
   - Document component library
   - Provide example implementations
