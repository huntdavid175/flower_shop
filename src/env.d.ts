import type { StaffMember } from './lib/auth';

declare global {
	namespace App {
		interface Locals {
			/**
			 * Set by the middleware for /admin and /api/admin requests.
			 *
			 * Non-null inside the admin: the middleware redirects or returns 401
			 * before any page runs, so pages can use it without re-checking.
			 * Null everywhere else, where the middleware does not run.
			 */
			staff: StaffMember | null;
		}
	}
}

export {};
