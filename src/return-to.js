// Shared by both generated login pages. Validation lives in the OAuth library so
// fixes reach existing apps through a dependency update instead of re-scaffolding.
export const demoSafeReturnToImport =
	"import { safeReturnTo as safeLocalPath } from '@svelte-atproto/oauth/permissions';";

export const demoSafeReturnTo = `function safeReturnTo(value: string | null | undefined): string {
\treturn safeLocalPath(value) ?? DEFAULT_RETURN_TO;
}`;
