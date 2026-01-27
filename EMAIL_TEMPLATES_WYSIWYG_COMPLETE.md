# Email Templates WYSIWYG Editor - Phase 2.5 Complete

## Summary
Replaced plain textarea HTML editing with InfoFlo-style WYSIWYG editor for Email Templates settings UI. Users can now format emails visually without writing HTML code.

## Changes Made

### 1. Dependencies Added (package.json)
- `@tiptap/react@^2.10.4` - React WYSIWYG editor framework
- `@tiptap/starter-kit@^2.10.4` - Core editing features (bold, italic, lists, etc.)
- `@tiptap/extension-link@^2.10.4` - Link handling with safe attributes
- `dompurify@^3.2.2` - XSS prevention via HTML sanitization
- `@types/dompurify@^3.2.0` - TypeScript types (deprecated but included)

**Status**: ✅ Installed successfully via `npm install`

### 2. New Components Created

#### client/src/components/email/TemplateEditor.tsx
WYSIWYG editor for email body with:
- **Toolbar Features**:
  - Bold, Italic formatting
  - Bullet/Numbered lists
  - Undo/Redo
  - Insert Variable dropdown (inserts `{{token}}` at cursor)
- **Security**: DOMPurify sanitization on every keystroke
- **Allowed HTML**: `p, br, strong, b, em, i, u, ul, ol, li, a`
- **Link Safety**: Enforces `rel="noopener noreferrer"` on `target="_blank"` links
- **Props**: `valueHtml`, `onChangeHtml`, `variables[]`

#### client/src/components/email/SubjectVariableInput.tsx
Enhanced input for subject line with:
- Text input with maxLength validation
- Insert Variable dropdown for `{{token}}` insertion
- Cursor position tracking for variable insertion
- **Props**: `value`, `onChange`, `variables[]`, `placeholder`, `maxLength`

### 3. Updated Files

#### client/src/components/email-templates-settings.tsx
- **Added imports**: TemplateEditor, SubjectVariableInput
- **Added constant**: `allowedTokens` array (converted from TEMPLATE_VARIABLES object)
- **Replaced Quote subject**: Input → SubjectVariableInput
- **Replaced Quote body**: Textarea → TemplateEditor
- **Replaced Invoice subject**: Input → SubjectVariableInput
- **Replaced Invoice body**: Textarea → TemplateEditor
- **Preserved**: Character counters (200 for subject, 10k for body)
- **Preserved**: Save/Reset buttons and mutation logic

## Backend/Storage (NO CHANGES)
- ✅ Same API endpoints: GET/PUT `/api/settings/email-templates`
- ✅ Same storage location: `organizations.settings.preferences.emailTemplates`
- ✅ Same validation: Token allowlist, length limits
- ✅ Same multi-tenant isolation: organizationId scoping

## Security Features
1. **XSS Prevention**: DOMPurify sanitizes HTML on every editor update
2. **Tag Allowlist**: Only safe formatting tags allowed (no script, iframe, img)
3. **Attribute Allowlist**: Links restricted to href/target/rel only
4. **Link Safety**: Automatic `rel="noopener noreferrer"` on external links
5. **Token Allowlist**: Variable dropdown enforces existing TEMPLATE_VARIABLES

## Testing Checklist

### Manual UI Testing
- [ ] Navigate to Settings → Email Templates
- [ ] Verify WYSIWYG editor appears (no raw HTML textarea)
- [ ] Type text and apply Bold formatting
- [ ] Type text and apply Italic formatting
- [ ] Create bullet list with multiple items
- [ ] Create numbered list
- [ ] Click Insert Variable in body → select `{{customer.name}}` → verify inserted
- [ ] Click Insert Variable in subject → select `{{quote.number}}` → verify inserted
- [ ] Click Save button → verify success toast
- [ ] Refresh page → verify templates persisted
- [ ] Click Reset to Default → verify templates restored

### Email Sending Testing
- [ ] Create a quote
- [ ] Open Quote → Send Email modal
- [ ] Verify subject prefilled with formatted text + variables
- [ ] Verify body shows formatted HTML (bold/italic/lists visible)
- [ ] Send test email to yourself
- [ ] Open received email
- [ ] Verify formatting rendered correctly
- [ ] Verify variables substituted correctly (no raw `{{tokens}}`)

### Security Testing
- [ ] Open Google Docs, format text with colors/fonts/images
- [ ] Copy formatted content
- [ ] Paste into WYSIWYG editor
- [ ] Verify unsafe tags removed (images, spans with inline styles)
- [ ] Verify only basic formatting preserved
- [ ] Add link with `target="_blank"` in editor
- [ ] Save template → inspect HTML source
- [ ] Verify link has `rel="noopener noreferrer"`

### Edge Cases
- [ ] Paste plain text → verify works
- [ ] Paste HTML with script tags → verify removed
- [ ] Type 200 characters in subject → verify stops at limit
- [ ] Type 10,000 characters in body → verify stops at limit
- [ ] Insert variable in middle of existing text → verify cursor position correct
- [ ] Undo/Redo multiple times → verify stable

## Development Commands
```powershell
# Install dependencies (already done)
npm install

# Type check (already passed)
npm run check

# Start dev server
npm run dev

# Access settings UI
http://localhost:5000/settings  # Then click "Email Templates" tab
```

## Known Limitations
1. **TipTap outputs `<p>` tags**: Even plain text becomes `<p>Text</p>` (acceptable, within allowlist)
2. **Cursor tracking in subject**: Uses setTimeout hack due to React state timing (standard pattern)
3. **No image support**: Intentionally excluded for security (prevents tracking pixels)
4. **No custom fonts/colors**: Keeps emails consistent with brand

## Next Steps (Optional Future Enhancements)
- [ ] Add Preview mode (render template with sample data)
- [ ] Add emoji picker for subject lines
- [ ] Add A/B testing for templates
- [ ] Add template versioning/history
- [ ] Add link validator (check URL validity on blur)
- [ ] Add table support for structured layouts
- [ ] Add custom variable creator (beyond TEMPLATE_VARIABLES)

## Migration Notes
- **Existing templates**: Editor loads existing HTML strings correctly (backward compatible)
- **Plain text templates**: Editor wraps in `<p>` tags automatically
- **No data migration required**: Storage format unchanged

## TypeScript Compliance
✅ All files pass `tsc` with no errors
✅ Props fully typed with interfaces
✅ Strict null checks handled

## Multi-Tenant Safety
✅ No changes to tenant isolation
✅ Same organizationId scoping via tenantContext middleware
✅ No cross-tenant data leakage possible

---

**Phase 2.5 Status**: ✅ COMPLETE
**Type Check**: ✅ PASSING
**Dependencies**: ✅ INSTALLED
**Ready for Testing**: ✅ YES

**Commit Message**:
```
feat: Add WYSIWYG editor for email templates (Phase 2.5)

- Replace textarea HTML editing with TipTap WYSIWYG editor
- Add Insert Variable dropdowns for subject and body
- Sanitize HTML output with DOMPurify (XSS prevention)
- Allow formatting: Bold, Italic, Lists, Links
- Enforce rel='noopener noreferrer' on links
- UI-only change, no backend modifications
- Dependencies: @tiptap/react, @tiptap/starter-kit, dompurify

User experience improved: type normally instead of writing HTML
```
