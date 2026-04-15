/**
 * users.routes.ts
 *
 * User Management and Admin User Invite System routes
 * extracted from server/routes.ts.
 *
 * Routes:
 *   GET    /api/users
 *   POST   /api/users/invite
 *   PATCH  /api/users/:id
 *   DELETE /api/users/:id
 *
 *   GET    /api/admin/users
 *   POST   /api/admin/users
 *   POST   /api/admin/users/:id/reset-password
 *
 * Placement: server/routes/users.routes.ts
 * Registered by: server/routes.ts via registerUsersRoutes
 */

import type { Express } from "express";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import { eq, and, asc, sql } from "drizzle-orm";
import crypto from "crypto";
import { db } from "../db";
import { users, userOrganizations, authIdentities } from "@shared/schema";
import { getRequestOrganizationId } from "../tenantContext";
import { emailService } from "../emailService";
// NOTE: user_organizations.role is the authoritative org-scoped role.
// users.role / users.is_admin are global identity fields and must NOT be used
// for org invite / role-assignment permission checks.
import { canAssignOrgRole } from "../lib/orgPermissions";

function getUserId(user: any): string | undefined {
  return user?.claims?.sub || user?.id;
}

export function registerUsersRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    requireOrgOwnerAdmin: any;
    requireOrgCanInvite: any;
    isAdminOrOwner: any;
  },
): void {
  const { isAuthenticated, tenantContext, requireOrgOwnerAdmin, requireOrgCanInvite, isAdminOrOwner } = middleware;

  // User management routes - org-scoped
  // GET is allowed for owner/admin/manager so managers can see the org list and use the invite UI
  app.get("/api/users", isAuthenticated, tenantContext, requireOrgCanInvite, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);

      // Get all users in this organization with their auth status
      const orgUsers = await db
        .select({
          id: users.id,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          orgRole: userOrganizations.role,
          isInvited: sql<boolean>`(${authIdentities.passwordHash} IS NOT NULL AND ${authIdentities.passwordSetAt} IS NULL)`,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(userOrganizations)
        .innerJoin(users, eq(userOrganizations.userId, users.id))
        .leftJoin(
          authIdentities,
          and(
            eq(authIdentities.userId, users.id),
            eq(authIdentities.provider, sql`'password'`)
          )
        )
        .where(eq(userOrganizations.organizationId, organizationId))
        .orderBy(asc(users.email));

      res.json(orgUsers);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // Invite a new user to the organization.
  // Allowed for: owner, admin, manager. member cannot invite.
  // Role-assignment scope is enforced per actor role (canAssignOrgRole).
  app.post("/api/users/invite", isAuthenticated, tenantContext, requireOrgCanInvite, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const { email: rawEmail, orgRole = 'member' } = req.body;

      if (!rawEmail || typeof rawEmail !== 'string') {
        return res.status(400).json({ message: "Email is required" });
      }

      const email = rawEmail.trim().toLowerCase();

      // Validate that the requested role is a known org role
      if (!['owner', 'admin', 'manager', 'member'].includes(orgRole)) {
        return res.status(400).json({ message: "Invalid org role. Must be owner, admin, manager, or member." });
      }

      // Enforce role-assignment scope: actor's org role determines which target
      // roles they may assign. req.actorOrgRole is set by requireOrgCanInvite.
      // This check runs server-side regardless of what the frontend sends.
      if (!canAssignOrgRole(req.actorOrgRole, orgRole)) {
        return res.status(403).json({ message: `Your role (${req.actorOrgRole}) is not permitted to assign the '${orgRole}' role.` });
      }

      // Check if user already exists
      const [existingUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      let userId: string;

      if (existingUser) {
        userId = existingUser.id;

        // Check if already in this org
        const [existingMembership] = await db
          .select()
          .from(userOrganizations)
          .where(
            and(
              eq(userOrganizations.userId, userId),
              eq(userOrganizations.organizationId, organizationId)
            )
          )
          .limit(1);

        if (existingMembership) {
          return res.status(400).json({ message: "User already exists in this organization" });
        }
      } else {
        // Create new user
        userId = `user-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        await db.insert(users).values({
          id: userId,
          email: email,
          firstName: null,
          lastName: null,
          role: 'employee',
          isAdmin: false,
          profileImageUrl: null,
          passwordHash: null,
        });
      }

      // Generate cryptographically strong temporary password
      const tempPassword = crypto.randomBytes(9).toString('base64url');

      // Hash the temporary password
      const bcryptModule = await import('bcryptjs');
      const passwordHash = await bcryptModule.hash(tempPassword, 10);

      // Upsert auth identity with temp password (passwordSetAt = NULL indicates invited state)
      await db
        .insert(authIdentities)
        .values({
          userId: userId,
          provider: 'password',
          passwordHash: passwordHash,
          passwordSetAt: null, // NULL = invited/temp password state
        })
        .onConflictDoUpdate({
          target: [authIdentities.userId, authIdentities.provider],
          set: {
            passwordHash: passwordHash,
            passwordSetAt: null,
            updatedAt: sql`now()`,
          },
        });

      // Add user to organization
      await db.insert(userOrganizations).values({
        userId: userId,
        organizationId: organizationId,
        role: orgRole,
        isDefault: true,
      });

      // Send invite email asynchronously (non-blocking)
      setImmediate(async () => {
        try {
          const appUrl = 'https://www.printershero.com';

          await emailService.sendEmail(organizationId, {
            to: email,
            subject: "You're invited to PrintersHero",
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2>Welcome to PrintersHero!</h2>
                <p>You've been invited to join PrintersHero, a printing company management system.</p>

                <h3>Your Login Credentials</h3>
                <p><strong>Email:</strong> ${email}</p>
                <p><strong>Temporary Password:</strong> <code style="background: #f4f4f5; padding: 4px 8px; border-radius: 4px;">${tempPassword}</code></p>

                <p style="margin: 24px 0;">
                  <a href="${appUrl}/login" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                    Log In to PrintersHero
                  </a>
                </p>

                <p><strong>Important:</strong> You will be required to change your password on first login.</p>

                <p style="color: #71717a; font-size: 14px; margin-top: 32px;">
                  If you did not expect this invitation, please ignore this email.
                </p>
              </div>
            `,
          });
        } catch (emailError) {
          console.error('Failed to send invite email:', emailError);
        }
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Error inviting user:", error);
      res.status(500).json({ message: "Failed to invite user" });
    }
  });

  app.patch("/api/users/:id", isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { orgRole } = req.body;
      const currentUserId = getUserId(req.user);
      const organizationId = getRequestOrganizationId(req);

      console.log('[PATCH /api/users/:id] Request:', {
        userId: id,
        orgRole,
        currentUserId,
        organizationId,
        body: req.body
      });

      // Prevent users from modifying themselves
      if (id === currentUserId) {
        console.log('[PATCH /api/users/:id] Blocked: Cannot modify self');
        return res.status(400).json({ message: "You cannot modify your own membership" });
      }

      // Check if target user is an owner (owners can't be demoted)
      const [targetMembership] = await db
        .select()
        .from(userOrganizations)
        .where(
          and(
            eq(userOrganizations.userId, id),
            eq(userOrganizations.organizationId, organizationId)
          )
        )
        .limit(1);

      console.log('[PATCH /api/users/:id] Target membership:', targetMembership);

      if (!targetMembership) {
        console.log('[PATCH /api/users/:id] Error: User not found in organization');
        return res.status(404).json({ message: "User not found in organization" });
      }

      if (targetMembership.role === 'owner') {
        console.log('[PATCH /api/users/:id] Blocked: Cannot modify owner role');
        return res.status(400).json({ message: "Cannot modify owner role" });
      }

      // Validate org role
      if (!orgRole) {
        console.log('[PATCH /api/users/:id] Error: orgRole is required');
        return res.status(400).json({ message: "orgRole is required" });
      }

      if (!['admin', 'manager', 'member'].includes(orgRole)) {
        console.log('[PATCH /api/users/:id] Error: Invalid org role:', orgRole);
        return res.status(400).json({ message: "Invalid org role" });
      }

      // Enforce role-assignment scope for the actor.
      // req.actorOrgRole is set by requireOrgOwnerAdmin.
      // This guards against future changes where lower roles might reach this handler.
      if (!canAssignOrgRole(req.actorOrgRole, orgRole)) {
        console.log('[PATCH /api/users/:id] Blocked: actor role cannot assign target role', { actorOrgRole: req.actorOrgRole, orgRole });
        return res.status(403).json({ message: `Your role (${req.actorOrgRole}) is not permitted to assign the '${orgRole}' role.` });
      }

      // Update user's role in this organization
      console.log('[PATCH /api/users/:id] Executing update...', {
        userId: id,
        organizationId,
        newRole: orgRole
      });

      const result = await db
        .update(userOrganizations)
        .set({ role: orgRole, updatedAt: sql`now()` })
        .where(
          and(
            eq(userOrganizations.userId, id),
            eq(userOrganizations.organizationId, organizationId)
          )
        )
        .returning();

      console.log('[PATCH /api/users/:id] Update result:', result);

      if (result.length === 0) {
        console.log('[PATCH /api/users/:id] Error: Update affected 0 rows');
        return res.status(404).json({ message: "User not found in organization" });
      }

      console.log('[PATCH /api/users/:id] Success - role updated to:', result[0].role);
      res.json({ success: true, updatedRole: result[0].role });
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  app.delete("/api/users/:id", isAuthenticated, tenantContext, requireOrgOwnerAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const currentUserId = getUserId(req.user);
      const organizationId = getRequestOrganizationId(req);

      // Prevent users from removing themselves
      if (id === currentUserId) {
        return res.status(400).json({ message: "You cannot remove yourself from the organization" });
      }

      // Remove user from organization
      await db
        .delete(userOrganizations)
        .where(
          and(
            eq(userOrganizations.userId, id),
            eq(userOrganizations.organizationId, organizationId)
          )
        );

      res.json({ success: true });
    } catch (error) {
      console.error("Error removing user:", error);
      res.status(500).json({ message: "Failed to remove user" });
    }
  });

  // ============================================================
  // ADMIN USER INVITE SYSTEM (Owner/Admin only, Org-scoped)
  // ============================================================

  // List all users in organization (owner/admin only)
  app.get("/api/admin/users", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) {
        return res.status(403).json({ message: "No organization context" });
      }

      // Get all users in this organization via userOrganizations table
      const orgUsers = await db
        .select({
          userId: userOrganizations.userId,
          role: userOrganizations.role,
          isDefault: userOrganizations.isDefault,
          id: users.id,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          isAdmin: users.isAdmin,
          mustSetPassword: users.mustSetPassword,
          createdAt: users.createdAt,
        })
        .from(userOrganizations)
        .innerJoin(users, eq(userOrganizations.userId, users.id))
        .where(eq(userOrganizations.organizationId, organizationId))
        .orderBy(asc(users.email));

      res.json({ success: true, data: orgUsers });
    } catch (error) {
      console.error("Error fetching admin users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // Create user with temporary password and send invite email (owner/admin only)
  app.post("/api/admin/users", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) {
        return res.status(403).json({ message: "No organization context" });
      }

      const schema = z.object({
        email: z.string().email(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        role: z.enum(['owner', 'admin', 'manager', 'employee']).default('employee'),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: fromZodError(parsed.error).toString() });
      }

      const { email, firstName, lastName, role } = parsed.data;

      // Check if user already exists in this organization
      const existingUser = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (existingUser.length > 0) {
        // Check if already in this org
        const existingMembership = await db
          .select()
          .from(userOrganizations)
          .where(
            and(
              eq(userOrganizations.userId, existingUser[0].id),
              eq(userOrganizations.organizationId, organizationId)
            )
          )
          .limit(1);

        if (existingMembership.length > 0) {
          return res.status(400).json({ message: "User already exists in this organization" });
        }
      }

      // Generate cryptographically strong temporary password (20 chars)
      const tempPassword = crypto.randomBytes(15).toString('base64').slice(0, 20);

      // Hash the temporary password using bcrypt
      const bcrypt = await import('bcryptjs');
      const passwordHash = await bcrypt.hash(tempPassword, 10);

      // Create user
      const userId = `user-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      await db.insert(users).values({
        id: userId,
        email: email.toLowerCase().trim(),
        firstName: firstName || null,
        lastName: lastName || null,
        role: role,
        isAdmin: role === 'owner' || role === 'admin',
        mustSetPassword: true, // Force password change on first login
        profileImageUrl: null,
        passwordHash: null, // DEPRECATED field, leave null
      });

      // Create auth identity with password hash
      await db.insert(authIdentities).values({
        userId: userId,
        provider: 'password',
        passwordHash: passwordHash,
        passwordSetAt: new Date(),
      });

      // Add user to organization
      await db.insert(userOrganizations).values({
        userId: userId,
        organizationId: organizationId,
        role: role === 'owner' || role === 'admin' ? 'admin' : 'member',
        isDefault: true,
      });

      // Send invite email asynchronously (non-blocking)
      setImmediate(async () => {
        try {
          const appUrl = 'https://www.printershero.com';

          await emailService.sendEmail(organizationId, {
            to: email,
            subject: "You're invited to PrintersHero",
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2>Welcome to PrintersHero!</h2>
                <p>You've been invited to join PrintersHero, a printing company management system.</p>

                <h3>Your Login Credentials</h3>
                <p><strong>Email:</strong> ${email}</p>
                <p><strong>Temporary Password:</strong> <code>${tempPassword}</code></p>

                <p>
                  <a href="${appUrl}/login" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                    Log In to PrintersHero
                  </a>
                </p>

                <p style="color: #ef4444; font-weight: bold;">
                  âš ï¸ You will be prompted to set a new password after logging in.
                </p>

                <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
                  If you have any questions, please contact your system administrator.
                </p>
              </div>
            `,
          });

          console.log(`[User Invite] Email sent successfully to ${email}`);
        } catch (emailError) {
          console.error(`[User Invite] Failed to send email to ${email}:`, emailError);
          // Don't throw - user is already created
        }
      });

      // Never return temp password in API response
      res.json({
        success: true,
        message: "User invited successfully. They will receive an email with login credentials.",
        data: {
          id: userId,
          email,
          firstName,
          lastName,
          role,
          mustSetPassword: true
        }
      });
    } catch (error) {
      console.error("Error creating user invite:", error);
      res.status(500).json({ message: "Failed to create user" });
    }
  });

  // Reset user password and resend invite (owner/admin only)
  app.post("/api/admin/users/:id/reset-password", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) {
        return res.status(403).json({ message: "No organization context" });
      }

      const { id } = req.params;

      // Verify user exists in this organization
      const [membership] = await db
        .select({ userId: userOrganizations.userId })
        .from(userOrganizations)
        .innerJoin(users, eq(userOrganizations.userId, users.id))
        .where(
          and(
            eq(users.id, id),
            eq(userOrganizations.organizationId, organizationId)
          )
        )
        .limit(1);

      if (!membership) {
        return res.status(404).json({ message: "User not found in this organization" });
      }

      const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Generate new temporary password
      const tempPassword = crypto.randomBytes(15).toString('base64').slice(0, 20);
      const bcrypt = await import('bcryptjs');
      const passwordHash = await bcrypt.hash(tempPassword, 10);

      // Update auth identity with new password hash
      await db
        .update(authIdentities)
        .set({
          passwordHash: passwordHash,
          passwordSetAt: new Date(),
        })
        .where(
          and(
            eq(authIdentities.userId, id),
            eq(authIdentities.provider, 'password')
          )
        );

      // Set mustSetPassword flag
      await db
        .update(users)
        .set({ mustSetPassword: true })
        .where(eq(users.id, id));

      // Resend invite email asynchronously
      setImmediate(async () => {
        try {
          const appUrl = 'https://www.printershero.com';

          await emailService.sendEmail(organizationId, {
            to: user.email!,
            subject: "Your PrintersHero Password Has Been Reset",
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2>Password Reset</h2>
                <p>Your password for PrintersHero has been reset by an administrator.</p>

                <h3>Your New Login Credentials</h3>
                <p><strong>Email:</strong> ${user.email}</p>
                <p><strong>Temporary Password:</strong> <code>${tempPassword}</code></p>

                <p>
                  <a href="${appUrl}/login" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                    Log In to PrintersHero
                  </a>
                </p>

                <p style="color: #ef4444; font-weight: bold;">
                  âš ï¸ You will be prompted to set a new password after logging in.
                </p>
              </div>
            `,
          });

          console.log(`[Password Reset] Email sent successfully to ${user.email}`);
        } catch (emailError) {
          console.error(`[Password Reset] Failed to send email to ${user.email}:`, emailError);
        }
      });

      res.json({
        success: true,
        message: "Password reset successfully. User will receive an email with new credentials."
      });
    } catch (error) {
      console.error("Error resetting user password:", error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });
}
