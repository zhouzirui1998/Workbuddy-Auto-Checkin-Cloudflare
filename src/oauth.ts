import { createOAuthSession, deleteOAuthSession, getOAuthSession, upsertAccount } from "./repository";
import { getAccountProfile, pollOAuth, startOAuth } from "./workbuddy";
import type { AccountVariant } from "./variant";

export async function createLoginRequest(
  env: Env,
  variant: AccountVariant,
): Promise<{ id: string; authUrl: string; expiresAt: number; variant: AccountVariant }> {
  const payload = await startOAuth(variant);
  const session = await createOAuthSession(env.DB, payload, env.TOKEN_ENCRYPTION_KEY);
  return { id: session.id, authUrl: payload.authUrl, expiresAt: session.expiresAt, variant };
}

export async function completeLoginRequest(
  env: Env,
  sessionId: string,
): Promise<{ pending: true } | { pending: false; accountId: string }> {
  const session = await getOAuthSession(env.DB, sessionId, env.TOKEN_ENCRYPTION_KEY);
  const tokenResult = await pollOAuth(session.state, session.variant);
  if (tokenResult.pending) return { pending: true };
  const profile = await getAccountProfile(session.state, tokenResult.credentials, session.variant);
  const accountId = await upsertAccount(
    env.DB,
    profile,
    tokenResult.credentials,
    env.TOKEN_ENCRYPTION_KEY,
    session.variant,
  );
  await deleteOAuthSession(env.DB, sessionId);
  return { pending: false, accountId };
}
