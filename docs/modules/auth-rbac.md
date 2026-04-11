# Authentication and RBAC Module

## Overview

The system uses custom session-based authentication with role-based access control (RBAC). Users log in with credentials, receive a session token, and the token is validated on every request. Permissions are defined per role per module with granular action flags.

## Tables

| Table | Purpose |
|-------|---------|
| `users` | User accounts (user_id, password_hash, role) |
| `roles` | Role definitions (role_code, role_name) |
| `role_permissions` | Per-role per-module permissions |
| `erp_sessions` | Active session tokens |

## Authentication Flow

```
User enters credentials
        |
        v
loginAndGetToken(userId, password)
        |
        ├── Lookup user by user_id
        ├── Verify password hash
        ├── Generate session token
        ├── Store in erp_sessions
        └── Return token + user info
        
Every subsequent request includes token
        |
        v
getSessionUser(token)
        |
        ├── Lookup erp_sessions by token
        ├── Check session expiry
        └── Return user with role + permissions
```

## User Fields

| Field | Description |
|-------|-------------|
| `user_id` | Login identifier (unique) |
| `password_hash` | Hashed password |
| `display_name` | User's display name |
| `role` | Legacy role field |
| `role_id` | FK to `roles` table |
| `active` | Whether user can log in |

## Password Handling

- Passwords are hashed via `_hashPassword_(password)` 
- Verification via `_verifyPassword_(plainPassword, storedHash)`
- Password policy enforced by `_assertPasswordPolicy_(password)` (minimum length, complexity)
- Admin can reset passwords via `adminResetUserPassword()`
- Users can change own password via `changeOwnPassword()`

## Session Management

Sessions are stored in `erp_sessions`:
- `token` - Primary key, used as the session identifier
- `user_id` - Which user owns the session
- `payload` - JSON with user details, role, permissions
- `created_at` - Session creation time

Session expiry is checked by `_isSessionExpired_(session)`.

`_invalidateUserSessions_(userId)` removes all sessions for a user (used on password reset, deactivation).

## Role-Based Access Control

### Roles

Each role has a `role_code` and `role_name`. Examples might include Admin, Sales, Artwork, Production, Accounts, etc.

### Permissions

`role_permissions` defines what each role can do per module:

| Permission | Description |
|-----------|-------------|
| `can_view` | Can see the module's data |
| `can_create` | Can create new records |
| `can_edit` | Can modify existing records |
| `can_delete` | Can delete records |
| `can_approve_accounts` | Can perform accounts approval |
| `can_approve_business` | Can perform business approval |

### Module Codes

Permissions are defined for these module codes (from `PAGE_MODULE_MAP`):

| Module Code | Description |
|-------------|-------------|
| `SALES_ORDER_ENTRY` | Sales order creation/editing |
| `SALES_ORDER_APPROVAL` | SO line approval |
| `ARTWORK` | Artwork management |
| `MASTERS` | Client/item master |
| `PURCHASE` | Purchasing |
| `ITEMMASTER` | Item master with BOM |
| `WOW` | Work order creation |
| `INVENTORY` | Inventory management |
| `PACKING` | Packing operations |
| `DISPATCH` | Dispatch operations |
| `PRODUCTION` | Production entry |
| `BILLING` | Invoicing |
| `REPORTS` | Reports and planning |
| `COSTING` | Product costing |
| `MASTERADMIN` | Admin panel |

### Permission Check Flow

```javascript
// In Code.gs
_requireModuleAccess_(token, 'SALES_ORDER_ENTRY', 'can_create');
// 1. Gets session user from token
// 2. Checks role_permissions for module + action
// 3. Throws 'Unauthorized' if not permitted
```

## Key Functions (Code.gs)

| Function | Purpose |
|----------|---------|
| `loginAndGetToken(userId, password)` | Authenticate and create session |
| `logout(token)` | Destroy session |
| `getSessionUser(token)` | Validate token and get user info |
| `checkPermission(token, moduleCode, action)` | Check if user has permission |
| `_requireModuleAccess_(token, moduleCode, action)` | Require permission or throw |
| `adminCreateRole(payload, token)` | Create a new role |
| `adminListRoles(token)` | List all roles |
| `adminUpdateRole(payload, token)` | Update role details |
| `adminCreateUser(payload, token)` | Create a new user |
| `adminListUsers(token)` | List all users |
| `adminUpdateUser(payload, token)` | Update user details |
| `adminResetUserPassword(payload, token)` | Reset a user's password |
| `changeOwnPassword(currentPassword, newPassword, token)` | User changes own password |
| `adminListPermissions(roleId, token)` | List permissions for a role |
| `adminSaveRolePermissions(payload, token)` | Save role permissions |

## Page Access Control

The `doGet(e)` web app handler enforces page access:

1. Extract `page` parameter from URL
2. Look up `token` (from URL parameter or cookie)
3. Map page to module via `PAGE_MODULE_MAP`
4. Call `_canAccessPage_(page, sessionUser, token)` to verify `can_view` permission
5. If unauthorized, render `renderUnauthorizedPage()`

The `menu` page is always accessible to authenticated users.

## Admin Functions

Admin functions require `_requireAdmin_(token)` which checks if the user has the admin role. Admin can:
- Manage roles and their permissions
- Create/update/deactivate users
- Reset passwords
